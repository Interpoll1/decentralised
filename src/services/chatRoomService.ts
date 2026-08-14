/**
 * Encrypted group chat rooms — durable, ordered, retried.
 *
 * What was wrong:
 *
 *   - **Sends were fire-and-forget.** `sendMessage` called `.put()` with no ack
 *     callback and returned a `DisplayMessage` regardless. The UI showed the
 *     message as sent whether or not any peer had accepted it, and nothing ever
 *     retried, so a message written during a blip was gone.
 *   - **Opening a room loaded no history.** `enterRoom` only subscribed for live
 *     updates, so a room you opened tomorrow was blank until somebody typed —
 *     and with `radisk:false`/`localStorage:false` the graph may genuinely hold
 *     nothing after an eviction.
 *   - **`memberCount` was a read-modify-write.** Two people joining at once each
 *     read N and wrote N+1, so one join simply disappeared. Membership is a node
 *     per user now, and the count is derived by counting them.
 *   - **Ordering was by timestamp alone**, so a peer with a skewed clock
 *     reordered the room differently on every screen, and equal timestamps had
 *     no defined order at all.
 *   - **Every incoming message re-read the room key from the vault** and
 *     re-imported it, on the Gun callback path.
 *
 * Same shape as the DM service: IndexedDB is the durable copy and the render
 * source, Gun is replication, and unconfirmed sends retry from an outbox.
 */

import { GunService, GUN_NAMESPACE } from './gunService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import { StorageService } from './storageService';
import { BoundedMap } from '../utils/boundedMap';
import { gunPut, gunOnce, gunReadChildren, verifySoulOnRelay, toGunRecord } from '../utils/gunAsync';
import { compareMessages } from '../utils/messageOrder';
import { KeyService } from './keyService';
import { ChatSafetyService } from './chatSafetyService';
import { sealEnvelope, verifyEnvelope, cipherDigest, ROOM_SIGNED_FIELDS } from '../utils/chatEnvelope';
import type { StoredChatMessage, SyncStatus } from '../types/social';
import type {
  DecryptedChatRoomMeta,
  DecryptedChatRoomMessageContent,
  StoredEncryptionKey,
} from '../types/encryption';

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  isEncrypted: boolean;
  encryptionHint: string;
  createdAt: number;
  memberCount: number;
}

export interface DisplayMessage {
  id: string;
  roomId: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: number;
  /** Monotonic per device; disambiguates same-millisecond messages from one sender. */
  seq?: number;
  /** Delivery state — set for messages this device sent. */
  status?: SyncStatus;
  error?: string;
  /**
   * Whether a per-sender signature proved authorship. False on messages written
   * before wire v3, which the room key alone could never attribute.
   */
  verified?: boolean;
}

const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 12;
const FLUSH_INTERVAL_MS = 60_000;
const SEQ_STORAGE_KEY = 'chatroom-seq';

/** Imported room keys. Re-deriving one per incoming message was pure overhead. */
const roomKeys = new BoundedMap<string, CryptoKey>({ maxSize: 100 });

let seqCounter: number | null = null;
let outboxLoopStarted = false;
let flushInFlight = false;

function toDisplay(row: StoredChatMessage): DisplayMessage {
  return {
    id: row.id,
    roomId: row.roomId,
    text: row.text,
    senderId: row.senderId,
    senderName: row.senderName || 'Anonymous',
    timestamp: row.timestamp,
    seq: row.seq,
    status: row.outgoing ? row.syncStatus : undefined,
    error: row.error,
    // Our own sends are signed on the way out; nothing to re-check locally.
    verified: row.outgoing ? true : !!row.verified,
  };
}

export class ChatRoomService {
  private static get gun() { return GunService.getGun(); }

  // ── Gun paths ─────────────────────────────────────────────────────────────

  private static roomNode(roomId: string) {
    return this.gun.get('chatrooms').get(roomId);
  }

  private static messagesNode(roomId: string) {
    return this.roomNode(roomId).get('messages');
  }

