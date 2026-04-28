import { GunService } from './gunService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { StorageService } from './storageService';
import config from '../config';

function getApiBase(): string {
  return config.relay.api;
}

function getGunRelayBase(): string {
  return config.relay.gun.replace(/\/gun$/, '');
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters: string[];
}

export interface Poll {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorShowRealName?: boolean;
  question: string;
  description?: string;
  options: PollOption[];
  createdAt: number;
  expiresAt: number;
  allowMultipleChoices: boolean;
  showResultsBeforeVoting: boolean;
  requireLogin: boolean;
  isPrivate: boolean;
  totalVotes: number;
  isExpired: boolean;
  authorPubkey?: string;
  contentSignature?: string;
  isEncrypted?: boolean;
  encryptedContent?: string;
  authTag?: string;
}

const pollActiveListeners = new Map<string, any>();
const PENDING_INVITE_FINALIZATIONS_KEY = 'interpoll_pending_invite_finalizations';
const LOCAL_POLLS_META_KEY = 'interpoll-local-polls-v1';
const LOCAL_POLLS_TOMBSTONES_META_KEY = 'interpoll-local-polls-tombstones-v1';
const LOCAL_POLL_BACKUP_TTL_MS = 30 * 60 * 1000;

type PendingInviteFinalization = {
  pollId: string;
  code: string;
  reservationId: string;
};

type LocalPollBackupEntry = {
  poll: Poll;
  backedUpAt: number;
};

type LocalPollBackupMap = Record<string, LocalPollBackupEntry>;

const POLL_DEBUG_KEY = 'interpoll_poll_debug';
type PollDebugCategory = 'create' | 'writes' | 'index' | 'ui' | 'all';

