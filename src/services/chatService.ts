/**
 * Direct messages — hybrid-encrypted, local-first, retried.
 *
 * Three things were broken here, and they compounded:
 *
 *   1. **Messages longer than ~190 bytes could not be sent at all.** Text was
 *      encrypted *directly* with RSA-OAEP-2048/SHA-256, whose plaintext ceiling
 *      is 190 bytes. Anything longer threw inside `sendMessage`, and the caller
 *      swallowed the error — so a normal-length message simply vanished when you
 *      pressed send. Messages now use a per-message AES-256-GCM key with the key
 *      (32 bytes) RSA-wrapped for each side. Length is unbounded; the RSA
 *      keypair, and every already-published public key, is unchanged.
 *   2. **History could hang forever.** `loadHistory` cleared its timeout inside
 *      the outer `.once()` and then waited on a counter of inner `.once()`
 *      callbacks that Gun does not promise to fire. When one never fired the
 *      promise never settled, and the view sat on "Setting up..." indefinitely.
 *   3. **Nothing was stored locally.** Gun runs with `localStorage:false` and
 *      `radisk:false`, so the only copy of a conversation was a volatile
 *      in-memory graph that the memory watchdog evicts. Reopening a chat after
 *      cleanup, or offline, showed nothing.
 *
 * The model now matches comments: IndexedDB is the durable copy and the render
 * source, Gun is replication. Sends wait for a real ack, ask the relay whether
 * it actually holds the message, and retry from a durable outbox for a week —
 * including messages written before the recipient ever published a chat key.
 */

import { GunService, GUN_NAMESPACE } from './gunService';
import { StorageService } from './storageService';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';
import { gunPut, gunOnce, gunReadChildren, verifySoulOnRelay, toGunRecord } from '../utils/gunAsync';
import {
  seal, open, fromBase64,
  generateIdentityKeyPair, exportPublicKey, importPublicKey,
  type SealedEnvelope,
} from '../utils/hybridCrypto';
import { compareMessages } from '../utils/messageOrder';
import { KeyService } from './keyService';
import { ChatKeyPinService } from './chatKeyPinService';
import { ChatSafetyService } from './chatSafetyService';
import { CHAT_POW_BASE, CHAT_POW_COLD } from './integrityService';
import { sealEnvelope, verifyEnvelope, cipherDigest, DM_SIGNED_FIELDS } from '../utils/chatEnvelope';
import type { StoredChatMessage, SyncStatus } from '../types/social';

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  message: string;
  timestamp: number;
  read: boolean;
  /** True when this device's user wrote it. */
  sent: boolean;
  /** Delivery state for outgoing messages. Absent on received ones. */
  status?: SyncStatus;
  /** Why an outgoing message has not gone out yet, if anything. */
  error?: string;
}

export interface RecipientInfo {
  userId: string;
  publicKey?: string;
  name?: string;
  avatar?: string;
}

/**
 * Wire format version.
 *
 *   1 — whole message RSA-encrypted (190-byte ceiling).
 *   2 — AES-GCM body with the key RSA-wrapped per side. Unbounded length.
 *   3 — v2 plus a signed envelope binding the message to its sender.
 *
 * v1 and v2 records still decrypt and render; they carry `verified: false` and
 * the UI marks them, because a record written before signing existed cannot be
 * verified after the fact and dropping them would silently delete history.
 * Nothing writes below v3.
 */
const WIRE_VERSION = 3;

/** How long an unsent message keeps trying before it is marked failed. */
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SEND_ATTEMPTS = 12;
const FLUSH_INTERVAL_MS = 60_000;
const CONNECTION_POLL_MS = 3_000;
/** Prune roughly once an hour of flushing, not on every tick. */
const PRUNE_EVERY_N_FLUSHES = 60;

/**
 * One flush at a time per user, however many `ChatService` instances exist.
 * `HomePage` keeps a background instance alive while `ChatView` creates its own,
 * and both would otherwise re-send the same outbox rows concurrently.
 */
const flushInFlight = new Set<string>();

function toChatMessage(row: StoredChatMessage): ChatMessage {
  return {
    id: row.id,
    from: row.senderId,
    to: row.recipientId || '',
    message: row.text,
    timestamp: row.timestamp,
    read: !!row.readAt,
    sent: row.outgoing,
    status: row.outgoing ? row.syncStatus : undefined,
    error: row.error,
  };
}

class ChatService {
  private static readonly KEYPAIR_STORAGE_PREFIX = 'chat-keypair';
  private static readonly SEQ_STORAGE_PREFIX = 'chat-seq';

  private ws: WebSocket | null = null;
  private wsUrl: string;
  private userId: string;
  private peerId: string;
  private keyPair: CryptoKeyPair | null = null;
  private recipientKeys = new BoundedMap<string, CryptoKey>({ maxSize: 200 });
  /** Recipients we looked up and found no published chat key for. */
  private missingKeys = new Set<string>();
  /** Peers whose key changed and whose replacement the user has not answered on. */
  private pendingKeyChanges = new Map<string, string>();
  private ready = false;
  private connected = false;
  private reconnectTimer: number | null = null;
  private connectionPoll: number | null = null;
  private flushTimer: number | null = null;
  private flushCount = 0;
  private shuttingDown = false;
  private seq = 0;

