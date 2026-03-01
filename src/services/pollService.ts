import { GunService } from './gunService';

const API_URL = import.meta.env.VITE_API_URL || 'https://interpoll.onrender.com';

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
}

const pollActiveListeners = new Map<string, any>();
const MAX_INITIAL_POLLS = 30;

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

  static subscribeToPollsInCommunity(
    communityId: string,
    onPoll: (poll: Poll) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const communityPollsNode = this.gun.get('communities').get(communityId).get('polls');
    const seenIds = new Set<string>();
    const collectedPolls: Poll[] = [];
    let initialLoadDone = false;
    let subscription: any;

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      checkLoadComplete();
    }, 1200);

    communityPollsNode.once((allPolls) => {
      if (!allPolls) {
        checkLoadComplete();
        return;
      }

      const keys = Object.keys(allPolls).filter(k => k !== '_');
      const promises = keys.slice(0, MAX_INITIAL_POLLS).map(pollId =>
        this.loadPoll(pollId).then(poll => {
          if (poll && !seenIds.has(poll.id)) {
            seenIds.add(poll.id);
            collectedPolls.push(poll);
          }
        })
      );

      Promise.all(promises).then(() => {
        collectedPolls.sort((a, b) => b.createdAt - a.createdAt);
        collectedPolls.forEach(p => onPoll(p));
        checkLoadComplete();
      });
    });

    subscription = communityPollsNode.on((allPolls) => {
      if (!allPolls) return;
      Object.keys(allPolls).forEach(pollId => {
        if (pollId === '_' || seenIds.has(pollId)) return;
        this.loadPoll(pollId).then(poll => {
          if (poll && !seenIds.has(poll.id)) {
            seenIds.add(poll.id);
            onPoll(poll);
          }
        });
      });
    });

    const listenerKey = `${communityId}-polls`;
    pollActiveListeners.set(listenerKey, { subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
      if (subscription) subscription.off();
      pollActiveListeners.delete(listenerKey);
    };
  }

  static subscribeToAllPolls(
    onPoll: (poll: Poll) => void,
    onInitialLoadDone?: () => void
  ): () => void {
    const pollsNode = this.gun.get('polls');
    const seenIds = new Set<string>();
    const collectedPolls: Poll[] = [];
    let initialLoadDone = false;
    let subscription: any;

    const checkLoadComplete = () => {
      if (initialLoadDone) return;
      initialLoadDone = true;
      if (onInitialLoadDone) onInitialLoadDone();
    };

    const timeboxTimer = setTimeout(() => {
      checkLoadComplete();
    }, 1200);

    pollsNode.once((allPolls) => {
      if (!allPolls) {
        checkLoadComplete();
        return;
      }

      const keys = Object.keys(allPolls).filter(k => k !== '_');
      const promises = keys.slice(0, MAX_INITIAL_POLLS).map(pollId =>
        this.loadPoll(pollId).then(poll => {
          if (poll && !seenIds.has(poll.id)) {
            seenIds.add(poll.id);
            collectedPolls.push(poll);
          }
        })
      );

      Promise.all(promises).then(() => {
        collectedPolls.sort((a, b) => b.createdAt - a.createdAt);
        collectedPolls.forEach(p => onPoll(p));
        checkLoadComplete();
      });
    });

    subscription = pollsNode.on((allPolls) => {
      if (!allPolls) return;
      Object.keys(allPolls).forEach(pollId => {
        if (pollId === '_' || seenIds.has(pollId)) return;
        this.loadPoll(pollId).then(poll => {
          if (poll && !seenIds.has(poll.id)) {
            seenIds.add(poll.id);
            onPoll(poll);
          }
        });
      });
    });

    const listenerKey = 'all-polls';
    pollActiveListeners.set(listenerKey, { subscription, timer: timeboxTimer });

    return () => {
      clearTimeout(timeboxTimer);
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
    const pollId = preGeneratedId || `poll-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const now = Date.now();
    const expiresAt = now + data.durationDays * 86400000;

    const pollOptions: PollOption[] = data.options.map((text, idx) => ({
      id: `${pollId}-option-${idx}`, text, votes: 0, voters: [],
    }));

    const poll: Poll = {
      id: pollId, communityId: data.communityId, authorId: data.authorId,
      authorName: data.authorName, authorShowRealName: data.authorShowRealName || false,
      question: data.question,
      description: data.description || '', options: pollOptions,
      createdAt: now, expiresAt, allowMultipleChoices: data.allowMultipleChoices,
      showResultsBeforeVoting: data.showResultsBeforeVoting,
      requireLogin: !!data.requireLogin, isPrivate: !!data.isPrivate,
      totalVotes: 0, isExpired: false,
    };

    const gunPoll = {
      id: poll.id, communityId: poll.communityId, authorId: poll.authorId,
      authorName: poll.authorName, authorShowRealName: poll.authorShowRealName,
      question: poll.question,
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

    await indexForSearch('poll', poll.id, {
      question: poll.question,
      description: poll.description || '',
      authorName: poll.authorName,
      communitySlug: poll.communityId,
      createdAt: poll.createdAt
    });

    return poll;
  }

  static async loadPoll(pollId: string): Promise<Poll | null> {
    return new Promise((resolve) => {
      this.getPollPath(pollId).once((pollData: any) => {
        if (!pollData || !pollData.id) {
          resolve(null);
          return;
        }

        this.loadPollOptions(pollId).then(options => {
          const totalVotes = options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
          const isExpired = Date.now() > (pollData.expiresAt || 0);

          const poll: Poll = {
            id: pollData.id,
            communityId: pollData.communityId || '',
            authorId: pollData.authorId || '',
            authorName: pollData.authorName || 'Anonymous',
            question: pollData.question || '',
            description: pollData.description || '',
            options,
            createdAt: pollData.createdAt || Date.now(),
            expiresAt: pollData.expiresAt || 0,
            allowMultipleChoices: !!pollData.allowMultipleChoices,
            showResultsBeforeVoting: !!pollData.showResultsBeforeVoting,
            requireLogin: !!pollData.requireLogin,
            isPrivate: !!pollData.isPrivate,
            totalVotes,
            isExpired,
          };
          resolve(poll);
        });
      });
    });
  }

  static async loadPollOptions(pollId: string): Promise<PollOption[]> {
    return new Promise((resolve) => {
      this.getPollPath(pollId).get('options').once((optionsData: any) => {
        if (!optionsData) {
          resolve([]);
          return;
        }

        const options: PollOption[] = [];
        Object.keys(optionsData).forEach(key => {
          if (key !== '_') {
            const opt = optionsData[key];
            if (opt && opt.id) {
              options.push({
                id: opt.id,
                text: opt.text || '',
                votes: opt.votes || 0,
                voters: opt.voters || [],
              });
            }
          }
        });
        resolve(options);
      });
    });
  }

  static async vote(pollId: string, optionIds: string[], voterId: string): Promise<void> {
    const poll = await this.loadPoll(pollId);
    if (!poll) throw new Error('Poll not found');
    if (poll.isExpired) throw new Error('Poll has expired');

    const selectedOptions = poll.options.filter(opt => optionIds.includes(opt.id));
    if (selectedOptions.length === 0) throw new Error('No valid options selected');
    if (!poll.allowMultipleChoices && selectedOptions.length > 1) {
      throw new Error('Multiple choices not allowed');
    }

    for (const option of selectedOptions) {
      const hasVoted = option.voters.includes(voterId);
      if (!hasVoted) {
        const newVotes = (option.votes || 0) + 1;
        const newVoters = [...option.voters, voterId];

        await this.putPromise(
          this.getPollPath(pollId).get('options').get(option.id),
          { votes: newVotes, voters: newVoters }
        );
      }
    }

    const updatedOptions = await this.loadPollOptions(pollId);
    const totalVotes = updatedOptions.reduce((sum, opt) => sum + (opt.votes || 0), 0);
    await this.putPromise(this.getPollPath(pollId), { totalVotes });
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
      for (let j = 0; j < 8; j++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      codes.push(code);
    }
    return codes;
  }

  private static putPromise(node: any, data: any): Promise<void> {
    return new Promise((resolve, reject) => {
      node.put(data, (ack: any) => {
        if (ack.err) reject(new Error(ack.err));
        else resolve();
      });
    });
  }

  static unsubscribeAll(): void {
    pollActiveListeners.forEach(({ subscription, timer }) => {
      clearTimeout(timer);
      if (subscription) subscription.off();
    });
    pollActiveListeners.clear();
  }
}