import { GunService } from './gunService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import config from '../config';

const API_URL = 'https://interpoll.endless.sbs';

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

async function indexForSearch(type: 'post' | 'poll', id: string, data: any) {
  try {
    await fetch(`${API_URL}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type, id, data })
    });
  } catch (err) {
    console.warn('Search indexing failed:', err);
  }
}

export class PollService {
  private static get gun() { return GunService.getGun(); }
  private static getPollPath(pollId: string) { return this.gun.get('polls').get(pollId); }
  private static getCommunityPollPath(communityId: string, pollId: string) {
    return this.gun.get('communities').get(communityId).get('polls').get(pollId);
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
        options.push({ id: opt.id, text: opt.text || '', votes: opt.votes || 0, voters: opt.voters || [] });
      }
    });
    return options;
  }

  private static buildOptionsMap(options: PollOption[]): Record<string, any> {
    return Object.fromEntries(options.map((option, index) => [index, {
      id: option.id, text: option.text, votes: option.votes || 0, voters: option.voters || [],
    }]));
  }

  // ── API-first poll fetch (replaces Gun-first approach) ───────────────────────
  private static async loadPollFromAPI(pollId: string): Promise<{ pollData: any | null; options: PollOption[] }> {
    try {
      const res = await fetch(`${API_URL}/api/poll/${pollId}`, {
        headers: { 'Cache-Control': 'stale-while-revalidate=30' },
      });
      if (!res.ok) return { pollData: null, options: [] };
      const data = await res.json();
      if (!data?.id) return { pollData: null, options: [] };
      const options: PollOption[] = (data.options || []).map((o: any) => ({
        id: o.id, text: o.text || '', votes: o.votes || 0, voters: [],
      }));
      return { pollData: data, options };
    } catch (error) {
      console.warn('Poll API fetch failed:', error);
      return { pollData: null, options: [] };
    }
  }

  private static warmPollCache(pollData: any, optionsData?: any) {
    if (!pollData?.id) return;
    const pollNode = this.getPollPath(pollData.id);
    pollNode.put(pollData);
    if (optionsData && typeof optionsData === 'object') {
      pollNode.get('options').put(optionsData);
    }
    if (pollData.communityId) {
      const communityNode = this.getCommunityPollPath(pollData.communityId, pollData.id);
      communityNode.put(pollData);
      if (optionsData && typeof optionsData === 'object') {
        communityNode.get('options').put(optionsData);
      }
    }
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
      const task = this.loadPoll(pollId).finally(() => { loading.delete(pollId); });
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

    const gunPoll = {
      id: poll.id, communityId: poll.communityId, authorId: poll.authorId,
      authorName: poll.authorName, authorShowRealName: poll.authorShowRealName,
      question: poll.question, description: poll.description, createdAt: poll.createdAt,
      expiresAt: poll.expiresAt, allowMultipleChoices: poll.allowMultipleChoices,
      showResultsBeforeVoting: poll.showResultsBeforeVoting,
      requireLogin: poll.requireLogin, isPrivate: poll.isPrivate,
      totalVotes: 0, isExpired: false,
    };

    const optionsMap: Record<string, any> = {};
    pollOptions.forEach((opt, i) => { optionsMap[i] = { id: opt.id, text: opt.text, votes: 0 }; });

    try {
      const { KeyService }    = await import('./keyService');
      const { CryptoService } = await import('./cryptoService');
      const keyPair    = await KeyService.getKeyPair();
      const contentHash = CryptoService.hash(JSON.stringify({ question: poll.question, communityId: poll.communityId, timestamp: poll.createdAt }));
      const signature  = CryptoService.sign(contentHash, keyPair.privateKey);
      poll.authorPubkey      = keyPair.publicKey;
      poll.contentSignature  = signature;
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
        } catch (err) { console.warn('Failed to encrypt poll:', err); }
      }
    }

    await this.putPromise(this.getPollPath(pollId), gunPoll);
    await this.putPromise(this.getPollPath(pollId).get('options'), optionsMap);

    const communityPolls = this.gun.get('communities').get(data.communityId).get('polls');
    await this.putPromise(communityPolls.get(pollId), gunPoll);
    await this.putPromise(communityPolls.get(pollId).get('options'), optionsMap);

    if (poll.isEncrypted && poll.encryptedContent) {
      const node = this.getPollPath(pollId);
      node.get('question').put('🔒 Encrypted Poll');
      node.get('description').put('');
      node.get('encryptedContent').put(poll.encryptedContent);
      node.get('authTag').put(poll.authTag);
      node.get('isEncrypted').put(true);
      if (poll.authorPubkey)     node.get('authorPubkey').put(poll.authorPubkey);
      if (poll.contentSignature) node.get('contentSignature').put(poll.contentSignature);
    }

    if (poll.isPrivate) {
      const inviteCount = Math.max(1, Math.min(200, Number(data.inviteCodeCount ?? 20)));
      const inviteCodes = this.generateInviteCodes(inviteCount);
      const codesMap: Record<string, any> = {};
      inviteCodes.forEach((code, i) => { codesMap[i] = { code, used: false }; });
      await this.putPromise(this.getPollPath(pollId).get('inviteCodes'), codesMap);
      await this.putPromise(communityPolls.get(pollId).get('inviteCodes'), codesMap);
      const mainByCode      = this.getPollPath(pollId).get('inviteCodesByCode');
      const communityByCode = communityPolls.get(pollId).get('inviteCodesByCode');
      for (const rawCode of inviteCodes) {
        const codeKey = rawCode.trim().toUpperCase();
        await Promise.all([
          this.putPromise(mainByCode.get(codeKey), { used: false }),
          this.putPromise(communityByCode.get(codeKey), { used: false }),
        ]);
      }
      (poll as any).inviteCodes = inviteCodes;
    }

    await indexForSearch('poll', poll.id, {
      question: poll.question, description: poll.description || '',
      authorName: poll.authorName, communitySlug: poll.communityId, createdAt: poll.createdAt
    });

    return poll;
  }

  // ── API-first loadPoll: try REST first, Gun only as fallback ─────────────────
  static async loadPoll(pollId: string): Promise<Poll | null> {
    // 1. Try REST API first — fast and always fresh
    const { pollData: apiData, options: apiOptions } = await this.loadPollFromAPI(pollId);
    if (apiData?.id && apiOptions.length > 0) {
      const totalVotes = apiOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0);
      return {
        id: apiData.id, communityId: apiData.communityId || '',
        authorId: apiData.authorId || '', authorName: apiData.authorName || 'Anonymous',
        question: apiData.question || '', description: apiData.description || '',
        options: apiOptions, createdAt: apiData.createdAt || Date.now(),
        expiresAt: apiData.expiresAt || 0,
        allowMultipleChoices: !!apiData.allowMultipleChoices,
        showResultsBeforeVoting: !!apiData.showResultsBeforeVoting,
        requireLogin: !!apiData.requireLogin, isPrivate: !!apiData.isPrivate,
        totalVotes, isExpired: Date.now() > (apiData.expiresAt || 0),
        isEncrypted: apiData.isEncrypted || false,
        encryptedContent: apiData.encryptedContent || undefined,
        authTag: apiData.authTag || undefined,
        authorPubkey: apiData.authorPubkey || undefined,
        contentSignature: apiData.contentSignature || undefined,
      };
    }

    // 2. Fallback to Gun (new polls not yet in API, or API down)
    const pollNode = this.getPollPath(pollId);
    let pollData   = await this.onceNode<any>(pollNode, 300);
    if (!pollData?.id) {
      pollData = await this.waitForNode<any>(pollNode, (value) => !!value?.id, 1500);
    }
    if (!pollData?.id) return null;

    const options    = await this.loadPollOptions(pollId);
    const totalVotes = options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
    const isExpired  = Date.now() > (pollData.expiresAt || 0);

    return {
      id: pollData.id, communityId: pollData.communityId || '',
      authorId: pollData.authorId || '', authorName: pollData.authorName || 'Anonymous',
      question: pollData.question || '', description: pollData.description || '',
      options, createdAt: pollData.createdAt || Date.now(), expiresAt: pollData.expiresAt || 0,
      allowMultipleChoices: !!pollData.allowMultipleChoices,
      showResultsBeforeVoting: !!pollData.showResultsBeforeVoting,
      requireLogin: !!pollData.requireLogin, isPrivate: !!pollData.isPrivate,
      totalVotes, isExpired,
      isEncrypted: pollData.isEncrypted || false,
      encryptedContent: pollData.encryptedContent || undefined,
      authTag: pollData.authTag || undefined,
      authorPubkey: pollData.authorPubkey || undefined,
      contentSignature: pollData.contentSignature || undefined,
    };
  }

  static async loadPollOptions(pollId: string): Promise<PollOption[]> {
    const optionsNode = this.getPollPath(pollId).get('options');
    const optionsData = await this.onceNode<any>(optionsNode, 300);
    const parsed      = this.parsePollOptions(optionsData);
    if (parsed.length > 0) return parsed;

    const liveOptions = await this.waitForNode<any>(
      optionsNode, (value) => this.parsePollOptions(value).length > 0, 1500,
    );
    const liveParsed = this.parsePollOptions(liveOptions);
    if (liveParsed.length > 0) return liveParsed;

    // Last resort: try the API for options only
    const fallback = await this.loadPollFromAPI(pollId);
    if (fallback.options.length > 0) {
      optionsNode.put(this.buildOptionsMap(fallback.options));
      return fallback.options;
    }
    return [];
  }

  static async vote(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    const poll = await this.loadPoll(pollId);
    if (!poll) throw new Error('Poll not found');
    if (poll.isExpired) throw new Error('Poll has expired');
    const selectedOptions = poll.options.filter(opt => optionIds.includes(opt.id));
    if (selectedOptions.length === 0) throw new Error('No valid options selected');
    if (!poll.allowMultipleChoices && selectedOptions.length > 1) throw new Error('Multiple choices not allowed');
    for (const option of selectedOptions) {
      if (!option.voters.includes(voterId)) {
        await this.putPromise(
          this.getPollPath(pollId).get('options').get(option.id),
          { votes: (option.votes || 0) + 1, voters: [...option.voters, voterId] }
        );
      }
    }
    const updatedOptions = await this.loadPollOptions(pollId);
    const totalVotes     = updatedOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0);
    await this.putPromise(this.getPollPath(pollId), { totalVotes });
  }

  static async voteOnPoll(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    return this.vote(pollId, optionIds, voterId);
  }

  static async getInviteCodes(pollId: string): Promise<{ code: string; used: boolean }[]> {
    const codesNode = this.getPollPath(pollId).get('inviteCodes');
    const data      = await this.onceNode<any>(codesNode, 2000);
    if (!data) return [];
    return Object.keys(data)
      .filter(k => k !== '_')
      .map(k => ({ code: data[k].code, used: data[k].used || false }))
      .filter(c => c.code);
  }

  static async deletePoll(pollId: string, communityId: string): Promise<void> {
    await this.putPromise(this.getPollPath(pollId), null);
    await this.putPromise(this.getCommunityPollPath(communityId, pollId), null);
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

  private static putPromise(node: any, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      node.put(data, (ack: any) => {
        if (ack.err) reject(new Error(ack.err)); else resolve();
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