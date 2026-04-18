import config from '@/config';
import { CryptoService } from '@/services/cryptoService';
import { GunService } from '@/services/gunService';
import { KeyService } from '@/services/keyService';

const DISCOVERY_ROOT = 'server-config';
const DISCOVERY_PATH = 'discovery';
const DEFAULT_TTL_MS = 5 * 60_000;
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_ENTRIES = 100;

interface DiscoverySignedPayload {
  version: 1;
  nodeId: string;
  peerId: string;
  websocket: string;
  gun: string;
  api: string;
  capabilities: string[];
  timestamp: number;
  ttlMs: number;
}

interface DiscoveryAnnouncement extends DiscoverySignedPayload {
  signerPubkey: string;
  signature: string;
}

export interface DiscoveryEntry extends DiscoveryAnnouncement {
  expiresAt: number;
}

export interface PublishDiscoveryInput {
  nodeId: string;
  peerId?: string;
  websocket?: string;
  gun?: string;
  api?: string;
  capabilities?: string[];
  ttlMs?: number;
}

export class DiscoveryService {
  private static initialized = false;
  private static subscribed = false;
  private static maxEntries = DEFAULT_MAX_ENTRIES;
  private static entries: Map<string, DiscoveryEntry> = new Map();
  private static pruneTimer: ReturnType<typeof setInterval> | null = null;

  static async initialize(options?: { maxEntries?: number }): Promise<void> {
    if (typeof options?.maxEntries === 'number' && options.maxEntries > 0) {
      this.maxEntries = Math.floor(options.maxEntries);
    }
    if (this.initialized) return;
    this.initialized = true;
    this.subscribeToAnnouncements();
    this.startPruneLoop();
  }

  static async publishLocalAnnouncement(input: PublishDiscoveryInput): Promise<DiscoveryEntry | null> {
    await this.initialize();

    if (!input.nodeId || !input.nodeId.trim()) return null;

    const keyPair = await KeyService.getKeyPair();
    const payload: DiscoverySignedPayload = {
      version: 1,
      nodeId: input.nodeId.trim(),
      peerId: (input.peerId || input.nodeId).trim(),
      websocket: input.websocket || config.relay.websocket,
      gun: input.gun || config.relay.gun,
      api: input.api || config.relay.api,
      capabilities: this.normalizeCapabilities(input.capabilities),
      timestamp: Date.now(),
      ttlMs: this.clampTtl(input.ttlMs),
    };

    const signature = CryptoService.sign(this.signingMessage(payload), keyPair.privateKey);
    const announcement: DiscoveryAnnouncement = {
      ...payload,
      signerPubkey: keyPair.publicKey,
      signature,
    };

    const normalized = this.normalizeAndValidate(announcement);
    if (!normalized) return null;

    const announcementKey = this.discoveryKey(normalized);
    await this.putAnnouncement(announcementKey, announcement);
    this.upsertEntry(announcementKey, normalized);
    return normalized;
  }

  static async refreshFromGun(): Promise<DiscoveryEntry[]> {
    await this.initialize();
    this.pruneExpiredEntries();
    return this.getEntries();
  }

  static getEntries(): DiscoveryEntry[] {
    this.pruneExpiredEntries();
    return Array.from(this.entries.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, this.maxEntries);
  }

  private static subscribeToAnnouncements(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    try {
      const gun = GunService.getGun();
      gun
        .get(DISCOVERY_ROOT)
        .get(DISCOVERY_PATH)
        .map()
        .on((raw: unknown, key: string) => {
          if (!key || typeof key !== 'string') return;
          const normalized = this.normalizeAndValidate(raw);
          if (!normalized) return;
          this.upsertEntry(this.discoveryKey(normalized), normalized);
        });
    } catch {
      // Gun unavailable; keep existing cache
    }
  }

