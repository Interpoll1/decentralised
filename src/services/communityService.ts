// src/services/communityService.ts
import { GunService } from './gunService';

export interface Community {
  id: string;
  name: string;
  displayName: string;
  description: string;
  rules: string[];
  creatorId: string;
  createdAt: number;
  memberCount: number;
  postCount?: number;
}

export class CommunityService {
  private static get gun() { return GunService.getGun(); }
  private static getCommunityNode(id: string) { return this.gun.get('communities').get(id); }

  // ─── Create ────────────────────────────────────────────────────────────────

  static async createCommunity(data: {
    name: string; displayName: string; description: string;
    rules: string[]; creatorId: string;
  }): Promise<Community> {
    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`;
    const community: Community = {
      id, name: data.name, displayName: data.displayName,
      description: data.description, rules: data.rules,
      creatorId: data.creatorId, createdAt: Date.now(), memberCount: 1, postCount: 0,
    };

    const gunData = {
      id: community.id, name: community.name, displayName: community.displayName,
      description: community.description, creatorId: community.creatorId,
      createdAt: community.createdAt, memberCount: community.memberCount,
      postCount: community.postCount,
    };

    await this.put(this.getCommunityNode(id), gunData);

    if (community.rules.length > 0) {
      const rulesObj = Object.fromEntries(community.rules.map((rule, i) => [i, rule]));
      await this.put(this.getCommunityNode(id).get('rules'), rulesObj);
    }

    return community;
  }

  // ─── Live subscription (replaces subscribeToCommunities) ──────────────────

  /**
   * Real persistent .on() subscription — fires for EVERY community node
   * update, both from localStorage cache (immediate) and from relay (delayed).
   *
   * The old subscribeToCommunities used .once() which is a snapshot read —
   * it fires once from whatever Gun has right now and stops. Communities that
   * haven't synced from the relay yet never arrive, so the communities list
   * stays partial and loadAllPosts() only subscribes to the cached subset.
   *
   * This version keeps listening, so communities arriving late from the relay
   * still push into the store and trigger the HomePage watcher.
   */
  static subscribeToCommunitiesLive(callback: (community: Community) => void): () => void {
    const seen = new Set<string>();

    const listener = this.gun
      .get('communities')
      .map()
      .on((data: any, key: string) => {
        if (!data?.name || !data?.id || seen.has(key) || key.startsWith('_')) return;
        seen.add(key);

        this.loadRules(key).then((rules) => {
          callback(this.mapToCommunity(data, rules));
        });
      });

    // Return unsubscribe function
    return () => { if (listener) listener.off(); };
  }

  /**
   * @deprecated — used .once() so only fired from localStorage cache snapshot.
   * Use subscribeToCommunitiesLive instead.
   */
  static subscribeToCommunities(callback: (community: Community) => void): void {
    const seen = new Set<string>();
    this.gun.get('communities').map().once((data: any, key: string) => {
      if (!data?.name || !data?.id || seen.has(key) || key.startsWith('_')) return;
      seen.add(key);
      this.loadRules(key).then((rules) => callback(this.mapToCommunity(data, rules)));
    });
  }

  // ─── Single fetch ──────────────────────────────────────────────────────────

  static async getCommunity(communityId: string): Promise<Community | null> {
    const node = this.getCommunityNode(communityId);
    const [data, rules] = await Promise.all([
      this.once<any>(node),
      this.loadRules(communityId),
    ]);
    if (!data?.name) return null;
    return this.mapToCommunity(data, rules);
  }

  static async joinCommunity(communityId: string): Promise<void> {
    const community = await this.getCommunity(communityId);
    if (!community) throw new Error('Community not found');
    await this.put(
      this.getCommunityNode(communityId).get('memberCount'),
      community.memberCount + 1
    );
  }

  /** @deprecated use subscribeToCommunitiesLive */
  static async getAllCommunities(): Promise<Community[]> {
    return new Promise<Community[]>((resolve) => {
      const communities: Community[] = [];
      const seen = new Set<string>();
      this.gun.get('communities').map().once(async (data: any, key: string) => {
        if (!data?.name || !data?.id || seen.has(key) || key.startsWith('_')) return;
        seen.add(key);
        const rules = await this.loadRules(key);
        communities.push(this.mapToCommunity(data, rules));
      });
      setTimeout(() => resolve(communities), 1200);
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private static put(node: any, value: any): Promise<void> {
    return new Promise((res, rej) =>
      node.put(value, (ack: any) => (ack.err ? rej(ack.err) : res()))
    );
  }

  private static once<T = any>(node: any): Promise<T | null> {
    return new Promise((res) => {
      let done = false;
      node.once((val: any) => {
        if (!done) { done = true; res(val ?? null); }
      });
      setTimeout(() => { if (!done) { done = true; res(null); } }, 800);
    });
  }

  private static async loadRules(communityId: string): Promise<string[]> {
    const data = await this.once<any>(this.getCommunityNode(communityId).get('rules'));
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data)
      .filter(k => !k.startsWith('_'))
      .sort((a, b) => Number(a) - Number(b))
      .map(k => data[k] as string)
      .filter(Boolean);
  }

  private static mapToCommunity(data: any, rules: string[]): Community {
    return {
      id: data.id || '',
      name: data.name || '',
      displayName: data.displayName || data.name || '',
      description: data.description || '',
      rules,
      creatorId: data.creatorId || '',
      createdAt: data.createdAt || Date.now(),
      memberCount: Number(data.memberCount) || 1,
      postCount: Number(data.postCount) || 0,
    };
  }
}
