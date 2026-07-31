import { CryptoService } from '@/services/cryptoService';
import { WebSocketService } from '@/services/websocketService';
import { VoteTrackerService } from '@/services/voteTrackerService';
import { UserService } from '@/services/userService';

export interface PowChallenge {
  challengeId: string;
  prefix: string;
  difficulty: number;
  expiresAt: number;
}

export interface PowProof {
  challengeId: string;
  nonce: number;
  /** Included when proof was generated client-side (no server round-trip) */
  clientGenerated?: boolean;
  /** Content hash used to generate a client-side challenge; relay verifies this */
  contentHash?: string;
  /** Window timestamp used to generate a client-side challenge */
  windowTs?: number;
}

// Mirrors POW_REQUIRED_TYPES in pow-challenge.js on the server.
// Must stay in sync with POW_CONTENT_TYPES in websocketService.ts.
const POW_REQUIRED_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);

const CHALLENGE_TIMEOUT_MS = 10_000;
const SOLVER_BATCH_SIZE = 5_000;
const MAX_CLIENT_DIFFICULTY = 24;
const MAX_PREFIX_LENGTH = 128;
const MIN_TTL_MS = 5_000;

// Client-side challenge parameters (must match pow-server-patch.js on the relay)
const CLIENT_DIFFICULTY = 16;
const CHALLENGE_WINDOW_MS = 30_000;

function countLeadingZeroBits(hexHash: string): number {
  let bits = 0;
  for (const ch of hexHash) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      bits += 4;
    } else {
      if (nibble < 2) bits += 3;
      else if (nibble < 4) bits += 2;
      else if (nibble < 8) bits += 1;
      break;
    }
  }
  return bits;
}

function validateChallenge(c: PowChallenge): void {
  if (typeof c.challengeId !== 'string' || c.challengeId.length === 0) {
    throw new Error('PoW challenge missing challengeId');
  }
  if (typeof c.prefix !== 'string' || c.prefix.length === 0) {
    throw new Error('PoW challenge missing prefix');
  }
  if (!Number.isFinite(c.difficulty) || c.difficulty < 1) {
    throw new Error(`PoW difficulty invalid: ${c.difficulty}`);
  }
  if (c.difficulty > MAX_CLIENT_DIFFICULTY) {
    throw new Error(`PoW difficulty ${c.difficulty} exceeds client maximum ${MAX_CLIENT_DIFFICULTY}`);
  }
  if (c.prefix.length > MAX_PREFIX_LENGTH) {
    throw new Error('PoW challenge prefix too long');
  }
  if (c.expiresAt < Date.now() + MIN_TTL_MS) {
    throw new Error('PoW challenge TTL too short or already expired');
  }
}

// ── Web Worker solver (non-blocking) ─────────────────────────────────────────
// Inlined as a blob URL — no extra file needed.
const WORKER_SRC = `
self.onmessage = async function(e) {
  const { prefix, challengeId, difficulty } = e.data;
  let nonce = 0;
  const BATCH = 10000;
  function zeros(hex) {
    let b = 0;
    for (const ch of hex) {
      const n = parseInt(ch, 16);
      if (n === 0) { b += 4; continue; }
      if (n < 2) b += 3; else if (n < 4) b += 2; else if (n < 8) b += 1;
      break;
    }
    return b;
  }
  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  while (nonce < 2**32) {
    for (let i = 0; i < BATCH && nonce < 2**32; i++, nonce++) {
      const hash = await sha256(prefix + nonce);
      if (zeros(hash) >= difficulty) {
        self.postMessage({ ok: true, nonce, hash, challengeId });
        return;
      }
    }
  }
  self.postMessage({ ok: false, error: 'Exhausted nonce space' });
};
`;

function solveInWorker(challenge: PowChallenge): Promise<number> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = (e) => {
      URL.revokeObjectURL(url);
      worker.terminate();
      if (e.data.ok) resolve(e.data.nonce);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      URL.revokeObjectURL(url);
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ prefix: challenge.prefix, challengeId: challenge.challengeId, difficulty: challenge.difficulty });
  });
}

// ── PowService ────────────────────────────────────────────────────────────────

export class PowService {
  private static challengeResolver:
    | { resolve: (c: PowChallenge) => void; reject: (e: Error) => void }
    | null = null;
  private static initialized = false;

  /** Mutex: serialises concurrent getProof calls to avoid resolver clobbering. */
  private static proofQueue: Promise<void> = Promise.resolve();

  private static initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    WebSocketService.subscribe('pow-required', (data: unknown) => {
      const reason = (data as Record<string, unknown>)?.reason ?? 'unknown reason';
      console.warn('[PoW] Server requires proof-of-work:', reason);
    });

