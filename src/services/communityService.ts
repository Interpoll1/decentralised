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
  private static get gun() {
    return GunService.getGun();
  }

  private static getCommunityNode(id: string) {
    return this.gun.get('communities').get(id);
  }

  static async createCommunity(data: {
    name: string;
    displayName: string;
    description: string;
    rules: string[];
    creatorId: string;
  }): Promise<Community> {
    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`;

    const community: Community = {
      id,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      rules: data.rules,
      creatorId: data.creatorId,
      createdAt: Date.now(),
      memberCount: 1,
      postCount: 0,
    };

    const gunData = {
      id: community.id,
      name: community.name,
      displayName: community.displayName,
      description: community.description,
      creatorId: community.creatorId,
      createdAt: community.createdAt,
      memberCount: community.memberCount,
      postCount: community.postCount,
    };

    // Save core fields
    await this.put(this.getCommunityNode(id), gunData);

    // Save rules as indexed object (Gun-friendly)
    if (community.rules.length > 0) {
      const rulesObj = Object.fromEntries(community.rules.map((rule, i) => [i, rule]));
      await this.put(this.getCommunityNode(id).get('rules'), rulesObj);
    }

    return community;
  }

  static subscribeToCommunities(callback: (community: Community) => void): void {
    const seen = new Set<string>();

    this.gun
      .get('communities')
      .map()
      .once((data: any, key: string) => {
        if (!data?.name || !data?.id || seen.has(key) || key.startsWith('_')) {
          return;
        }

        seen.add(key);

        this.loadRules(key).then((rules) => {
          const community = this.mapToCommunity(data, rules);
          callback(community);
        });
      });
  }

  static async getCommunity(communityId: string): Promise<Community | null> {
    const node = this.getCommunityNode(communityId);

    const [data, rules] = await Promise.all([
      this.once<any>(node),
      this.loadRules(communityId),
    ]);

    if (!data || !data.name) {
      return null;
    }

    return this.mapToCommunity(data, rules);
  }

  static async joinCommunity(communityId: string): Promise<void> {
    const community = await this.getCommunity(communityId);
    if (!community) {
      throw new Error('Community not found');
    }

    const newCount = community.memberCount + 1;

    await this.put(
      this.getCommunityNode(communityId).get('memberCount'),
      newCount
    );
  }

  static async getAllCommunities(): Promise<Community[]> {
    return new Promise<Community[]>((resolve) => {
      const communities: Community[] = [];
      const seen = new Set<string>();

      this.gun
        .get('communities')
        .map()
        .once(async (data: any, key: string) => {
          if (!data?.name || !data?.id || seen.has(key) || key.startsWith('_')) return;
          seen.add(key);

          const rules = await this.loadRules(key);
          communities.push(this.mapToCommunity(data, rules));
        });

      // Gun eventual consistency window
      setTimeout(() => resolve(communities), 1200);
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private static put(node: any, value: any): Promise<void> {
    return new Promise((res, rej) =>
      node.put(value, (ack: any) => (ack.err ? rej(ack.err) : res()))
    );
  }

  private static once<T = any>(node: any): Promise<T | null> {
    return new Promise((res) => {
      let done = false;
      node.once((val: any) => {
        if (!done) {
          done = true;
          res(val ?? null);
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          res(null);
        }
      }, 800);
    });
  }

  private static async loadRules(communityId: string): Promise<string[]> {
    const rulesNode = this.getCommunityNode(communityId).get('rules');
    const data = await this.once<any>(rulesNode);

    if (!data || typeof data !== 'object') {
      return [];
    }

    return Object.keys(data)
      .filter((k) => !k.startsWith('_'))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => data[k] as string)
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