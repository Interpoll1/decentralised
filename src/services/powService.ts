import { CryptoService } from '@/services/cryptoService';
import { WebSocketService } from '@/services/websocketService';
import { VoteTrackerService } from '@/services/voteTrackerService';

export interface PowChallenge {
  challengeId: string;
  prefix: string;
  difficulty: number;
  expiresAt: number;
}

export interface PowProof {
  challengeId: string;
  nonce: number;
}

// Mirrors POW_REQUIRED_TYPES in pow-challenge.js on the server.
// Must stay in sync with POW_CONTENT_TYPES in websocketService.ts.
// 'broadcast' is included for server parity even though current callers
// don't pass it as a type (the relay wrapper handles that envelope).
const POW_REQUIRED_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);

const CHALLENGE_TIMEOUT_MS = 10_000;
const SOLVER_BATCH_SIZE = 5_000;
const MAX_CLIENT_DIFFICULTY = 28;
const MAX_PREFIX_LENGTH = 128;
const MIN_TTL_MS = 5_000;

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
   */
  private static async requestChallenge(action: string): Promise<PowChallenge> {
    this.initialize();

    const deviceId = await VoteTrackerService.getDeviceId();

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
      });

      if (!sent) {
        this.challengeResolver = null;
        clearTimeout(timeout);
        reject(new Error('WebSocket not connected — cannot request PoW challenge'));
      }
    });
  }

  /**
   * Solve a PoW challenge by finding a nonce whose SHA-256(prefix + nonce)
   * has at least `difficulty` leading zero bits.
   * Yields to the event loop every SOLVER_BATCH_SIZE iterations to avoid UI freeze.
   */
  private static async solve(challenge: PowChallenge): Promise<number> {
    validateChallenge(challenge);
    const { prefix, difficulty, expiresAt } = challenge;
    let nonce = 0;

    for (;;) {
      if (Date.now() > expiresAt) {
        throw new Error('PoW challenge expired during solving');
      }

      for (let i = 0; i < SOLVER_BATCH_SIZE; i++) {
        const hash = CryptoService.hash(prefix + nonce.toString());
        if (countLeadingZeroBits(hash) >= difficulty) {
          return nonce;
        }
        nonce++;
      }

      // Yield to event loop
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  /**
   * Combined: request a challenge from the server, solve it, and return the proof
   * ready to be attached to a content message.
   * Serialised via an internal queue so concurrent calls don't clobber each other's
   * challenge resolver.
   */
  static getProof(action: string): Promise<PowProof> {
    const run = async (): Promise<PowProof> => {
      const challenge = await this.requestChallenge(action);
      const nonce = await this.solve(challenge);
      return { challengeId: challenge.challengeId, nonce };
    };

    // Chain onto the queue so only one request-challenge / solve cycle
    // is in-flight at a time, preventing resolver clobbering.
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
