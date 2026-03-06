import type { ChainBlock, Vote, Receipt, Poll } from '../types/chain';
import type { Post } from './postService';
import type { Community } from './communityService';
import type { Comment } from './commentService';
import type { UserProfile } from './userService';
import type { NostrEvent } from '../types/nostr';
import { StorageService } from './storageService';
import { GunService, GUN_NAMESPACE } from './gunService';
import config from '../config';

export interface NetworkSnapshot {
  version: '2.0';
  exportDate: number;
  meta: {
    gunNamespace: string;
    blockHeight: number;
    communityCount: number;
    postCount: number;
    commentCount: number;
    userCount: number;
    relayUrls: { ws: string; gun: string; api: string };
  };
  chain: {
    blocks: ChainBlock[];
    votes: Vote[];
    receipts: Receipt[];
    polls: Poll[];
  };
  gun: {
    posts: Post[];
    communities: Community[];
    comments: Comment[];
    users: UserProfile[];
    events: NostrEvent[];
  };
}

export interface ImportResult {
  imported: {
    blocks: number;
    posts: number;
    communities: number;
    comments: number;
    users: number;
    events: number;
  };
}

type ProgressCallback = (phase: string, current: number, total: number) => void;

const DANGEROUS_KEYS = new Set(['_', '__proto__', 'constructor', 'prototype']);

function sanitizeObject(data: any): Record<string, any> {
  const clean: Record<string, any> = Object.create(null);
  for (const key of Object.keys(data)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    clean[key] = data[key];
  }
  return clean;
}

export class SnapshotService {
  private static async enumerateGunNode<T>(rootPath: string, timeout = 5000): Promise<T[]> {
    return new Promise((resolve) => {
      const items: T[] = [];
      let settled = false;
      const gun = GunService.getGun();

      gun.get(rootPath).map().once((data: any, key: string) => {
        if (settled || !data || key === '_') return;
        items.push(sanitizeObject(data) as T);
      });

      setTimeout(() => {
        settled = true;
        resolve([...items]);
      }, timeout);
    });
  }

  private static async fetchGunRelayData<T>(path: string): Promise<T[]> {
    try {
      const gunRelayBase = config.relay.gun.endsWith('/gun')
        ? config.relay.gun.slice(0, -4)
        : config.relay.gun;
      const encodedPrefix = encodeURIComponent(`${GUN_NAMESPACE}/${path}`);
      const res = await fetch(`${gunRelayBase}/db/search?prefix=${encodedPrefix}&limit=5000`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      return data.map((item: any) => sanitizeObject(item) as T);
    } catch {
      return [];
    }
  }

  private static mergeById<T extends { id: string }>(local: T[], remote: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of local) map.set(item.id, item);
    for (const item of remote) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
    return Array.from(map.values());
  }

  static async export(): Promise<NetworkSnapshot> {
    // Collect IndexedDB chain data
    const [blocks, polls, receipts] = await Promise.all([
      StorageService.getAllBlocks(),
      StorageService.getAllPolls(),
      StorageService.getAllReceipts(),
    ]);

    // Collect votes per poll
    const votes: Vote[] = [];
    for (const poll of polls) {
      const pollVotes = await StorageService.getVotesByPoll(poll.id);
      votes.push(...pollVotes);
    }

    // Collect GunDB data via local enumeration
    const [localPosts, localCommunities, localComments, localUsers, localEvents] = await Promise.all([
      this.enumerateGunNode<Post>('posts'),
      this.enumerateGunNode<Community>('communities'),
      this.enumerateGunNode<Comment>('comments'),
      this.enumerateGunNode<UserProfile>('users'),
      this.enumerateGunNode<NostrEvent>('events'),
    ]);

    // Fetch from relay REST API as fallback for more complete data
    const [remotePosts, remoteCommunities, remoteComments, remoteUsers, remoteEvents] = await Promise.all([
      this.fetchGunRelayData<Post>('posts'),
      this.fetchGunRelayData<Community>('communities'),
      this.fetchGunRelayData<Comment>('comments'),
      this.fetchGunRelayData<UserProfile>('users'),
      this.fetchGunRelayData<NostrEvent>('events'),
    ]);

    const posts = this.mergeById(localPosts, remotePosts);
    const communities = this.mergeById(localCommunities, remoteCommunities);
    const comments = this.mergeById(localComments, remoteComments);
    const users = this.mergeById(localUsers, remoteUsers);
    const events = this.mergeById(localEvents, remoteEvents);

    const blockHeight = blocks.length > 0
      ? Math.max(...blocks.map((b: ChainBlock) => b.index))
      : 0;

    return {
      version: '2.0',
      exportDate: Date.now(),
      meta: {
        gunNamespace: GUN_NAMESPACE,
        blockHeight,
        communityCount: communities.length,
        postCount: posts.length,
        commentCount: comments.length,
        userCount: users.length,
        relayUrls: {
          ws: config.relay.websocket,
          gun: config.relay.gun,
          api: config.relay.api,
        },
      },
      chain: { blocks, votes, receipts, polls },
      gun: { posts, communities, comments, users, events },
    };
  }

