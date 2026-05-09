// src/services/communityService.ts
import { GunService } from './gunService';
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import { DeviceKeyService } from './deviceKeyService';
import { UserService } from './userService';
import config from '@/config';
import type {
  CommunityKeyEnvelope,
  DecryptedCommunityMeta,
  DeviceApprovalRequest,
  StoredEncryptionKey,
} from '../types/encryption';

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
  keyRingRequired?: boolean;
  currentKeyVersion?: number;
}

export interface BackendDeviceApprovalRequestSummary {
  communityId: string;
  devicePublicKey: string;
  requestedAt: number;
  method: 'invite' | 'password';
  userId?: string;
  deviceEncryptionPublicKey?: string;
  signature?: string;
}

export interface BackendCommunityKeyRingEntrySummary {
  communityId: string;
  devicePublicKey: string;
  deviceEncryptionPublicKey: string;
  approvedBy: string;
  keyVersion: number;
  updatedAt: number;
  signature?: string;
}

export class CommunityService {
  private static get gun() { return GunService.getGun(); }
  private static readonly backendSyncQueueKey = 'interpoll-community-backend-sync-queue';
  private static backendSyncQueueLock: Promise<void> = Promise.resolve();
  private static getCommunityNode(id: string) { return this.gun.get('communities').get(id); }
  private static readonly rulesCache = new Map<string, string[]>();
  private static readonly rulesLoadPromises = new Map<string, Promise<string[]>>();
  private static readonly rulesLoaded = new Set<string>();
  private static readonly rulesSubscriptions = new Map<string, any>();
  private static readonly communityDataCache = new Map<string, any>();
  private static readonly liveCallbacks = new Set<(community: Community) => void>();
  private static liveCommunityListener: any = null;
  private static getDeviceKeyRingNode(communityId: string) {
    return this.getCommunityNode(communityId).get('keyRing');
  }
  private static getDeviceRequestNode(communityId: string) {
    return this.getCommunityNode(communityId).get('deviceRequests');
  }
  private static envelopePayload(payload: {
    communityId: string;
    devicePublicKey: string;
    deviceEncryptionPublicKey: string;
    encryptedCommunityKey: string;
    keyVersion: number;
    approvedBy: string;
    updatedAt: number;
  }): string {
    return JSON.stringify({
      approvedBy: payload.approvedBy,
      communityId: payload.communityId,
      deviceEncryptionPublicKey: payload.deviceEncryptionPublicKey,
      devicePublicKey: payload.devicePublicKey,
      encryptedCommunityKey: payload.encryptedCommunityKey,
      keyVersion: payload.keyVersion,
      updatedAt: payload.updatedAt,
    });
  }

  private static async createSignedEnvelope(params: {
    communityId: string;
    devicePublicKey: string;
    deviceEncryptionPublicKey: string;
    communityKeyBase64: string;
    keyVersion: number;
  }): Promise<CommunityKeyEnvelope> {
    const [approverIdentity, encryptedCommunityKey] = await Promise.all([
      KeyService.getKeyPair(),
      DeviceKeyService.encryptForDevice(params.deviceEncryptionPublicKey, params.communityKeyBase64),
    ]);
    const updatedAt = Date.now();
    const payload = this.envelopePayload({
      communityId: params.communityId,
      devicePublicKey: params.devicePublicKey,
      deviceEncryptionPublicKey: params.deviceEncryptionPublicKey,
      encryptedCommunityKey,
      keyVersion: params.keyVersion,
      approvedBy: approverIdentity.publicKey,
      updatedAt,
    });
    const signature = CryptoService.sign(CryptoService.hash(payload), approverIdentity.privateKey);
    return {
      encryptedCommunityKey,
      deviceEncryptionPublicKey: params.deviceEncryptionPublicKey,
      approvedBy: approverIdentity.publicKey,
      signature,
      updatedAt,
      keyVersion: params.keyVersion,
    };
  }

  private static verifyEnvelope(
    communityId: string,
    devicePublicKey: string,
    envelope: CommunityKeyEnvelope,
  ): boolean {
    const payload = this.envelopePayload({
      communityId,
      devicePublicKey,
      deviceEncryptionPublicKey: envelope.deviceEncryptionPublicKey,
      encryptedCommunityKey: envelope.encryptedCommunityKey,
      keyVersion: envelope.keyVersion,
      approvedBy: envelope.approvedBy,
      updatedAt: envelope.updatedAt,
    });
    const hash = CryptoService.hash(payload);
    return CryptoService.verify(hash, envelope.signature, envelope.approvedBy);
  }

