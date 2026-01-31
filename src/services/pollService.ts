// src/services/pollService.ts
import { GunService } from './gunService';

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voters: string[]; // currently unused — consider removing if not needed
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

export class PollService {
  private static get gun() {
    return GunService.getGun();
  }

  private static getPollPath(pollId: string) {
    return this.gun.get('polls').get(pollId);
  }

  private static getCommunityPollPath(communityId: string, pollId: string) {
    return this.gun.get('communities').get(communityId).get('polls').get(pollId);
  }

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
    const expiresAt = now + data.durationDays * 86400000; // 24×60×60×1000

    const pollOptions: PollOption[] = data.options.map((text, idx) => ({
      id: `${pollId}-option-${idx}`,
      text,
      votes: 0,
      voters: [],
    }));

    const poll: Poll = {
      id: pollId,
      communityId: data.communityId,
      authorId: data.authorId,
      authorName: data.authorName,
      question: data.question,
      description: data.description || '',
      options: pollOptions,
      createdAt: now,
      expiresAt,
      allowMultipleChoices: data.allowMultipleChoices,
      showResultsBeforeVoting: data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin,
      isPrivate: !!data.isPrivate,
      totalVotes: 0,
      isExpired: false,
    };

    // flattened version for Gun (no nested arrays/objects)
    const gunPoll = {
      id: poll.id,
      communityId: poll.communityId,
      authorId: poll.authorId,
      authorName: poll.authorName,
      question: poll.question,
      description: poll.description,
      createdAt: poll.createdAt,
      expiresAt: poll.expiresAt,
      allowMultipleChoices: poll.allowMultipleChoices,
      showResultsBeforeVoting: poll.showResultsBeforeVoting,
      requireLogin: poll.requireLogin,
      isPrivate: poll.isPrivate,
      totalVotes: 0,
      isExpired: false,
    };

    const optionsMap: Record<string, any> = {};
    pollOptions.forEach((opt, i) => {
      optionsMap[i] = { id: opt.id, text: opt.text, votes: 0 };
    });

    // ─────────────────────────────────────────────
    // Write metadata + options to both locations
    // ─────────────────────────────────────────────

    await this.putPromise(this.getPollPath(pollId), gunPoll);
    await this.putPromise(this.getPollPath(pollId).get('options'), optionsMap);

    const communityPolls = this.gun.get('communities').get(data.communityId).get('polls');

    await this.putPromise(communityPolls.get(pollId), gunPoll);
    await this.putPromise(communityPolls.get(pollId).get('options'), optionsMap);

    // ─────────────────────────────────────────────
    // Private poll invite codes (one-vote-per-code)
    // ─────────────────────────────────────────────

    if (poll.isPrivate) {
      const inviteCount = Math.max(1, Math.min(200, Number(data.inviteCodeCount ?? 20)));
      const inviteCodes = this.generateInviteCodes(inviteCount);

      const codesMap: Record<string, any> = {};
      inviteCodes.forEach((code, index) => {
        codesMap[index] = { code, used: false };
      });

      await this.putPromise(this.getPollPath(pollId).get('inviteCodes'), codesMap);
      await this.putPromise(communityPolls.get(pollId).get('inviteCodes'), codesMap);

      // Also index by code for simpler, reliable lookups
      const mainByCode = this.getPollPath(pollId).get('inviteCodesByCode');
      const communityByCode = communityPolls.get(pollId).get('inviteCodesByCode');

      for (const rawCode of inviteCodes) {
        const codeKey = rawCode.trim().toUpperCase();
        await Promise.all([
          this.putPromise(mainByCode.get(codeKey), { used: false }),
          this.putPromise(communityByCode.get(codeKey), { used: false }),
        ]);
      }

      // Return codes to caller so they can be shared immediately
      (poll as any).inviteCodes = inviteCodes;
    }

