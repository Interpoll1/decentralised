/**
 * Direct messages — Signal Protocol encrypted, relay-WS primary, Gun fallback.
 *
 * WHAT CHANGED FROM THE PREVIOUS VERSION:
 *
 * 1. Encryption: RSA/AES hybrid → Signal double-ratchet (signalProtocol.ts)
 *    - Every message gets a fresh key derived from the ratchet chain
 *    - Relay sees only opaque ciphertext, sender id, recipient id
 *    - Forward secrecy: past messages safe even if keys leak today
 *    - Break-in recovery: session self-heals within ~50 messages after compromise
 *
 * 2. Live delivery: Gun .map().on() → relay WS primary
 *    - sendMessage() pushes a 'chat-message' frame via WS immediately after Gun put
 *    - Recipient's handleWsMessage fires onMessage directly — no Gun round-trip
 *    - Gun .map().on() kept as fallback with self-healing reattach timer
 *
 * 3. Presence: 4-layer system
 *    - Layer 1: Gun .on() (fast when healthy)
 *    - Layer 2: gunOnce immediate read
 *    - Layer 3: relay ping-peer poll every 15s (authoritative)
 *    - Layer 4: stale-check timer (catches crash/network-drop)
 */

import { GunService, GUN_NAMESPACE } from './gunService';
import { StorageService } from './storageService';
import { BoundedMap, BoundedSet } from '../utils/boundedMap';
import { gunPut, gunOnce, gunReadChildren, toGunRecord } from '../utils/gunAsync';
import config from '../config';

/** HTTP base URL of the relay-server (port 3001) — where signal bundles and chat APIs live. */
function chatRelayBase(): string {
  const ws = config.relay.websocket; // e.g. wss://interpoll.endless.sbs
  return ws.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://').replace(/\/$/, '');
}
import {
  SignalSession, SignalPublicBundle, SignalEnvelope,
  SIGNAL_WIRE_VERSION, getOrCreateIdentityBundle,
  getSafetyNumber,
  loadOrCreateOPKPool, generateOPKBatch,
  getOPKPoolSize, OPK_POOL_SIZE, OPK_POOL_LOW_WATER,
  type OPKEntry,
} from './signalProtocol';
import { compareMessages } from '../utils/messageOrder';
import type { StoredChatMessage, SyncStatus } from '../types/social';

function getGunWire(gun: any): WebSocket | undefined {
  try {
    const peers = gun?._.opt?.peers;
    if (!peers) return undefined;
    for (const k of Object.keys(peers)) {
      const w = peers[k]?.wire;
      if (w?.readyState === WebSocket.OPEN) return w as WebSocket;
    }
  } catch { }
  return undefined;
}

export interface ChatMessage {
  id:        string;
  from:      string;
  to:        string;
  message:   string;
  timestamp: number;
  read:      boolean;
  sent:      boolean;
  status?:   SyncStatus;
  error?:    string;
}

export interface RecipientInfo {
  userId:    string;
  name?:     string;
  avatar?:   string;
}

// Wire version for new outgoing messages
const WIRE_VERSION = SIGNAL_WIRE_VERSION; // 3

// ── Constants ─────────────────────────────────────────────────────────────────
const PRESENCE_HB_MS        = 30_000;
const PRESENCE_STALE_MS     = 180_000; // 3min (was 95s)
const PRESENCE_PING_MS      = 3_000;
const PRESENCE_POLL_MS      = 15_000;
const OUTBOX_TTL_MS         = 7 * 24 * 60 * 60 * 1000;
const MAX_SEND_ATTEMPTS     = 12;
const FLUSH_INTERVAL_MS     = 15_000; // retry pending messages every 15s (was 60s)
const CONNECTION_POLL_MS    = 3_000;
const PRUNE_EVERY_N_FLUSHES = 60;
const GUN_CHAIN_HEALTH_MS   = 20_000;

const flushInFlight = new Set<string>();

const _seenIds = new Map<string, BoundedSet<string>>();
function seenIds(userId: string): BoundedSet<string> {
  if (!_seenIds.has(userId))
    _seenIds.set(userId, new BoundedSet<string>({ maxSize: 5_000, ttlMs: 60 * 60_000 }));
  return _seenIds.get(userId)!;
}

function toChatMessage(row: StoredChatMessage): ChatMessage {
  let mediaUrl: string|undefined, mediaType: 'image'|'video'|'file'|undefined;
  let fileName: string|undefined, fileSize: number|undefined;
  // Default display text — overwritten below if we successfully parse a _file payload.
  // Kept as the raw JSON only as a last resort; the view guards against rendering it.
  let displayText = row.text;
  try {
    if (row.text?.startsWith('{"_file":true')) {
      const f = JSON.parse(row.text);
      if (f._url && f.url) {
        // Large file: relay-hosted persistent URL
        mediaUrl  = f.url;
        mediaType = f.mime?.startsWith('video') ? 'video' : f.mime?.startsWith('image') ? 'image' : 'file';
        fileName  = f.name; fileSize = f.size; displayText = f.name;
      } else if (f.data) {
        // Small file: inline base64 encoded with 8190-byte chunks (divisible by 3).
        // Use Uint8Array directly — faster and avoids charCodeAt loop issues.
        const raw64  = f.data as string;
        const binary = atob(raw64);
        const buf    = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
        mediaUrl  = URL.createObjectURL(new Blob([buf], { type: f.mime || 'application/octet-stream' }));
        mediaType = f.mime?.startsWith('video') ? 'video' : f.mime?.startsWith('image') ? 'image' : 'file';
        fileName  = f.name; fileSize = f.size; displayText = f.name;
      } else {
        // _file payload but no data or url — show as unavailable rather than raw JSON
        displayText = f.name || '';
      }
    }
  } catch (e) {
    // Parse/decode failure — clear displayText so the view shows "Media unavailable"
    // instead of dumping raw JSON or base64 into the chat bubble.
    if (row.text?.startsWith('{"_file":true')) displayText = '';
  }
  return {
    id:        row.id,
    from:      row.senderId,
    to:        row.recipientId || '',
    message:   displayText,
    timestamp: row.timestamp,
    read:      !!row.readAt,
    sent:      row.outgoing,
    status:    row.outgoing ? row.syncStatus : undefined,
    error:     row.error,
    mediaUrl, mediaType, fileName, fileSize,
  };
}

class ChatService {
  private static readonly SEQ_KEY = (uid: string) => `chat-seq:${uid}`;

  private ws:           WebSocket | null = null;
  private wsUrl:        string;
  private userId:       string;
  private peerId:       string;

  // Signal identity bundle (generated/loaded in init())
  private myBundle:     Awaited<ReturnType<typeof getOrCreateIdentityBundle>> | null = null;

  // Signal sessions keyed by recipientId
  private sessions      = new BoundedMap<string, SignalSession>({ maxSize: 200 });

  // Cached recipient public bundles fetched from Gun
  private theirBundles  = new BoundedMap<string, SignalPublicBundle>({ maxSize: 200 });

  private missingBundles = new Set<string>();
  private ready          = false;
  private connected      = false;
  private seq            = 0;
  private shuttingDown        = false;
  private wsRegistered        = false;        // true once relay confirms 'registered'
  private pendingReadRecipients = new Set<string>(); // markAsRead calls before registered

  private reconnectTimer:   number | null = null;
  private connectionPoll:   number | null = null;
  private flushTimer:       number | null = null;
  private flushCount        = 0;
  private offGunReconnect:  (() => void) | null = null;
  private onlineHandler:    (() => void) | null = null;

  private roomUnsubscribers   = new Map<string, () => void>();
  private roomHealthTimers    = new Map<string, number>();
  // Tracks last activity time per room so outgoing sends keep the health timer from
  // falsely concluding the Gun chain is dead and triggering a noisy reattach loop.
  private roomLastFired       = new Map<string, number>();
  private typingUnsubscribers = new Map<string, () => void>();
  private readReceiptUnsubs   = new Map<string, () => void>();
  private watchedRooms        = new Map<string, string>(); // roomId → recipientId
  private _visibilityHandler: (() => void) | null = null;  // fires markAsRead on tab-focus
  // Per-sender decrypt queue: serialises mergeRemote calls so concurrent
  // WS + Gun deliveries don't race on loadSession/saveSession and corrupt
  // the ratchet state (e.g. message 2 loading nr=0 while message 1's
  // saveSession(nr=1) is still in flight).
  private decryptQueue        = new Map<string, Promise<void>>(); // senderId → tail of chain
  private clearedRooms        = new Set<string>();                // rooms user cleared

  // ── Presence ──────────────────────────────────────────────────────────────
  private presenceTimer:             number | null = null;
  private presenceVisibilityHandler: (() => void) | null = null;
  private presenceOfflineHandler:    (() => void) | null = null;
  private presenceSubs               = new Map<string, () => void>();
  private _offlineSuppressed         = false;