  private static async createSignedDeviceRequest(
    userId: string,
    method: DeviceApprovalRequest['method'],
  ): Promise<DeviceApprovalRequest> {
    const [identity, deviceEncryptionPublicKey] = await Promise.all([
      KeyService.getKeyPair(),
      DeviceKeyService.getPublicKeyBase64(),
    ]);
    const requestedAt = Date.now();
    const payload = JSON.stringify({
      deviceEncryptionPublicKey,
      devicePublicKey: identity.publicKey,
      method,
      requestedAt,
      userId,
    });
    const signature = CryptoService.sign(CryptoService.hash(payload), identity.privateKey);
    return {
      userId,
      devicePublicKey: identity.publicKey,
      deviceEncryptionPublicKey,
      requestedAt,
      method,
      signature,
    };
  }

  private static slugifyCommunityName(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
  }

  private static async generateCommunityId(name: string): Promise<string> {
    const baseId = `c-${this.slugifyCommunityName(name)}`;
    const existing = await this.getCommunity(baseId);
    if (!existing) return baseId;
    return `${baseId}-${Date.now().toString(36)}`;
  }

  private static async postCommunityApi(path: string, payload: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${config.relay.api}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Community backend request failed (${response.status}): ${body || response.statusText}`);
    }
  }

  private static getBackendSyncQueue(): Array<{ path: string; payload: Record<string, unknown> }> {
    try {
      const raw = localStorage.getItem(this.backendSyncQueueKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => (
        item
        && typeof item === 'object'
        && typeof item.path === 'string'
        && item.payload
        && typeof item.payload === 'object'
      ));
    } catch {
      return [];
    }
  }

  private static setBackendSyncQueue(queue: Array<{ path: string; payload: Record<string, unknown> }>): void {
    try {
      localStorage.setItem(this.backendSyncQueueKey, JSON.stringify(queue.slice(0, 100)));
    } catch (error) {
      console.warn('Failed to persist backend sync queue', error);
    }
  }

  private static async withBackendSyncQueueLock<T>(task: () => Promise<T> | T): Promise<T> {
    const previousLock = this.backendSyncQueueLock;
    let releaseLock: (() => void) | null = null;
    this.backendSyncQueueLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await previousLock;
    try {
      return await task();
    } finally {
      releaseLock?.();
    }
  }

  private static async queueBackendSync(path: string, payload: Record<string, unknown>): Promise<void> {
    await this.withBackendSyncQueueLock(() => {
      const queue = this.getBackendSyncQueue();
      queue.push({ path, payload });
      this.setBackendSyncQueue(queue);
    });
  }

  static async flushBackendSyncQueue(): Promise<void> {
    await this.withBackendSyncQueueLock(async () => {
      const queue = this.getBackendSyncQueue();
      if (queue.length === 0) return;
      const remaining: Array<{ path: string; payload: Record<string, unknown> }> = [];
      for (const item of queue) {
        try {
          await this.postCommunityApi(item.path, item.payload);
        } catch {
          remaining.push(item);
        }
      }
      this.setBackendSyncQueue(remaining);
    });
  }

  private static async syncBackendMutation(path: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await this.postCommunityApi(path, payload);
      await this.flushBackendSyncQueue();
    } catch (error) {
      await this.queueBackendSync(path, payload);
      console.warn(`Queued backend sync for retry: ${path}`, error);
    }
  }

  private static async getCommunityApi<T>(path: string): Promise<T> {
    const response = await fetch(`${config.relay.api}${path}`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Community backend request failed (${response.status}): ${body || response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private static async buildReadAuthorizationQuery(
    communityId: string,
    resource: 'requests' | 'keyring',
  ): Promise<string> {
    const identity = await KeyService.getKeyPair();
    const timestamp = Date.now();
    const authPayload = JSON.stringify({
      communityId,
      requesterDevicePublicKey: identity.publicKey,
      resource,
      timestamp,
    });
    const signature = CryptoService.sign(CryptoService.hash(authPayload), identity.privateKey);
    const params = new URLSearchParams({
      requesterDevicePublicKey: identity.publicKey,
      timestamp: String(timestamp),
      signature,
    });
    return params.toString();
  }

  private static async syncDeviceRequestToBackend(
    communityId: string,
    request: DeviceApprovalRequest,
  ): Promise<void> {
    await this.syncBackendMutation('/api/community-device/request', {
      communityId,
      ...request,
    });
  }

  private static async syncKeyRingEntryToBackend(
    communityId: string,
    devicePublicKey: string,
    envelope: CommunityKeyEnvelope,
  ): Promise<void> {
    await this.syncBackendMutation('/api/community-device/approval', {
      communityId,
      devicePublicKey,
      ...envelope,
    });
  }

  private static async syncDeviceRemovalToBackend(
    communityId: string,
    removedDevicePublicKey: string,
    rotatedBy: string,
    keyVersion: number,
  ): Promise<void> {
    const actorIdentity = await KeyService.getKeyPair();
    if (actorIdentity.publicKey !== rotatedBy) {
      throw new Error('Rotation signer does not match the active device identity');
    }
    const rotatedAt = Date.now();
    const payload = JSON.stringify({
      communityId,
      removedDevicePublicKey,
      rotatedBy,
      keyVersion,
      rotatedAt,
    });
    const signature = CryptoService.sign(CryptoService.hash(payload), actorIdentity.privateKey);
    await this.syncBackendMutation('/api/community-device/remove', {
      communityId,
      removedDevicePublicKey,
      rotatedBy,
      keyVersion,
      rotatedAt,
      signature,
    });
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  static async createCommunity(data: {
    name: string; displayName: string; description: string;
    rules: string[]; creatorId: string;
  }): Promise<Community> {
    const id = await this.generateCommunityId(data.name);
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
    await this.markMembershipAndRefreshCount(id, data.creatorId);

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

    const id = await this.generateCommunityId(data.name);
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

    const encryptionHint = password ? 'Password-protected (approval required)' : 'Invite-only (approval required)';
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
      keyRingRequired: true,
      currentKeyVersion: 1,
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

    const [keyBase64, creatorIdentity, creatorEncryptionPubKey, creatorUser] = await Promise.all([
      EncryptionService.exportKey(aesKey),
      KeyService.getKeyPair(),
      DeviceKeyService.getPublicKeyBase64(),
      UserService.getCurrentUser(),
    ]);
    const creatorEnvelope = await this.createSignedEnvelope({
      communityId: id,
      devicePublicKey: creatorIdentity.publicKey,
      deviceEncryptionPublicKey: creatorEncryptionPubKey,
      communityKeyBase64: keyBase64,
      keyVersion: 1,
    });
    await this.put(
      this.getDeviceKeyRingNode(id).get(creatorIdentity.publicKey),
      creatorEnvelope,
    );

    await KeyVaultService.storeCommunityKey({
      id,
      type: 'community',
      key: keyBase64,
      method,
      label: data.displayName,
      joinedAt: Date.now(),
      keyVersion: 1,
    });

    const ownerRequest = await this.createSignedDeviceRequest(creatorUser.id, method);
    await this.put(
      this.getDeviceRequestNode(id).get('owner'),
      ownerRequest,
    );
    await Promise.all([
      this.syncDeviceRequestToBackend(id, ownerRequest),
      this.syncKeyRingEntryToBackend(id, creatorIdentity.publicKey, creatorEnvelope),
    ]);
    await this.markMembershipAndRefreshCount(id, creatorUser.id);

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
      keyRingRequired: true,
      currentKeyVersion: 1,
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

    const communityKeys = await KeyVaultService.listCommunityKeys(community.id);
    for (const storedKey of communityKeys) {
      try {
        const aesKey = await EncryptionService.importKey(storedKey.key);
        const decrypted: DecryptedCommunityMeta = JSON.parse(
          await EncryptionService.decrypt(community.encryptedMeta, aesKey)
        );
        if (typeof decrypted.name !== 'string' || typeof decrypted.displayName !== 'string'
            || typeof decrypted.description !== 'string' || !Array.isArray(decrypted.rules)
            || !decrypted.rules.every((r: unknown) => typeof r === 'string')) {
          continue;
        }
        return {
          ...community,
          name: decrypted.name,
          displayName: decrypted.displayName,
          description: decrypted.description,
          rules: decrypted.rules,
        };
      } catch {
        continue;
      }
    }
    return null;
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
    const [community, currentUser, currentDevice] = await Promise.all([
      this.getCommunity(communityId),
      UserService.getCurrentUser(),
      KeyService.getKeyPair(),
    ]);
    if (!community || !community.encryptedMeta) {
      throw new Error('Community not found or not encrypted');
    }

    // New key-ring mode: invite/password only bootstraps a request; key delivery requires approval.
    if (community.keyRingRequired) {
      const approved = await UserService.isCurrentDeviceApproved(currentUser.id);
      if (!approved) {
        const request = await this.createSignedDeviceRequest(currentUser.id, method);
        await this.put(
          this.getDeviceRequestNode(communityId).get(currentDevice.publicKey),
          request,
        );
        await this.syncDeviceRequestToBackend(communityId, request);
        throw new Error('This device is not approved yet. An already-approved device must approve it first.');
      }

      const [entryRaw, hasExistingCommunityKey] = await Promise.all([
        this.once<any>(this.getDeviceKeyRingNode(communityId).get(currentDevice.publicKey)),
        KeyVaultService.hasKey(communityId),
      ]);
      if (!entryRaw?.encryptedCommunityKey) {
        const request = await this.createSignedDeviceRequest(currentUser.id, method);
        await this.put(
          this.getDeviceRequestNode(communityId).get(currentDevice.publicKey),
          request,
        );
        await this.syncDeviceRequestToBackend(communityId, request);
        throw new Error('Device approval required. Ask an approved device to approve this device for the community.');
      }

      if (!this.verifyEnvelope(communityId, currentDevice.publicKey, entryRaw as CommunityKeyEnvelope)) {
        throw new Error('Community key envelope failed signature verification');
      }
      const approverPubkey = (entryRaw as CommunityKeyEnvelope).approvedBy;
      if (approverPubkey !== currentDevice.publicKey) {
        const approverEnvelope = await this.once<any>(
          this.getDeviceKeyRingNode(communityId).get(approverPubkey),
        );
        if (!approverEnvelope?.encryptedCommunityKey || !this.verifyEnvelope(communityId, approverPubkey, approverEnvelope as CommunityKeyEnvelope)) {
          throw new Error('Community key envelope signer is not trusted in this community');
        }
      }

      const keyBase64 = await DeviceKeyService.decryptForCurrentDevice(entryRaw.encryptedCommunityKey);
      const aesKey = await EncryptionService.importKey(keyBase64);
      const decryptedMeta: DecryptedCommunityMeta = JSON.parse(
        await EncryptionService.decrypt(community.encryptedMeta, aesKey),
      );
      const keyVersion = Number(entryRaw.keyVersion) || Number(community.currentKeyVersion) || 1;
      await KeyVaultService.storeCommunityKey({
        id: communityId,
        type: 'community',
        key: keyBase64,
        method,
        label: decryptedMeta.displayName || decryptedMeta.name,
        joinedAt: Date.now(),
        keyVersion,
      });

      if (!hasExistingCommunityKey) {
        await this.markMembershipAndRefreshCount(communityId, currentUser.id);
      }
      return {
        ...community,
        name: decryptedMeta.name,
        displayName: decryptedMeta.displayName,
        description: decryptedMeta.description,
        rules: decryptedMeta.rules,
      };
    }

    // Backward-compatible legacy mode for communities that have not migrated.
    let aesKey: CryptoKey;
    if (method === 'password') {
      aesKey = await EncryptionService.deriveKeyFromPassword(keyOrPassword.trim(), communityId + 'interpoll-v2');
    } else {
      aesKey = await EncryptionService.importKeyFromBase64Url(keyOrPassword);
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
    await KeyVaultService.storeCommunityKey({
      id: communityId,
      type: 'community',
      key: keyBase64,
      method,
      label: decryptedMeta.displayName || decryptedMeta.name,
      joinedAt: Date.now(),
      keyVersion: Number(community.currentKeyVersion) || 1,
    });

    if (!existingKey) {
      await this.markMembershipAndRefreshCount(communityId, currentUser.id);
    }

    return {
      ...community,
      name: decryptedMeta.name,
      displayName: decryptedMeta.displayName,
      description: decryptedMeta.description,
      rules: decryptedMeta.rules,
    };
  }

  static async approveDeviceRequest(
    communityId: string,
    targetDevicePublicKey: string,
    requestOverride?: BackendDeviceApprovalRequestSummary,
  ): Promise<void> {
    const [community, approverIdentity] = await Promise.all([
      this.getCommunity(communityId),
      KeyService.getKeyPair(),
    ]);
    if (!community?.isEncrypted) throw new Error('Community not found or not encrypted');
    const approverEnvelope = await this.once<any>(
      this.getDeviceKeyRingNode(communityId).get(approverIdentity.publicKey),
    );
    if (!approverEnvelope?.encryptedCommunityKey || !this.verifyEnvelope(communityId, approverIdentity.publicKey, approverEnvelope as CommunityKeyEnvelope)) {
      throw new Error('Current device is not authorized to approve this community request');
    }
    const keyVersion = Number(community.currentKeyVersion) || 1;
    const [requestFromGun, keyEntry] = await Promise.all([
      this.once<any>(this.getDeviceRequestNode(communityId).get(targetDevicePublicKey)),
      KeyVaultService.getCommunityKeyByVersion(communityId, keyVersion),
    ]);
    const request = requestOverride ?? requestFromGun;
    if (!request?.deviceEncryptionPublicKey) {
      throw new Error('No pending device request found for this public key');
    }
    if (request.devicePublicKey !== targetDevicePublicKey) {
      throw new Error('Device request payload does not match target device public key');
    }
    if (typeof request.userId !== 'string' || request.userId.trim().length === 0) {
      throw new Error('Device request is missing the user identifier');
    }
    if (typeof request.signature !== 'string' || request.signature.length === 0) {
      throw new Error('Device request is missing a signature');
    }
    const requestPayload = JSON.stringify({
      deviceEncryptionPublicKey: request.deviceEncryptionPublicKey,
      devicePublicKey: request.devicePublicKey,
      method: request.method,
      requestedAt: request.requestedAt,
      userId: request.userId,
    });
    const requestSigValid = CryptoService.verify(
      CryptoService.hash(requestPayload),
      request.signature,
      request.devicePublicKey,
    );
    if (!requestSigValid) {
      throw new Error('Device request signature verification failed');
    }
    if (!keyEntry?.key) {
      throw new Error('Current community key is not available on this device');
    }

    await UserService.approveDevice(
      request.userId,
      targetDevicePublicKey,
      request.deviceEncryptionPublicKey,
    );
    const envelope = await this.createSignedEnvelope({
      communityId,
      devicePublicKey: targetDevicePublicKey,
      deviceEncryptionPublicKey: request.deviceEncryptionPublicKey,
      communityKeyBase64: keyEntry.key,
      keyVersion,
    });
    await this.put(this.getDeviceKeyRingNode(communityId).get(targetDevicePublicKey), envelope);
    await this.put(this.getDeviceRequestNode(communityId).get(targetDevicePublicKey), null);
    await this.syncKeyRingEntryToBackend(communityId, targetDevicePublicKey, envelope);
  }

  static async removeDeviceAndRotateKey(
    communityId: string,
    removedDevicePublicKey: string,
  ): Promise<void> {
    const [community, currentDevice] = await Promise.all([
      this.getCommunity(communityId),
      KeyService.getKeyPair(),
    ]);
    if (!community?.isEncrypted) throw new Error('Community not found or not encrypted');
    const callerEnvelope = await this.once<any>(
      this.getDeviceKeyRingNode(communityId).get(currentDevice.publicKey),
    );
    if (!callerEnvelope?.encryptedCommunityKey || !this.verifyEnvelope(communityId, currentDevice.publicKey, callerEnvelope as CommunityKeyEnvelope)) {
      throw new Error('Current device is not authorized to rotate this community key');
    }
    const nextKeyVersion = (Number(community.currentKeyVersion) || 1) + 1;
    const keyRingRaw = await this.once<Record<string, CommunityKeyEnvelope | null>>(this.getDeviceKeyRingNode(communityId));
    if (!keyRingRaw) throw new Error('Community key ring not found');

    const remainingEntries = Object.entries(keyRingRaw)
      .filter(([pub, value]) => (
        pub !== removedDevicePublicKey
        && pub !== '_'
        && value
        && typeof value === 'object'
        && this.verifyEnvelope(communityId, pub, value as CommunityKeyEnvelope)
      ));
    if (remainingEntries.length === 0) {
      throw new Error('Cannot remove the last approved device from the community key ring');
    }

    const newAesKey = await EncryptionService.generateKey();
    const newKeyBase64 = await EncryptionService.exportKey(newAesKey);
    const oldKeyEntry = await KeyVaultService.getCommunityKeyByVersion(communityId, nextKeyVersion - 1);
    if (!oldKeyEntry?.key || !community.encryptedMeta) {
      throw new Error('Missing previous community key to re-encrypt metadata during rotation');
    }
    const oldAesKey = await EncryptionService.importKey(oldKeyEntry.key);
    const decryptedMetaRaw = await EncryptionService.decrypt(community.encryptedMeta, oldAesKey);
    const reEncryptedMeta = await EncryptionService.encrypt(decryptedMetaRaw, newAesKey);

    const writePromises: Array<Promise<void>> = [];
    const backendSyncPromises: Array<Promise<void>> = [];
    for (const [devicePublicKey, value] of remainingEntries) {
      const envelope = await this.createSignedEnvelope({
        communityId,
        devicePublicKey,
        deviceEncryptionPublicKey: value!.deviceEncryptionPublicKey,
        communityKeyBase64: newKeyBase64,
        keyVersion: nextKeyVersion,
      });
      writePromises.push(this.put(this.getDeviceKeyRingNode(communityId).get(devicePublicKey), envelope));
      backendSyncPromises.push(this.syncKeyRingEntryToBackend(communityId, devicePublicKey, envelope));
    }
    writePromises.push(this.put(this.getDeviceKeyRingNode(communityId).get(removedDevicePublicKey), null));
    writePromises.push(this.put(this.getCommunityNode(communityId).get('currentKeyVersion'), nextKeyVersion));
    writePromises.push(this.put(this.getCommunityNode(communityId).get('encryptedMeta'), reEncryptedMeta));
    await Promise.all(writePromises);

    await KeyVaultService.storeCommunityKey({
      id: communityId,
      type: 'community',
      key: newKeyBase64,
      method: 'invite',
      label: community.displayName || community.name || communityId,
      joinedAt: Date.now(),
      keyVersion: nextKeyVersion,
    });
    await Promise.all(backendSyncPromises);
    await this.syncDeviceRemovalToBackend(
      communityId,
      removedDevicePublicKey,
      currentDevice.publicKey,
      nextKeyVersion,
    );
  }

  private static async markMembershipAndRefreshCount(communityId: string, userId: string): Promise<void> {
    await this.put(this.getCommunityNode(communityId).get('members').get(userId), Date.now());
    const membersRaw = await this.once<Record<string, unknown>>(
      this.getCommunityNode(communityId).get('members'),
    );
    const memberCount = membersRaw
      ? Object.keys(membersRaw).filter((key) => key !== '_' && membersRaw[key] != null).length
      : 0;
    if (memberCount > 0) {
      await this.put(this.getCommunityNode(communityId).get('memberCount'), memberCount);
    }
  }

  static async listPendingDeviceRequests(communityId: string): Promise<BackendDeviceApprovalRequestSummary[]> {
    await this.flushBackendSyncQueue();
    const encodedCommunityId = encodeURIComponent(communityId);
    const authQuery = await this.buildReadAuthorizationQuery(communityId, 'requests');
    const payload = await this.getCommunityApi<{ requests?: BackendDeviceApprovalRequestSummary[] }>(
      `/api/community-device/requests?communityId=${encodedCommunityId}&${authQuery}`,
    );
    return Array.isArray(payload.requests) ? payload.requests : [];
  }

  static async listCommunityKeyRing(communityId: string): Promise<BackendCommunityKeyRingEntrySummary[]> {
    await this.flushBackendSyncQueue();
    const encodedCommunityId = encodeURIComponent(communityId);
    const authQuery = await this.buildReadAuthorizationQuery(communityId, 'keyring');
    const payload = await this.getCommunityApi<{ entries?: BackendCommunityKeyRingEntrySummary[] }>(
      `/api/community-device/keyring?communityId=${encodedCommunityId}&${authQuery}`,
    );
    return Array.isArray(payload.entries) ? payload.entries : [];
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
    const currentUser = await UserService.getCurrentUser();
    await this.markMembershipAndRefreshCount(communityId, currentUser.id);
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
      setTimeout(() => { if (!done) { done = true; res(null); } }, 3000);
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
      keyRingRequired: Boolean(data.keyRingRequired),
      currentKeyVersion: Number(data.currentKeyVersion) || 1,
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