  private static startPruneLoop(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      this.pruneExpiredEntries();
    }, 30_000);
  }

  private static pruneExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private static upsertEntry(key: string, entry: DiscoveryEntry): void {
    this.pruneExpiredEntries();

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, entry);

    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  private static async putAnnouncement(key: string, announcement: DiscoveryAnnouncement): Promise<void> {
    const gunAnnouncement: Record<string, unknown> = {
      ...announcement,
      // Gun graph writes reject arrays; store deterministic index map instead.
      capabilities: this.capabilitiesToGunMap(announcement.capabilities),
    };
    await new Promise<void>((resolve, reject) => {
      try {
        GunService.getGun()
          .get(DISCOVERY_ROOT)
          .get(DISCOVERY_PATH)
          .get(key)
          .put(gunAnnouncement, (ack: { err?: string }) => {
            if (ack?.err) reject(new Error(ack.err));
            else resolve();
          });
      } catch (error) {
        reject(error);
      }
    });
  }

  private static normalizeAndValidate(raw: unknown): DiscoveryEntry | null {
    if (!raw || typeof raw !== 'object') return null;

    const obj = raw as Record<string, unknown>;
    const payload: DiscoverySignedPayload = {
      version: 1,
      nodeId: this.normalizeString(obj.nodeId),
      peerId: this.normalizeString(obj.peerId || obj.nodeId),
      websocket: this.normalizeString(obj.websocket),
      gun: this.normalizeString(obj.gun),
      api: this.normalizeString(obj.api),
      capabilities: this.normalizeCapabilities(obj.capabilities),
      timestamp: this.normalizeNumber(obj.timestamp),
      ttlMs: this.clampTtl(this.normalizeNumber(obj.ttlMs)),
    };

    const signerPubkey = this.normalizeString(obj.signerPubkey);
    const signature = this.normalizeString(obj.signature);

    if (
      !payload.nodeId ||
      !payload.peerId ||
      !payload.websocket ||
      !payload.gun ||
      !payload.api ||
      !this.isValidPubkey(signerPubkey) ||
      !this.isValidSignature(signature) ||
      !this.isSecureEndpoints(payload.websocket, payload.gun, payload.api)
    ) {
      return null;
    }

    const expiresAt = payload.timestamp + payload.ttlMs;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    if (!CryptoService.verify(this.signingMessage(payload), signature, signerPubkey)) {
      return null;
    }

    return {
      ...payload,
      signerPubkey,
      signature,
      expiresAt,
    };
  }

  private static signingMessage(payload: DiscoverySignedPayload): string {
    return JSON.stringify({
      version: payload.version,
      nodeId: payload.nodeId,
      peerId: payload.peerId,
      websocket: payload.websocket,
      gun: payload.gun,
      api: payload.api,
      capabilities: this.normalizeCapabilities(payload.capabilities),
      timestamp: payload.timestamp,
      ttlMs: payload.ttlMs,
    });
  }

  private static normalizeCapabilities(raw: unknown): string[] {
    if (Array.isArray(raw)) {
      return Array.from(
        new Set(
          raw
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ).sort();
    }

    if (raw && typeof raw === 'object') {
      return Array.from(
        new Set(
          Object.entries(raw as Record<string, unknown>)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([, value]) => (typeof value === 'string' ? value.trim() : ''))
            .filter(Boolean),
        ),
      ).sort();
    }

    return [];
  }

  private static capabilitiesToGunMap(capabilities: string[]): Record<string, string> {
    return Object.fromEntries(capabilities.map((capability, index) => [String(index), capability]));
  }

  private static clampTtl(rawTtl?: number): number {
    const ttl = Number.isFinite(rawTtl) ? Number(rawTtl) : DEFAULT_TTL_MS;
    return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(ttl)));
  }

  private static normalizeString(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
  }

  private static normalizeNumber(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return 0;
  }

  private static isValidPubkey(pubkey: string): boolean {
    return /^[0-9a-f]{64}$/i.test(pubkey);
  }

  private static isValidSignature(signature: string): boolean {
    return /^[0-9a-f]{128}$/i.test(signature);
  }

  private static isSecureEndpoints(wsUrl: string, gunUrl: string, apiUrl: string): boolean {
    try {
      const ws = new URL(wsUrl);
      const gun = new URL(gunUrl);
      const api = new URL(apiUrl);
      return ws.protocol === 'wss:' && gun.protocol === 'https:' && api.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private static discoveryKey(entry: DiscoveryEntry): string {
    return `${entry.signerPubkey}:${entry.nodeId}`;
  }
}