  private roomUnsubscribers = new Map<string, () => void>();
  private typingUnsubscribers = new Map<string, () => void>();
  private readReceiptUnsubscribers = new Map<string, () => void>();
  private offGunReconnect: (() => void) | null = null;
  private onlineHandler: (() => void) | null = null;
  /** Rooms we are subscribed to, so they can be rebuilt after a Gun reconnect. */
  private watchedRooms = new Map<string, string>();

  // Duplicate-delivery guard. Bounded: the TTL is far longer than any plausible
  // redelivery window, so bounding it cannot reintroduce duplicates in practice.
  private seenMessageIds = new BoundedSet<string>({ maxSize: 5000, ttlMs: 60 * 60_000 });

  public onMessage:            ((msg: ChatMessage) => void) | null = null;
  public onMessageStatus:      ((data: { id: string; status: SyncStatus; error?: string }) => void) | null = null;
  public onTyping:             ((data: { from: string; isTyping: boolean }) => void) | null = null;
  public onDelivered:          ((data: { messageId: string; recipientId: string }) => void) | null = null;
  public onReadReceipt:        ((data: { from: string; at: number }) => void) | null = null;
  public onConnectionChange:   ((connected: boolean) => void) | null = null;
  /** Fires when we learn whether a recipient has published a chat key. */
  public onRecipientKeyChange: ((data: { userId: string; available: boolean }) => void) | null = null;
  /**
   * Fires when a peer's published key no longer matches the pinned one.
   *
   * Sends to that peer are blocked until `acceptKeyChange` is called, so the
   * view is expected to put this in front of the user rather than log it.
   */
  public onKeyChange: ((data: {
    userId: string;
    pinnedKeyB64: string;
    incomingKeyB64: string;
    wasVerified: boolean;
  }) => void) | null = null;

  constructor(wsUrl: string, userId: string) {
    this.wsUrl = wsUrl;
    this.userId = userId;
    this.peerId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async init(): Promise<string> {
    // Reset the shutdown latch so a re-inited instance can reconnect and flush;
    // otherwise every timer and socket would bail on the first tick.
    this.shuttingDown = false;
    this.keyPair = await this.loadOrGenerateKeyPair();
    this.seq = await this.loadSeq();
    const pubKeyB64 = await this.exportPublicKey();

    // Publish our RSA public key so peers can wrap message keys for us. Only
    // when it changed — republishing on every startup was pure Gun churn.
    const node = GunService.getGun().get('users').get(this.userId).get('chatPublicKey');
    const currentKey = await gunOnce<string>(node, 2_500);
    if (currentKey !== pubKeyB64) {
      void gunPut(GunService.getGun().get('users').get(this.userId), { chatPublicKey: pubKeyB64 });
    }

    this.ready = true;
    this.startConnectionTracking();
    this.startOutboxLoop();
    if (this.wsUrl) this.connect();
    return pubKeyB64;
  }

  // ── RSA identity keypair ────────────────────────────────────────────────────

  private getKeypairStorageKey(): string {
    return `${ChatService.KEYPAIR_STORAGE_PREFIX}:${this.userId}`;
  }

  private getLegacyKeypairStorageKey(): string {
    return `chat-keypair-${this.userId}`;
  }

  private async persistKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    await StorageService.setMetadata(this.getKeypairStorageKey(), keyPair);
  }

  private isStoredKeyPair(value: unknown): value is CryptoKeyPair {
    if (!value || typeof value !== 'object') return false;
    const pair = value as Partial<CryptoKeyPair>;
    // A structured-clone round trip preserves CryptoKey, but a keypair that was
    // ever written through a JSON path comes back as two empty objects. Using
    // one of those throws deep inside WebCrypto on the first decrypt, so check
    // the shape rather than just the property names.
    return !!pair.publicKey && !!pair.privateKey
      && typeof (pair.privateKey as CryptoKey).algorithm === 'object';
  }

  private async loadOrGenerateKeyPair(): Promise<CryptoKeyPair> {
    try {
      const stored = await StorageService.getMetadata(this.getKeypairStorageKey());
      if (this.isStoredKeyPair(stored)) return stored;
    } catch (error) {
      console.warn('[ChatService] Failed to load stored chat keypair:', error);
    }

    const legacy = localStorage.getItem(this.getLegacyKeypairStorageKey());
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (typeof parsed?.publicKey !== 'string' || typeof parsed?.privateKey !== 'string') {
          throw new Error('Legacy chat keypair is malformed');
        }
        const pub = await crypto.subtle.importKey(
          'spki', fromBase64(parsed.publicKey),
          { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'],
        );
        const priv = await crypto.subtle.importKey(
          'pkcs8', fromBase64(parsed.privateKey),
          { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt'],
        );
        const keyPair = { publicKey: pub, privateKey: priv };
        await this.persistKeyPair(keyPair);
        localStorage.removeItem(this.getLegacyKeypairStorageKey());
        return keyPair;
      } catch (error) {
        localStorage.removeItem(this.getLegacyKeypairStorageKey());
        console.warn('[ChatService] Failed to migrate legacy chat keypair:', error);
      }
    }

    if (StorageService.usingMemoryFallback) {
      // Worth saying out loud: without IndexedDB the keypair is regenerated on
      // every reload, which makes every earlier message permanently unreadable.
      console.warn('[ChatService] No persistent storage — chat keys will not survive a reload');
    }

    const pair = await generateIdentityKeyPair();
    await this.persistKeyPair(pair);
    return pair;
  }