  public onMessage:            ((msg: ChatMessage) => void) | null = null;
  public onMessageStatus:      ((d: { id: string; status: SyncStatus; error?: string }) => void) | null = null;
  public onTyping:             ((d: { from: string; isTyping: boolean }) => void) | null = null;
  public onDelivered:          ((d: { messageId: string; recipientId: string }) => void) | null = null;
  public onReadReceipt:        ((d: { from: string; at: number }) => void) | null = null;
  public onConnectionChange:   ((connected: boolean) => void) | null = null;
  public onRecipientKeyChange: ((d: { userId: string; available: boolean }) => void) | null = null;
  public onPeerPresence:       ((d: { userId: string; online: boolean; ts: number }) => void) | null = null;
  // WebRTC signaling via chat relay WS
  public onRtcSignal: ((d: { from: string; payload: any }) => void) | null = null;

  suppressOffline(ms = 30_000): () => void {
    if (ms === 0) { this._offlineSuppressed = false; return () => {}; }
    this._offlineSuppressed = true;
    const t = window.setTimeout(() => { this._offlineSuppressed = false; }, ms);
    return () => { this._offlineSuppressed = false; clearTimeout(t); };
  }

  constructor(wsUrl: string, userId: string) {
    this.wsUrl  = wsUrl;
    this.userId = userId;
    this.peerId = `peer-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async init(): Promise<string> {
    this.shuttingDown = false;

    // One-time migration: clear broken Signal sessions from protocol v1
    // (initSessionAsReceiver set ckR="" causing OperationError on decrypt).
    const SIGNAL_MIGRATION_KEY = `signal-protocol-version:${this.userId}`;
    try {
      const ver = await StorageService.getMetadata(SIGNAL_MIGRATION_KEY).catch(() => null);
      if (ver !== 3) {
        // v3: session keys are now directional (myId:theirId) not sorted.
        // Clear all signal-session keys so X3DH re-runs cleanly with the fixed protocol.
        const prefix = "signal-session:";
        const allKeys: string[] = (await (StorageService as any).getAllMetadataKeys?.() ?? []);
        await Promise.all(
          allKeys.filter(k => k.startsWith(prefix))
            .map(k => StorageService.setMetadata(k, null))
        );
        await StorageService.setMetadata(SIGNAL_MIGRATION_KEY, 3);
      }
    } catch { /* migration is best-effort; sessions re-establish via X3DH on next send */ }

    // Generate or load Signal identity bundle
    this.myBundle = await getOrCreateIdentityBundle(this.userId);
    this.seq      = await this.loadSeq();

    // Publish our Signal public bundle to Gun immediately (no auth needed).
    // The REST POST to the relay is deferred until after 'registered' arrives
    // (see handleWsMessage case 'registered') so the relay's liveClient ownership
    // check can find our WS session. Doing it here before connect() causes a 403
    // for anonymous users and the bundle is never stored in MySQL → recipients
    // can't fetch it → encryptFor throws → messages silently fail to send.
    const bundleStr = JSON.stringify(this.myBundle.bundle);
    const node      = GunService.getGun().get('users').get(this.userId);

    // Gun publish (fire-and-forget, no auth needed)
    const existing = await gunOnce<string>(node.get('signalBundle'), 1_500);
    if (existing !== bundleStr) {
      void gunPut(node, { signalBundle: bundleStr });
    }

    // Also keep legacy RSA public key published for peers running old versions
    // No-op if already published — init() of old ChatService handled this.

    this.ready = true;
    this.startConnectionTracking();
    this.startOutboxLoop();
    this.startPresence();
    this.startVisibilityTracking();
    if (this.wsUrl) this.connect();
    return bundleStr;
  }

  // ── Sequence ──────────────────────────────────────────────────────────────

  private async loadSeq(): Promise<number> {
    try {
      const s = await StorageService.getMetadata(ChatService.SEQ_KEY(this.userId));
      return typeof s === 'number' && Number.isFinite(s) ? s : 0;
    } catch { return 0; }
  }

  private nextSeq(): number {
    this.seq++;
    void StorageService.setMetadata(ChatService.SEQ_KEY(this.userId), this.seq).catch(() => {});
    return this.seq;
  }

  // ── Signal bundle lookup ──────────────────────────────────────────────────

  private async fetchTheirBundle(recipientId: string): Promise<SignalPublicBundle | null> {
    // 0. IDB cache: survives page reloads, never hits the rate limiter
    const idbKey = 'signal-bundle-cache:' + recipientId;
    try {
      const cached = await StorageService.getMetadata(idbKey);
      if (cached?.ik && cached?.spk) {
        if (Date.now() - (cached._cachedAt ?? 0) < 3_600_000) { // 1h TTL
          // verifySpkSignature handles missing spkSig gracefully (warn only),
          // so serve the cached bundle regardless of whether spkSig is present.
          return cached as unknown as SignalPublicBundle;
        }
      }
    } catch { }

    // 1. REST endpoint — retry once after 1.5s on 404 to handle the race where
    // the peer's publishBundleToRelay() is still in-flight when we fetch.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
      try {
        const res = await fetch(`${chatRelayBase()}/api/signal-bundle/${encodeURIComponent(recipientId)}`);
        if (res.ok) {
          const bundle = await res.json() as SignalPublicBundle;
          if (bundle.ik && bundle.spk) {
            try {
              const { verifySpkSignature } = await import('./signalProtocol');
              await verifySpkSignature(bundle);
            } catch (e) {
              console.error('[ChatService] SPK signature invalid for', recipientId, '— refusing bundle:', e);
              this.onRecipientKeyChange?.({ userId: recipientId, available: false });
              return null;
            }
            void StorageService.setMetadata(idbKey, { ...bundle, _cachedAt: Date.now() }).catch(() => {});
            return bundle;
          }
        }
        if (res.status !== 404) break; // non-404 errors won't be fixed by waiting
      } catch { break; }
    }

    // 2. Gun fallback
    try {
      const raw = await gunOnce<string>(
        GunService.getGun().get('users').get(recipientId).get('signalBundle'), 5_000,
      );
      if (raw) {
        const bundle = JSON.parse(raw) as SignalPublicBundle;
        try {
          const { verifySpkSignature } = await import('./signalProtocol');
          await verifySpkSignature(bundle);
        } catch (e) {
          console.error('[ChatService] Gun bundle SPK signature invalid for', recipientId, '— refusing:', e);
          return null;
        }
        void StorageService.setMetadata(idbKey, { ...bundle, _cachedAt: Date.now() }).catch(() => {});
        return bundle;
      }
    } catch { }

    return null;
  }

  // Track last fetch attempt time to enforce per-user rate limiting
  private bundleFetchTs = new Map<string, number>();
  private static BUNDLE_FETCH_COOLDOWN = 300_000; // 5min cooldown (IDB cache handles reloads)

  private async getTheirBundle(recipientId: string): Promise<SignalPublicBundle | null> {
    const cached = this.theirBundles.get(recipientId);
    if (cached) return cached;

    // Cooldown: never fetch the same userId more than once per 30s.
    // Gun re-delivers old messages constantly; without this each delivery triggers a fetch.
    const lastFetch = this.bundleFetchTs.get(recipientId) ?? 0;
    if (Date.now() - lastFetch < ChatService.BUNDLE_FETCH_COOLDOWN) {
      return this.missingBundles.has(recipientId) ? null : (this.theirBundles.get(recipientId) ?? null);
    }

    this.bundleFetchTs.set(recipientId, Date.now());
    const bundle = await this.fetchTheirBundle(recipientId);
    if (!bundle) {
      if (!this.missingBundles.has(recipientId)) {
        this.missingBundles.add(recipientId);
        this.onRecipientKeyChange?.({ userId: recipientId, available: false });
      }
      return null;
    }
    this.theirBundles.set(recipientId, bundle);
    this.bundleFetchTs.delete(recipientId);
    if (this.missingBundles.delete(recipientId))
      this.onRecipientKeyChange?.({ userId: recipientId, available: true });
    return bundle;
  }

  hasRecipientKey(recipientId: string): boolean {
    return this.theirBundles.has(recipientId) || !this.missingBundles.has(recipientId);
  }

  // ── Signal session management ─────────────────────────────────────────────

  private getSession(recipientId: string): SignalSession {
    let s = this.sessions.get(recipientId);
    if (!s) {
      s = new SignalSession(this.userId, recipientId);
      this.sessions.set(recipientId, s);
    }
    return s;
  }

  // ── Encryption ────────────────────────────────────────────────────────────

  private async encryptFor(recipientId: string, plaintext: string): Promise<SignalEnvelope> {
    if (!this.myBundle) throw new Error('Not initialized');

    // FIX A: removed duplicate stale-session deletion that was here.
    // SignalSession.encrypt() already detects staleness (!ckR && ns>0) and re-runs X3DH.
    // The extra deletion here fired after the FIRST send (ns=1, ckR still '') and
    // wiped the session before the second send, causing it to issue a second X3DH
    // with a new ephemeral key. The receiver then got two different X3DH inits:
    // the first was reset by the second, so message 1 was lost and message 2 survived.

    const bundle   = await this.getTheirBundle(recipientId);
    if (!bundle) throw new Error('Recipient has no Signal key bundle yet');
    const envelope = await this.getSession(recipientId).encrypt(plaintext, this.myBundle, bundle);
    // If this was a new X3DH session (eph present), the relay consumed one OPK.
    // Replenish in the background so the pool stays healthy.
    if (envelope.eph) void this.ensureOPKPool();
    return envelope;
  }

  private async decryptFrom(
    senderId: string, envelope: SignalEnvelope,
  ): Promise<string> {
    if (!this.myBundle) throw new Error('Not initialized');

    // Bundle may not have arrived yet — retry up to 3× with backoff before giving up.
    // This covers the race where a message arrives via WS before the sender's
    // bundle has synced (REST hit is <20ms, so retries are cheap).
    let theirBundle = await this.getTheirBundle(senderId);
    if (!theirBundle) {
      for (const delayMs of [500, 1500, 3000]) {
        await new Promise(r => setTimeout(r, delayMs));
        // Force re-fetch by clearing cache and trying again
        this.theirBundles.delete(senderId);
        this.missingBundles.delete(senderId);
        theirBundle = await this.getTheirBundle(senderId);
        if (theirBundle) break;
      }
    }
    if (!theirBundle) throw new Error(`Bundle unavailable for sender ${senderId.slice(0, 16)}`);
    return this.getSession(senderId).decrypt(envelope, this.myBundle, theirBundle.ik, this.userId);
  }

  // ── Gun paths ─────────────────────────────────────────────────────────────

  private getRoomId(a: string, b: string) { return [a, b].sort().join(':'); }

  private roomNode(roomId: string) {
    return GunService.getGun().get('chats').get(roomId);
  }

  private messageSoul(roomId: string, msgId: string) {
    return `${GUN_NAMESPACE}/chats/${roomId}/${msgId}`;
  }

  private indexRoom(roomId: string, ...ids: string[]) {
    try {
      const gun = GunService.getGun();
      for (const id of ids) {
        if (id) gun.get('users').get(id).get('rooms').get(roomId)
          .put({ roomId, updatedAt: Date.now() });
      }
    } catch { }
  }

  // ── Local storage ─────────────────────────────────────────────────────────

  private async storeRow(row: StoredChatMessage) {
    await StorageService.saveChatMessage(row);
  }

  private async patchRow(id: string, patch: Partial<StoredChatMessage>) {
    const ex = await StorageService.getChatMessage(id);
    if (ex) await StorageService.saveChatMessage({ ...ex, ...patch });
  }

  /**
   * Merge a raw Gun/WS record into local storage.
   * Handles v3 (Signal), v2 (AES-GCM+RSA wrap), and v1 (RSA only).
   */
  private mergeRemote(raw: any, roomId: string): Promise<StoredChatMessage | null> {
    const id          = typeof raw?.id === 'string'          ? raw.id          : null;
    const senderId    = typeof raw?.senderId === 'string'    ? raw.senderId    : null;
    const recipientId = typeof raw?.recipientId === 'string' ? raw.recipientId : undefined;
    if (!id || !senderId) return Promise.resolve(null);
    if (senderId !== this.userId && recipientId !== this.userId) return Promise.resolve(null);

    // Serialise per-sender: await the previous decrypt for this sender
    // before starting a new one, so loadSession always sees the latest
    // saveSession result and the ratchet counter is never double-read.
    const queueKey = senderId === this.userId ? recipientId ?? senderId : senderId;
    const prev     = this.decryptQueue.get(queueKey) ?? Promise.resolve();
    let resolveSlot!: () => void;
    const slot = new Promise<void>(r => { resolveSlot = r; });
    this.decryptQueue.set(queueKey, slot);
    return prev.then(() => this._mergeRemoteImpl(id, senderId, recipientId, raw, roomId))
               .finally(resolveSlot);
  }

  private async _mergeRemoteImpl(
    id: string, senderId: string, recipientId: string | undefined,
    raw: any, roomId: string,
  ): Promise<StoredChatMessage | null> {

    const existing = await StorageService.getChatMessage(id);
    if (existing?.text) return existing;              // already decrypted and stored
    if (this.clearedRooms.has(roomId)) return null;   // user cleared this room

    const v = Number(raw?.v) || 1;

    // FIX 1: declare text in scope so it's available when building the row below
    let text = '';

    try {
      if (v === SIGNAL_WIRE_VERSION) {
        // v3: Signal double-ratchet
        const envelope: SignalEnvelope = {
          v:     SIGNAL_WIRE_VERSION,
          eph:   raw.eph,
          opkId: raw.opkId,
          dh:    raw.dh,
          n:     Number(raw.n)  || 0,
          pn:    Number(raw.pn) || 0,
          ct:    raw.ct,
        };
        // Our own outgoing message replayed from Gun — already stored on send, skip
        if (senderId === this.userId) return null;
        try {
          text = await this.decryptFrom(senderId, envelope);
        } catch (decryptErr) {
          // Decrypt failed — wipe the local session so the next message triggers
          // a clean X3DH instead of retrying with corrupted ratchet state forever.
          // Common causes: IK rotation (fresh install), OPK mismatch, ratchet desync.
          console.warn(`[ChatService] Decrypt failed for ${senderId.slice(0,8)}, clearing session:`, (decryptErr as Error).message);
          await this.getSession(senderId).clearSession();
          throw decryptErr; // re-throw so the tombstone path handles it below
        }
      } else {
        // v1/v2 not supported: tombstone silently so Gun never retries
        const alreadyMarked = await StorageService.getChatMessage(id);
        if (!alreadyMarked) {
          const tombstone: StoredChatMessage = {
            id, roomId, kind: 'dm', senderId, recipientId,
            text: '', timestamp: Number(raw?.timestamp) || Date.now(),
            seq: Number(raw?.seq) || 0, outgoing: false,
            syncStatus: 'corrupted' as unknown as SyncStatus, syncAttempts: 0,
          };
          void this.storeRow(tombstone).catch(() => {});
        }
        return null;
      }
    } catch (e) {
      // Session re-key: only clear session + request fresh X3DH when:
      //   1. This is a v3 message (Signal ratchet, not legacy RSA)
      //   2. The envelope has eph (it IS a fresh X3DH init we failed to process)
      //   3. OR we have no session at all and get "No session" error
      //
      // Critically: OperationError on a non-eph v3 message means Gun re-delivered
      // something the ratchet already consumed — tombstone it, do NOT wipe the session.
         // Only v3 reaches here (v1/v2 returns early without throwing)
      const hasEph      = !!raw?.eph;
      const isNoSession = e instanceof Error && e.message.includes('No session');

      // Only wipe session for a LEGITIMATE new X3DH: no existing session, or
      // envelope.dh matches our stored dhRecv (sender re-inited with same key).
      // Stale Gun re-deliveries of old X3DH inits have a dh that no longer
      // matches dhRecv -- wiping the session on those breaks the live conversation.
      let shouldReKey = isNoSession;
      if (hasEph && !isNoSession) {
        try {
          const { StorageService: SS } = await import('./storageService');
          const sk  = `signal-session:${this.userId}:${senderId}`;
          const cur = await SS.getMetadata(sk);
          if (!cur) shouldReKey = true;                   // no session at all
          else if (cur.dhRecv === raw?.dh) shouldReKey = true; // same dh: legit re-init
          // else: dh mismatch = stale re-delivery, leave shouldReKey false
        } catch { shouldReKey = true; }
      }

      if (shouldReKey) {
        try {
          const { StorageService: SS } = await import('./storageService');
          const sessionKey = `signal-session:${this.userId}:${senderId}`;
          const db = await SS.getDB();
          await db.delete('metadata', sessionKey);
          this.sessions.delete(senderId);
          this.theirBundles.delete(senderId);
          const reKeyTs = (this as any)._reKeyTs ?? {};
          (this as any)._reKeyTs = reKeyTs;
          const now = Date.now();
          if (!reKeyTs[senderId] || now - reKeyTs[senderId] > 5000) {
            reKeyTs[senderId] = now;
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'chat-start', recipientId: senderId }));
            }
          }
        } catch { }
        return null;
      }
      // All other failures: permanently undecryptable — tombstone so we never retry.
      // Never downgrade a confirmed row (FIX 2): Gun re-delivers after WS already
      // succeeded, a second decrypt fails and would overwrite the good confirmed row.
      const alreadyConfirmed = await StorageService.getChatMessage(id);
      if (alreadyConfirmed?.syncStatus === 'confirmed') return null;
      const tombstone: StoredChatMessage = {
        id, roomId, kind: 'dm', senderId, recipientId,
        text:         '',
        timestamp:    Number(raw?.timestamp) || Date.now(),
        seq:          Number(raw?.seq) || 0,
        outgoing:     false,
        syncStatus:   'corrupted' as unknown as SyncStatus,
        syncAttempts: 0,
      };
      void this.storeRow(tombstone).catch(() => {});
      return null;
    }

    const row: StoredChatMessage = {
      id, roomId, kind: 'dm', senderId,
      senderName:   typeof raw?.senderName === 'string' ? raw.senderName : undefined,
      recipientId,  text,
      timestamp:    Number(raw?.timestamp) || Date.now(),
      seq:          Number(raw?.seq) || 0,
      outgoing:     senderId === this.userId,
      syncStatus:   'confirmed',
      syncAttempts: existing?.syncAttempts ?? 0,
      readAt:       Number(raw?.readAt) || existing?.readAt,
    };
    await this.storeRow(row);
    return row;
  }

  // ── Core message handler ──────────────────────────────────────────────────

  private handleRoomRecord(roomId: string, raw: any): void {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return;
    if (seenIds(this.userId).has(raw.id)) return;
    // Mark as seen immediately — before decrypt — so Gun re-deliveries
    // don't retry a failed decrypt and corrupt the ratchet state.
    seenIds(this.userId).add(raw.id);

    void (async () => {
      const row = await this.mergeRemote(raw, roomId);
      // Skip tombstones (corrupted/undecryptable) and empty rows
      if (!row || !row.text || row.syncStatus === 'corrupted' || this.shuttingDown) return;
      this.onMessage?.(toChatMessage(row));
    })();
  }

  // ── Gun subscriptions with self-healing ───────────────────────────────────

  private subscribeToRoomMessages(roomId: string): void {
    if (this.roomUnsubscribers.has(roomId)) return;
    // Check deletion marker so re-synced Gun messages are skipped after a clear
    gunOnce<any>(GunService.getGun().get('chat-deleted').get(roomId).get(this.userId), 1000)
      .then(d => { if (d?.cleared) this.clearedRooms.add(roomId); })
      .catch(() => {});

    const gun = GunService.getGun();
    // Use the shared map so deliver() can touch this timestamp when the sender
    // writes a message — preventing the health timer from falsely reattaching
    // on rooms that are active but currently receiving no inbound Gun events.
    this.roomLastFired.set(roomId, Date.now());
    const touch = () => this.roomLastFired.set(roomId, Date.now());
    const chains: any[] = [];

    const attach = () => {
      for (const c of chains.splice(0)) { try { c?.off?.(); } catch { } }

      const handle = (raw: any, key: string) => {
        if (!key || key === '_') return;
        if (!raw) return;
        if (typeof raw === 'object' && typeof raw['#'] === 'string' && !raw.id) {
          gun.get(raw['#']).once((r: any) => {
            if (r) { touch(); this.handleRoomRecord(roomId, r); }
          });
          return;
        }
        touch();
        this.handleRoomRecord(roomId, raw);
      };

      chains.push(this.roomNode(roomId).map().on(handle));
    };

    attach();

    // Self-healing: detect eviction-killed chains and reattach with exponential backoff.
    // lastFired is now read from roomLastFired so outgoing sends (deliver → gunPut ack)
    // also reset it, preventing reattach spam on quiet-inbound but active-outbound rooms.
    let reattachCount = 0;
    const healthTimer = window.setInterval(() => {
      if (this.shuttingDown) return;
      const lastFired = this.roomLastFired.get(roomId) ?? 0;
      if (Date.now() - lastFired < GUN_CHAIN_HEALTH_MS * 2) {
        reattachCount = 0; // chain is alive — reset backoff
        return;
      }
      // Backoff: wait 1, 2, 4, 8... intervals before each reattach (max 5 min)
      const backoffIntervals = Math.min(Math.pow(2, reattachCount), 16);
      if (reattachCount > 0 && (Date.now() - lastFired) < GUN_CHAIN_HEALTH_MS * backoffIntervals) return;

      this.roomNode(roomId).once((data: any) => {
        if (!data) return; // room is empty — no reattach needed
        console.info(`[ChatService] reattaching Gun chain for room ${roomId.slice(0, 8)} (attempt ${reattachCount + 1})`);
        touch();
        reattachCount++;
        attach();
      });
    }, GUN_CHAIN_HEALTH_MS);

    this.roomHealthTimers.set(roomId, healthTimer);
    this.roomUnsubscribers.set(roomId, () => {
      clearInterval(healthTimer);
      this.roomHealthTimers.delete(roomId);
      this.roomLastFired.delete(roomId);
      for (const c of chains) { try { c?.off?.(); } catch { } }
      this.roomUnsubscribers.delete(roomId);
    });
  }

  private subscribeToTyping(roomId: string, recipientId: string): void {
    if (this.typingUnsubscribers.has(roomId)) return;
    const chain = GunService.getGun().get('chat-presence').get(roomId).get(recipientId)
      .on((s: any) => {
        if (!s || typeof s.isTyping !== 'boolean') return;
        const fresh = typeof s.timestamp === 'number' && (Date.now() - s.timestamp) < 10_000;
        this.onTyping?.({ from: recipientId, isTyping: s.isTyping && fresh });
      });
    this.typingUnsubscribers.set(roomId, () => {
      try { chain?.off?.(); } catch { }
      this.typingUnsubscribers.delete(roomId);
    });
  }

  private subscribeToReadReceipts(roomId: string, recipientId: string): void {
    // Receipts are delivered purely via WS (chat-read-receipt frames from the relay).
    // No Gun listeners needed — they were the source of timing bugs and false positives.
    // The WS handler in handleWsMessage case 'chat-read-receipt' calls onReadReceipt.
    // Nothing to subscribe to here; just ensure any old unsub is cleared.
    this.readReceiptUnsubs.get(roomId)?.();
    this.readReceiptUnsubs.set(roomId, () => {
      this.readReceiptUnsubs.delete(roomId);
    });
  }

  private async markLocalReadUpTo(roomId: string, at: number) {
    const rows = await StorageService.getChatMessagesByRoom(roomId);
    // Mark outgoing messages as read-by-recipient (for sender's double tick in IDB)
    const unread = rows.filter(r => r.outgoing && !r.readAt && r.timestamp <= at);
    if (unread.length)
      await StorageService.saveChatMessages(unread.map(r => ({ ...r, readAt: at })));
    return unread.length > 0;
  }

  // ── History ───────────────────────────────────────────────────────────────

  async getLocalHistory(recipientId: string): Promise<ChatMessage[]> {
    const roomId = this.getRoomId(this.userId, recipientId);
    const rows   = await StorageService.getChatMessagesByRoom(roomId);
    return rows
      .filter(r => r.syncStatus !== 'corrupted' && r.text)
      .sort(compareMessages)
      .map(toChatMessage);
  }

  async loadHistory(recipientId: string): Promise<ChatMessage[]> {
    const roomId = this.getRoomId(this.userId, recipientId);
    const [current, remote] = await Promise.all([
      StorageService.getChatMessagesByRoom(roomId),
      gunReadChildren<any>(this.roomNode(roomId),       { minMs: 600, maxMs: 8_000 }),
    ]);
    const byId = new Map<string, StoredChatMessage>();
    for (const row of current) byId.set(row.id, row);
    for (const { value } of remote) {
      if (!value || typeof value !== 'object') continue;
      const m = await this.mergeRemote(value, roomId);
      if (m) byId.set(m.id, m);
    }
    return [...byId.values()]
      .filter(r => r.syncStatus !== 'corrupted' && r.text)
      .sort(compareMessages)
      .map(toChatMessage);
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  async sendMessage(recipientId: string, message: string): Promise<ChatMessage> {
    const text = message.trim();
    if (!text) throw new Error('Cannot send an empty message');
    if (!this.myBundle) throw new Error('Chat is not initialized yet');

    const timestamp = Date.now();
    const row: StoredChatMessage = {
      id:           `msg-${timestamp}-${Math.random().toString(36).slice(2, 11)}`,
      roomId:       this.getRoomId(this.userId, recipientId),
      kind:         'dm',
      senderId:     this.userId,
      recipientId,  text, timestamp,
      seq:          this.nextSeq(),
      outgoing:     true,
      syncStatus:   'pending',
      syncAttempts: 0,
    };
    await this.storeRow(row);
    seenIds(this.userId).add(row.id);
    // Remove cleared marker so new messages aren't blocked after a fresh send
    this.clearedRooms.delete(row.roomId);
    GunService.getGun().get('chat-deleted').get(row.roomId).get(this.userId).put(null as any);

    void this.deliver(row).then(d => {
      this.onMessageStatus?.({ id: d.id, status: d.syncStatus, error: d.error });
    });
    return toChatMessage(row);
  }

  private async deliver(row: StoredChatMessage): Promise<StoredChatMessage> {
    const recipientId = row.recipientId;
    if (!recipientId) return row;

    const attempts = row.syncAttempts + 1;
    const expired  = Date.now() - row.timestamp > OUTBOX_TTL_MS;

    const fail = async (error: string): Promise<StoredChatMessage> => {
      const status: SyncStatus = attempts >= MAX_SEND_ATTEMPTS || expired ? 'failed' : 'pending';
      const patch = { syncStatus: status, syncAttempts: attempts, error };
      await this.patchRow(row.id, patch);
      return { ...row, ...patch };
    };

    // Encrypt with Signal protocol — but ONLY on the first attempt.
    // On retries, reuse the stored envelope so the ratchet counter (n) stays
    // the same across all delivery attempts. Re-encrypting on retry advances ns
    // in the saved session: the receiver would get n=1, n=2, … but never n=0,
    // causing skipMessageKeys to derive wrong keys → AES-GCM decrypt fails.
    let envelope: SignalEnvelope;
    if (row.encryptedEnvelope) {
      // Retry path: reuse the envelope we already encrypted (idempotent)
      try {
        envelope = JSON.parse(row.encryptedEnvelope) as SignalEnvelope;
      } catch {
        // Stored envelope is corrupt — clear it and re-encrypt (last resort)
        row = { ...row, encryptedEnvelope: undefined };
        try {
          envelope = await this.encryptFor(recipientId, row.text);
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Encryption failed');
        }
      }
    } else {
      // First attempt: encrypt and persist the envelope immediately
      try {
        envelope = await this.encryptFor(recipientId, row.text);
      } catch (e) {
        return fail(e instanceof Error ? e.message : 'Encryption failed');
      }
      // Persist the envelope so retries are idempotent
      const encryptedEnvelope = JSON.stringify(envelope);
      await this.patchRow(row.id, { encryptedEnvelope });
      row = { ...row, encryptedEnvelope };
    }

    // Flatten Signal envelope + metadata into a Gun-safe record (no nested objects)
    const record = toGunRecord({
      id:          row.id,
      v:           WIRE_VERSION,
      senderId:    row.senderId,
      recipientId,
      // Signal envelope fields (all primitives)
      eph:         envelope.eph,
      opkId:       envelope.opkId,  // OPK pool id — receiver must consumeOPK() on first message
      dh:          envelope.dh,
      n:           envelope.n,
      pn:          envelope.pn,
      ct:          envelope.ct,
      timestamp:   row.timestamp,
      seq:         row.seq,
    });

    // Push live delivery frame via WS FIRST — recipient gets this immediately.
    // The relay echoes back a 'chat-delivered' frame when it has forwarded the
    // message (or stored it for offline delivery). We wait up to 5s for that ack
    // before marking confirmed — if it doesn't arrive, we stay 'pending' so the
    // outbox retries rather than silently losing the message.
    const wsOpen = this.ws?.readyState === WebSocket.OPEN;
    const deliveredPromise = wsOpen
      ? new Promise<void>(resolve => {
          const timeout = setTimeout(() => {
            this.pendingDeliveryAcks.delete(row.id);
            resolve();  // timeout — stays pending, outbox will retry
          }, 5_000);
          this.pendingDeliveryAcks.set(row.id, () => {
            clearTimeout(timeout);
            resolve();
          });
        })
      : Promise.resolve();

    this.pushLiveFrame(recipientId, row.id, envelope, row.timestamp);

    // Fire-and-forget Gun write (persistence/fallback). Do NOT await.
    void gunPut(this.roomNode(row.roomId).get(row.id), record).then(ack => {
      if (ack.ok) {
        this.indexRoom(row.roomId, this.userId, recipientId);
        this.roomLastFired.set(row.roomId, Date.now());
      }
    });

    if (wsOpen) {
      // Wait for relay ack before confirming
      await deliveredPromise;
      // Check if the ack actually came (vs timeout)
      if (this.pendingDeliveryAcks.has(row.id)) {
        // Timeout fired — relay didn't ack. Stay pending for outbox retry.
        this.pendingDeliveryAcks.delete(row.id);
        return fail('Relay did not acknowledge delivery');
      }
      // Ack received — confirm and clear stored envelope
      const ackPatch = { syncStatus: 'confirmed' as SyncStatus, syncAttempts: attempts,
                         error: undefined, encryptedEnvelope: undefined };
      await this.patchRow(row.id, ackPatch);
      return { ...row, ...ackPatch };
    }
    // WS was closed — Gun fallback handled it, mark confirmed optimistically
    // Clear encryptedEnvelope on confirm — no longer needed for retries
    const patch = { syncStatus: 'confirmed' as SyncStatus, syncAttempts: attempts, 
                    error: undefined, encryptedEnvelope: undefined };
    await this.patchRow(row.id, patch);
    return { ...row, ...patch };
  }

  /**
   * Push a chat-message frame via the relay WS.
   * This is the fast path — recipient's handleWsMessage fires onMessage immediately.
   * Gun write above is the persistence/fallback path.
   */
  private pushLiveFrame(
    recipientId: string, messageId: string,
    envelope: SignalEnvelope, timestamp: number,
  ): void {
    const frame = JSON.stringify({
      type: 'chat-message', recipientId, messageId,
      from: this.userId,
      v:    WIRE_VERSION,
      // Signal envelope fields
      eph:   envelope.eph,
      opkId: envelope.opkId,  // OPK pool id — must be forwarded so receiver can consumeOPK()
      dh:    envelope.dh,
      n:     envelope.n,
      pn:    envelope.pn,
      ct:    envelope.ct,
      timestamp,
    });
    // Try dedicated chat WS first, then Gun's own WS as fallback
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(frame); return; } catch { }
    }
    const gunWire = getGunWire(GunService.getGun());
    if (gunWire?.readyState === WebSocket.OPEN) {
      try { gunWire.send(frame); } catch { }
    }
  }

  // ── Outbox ────────────────────────────────────────────────────────────────

  async flushOutbox(): Promise<void> {
    if (flushInFlight.has(this.userId) || !this.ready) return;
    flushInFlight.add(this.userId);
    try {
      const all  = await StorageService.getAllChatMessages();
      const now  = Date.now();
      const pending = all.filter(r =>
        r.kind === 'dm' && r.outgoing && r.senderId === this.userId
        && r.syncStatus !== 'confirmed'
        && r.syncAttempts < MAX_SEND_ATTEMPTS
        && now - r.timestamp < OUTBOX_TTL_MS);
      for (const row of pending) {
        const result = await this.deliver(row);
        this.onMessageStatus?.({ id: result.id, status: result.syncStatus, error: result.error });
      }
    } catch (e) { console.warn('[ChatService] outbox flush failed:', e); }
    finally { flushInFlight.delete(this.userId); }
  }

  private startOutboxLoop(): void {
    if (this.flushTimer !== null || typeof window === 'undefined') return;
    const tick = () => {
      if (this.shuttingDown) return;
      void this.flushOutbox()
        .then(() => {
          this.flushCount++;
          if (this.flushCount % PRUNE_EVERY_N_FLUSHES === 0)
            return StorageService.pruneChatMessages().then(() => undefined);
        })
        .catch(() => {})
        .finally(() => {
          if (!this.shuttingDown)
            this.flushTimer = window.setTimeout(tick, FLUSH_INTERVAL_MS);
        });
    };
    this.flushTimer = window.setTimeout(tick, 5_000);
    this.onlineHandler = () => { void this.flushOutbox(); };
    window.addEventListener('online', this.onlineHandler);
  }

  // ── Connection state ──────────────────────────────────────────────────────

  private computeConnected(): boolean {
    if (!this.ready) return false;
    if (this.ws?.readyState === WebSocket.OPEN) return true;
    const wire = getGunWire(GunService.getGun());
    if (wire?.readyState === WebSocket.OPEN) return true;
    try { return GunService.getPeerStats().isConnected; } catch { return false; }
  }

  private refreshConnected(): void {
    const next = this.computeConnected();
    if (next === this.connected) return;
    this.connected = next;
    this.onConnectionChange?.(next);
    if (next) void this.flushOutbox();
  }

  private startConnectionTracking(): void {
    if (typeof window === 'undefined') return;
    this.refreshConnected();
    if (!this.connectionPoll)
      this.connectionPoll = window.setInterval(() => this.refreshConnected(), CONNECTION_POLL_MS);
    if (!this.offGunReconnect) {
      this.offGunReconnect = GunService.onReconnect(() => {
        if (this.shuttingDown) return;
        this.reattachRooms();
        this.refreshConnected();
        void this.flushOutbox();
        setTimeout(() => this.registerPresenceOnRelay(), 500);
      });
    }
    setTimeout(() => this.registerPresenceOnRelay(), 1_000);
  }

  private reattachRooms(): void {
    const rooms = [...this.watchedRooms.entries()];
    for (const [roomId] of rooms) {
      this.roomUnsubscribers.get(roomId)?.();
      this.typingUnsubscribers.get(roomId)?.();
      this.readReceiptUnsubs.get(roomId)?.();
    }
    for (const [roomId, recipientId] of rooms) {
      this.subscribeToRoomMessages(roomId);
      this.subscribeToTyping(roomId, recipientId);
      this.subscribeToReadReceipts(roomId, recipientId);
    }
  }

  // ── Presence ──────────────────────────────────────────────────────────────

  private writePresence(online: boolean): void {
    const ts = Date.now();
    try {
      GunService.getGun().get('chat-presence').get(this.userId)
        .put({ online, ts, peerId: this.peerId });
    } catch { }
    if (online) this.registerPresenceOnRelay();
  }

  // ── Bundle publish ────────────────────────────────────────────────────────
  // Called from the 'registered' WS handler so the relay's liveClient
  // ownership check finds our active session.  Using sessionStorage to avoid
  // re-posting the exact same bundle bytes on every reconnect (hot-reload,
  // tab focus, etc.) — clears when the tab closes so a fresh session always
  // publishes at least once.
  private async publishBundleToRelay(): Promise<void> {
    if (!this.myBundle) return;
    const bundleStr = JSON.stringify(this.myBundle.bundle);
    const pubKey    = 'bundle-pub:' + this.userId;
    try {
      if (sessionStorage.getItem(pubKey) === bundleStr) return;
    } catch { /* private-browsing may block sessionStorage */ }

    for (const delay of [0, 3_000, 10_000, 30_000]) {
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (this.shuttingDown) return;
      try {
        const res = await fetch(`${chatRelayBase()}/api/signal-bundle`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userId: this.userId, ...this.myBundle!.bundle }),
        });
        if (res.ok) {
          try { sessionStorage.setItem(pubKey, bundleStr); } catch { }
          return;
        }
        // Retry on 429 (rate-limited) or 503 (relay hasn't seen our WS session yet).
        // Any other status (400 missing spkSig, 403 auth mismatch, 500 DB) is a
        // hard failure — log and stop retrying.
        if (res.status !== 429 && res.status !== 503) {
          console.warn(`[ChatService] Bundle publish failed (${res.status}) — not retrying`);
          return;
        }
        // 429: fall through to next delay
      } catch { /* network error — retry */ }
    }
    console.warn('[ChatService] Bundle publish failed after all retries');
  }

  // ── Visibility tracking ───────────────────────────────────────────────────
  // On mobile browsers (and Capacitor) the document can be hidden even while
  // the chat view is in the foreground (app backgrounded briefly).  When it
  // comes back to the foreground we must re-send any pending read receipts so
  // the sender's double-tick updates without needing a new incoming message.

  private startVisibilityTracking(): void {
    if (typeof document === 'undefined' || this._visibilityHandler) return;
    this._visibilityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      // Re-send markAsRead only for rooms that actually have unread messages.
      // Sending unconditionally causes spurious double-ticks on the other side
      // even when they haven't received anything yet.
      for (const [roomId, recipientId] of this.watchedRooms.entries()) {
        void this.hasUnreadMessages(roomId).then(has => {
          if (has) this.markAsRead(recipientId);
        });
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  private stopVisibilityTracking(): void {
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  private startPresence(): void {
    if (this.presenceTimer !== null || typeof window === 'undefined') return;
    this.writePresence(true);
    this.presenceTimer = window.setInterval(() => {
      if (!document.hidden) this.writePresence(true);
    }, PRESENCE_HB_MS);

    let visTimer: number | null = null;
    this.presenceVisibilityHandler = () => {
      if (document.hidden) {
        if (this._offlineSuppressed) return;
        visTimer = window.setTimeout(() => {
          visTimer = null;
          if (!this._offlineSuppressed) this.writePresence(false);
        }, 2_000);
      } else {
        if (visTimer !== null) { clearTimeout(visTimer); visTimer = null; }
        this.writePresence(true);
      }
    };
    this.presenceOfflineHandler = () => {
      if (visTimer !== null) { clearTimeout(visTimer); visTimer = null; }
      this.writePresence(false);
    };
    window.addEventListener('visibilitychange', this.presenceVisibilityHandler);
    window.addEventListener('beforeunload',     this.presenceOfflineHandler);
    window.addEventListener('pagehide',         this.presenceOfflineHandler);
  }

  private stopPresence(): void {
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null; }
    if (this.presenceVisibilityHandler) {
      window.removeEventListener('visibilitychange', this.presenceVisibilityHandler);
      this.presenceVisibilityHandler = null;
    }
    if (this.presenceOfflineHandler) {
      window.removeEventListener('beforeunload', this.presenceOfflineHandler);
      window.removeEventListener('pagehide',     this.presenceOfflineHandler);
      this.presenceOfflineHandler = null;
    }
    this.writePresence(false);
    for (const off of this.presenceSubs.values()) try { off(); } catch { }
    this.presenceSubs.clear();
  }

  watchPeerPresence(peerId: string): void {
    if (this.presenceSubs.has(peerId)) return;
    let lastOnline: boolean | null = null;
    let lastTs           = 0;
    let _offlineDebounce = 0;

    const emit = (online: boolean, ts: number) => {
      lastTs = Math.max(lastTs, ts);
      const effective = online && (Date.now() - lastTs) < PRESENCE_STALE_MS;
      if (effective !== lastOnline) {
        if (!effective && lastOnline) {
          // Debounce going offline 8s to ignore brief network blips
          if (!_offlineDebounce) {
            _offlineDebounce = window.setTimeout(() => {
              _offlineDebounce = null; lastOnline = false;
              this.onPeerPresence?.({ userId: peerId, online: false, ts: lastTs });
            }, 8_000);
          }
        } else {
          if (_offlineDebounce) { clearTimeout(_offlineDebounce); _offlineDebounce = null; }
          lastOnline = effective;
          this.onPeerPresence?.({ userId: peerId, online: effective, ts: lastTs });
        }
      }
    };

    // Layer 1: Gun .on()
    const presNode = GunService.getGun().get('chat-presence').get(peerId);
    const chain = presNode.on((s: any) => {
      if (!s || typeof s.ts !== 'number') { emit(false, 0); return; }
      emit(!!s.online, s.ts);
    });

    // Layer 2: immediate once read
    void gunOnce<any>(presNode, 1_500).then(s => {
      if (s && typeof s.ts === 'number') emit(!!s.online, s.ts);
    }).catch(() => {});

    // Layer 3: relay ping poll — authoritative, beats Gun eviction
    const pingPoll = window.setInterval(async () => {
      if (!this.presenceSubs.has(peerId)) return;
      try {
        const online = await this.relayPing(peerId);
        if (online !== lastOnline) emit(online, Date.now());
      } catch { }
    }, PRESENCE_POLL_MS);

    // Layer 4: stale check
    const staleCheck = window.setInterval(() => {
      if (!this.presenceSubs.has(peerId)) return;
      if (lastTs > 0 && lastOnline && (Date.now() - lastTs) >= PRESENCE_STALE_MS)
        emit(false, lastTs);
    }, 10_000);

    this.presenceSubs.set(peerId, () => {
      clearInterval(pingPoll); clearInterval(staleCheck);
      try { chain?.off?.(); } catch { }
      this.presenceSubs.delete(peerId);
    });
  }

  unwatchPeerPresence(peerId: string) { this.presenceSubs.get(peerId)?.(); }

  private relayPing(peerId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const wire = getGunWire(GunService.getGun());
      if (!wire || wire.readyState !== WebSocket.OPEN) { reject(new Error('no wire')); return; }
      const id    = `pp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        wire.removeEventListener('message', handler);
        reject(new Error('timeout'));
      }, PRESENCE_PING_MS);
      const handler = (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          if (d?.type === 'pong-peer' && d.id === id) {
            clearTimeout(timer);
            wire.removeEventListener('message', handler);
            resolve(d.online === true);
          }
        } catch { }
      };
      wire.addEventListener('message', handler);
      wire.send(JSON.stringify({ type: 'ping-peer', peerId, id }));
    });
  }

  async isPeerOnline(peerId: string, opts: { skipRelayPing?: boolean } = {}): Promise<boolean> {
    try {
      const s = await gunOnce<any>(GunService.getGun().get('chat-presence').get(peerId), 1_500);
      if (s?.online && typeof s.ts === 'number' && (Date.now() - s.ts) < PRESENCE_STALE_MS) {
        if (opts.skipRelayPing) return true;
      }
    } catch { }
    try { return await this.relayPing(peerId); } catch { return false; }
  }

  registerPresenceOnRelay(): void {
    const frame = JSON.stringify({ type: 'register-presence', userId: this.userId });
    const wire = getGunWire(GunService.getGun());
    if (wire?.readyState === WebSocket.OPEN) { try { wire.send(frame); } catch { } }
    if (this.ws?.readyState === WebSocket.OPEN) { try { this.ws.send(frame); } catch { } }
  }

  // ── Dedicated relay WebSocket ─────────────────────────────────────────────

  private connect(): void {
    if (!this.wsUrl || this.shuttingDown) return;
    try { this.ws = new WebSocket(this.wsUrl); } catch { return; }
    this.wsRegistered = false; // reset — must wait for 'registered' ack again

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: 'register', peerId: this.peerId, userId: this.userId }));
      this.registerPresenceOnRelay();
      this.refreshConnected();
    };

    this.ws.onmessage = async (e) => {
      try { await this.handleWsMessage(JSON.parse(e.data)); } catch { }
    };

    this.ws.onerror = () => {};

    this.ws.onclose = () => {
      this.wsRegistered = false;
      // Re-queue all watched recipients as pending reads so the next 'registered'
      // ack (or the onConnectionChange flush) will re-send receipts that may have
      // been in-flight when the socket dropped.
      for (const recipientId of this.watchedRooms.values()) {
        this.pendingReadRecipients.add(recipientId);
      }
      this.refreshConnected();
      if (!this.shuttingDown)
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2_000);
    };
  }

  /**
   * Handle incoming WS frames.
   * 'chat-message' is the PRIMARY real-time delivery path (fast, no Gun latency).
   */
  private async handleWsMessage(data: any): Promise<void> {
    switch (data?.type) {
      case 'registered': {
        // Relay confirmed our register frame is fully processed — safe to send chat-read now
        this.wsRegistered = true;

        // Publish our Signal bundle to the relay's MySQL now that our WS session
        // is confirmed live. The liveClient ownership check in routes.js looks up
        // clients.get(peerId) — that entry exists from the moment 'register' was
        // processed, so this POST will pass. We intentionally didn't publish in
        // init() because the WS wasn't open yet and the check would reject us.
        void this.publishBundleToRelay();

        // Ensure we have a healthy OPK pool on the relay.
        // Also runs after any new X3DH session (relay consumed one OPK).
        void this.ensureOPKPool();

        // Immediately flush the outbox — any messages that failed to send because
        // the bundle wasn't published yet (the common case on first load) will be
        // retried right now rather than waiting up to FLUSH_INTERVAL_MS.
        void this.flushOutbox();

        // Flush explicitly pending reads first
        for (const recipientId of this.pendingReadRecipients) {
          this.pendingReadRecipients.delete(recipientId);
          this._doMarkAsRead(recipientId);
        }
        // Re-send for watched rooms that have actual unread messages — handles the case
        // where a 'chat-message' triggered markAsRead just before 'registered' arrived,
        // wsRegistered was false so it was queued, then the fallback timer drained it.
        // Only send if there are genuinely unread messages to avoid spurious double-ticks.
        for (const [roomId, recipientId] of this.watchedRooms.entries()) {
          if (!this.pendingReadRecipients.has(recipientId)) {
            void this.hasUnreadMessages(roomId).then(has => {
              if (has) this._doMarkAsRead(recipientId);
            });
          }
        }
        break;
      }

      case 'error':
        if (data.code === 'AUTH_REQUIRED')
          console.info('[ChatService] Relay WS auth required — Gun fallback active');
        break;

      case 'chat-message': {
        const messageId = typeof data.messageId === 'string' ? data.messageId : null;
        if (!messageId || seenIds(this.userId).has(messageId)) return;
        seenIds(this.userId).add(messageId);

        const v       = Number(data.v) || 1;
        const roomId  = this.getRoomId(this.userId, data.from);

        let raw: any;
        if (v === SIGNAL_WIRE_VERSION) {
          // v3: reconstruct the envelope shape mergeRemote expects
          raw = {
            id:          messageId,
            v,
            senderId:    data.from,
            recipientId: this.userId,
            eph:         data.eph,
            opkId:       data.opkId,   // needed for OPK consumption in decrypt()
            dh:          data.dh,
            n:           data.n,
            pn:          data.pn,
            ct:          data.ct,
            timestamp:   data.timestamp,
          };
        } else {
          // v1/v2 not supported: pass minimal raw so mergeRemote tombstones it
          raw = { id: messageId, v, senderId: data.from, recipientId: this.userId, timestamp: data.timestamp };
        }

        try {
          const row = await this.mergeRemote(raw, roomId);
          if (row && row.text && row.syncStatus !== 'corrupted') this.onMessage?.(toChatMessage(row));
        } catch (e) {
          // mergeRemote threw (decrypt failed). clearSession() already ran inside mergeRemote.
          // Ask the relay to re-send this message after a short delay — by then the session
          // is cleared and fresh X3DH will run on the next attempt, recovering without
          // requiring the user to manually refresh.
          const failedId = messageId;
          const failedFrom = data.from;
          console.warn('[ChatService] Decrypt failed for WS message', failedId, '— scheduling resend request');
          setTimeout(() => {
            if (this.ws?.readyState === WebSocket.OPEN && failedId && failedFrom) {
              this.ws.send(JSON.stringify({ type: 'chat-resend-request', messageId: failedId, from: failedFrom }));
            }
          }, 2_000);
        }
        break;
      }

      case 'chat-typing':
        this.onTyping?.({ from: data.from, isTyping: !!data.isTyping });
        break;

      case 'rtc-signal':
        if (data.from && data.payload) this.onRtcSignal?.({ from: data.from, payload: data.payload });
        break;

      case 'chat-delivered': {
        const ackFn = this.pendingDeliveryAcks.get(data.messageId);
        if (ackFn) {
          this.pendingDeliveryAcks.delete(data.messageId);
          ackFn(); // resolves the deliveredPromise in deliver()
        }
        this.onDelivered?.({ messageId: data.messageId, recipientId: data.recipientId });
        break;
      }

      case 'chat-read-receipt': {
        // Use Number.MAX_SAFE_INTEGER as the fallback so a missing or zero `at`
        // marks ALL outgoing messages as read rather than only those with
        // timestamp ≤ Date.now(). This avoids clock-skew issues where the
        // sender's messages have timestamps slightly ahead of the receiver's
        // clock and would otherwise remain stuck on a single tick.
        const at = (Number(data.at) > 0) ? Number(data.at) : Number.MAX_SAFE_INTEGER;
        const rrRoomId = this.getRoomId(this.userId, data.from);
        void this.markLocalReadUpTo(rrRoomId, at);
        this.onReadReceipt?.({ from: data.from, at });
        break;
      }

      case 'chat-start': {
        // Recipient's session failed — clear our session so next message
        // triggers fresh X3DH re-initiation automatically.
        const reKeyTarget = data.from || data.recipientId;
        if (reKeyTarget) {
          try {
            const { StorageService: SS } = await import('./storageService');
            const sessionKey = `signal-session:${this.userId}:${reKeyTarget}`;
            const db = await SS.getDB();
            await db.delete('metadata', sessionKey);
            this.sessions.delete(reKeyTarget);
            this.theirBundles.delete(reKeyTarget);
          } catch { }
        }
        break;
      }

      case 'chat-invite': {
        // Recipient's session failed — clear ours so next send triggers fresh X3DH.
        const inviteFrom = data.from;
        if (inviteFrom) {
          try {
            const { StorageService: SS } = await import('./storageService');
            const sessionKey = `signal-session:${this.userId}:${inviteFrom}`;
            const db = await SS.getDB();
            await db.delete('metadata', sessionKey);
            this.sessions.delete(inviteFrom);
            this.theirBundles.delete(inviteFrom);
            // Flush outbox so pending messages re-encrypt with fresh X3DH
            void this.flushOutbox();
          } catch { }
        }
        break;
      }

      case 'pong-peer': break;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async startChat(recipient: RecipientInfo): Promise<void> {
    const roomId = this.getRoomId(this.userId, recipient.userId);
    this.watchedRooms.set(roomId, recipient.userId);

    // Seed seenIds from IDB BEFORE subscribing to Gun so that Gun's .map().on()
    // re-deliveries of messages already in IDB are deduplicated on the first
    // callback, not just after the second one hits the Set.  Without this, a
    // page refresh empties the module-level seenIds map; the WS offline-replay
    // arrives first (correct), seenIds is seeded, but Gun fires for the same
    // node milliseconds later and slips past the check, producing a duplicate
    // row in the message list.
    try {
      const existingRows = await StorageService.getChatMessagesByRoom(roomId);
      const seen = seenIds(this.userId);
      for (const r of existingRows) if (r.id) seen.add(r.id);
    } catch { /* best-effort — Gun subscription still happens */ }

    this.subscribeToRoomMessages(roomId);
    this.subscribeToTyping(roomId, recipient.userId);
    this.subscribeToReadReceipts(roomId, recipient.userId);
    this.watchPeerPresence(recipient.userId);

    // Pre-fetch their Signal bundle so first send is instant
    void this.getTheirBundle(recipient.userId);

    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'chat-start', recipientId: recipient.userId }));
  }

  static readonly MAX_INLINE_FILE_BYTES = 400 * 1024;       // 400 KB — inline base64
  static readonly MAX_FILE_BYTES        = 100 * 1024 * 1024; // 100 MB — relay upload

  async sendFile(recipientId: string, file: File): Promise<ChatMessage> {
    if (file.size > ChatService.MAX_FILE_BYTES)
      throw new Error('File too large (max 100 MB).');

    const mime = file.type || 'application/octet-stream';

    if (file.size <= ChatService.MAX_INLINE_FILE_BYTES) {
      // Small file: encode inline as base64 and send encrypted through Signal.
      // IMPORTANT: chunk size must be divisible by 3 so each chunk encodes to
      // valid non-padded base64 and concatenation produces a correct result.
      // 8192 % 3 == 2 (broken) → use 8190 (8190 % 3 == 0).
      const arr = new Uint8Array(await file.arrayBuffer());
      // Chunk size divisible by 3 → no mid-stream padding issues.
      // Apply is used instead of spread to avoid call-stack overflow on large arrays.
      const CHUNK = 8190;
      let b64 = '';
      for (let i = 0; i < arr.length; i += CHUNK)
        b64 += btoa(String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK) as any));
      return this.sendMessage(recipientId,
        JSON.stringify({ _file: true, name: file.name, mime, size: file.size, data: b64 }));
    }

    // Large file: upload to relay, send URL as the encrypted message payload.
    // The file bytes themselves never pass through Signal encryption.
    const senderPub = this.userId;
    const formData  = new FormData();
    formData.append('file', file, file.name);
    formData.append('mimeType', mime);

    const uploadController = new AbortController();
    const uploadTimeout = setTimeout(() => uploadController.abort(), 2 * 60 * 1000);
    let uploadRes: Response;
    try {
      uploadRes = await fetch(`${chatRelayBase()}/api/chat-media`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${senderPub}` },
        body:    formData,
        signal:  uploadController.signal,
      });
    } catch (e: any) {
      clearTimeout(uploadTimeout);
      throw new Error(e?.name === 'AbortError' ? 'Upload timed out (> 2 min)' : 'Upload failed — check connection');
    }
    clearTimeout(uploadTimeout);
    if (!uploadRes.ok) {
      const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `Upload failed (${uploadRes.status})`);
    }
    const { mediaId } = await uploadRes.json();
    const url = `${chatRelayBase()}/api/chat-media/${mediaId}`;

    return this.sendMessage(recipientId,
      JSON.stringify({ _file: true, _url: true, name: file.name, mime, size: file.size, url }));
  }

  sendTyping(recipientId: string, isTyping: boolean): void {
    const roomId = this.getRoomId(this.userId, recipientId);
    void gunPut(GunService.getGun().get('chat-presence').get(roomId).get(this.userId), {
      from: this.userId, to: recipientId, isTyping, timestamp: Date.now(),
    });
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'chat-typing', recipientId, isTyping }));
  }

  sendRtcSignal(toUserId: string, payload: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ type: 'rtc-signal', to: toUserId, payload }));
  }


  // Returns true if the room has any received (incoming) messages not yet read.
  // Used to guard markAsRead calls so we never send chat-read when there's nothing to ack.
  private async hasUnreadMessages(roomId: string): Promise<boolean> {
    try {
      const rows = await StorageService.getChatMessagesByRoom(roomId);
      return rows.some(r => !r.outgoing && !r.readAt);
    } catch { return false; }
  }

  private _markReadDebounce      = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingDeliveryAcks    = new Map<string, () => void>(); // messageId → resolve fn

  markAsRead(recipientId: string): void {
    // Debounce rapid calls (e.g. onConnectionChange + initializeChat firing together)
    const existing = this._markReadDebounce.get(recipientId);
    if (existing) clearTimeout(existing);
    this._markReadDebounce.set(recipientId, setTimeout(() => {
      this._markReadDebounce.delete(recipientId);
      this._doMarkAsRead(recipientId);
    }, 80));
  }

  private _doMarkAsRead(recipientId: string): void {
    // If WS is already open (state=1) we're registered — send immediately.
    // Only queue if WS is still connecting (state=0).
    if (!this.wsRegistered && this.ws?.readyState !== WebSocket.OPEN) {
      this.pendingReadRecipients.add(recipientId);
      // Fallback: old relay may never send 'registered' ack.
      // IMPORTANT: do NOT set wsRegistered=true here — only the 'registered' ack
      // from the relay should flip that flag. Setting it here before the WS is open
      // causes _doMarkAsRead to run while the socket is still CONNECTING, sendFrame()
      // returns false, and the receipt is silently dropped with no further retry.
      setTimeout(() => {
        if (!this.pendingReadRecipients.has(recipientId)) return; // already handled by 'registered' ack
        this.pendingReadRecipients.delete(recipientId);
        if (this.ws?.readyState === WebSocket.OPEN) {
          // WS is open now — safe to send. Mark registered so the gate passes.
          this.wsRegistered = true;
          this._doMarkAsRead(recipientId);
        } else {
          // WS still not open — re-queue so onConnectionChange flushes it when ready.
          // Do NOT set wsRegistered; let the real 'registered' ack do that.
          this.pendingReadRecipients.add(recipientId);
        }
      }, 3000);
      return;
    }

    const roomId = this.getRoomId(this.userId, recipientId);
    const at     = Date.now();

    // Pure WS path — mirrors pushLiveFrame exactly.
    // No Gun involved: Gun read-receipt paths were unreliable and caused
    // the single-tick-stuck bug. WS is the only delivery mechanism.
    const sendFrame = () => {
      const frame = JSON.stringify({ type: 'chat-read', recipientId, at });
      if (this.ws?.readyState === WebSocket.OPEN) {
        try { this.ws.send(frame); return true; } catch {}
      }
      // Fallback: Gun's own WS connection (same relay, different socket)
      const gunWire = getGunWire(GunService.getGun());
      if (gunWire?.readyState === WebSocket.OPEN) {
        try { gunWire.send(frame); return true; } catch {}
      }
      return false;
    };

    if (!sendFrame()) {
      // WS not open — retry every 200ms up to 10 times (2s window).
      // After that, queue into pendingReadRecipients so the next 'registered' ack
      // or onConnectionChange flush picks it up rather than dropping it silently.
      let attempts = 0;
      const retry = setInterval(() => {
        if (this.shuttingDown) { clearInterval(retry); return; }
        if (sendFrame()) { clearInterval(retry); return; }
        if (++attempts >= 10) {
          clearInterval(retry);
          // Still not sent — park it so the next reconnect flushes it
          this.wsRegistered = false;
          this.pendingReadRecipients.add(recipientId);
        }
      }, 200);
    }

    // Patch local IDB so receiver's own history shows messages as read
    void (async () => {
      const rows = await StorageService.getChatMessagesByRoom(roomId);
      const unread = rows.filter(r => !r.outgoing && !r.readAt);
      if (unread.length)
        await StorageService.saveChatMessages(unread.map(r => ({ ...r, readAt: at })));
    })();
  }

  isConnected() { return this.connected; }
  isReady()     { return this.ready; }

  /**
   * Return this user's identity signing pub key and the cached bundle for a
   * peer. Used by ChatView to compute safety numbers for display.
   */
  getIdentityKeys(): { myIKSignPub: string } | null {
    if (!this.myBundle) return null;
    return { myIKSignPub: this.myBundle.bundle.ikSignPub };
  }

  async getTheirIKSignPub(peerId: string): Promise<string | null> {
    const bundle = await this.getTheirBundle(peerId);
    return bundle?.ikSignPub ?? null;
  }

  // ── OPK pool management ───────────────────────────────────────────────────
  // Called after init() to ensure the relay has a fresh batch of OPKs.
  // Also called periodically and after each new X3DH session is established
  // (the relay consumes one OPK per session; we replenish when running low).

  private async ensureOPKPool(): Promise<void> {
    if (!this.myBundle) return;
    const size = await getOPKPoolSize(this.userId);
    if (size > OPK_POOL_LOW_WATER) return; // pool is healthy
    // Generate enough to bring us back to OPK_POOL_SIZE
    const needed = OPK_POOL_SIZE - size;
    const pool   = await generateOPKBatch(needed, this.userId);
    await this.publishOPKBatch(pool.slice(0, needed));
  }

  private async publishOPKBatch(entries: OPKEntry[]): Promise<void> {
    if (!entries.length) return;
    try {
      const res = await fetch(`${chatRelayBase()}/api/opk-pool`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          userId: this.userId,
          opks:   entries.map(e => ({ id: e.id, pub: e.pubB64 })),
        }),
      });
      if (!res.ok) console.warn('[ChatService] OPK pool publish failed:', res.status);
    } catch (e) { console.warn('[ChatService] OPK pool publish error:', e); }
  }

  disconnect(): void {
    this.shuttingDown = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer);  this.reconnectTimer = null; }
    if (this.connectionPoll) { clearInterval(this.connectionPoll); this.connectionPoll = null; }
    if (this.flushTimer)     { clearTimeout(this.flushTimer);      this.flushTimer = null; }
    if (this.onlineHandler)  { window.removeEventListener('online', this.onlineHandler); this.onlineHandler = null; }
    this.offGunReconnect?.(); this.offGunReconnect = null;
    if (this.ws) { try { this.ws.close(); } catch { } this.ws = null; }
    this.stopPresence();
    this.stopVisibilityTracking();
    for (const u of this.roomUnsubscribers.values())   u();
    for (const u of this.typingUnsubscribers.values()) u();
    for (const u of this.readReceiptUnsubs.values())   u();
    this.roomUnsubscribers.clear();
    this.typingUnsubscribers.clear();
    this.readReceiptUnsubs.clear();
    this.watchedRooms.clear();
    this.ready = false;
    if (this.connected) { this.connected = false; this.onConnectionChange?.(false); }
  }
}

export default ChatService;