// src/services/communityService.ts
import { GunService, GUN_NAMESPACE } from './gunService';
import config from '../config';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import type { DecryptedCommunityMeta, StoredEncryptionKey } from '../types/encryption';

/** How long to wait for a Gun put ack before continuing without it. */
const PUT_ACK_TIMEOUT_MS = 6_000;
/** How many times to (re)write community metadata while the relay denies holding it. */
const WRITE_CONFIRM_ATTEMPTS = 3;

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
  creatorPubkey?: string;
  creatorSignature?: string;
  isEncrypted?: boolean;
  encryptionHint?: string;
  encryptedMeta?: string;
  isPrivate?: boolean;
  category?: string;
  tags?: string[];
  nsfw?: boolean;
}

export class CommunityService {
  private static get gun() { return GunService.getGun(); }
  private static getCommunityNode(id: string) { return this.gun.get('communities').get(id); }
  // Bounded: one entry per community ever visited, previously never released.
  // Subscriptions and in-flight promises below are deliberately NOT bounded —
  // evicting those would leak the underlying listener rather than free anything.
  private static readonly rulesCache = new BoundedMap<string, string[]>({ maxSize: 200 });
  private static readonly rulesLoadPromises = new Map<string, Promise<string[]>>();
  private static readonly rulesLoaded = new BoundedSet<string>({ maxSize: 200 });
  private static readonly rulesSubscriptions = new Map<string, any>();
  private static readonly communityDataCache = new BoundedMap<string, any>({ maxSize: 150 });
  private static readonly liveCallbacks = new Set<(community: Community) => void>();
  private static liveCommunityListener: any = null;