  async exportPublicKey(): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized');
    return exportPublicKey(this.keyPair.publicKey);
  }

  private async importPublicKey(base64Key: string): Promise<CryptoKey> {
    return importPublicKey(base64Key);
  }

  // ── Per-device sequence counter ─────────────────────────────────────────────

  private getSeqStorageKey(): string {
    return `${ChatService.SEQ_STORAGE_PREFIX}:${this.userId}`;
  }

  private async loadSeq(): Promise<number> {
    try {
      const stored = await StorageService.getMetadata(this.getSeqStorageKey());
      return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0;
    } catch {
      return 0;
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    void StorageService.setMetadata(this.getSeqStorageKey(), this.seq).catch(() => { /* advisory */ });
    return this.seq;
  }

  // ── Recipient keys ──────────────────────────────────────────────────────────

  private async fetchRecipientChatKey(recipientId: string): Promise<string | null> {
    const key = await gunOnce<string>(
      GunService.getGun().get('users').get(recipientId).get('chatPublicKey'),
      5_000,
    );
    return typeof key === 'string' && key.length > 0 ? key : null;
  }

  /**
   * The recipient's public key, fetched and cached on first use.
   *
   * Returns null rather than throwing when they have never opened the app: the
   * message is still accepted and queued, and the outbox retries once they
   * publish a key. The old behaviour — throw, and let the view swallow it —
   * discarded the message with no trace.
   */
  private async getRecipientKey(recipientId: string): Promise<CryptoKey | null> {
    const cached = this.recipientKeys.get(recipientId);
    if (cached) return cached;

    const keyB64 = await this.fetchRecipientChatKey(recipientId);
    if (!keyB64) {
      if (!this.missingKeys.has(recipientId)) {
        this.missingKeys.add(recipientId);
        this.onRecipientKeyChange?.({ userId: recipientId, available: false });
      }
      return null;
    }

    // Trust on first use. `users/{id}/chatPublicKey` is a world-writable Gun
    // node, so a fresh read is only ever a *claim* about whose key this is —
    // without a pin, overwriting that node silently redirects every future
    // message to the attacker, and nothing in the UI would look different.
    const check = await ChatKeyPinService.check(recipientId, keyB64);
    if (check.status === 'changed') {
      this.pendingKeyChanges.set(recipientId, keyB64);
      this.onKeyChange?.({
        userId: recipientId,
        pinnedKeyB64: check.pin.keyB64,
        incomingKeyB64: keyB64,
        wasVerified: !!check.pin.verifiedAt,
      });
      // Refuse to encrypt to an unrecognised key. The message stays in the
      // outbox and goes out unchanged once the user accepts the new key.
      return null;
    }
    if (check.status === 'new') {
      await ChatKeyPinService.pin(recipientId, keyB64);
    }

    try {
      const key = await this.importPublicKey(keyB64);
      this.recipientKeys.set(recipientId, key);
      if (this.missingKeys.delete(recipientId)) {
        this.onRecipientKeyChange?.({ userId: recipientId, available: true });
      }
      return key;
    } catch (error) {
      console.warn(`[ChatService] Recipient ${recipientId} has an unusable chat key:`, error);
      return null;
    }
  }

  /**
   * Accept a peer's new encryption key after the user confirmed it out of band.
   *
   * Only reachable from the key-change interstitial — accepting clears the
   * manual-verification flag, so the contact shows as unverified until its
   * safety number is compared again.
   */
  async acceptKeyChange(recipientId: string): Promise<boolean> {
    const incoming = this.pendingKeyChanges.get(recipientId);
    if (!incoming) return false;
    await ChatKeyPinService.acceptChange(recipientId, incoming);
    this.pendingKeyChanges.delete(recipientId);
    this.recipientKeys.delete(recipientId);
    // Queued messages were held, not dropped — they go out under the new key.
    void this.flushOutbox();
    return true;
  }

  /** The key change the user has been asked about but not yet answered. */
  pendingKeyChange(recipientId: string): string | undefined {
    return this.pendingKeyChanges.get(recipientId);
  }

  /**
   * Whether this is an ongoing conversation rather than cold outreach.
   *
   * Anything already exchanged with this peer counts. The check is deliberately
   * cheap and local — it only picks a proof-of-work tier, and being wrong costs
   * the sender a fraction of a second, never a delivery.
   */
  private async isEstablishedPeer(recipientId: string): Promise<boolean> {
    try {
      const rows = await StorageService.getChatMessagesByRoom(this.getRoomId(this.userId, recipientId));
      return rows.some((row) => !row.outgoing) || rows.length > 1;
    } catch {
      return true;
    }
  }

  /** Whether we currently hold a usable key for this recipient. */
  hasRecipientKey(recipientId: string): boolean {
    return this.recipientKeys.get(recipientId) !== undefined;
  }

  // ── Hybrid encryption ───────────────────────────────────────────────────────

  private async seal(text: string, recipientKey: CryptoKey): Promise<SealedEnvelope> {
    if (!this.keyPair) throw new Error('Key pair not initialized');
    // Sealed for the recipient *and* for ourselves — only the recipient's key
    // opens the first copy, so without the second a device cannot read back its
    // own sent messages.
    return seal(text, recipientKey, this.keyPair.publicKey);
  }

  private async open(raw: any, side: 'recipient' | 'sender'): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized');
    return open(raw ?? {}, this.keyPair.privateKey, side);
  }

  // ── Gun paths ───────────────────────────────────────────────────────────────

  /** Sorted so both participants derive the same room from either direction. */
  private getRoomId(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  private roomNode(roomId: string) {
    return GunService.getGun().get('chats').get(roomId);
  }

  /**
   * `chats` used to be written outside the `v3/` namespace. Reads keep going
   * through the un-namespaced root as well so conversations from before the move
   * are not lost — nothing new is ever written there.
   */
  private legacyRoomNode(roomId: string) {
    return GunService.getGun().get('chats').get(roomId); // use proxied gun so path resolves to v3/chats
  }

  /**
   * Record the room under each participant's own room index.
   *
   * Without this index the only way to find a user's conversations is to walk
   * the global `chats` root — which forces Gun to materialise *every* room of
   * *every* user into the in-memory graph just to filter them client-side, and
   * that graph is the app's whole dataset (radisk/localStorage are off). The
   * index is a plain best-effort write: chat still works if it fails, and
   * discovery falls back to the legacy root scan for pre-index rooms.
   */
  private indexRoomForParticipants(roomId: string, ...userIds: string[]): void {
    try {
      const gun = GunService.getGun();
      for (const userId of userIds) {
        if (!userId) continue;
        gun.get('users').get(userId).get('rooms').get(roomId)
          .put({ roomId, updatedAt: Date.now() });
      }
    } catch { /* index is an optimisation, never a correctness requirement */ }
  }

  private messageSoul(roomId: string, messageId: string): string {
    return `${GUN_NAMESPACE}/chats/${roomId}/${messageId}`;
  }

  // ── Local mirror ────────────────────────────────────────────────────────────

  private async storeRow(row: StoredChatMessage): Promise<void> {
    await StorageService.saveChatMessage(row);
  }

  private async patchRow(id: string, patch: Partial<StoredChatMessage>): Promise<void> {
    const existing = await StorageService.getChatMessage(id);
    if (!existing) return;
    await StorageService.saveChatMessage({ ...existing, ...patch });
  }

  /**
   * Fold a message observed in the graph into the local mirror.
   *
   * Returns the row when it is new or newly readable, so callers know whether to
   * emit it. An outgoing row we already hold is never overwritten by its own
   * echo — the local copy carries delivery state the graph does not.
   */
  private async mergeRemote(raw: any, roomId: string): Promise<StoredChatMessage | null> {
    const id = typeof raw?.id === 'string' ? raw.id : null;
    const senderId = typeof raw?.senderId === 'string' ? raw.senderId : null;
    const recipientId = typeof raw?.recipientId === 'string' ? raw.recipientId : undefined;
    if (!id || !senderId) return null;
    if (senderId !== this.userId && recipientId !== this.userId) return null;

    // Before decryption, so a blocked sender gets no CPU from us and — more to
    // the point — no read receipt and no typing signal to confirm they landed.
    if (senderId !== this.userId && ChatSafetyService.isBlocked(senderId)) return null;

    // Who wrote this. A user id *is* an x-only secp256k1 public key here (every
    // profile is keyed by `KeyService.getPublicKeyHex()`), so the claimed sender
    // and the key that must have signed are the same string — a forged
    // `senderId` cannot survive this without that user's private key.
    const verdict = verifyEnvelope(raw as Record<string, unknown>, DM_SIGNED_FIELDS, senderId);
    if (verdict.status === 'invalid') {
      console.warn(`[ChatService] Dropped message ${id} from ${senderId}: ${verdict.reason}`);
      return null;
    }
    // `unsigned` is a pre-v3 record. It still renders, marked, rather than
    // vanishing — see the wire-version note at the top of this file.
    const verified = verdict.status === 'valid';

    // The ciphertext has to be the one that was signed, not merely *a* valid
    // ciphertext: without this the signature covers a hash nobody checked.
    if (verified) {
      const expected = cipherDigest(raw?.ciphertext, raw?.keyForRecipient, raw?.keyForSender);
      if (raw?.cipherHash !== expected) {
        console.warn(`[ChatService] Dropped message ${id}: ciphertext does not match its signature`);
        return null;
      }
    }

    const existing = await StorageService.getChatMessage(id);
    if (existing && existing.text) return null;

    let text: string;
    try {
      text = await this.open(raw, senderId === this.userId ? 'sender' : 'recipient');
    } catch {
      // Encrypted with a keypair this device no longer has, or truncated in
      // transit. Skip it rather than surfacing a broken bubble.
      return null;
    }

    const row: StoredChatMessage = {
      id,
      roomId,
      kind: 'dm',
      senderId,
      senderName: typeof raw?.senderName === 'string' ? raw.senderName : undefined,
      recipientId,
      text,
      timestamp: Number(raw?.timestamp) || Date.now(),
      seq: Number(raw?.seq) || 0,
      outgoing: senderId === this.userId,
      // Present in the graph means it demonstrably left this browser.
      syncStatus: 'confirmed',
      syncAttempts: existing?.syncAttempts ?? 0,
      readAt: Number(raw?.readAt) || existing?.readAt,
      verified,
      replyTo: typeof raw?.replyTo === 'string' ? raw.replyTo : undefined,
    };
    await this.storeRow(row);
    return row;
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  private handleRoomRecord(roomId: string, raw: any): void {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return;
    if (this.seenMessageIds.has(raw.id)) return;
    this.seenMessageIds.add(raw.id);

    void (async () => {
      const row = await this.mergeRemote(raw, roomId);
      if (!row || this.shuttingDown) return;
      this.onMessage?.(toChatMessage(row));
    })();
  }

  private subscribeToRoomMessages(roomId: string): void {
    if (this.roomUnsubscribers.has(roomId)) return;

    const chains: any[] = [];
    chains.push(this.roomNode(roomId).map().on((raw: any) => this.handleRoomRecord(roomId, raw)));
    try {
      chains.push(this.legacyRoomNode(roomId).map().on((raw: any) => this.handleRoomRecord(roomId, raw)));
    } catch {
      // No raw Gun instance (tests, SSR) — the namespaced subscription is enough.
    }

    this.roomUnsubscribers.set(roomId, () => {
      for (const chain of chains) {
        try { chain?.off?.(); } catch { /* already detached */ }
      }
      this.roomUnsubscribers.delete(roomId);
    });
  }

  private subscribeToTyping(roomId: string, recipientId: string): void {
    if (this.typingUnsubscribers.has(roomId)) return;
    const chain = GunService.getGun().get('chat-presence').get(roomId).get(recipientId)
      .on((state: any) => {
        if (!state || typeof state.isTyping !== 'boolean') return;
        const isFresh = typeof state.timestamp === 'number' && (Date.now() - state.timestamp) < 10_000;
        this.onTyping?.({ from: recipientId, isTyping: state.isTyping && isFresh });
      });

    this.typingUnsubscribers.set(roomId, () => {
      try { chain?.off?.(); } catch { /* already detached */ }
      this.typingUnsubscribers.delete(roomId);
    });
  }

  private subscribeToReadReceipts(roomId: string, recipientId: string): void {
    if (this.readReceiptUnsubscribers.has(roomId)) return;
    const chain = GunService.getGun().get('chat-read').get(roomId).get(recipientId)
      .on((state: any) => {
        if (!state || state.to !== this.userId) return;
        const at = Number(state.timestamp) || Date.now();
        void this.markLocalReadUpTo(roomId, at);
        this.onReadReceipt?.({ from: recipientId, at });
      });

    this.readReceiptUnsubscribers.set(roomId, () => {
      try { chain?.off?.(); } catch { /* already detached */ }
      this.readReceiptUnsubscribers.delete(roomId);
    });
  }

  private async markLocalReadUpTo(roomId: string, at: number): Promise<void> {
    const rows = await StorageService.getChatMessagesByRoom(roomId);
    const updates = rows.filter((row) => row.outgoing && !row.readAt && row.timestamp <= at);
    if (updates.length === 0) return;
    await StorageService.saveChatMessages(updates.map((row) => ({ ...row, readAt: at })));
  }

  // ── History ─────────────────────────────────────────────────────────────────

  /** Everything this device already holds. Resolves immediately — no network. */
  async getLocalHistory(recipientId: string): Promise<ChatMessage[]> {
    const roomId = this.getRoomId(this.userId, recipientId);
    const rows = await StorageService.getChatMessagesByRoom(roomId);
    for (const row of rows) this.seenMessageIds.add(row.id);
    return rows.sort(compareMessages).map(toChatMessage);
  }

  /**
   * Local history merged with whatever the graph holds.
   *
   * Always settles: `gunReadChildren` stops on quiet or a hard ceiling rather
   * than waiting for callbacks Gun never promised to fire.
   */
  async loadHistory(recipientId: string): Promise<ChatMessage[]> {
    const roomId = this.getRoomId(this.userId, recipientId);

    const [current, remote, legacy] = await Promise.all([
      StorageService.getChatMessagesByRoom(roomId),
      gunReadChildren<any>(this.roomNode(roomId), { minMs: 600, maxMs: 8_000 }),
      this.readLegacyRoom(roomId),
    ]);

    const byId = new Map<string, StoredChatMessage>();
    for (const row of current) byId.set(row.id, row);

    for (const { value } of [...remote, ...legacy]) {
      if (!value || typeof value !== 'object') continue;
      const merged = await this.mergeRemote(value, roomId);
      if (merged) byId.set(merged.id, merged);
    }

    const rows = [...byId.values()].sort(compareMessages);
    for (const row of rows) this.seenMessageIds.add(row.id);
    return rows.map(toChatMessage);
  }

  private async readLegacyRoom(roomId: string): Promise<{ key: string; value: any }[]> {
    try {
      return await gunReadChildren<any>(this.legacyRoomNode(roomId), { minMs: 400, maxMs: 5_000 });
    } catch {
      return [];
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────────

  /**
   * Queue a message and start delivering it.
   *
   * The row hits IndexedDB before any encryption or network work, so a failure
   * anywhere downstream costs a retry, never the message. The returned
   * `ChatMessage` carries the current delivery state; further changes arrive via
   * `onMessageStatus`.
   */
  async sendMessage(recipientId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('Cannot send an empty message');
    if (!this.keyPair) throw new Error('Chat is not initialized yet');

    const timestamp = Date.now();
    const row: StoredChatMessage = {
      id: `msg-${timestamp}-${Math.random().toString(36).slice(2, 11)}`,
      roomId: this.getRoomId(this.userId, recipientId),
      kind: 'dm',
      senderId: this.userId,
      recipientId,
      text,
      timestamp,
      seq: this.nextSeq(),
      outgoing: true,
      syncStatus: 'pending',
      syncAttempts: 0,
    };

    await this.storeRow(row);
    this.seenMessageIds.add(row.id);

    // Deliver in the background: the message is already safe, and blocking the
    // composer on a relay round-trip is what made sending feel broken.
    void this.deliver(row).then((delivered) => {
      this.onMessageStatus?.({ id: delivered.id, status: delivered.syncStatus, error: delivered.error });
    });

    return toChatMessage(row);
  }

  /**
   * One delivery attempt. Never throws — the caller records the outcome and the
   * outbox loop tries again later.
   */
  private async deliver(row: StoredChatMessage): Promise<StoredChatMessage> {
    const recipientId = row.recipientId;
    if (!recipientId) return row;

    const attempts = row.syncAttempts + 1;
    const expired = Date.now() - row.timestamp > OUTBOX_TTL_MS;

    const fail = async (error: string): Promise<StoredChatMessage> => {
      const status: SyncStatus = attempts >= MAX_SEND_ATTEMPTS || expired ? 'failed' : 'pending';
      const patch = { syncStatus: status, syncAttempts: attempts, error };
      await this.patchRow(row.id, patch);
      return { ...row, ...patch };
    };

    const recipientKey = await this.getRecipientKey(recipientId);
    if (!recipientKey) {
      return fail('Waiting for the recipient to publish a chat key');
    }

    let sealed: Awaited<ReturnType<ChatService['seal']>>;
    try {
      sealed = await this.seal(row.text, recipientKey);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Encryption failed');
    }

    // Sign the envelope, not the plaintext: anyone must be able to establish who
    // wrote a message without being able to read it. `cipherHash` is what ties
    // the signature to this exact ciphertext and key wrapping.
    const cipherHash = cipherDigest(sealed.ciphertext, sealed.keyForRecipient, sealed.keyForSender);
    let envelope: Awaited<ReturnType<typeof sealEnvelope>>;
    try {
      const { privateKey, publicKey } = await KeyService.getKeyPair();
      envelope = await sealEnvelope(
        {
          id: row.id,
          senderId: row.senderId,
          recipientId,
          timestamp: row.timestamp,
          seq: row.seq,
          cipherHash,
        },
        privateKey,
        publicKey,
        // Cold outreach pays more. `attempts === 1` alone would re-charge every
        // retry, so the tier follows the conversation, not the attempt.
        (await this.isEstablishedPeer(recipientId)) ? CHAT_POW_BASE : CHAT_POW_COLD,
      );
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Could not sign the message');
    }

    const record = toGunRecord({
      id: row.id,
      v: WIRE_VERSION,
      senderId: row.senderId,
      recipientId,
      ciphertext: sealed.ciphertext,
      keyForRecipient: sealed.keyForRecipient,
      keyForSender: sealed.keyForSender,
      timestamp: row.timestamp,
      seq: row.seq,
      cipherHash,
      ...envelope,
    });

    const ack = await gunPut(this.roomNode(row.roomId).get(row.id), record);
    if (!ack.ok) return fail(ack.err || 'Message could not be written to the graph');

    this.indexRoomForParticipants(row.roomId, this.userId, recipientId);

    // Best-effort real-time nudge. The relay gates `register` behind an
    // authenticated session, so this silently does nothing for anonymous users —
    // Gun replication is the transport that actually has to work.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'chat-message',
        recipientId,
        messageId: row.id,
        v: WIRE_VERSION,
        ciphertext: sealed.ciphertext,
        keyForRecipient: sealed.keyForRecipient,
        timestamp: row.timestamp,
      }));
    }

    const onRelay = await verifySoulOnRelay(this.messageSoul(row.roomId, row.id), 6_000);
    // `false` (relay says no) and `null` (no reachable endpoint) both mean keep
    // trying, but a peer-acked write is further along than an unsent one.
    const status: SyncStatus = onRelay === true ? 'confirmed' : 'published';
    const patch = { syncStatus: status, syncAttempts: attempts, error: undefined };
    await this.patchRow(row.id, patch);
    return { ...row, ...patch };
  }

  // ── Outbox ──────────────────────────────────────────────────────────────────

  /**
   * Re-send every outgoing message no relay has confirmed.
   *
   * Gun does not retro-sync writes made while every peer was unreachable, so
   * without this a message written offline stays in this browser forever. State
   * lives in IndexedDB, so a reload mid-outage does not reset progress.
   */
  async flushOutbox(): Promise<void> {
    if (flushInFlight.has(this.userId) || !this.ready) return;
    flushInFlight.add(this.userId);
    try {
      const all = await StorageService.getAllChatMessages();
      const now = Date.now();
      const pending = all.filter((row) =>
        row.kind === 'dm'
        && row.outgoing
        && row.senderId === this.userId
        && row.syncStatus !== 'confirmed'
        && row.syncAttempts < MAX_SEND_ATTEMPTS
        && now - row.timestamp < OUTBOX_TTL_MS);

      for (const row of pending) {
        // `deliver` re-resolves the recipient key whenever it is not cached, so
        // a message queued before the peer ever opened the app goes out on its
        // own as soon as they publish one.
        const result = await this.deliver(row);
        this.onMessageStatus?.({ id: result.id, status: result.syncStatus, error: result.error });
      }
    } catch (error) {
      console.warn('[ChatService] Outbox flush failed:', error);
    } finally {
      flushInFlight.delete(this.userId);
    }
  }

  private startOutboxLoop(): void {
    if (this.flushTimer !== null || typeof window === 'undefined') return;

    const tick = () => {
      if (this.shuttingDown) return;
      void this.flushOutbox()
        .then(() => {
          this.flushCount++;
          if (this.flushCount % PRUNE_EVERY_N_FLUSHES === 0) {
            return StorageService.pruneChatMessages().then(() => undefined);
          }
          return undefined;
        })
        .catch(() => { /* logged in flushOutbox */ })
        .finally(() => {
          if (this.shuttingDown) return;
          this.flushTimer = window.setTimeout(tick, FLUSH_INTERVAL_MS);
        });
    };
    this.flushTimer = window.setTimeout(tick, 5_000);

    this.onlineHandler = () => { void this.flushOutbox(); };
    window.addEventListener('online', this.onlineHandler);
  }

  // ── Connection state ────────────────────────────────────────────────────────

  /**
   * Honest connectivity: at least one transport that can actually move a
   * message. `init()` used to set this to true unconditionally, so the UI
   * reported "Connected" with no peers and no relay — and every send silently
   * went nowhere.
   */
  private computeConnected(): boolean {
    if (!this.ready) return false;
    if (this.ws?.readyState === WebSocket.OPEN) return true;
    try {
      return GunService.getPeerStats().isConnected;
    } catch {
      return false;
    }
  }

  private refreshConnectionState(): void {
    const next = this.computeConnected();
    if (next === this.connected) return;
    this.connected = next;
    this.onConnectionChange?.(next);
    if (next) void this.flushOutbox();
  }

  private startConnectionTracking(): void {
    if (typeof window === 'undefined') return;
    this.refreshConnectionState();
    if (this.connectionPoll === null) {
      this.connectionPoll = window.setInterval(() => this.refreshConnectionState(), CONNECTION_POLL_MS);
    }
    if (!this.offGunReconnect) {
      this.offGunReconnect = GunService.onReconnect(() => {
        if (this.shuttingDown) return;
        // A reconnect rebuilds the Gun instance, so every chain we hold is bound
        // to a discarded graph and has gone quiet. Rebuild them.
        this.reattachRooms();
        this.refreshConnectionState();
        void this.flushOutbox();
      });
    }
  }

  private reattachRooms(): void {
    const rooms = [...this.watchedRooms.entries()];
    for (const [roomId] of rooms) {
      this.roomUnsubscribers.get(roomId)?.();
      this.typingUnsubscribers.get(roomId)?.();
      this.readReceiptUnsubscribers.get(roomId)?.();
    }
    for (const [roomId, recipientId] of rooms) {
      this.subscribeToRoomMessages(roomId);
      this.subscribeToTyping(roomId, recipientId);
      this.subscribeToReadReceipts(roomId, recipientId);
    }
  }

  /**
   * Re-scans every room we are watching for messages that arrived while offline.
   *
   * Gun's `.map().on()` fires for existing nodes when the graph syncs from peers,
   * but that sync can take several seconds after the WebSocket opens. Calling
   * this with a short delay after `ws.onopen` gives Gun time to settle and then
   * explicitly walks all known rooms so no offline message is missed.
   */
  private replayOfflineMessages(): void {
    if (this.shuttingDown) return;
    const gun = GunService.getGun();
    for (const [roomId] of this.watchedRooms) {
      // Walk the room node once — handleRoomRecord deduplicates by seenMessageIds
      gun.get('chats').get(roomId).map().once((raw: any) => {
        this.handleRoomRecord(roomId, raw);
      });
    }
    // Also check the rooms index in case new rooms were added while offline
    gun.get('users').get(this.userId).get('rooms').map().once((roomData: any, roomId: string) => {
      if (!roomId || roomId === '_' || !roomId.includes(':') || !roomId.includes(this.userId)) return;
      gun.get('chats').get(roomId).map().once((raw: any) => {
        this.handleRoomRecord(roomId, raw);
      });
    });
  }

  // ── WebSocket ───────────────────────────────────────────────────────────────

  private connect(): void {
    if (!this.wsUrl || this.shuttingDown) return;
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (error) {
      console.warn('[ChatService] Could not open chat WebSocket:', error);
      return;
    }

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: 'register', peerId: this.peerId, userId: this.userId }));
      this.refreshConnectionState();
      // After reconnecting, replay Gun history for every known room so messages
      // sent while Y was offline are decrypted and surfaced. Gun's .map().on()
      // fires for existing nodes when a subscription starts, but only after the
      // graph has synced from peers — a short delay lets that happen first.
      setTimeout(() => this.replayOfflineMessages(), 3_000);
    };

    this.ws.onmessage = async (event) => {
      try { await this.handleWsMessage(JSON.parse(event.data)); }
      catch (error) { console.error('[ChatService] Bad chat frame:', error); }
    };

    this.ws.onerror = () => { /* onclose handles recovery; the event carries nothing useful */ };

    this.ws.onclose = () => {
      this.refreshConnectionState();
      if (this.shuttingDown) return;
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2_000);
    };
  }

  private async handleWsMessage(data: any): Promise<void> {
    switch (data?.type) {
      case 'chat-message': {
        const messageId = typeof data.messageId === 'string' ? data.messageId : null;
        if (!messageId || this.seenMessageIds.has(messageId)) return;
        this.seenMessageIds.add(messageId);
        const roomId = this.getRoomId(this.userId, data.from);
        // The relay forwards the same envelope Gun holds, so the merge path is
        // identical — including the v1 fallback for peers on the old build.
        const row = await this.mergeRemote({
          id: messageId,
          senderId: data.from,
          recipientId: this.userId,
          ciphertext: data.ciphertext,
          keyForRecipient: data.keyForRecipient,
          encryptedForRecipient: data.encryptedForRecipient,
          timestamp: data.timestamp,
        }, roomId);
        if (row) this.onMessage?.(toChatMessage(row));
        break;
      }

      case 'chat-typing':
        this.onTyping?.({ from: data.from, isTyping: !!data.isTyping });
        break;

      case 'chat-delivered':
        this.onDelivered?.({ messageId: data.messageId, recipientId: data.recipientId });
        break;

      case 'chat-read-receipt': {
        const at = Number(data.at) || Date.now();
        void this.markLocalReadUpTo(this.getRoomId(this.userId, data.from), at);
        this.onReadReceipt?.({ from: data.from, at });
        break;
      }
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Open a conversation: subscribe to it and start resolving the peer's key.
   *
   * Resolves even when the peer has never published a key. History is still
   * readable in that case, and anything typed is queued rather than lost — the
   * old version threw here, which left the whole view in an error state.
   */
  async startChat(recipient: RecipientInfo): Promise<void> {
    const roomId = this.getRoomId(this.userId, recipient.userId);
    this.watchedRooms.set(roomId, recipient.userId);

    this.subscribeToRoomMessages(roomId);
    this.subscribeToTyping(roomId, recipient.userId);
    this.subscribeToReadReceipts(roomId, recipient.userId);

    if (recipient.publicKey) {
      try {
        this.recipientKeys.set(recipient.userId, await this.importPublicKey(recipient.publicKey));
      } catch { /* fall through to the graph lookup */ }
    }
    const key = await this.getRecipientKey(recipient.userId);
    if (key) this.onRecipientKeyChange?.({ userId: recipient.userId, available: true });

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-start', recipientId: recipient.userId }));
    }
  }

  sendTyping(recipientId: string, isTyping: boolean): void {
    const roomId = this.getRoomId(this.userId, recipientId);
    void gunPut(GunService.getGun().get('chat-presence').get(roomId).get(this.userId), {
      from: this.userId,
      to: recipientId,
      isTyping,
      timestamp: Date.now(),
    });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-typing', recipientId, isTyping }));
    }
  }

  /**
   * Tell the peer we have read up to now.
   *
   * A single marker node, not a write per message: the old version mapped the
   * whole room and issued one `put` per unread message, which on a long
   * conversation was a write storm that pushed out the traffic that mattered.
   */
  markAsRead(recipientId: string): void {
    const roomId = this.getRoomId(this.userId, recipientId);
    const at = Date.now();
    void gunPut(GunService.getGun().get('chat-read').get(roomId).get(this.userId), {
      from: this.userId,
      to: recipientId,
      timestamp: at,
    });
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-read', recipientId, at }));
    }
    void (async () => {
      const rows = await StorageService.getChatMessagesByRoom(roomId);
      const unread = rows.filter((row) => !row.outgoing && !row.readAt);
      if (unread.length) {
        await StorageService.saveChatMessages(unread.map((row) => ({ ...row, readAt: at })));
      }
    })();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** True once keys are loaded — messages can be composed even while offline. */
  isReady(): boolean {
    return this.ready;
  }

  disconnect(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.connectionPoll) { clearInterval(this.connectionPoll); this.connectionPoll = null; }
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.onlineHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    this.offGunReconnect?.();
    this.offGunReconnect = null;

    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } this.ws = null; }

    for (const unsubscribe of this.roomUnsubscribers.values()) unsubscribe();
    for (const unsubscribe of this.typingUnsubscribers.values()) unsubscribe();
    for (const unsubscribe of this.readReceiptUnsubscribers.values()) unsubscribe();
    this.roomUnsubscribers.clear();
    this.typingUnsubscribers.clear();
    this.readReceiptUnsubscribers.clear();
    this.watchedRooms.clear();

    this.ready = false;
    if (this.connected) {
      this.connected = false;
      this.onConnectionChange?.(false);
    }
  }
}

export default ChatService;