  private static membersNode(roomId: string) {
    return this.roomNode(roomId).get('members');
  }

  private static messageSoul(roomId: string, messageId: string): string {
    return `${GUN_NAMESPACE}/chatrooms/${roomId}/messages/${messageId}`;
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private static async getRoomKey(roomId: string): Promise<CryptoKey | null> {
    const cached = roomKeys.get(roomId);
    if (cached) return cached;

    const storedKey = await KeyVaultService.getKey(roomId);
    if (!storedKey) return null;
    const aesKey = await EncryptionService.importKey(storedKey.key);
    roomKeys.set(roomId, aesKey);
    return aesKey;
  }

  // ── Per-device sequence ───────────────────────────────────────────────────

  private static async nextSeq(): Promise<number> {
    if (seqCounter === null) {
      try {
        const stored = await StorageService.getMetadata(SEQ_STORAGE_KEY);
        seqCounter = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
      } catch {
        seqCounter = 0;
      }
    }
    seqCounter += 1;
    void StorageService.setMetadata(SEQ_STORAGE_KEY, seqCounter).catch(() => { /* advisory */ });
    return seqCounter;
  }

  // ── Create / join / leave ─────────────────────────────────────────────────

  /**
   * Create a new encrypted chat room.
   * @returns { room, inviteLink }
   */
  static async createRoom(
    name: string,
    description: string,
    creatorId: string,
    password?: string,
  ): Promise<{ room: ChatRoom; inviteLink: string }> {
    const roomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

    let aesKey: CryptoKey;
    let method: StoredEncryptionKey['method'];
    if (password) {
      aesKey = await EncryptionService.deriveKeyFromPassword(password, roomId + 'interpoll-v2');
      method = 'password';
    } else {
      aesKey = await EncryptionService.generateKey();
      method = 'invite';
    }

    const meta: DecryptedChatRoomMeta = { name, description, creatorId };
    const encryptedMeta = await EncryptionService.encrypt(JSON.stringify(meta), aesKey);
    const encryptionHint = password ? 'Password-protected' : 'Invite-only';
    const createdAt = Date.now();

    // Store the key first. If the graph write fails we still hold the key, so
    // the room is recoverable; the reverse — a room in the graph nobody has the
    // key for — is unrecoverable by design.
    const keyBase64 = await EncryptionService.exportKey(aesKey);
    await KeyVaultService.storeKey({
      id: roomId,
      type: 'chatroom',
      key: keyBase64,
      method,
      label: name,
      joinedAt: createdAt,
    });
    roomKeys.set(roomId, aesKey);

    const ack = await gunPut(this.roomNode(roomId), toGunRecord({
      id: roomId,
      isEncrypted: true,
      encryptionHint,
      encryptedMeta,
      createdAt,
      memberCount: 1,
      name: '🔒 Encrypted Room',
      description: 'Encrypted chat room',
    }));
    if (!ack.ok) {
      // The old version could hang here forever: the put callback was the only
      // thing that ever settled the promise, and Gun does not promise to call it.
      throw new Error(ack.err === 'timeout'
        ? 'No peer accepted the new room — check your relay connection and try again'
        : ack.err || 'Room could not be created');
    }

    void gunPut(this.membersNode(roomId).get(creatorId), { userId: creatorId, joinedAt: createdAt });

    const keyBase64Url = await EncryptionService.exportKeyAsBase64Url(aesKey);
    const inviteLink = InviteLinkService.generateInviteLink(roomId, 'chatroom', keyBase64Url);

    return {
      room: {
        id: roomId,
        name,
        description,
        creatorId,
        isEncrypted: true,
        encryptionHint,
        createdAt,
        memberCount: 1,
      },
      inviteLink,
    };
  }

  /**
   * Join an existing encrypted chat room using a key or password.
   */
  static async joinRoom(
    roomId: string,
    keyOrPassword: string,
    method: 'invite' | 'password',
  ): Promise<ChatRoom> {
    let aesKey: CryptoKey;
    if (method === 'password') {
      aesKey = await EncryptionService.deriveKeyFromPassword(keyOrPassword, roomId + 'interpoll-v2');
    } else {
      aesKey = await EncryptionService.importKeyFromBase64Url(keyOrPassword);
    }

    const roomData = await gunOnce<any>(this.roomNode(roomId), 6_000);
    if (!roomData?.encryptedMeta) {
      throw new Error('Chat room not found');
    }

    let meta: DecryptedChatRoomMeta;
    try {
      meta = JSON.parse(await EncryptionService.decrypt(roomData.encryptedMeta, aesKey));
    } catch {
      throw new Error('Invalid key or password — could not decrypt room');
    }

    const joinedAt = Date.now();
    await KeyVaultService.storeKey({
      id: roomId,
      type: 'chatroom',
      key: await EncryptionService.exportKey(aesKey),
      method,
      label: meta.name,
      joinedAt,
    });
    roomKeys.set(roomId, aesKey);

    // Membership is a node keyed by user, not a counter. Two people joining at
    // the same moment used to read the same total and write back the same N+1,
    // silently losing one of the joins.
    const userId = await this.resolveUserId();
    if (userId) {
      await gunPut(this.membersNode(roomId).get(userId), { userId, joinedAt });
    }
    const memberCount = await this.getMemberCount(roomId, Number(roomData.memberCount) || 1);
    // Keep the legacy field roughly right for clients that still read it.
    void gunPut(this.roomNode(roomId), { memberCount });

    return {
      id: roomId,
      name: meta.name,
      description: meta.description,
      creatorId: meta.creatorId,
      isEncrypted: true,
      encryptionHint: roomData.encryptionHint || '',
      createdAt: Number(roomData.createdAt) || joinedAt,
      memberCount,
    };
  }

  /** Members counted from the membership set, falling back to the stored hint. */
  static async getMemberCount(roomId: string, fallback = 1): Promise<number> {
    const members = await gunReadChildren<any>(this.membersNode(roomId), { minMs: 300, maxMs: 2_500 });
    const ids = new Set<string>();
    for (const { key, value } of members) {
      const id = value && typeof value === 'object' && typeof value.userId === 'string' ? value.userId : key;
      if (id && id !== '_') ids.add(id);
    }
    return ids.size > 0 ? ids.size : fallback;
  }

  private static async resolveUserId(): Promise<string | null> {
    try {
      // Imported lazily: userService pulls in a good part of the app, and room
      // creation must not depend on it being loaded.
      const { UserService } = await import('./userService');
      const user = await UserService.getCurrentUser();
      return user?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Leave a chat room: drop the key and the membership marker.
   *
   * The local message mirror goes too — without the key those rows can never be
   * re-derived from the graph, so keeping them would only leak plaintext of a
   * room the user chose to leave.
   */
  static async leaveRoom(roomId: string): Promise<void> {
    await KeyVaultService.removeKey(roomId);
    roomKeys.delete(roomId);

    const userId = await this.resolveUserId();
    if (userId) {
      void gunPut(this.membersNode(roomId).get(userId), { userId, joinedAt: 0, left: true });
    }

    try {
      const rows = await StorageService.getChatMessagesByRoom(roomId);
      await Promise.all(rows.map((row) => StorageService.deleteChatMessage(row.id)));
    } catch (err) {
      console.warn('[ChatRoomService] Could not clear local room history:', err);
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  /**
   * Queue a message and start delivering it.
   *
   * The row is durable before any network work happens, so a failed send costs a
   * retry rather than the message. `status` on the returned message reflects the
   * initial state; the outbox updates the stored row as delivery progresses.
   */
  static async sendMessage(
    roomId: string,
    text: string,
    senderId: string,
    senderName: string,
  ): Promise<DisplayMessage> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Cannot send an empty message');

    const aesKey = await this.getRoomKey(roomId);
    if (!aesKey) throw new Error('No encryption key for this room');

    const timestamp = Date.now();
    const row: StoredChatMessage = {
      id: `msg-${timestamp}-${Math.random().toString(36).slice(2, 11)}`,
      roomId,
      kind: 'room',
      senderId,
      senderName,
      text: trimmed,
      timestamp,
      seq: await this.nextSeq(),
      outgoing: true,
      syncStatus: 'pending',
      syncAttempts: 0,
    };

    await StorageService.saveChatMessage(row);

    // Deliver in the background — the message is already safe, and blocking the
    // composer on a relay round-trip is what made sending feel unreliable.
    void this.deliver(row);
    this.startOutboxLoop();

    return toDisplay(row);
  }

  /** One delivery attempt. Never throws; the outbox retries. */
  private static async deliver(row: StoredChatMessage): Promise<StoredChatMessage> {
    const attempts = row.syncAttempts + 1;
    const expired = Date.now() - row.timestamp > OUTBOX_TTL_MS;

    const settle = async (patch: Partial<StoredChatMessage>): Promise<StoredChatMessage> => {
      const existing = await StorageService.getChatMessage(row.id);
      const next = { ...(existing ?? row), ...patch } as StoredChatMessage;
      await StorageService.saveChatMessage(next);
      return next;
    };

    const fail = (error: string) => settle({
      syncStatus: attempts >= MAX_SEND_ATTEMPTS || expired ? 'failed' : 'pending',
      syncAttempts: attempts,
      error,
    });

    const aesKey = await this.getRoomKey(row.roomId);
    if (!aesKey) return fail('The key for this room is no longer available');

    let record: Record<string, string | number | boolean>;
    try {
      const content: DecryptedChatRoomMessageContent = {
        text: row.text,
        senderId: row.senderId,
        senderName: row.senderName || 'Anonymous',
      };
      const encryptedContent = await EncryptionService.encrypt(JSON.stringify(content), aesKey);
      const cipherHash = cipherDigest(encryptedContent);

      // The auth tag is keyed with the *room* key, which every member holds — so
      // it proves the writer is in the room and nothing more. Any member could
      // mint one for any other member's id. The per-sender signature is what
      // actually establishes authorship; the tag stays for older clients.
      const { privateKey, publicKey } = await KeyService.getKeyPair();
      const envelope = await sealEnvelope(
        {
          id: row.id,
          roomId: row.roomId,
          senderId: row.senderId,
          timestamp: row.timestamp,
          seq: row.seq,
          cipherHash,
        },
        privateKey,
        publicKey,
      );

      record = toGunRecord({
        id: row.id,
        roomId: row.roomId,
        senderId: row.senderId,
        encryptedContent,
        authTag: await EncryptionService.generateAuthTag(
          aesKey, row.id, String(row.timestamp), row.senderId,
        ),
        timestamp: row.timestamp,
        seq: row.seq,
        cipherHash,
        ...envelope,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Encryption failed');
    }

    const ack = await gunPut(this.messagesNode(row.roomId).get(row.id), record);
    if (!ack.ok) return fail(ack.err || 'Message could not be written to the graph');

    const onRelay = await verifySoulOnRelay(this.messageSoul(row.roomId, row.id), 6_000);
    return settle({
      // `false` (relay says no) and `null` (no reachable endpoint) both mean keep
      // trying, but a peer-acked write is further along than an unsent one.
      syncStatus: onRelay === true ? 'confirmed' : 'published',
      syncAttempts: attempts,
      error: undefined,
    });
  }

  /**
   * Re-send every room message no relay has confirmed.
   *
   * Gun does not retro-sync writes made while every peer was unreachable, so
   * without this a message written offline never leaves the device.
   */
  static async flushOutbox(): Promise<void> {
    if (flushInFlight) return;
    flushInFlight = true;
    try {
      const all = await StorageService.getAllChatMessages();
      const now = Date.now();
      const pending = all.filter((row) =>
        row.kind === 'room'
        && row.outgoing
        && row.syncStatus !== 'confirmed'
        && row.syncAttempts < MAX_SEND_ATTEMPTS
        && now - row.timestamp < OUTBOX_TTL_MS);

      for (const row of pending) await this.deliver(row);
    } catch (err) {
      console.warn('[ChatRoomService] Outbox flush failed:', err);
    } finally {
      flushInFlight = false;
    }
  }

  static startOutboxLoop(): void {
    if (outboxLoopStarted || typeof window === 'undefined') return;
    outboxLoopStarted = true;

    GunService.onReconnect(() => { void this.flushOutbox(); });
    window.addEventListener('online', () => { void this.flushOutbox(); });

    const tick = () => {
      void this.flushOutbox().finally(() => setTimeout(tick, FLUSH_INTERVAL_MS));
    };
    setTimeout(tick, 10_000);
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  /** Decrypt and verify one raw graph record. Returns null if it isn't usable. */
  private static async decodeMessage(roomId: string, data: any): Promise<StoredChatMessage | null> {
    if (!data || typeof data !== 'object') return null;
    const id = typeof data.id === 'string' ? data.id : null;
    if (!id || typeof data.encryptedContent !== 'string') return null;

    const aesKey = await this.getRoomKey(roomId);
    if (!aesKey) return null;

    const timestamp = Number(data.timestamp) || Date.now();
    const senderId = typeof data.senderId === 'string' ? data.senderId : '';

    if (typeof data.authTag === 'string') {
      const valid = await EncryptionService.verifyAuthTag(
        aesKey, data.authTag, id, String(data.timestamp), senderId,
      );
      if (!valid) return null;
    }

    // Membership is not authorship. The auth tag above only proves the writer
    // holds the room key, so before signing existed any member could publish a
    // message under any other member's id.
    const verdict = verifyEnvelope(data as Record<string, unknown>, ROOM_SIGNED_FIELDS, senderId);
    if (verdict.status === 'invalid') {
      console.warn(`[ChatRoomService] Dropped message ${id} from ${senderId}: ${verdict.reason}`);
      return null;
    }
    const verified = verdict.status === 'valid';

    if (verified && data.cipherHash !== cipherDigest(data.encryptedContent)) {
      console.warn(`[ChatRoomService] Dropped message ${id}: ciphertext does not match its signature`);
      return null;
    }

    if (senderId && ChatSafetyService.isBlocked(senderId)) return null;

    let content: DecryptedChatRoomMessageContent;
    try {
      content = JSON.parse(await EncryptionService.decrypt(data.encryptedContent, aesKey));
    } catch {
      return null;
    }

    // The signature covers the *outer* sender id, so a signed message whose
    // encrypted body claims someone else is a forgery attempt by a member —
    // exactly what the signature is here to stop.
    if (verified && content.senderId && content.senderId !== senderId) {
      console.warn(`[ChatRoomService] Dropped message ${id}: encrypted sender disagrees with signed sender`);
      return null;
    }

    const existing = await StorageService.getChatMessage(id);
    return {
      id,
      roomId,
      kind: 'room',
      senderId: content.senderId || senderId,
      senderName: content.senderName || 'Anonymous',
      verified,
      text: content.text ?? '',
      timestamp,
      seq: Number(data.seq) || 0,
      // Preserve local authorship: our own message coming back from the graph
      // must not lose its outgoing flag, or the outbox stops tracking it.
      outgoing: existing?.outgoing ?? false,
      // Visible in the graph means it demonstrably left the author's browser.
      syncStatus: 'confirmed',
      syncAttempts: existing?.syncAttempts ?? 0,
      readAt: existing?.readAt,
    };
  }

  /** Messages already on this device. Resolves immediately — no network. */
  static async getLocalHistory(roomId: string): Promise<DisplayMessage[]> {
    const rows = await StorageService.getChatMessagesByRoom(roomId);
    return rows.filter((row) => row.kind === 'room').sort(compareMessages).map(toDisplay);
  }

  /**
   * Local history merged with the graph.
   *
   * Always settles: `gunReadChildren` stops on quiet or a hard ceiling instead of
   * waiting on callbacks Gun never promised to fire.
   */
  static async loadHistory(roomId: string): Promise<DisplayMessage[]> {
    const [local, remote] = await Promise.all([
      StorageService.getChatMessagesByRoom(roomId),
      gunReadChildren<any>(this.messagesNode(roomId), { minMs: 600, maxMs: 8_000 }),
    ]);

    const byId = new Map<string, StoredChatMessage>();
    for (const row of local) {
      if (row.kind === 'room') byId.set(row.id, row);
    }

    const fresh: StoredChatMessage[] = [];
    for (const { value } of remote) {
      const existing = byId.get(typeof value?.id === 'string' ? value.id : '');
      if (existing?.text) continue;
      const decoded = await this.decodeMessage(roomId, value);
      if (!decoded) continue;
      byId.set(decoded.id, decoded);
      fresh.push(decoded);
    }
    if (fresh.length) await StorageService.saveChatMessages(fresh);

    return [...byId.values()].sort(compareMessages).map(toDisplay);
  }

  /**
   * Live messages in a room. Decrypts, verifies and mirrors before emitting.
   *
   * Re-attaches after `GunService.reconnect()` rebuilds the Gun instance —
   * otherwise the chain is bound to a discarded graph and goes quiet with no
   * indication anything is wrong.
   */
  static subscribeToMessages(
    roomId: string,
    callback: (message: DisplayMessage) => void,
  ): () => void {
    const seen = new Set<string>();
    let active = true;
    let chain: any = null;

    const handle = (data: any) => {
      if (!active || !data?.id || seen.has(data.id)) return;
      seen.add(data.id);
      void (async () => {
        const row = await this.decodeMessage(roomId, data);
        if (!row || !active) return;
        await StorageService.saveChatMessage(row);
        if (!active) return;
        callback(toDisplay(row));
      })();
    };

    const attach = () => {
      if (!active) return;
      chain = this.messagesNode(roomId).map().on((data: any) => handle(data));
    };

    const detach = () => {
      try { chain?.off?.(); } catch { /* already detached */ }
      chain = null;
    };

    attach();
    const offReconnect = GunService.onReconnect(() => {
      if (!active) return;
      detach();
      attach();
    });

    return () => {
      active = false;
      offReconnect();
      detach();
    };
  }

  /**
   * Rooms this device holds a key for.
   *
   * Every room is listed even when its graph node is unreachable: the key vault
   * is the record of membership, and dropping unreachable rooms meant the whole
   * list emptied out while offline.
   */
  static async listJoinedRooms(): Promise<ChatRoom[]> {
    const keys = await KeyVaultService.listKeysByType('chatroom');

    const rooms = await Promise.all(keys.map(async (storedKey): Promise<ChatRoom> => {
      const fallback: ChatRoom = {
        id: storedKey.id,
        name: storedKey.label || 'Encrypted room',
        description: '',
        creatorId: '',
        isEncrypted: true,
        encryptionHint: '',
        createdAt: storedKey.joinedAt,
        memberCount: 1,
      };

      try {
        const roomData = await gunOnce<any>(this.roomNode(storedKey.id), 3_000);
        if (!roomData) return fallback;

        let name = storedKey.label;
        let description = '';
        let creatorId = '';

        if (roomData.encryptedMeta) {
          try {
            const aesKey = await this.getRoomKey(storedKey.id);
            if (aesKey) {
              const meta: DecryptedChatRoomMeta = JSON.parse(
                await EncryptionService.decrypt(roomData.encryptedMeta, aesKey),
              );
              name = meta.name;
              description = meta.description;
              creatorId = meta.creatorId;
            }
          } catch {
            // Keep the vault label — the room is still usable.
          }
        }

        return {
          id: storedKey.id,
          name: name || fallback.name,
          description,
          creatorId,
          isEncrypted: true,
          encryptionHint: roomData.encryptionHint || '',
          createdAt: Number(roomData.createdAt) || storedKey.joinedAt,
          memberCount: Number(roomData.memberCount) || 1,
        };
      } catch {
        return fallback;
      }
    }));

    return rooms.sort((a, b) => b.createdAt - a.createdAt);
  }
}