  /**
   * Release cached community data under memory pressure. Called by the memory
   * watchdog (see main.ts). Subscriptions are left alone — they are live
   * listeners, not cached data, and dropping them would break live updates.
   */
  static trimCaches(level: 'light' | 'aggressive' | 'emergency'): void {
    this.rulesCache.prune();
    this.rulesLoaded.prune();
    this.communityDataCache.prune();
    if (level === 'aggressive' || level === 'emergency') {
      this.communityDataCache.clear();
    }
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  static async createCommunity(data: {
    name: string; displayName: string; description: string;
    rules: string[]; creatorId: string;
    category?: string; nsfw?: boolean; isPrivate?: boolean;
  }): Promise<Community> {
    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`;
    const community: Community = {
      id, name: data.name, displayName: data.displayName,
      description: data.description, rules: data.rules,
      creatorId: data.creatorId, createdAt: Date.now(), memberCount: 1, postCount: 0,
      category: data.category, nsfw: data.nsfw, isPrivate: data.isPrivate,
    };

    const gunData: Record<string, any> = {
      id: community.id, name: community.name, displayName: community.displayName,
      description: community.description, creatorId: community.creatorId,
      createdAt: community.createdAt, memberCount: community.memberCount,
      postCount: community.postCount,
      category: community.category || null, nsfw: !!community.nsfw, isPrivate: !!community.isPrivate,
    };

    // Sign community creation for anti-sabotage verification
    try {
      const keyPair = await KeyService.getKeyPair();
      const contentHash = CryptoService.hash(JSON.stringify({
        name: community.name,
        displayName: community.displayName,
        description: community.description,
        creatorId: community.creatorId,
        timestamp: community.createdAt,
      }));
      const signature = CryptoService.sign(contentHash, keyPair.privateKey);
      community.creatorPubkey = keyPair.publicKey;
      community.creatorSignature = signature;
      gunData.creatorPubkey = keyPair.publicKey;
      gunData.creatorSignature = signature;
    } catch (err) {
      console.warn('Failed to sign community creation:', err);
    }

    const confirmed = await this.confirmCommunityWrite(id, gunData);
    if (!confirmed) {
      console.warn(`[CommunityService] ${id} created locally but not confirmed on the relay`);
    }

    if (community.rules.length > 0) {
      const rulesObj = Object.fromEntries(community.rules.map((rule, i) => [i, rule]));
      await this.put(this.getCommunityNode(id).get('rules'), rulesObj, `communities/${id}/rules`);
    }

    return community;
  }

  // ─── Create (private / encrypted) ──────────────────────────────────────────

  static async createPrivateCommunity(data: {
    name: string; displayName: string; description: string;
    rules: string[]; creatorId: string;
    category?: string; nsfw?: boolean;
  }, password?: string): Promise<{ community: Community; inviteLink: string }> {
    if (password !== undefined) {
      password = password.trim();
      if (password.length < 12) {
        throw new Error('Password must be at least 12 characters');
      }
    }

    const id = `c-${data.name.toLowerCase().replace(/\s+/g, '-')}`;
    const createdAt = Date.now();

    let aesKey: CryptoKey;
    let method: StoredEncryptionKey['method'];
    if (password) {
      aesKey = await EncryptionService.deriveKeyFromPassword(password, id + 'interpoll-v2');
      method = 'password';
    } else {
      aesKey = await EncryptionService.generateKey();
      method = 'invite';
    }

    const meta: DecryptedCommunityMeta = {
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      rules: data.rules,
    };
    const encryptedMeta = await EncryptionService.encrypt(JSON.stringify(meta), aesKey);

    const encryptionHint = password ? 'Password-protected' : 'Invite-only';
    const gunData: Record<string, any> = {
      id,
      isEncrypted: true,
      isPrivate: true,
      category: data.category || null,
      nsfw: !!data.nsfw,
      encryptionHint,
      encryptedMeta,
      creatorId: data.creatorId,
      createdAt,
      memberCount: 1,
      postCount: 0,
      name: '🔒 Private Community',
      displayName: '🔒 Private Community',
      description: 'This community is encrypted. Use an invite link or password to access.',
    };

    try {
      const keyPair = await KeyService.getKeyPair();
      const contentHash = CryptoService.hash(JSON.stringify({
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        creatorId: data.creatorId,
        timestamp: createdAt,
      }));
      const signature = CryptoService.sign(contentHash, keyPair.privateKey);
      gunData.creatorPubkey = keyPair.publicKey;
      gunData.creatorSignature = signature;
    } catch (err) {
      console.warn('Failed to sign community creation:', err);
    }

    const confirmed = await this.confirmCommunityWrite(id, gunData);
    if (!confirmed) {
      console.warn(`[CommunityService] ${id} created locally but not confirmed on the relay`);
    }

    const keyBase64 = await EncryptionService.exportKey(aesKey);
    await KeyVaultService.storeKey({
      id,
      type: 'community',
      key: keyBase64,
      method,
      label: data.displayName,
      joinedAt: Date.now(),
    });

    let inviteLink = '';
    if (method === 'invite') {
      const keyBase64Url = await EncryptionService.exportKeyAsBase64Url(aesKey);
      inviteLink = InviteLinkService.generateInviteLink(id, 'community', keyBase64Url);
    }

    const community: Community = {
      id,
      name: data.name,
      displayName: data.displayName,
      description: data.description,
      rules: data.rules,
      creatorId: data.creatorId,
      createdAt,
      memberCount: 1,
      postCount: 0,
      isEncrypted: true,
      isPrivate: true,
      category: data.category,
      nsfw: !!data.nsfw,
      encryptionHint,
      encryptedMeta,
      creatorPubkey: gunData.creatorPubkey,
      creatorSignature: gunData.creatorSignature,
    };

    return { community, inviteLink };
  }

  // ─── Decrypt / Join (private) ─────────────────────────────────────────────

  /**
   * Attempt to decrypt an encrypted community's metadata using a stored key.
   * Returns a Community with decrypted fields, or null if no key is available.
   */
  static async decryptCommunityMeta(community: Community): Promise<Community | null> {
    if (!community.isEncrypted || !community.encryptedMeta) return community;

    const storedKey = await KeyVaultService.getKey(community.id);
    if (!storedKey) return null;

    try {
      const aesKey = await EncryptionService.importKey(storedKey.key);
      const decrypted: DecryptedCommunityMeta = JSON.parse(
        await EncryptionService.decrypt(community.encryptedMeta, aesKey)
      );
      if (typeof decrypted.name !== 'string' || typeof decrypted.displayName !== 'string'
          || typeof decrypted.description !== 'string' || !Array.isArray(decrypted.rules)
          || !decrypted.rules.every((r: unknown) => typeof r === 'string')) {
        return null;
      }
      return {
        ...community,
        name: decrypted.name,
        displayName: decrypted.displayName,
        description: decrypted.description,
        rules: decrypted.rules,
      };
    } catch {
      return null;
    }
  }

  /**
   * Join a private community using an AES key (from invite link) or password.
   * Stores the key locally and increments member count.
   */
  static async joinPrivateCommunity(
    communityId: string,
    keyOrPassword: string,
    method: 'invite' | 'password'
  ): Promise<Community> {
    let aesKey: CryptoKey;
    if (method === 'password') {
      aesKey = await EncryptionService.deriveKeyFromPassword(keyOrPassword.trim(), communityId + 'interpoll-v2');
    } else {
      aesKey = await EncryptionService.importKeyFromBase64Url(keyOrPassword);
    }

    const community = await this.getCommunity(communityId);
    if (!community || !community.encryptedMeta) {
      throw new Error('Community not found or not encrypted');
    }

    let decryptedMeta: DecryptedCommunityMeta;
    try {
      decryptedMeta = JSON.parse(await EncryptionService.decrypt(community.encryptedMeta, aesKey));
      if (typeof decryptedMeta.name !== 'string' || typeof decryptedMeta.displayName !== 'string'
          || typeof decryptedMeta.description !== 'string' || !Array.isArray(decryptedMeta.rules)
          || !decryptedMeta.rules.every((r: unknown) => typeof r === 'string')) {
        throw new Error('Invalid decrypted metadata format');
      }
    } catch {
      throw new Error('Invalid key or password — could not decrypt community');
    }

    // Only store key and increment count if not already a member
    const existingKey = await KeyVaultService.getKey(communityId);
    const keyBase64 = await EncryptionService.exportKey(aesKey);
    await KeyVaultService.storeKey({
      id: communityId,
      type: 'community',
      key: keyBase64,
      method,
      label: decryptedMeta.displayName || decryptedMeta.name,
      joinedAt: Date.now(),
    });

    if (!existingKey) {
      await this.put(
        this.getCommunityNode(communityId).get('memberCount'),
        community.memberCount + 1
      );
    }

    return {
      ...community,
      name: decryptedMeta.name,
      displayName: decryptedMeta.displayName,
      description: decryptedMeta.description,
      rules: decryptedMeta.rules,
    };
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
    this.liveCallbacks.add(callback);
    this.ensureLiveCommunityListener();

    return () => {
      this.liveCallbacks.delete(callback);
      if (this.liveCallbacks.size === 0) {
        this.cleanupLiveSubscriptions();
      }
    };
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
      this.loadRulesCached(communityId),
    ]);
    if (!data?.name) return null;
    this.rulesCache.set(communityId, rules);
    this.rulesLoaded.add(communityId);
    return this.mapToCommunity(data, rules);
  }

  static async joinCommunity(communityId: string, localFallback?: { memberCount: number }): Promise<void> {
    let community = await this.getCommunity(communityId);
    if (!community && localFallback) {
      // Community exists in API/store but not yet in GunDB — skip remote write
      return;
    }
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

  /**
   * Gun is initialised with `localStorage:false, radisk:false`, so a put ack can
   * only ever come from a peer. When the relay socket is mid-reconnect, rate
   * limiting, or the graph node gets evicted under memory pressure, that ack
   * never arrives — an unbounded `await` there left "Creating…" spinning forever
   * with no error. Always resolve: ack, ack error, or timeout. Durability is the
   * job of confirmCommunityWrite() below, not of this ack.
   */
  private static put(node: any, value: any, label = 'community', timeoutMs = PUT_ACK_TIMEOUT_MS): Promise<void> {
    return new Promise((res) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; res(); } };
      const timer = setTimeout(() => {
        console.warn(`[CommunityService] Gun ack timeout for ${label} — continuing`);
        finish();
      }, timeoutMs);
      try {
        node.put(value, (ack: any) => {
          clearTimeout(timer);
          if (ack?.err) console.warn(`[CommunityService] Gun ack error for ${label}:`, ack.err);
          finish();
        });
      } catch (err) {
        clearTimeout(timer);
        console.warn(`[CommunityService] Gun put threw for ${label}:`, err);
        finish();
      }
    });
  }

  /**
   * Ask the relay's DB mirror whether the community's *metadata* actually landed.
   *
   * Soul existence is not enough: a community soul is also created by the child
   * links Gun writes for `polls`/`posts`, so several communities exist on the
   * relay as `{polls:…, posts:…}` with no name at all — created while the ack
   * was lost. Only a `createdAt` field proves the metadata write persisted.
   *
   * Returns true (relay has it), false (relay reachable, metadata absent) or
   * null (relay unreachable — inconclusive).
   */
  private static async verifyRelayPersistence(id: string, deadlineMs = 5_000): Promise<boolean | null> {
    const soul = encodeURIComponent(`${GUN_NAMESPACE}/communities/${id}`);
    const url = `${config.relay.gun.replace(/\/gun$/, '')}/db/soul?soul=${soul}`;
    const deadline = Date.now() + deadlineMs;
    const retryDelayMs = 1_000;
    let reachable = false;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3_000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          if (json?.data && typeof json.data === 'object' && json.data.createdAt) return true;
          reachable = true;
        } else if (res.status === 404) {
          reachable = true;
        }
      } catch {
        // Network error / abort — relay state unknown for this attempt.
      } finally {
        clearTimeout(timer);
      }
      if (Date.now() + retryDelayMs > deadline) return reachable ? false : null;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  /**
   * Write community metadata and make sure it survives. Re-puts (with a fresh
   * ack wait) whenever the relay says it does not hold the metadata, so a
   * community created during a reconnect/eviction window is not left as a
   * nameless husk that every other peer sees as an empty node.
   */
  private static async confirmCommunityWrite(id: string, gunData: Record<string, any>): Promise<boolean> {
    for (let attempt = 1; attempt <= WRITE_CONFIRM_ATTEMPTS; attempt++) {
      // Last attempt writes the soul directly off the raw root instead of through
      // the cached namespace chain. If that chain is broken (its `root.next` entry
      // was evicted), every chained put silently produces no wire message at all;
      // a soul-addressed put still reaches the relay.
      const node = attempt === WRITE_CONFIRM_ATTEMPTS
        ? GunService.getRawGun().get(`${GUN_NAMESPACE}/communities/${id}`)
        : this.getCommunityNode(id);
      await this.put(node, gunData, `communities/${id} (attempt ${attempt})`);
      const confirmed = await this.verifyRelayPersistence(id);
      if (confirmed === true) return true;
      if (confirmed === null) {
        // Relay unreachable — nothing to gain from re-putting into the void.
        console.warn(`[CommunityService] Relay unreachable; ${id} unconfirmed`);
        return false;
      }
      console.warn(`[CommunityService] Relay does not hold ${id} yet (attempt ${attempt}) — re-putting`);
    }
    return false;
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
    return this.parseRules(data);
  }

  private static loadRulesCached(communityId: string): Promise<string[]> {
    if (this.rulesLoaded.has(communityId)) {
      return Promise.resolve(this.rulesCache.get(communityId) ?? []);
    }

    const inFlight = this.rulesLoadPromises.get(communityId);
    if (inFlight) return inFlight;

    const loadPromise = this.loadRules(communityId)
      .then((rules) => {
        this.rulesCache.set(communityId, rules);
        this.rulesLoaded.add(communityId);
        return rules;
      })
      .finally(() => {
        this.rulesLoadPromises.delete(communityId);
      });

    this.rulesLoadPromises.set(communityId, loadPromise);
    return loadPromise;
  }

  private static ensureRulesSubscription(communityId: string): void {
    if (this.rulesSubscriptions.has(communityId)) return;
    const listener = this.getCommunityNode(communityId)
      .get('rules')
      .on((rulesData: unknown) => {
        const parsedRules = this.parseRules(rulesData);
        this.rulesCache.set(communityId, parsedRules);
        this.rulesLoaded.add(communityId);
        this.emitCommunityFromCache(communityId, parsedRules);
      });
    this.rulesSubscriptions.set(communityId, listener);
  }

  private static ensureLiveCommunityListener(): void {
    if (this.liveCommunityListener) return;
    this.liveCommunityListener = this.gun
      .get('communities')
      .map()
      .on((data: any, key: string) => {
        if (!data?.id || key.startsWith('_')) return;
        this.communityDataCache.set(key, data);
        this.ensureRulesSubscription(key);

        const hasRulesField = Object.prototype.hasOwnProperty.call(data, 'rules');
        if (hasRulesField) {
          const inlineRules = this.parseRules(data.rules);
          this.rulesCache.set(key, inlineRules);
          this.rulesLoaded.add(key);
          this.emitCommunity(this.mapToCommunity(data, inlineRules));
          return;
        }

        if (this.rulesLoaded.has(key)) {
          const cachedRules = this.rulesCache.get(key) ?? [];
          this.emitCommunity(this.mapToCommunity(data, cachedRules));
          return;
        }

        this.loadRulesCached(key).then((rules) => {
          this.emitCommunity(this.mapToCommunity(data, rules));
        });
      });
  }

  private static emitCommunity(community: Community): void {
    for (const callback of this.liveCallbacks) {
      callback(community);
    }
  }

  private static emitCommunityFromCache(communityId: string, rules: string[]): void {
    const data = this.communityDataCache.get(communityId);
    if (!data?.id) return;
    this.emitCommunity(this.mapToCommunity(data, rules));
  }

  private static cleanupLiveSubscriptions(): void {
    if (this.liveCommunityListener) {
      this.liveCommunityListener.off();
      this.liveCommunityListener = null;
    }
    for (const listener of this.rulesSubscriptions.values()) {
      listener?.off?.();
    }
    this.rulesSubscriptions.clear();
    this.rulesCache.clear();
    this.rulesLoadPromises.clear();
    this.rulesLoaded.clear();
    this.communityDataCache.clear();
  }

  private static parseRules(data: unknown): string[] {
    if (Array.isArray(data)) {
      return data.filter((value): value is string => typeof value === 'string' && value.length > 0);
    }
    if (!data || typeof data !== 'object') return [];
    return Object.keys(data as Record<string, unknown>)
      .filter(k => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (data as Record<string, unknown>)[k])
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
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
      creatorPubkey: data.creatorPubkey || undefined,
      creatorSignature: data.creatorSignature || undefined,
      isEncrypted: data.isEncrypted || false,
      encryptionHint: data.encryptionHint || undefined,
      encryptedMeta: data.encryptedMeta || undefined,
      isPrivate: !!data.isPrivate,
      category: data.category || undefined,
      nsfw: !!data.nsfw,
      tags: Array.isArray(data.tags) ? data.tags : undefined,
    };
  }

  /** Verify the Schnorr signature on a community for anti-sabotage */
  static verifyCommunitySignature(community: Community): 'verified' | 'unverified' | 'unsigned' {
    if (!community.creatorPubkey || !community.creatorSignature) return 'unsigned';
    try {
      const contentHash = CryptoService.hash(JSON.stringify({
        name: community.name,
        displayName: community.displayName,
        description: community.description,
        creatorId: community.creatorId,
        timestamp: community.createdAt,
      }));
      const valid = CryptoService.verify(contentHash, community.creatorSignature, community.creatorPubkey);
      return valid ? 'verified' : 'unverified';
    } catch {
      return 'unverified';
    }
  }
}