function getPollDebugCategories(): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const raw = window.localStorage.getItem(POLL_DEBUG_KEY);
    if (!raw) return new Set();
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'true') return new Set(['all']);
    return new Set(
      normalized
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function isPollDebugEnabled(category: PollDebugCategory): boolean {
  const categories = getPollDebugCategories();
  return categories.has('all') || categories.has(category);
}

function logPollDebug(category: PollDebugCategory, message: string, meta?: Record<string, unknown>) {
  if (!isPollDebugEnabled(category)) return;
  const prefix = `[PollCreateDebug:${category}]`;
  if (meta) {
    console.log(prefix, message, meta);
    return;
  }
  console.log(prefix, message);
}

async function indexForSearch(type: 'post' | 'poll', id: string, data: any) {
  try {
    const startedAt = performance.now();
    logPollDebug('index', 'Indexing started', { type, id });
    const { IntegrityService } = await import('@/services/integrityService');
    const body = await IntegrityService.seal(
      { type, id, data } as Record<string, unknown>,
      'index',
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const apiUrl = new URL(getApiBase(), typeof window !== 'undefined' ? window.location.origin : undefined);
    const useCredentials = typeof window !== 'undefined' && apiUrl.origin === window.location.origin;
    try {
      await fetch(`${getApiBase()}/api/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: useCredentials ? 'include' : 'omit',
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      logPollDebug('index', 'Indexing completed', {
        type,
        id,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logPollDebug('index', 'Indexing failed', {
      type,
      id,
      error: err instanceof Error ? err.message : String(err),
    });
    console.warn('Search indexing failed:', err);
  }
}

export class PollService {
  private static get gun() { return GunService.getGun(); }
  private static localPollBackupWriteQueue: Promise<void> = Promise.resolve();
  private static getPollPath(pollId: string) { return this.gun.get('polls').get(pollId); }
  private static getCommunityPollPath(communityId: string, pollId: string) {
    return this.gun.get('communities').get(communityId).get('polls').get(pollId);
  }

  private static enqueueLocalPollBackupWrite(task: () => Promise<void>): Promise<void> {
    const run = this.localPollBackupWriteQueue.then(task, task);
    this.localPollBackupWriteQueue = run.catch(() => {});
    return run;
  }

  private static buildPollRecord(pollData: any, options: PollOption[]): Poll | null {
    if (!pollData?.id || options.length === 0) return null;
    const totalVotes = options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
    return {
      id: pollData.id, communityId: pollData.communityId || '',
      authorId: pollData.authorId || '', authorName: pollData.authorName || 'Anonymous',
      question: pollData.question || '', description: pollData.description || '',
      options, createdAt: pollData.createdAt || Date.now(),
      expiresAt: pollData.expiresAt || 0,
      allowMultipleChoices: !!pollData.allowMultipleChoices,
      showResultsBeforeVoting: !!pollData.showResultsBeforeVoting,
      requireLogin: !!pollData.requireLogin, isPrivate: !!pollData.isPrivate,
      totalVotes, isExpired: Date.now() > (pollData.expiresAt || 0),
      isEncrypted: pollData.isEncrypted || false,
      encryptedContent: pollData.encryptedContent || undefined,
      authTag: pollData.authTag || undefined,
      authorPubkey: pollData.authorPubkey || undefined,
      contentSignature: pollData.contentSignature || undefined,
    };
  }

  private static isOffline(): boolean {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine === false;
  }

  private static async readLocalPollMap(): Promise<LocalPollBackupMap> {
    try {
      const raw = await StorageService.getMetadata(LOCAL_POLLS_META_KEY);
      if (!raw || typeof raw !== 'object') return {};
      const normalized: LocalPollBackupMap = {};
      Object.entries(raw as Record<string, any>).forEach(([pollId, value]) => {
        if (!value || typeof value !== 'object') return;
        if ('poll' in value && value.poll && typeof value.poll === 'object') {
          const poll = value.poll as Poll;
          if (!poll?.id || !Array.isArray(poll.options) || poll.options.length === 0) return;
          normalized[pollId] = {
            poll,
            backedUpAt: Number(value.backedUpAt) || poll.createdAt || Date.now(),
          };
          return;
        }
        const legacyPoll = value as Poll;
        if (!legacyPoll?.id || !Array.isArray(legacyPoll.options) || legacyPoll.options.length === 0) return;
        normalized[pollId] = {
          poll: legacyPoll,
          backedUpAt: legacyPoll.createdAt || Date.now(),
        };
      });
      return normalized;
    } catch {
      return {};
    }
  }

  private static async readLocalPollTombstones(): Promise<Record<string, number>> {
    try {
      const raw = await StorageService.getMetadata(LOCAL_POLLS_TOMBSTONES_META_KEY);
      if (!raw || typeof raw !== 'object') return {};
      const normalized: Record<string, number> = {};
      Object.entries(raw as Record<string, unknown>).forEach(([pollId, value]) => {
        const ts = Number(value);
        if (Number.isFinite(ts) && ts > 0) normalized[pollId] = ts;
      });
      return normalized;
    } catch {
      return {};
    }
  }

  private static normalizeLocalPoll(poll: Poll): Poll {
    const totalVotes = poll.options.reduce((sum, option) => sum + (option.votes || 0), 0);
    return {
      ...poll,
      totalVotes,
      isExpired: Date.now() > (poll.expiresAt || 0),
    };
  }

  private static localPollBackupSignature(poll: Poll): string {
    return JSON.stringify({
      id: poll.id,
      communityId: poll.communityId,
      question: poll.question,
      description: poll.description || '',
      totalVotes: poll.totalVotes || 0,
      expiresAt: poll.expiresAt || 0,
      isPrivate: Boolean(poll.isPrivate),
      isEncrypted: Boolean(poll.isEncrypted),
      options: poll.options.map((option) => ({
        id: option.id,
        text: option.text,
        votes: option.votes || 0,
        voters: [...option.voters].sort(),
      })),
    });
  }

  private static async saveLocalPollBackup(poll: Poll): Promise<void> {
    const normalizedPoll = this.normalizeLocalPoll(poll);
    const nextSignature = this.localPollBackupSignature(normalizedPoll);
    await this.enqueueLocalPollBackupWrite(async () => {
      try {
        const [next, tombstones] = await Promise.all([
          this.readLocalPollMap(),
          this.readLocalPollTombstones(),
        ]);
        delete tombstones[poll.id];
        const existing = next[poll.id];
        if (existing?.poll && this.localPollBackupSignature(existing.poll) === nextSignature) {
          return;
        }
        next[poll.id] = { poll: normalizedPoll, backedUpAt: Date.now() };
        const ordered = Object.values(next).sort((a, b) => {
          const left = Number.isFinite(a.backedUpAt) ? a.backedUpAt : a.poll.createdAt;
          const right = Number.isFinite(b.backedUpAt) ? b.backedUpAt : b.poll.createdAt;
          return right - left;
        }).slice(0, 500);
        const compact: LocalPollBackupMap = {};
        ordered.forEach((item) => { compact[item.poll.id] = item; });
        await StorageService.setMetadata(LOCAL_POLLS_META_KEY, compact);
        await StorageService.setMetadata(LOCAL_POLLS_TOMBSTONES_META_KEY, tombstones);
      } catch (error) {
        logPollDebug('create', 'Failed to persist local poll backup', {
          pollId: poll.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }

  private static async removeLocalPollBackup(pollId: string): Promise<void> {
    await this.enqueueLocalPollBackupWrite(async () => {
      try {
        const [map, tombstones] = await Promise.all([
          this.readLocalPollMap(),
          this.readLocalPollTombstones(),
        ]);
        if (!map[pollId]) return;
        delete map[pollId];
        tombstones[pollId] = Date.now();
        const recentTombstones = Object.entries(tombstones)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 1000)
          .reduce<Record<string, number>>((acc, [id, ts]) => {
            acc[id] = ts;
            return acc;
          }, {});
        await StorageService.setMetadata(LOCAL_POLLS_META_KEY, map);
        await StorageService.setMetadata(LOCAL_POLLS_TOMBSTONES_META_KEY, recentTombstones);
      } catch {
        // best-effort local cleanup
      }
    });
  }

  static async loadLocalPollsForCommunity(communityId: string): Promise<Poll[]> {
    if (!this.isOffline()) return [];
    const [map, tombstones] = await Promise.all([
      this.readLocalPollMap(),
      this.readLocalPollTombstones(),
    ]);
    const now = Date.now();
    return Object.values(map)
      .filter((entry) => {
        if (!entry?.poll?.id) return false;
        if (tombstones[entry.poll.id]) return false;
        const ageMs = now - (Number.isFinite(entry.backedUpAt) ? entry.backedUpAt : entry.poll.createdAt || 0);
        if (ageMs > LOCAL_POLL_BACKUP_TTL_MS) return false;
        const poll = entry.poll;
        return poll.communityId === communityId && Array.isArray(poll.options) && poll.options.length > 0;
      })
      .map((entry) => this.normalizeLocalPoll(entry.poll))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ── Reduced timeouts: 300ms first attempt, 1.5s fallback (was 500ms / 3.5s) ─
  private static onceNode<T = any>(node: any, timeoutMs = 300): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      node.once((value: T | null) => {
        if (settled) return;
        settled = true;
        resolve(value ?? null);
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
    });
  }

  private static async getLocalPollBackup(pollId: string): Promise<Poll | null> {
    if (!this.isOffline()) return null;
    const [map, tombstones] = await Promise.all([
      this.readLocalPollMap(),
      this.readLocalPollTombstones(),
    ]);
    if (tombstones[pollId]) return null;
    const entry = map[pollId];
    const poll = entry?.poll;
    if (!poll?.id || !Array.isArray(poll.options) || poll.options.length === 0) return null;
    const backedUpAt = Number.isFinite(entry.backedUpAt) ? entry.backedUpAt : poll.createdAt || 0;
    if (!backedUpAt || (Date.now() - backedUpAt) > LOCAL_POLL_BACKUP_TTL_MS) return null;
    return this.normalizeLocalPoll(poll);
  }

  private static waitForNode<T = any>(
    node: any,
    predicate: (value: T | null) => boolean,
    timeoutMs = 1500, // was 3500 — cut by more than half
  ): Promise<T | null> {
    return new Promise((resolve) => {
      let settled = false;
      let subscription: any;
      const cleanup = () => { if (subscription?.off) subscription.off(); };
      subscription = node.on((value: T | null) => {
        if (settled || !predicate(value)) return;
        settled = true;
        cleanup();
        resolve(value ?? null);
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, timeoutMs);
    });
  }

  private static parsePollOptions(optionsData: any): PollOption[] {
    if (!optionsData || typeof optionsData !== 'object') return [];
    const options: PollOption[] = [];
    Object.keys(optionsData).forEach(key => {
      if (key === '_') return;
      const opt = optionsData[key];
      if (opt && opt.id) {
        options.push({
          id: opt.id,
          text: opt.text || '',
          votes: opt.votes || 0,
          voters: this.parseVoters(opt.voters),
        });
      }
    });
    return options;
  }

  private static parseVoters(votersData: any): string[] {
    if (!votersData) return [];
    if (Array.isArray(votersData)) {
      return votersData.filter((voterId): voterId is string => typeof voterId === 'string');
    }
    if (typeof votersData !== 'object') return [];

    return Object.entries(votersData)
      .filter(([key]) => key !== '_')
      .map(([key, value]) => {
        if (typeof value === 'string') return value;
        if (value === true || value === 1) return key;
        return null;
      })
      .filter((voterId): voterId is string => typeof voterId === 'string');
  }

  private static buildVotersMap(voters: string[]): Record<string, string> {
    return Object.fromEntries(
      voters.map((voterId, index) => [index, voterId])
    );
  }

  private static buildOptionsMap(options: PollOption[]): Record<string, any> {
    return Object.fromEntries(options.map((option, index) => [index, {
      id: option.id,
      text: option.text,
      votes: option.votes || 0,
      voters: this.buildVotersMap(option.voters || []),
    }]));
  }

  // ── API poll fetch (metadata fallback only; vote totals are ignored) ─────────
  private static async loadPollFromAPI(pollId: string): Promise<{ pollData: any | null; options: PollOption[] }> {
    try {
      const res = await fetch(`${getApiBase()}/api/poll/${pollId}`, {
        headers: { 'Cache-Control': 'stale-while-revalidate=30' },
      });
      if (!res.ok) return { pollData: null, options: [] };
      const data = await res.json();
      if (!data?.id) return { pollData: null, options: [] };
      // Never trust API vote totals; they can lag and cause bounce-back regressions.
      // We only use API for poll shell metadata and option labels.
      const options: PollOption[] = (data.options || []).map((o: any) => ({
        id: o.id, text: o.text || '', votes: 0, voters: [],
      }));
      return { pollData: data, options };
    } catch (error) {
      console.warn('Poll API fetch failed:', error);
      return { pollData: null, options: [] };
    }
  }

  private static async loadPollFromGun(
    pollId: string,
    allowApiOptionFallback = true,
    allowLocalBackupFallback = true,
  ): Promise<Poll | null> {
    const pollNode = this.getPollPath(pollId);
    let pollData = await this.onceNode<any>(pollNode, 300);
    if (!pollData?.id) {
      pollData = await this.waitForNode<any>(pollNode, (value) => !!value?.id, 1500);
    }
    if (!pollData?.id && allowLocalBackupFallback) {
      return this.getLocalPollBackup(pollId);
    }
    if (!pollData?.id) return null;

    let options = await this.loadPollOptions(pollId, allowApiOptionFallback, pollData);
    // Some relays return poll shells under community scope before global options hydrate.
    // Fall back to community-scoped options to avoid dropping polls on reload.
    if (options.length === 0 && pollData.communityId) {
      options = await this.loadCommunityPollOptions(pollData.communityId, pollId);
    }
    const builtPoll = this.buildPollRecord(pollData, options);
    if (builtPoll) {
      void this.saveLocalPollBackup(builtPoll);
      return builtPoll;
    }
    if (allowLocalBackupFallback) {
      return this.getLocalPollBackup(pollId);
    }
    return null;
  }
  static subscribeToPollsInCommunity(
    communityId: string,
    onPoll: (poll: Poll) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const communityPollsNode = this.gun.get('communities').get(communityId).get('polls');
    const listenerKey = `${communityId}-polls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seenIds = new Set<string>();
    const deferredLivePolls = new Map<string, Poll>();
    const loading = new Map<string, Promise<Poll | null>>();
    const pendingHydrationIds = new Set<string>();
    let initialLoadDone = false;
    let snapshotHandled = false;
    let hydrating = true;
    let disposed = false;
    let subscription: any;
    let hardTimeoutFired = false;
    const subscriptionStartTime = Date.now();

    const checkLoadComplete = () => {
      if (initialLoadDone || disposed) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const loadPollById = (pollId: string): Promise<Poll | null> => {
      if (disposed || !pollId || pollId === '_' || (hydrating && seenIds.has(pollId))) return Promise.resolve(null);
      const inFlight = loading.get(pollId);
      if (inFlight) return inFlight;
      const task = this.loadPoll(pollId)
        .then((poll) => {
          if (poll && !poll.communityId) {
            return { ...poll, communityId };
          }
          return poll;
        })
        .finally(() => { loading.delete(pollId); });
      loading.set(pollId, task);
      return task;
    };

    const emitPoll = (poll: Poll | null) => {
      if (disposed || !poll) return;
      const createdAt = typeof poll.createdAt === 'number' ? poll.createdAt : 0;
      const isLiveDuringHydration = hydrating && createdAt > subscriptionStartTime;
      if (isLiveDuringHydration) {
        seenIds.add(poll.id);
        deferredLivePolls.set(poll.id, poll);
        return;
      }
      if (!seenIds.has(poll.id)) { seenIds.add(poll.id); onPoll(poll); return; }
      if (!hydrating) onPoll(poll);
    };

    const loadAndEmitById = (pollId: string): Promise<void> => {
      return loadPollById(pollId).then(poll => { emitPoll(poll); });
    };

    const finalizeHydration = () => {
      if (disposed || !hydrating) return;
      hydrating = false;
      checkLoadComplete();
      if (deferredLivePolls.size > 0) {
        Array.from(deferredLivePolls.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .forEach(p => onPoll(p));
        deferredLivePolls.clear();
      }
    };

    const flushHydrationIds = () => {
      return (async () => {
        const batchSize = 40;
        while (!disposed && !hardTimeoutFired) {
          const ids = Array.from(pendingHydrationIds);
          if (ids.length === 0) break;
          pendingHydrationIds.clear();
          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            await Promise.all(batch.map(pollId => loadAndEmitById(pollId)));
          }
        }
      })();
    };

    // ── Hydration timer: 3s (was 15s) ─────────────────────────────────────────
    const hydrationTimer = setTimeout(() => {
      if (disposed || snapshotHandled) return;
      snapshotHandled = true;
      flushHydrationIds().finally(() => { finalizeHydration(); });
    }, 3000);

    // ── Hard timeout: 8s (was 30s) ────────────────────────────────────────────
    const hardTimeout = setTimeout(() => {
      if (disposed || !hydrating) return;
      hardTimeoutFired = true;
      finalizeHydration();
    }, 8000);

    subscription = communityPollsNode.map().on((_: any, pollId: string) => {
      if (disposed || !pollId || pollId === '_') return;
      if (hydrating) { if (!seenIds.has(pollId)) pendingHydrationIds.add(pollId); return; }
      void loadAndEmitById(pollId);
    });
    pollActiveListeners.set(listenerKey, { subscription, timer: hydrationTimer, hardTimeout });

    communityPollsNode.once((allPolls) => {
      if (disposed || snapshotHandled) return;
      snapshotHandled = true;
      clearTimeout(hydrationTimer);
      const keys = allPolls ? Object.keys(allPolls).filter(k => k !== '_') : [];
      keys.forEach(pollId => pendingHydrationIds.add(pollId));
      flushHydrationIds().finally(() => { finalizeHydration(); });
    });

    return () => {
      disposed = true;
      clearTimeout(hydrationTimer);
      clearTimeout(hardTimeout);
      if (subscription) subscription.off();
      pollActiveListeners.delete(listenerKey);
    };
  }

  static subscribeToAllPolls(
    onPoll: (poll: Poll) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const pollsNode = this.gun.get('polls');
    const listenerKey = `all-polls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const seenIds = new Set<string>();
    const deferredLivePolls = new Map<string, Poll>();
    const loading = new Map<string, Promise<Poll | null>>();
    const pendingHydrationIds = new Set<string>();
    let initialLoadDone = false;
    let snapshotHandled = false;
    let hydrating = true;
    let disposed = false;
    let subscription: any;
    let hardTimeoutFired = false;
    const subscriptionStartTime = Date.now();

    const checkLoadComplete = () => {
      if (initialLoadDone || disposed) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const loadPollById = (pollId: string): Promise<Poll | null> => {
      if (disposed || !pollId || pollId === '_' || (hydrating && seenIds.has(pollId))) return Promise.resolve(null);
      const inFlight = loading.get(pollId);
      if (inFlight) return inFlight;
      const task = this.loadPoll(pollId).finally(() => { loading.delete(pollId); });
      loading.set(pollId, task);
      return task;
    };

    const emitPoll = (poll: Poll | null) => {
      if (disposed || !poll) return;
      const createdAt = typeof poll.createdAt === 'number' ? poll.createdAt : 0;
      const isLiveDuringHydration = hydrating && createdAt > subscriptionStartTime;
      if (isLiveDuringHydration) { seenIds.add(poll.id); deferredLivePolls.set(poll.id, poll); return; }
      if (!seenIds.has(poll.id)) { seenIds.add(poll.id); onPoll(poll); return; }
      if (!hydrating) onPoll(poll);
    };

    const loadAndEmitById = (pollId: string): Promise<void> => {
      return loadPollById(pollId).then(poll => { emitPoll(poll); });
    };

    const finalizeHydration = () => {
      if (disposed || !hydrating) return;
      hydrating = false;
      checkLoadComplete();
      if (deferredLivePolls.size > 0) {
        Array.from(deferredLivePolls.values())
          .sort((a, b) => b.createdAt - a.createdAt)
          .forEach(p => onPoll(p));
        deferredLivePolls.clear();
      }
    };

    const flushHydrationIds = () => {
      return (async () => {
        const batchSize = 40;
        while (!disposed && !hardTimeoutFired) {
          const ids = Array.from(pendingHydrationIds);
          if (ids.length === 0) break;
          pendingHydrationIds.clear();
          for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            await Promise.all(batch.map(pollId => loadAndEmitById(pollId)));
          }
        }
      })();
    };

    // ── Hydration timer: 3s (was 15s) ─────────────────────────────────────────
    const hydrationTimer = setTimeout(() => {
      if (disposed || snapshotHandled) return;
      snapshotHandled = true;
      flushHydrationIds().finally(() => { finalizeHydration(); });
    }, 3000);

    // ── Hard timeout: 8s (was 30s) ────────────────────────────────────────────
    const hardTimeout = setTimeout(() => {
      if (disposed || !hydrating) return;
      hardTimeoutFired = true;
      finalizeHydration();
    }, 8000);

    subscription = pollsNode.map().on((_: any, pollId: string) => {
      if (disposed || !pollId || pollId === '_') return;
      if (hydrating) { if (!seenIds.has(pollId)) pendingHydrationIds.add(pollId); return; }
      void loadAndEmitById(pollId);
    });
    pollActiveListeners.set(listenerKey, { subscription, timer: hydrationTimer, hardTimeout });

    pollsNode.once((allPolls) => {
      if (disposed || snapshotHandled) return;
      snapshotHandled = true;
      clearTimeout(hydrationTimer);
      const keys = allPolls ? Object.keys(allPolls).filter(k => k !== '_') : [];
      keys.forEach(pollId => pendingHydrationIds.add(pollId));
      flushHydrationIds().finally(() => { finalizeHydration(); });
    });

    return () => {
      disposed = true;
      clearTimeout(hydrationTimer);
      clearTimeout(hardTimeout);
      if (subscription) subscription.off();
      pollActiveListeners.delete(listenerKey);
    };
  }

  static async createPoll(data: {
    communityId: string;
    authorId: string;
    authorName: string;
    authorShowRealName?: boolean;
    question: string;
    description?: string;
    options: string[];
    durationDays: number;
    allowMultipleChoices: boolean;
    showResultsBeforeVoting: boolean;
    requireLogin: boolean;
    isPrivate: boolean;
    inviteCodeCount?: number;
  }, preGeneratedId?: string): Promise<Poll> {
    const createStartedAt = performance.now();
    logPollDebug('create', 'createPoll entered', {
      communityId: data.communityId,
      isPrivate: data.isPrivate,
      durationDays: data.durationDays,
      optionsCount: data.options.length,
      hasDescription: Boolean(data.description?.trim()),
      inviteCodeCount: data.inviteCodeCount,
    });
    const pollId   = preGeneratedId || `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now      = Date.now();
    const expiresAt = now + data.durationDays * 86400000;

    const pollOptions: PollOption[] = data.options.map((text, idx) => ({
      id: `${pollId}-option-${idx}`, text, votes: 0, voters: [],
    }));

    const poll: Poll = {
      id: pollId, communityId: data.communityId, authorId: data.authorId,
      authorName: data.authorName, authorShowRealName: data.authorShowRealName || false,
      question: data.question, description: data.description || '', options: pollOptions,
      createdAt: now, expiresAt, allowMultipleChoices: data.allowMultipleChoices,
      showResultsBeforeVoting: data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin, isPrivate: !!data.isPrivate,
      totalVotes: 0, isExpired: false,
    };

    const optionsMap = this.buildOptionsMap(pollOptions);

    const gunPoll: Record<string, any> = {
      id: poll.id, communityId: poll.communityId, authorId: poll.authorId,
      authorName: poll.authorName, authorShowRealName: poll.authorShowRealName,
      question: poll.question, description: poll.description, createdAt: poll.createdAt,
      expiresAt: poll.expiresAt, allowMultipleChoices: poll.allowMultipleChoices,
      showResultsBeforeVoting: poll.showResultsBeforeVoting,
      requireLogin: poll.requireLogin, isPrivate: poll.isPrivate,
      totalVotes: 0, isExpired: false,
      options: optionsMap,
    };

    try {
      const { KeyService }    = await import('./keyService');
      const { CryptoService } = await import('./cryptoService');
      const keyPair    = await KeyService.getKeyPair();
      const contentHash = CryptoService.hash(JSON.stringify({ question: poll.question, communityId: poll.communityId, timestamp: poll.createdAt }));
      const signature  = CryptoService.sign(contentHash, keyPair.privateKey);
      poll.authorPubkey      = keyPair.publicKey;
      poll.contentSignature  = signature;
      gunPoll.authorPubkey = keyPair.publicKey;
      gunPoll.contentSignature = signature;
      logPollDebug('create', 'Poll signing completed', { pollId });
    } catch (err) { console.warn('Failed to sign poll:', err); }

    if (poll.communityId) {
      const storedKey = await KeyVaultService.getKey(poll.communityId);
      if (storedKey) {
        try {
          const aesKey = await EncryptionService.importKey(storedKey.key);
          const encryptableData = { question: poll.question, description: poll.description, options: poll.options, authorName: poll.authorName };
          poll.encryptedContent = await EncryptionService.encrypt(JSON.stringify(encryptableData), aesKey);
          poll.authTag          = await EncryptionService.generateAuthTag(aesKey, poll.id, String(poll.createdAt), poll.authorId);
          poll.isEncrypted      = true;
          gunPoll.question = '🔒 Encrypted Poll';
          gunPoll.description = '';
          gunPoll.encryptedContent = poll.encryptedContent;
          gunPoll.authTag = poll.authTag;
          gunPoll.isEncrypted = true;
          logPollDebug('create', 'Poll encryption completed', { pollId });
        } catch (err) { console.warn('Failed to encrypt poll:', err); }
      } else {
        logPollDebug('create', 'No encryption key for community; proceeding unencrypted', { pollId, communityId: poll.communityId });
      }
    }

    const createWriteOptions = { timeoutMs: 15000 } as const;
    const optionWriteOptions = { timeoutMs: 8000, resolveOnTimeout: true } as const;
    let pollRootWriteTimedOut = false;
    await this.putPromise(this.getPollPath(pollId), gunPoll, {
      ...createWriteOptions,
      resolveOnTimeout: true,
      label: 'poll root write',
      onTimeout: () => { pollRootWriteTimedOut = true; },
    });
    await this.putPromise(this.getPollPath(pollId).get('options'), optionsMap, { ...optionWriteOptions, label: 'poll options write' });

    const communityPolls = this.gun.get('communities').get(data.communityId).get('polls');
    let communityRootWriteTimedOut = false;
    await this.putPromise(communityPolls.get(pollId), gunPoll, {
      ...createWriteOptions,
      resolveOnTimeout: true,
      label: 'community poll write',
      onTimeout: () => { communityRootWriteTimedOut = true; },
    });
    await this.putPromise(communityPolls.get(pollId).get('options'), optionsMap, { ...optionWriteOptions, label: 'community poll options write' });
    if (pollRootWriteTimedOut || communityRootWriteTimedOut) {
      logPollDebug('create', 'Root/community write timeout detected, verifying persisted poll', { pollId });
      const createRepairDeadline = Date.now() + 45000;
      let [rootConfirmed, communityConfirmed] = await Promise.all([
        this.waitForNode<any>(this.getPollPath(pollId), (value) => Boolean(value?.id), 12000),
        this.waitForNode<any>(communityPolls.get(pollId), (value) => Boolean(value?.id), 12000),
      ]);

      if (!rootConfirmed?.id && communityConfirmed?.id) {
        logPollDebug('create', 'Community-only confirmation detected; retrying root write repair', { pollId });
      }
      for (let attempt = 1; !rootConfirmed?.id && attempt <= 3 && Date.now() < createRepairDeadline; attempt += 1) {
        const currentRoot = await this.onceNode<any>(this.getPollPath(pollId), 500);
        const rootRepairPayload = {
          ...gunPoll,
          totalVotes: typeof currentRoot?.totalVotes === 'number' ? currentRoot.totalVotes : gunPoll.totalVotes,
          isExpired: typeof currentRoot?.isExpired === 'boolean' ? currentRoot.isExpired : gunPoll.isExpired,
          options: currentRoot?.options && typeof currentRoot.options === 'object'
            ? currentRoot.options
            : gunPoll.options,
        };
        await this.putPromise(this.getPollPath(pollId), rootRepairPayload, {
          timeoutMs: 12000,
          resolveOnTimeout: true,
          label: `poll root repair write (attempt ${attempt})`,
        });
        rootConfirmed = await this.waitForNode<any>(this.getPollPath(pollId), (value) => Boolean(value?.id), 12000);
        if (!rootConfirmed?.id) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!rootConfirmed?.id) {
        throw new Error('Timed out waiting for poll root write ACK and root path could not be confirmed');
      }
      if (!communityConfirmed?.id) {
        logPollDebug('create', 'Root-only confirmation detected; retrying community write repair', { pollId });
      }
      for (let attempt = 1; !communityConfirmed?.id && attempt <= 3 && Date.now() < createRepairDeadline; attempt += 1) {
        const currentCommunity = await this.onceNode<any>(communityPolls.get(pollId), 500);
        const communityRepairPayload = {
          ...gunPoll,
          totalVotes: typeof currentCommunity?.totalVotes === 'number' ? currentCommunity.totalVotes : gunPoll.totalVotes,
          isExpired: typeof currentCommunity?.isExpired === 'boolean' ? currentCommunity.isExpired : gunPoll.isExpired,
          options: currentCommunity?.options && typeof currentCommunity.options === 'object'
            ? currentCommunity.options
            : gunPoll.options,
        };
        await this.putPromise(communityPolls.get(pollId), communityRepairPayload, {
          timeoutMs: 12000,
          resolveOnTimeout: true,
          label: `community poll repair write (attempt ${attempt})`,
        });
        communityConfirmed = await this.waitForNode<any>(communityPolls.get(pollId), (value) => Boolean(value?.id), 12000);
        if (!communityConfirmed?.id) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!communityConfirmed?.id) {
        throw new Error('Timed out waiting for community poll write ACK and community path could not be confirmed');
      }
      logPollDebug('create', 'Root write confirmed after timeout fallback', {
        pollId,
        rootConfirmed: Boolean(rootConfirmed?.id),
        communityConfirmed: Boolean(communityConfirmed?.id),
      });
    }

    if (poll.isPrivate) {
      const rawInviteCount = Number(data.inviteCodeCount);
      const safeInviteCount = Number.isFinite(rawInviteCount) ? rawInviteCount : 20;
      const inviteCount = Math.max(1, Math.min(200, Math.trunc(safeInviteCount)));
      const inviteCodes = this.generateInviteCodes(inviteCount);
      const codesMap: Record<string, any> = {};
      inviteCodes.forEach((code, i) => { codesMap[i] = { code, used: false }; });
      const inviteCodesWriteOptions = { ...createWriteOptions, resolveOnTimeout: true } as const;
      const countStoredInviteCodes = (value: any): number => {
        if (!value || typeof value !== 'object') return 0;
        return Object.entries(value).filter(([key, entry]) => (
          key !== '_' && Boolean(entry && typeof entry === 'object' && typeof (entry as Record<string, any>).code === 'string')
        )).length;
      };
      const inviteCodesListDeadline = Date.now() + 30000;
      let listConfirmed = false;
      for (let attempt = 1; attempt <= 3 && !listConfirmed && Date.now() < inviteCodesListDeadline; attempt += 1) {
        await Promise.all([
          this.putPromise(this.getPollPath(pollId).get('inviteCodes'), codesMap, { ...inviteCodesWriteOptions, label: `invite codes write (attempt ${attempt})` }),
          this.putPromise(communityPolls.get(pollId).get('inviteCodes'), codesMap, { ...inviteCodesWriteOptions, label: `community invite codes write (attempt ${attempt})` }),
        ]);
        const [rootList, communityList] = await Promise.all([
          this.onceNode<any>(this.getPollPath(pollId).get('inviteCodes'), 1200),
          this.onceNode<any>(communityPolls.get(pollId).get('inviteCodes'), 1200),
        ]);
        const rootCount = countStoredInviteCodes(rootList);
        const communityCount = countStoredInviteCodes(communityList);
        listConfirmed = rootCount >= inviteCodes.length && communityCount >= inviteCodes.length;
        if (!listConfirmed) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (!listConfirmed) {
        throw new Error('Timed out persisting invite code list');
      }
      const mainByCode      = this.getPollPath(pollId).get('inviteCodesByCode');
      const communityByCode = communityPolls.get(pollId).get('inviteCodesByCode');
      const byCodeWriteOptions = { timeoutMs: 4000, resolveOnTimeout: true } as const;
      const byCodeWriteDeadline = Date.now() + 45000;
      const byCodeChunkSize = 20;
      const normalizedCodes = inviteCodes.map((code) => code.trim().toUpperCase()).filter(Boolean);
      for (let start = 0; start < normalizedCodes.length; start += byCodeChunkSize) {
        let pendingCodes = normalizedCodes.slice(start, start + byCodeChunkSize);
        for (let attempt = 1; pendingCodes.length > 0 && attempt <= 3 && Date.now() < byCodeWriteDeadline; attempt += 1) {
          await Promise.all(
            pendingCodes.flatMap((codeKey) => ([
              this.putPromise(mainByCode.get(codeKey), { used: false }, { ...byCodeWriteOptions, label: `invite by-code write (${codeKey})` }),
              this.putPromise(communityByCode.get(codeKey), { used: false }, { ...byCodeWriteOptions, label: `community invite by-code write (${codeKey})` }),
            ])),
          );

          const checks = await Promise.all(
            pendingCodes.map(async (codeKey) => {
              const [mainEntry, communityEntry] = await Promise.all([
                this.onceNode<any>(mainByCode.get(codeKey), 800),
                this.onceNode<any>(communityByCode.get(codeKey), 800),
              ]);
              const mainOk = Boolean(mainEntry && typeof mainEntry === 'object');
              const communityOk = Boolean(communityEntry && typeof communityEntry === 'object');
              return { codeKey, ok: mainOk && communityOk };
            }),
          );
          pendingCodes = checks.filter((item) => !item.ok).map((item) => item.codeKey);
          if (pendingCodes.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        if (pendingCodes.length > 0) {
          throw new Error(`Timed out persisting invite by-code entries (${pendingCodes.length} remaining)`);
        }
      }
      (poll as any).inviteCodes = inviteCodes;
      logPollDebug('create', 'Private invite codes generated', { pollId, inviteCount });
    }

    void indexForSearch('poll', poll.id, {
      question: poll.question, description: poll.description || '',
      authorName: poll.authorName, communitySlug: poll.communityId, createdAt: poll.createdAt
    });

    logPollDebug('create', 'createPoll completed', {
      pollId,
      durationMs: Math.round(performance.now() - createStartedAt),
    });
    await this.saveLocalPollBackup(poll);
    return poll;
  }

  // ── Canonical poll read: Gun/local only (never API vote ingestion) ───────────
  static async loadPoll(pollId: string): Promise<Poll | null> {
    return this.loadPollFromGun(pollId, false);
  }

  // ── UX fallback read: Gun first, then metadata-only API shell ─────────────────
  static async loadPollWithApiFallback(pollId: string): Promise<Poll | null> {
    const gunPoll = await this.loadPollFromGun(pollId, true);
    if (gunPoll) {
      return gunPoll;
    }
    const { pollData: apiData, options: apiOptions } = await this.loadPollFromAPI(pollId);
    return this.buildPollRecord(apiData, apiOptions);
  }

  static async loadPollOptions(pollId: string, allowApiFallback = true, parentPollData?: any): Promise<PollOption[]> {
    const optionsNode = this.getPollPath(pollId).get('options');
    const optionsData = await this.onceNode<any>(optionsNode, 300);
    const parsed      = this.parsePollOptions(optionsData);
    if (parsed.length > 0) return parsed;

    const liveOptions = await this.waitForNode<any>(
      optionsNode, (value) => this.parsePollOptions(value).length > 0, 1500,
    );
    const liveParsed = this.parsePollOptions(liveOptions);
    if (liveParsed.length > 0) return liveParsed;

    // Root poll writes now redundantly include an inline options map.
    // Use it only after giving the dedicated options child path time to hydrate.
    const inlineParsed = this.parsePollOptions(parentPollData?.options);
    if (inlineParsed.length > 0) return inlineParsed;

    // Last resort (read-only): use API option labels/ids only; keep vote totals at zero.
    // Never write these fallback options into Gun or they can clobber real counts.
    if (allowApiFallback) {
      const fallback = await this.loadPollFromAPI(pollId);
      if (fallback.options.length > 0) {
        return fallback.options;
      }
    }
    return [];
  }

  private static async loadCommunityPollOptions(communityId: string, pollId: string): Promise<PollOption[]> {
    if (!communityId) return [];
    const optionsNode = this.getCommunityPollPath(communityId, pollId).get('options');
    const optionsData = await this.onceNode<any>(optionsNode, 300);
    const parsed = this.parsePollOptions(optionsData);
    if (parsed.length > 0) return parsed;

    const liveOptions = await this.waitForNode<any>(
      optionsNode, (value) => this.parsePollOptions(value).length > 0, 1500,
    );
    return this.parsePollOptions(liveOptions);
  }

  static async vote(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    // Voting must use Gun-backed state to avoid API bounce-back or stale zero baselines.
    const poll = await this.loadPollFromGun(pollId, false, false);
    if (!poll) throw new Error('Poll not found');
    if (poll.isExpired) throw new Error('Poll has expired');
    const selectedOptions = poll.options.filter(opt => optionIds.includes(opt.id));
    if (selectedOptions.length === 0) throw new Error('No valid options selected');
    if (!poll.allowMultipleChoices && selectedOptions.length > 1) throw new Error('Multiple choices not allowed');
    const confirmedOptionIds = selectedOptions.map((option) => option.id);
    const applyVoteToOptions = (baseOptions: PollOption[]): PollOption[] => baseOptions.map((option) => {
      if (!confirmedOptionIds.includes(option.id) || option.voters.includes(voterId)) {
        return option;
      }

      return {
        ...option,
        votes: (option.votes || 0) + 1,
        voters: [...option.voters, voterId],
      };
    });
    const updatedOptions = applyVoteToOptions(poll.options);
    const totalVotes = updatedOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0);
    const optionsMap = this.buildOptionsMap(updatedOptions);
    const pollPatch = { totalVotes };
    const voteWriteOptions = { timeoutMs: 12000, resolveOnTimeout: true } as const;
    await Promise.all([
      this.putPromise(this.getPollPath(pollId).get('options'), optionsMap, { ...voteWriteOptions, label: 'vote root options write' }),
      this.putPromise(this.getPollPath(pollId), pollPatch, { ...voteWriteOptions, label: 'vote root patch write' }),
      poll.communityId
        ? this.putPromise(this.getCommunityPollPath(poll.communityId, pollId).get('options'), optionsMap, { ...voteWriteOptions, label: 'vote community options write' })
        : Promise.resolve(),
      poll.communityId
        ? this.putPromise(this.getCommunityPollPath(poll.communityId, pollId), pollPatch, { ...voteWriteOptions, label: 'vote community patch write' })
        : Promise.resolve(),
    ]);

    const isVoteApplied = (optionsData: any) => {
      const parsed = this.parsePollOptions(optionsData);
      if (parsed.length === 0) return false;
      return confirmedOptionIds.every((optionId) => parsed.some((opt) => opt.id === optionId && opt.voters.includes(voterId)));
    };
    const voteRetryDeadline = Date.now() + 30000;
    let rootVoteConfirmed = await this.waitForNode<any>(
      this.getPollPath(pollId).get('options'),
      (value) => isVoteApplied(value),
      10000,
    );
    for (let attempt = 1; !isVoteApplied(rootVoteConfirmed) && attempt <= 3 && Date.now() < voteRetryDeadline; attempt += 1) {
      const latestRootOptions = await this.loadPollOptions(pollId, false);
      const retryRootOptions = applyVoteToOptions(latestRootOptions.length > 0 ? latestRootOptions : updatedOptions);
      const retryRootOptionsMap = this.buildOptionsMap(retryRootOptions);
      const retryRootPatch = { totalVotes: retryRootOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0) };
      await this.putPromise(this.getPollPath(pollId).get('options'), retryRootOptionsMap, {
        ...voteWriteOptions,
        label: `vote root options retry write (attempt ${attempt})`,
      });
      await this.putPromise(this.getPollPath(pollId), retryRootPatch, {
        ...voteWriteOptions,
        label: `vote root patch retry write (attempt ${attempt})`,
      });
      rootVoteConfirmed = await this.waitForNode<any>(
        this.getPollPath(pollId).get('options'),
        (value) => isVoteApplied(value),
        10000,
      );
      if (!isVoteApplied(rootVoteConfirmed)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!isVoteApplied(rootVoteConfirmed)) {
      throw new Error('Vote write could not be confirmed on root poll options');
    }

    if (poll.communityId) {
      void (async () => {
        let communityVoteConfirmed = await this.waitForNode<any>(
          this.getCommunityPollPath(poll.communityId, pollId).get('options'),
          (value) => isVoteApplied(value),
          10000,
        );
        for (let attempt = 1; !isVoteApplied(communityVoteConfirmed) && attempt <= 3 && Date.now() < voteRetryDeadline; attempt += 1) {
          const latestCommunityOptions = await this.loadCommunityPollOptions(poll.communityId, pollId);
          const retryCommunityOptions = applyVoteToOptions(latestCommunityOptions.length > 0 ? latestCommunityOptions : updatedOptions);
          const retryCommunityOptionsMap = this.buildOptionsMap(retryCommunityOptions);
          const retryCommunityPatch = { totalVotes: retryCommunityOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0) };
          await this.putPromise(this.getCommunityPollPath(poll.communityId, pollId).get('options'), retryCommunityOptionsMap, {
            ...voteWriteOptions,
            label: `vote community options retry write (attempt ${attempt})`,
          });
          await this.putPromise(this.getCommunityPollPath(poll.communityId, pollId), retryCommunityPatch, {
            ...voteWriteOptions,
            label: `vote community patch retry write (attempt ${attempt})`,
          });
          communityVoteConfirmed = await this.waitForNode<any>(
            this.getCommunityPollPath(poll.communityId, pollId).get('options'),
            (value) => isVoteApplied(value),
            10000,
          );
          if (!isVoteApplied(communityVoteConfirmed)) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
        if (!isVoteApplied(communityVoteConfirmed)) {
          console.warn('[PollService] Vote root confirmation succeeded, but community vote path is still lagging');
        }
      })().catch((error) => {
        console.warn('[PollService] Community vote reconciliation failed:', error);
      });
    }
    await this.saveLocalPollBackup({
      ...poll,
      options: updatedOptions,
      totalVotes,
      isExpired: Date.now() > (poll.expiresAt || 0),
    });
  }

  static async voteOnPoll(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    return this.vote(pollId, optionIds, voterId);
  }

  static async getInviteCodes(pollId: string): Promise<{ code: string; used: boolean }[]> {
    const codesNode = this.getPollPath(pollId).get('inviteCodes');
    const data      = await this.onceNode<any>(codesNode, 2000);
    if (!data) return [];
    const now = Date.now();
    return Object.keys(data)
      .filter(k => k !== '_')
      .map(k => ({ code: data[k].code, used: Boolean(data[k].used || (data[k].reservedUntil && Number(data[k].reservedUntil) > now)) }))
      .filter(c => c.code);
  }

  static async validateInviteCode(pollId: string, rawCode: string): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new Error('Invite code is required');

    const byCodeNode = this.getPollPath(pollId).get('inviteCodesByCode').get(encodeURIComponent(code));
    const codeState = await this.onceNode<any>(byCodeNode, 1500);
    if (!codeState) throw new Error('Invalid invite code');
    if (codeState.used) throw new Error('Invite code already used');
    if (codeState.reservedUntil && Number(codeState.reservedUntil) > Date.now()) {
      throw new Error('Invite code is currently reserved by another voter');
    }
  }

  static async consumeInviteCode(pollId: string, rawCode: string): Promise<string> {
    const code = rawCode.trim().toUpperCase();
    if (!code) throw new Error('Invite code is required');

    const poll = await this.loadPoll(pollId);
    if (!poll) throw new Error('Poll not found');

    const codeKey = encodeURIComponent(code);
    const byCodeNode = this.getPollPath(pollId).get('inviteCodesByCode').get(codeKey);
    const communityByCodeNode = poll.communityId
      ? this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodesByCode').get(codeKey)
      : null;

    const inviteCodes = await this.getInviteCodes(pollId);
    const matchingIndex = inviteCodes.findIndex((entry) => entry.code.trim().toUpperCase() === code);
    if (matchingIndex === -1) throw new Error('Invalid invite code');

    const currentState = await this.onceNode<any>(byCodeNode, 1500);
    if (!currentState) throw new Error('Invalid invite code');
    if (currentState.used) throw new Error('Invite code already used');
    if (currentState.reservedUntil && Number(currentState.reservedUntil) > Date.now()) {
      throw new Error('Invite code is currently reserved by another voter');
    }

    const reservationId = `invite-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const reservedUntil = Date.now() + 30000;
    const listEntry = { code, used: false, reservedUntil };
    const mainCodesNode = this.getPollPath(pollId).get('inviteCodes').get(String(matchingIndex));
    const updates: Promise<void>[] = [
      this.putPromise(byCodeNode, { code, used: false, reservedBy: reservationId, reservedUntil }),
      this.putPromise(mainCodesNode, listEntry),
    ];

    if (communityByCodeNode && poll.communityId) {
      updates.push(this.putPromise(communityByCodeNode, { code, used: false, reservedBy: reservationId, reservedUntil }));
      updates.push(
        this.putPromise(
          this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodes').get(String(matchingIndex)),
          listEntry,
        ),
      );
    }

    await Promise.all(updates);
    const confirmedState = await this.onceNode<any>(byCodeNode, 1500);
    if (confirmedState?.used || confirmedState?.reservedBy !== reservationId) {
      throw new Error('Invite code was claimed by another voter');
    }
    return reservationId;
  }

  static async finalizeInviteCode(pollId: string, rawCode: string, reservationId: string): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (!code || !reservationId) return;

    const poll = await this.loadPoll(pollId);
    if (!poll) return;

    const codeKey = encodeURIComponent(code);
    const byCodeNode = this.getPollPath(pollId).get('inviteCodesByCode').get(codeKey);
    const communityByCodeNode = poll.communityId
      ? this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodesByCode').get(codeKey)
      : null;

    const currentState = await this.onceNode<any>(byCodeNode, 1500);
    if (!currentState) return;
    if (currentState.used) return;
    if (currentState.reservedBy !== reservationId) {
      throw new Error('Invite code reservation no longer belongs to this vote');
    }

    const inviteCodes = await this.getInviteCodes(pollId);
    const matchingIndex = inviteCodes.findIndex((entry) => entry.code.trim().toUpperCase() === code);
    if (matchingIndex === -1) return;

    const listEntry = { code, used: true, reservedUntil: null };
    const updates: Promise<void>[] = [
      this.putPromise(byCodeNode, { code, used: true, usedAt: Date.now(), reservedBy: null, reservedUntil: null }),
      this.putPromise(this.getPollPath(pollId).get('inviteCodes').get(String(matchingIndex)), listEntry),
    ];

    if (communityByCodeNode && poll.communityId) {
      updates.push(this.putPromise(communityByCodeNode, { code, used: true, usedAt: Date.now(), reservedBy: null, reservedUntil: null }));
      updates.push(
        this.putPromise(
          this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodes').get(String(matchingIndex)),
          listEntry,
        ),
      );
    }

    await Promise.all(updates);
  }

  private static loadPendingInviteFinalizations(): PendingInviteFinalization[] {
    try {
      const raw = localStorage.getItem(PENDING_INVITE_FINALIZATIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is PendingInviteFinalization => (
        entry &&
        typeof entry.pollId === 'string' &&
        typeof entry.code === 'string' &&
        typeof entry.reservationId === 'string'
      ));
    } catch {
      return [];
    }
  }

  private static savePendingInviteFinalizations(entries: PendingInviteFinalization[]): void {
    if (entries.length === 0) {
      localStorage.removeItem(PENDING_INVITE_FINALIZATIONS_KEY);
      return;
    }
    localStorage.setItem(PENDING_INVITE_FINALIZATIONS_KEY, JSON.stringify(entries));
  }

  static queueInviteCodeFinalization(pollId: string, rawCode: string, reservationId: string): void {
    const code = rawCode.trim().toUpperCase();
    if (!pollId || !code || !reservationId) return;

    const pending = this.loadPendingInviteFinalizations();
    if (pending.some((entry) => (
      entry.pollId === pollId &&
      entry.code === code &&
      entry.reservationId === reservationId
    ))) {
      return;
    }

    pending.push({ pollId, code, reservationId });
    this.savePendingInviteFinalizations(pending);
  }

  static async flushPendingInviteCodeFinalizations(): Promise<void> {
    const pending = this.loadPendingInviteFinalizations();
    if (pending.length === 0) return;

    const remaining: PendingInviteFinalization[] = [];

    for (const entry of pending) {
      try {
        await this.finalizeInviteCode(entry.pollId, entry.code, entry.reservationId);
      } catch (error) {
        console.warn('Failed to finalize queued invite code reservation:', error);
        remaining.push(entry);
      }
    }

    this.savePendingInviteFinalizations(remaining);
  }

  static async releaseInviteCode(pollId: string, rawCode: string, reservationId?: string): Promise<void> {
    const code = rawCode.trim().toUpperCase();
    if (!code) return;

    const poll = await this.loadPoll(pollId);
    if (!poll) return;

    const codeKey = encodeURIComponent(code);
    const byCodeNode = this.getPollPath(pollId).get('inviteCodesByCode').get(codeKey);
    const communityByCodeNode = poll.communityId
      ? this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodesByCode').get(codeKey)
      : null;

    const currentState = await this.onceNode<any>(byCodeNode, 1500);
    if (!currentState || currentState.used) return;
    if (reservationId && currentState.reservedBy && currentState.reservedBy !== reservationId) return;

    const inviteCodes = await this.getInviteCodes(pollId);
    const matchingIndex = inviteCodes.findIndex((entry) => entry.code.trim().toUpperCase() === code);
    if (matchingIndex === -1) return;

    const listEntry = { code, used: false, reservedUntil: null };
    const updates: Promise<void>[] = [
      this.putPromise(byCodeNode, { code, used: false, reservedBy: null, reservedUntil: null }),
      this.putPromise(this.getPollPath(pollId).get('inviteCodes').get(String(matchingIndex)), listEntry),
    ];

    if (communityByCodeNode && poll.communityId) {
      updates.push(this.putPromise(communityByCodeNode, { code, used: false, reservedBy: null, reservedUntil: null }));
      updates.push(
        this.putPromise(
          this.getCommunityPollPath(poll.communityId, pollId).get('inviteCodes').get(String(matchingIndex)),
          listEntry,
        ),
      );
    }

    await Promise.all(updates);
  }

  static async deletePoll(pollId: string, communityId: string): Promise<void> {
    await this.putPromise(this.getPollPath(pollId), null);
    await this.putPromise(this.getCommunityPollPath(communityId, pollId), null);
    await this.removeLocalPollBackup(pollId);
  }

  private static generateInviteCodes(count: number): string[] {
    const codes: string[] = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < count; i++) {
      let code = '';
      for (let j = 0; j < 8; j++) code += chars[Math.floor(Math.random() * chars.length)];
      codes.push(code);
    }
    return codes;
  }

  private static putPromise(
    node: any,
    data: any,
    options: { timeoutMs?: number; resolveOnTimeout?: boolean; label?: string; onTimeout?: () => void } = {},
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeoutMs ?? 8000;
      const resolveOnTimeout = options.resolveOnTimeout === true;
      const label = options.label || 'Gun write';
      const startedAt = performance.now();
      logPollDebug('writes', 'Write started', { label, timeoutMs });
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const timeoutError = new Error(`Timed out waiting for ${label} ACK`);
        options.onTimeout?.();
        logPollDebug('writes', 'Write timeout', {
          label,
          timeoutMs,
          resolveOnTimeout,
          durationMs: Math.round(performance.now() - startedAt),
        });
        if (resolveOnTimeout) {
          resolve();
          return;
        }
        reject(timeoutError);
      }, timeoutMs);
      node.put(data, (ack: any) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ack?.err) {
          logPollDebug('writes', 'Write ack error', {
            label,
            error: ack.err,
            durationMs: Math.round(performance.now() - startedAt),
          });
          reject(new Error(ack.err));
        } else {
          logPollDebug('writes', 'Write ack success', {
            label,
            durationMs: Math.round(performance.now() - startedAt),
          });
          resolve();
        }
      });
    });
  }

  static unsubscribeAll(): void {
    pollActiveListeners.forEach(({ subscription, timer, hardTimeout }) => {
      clearTimeout(timer);
      clearTimeout(hardTimeout);
      if (subscription) subscription.off();
    });
    pollActiveListeners.clear();
  }

  static async decryptPoll(poll: Poll): Promise<Poll> {
    if (!poll.isEncrypted || !poll.encryptedContent) return poll;
    const storedKey = await KeyVaultService.getKey(poll.communityId);
    if (!storedKey) return poll;
    try {
      const aesKey   = await EncryptionService.importKey(storedKey.key);
      if (poll.authTag) {
        const valid = await EncryptionService.verifyAuthTag(aesKey, poll.authTag, poll.id, String(poll.createdAt), poll.authorId);
        if (!valid) return poll;
      }
      const decrypted = JSON.parse(await EncryptionService.decrypt(poll.encryptedContent, aesKey));
      return {
        ...poll,
        question:    decrypted.question    || poll.question,
        description: decrypted.description || poll.description,
        options:     decrypted.options     || poll.options,
        authorName:  decrypted.authorName  || poll.authorName,
      };
    } catch { return poll; }
  }
}