  static async import(
    snapshot: NetworkSnapshot,
    onProgress?: ProgressCallback,
  ): Promise<ImportResult> {
    if (snapshot.version !== '2.0') {
      throw new Error(`Unsupported snapshot version: ${snapshot.version}`);
    }

    const result: ImportResult = {
      imported: { blocks: 0, posts: 0, communities: 0, comments: 0, users: 0, events: 0 },
    };

    // Import chain data
    const { blocks, polls, receipts, votes } = snapshot.chain;
    const totalChain = blocks.length + polls.length + receipts.length + votes.length;
    let chainProgress = 0;

    for (const block of blocks) {
      await StorageService.saveBlock(block);
      result.imported.blocks++;
      chainProgress++;
      onProgress?.('chain', chainProgress, totalChain);
    }
    for (const poll of polls) {
      await StorageService.savePoll(poll);
      chainProgress++;
      onProgress?.('chain', chainProgress, totalChain);
    }
    for (const receipt of receipts) {
      await StorageService.saveReceipt(receipt);
      chainProgress++;
      onProgress?.('chain', chainProgress, totalChain);
    }
    for (const vote of votes) {
      await StorageService.saveVote(vote);
      chainProgress++;
      onProgress?.('chain', chainProgress, totalChain);
    }

    // Import GunDB data
    const gun = GunService.getGun();
    const { posts, communities, comments, users, events } = snapshot.gun;
    const totalGun = posts.length + communities.length + comments.length + users.length + events.length;
    let gunProgress = 0;

    for (const post of posts) {
      gun.get('posts').get(post.id).put(post);
      // Also write to community-specific path so subscriptions pick it up
      if (post.communityId) {
        gun.get('communities').get(post.communityId).get('posts').get(post.id).put(post);
      }
      result.imported.posts++;
      gunProgress++;
      onProgress?.('gun', gunProgress, totalGun);
    }
    for (const community of communities) {
      gun.get('communities').get(community.id).put(community);
      result.imported.communities++;
      gunProgress++;
      onProgress?.('gun', gunProgress, totalGun);
    }
    for (const comment of comments) {
      gun.get('comments').get(comment.id).put(comment);
      // Also write to post-specific path
      if (comment.postId) {
        gun.get('posts').get(comment.postId).get('comments').get(comment.id).put(comment);
      }
      result.imported.comments++;
      gunProgress++;
      onProgress?.('gun', gunProgress, totalGun);
    }
    for (const user of users) {
      gun.get('users').get(user.id).put(user);
      result.imported.users++;
      gunProgress++;
      onProgress?.('gun', gunProgress, totalGun);
    }
    for (const event of events) {
      gun.get('events').get(event.id).put(event);
      result.imported.events++;
      gunProgress++;
      onProgress?.('gun', gunProgress, totalGun);
    }

    return result;
  }

  static downloadSnapshot(snapshot: NetworkSnapshot): void {
    const json = JSON.stringify(snapshot);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const filename = `interpoll-snapshot-${yyyy}-${mm}-${dd}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  static async parseSnapshotFile(file: File): Promise<NetworkSnapshot> {
    const MAX_SNAPSHOT_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_SNAPSHOT_SIZE) {
      throw new Error(`Snapshot file too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 50 MB)`);
    }

    const text = await file.text();

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid file: not valid JSON');
    }

    if (parsed.version !== '2.0') {
      throw new Error(`Unsupported snapshot version: ${parsed.version}`);
    }
    if (!Array.isArray(parsed.chain?.blocks) || !Array.isArray(parsed.chain?.polls) ||
        !Array.isArray(parsed.chain?.receipts) || !Array.isArray(parsed.chain?.votes)) {
      throw new Error('Invalid snapshot: chain data must contain arrays');
    }
    if (!Array.isArray(parsed.gun?.posts) || !Array.isArray(parsed.gun?.communities) ||
        !Array.isArray(parsed.gun?.comments) || !Array.isArray(parsed.gun?.users) ||
        !Array.isArray(parsed.gun?.events)) {
      throw new Error('Invalid snapshot: gun data must contain arrays');
    }

    return parsed as NetworkSnapshot;
  }
}
