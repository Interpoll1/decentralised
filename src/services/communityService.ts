// src/services/communityService.ts
import { GunService } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import type { DecryptedCommunityMeta, StoredEncryptionKey } from '../types/encryption';

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

    const gunData: Record<string, any> = {
      id: community.id, name: community.name, displayName: community.displayName,
      description: community.description, creatorId: community.creatorId,
      createdAt: community.createdAt, memberCount: community.memberCount,
      postCount: community.postCount,
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

    await this.put(this.getCommunityNode(id), gunData);

    if (community.rules.length > 0) {
      const rulesObj = Object.fromEntries(community.rules.map((rule, i) => [i, rule]));
      await this.put(this.getCommunityNode(id).get('rules'), rulesObj);
    }

    return community;
  }

  // ─── Create (private / encrypted) ──────────────────────────────────────────

  static async createPrivateCommunity(data: {
    name: string; displayName: string; description: string;
    rules: string[]; creatorId: string;
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

    await this.put(this.getCommunityNode(id), gunData);

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
      creatorPubkey: data.creatorPubkey || undefined,
      creatorSignature: data.creatorSignature || undefined,
      isEncrypted: data.isEncrypted || false,
      encryptionHint: data.encryptionHint || undefined,
      encryptedMeta: data.encryptedMeta || undefined,
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