    WebSocketService.subscribe('pow-challenge', (data: unknown) => {
      if (this.challengeResolver) {
        const d = data as Record<string, unknown>;
        const challenge: PowChallenge = {
          challengeId: d.challengeId as string,
          prefix: d.prefix as string,
          difficulty: d.difficulty as number,
          expiresAt: d.expiresAt as number,
        };
        const resolver = this.challengeResolver;
        this.challengeResolver = null;
        resolver.resolve(challenge);
      }
    });
  }

  /**
   * Request a PoW challenge from the relay server via WebSocket.
   * Called when the WS relay is reachable (primary path).
   */
  private static async requestServerChallenge(action: string): Promise<PowChallenge> {
    this.initialize();

    const deviceId = await VoteTrackerService.getDeviceId();
    let identityUsername = '';
    try {
      const currentUser = await UserService.getCurrentUser();
      identityUsername = (currentUser.identityUsername || currentUser.customUsername || currentUser.username || '').trim();
    } catch (err) {
      console.warn('[PoW] Proceeding without identity username claim:', err);
    }

    return new Promise<PowChallenge>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.challengeResolver = null;
        reject(new Error('PoW challenge request timed out'));
      }, CHALLENGE_TIMEOUT_MS);

      this.challengeResolver = {
        resolve: (challenge: PowChallenge) => {
          clearTimeout(timeout);
          resolve(challenge);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      };

      const sent = WebSocketService.sendRaw({
        type: 'request-pow',
        deviceId,
        action,
        identityUsername,
      });

      if (!sent) {
        this.challengeResolver = null;
        clearTimeout(timeout);
        reject(new Error('WebSocket not connected'));
      }
    });
  }

  /**
   * Generate a client-side PoW challenge — no server round-trip needed.
   * Used when the WS relay is unreachable.
   *
   * The relay verifies this by reconstructing:
   *   challengeId = SHA256(contentHash + windowTs)
   * and checking the nonce solves it at CLIENT_DIFFICULTY bits.
   */
  private static generateClientChallenge(contentHash: string): PowChallenge {
    const windowTs = Math.floor(Date.now() / CHALLENGE_WINDOW_MS) * CHALLENGE_WINDOW_MS;
    const challengeId = CryptoService.hash(JSON.stringify({ contentHash, windowTs }));
    return {
      challengeId,
      prefix: challengeId.slice(0, 32),
      difficulty: CLIENT_DIFFICULTY,
      expiresAt: windowTs + CHALLENGE_WINDOW_MS,
    };
  }

  /**
   * Solve a PoW challenge. Tries a Web Worker first (non-blocking UI),
   * falls back to main-thread solving with event-loop yields.
   */
  private static async solve(challenge: PowChallenge): Promise<number> {
    validateChallenge(challenge);

    // Try Web Worker (non-blocking)
    try {
      return await solveInWorker(challenge);
    } catch {
      // Worker failed — fall back to main thread with yields
    }

    const { prefix, difficulty, expiresAt } = challenge;
    let nonce = 0;

    for (;;) {
      if (Date.now() > expiresAt) {
        throw new Error('PoW challenge expired during solving');
      }
      for (let i = 0; i < SOLVER_BATCH_SIZE; i++) {
        const hash = CryptoService.hash(prefix + nonce.toString());
        if (countLeadingZeroBits(hash) >= difficulty) return nonce;
        nonce++;
      }
      // Yield to event loop between batches
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  /**
   * Get a PoW proof for the given action.
   *
   * Strategy:
   *   1. If WS relay is connected → request server challenge (original flow, exact same behaviour)
   *   2. If WS relay is offline   → generate client-side challenge and solve it
   *
   * The relay server accepts both via pow-server-patch.js.
   * Serialised via an internal queue so concurrent calls don't clobber each other's resolver.
   *
   * @param action       - action type (e.g. 'new-poll', 'new-block')
   * @param contentHash  - hash of content being submitted; used for client-side challenges only
   */
  static getProof(action: string, contentHash?: string): Promise<PowProof> {
    const run = async (): Promise<PowProof> => {
      const wsConnected = WebSocketService.getConnectionStatus();

      if (wsConnected) {
        // ── Path A: server-issued challenge (original behaviour) ──────────────
        const challenge = await this.requestServerChallenge(action);
        const nonce = await this.solve(challenge);
        return { challengeId: challenge.challengeId, nonce };
      } else {
        // ── Path B: client-generated challenge (relay offline) ────────────────
        if (!contentHash) {
          // Derive a deterministic content hash from the action + timestamp
          contentHash = CryptoService.hash(`${action}-${Math.floor(Date.now() / CHALLENGE_WINDOW_MS)}`);
        }
        const challenge = this.generateClientChallenge(contentHash);
        const nonce = await this.solve(challenge);
        return {
          challengeId: challenge.challengeId,
          nonce,
          clientGenerated: true,
          contentHash,
          windowTs: Math.floor(Date.now() / CHALLENGE_WINDOW_MS) * CHALLENGE_WINDOW_MS,
        };
      }
    };

    const result = this.proofQueue.then(run, run);
    this.proofQueue = result.then(() => {}, () => {});
    return result;
  }

  /**
   * Check if a message type requires proof-of-work.
   * Mirrors the server-side `requiresPow` logic in pow-challenge.js.
   */
  static requiresProof(messageType: string, actionType?: string): boolean {
    if (!POW_REQUIRED_TYPES.has(messageType)) return false;
    if (messageType === 'new-block' && actionType && actionType !== 'post-create') {
      return false;
    }
    return true;
  }
}
