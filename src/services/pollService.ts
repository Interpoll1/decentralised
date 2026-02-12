// src/services/pollService.ts
//
// Same time-box fix as postService.
// INITIAL_LOAD_MS = 1200ms for polls (slightly longer than posts because
// each poll triggers an async loadPollOptions() call in phase 2, and we
// want most options loaded before signaling done).

import { GunService } from './gunService';

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
}

const pollActiveListeners = new Map<string, any>();

export class PollService {
  private static get gun() { return GunService.getGun(); }
  private static getPollPath(pollId: string) { return this.gun.get('polls').get(pollId); }
  private static getCommunityPollPath(communityId: string, pollId: string) {
    return this.gun.get('communities').get(communityId).get('polls').get(pollId);
  }

  // ─── Subscribe ────────────────────────────────────────────────────────────

  /**
   * Two-phase subscription with hard time-box:
   *
   * Phase 1: deliver poll shell (no options) immediately as Gun fires metadata.
   *          onInitialLoadDone fires after INITIAL_LOAD_MS (1200ms) hard cap —
   *          NOT when Gun goes quiet. This means empty communities cost 1200ms
   *          instead of 16s.
   *
   * Phase 2: loadPollOptions() runs per-poll in background, calls onPollUpdated
   *          to patch vote counts in-place. Happens after initial load resolves.
   */
  static subscribeToPollsInCommunity(
    communityId: string,
    onPoll: (poll: Poll) => void,
    onInitialLoadDone?: () => void,
    onPollUpdated?: (poll: Poll) => void,
  ): () => void {
    const seen = new Set<string>();

    const existing = pollActiveListeners.get(communityId);
    if (existing) {
      existing.off();
      pollActiveListeners.delete(communityId);
    }

    let initialDone = false;
    const signalDone = () => {
      if (initialDone) return;
      initialDone = true;
      onInitialLoadDone?.();
    };

    const listener = this.gun
      .get('communities')
      .get(communityId)
      .get('polls')
      .map()
      .on((data: any, key: string) => {
        if (!data?.id || !data?.question || seen.has(data.id) || key.startsWith('_')) return;
        seen.add(data.id);

        // Phase 1: deliver shell immediately
        const shell: Poll = {
          ...this.mapPollMetadata(data, communityId),
          options: [],
          isExpired: Date.now() > (data.expiresAt ?? 0),
        };
        onPoll(shell);

        // Phase 2: load options in background, patch when ready
        this.loadPollOptions(data.id, communityId).then((options) => {
          if (!options || options.length === 0) return;
          (onPollUpdated ?? onPoll)({ ...shell, options });
        });
      });

    // Hard time-box — resolve after 1200ms regardless
    const initTimer = setTimeout(signalDone, 1200);

    pollActiveListeners.set(communityId, listener);

    return () => {
      clearTimeout(initTimer);
      signalDone();
      if (listener) listener.off();
      pollActiveListeners.delete(communityId);
    };
  }

  /** @deprecated use subscribeToPollsInCommunity */
  static getAllPollsInCommunity(communityId: string): Promise<Poll[]> {
    return new Promise((resolve) => {
      const polls = new Map<string, Poll>();
      const unsub = this.subscribeToPollsInCommunity(
        communityId,
        (poll) => polls.set(poll.id, poll),
        () => { unsub(); resolve(Array.from(polls.values())); },
        (poll) => polls.set(poll.id, poll),
      );
    });
  }