    return poll;
  }

  static subscribeToPollsInCommunity(
    communityId: string,
    onPoll: (poll: Poll) => void,
  ) {
    const seen = new Set<string>();

    this.gun
      .get('communities')
      .get(communityId)
      .get('polls')
      .map()
      .once((data: any, key: string) => {
        if (!data?.id || !data?.question || seen.has(data.id) || key.startsWith('_')) {
          return;
        }

        seen.add(data.id);

        // Prefer main path, fallback to community path
        this.loadPollOptions(data.id, communityId).then((options) => {
          const poll: Poll = {
            ...this.mapPollMetadata(data, communityId),
            options: options ?? [],
            isExpired: Date.now() > (data.expiresAt ?? 0),
          };

          onPoll(poll);
        });
      });
  }

  static async getPollById(pollId: string): Promise<Poll | null> {
    return new Promise<Poll | null>((resolve) => {
      this.getPollPath(pollId).once(async (data: any) => {
        if (!data?.id || !data?.question) {
          resolve(null);
          return;
        }

        const communityId = data.communityId || (await this.getCommunityId(pollId));
        const options = await this.loadPollOptions(pollId, communityId);

        const poll: Poll = {
          ...this.mapPollMetadata(data, communityId),
          options: options ?? [],
          isExpired: Date.now() > (data.expiresAt ?? 0),
        };

        resolve(poll);
      });
    });
  }

  static async getAllPollsInCommunity(communityId: string): Promise<Poll[]> {
    return new Promise<Poll[]>((resolve) => {
      const polls: Poll[] = [];
      const seen = new Set<string>();

      this.gun
        .get('communities')
        .get(communityId)
        .get('polls')
        .map()
        .once(async (data: any, key: string) => {
          if (!data?.id || !data?.question || seen.has(data.id) || key.startsWith('_')) return;
          seen.add(data.id);

          const options = await this.loadPollOptions(data.id, communityId);
          const poll: Poll = {
            ...this.mapPollMetadata(data, communityId),
            options: options ?? [],
            isExpired: Date.now() > (data.expiresAt ?? 0),
          };

          polls.push(poll);
        });

      // Gun is eventually consistent — give it some time
      setTimeout(() => resolve(polls), 900);
    });
  }

  static async voteOnPoll(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) throw new Error('Community ID not found');

    const mainPath = this.getPollPath(pollId);
    const commPath = this.getCommunityPollPath(communityId, pollId);

    // Increment each selected option
    for (const optionId of optionIds) {
      const index = optionId.split('-option-')[1];
      if (!index) continue;

      const votes = await this.getNumber(mainPath.get('options').get(index).get('votes'));
      await this.putBoth(mainPath, commPath, `options/${index}/votes`, votes + 1);
    }

    // Increment total
    const total = await this.getNumber(mainPath.get('totalVotes'));
    await this.putBoth(mainPath, commPath, 'totalVotes', total + optionIds.length);
  }

  // ─── Private Poll Access Codes ────────────────────────────────────────────

  /**
   * Consume an invite code for a private poll.
   *
   * Ensures the code exists and has not been used yet, then marks it as used
   * so it cannot be used again. Throws an error if the code is invalid or
   * already consumed.
   */
  static async consumeInviteCode(pollId: string, code: string): Promise<void> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) throw new Error('Community ID not found');
    const normalized = code.trim().toUpperCase();
    const pollPath = this.getPollPath(pollId);
    const communityPath = this.getCommunityPollPath(communityId, pollId);

    const mainByCode = pollPath.get('inviteCodesByCode').get(normalized);
    const communityByCode = communityPath.get('inviteCodesByCode').get(normalized);

    // Try direct by-code lookup first (new format)
    const entry = await this.lookupByCode(mainByCode, communityByCode);

    if (entry && entry.used) {
      throw new Error('Invite code already used');
    }

    if (entry) {
      await Promise.all([
        this.putPromise(mainByCode.get('used'), true),
        this.putPromise(communityByCode.get('used'), true),
      ]);
      return;
    }

    // Fallback: old numeric-indexed map (inviteCodes)
    const legacyEntry = await this.lookupLegacyCode(pollPath, communityPath, normalized);
    if (!legacyEntry) {
      throw new Error('Invalid invite code');
    }
    if (legacyEntry.used) {
      throw new Error('Invite code already used');
    }

    // Mark used in both legacy map and by-code map to keep future lookups simple
    const { key, nodeMain, nodeComm } = legacyEntry;

    await Promise.all([
      this.putPromise(nodeMain.get(key).get('used'), true),
      this.putPromise(nodeComm.get(key).get('used'), true),
      this.putPromise(mainByCode.get('used'), true),
      this.putPromise(communityByCode.get('used'), true),
    ]);
  }

  /**
   * Retrieve invite codes with their used status. Tries by-code index first, then legacy map.
   */
  static async getInviteCodes(pollId: string): Promise<{ code: string; used: boolean }[]> {
    const communityId = await this.getCommunityId(pollId);
    if (!communityId) return [];

    const pollPath = this.getPollPath(pollId);
    const communityPath = this.getCommunityPollPath(communityId, pollId);

    // New format
    const byCodeNode = pollPath.get('inviteCodesByCode');
    const listByCode: { code: string; used: boolean }[] = await new Promise((resolve) => {
      byCodeNode.once((data: any) => {
        if (!data || typeof data !== 'object') return resolve([]);
        const items: { code: string; used: boolean }[] = [];
        for (const key of Object.keys(data)) {
          if (key.startsWith('_')) continue;
          const entry = data[key];
          if (entry && typeof entry === 'object') {
            items.push({ code: key, used: !!entry.used });
          }
        }
        resolve(items);
      });
    });

    if (listByCode.length > 0) return listByCode;

    // Legacy format fallback
    const legacyNode = pollPath.get('inviteCodes');
    const legacy: { code: string; used: boolean }[] = await new Promise((resolve) => {
      legacyNode.once((data: any) => {
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
    });

    return legacy;
  }

  private static async lookupByCode(mainNode: any, communityNode: any): Promise<any | null> {
    const mainEntry: any = await new Promise((resolve) =>
      mainNode.once((v: any) => resolve(v ?? null)),
    );
    if (mainEntry && typeof mainEntry === 'object') return mainEntry;

    const commEntry: any = await new Promise((resolve) =>
      communityNode.once((v: any) => resolve(v ?? null)),
    );
    if (commEntry && typeof commEntry === 'object') return commEntry;
    return null;
  }

  private static async lookupLegacyCode(
    pollPath: any,
    communityPath: any,
    normalized: string,
  ): Promise<{ key: string; used: boolean; nodeMain: any; nodeComm: any } | null> {
    const mainCodes = pollPath.get('inviteCodes');
    const commCodes = communityPath.get('inviteCodes');

    const load = (node: any) => new Promise<any>((resolve) => node.once((v: any) => resolve(v || {})));

    let data = await load(mainCodes);
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      data = await load(commCodes);
    }

    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      return null;
    }

    const keys = Object.keys(data).filter((k) => !k.startsWith('_'));
    for (const key of keys) {
      const entry = data[key];
      const entryCode =
        entry && typeof entry === 'object' && 'code' in entry ? String(entry.code).trim().toUpperCase() : null;
      const entryUsed = entry && typeof entry === 'object' && 'used' in entry ? Boolean(entry.used) : false;
      if (!entryCode) continue;
      if (entryCode === normalized) {
        return { key, used: entryUsed, nodeMain: mainCodes, nodeComm: commCodes };
      }
    }

    return null;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private static putPromise(node: any, value: any): Promise<void> {
    return new Promise((res, rej) => {
      node.put(value, (ack: any) => (ack.err ? rej(ack.err) : res()));
    });
  }

  private static async getNumber(node: any): Promise<number> {
    return new Promise((res) => node.once((v: any) => res(Number(v) || 0)));
  }

  private static async getCommunityId(pollId: string): Promise<string> {
    return new Promise((res) => this.getPollPath(pollId).get('communityId').once((v) => res(v || '')));
  }

  private static async loadPollOptions(pollId: string, communityId: string): Promise<PollOption[] | null> {
    const mainOptions = await this.getOptions(this.getPollPath(pollId).get('options'));
    if (mainOptions && mainOptions.length > 0) return mainOptions;

    const commOptions = await this.getOptions(
      this.gun.get('communities').get(communityId).get('polls').get(pollId).get('options'),
    );

    return commOptions;
  }

  private static async getOptions(node: any): Promise<PollOption[] | null> {
    const data = await new Promise<any>((r) => node.once((v: any) => r(v)));

    if (!data || typeof data !== 'object') return null;

    const keys = Object.keys(data)
      .filter((k) => !k.startsWith('_'))
      .sort((a, b) => Number(a) - Number(b));

    if (keys.length === 0) return [];

    const options: PollOption[] = [];

    for (const k of keys) {
      const val = data[k];
      if (val?.['#']) {
        // rare case — reference — usually not needed in your current schema
        const refData = await new Promise<any>((r) => this.gun.get(val['#']).once(r));
        options.push({ id: refData?.id ?? '', text: refData?.text ?? '', votes: refData?.votes ?? 0, voters: [] });
      } else {
        options.push({ id: val?.id ?? '', text: val?.text ?? '', votes: val?.votes ?? 0, voters: [] });
      }
    }

    return options;
  }

  private static mapPollMetadata(data: any, communityId: string): Omit<Poll, 'options' | 'isExpired'> {
    return {
      id: data.id || '',
      communityId: data.communityId || communityId,
      authorId: data.authorId || '',
      authorName: data.authorName || 'Anonymous',
      question: data.question || '',
      description: data.description || '',
      createdAt: data.createdAt || Date.now(),
      expiresAt: data.expiresAt || Date.now(),
      allowMultipleChoices: !!data.allowMultipleChoices,
      showResultsBeforeVoting: !!data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin,
      isPrivate: !!data.isPrivate,
      totalVotes: data.totalVotes || 0,
    };
  }

  private static async putBoth(
    mainNode: any,
    commNode: any,
    path: string,
    value: any,
  ): Promise<void> {
    const [main, comm] = [mainNode, commNode].map((n) => {
      let node = n;
      for (const p of path.split('/')) node = node.get(p);
      return node;
    });

    await Promise.all([this.putPromise(main, value), this.putPromise(comm, value)]);
  }

  private static generateInviteCodes(count: number): string[] {
    const codes = new Set<string>();

    while (codes.size < count) {
      const raw = Math.random().toString(36).slice(2, 10).toUpperCase();
      codes.add(raw);
    }

    return Array.from(codes);
  }
}