  static async getPollById(pollId: string): Promise<Poll | null> {
    return new Promise<Poll | null>((resolve) => {
      let resolved = false;
      this.getPollPath(pollId).once(async (data: any) => {
        if (resolved) return;
        if (!data?.id || !data?.question) { resolved = true; resolve(null); return; }
        resolved = true;
        const communityId = data.communityId || (await this.getCommunityId(pollId));
        const options = await this.loadPollOptions(pollId, communityId);
        resolve({
          ...this.mapPollMetadata(data, communityId),
          options: options ?? [],
          isExpired: Date.now() > (data.expiresAt ?? 0),
        });
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 3000);
    });
  }

  // ─── Create ───────────────────────────────────────────────────────────────

  static async createPoll(data: {
    communityId: string;
    authorId: string;
    authorName: string;
    question: string;
    description?: string;
    options: string[];
    durationDays: number;
    allowMultipleChoices: boolean;
    showResultsBeforeVoting: boolean;
    requireLogin: boolean;
    isPrivate: boolean;
    inviteCodeCount?: number;
  }): Promise<Poll> {
    const pollId = `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = Date.now();
    const expiresAt = now + data.durationDays * 86400000;

    const pollOptions: PollOption[] = data.options.map((text, idx) => ({
      id: `${pollId}-option-${idx}`, text, votes: 0, voters: [],
    }));

    const poll: Poll = {
      id: pollId, communityId: data.communityId, authorId: data.authorId,
      authorName: data.authorName, question: data.question,
      description: data.description || '', options: pollOptions,
      createdAt: now, expiresAt, allowMultipleChoices: data.allowMultipleChoices,
      showResultsBeforeVoting: data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin, isPrivate: !!data.isPrivate,
      totalVotes: 0, isExpired: false,
    };

    const gunPoll = {
      id: poll.id, communityId: poll.communityId, authorId: poll.authorId,
      authorName: poll.authorName, question: poll.question,
      description: poll.description, createdAt: poll.createdAt,
      expiresAt: poll.expiresAt, allowMultipleChoices: poll.allowMultipleChoices,
      showResultsBeforeVoting: poll.showResultsBeforeVoting,
      requireLogin: poll.requireLogin, isPrivate: poll.isPrivate,
      totalVotes: 0, isExpired: false,
    };

    const optionsMap: Record<string, any> = {};
    pollOptions.forEach((opt, i) => { optionsMap[i] = { id: opt.id, text: opt.text, votes: 0 }; });

    await this.putPromise(this.getPollPath(pollId), gunPoll);
    await this.putPromise(this.getPollPath(pollId).get('options'), optionsMap);

    const communityPolls = this.gun.get('communities').get(data.communityId).get('polls');
    await this.putPromise(communityPolls.get(pollId), gunPoll);
    await this.putPromise(communityPolls.get(pollId).get('options'), optionsMap);

    if (poll.isPrivate) {
      const inviteCount = Math.max(1, Math.min(200, Number(data.inviteCodeCount ?? 20)));
      const inviteCodes = this.generateInviteCodes(inviteCount);
      const codesMap: Record<string, any> = {};
      inviteCodes.forEach((code, i) => { codesMap[i] = { code, used: false }; });

      await this.putPromise(this.getPollPath(pollId).get('inviteCodes'), codesMap);
      await this.putPromise(communityPolls.get(pollId).get('inviteCodes'), codesMap);

      const mainByCode = this.getPollPath(pollId).get('inviteCodesByCode');
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

    return poll;
  }

  // ─── Vote ─────────────────────────────────────────────────────────────────

  static async voteOnPoll(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) throw new Error('Community ID not found');
    const mainPath = this.getPollPath(pollId);
    const commPath = this.getCommunityPollPath(communityId, pollId);
    for (const optionId of optionIds) {
      const index = optionId.split('-option-')[1];
      if (!index) continue;
      const votes = await this.getNumber(mainPath.get('options').get(index).get('votes'));
      await this.putBoth(mainPath, commPath, `options/${index}/votes`, votes + 1);
    }
    const total = await this.getNumber(mainPath.get('totalVotes'));
    await this.putBoth(mainPath, commPath, 'totalVotes', total + optionIds.length);
  }

  // ─── Invite Codes ─────────────────────────────────────────────────────────

  static async consumeInviteCode(pollId: string, code: string): Promise<void> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) throw new Error('Community ID not found');
    const normalized = code.trim().toUpperCase();
    const pollPath = this.getPollPath(pollId);
    const communityPath = this.getCommunityPollPath(communityId, pollId);
    const mainByCode = pollPath.get('inviteCodesByCode').get(normalized);
    const communityByCode = communityPath.get('inviteCodesByCode').get(normalized);
    const entry = await this.lookupByCode(mainByCode, communityByCode);
    if (entry?.used) throw new Error('Invite code already used');
    if (entry) {
      await Promise.all([
        this.putPromise(mainByCode.get('used'), true),
        this.putPromise(communityByCode.get('used'), true),
      ]);
      return;
    }
    const legacyEntry = await this.lookupLegacyCode(pollPath, communityPath, normalized);
    if (!legacyEntry) throw new Error('Invalid invite code');
    if (legacyEntry.used) throw new Error('Invite code already used');
    const { key, nodeMain, nodeComm } = legacyEntry;
    await Promise.all([
      this.putPromise(nodeMain.get(key).get('used'), true),
      this.putPromise(nodeComm.get(key).get('used'), true),
      this.putPromise(mainByCode.get('used'), true),
      this.putPromise(communityByCode.get('used'), true),
    ]);
  }

  static async getInviteCodes(pollId: string): Promise<{ code: string; used: boolean }[]> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) return [];
    const pollPath = this.getPollPath(pollId);
    const listByCode: { code: string; used: boolean }[] = await new Promise((resolve) => {
      let resolved = false;
      pollPath.get('inviteCodesByCode').once((data: any) => {
        if (resolved) return; resolved = true;
        if (!data || typeof data !== 'object') return resolve([]);
        const items: { code: string; used: boolean }[] = [];
        for (const key of Object.keys(data)) {
          if (key.startsWith('_')) continue;
          const entry = data[key];
          if (entry && typeof entry === 'object') items.push({ code: key, used: !!entry.used });
        }
        resolve(items);
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve([]); } }, 2000);
    });
    if (listByCode.length > 0) return listByCode;
    return new Promise((resolve) => {
      let resolved = false;
      pollPath.get('inviteCodes').once((data: any) => {
        if (resolved) return; resolved = true;
        if (!data || typeof data !== 'object') return resolve([]);
        const items: { code: string; used: boolean }[] = [];
        for (const key of Object.keys(data)) {
          if (key.startsWith('_')) continue;
          const entry = data[key];
          if (entry && typeof entry === 'object' && 'code' in entry) {
            items.push({ code: String(entry.code), used: !!entry.used });
          }
        }
        resolve(items);
      });
      setTimeout(() => { if (!resolved) { resolved = true; resolve([]); } }, 2000);
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static async lookupByCode(mainNode: any, communityNode: any): Promise<any | null> {
    const mainEntry: any = await new Promise((resolve) => {
      let resolved = false;
      mainNode.once((v: any) => { if (!resolved) { resolved = true; resolve(v ?? null); } });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 1000);
    });
    if (mainEntry && typeof mainEntry === 'object') return mainEntry;
    const commEntry: any = await new Promise((resolve) => {
      let resolved = false;
      communityNode.once((v: any) => { if (!resolved) { resolved = true; resolve(v ?? null); } });
      setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 1000);
    });
    return (commEntry && typeof commEntry === 'object') ? commEntry : null;
  }

  private static async lookupLegacyCode(pollPath: any, communityPath: any, normalized: string) {
    const mainCodes = pollPath.get('inviteCodes');
    const commCodes = communityPath.get('inviteCodes');
    const load = (node: any) => new Promise<any>((resolve) => {
      let resolved = false;
      node.once((v: any) => { if (!resolved) { resolved = true; resolve(v || {}); } });
      setTimeout(() => { if (!resolved) { resolved = true; resolve({}); } }, 1000);
    });
    let data = await load(mainCodes);
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) data = await load(commCodes);
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
    for (const key of Object.keys(data).filter((k) => !k.startsWith('_'))) {
      const entry = data[key];
      const entryCode = entry && typeof entry === 'object' && 'code' in entry
        ? String(entry.code).trim().toUpperCase() : null;
      if (!entryCode) continue;
      if (entryCode === normalized) {
        return { key, used: Boolean(entry.used), nodeMain: mainCodes, nodeComm: commCodes };
      }
    }
    return null;
  }

  private static putPromise(node: any, value: any): Promise<void> {
    return new Promise((res, rej) => {
      node.put(value, (ack: any) => (ack?.err ? rej(new Error(ack.err)) : res()));
    });
  }

  private static async getNumber(node: any): Promise<number> {
    return new Promise((res) => {
      let resolved = false;
      node.once((v: any) => { if (!resolved) { resolved = true; res(Number(v) || 0); } });
      setTimeout(() => { if (!resolved) { resolved = true; res(0); } }, 1000);
    });
  }

  private static async getCommunityId(pollId: string): Promise<string> {
    return new Promise((res) => {
      let resolved = false;
      this.getPollPath(pollId).get('communityId').once((v: any) => {
        if (!resolved) { resolved = true; res(v || ''); }
      });
      setTimeout(() => { if (!resolved) { resolved = true; res(''); } }, 1000);
    });
  }

  private static async loadPollOptions(pollId: string, communityId: string): Promise<PollOption[] | null> {
    const mainOptions = await this.getOptions(this.getPollPath(pollId).get('options'));
    if (mainOptions && mainOptions.length > 0) return mainOptions;
    return this.getOptions(
      this.gun.get('communities').get(communityId).get('polls').get(pollId).get('options'),
    );
  }

  private static async getOptions(node: any): Promise<PollOption[] | null> {
    const data = await new Promise<any>((r) => {
      let resolved = false;
      node.once((v: any) => { if (!resolved) { resolved = true; r(v); } });
      setTimeout(() => { if (!resolved) { resolved = true; r(null); } }, 2000);
    });
    if (!data || typeof data !== 'object') return null;
    const keys = Object.keys(data).filter((k) => !k.startsWith('_')).sort((a, b) => Number(a) - Number(b));
    if (keys.length === 0) return [];
    const options: PollOption[] = [];
    for (const k of keys) {
      const val = data[k];
      if (val?.['#']) {
        const refData = await new Promise<any>((r) => {
          let resolved = false;
          this.gun.get(val['#']).once((v: any) => { if (!resolved) { resolved = true; r(v); } });
          setTimeout(() => { if (!resolved) { resolved = true; r(null); } }, 1000);
        });
        options.push({ id: refData?.id ?? '', text: refData?.text ?? '', votes: refData?.votes ?? 0, voters: [] });
      } else {
        options.push({ id: val?.id ?? '', text: val?.text ?? '', votes: val?.votes ?? 0, voters: [] });
      }
    }
    return options;
  }

  private static mapPollMetadata(data: any, communityId: string): Omit<Poll, 'options' | 'isExpired'> {
    return {
      id: data.id || '', communityId: data.communityId || communityId,
      authorId: data.authorId || '', authorName: data.authorName || 'Anonymous',
      question: data.question || '', description: data.description || '',
      createdAt: data.createdAt || Date.now(), expiresAt: data.expiresAt || Date.now(),
      allowMultipleChoices: !!data.allowMultipleChoices,
      showResultsBeforeVoting: !!data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin, isPrivate: !!data.isPrivate,
      totalVotes: data.totalVotes || 0,
    };
  }

  private static async putBoth(mainNode: any, commNode: any, path: string, value: any): Promise<void> {
    const [main, comm] = [mainNode, commNode].map((n) => {
      let node = n;
      for (const p of path.split('/')) node = node.get(p);
      return node;
    });
    await Promise.all([this.putPromise(main, value), this.putPromise(comm, value)]);
  }

  private static generateInviteCodes(count: number): string[] {
    const codes = new Set<string>();
    while (codes.size < count) codes.add(Math.random().toString(36).slice(2, 10).toUpperCase());
    return Array.from(codes);
  }
}
