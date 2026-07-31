//services/websocketService.ts
import config from '../config';
import DiscoveryService from './discoveryService';
import { PeerReputationService } from './peerReputationService';

/** Message types that may require proof-of-work on the relay server.
 *  Must stay in sync with POW_REQUIRED_TYPES in src/services/powService.ts. */
const POW_CONTENT_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);

export interface KnownServer {
  websocket: string;
  gun: string;
  api: string;
  addedBy: string;
  firstSeen: number;
  source: 'local' | 'peer' | 'gun';
  signatureValid: boolean;
  lastVerifiedAt?: number;
  expiresAt?: number;
}

export class WebSocketService {
  private static ws: WebSocket | null = null;
  private static peerId: string = WebSocketService.createPeerId();
  private static callbacks: Map<string, Set<(data: any) => void>> = new Map();
  private static isConnected = false;
  private static reconnectAttempts = 0;
  private static maxReconnectAttempts = Infinity;
  private static baseReconnectDelay = 1000;
  private static maxReconnectDelay = 30000;
  private static messageQueue: any[] = [];
  private static readonly MAX_QUEUE_SIZE = 200;

  private static enqueue(message: any) {
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
      const dropped = this.messageQueue.shift();
      console.warn('[WS] Queue full, dropping oldest message:', dropped?.type);
    }
    this.messageQueue.push(message);
  }
  private static peers: Set<string> = new Set();
  private static peerAddresses: Map<string, { peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }> = new Map();
  private static readonly MAX_PEER_ADDRESSES = 200;
  // True when the relay rejected our `register` for lack of an authenticated
  // session. In that state we hold an open socket but are NOT in the relay's
  // client registry, so we never receive `peer-list` and can never see peers —
  // the UI needs to know this to explain the perpetual "0 peers".
  private static registrationRejected = false;
  private static statusListeners: Set<(status: { connected: boolean; peerCount: number; registrationRejected: boolean }) => void> = new Set();
  private static knownServers: Map<string, KnownServer> = new Map();
  private static readonly MAX_KNOWN_SERVERS = 50;
  private static readonly DISCOVERY_TTL_MS = 5 * 60_000;
  private static keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private static reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static lastConnectUrl: string | null = null;
  private static connectionEpoch = 0;
  private static syncRequestCallback: (() => void) | null = null;
  private static chatRoomListeners: Map<string, Set<(data: any) => void>> = new Map();

  private static createPeerId(): string {
    return `peer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Register a callback that fires on every (re)connect to request incremental sync.
   */
  static onConnectSyncRequest(callback: () => void) {
    this.syncRequestCallback = callback;
  }

  static initialize() {
    this.loadKnownServers();
    void this.bootstrapDiscovery();
    this.connect();
  }

  static connect(wsUrl?: string) {
    const url = wsUrl || this.lastConnectUrl || config.relay.websocket;

    // If a connection attempt is already in progress (CONNECTING), don't close
    // it — closing a CONNECTING socket fires onclose which triggers another
    // reconnect, creating an infinite spam loop.
    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) {
        // Already trying to connect to the same URL — just wait
        if (url === this.lastConnectUrl) return;
      }
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const epoch = ++this.connectionEpoch;
    this.lastConnectUrl = url;

    try {
      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = async () => {
        if (epoch !== this.connectionEpoch || socket !== this.ws) return;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        // Optimistically assume registration will succeed; the relay tells us
        // otherwise via an AUTH_REQUIRED error handled in onmessage.
        this.registrationRejected = false;

        this.peers.add(this.peerId);
        this.notifyStatus();
        this.startKeepAlive();

        this.sendToRelay('register', { peerId: this.peerId });
        this.sendToRelay('join-room', { roomId: 'default' });

        // Drain queued messages: send non-PoW immediately, then PoW messages
        const pending = this.messageQueue.splice(0, this.messageQueue.length);
        const powMessages: any[] = [];
        for (const msg of pending) {
          if (msg.type === 'chatroom-message') {
            this.broadcastChatRoomMessage(msg.roomId, msg.data);
          } else if (POW_CONTENT_TYPES.has(msg.type)) {
            powMessages.push(msg);
          } else {
            this.broadcast(msg.type, msg.data);
          }
        }
        for (const msg of powMessages) {
          await this.broadcast(msg.type, msg.data);
        }

        this.broadcastAddresses();
        this.broadcastServerList();
        void this.publishDiscoveryAnnouncement();
        void this.mergeDiscoveryServers();

        if (this.syncRequestCallback) {
          this.syncRequestCallback();
        } else {
          setTimeout(() => {
            this.broadcast('request-sync', { peerId: this.peerId });
          }, 1000);
        }
      };

      socket.onmessage = (event) => {
        if (epoch !== this.connectionEpoch || socket !== this.ws) return;
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'welcome' || message.type === 'pong') {
            return;
          }

          if (message.type === 'error' && message.code === 'PEER_ID_TAKEN') {
            this.peerId = this.createPeerId();
            this.sendToRelay('register', { peerId: this.peerId });
            this.sendToRelay('join-room', { roomId: 'default' });
            this.broadcastAddresses();
            return;
          }

          // The relay gates registration (and therefore peer-list, broadcast and
          // room membership) behind an authenticated session. Without one we stay
          // connected but invisible to the peer registry — surface it once so the
          // UI can explain "0 peers" instead of silently misreporting the network.
          if (message.type === 'error' && message.code === 'AUTH_REQUIRED') {
            if (!this.registrationRejected) {
              console.warn('[WS] Relay registration requires an authenticated session — sign in to join the peer network. Gun-layer sync is unaffected.');
            }
            this.registrationRejected = true;
            this.notifyStatus();
            return;
          }

          if (message.type === 'peer-list') {
            if (Array.isArray(message.peers)) {
              this.peers = new Set(message.peers.filter(Boolean));
              this.notifyStatus();
            }
            return;
          }

          if (message.type === 'peer-left') {
            if (message.peerId) {
              this.peers.delete(message.peerId);
              this.peerAddresses.delete(message.peerId);
              this.notifyStatus();
            }
            return;
          }

          if (message.type === 'chatroom-message') {
            const listeners = this.chatRoomListeners.get(message.roomId);
            if (listeners) {
              listeners.forEach((cb) => {
                try { cb(message.data); } catch { /* ignore listener errors */ }
              });
            }
            return;
          }

          if (message.type === 'server-list') {
            void this.handleIncomingServerList(message);
            return;
          }

          if (message.type === 'peer-addresses') {
            const data = message.data;
            if (data?.peerId && data.peerId !== this.peerId) {
              if (this.peerAddresses.has(data.peerId)) {
                this.peerAddresses.delete(data.peerId);
              } else if (this.peerAddresses.size >= this.MAX_PEER_ADDRESSES) {
                const oldestKey = this.peerAddresses.keys().next().value;
                if (oldestKey) this.peerAddresses.delete(oldestKey);
              }
              this.peerAddresses.set(data.peerId, {
                peerId: data.peerId,
                relayUrl: data.relayUrl || '',
                gunPeers: data.gunPeers || [],
                joinedAt: data.joinedAt || Date.now(),
              });
              this.notifyStatus();
            }
          }

          const callbacks = this.callbacks.get(message.type);
          if (callbacks) {
            callbacks.forEach((callback) => {
              try {
                callback(message.data ?? message);
              } catch {
                // Ignore listener errors
              }
            });
          }
        } catch (_error) {
          // Malformed message — ignore
        }
      };

      socket.onerror = (_event) => {
        if (epoch !== this.connectionEpoch || socket !== this.ws) return;
        // Errors are followed by onclose, which handles reconnect.
        // Avoid logging here to prevent duplicate/spammy output.
      };

      socket.onclose = (event) => {
        if (epoch !== this.connectionEpoch || socket !== this.ws) return;

        if (event.code !== 1000 && event.code !== 1001 && this.reconnectAttempts === 0) {
          console.warn(`WebSocket closed: code=${event.code} reason=${event.reason || 'none'}`);
        }
        this.isConnected = false;
        this.peers.clear();
        this.peerAddresses.clear();
        this.registrationRejected = false;
        this.stopKeepAlive();
        this.notifyStatus();

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
            this.maxReconnectDelay
          );
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        }
      };

    } catch (_error) {
      // Connection failed — reconnect will be triggered via onclose
    }
  }

  /**
   * Reconnect to a different WebSocket relay.
   * Resets reconnect counter so auto-reconnect works with the new URL.
   */
  static reconnect(wsUrl?: string) {
    this.reconnectAttempts = 0;
    this.connect(wsUrl);
  }

  private static broadcastAddresses() {
    this.broadcast('peer-addresses', {
      peerId: this.peerId,
      relayUrl: config.relay.websocket,
      gunPeers: [config.relay.gun],
      joinedAt: Date.now(),
    });
  }

  private static broadcastServerList() {
    const now = Date.now();
    this.addKnownServer({
      websocket: config.relay.websocket,
      gun: config.relay.gun,
      api: config.relay.api,
      addedBy: this.peerId,
      firstSeen: now,
      source: 'local',
      signatureValid: false,
      lastVerifiedAt: now,
      expiresAt: now + this.DISCOVERY_TTL_MS,
    });

    const servers = Array.from(this.knownServers.values()).filter((s) => this.isFreshDiscovery(s));
    this.broadcast('server-list', {
      peerId: this.peerId,
      servers,
    });
  }

  private static async bootstrapDiscovery() {
    try {
      await DiscoveryService.initialize({ maxEntries: this.MAX_KNOWN_SERVERS, subscribeLive: false });
      await this.mergeDiscoveryServers();
    } catch {
      // Discovery is optional; continue with server-list fallback
    }
  }

  private static async publishDiscoveryAnnouncement() {
    try {
      await DiscoveryService.publishLocalAnnouncement({
        nodeId: this.peerId,
        peerId: this.peerId,
        websocket: config.relay.websocket,
        gun: config.relay.gun,
        api: config.relay.api,
        capabilities: ['ws-sync', 'gun-relay', 'relay-api', 'webrtc'],
      });
    } catch {
      // Discovery publish failure should not impact websocket sync
    }
  }

  private static async mergeDiscoveryServers() {
    try {
      const entries = await DiscoveryService.refreshFromGun();
      for (const entry of entries) {
        this.addKnownServer({
          websocket: entry.websocket,
          gun: entry.gun,
          api: entry.api,
          addedBy: entry.peerId || entry.nodeId,
          firstSeen: entry.timestamp,
          source: 'gun',
          signatureValid: true,
          lastVerifiedAt: entry.timestamp,
          expiresAt: entry.expiresAt,
        });
      }
    } catch {
      // Discovery read failure should not impact websocket sync
    }
  }

  private static mergeServerList(servers: KnownServer[], fromPeerId: string, signatureValid: boolean) {
    const now = Date.now();
    for (const server of servers) {
      this.addKnownServer({
        ...server,
        source: 'peer',
        signatureValid,
        lastVerifiedAt: now,
        expiresAt: now + this.DISCOVERY_TTL_MS,
        addedBy: server.addedBy || fromPeerId,
      });
    }
  }

  private static async handleIncomingServerList(message: any) {
    const payload = message?.data;
    if (!payload?.servers || !Array.isArray(payload.servers)) return;

    const signatureValid = await this.verifyDiscoverySignature(message);
    if (!signatureValid) {
      console.warn('[WS] Ignoring server-list broadcast with invalid signature');
      return;
    }

    this.mergeServerList(payload.servers, payload.peerId || 'unknown', true);
  }

  private static async verifyDiscoverySignature(message: Record<string, unknown>): Promise<boolean> {
    try {
      const { IntegrityService } = await import('@/services/integrityService');
      return IntegrityService.verifySealedPayload(message, 'server-list', this.DISCOVERY_TTL_MS);
    } catch {
      return false;
    }
  }

  private static isFreshDiscovery(server: KnownServer): boolean {
    const now = Date.now();
    const expiresAt = server.expiresAt ?? (server.firstSeen + this.DISCOVERY_TTL_MS);
    return expiresAt >= now;
  }

  private static isEndpointSetSafe(ws: string, gun: string, api: string): boolean {
    let wsUrl: URL;
    let gunUrl: URL;
    let apiUrl: URL;

    try {
      wsUrl = new URL(ws);
      gunUrl = new URL(gun);
      apiUrl = new URL(api);
    } catch {
      return false;
    }

    if (!['ws:', 'wss:'].includes(wsUrl.protocol)) return false;
    if (!['http:', 'https:'].includes(gunUrl.protocol)) return false;
    if (!['http:', 'https:'].includes(apiUrl.protocol)) return false;

    const secureContext = typeof location !== 'undefined' && location.protocol === 'https:';
    if (!secureContext) return true;

    const localhostHosts = new Set(['localhost', '127.0.0.1', '::1']);
    const isLocal = (u: URL) => localhostHosts.has(u.hostname);

    const wsSafe = wsUrl.protocol === 'wss:' || isLocal(wsUrl);
    const gunSafe = gunUrl.protocol === 'https:' || isLocal(gunUrl);
    const apiSafe = apiUrl.protocol === 'https:' || isLocal(apiUrl);
    return wsSafe && gunSafe && apiSafe;
  }

  static addKnownServer(server: KnownServer) {
    if (!this.isEndpointSetSafe(server.websocket, server.gun, server.api)) {
      console.debug('[WS] Rejected unsafe server URL set:', server.websocket);
      return;
    }

    if (server.source === 'peer' && !server.signatureValid) {
      console.debug('[WS] Rejected unsigned discovered server:', server.websocket);
      return;
    }

    const key = server.websocket;
    const existing = this.knownServers.get(key);
    if (!existing) {
      // Evict at capacity, preferring the lowest-reputation known server so
      // proven-good endpoints survive; fall back to oldest-inserted on a tie.
      if (this.knownServers.size >= this.MAX_KNOWN_SERVERS) {
        const evictKey = this.lowestReputationKnownServerKey();
        if (evictKey) this.knownServers.delete(evictKey);
      }
      this.knownServers.set(key, {
        ...server,
        firstSeen: server.firstSeen || Date.now(),
      });
    } else {
      this.knownServers.set(key, {
        ...existing,
        ...server,
        firstSeen: existing.firstSeen || server.firstSeen || Date.now(),
        lastVerifiedAt: server.lastVerifiedAt ?? existing.lastVerifiedAt,
        signatureValid: server.signatureValid,
      });
    }
    this.saveKnownServers();
  }

  /**
   * Pick the known-server key with the worst reputation (keyed by ws URL). The
   * Map preserves insertion order, so the first-scanned lowest score is also the
   * oldest among equals — giving oldest-inserted eviction as the natural tiebreak.
   */
  private static lowestReputationKnownServerKey(): string | undefined {
    let worstKey: string | undefined;
    let worstScore = Infinity;
    for (const key of this.knownServers.keys()) {
      const score = PeerReputationService.scoreFor(key);
      if (score < worstScore) {
        worstScore = score;
        worstKey = key;
      }
    }
    return worstKey ?? this.knownServers.keys().next().value;
  }

  static removeKnownServer(websocketUrl: string) {
    this.knownServers.delete(websocketUrl);
    this.saveKnownServers();
  }

  static getKnownServers(): KnownServer[] {
    return Array.from(this.knownServers.values()).filter((server) => (
      server.source === 'peer' ? this.isFreshDiscovery(server) : true
    ));
  }

  private static saveKnownServers() {
    try {
      const servers = Array.from(this.knownServers.values());
      localStorage.setItem('interpoll_known_servers', JSON.stringify(servers));
    } catch {
      // Storage full or unavailable
    }
  }

  private static loadKnownServers() {
    try {
      const raw = localStorage.getItem('interpoll_known_servers');
      if (raw) {
        const servers: KnownServer[] = JSON.parse(raw);
        const capped = servers.slice(-this.MAX_KNOWN_SERVERS);
        for (const server of capped) {
          // Validate URL format and scheme before loading
          if (typeof server.websocket !== 'string' || typeof server.gun !== 'string' || typeof server.api !== 'string') continue;
          if (!this.isEndpointSetSafe(server.websocket, server.gun, server.api)) continue;
          const hydrated: KnownServer = {
            ...server,
            source: server.source === 'local' || server.source === 'peer' || server.source === 'gun'
              ? server.source
              : 'peer',
            signatureValid: Boolean(server.signatureValid),
            lastVerifiedAt: server.lastVerifiedAt ?? server.firstSeen,
            expiresAt: server.source === 'peer'
              ? (server.expiresAt ?? (server.firstSeen + this.DISCOVERY_TTL_MS))
              : server.expiresAt,
          };
          if (hydrated.source === 'peer' && !this.isFreshDiscovery(hydrated)) continue;
          this.knownServers.set(server.websocket, hydrated);
        }
      }
    } catch {
      // Corrupted data; ignore
    }
  }

  private static sendToRelay(type: string, data: any) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    if (type === 'broadcast') {
      this.ws.send(JSON.stringify({ type: 'broadcast', data }));
      return;
    }

    this.ws.send(JSON.stringify({ type, ...data }));
  }

  /**
   * Send a raw message to the relay without broadcast wrapping or PoW.
   * Used by PowService to request challenges.
   * Returns true if the message was sent, false if the socket was not open.
   */
  static sendRaw(message: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  static async broadcast(type: string, data: any): Promise<void> {
    const message: any = { type, data, timestamp: Date.now() };

    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      this.enqueue(message);
      return;
    }

    // Attach PoW for content messages (dynamic import avoids circular dependency)
    if (POW_CONTENT_TYPES.has(type)) {
      try {
        const { PowService } = await import('@/services/powService');
        if (PowService.requiresProof(type, data?.actionType)) {
          const proof = await PowService.getProof(type);
          message.pow = proof;
        }
      } catch (e) {
        const retries = (message._retries ?? 0) + 1;
        if (retries >= 3) {
          console.error('[PoW] Dropping message after 3 failed attempts:', type, e);
          return;
        }
        message._retries = retries;
        console.warn(`[PoW] Failed to get proof (attempt ${retries}/3), queuing message for retry:`, e);
        this.enqueue(message);
        return;
      }

      // Re-check connection after async PoW (may have disconnected during solve)
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.enqueue(message);
        return;
      }
    }

    // Seal with integrity fields (hash, signature, hashcash PoW, replay protection)
    delete message._retries;
    try {
      const { IntegrityService } = await import('@/services/integrityService');
      const sealed = await IntegrityService.seal(message, message.type || 'broadcast');
      Object.assign(message, sealed);
    } catch (e) {
      console.error('[Integrity] Failed to seal broadcast, dropping message:', e);
      return;
    }

    // Re-check connection after async integrity sealing
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.enqueue(message);
      return;
    }

    this.sendToRelay('broadcast', message);
  }

  static subscribe(type: string, callback: (data: any) => void) {
    if (!this.callbacks.has(type)) {
      this.callbacks.set(type, new Set());
    }
    this.callbacks.get(type)?.add(callback);
  }

  /**
   * Broadcast an already-encrypted chat room message via the relay.
   * The relay forwards the opaque blob to all other connected clients.
   */
  static broadcastChatRoomMessage(roomId: string, messageData: any) {
    const message = { type: 'chatroom-message' as const, roomId, data: messageData };

    if (!this.isConnected) {
      this.enqueue(message);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.enqueue(message);
    }
  }

  /**
   * Subscribe to incoming chat room messages for a specific room.
   * Returns an unsubscribe function.
   */
  static subscribeToChatRoom(roomId: string, callback: (data: any) => void): () => void {
    if (!this.chatRoomListeners.has(roomId)) {
      this.chatRoomListeners.set(roomId, new Set());
    }
    this.chatRoomListeners.get(roomId)!.add(callback);

    return () => {
      const listeners = this.chatRoomListeners.get(roomId);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.chatRoomListeners.delete(roomId);
        }
      }
    };
  }

  static getPeerId(): string {
    return this.peerId;
  }

  static getConnectionStatus(): boolean {
    return this.isConnected;
  }

  static getConnectedUrl(): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return null;
    return this.ws.url || this.lastConnectUrl;
  }

  static getPeerCount(): number {
    const peerListCount = this.peers.has(this.peerId)
      ? Math.max(0, this.peers.size - 1)
      : this.peers.size;
    const peerAddressCount = this.peerAddresses.size;
    return Math.max(peerListCount, peerAddressCount);
  }

  static getPeerAddresses(): Map<string, { peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }> {
    return new Map(this.peerAddresses);
  }

  /** Peer ids currently known on the relay (excluding ourselves). */
  static getPeerIds(): string[] {
    return Array.from(this.peers).filter((id) => id && id !== this.peerId);
  }

  /** True when the relay rejected registration for lack of an authenticated session. */
  static isRegistrationRejected(): boolean {
    return this.registrationRejected;
  }

  static onStatusChange(callback: (status: { connected: boolean; peerCount: number; registrationRejected: boolean }) => void): () => void {
    this.statusListeners.add(callback);
    callback({ connected: this.isConnected, peerCount: this.getPeerCount(), registrationRejected: this.registrationRejected });

    return () => {
      this.statusListeners.delete(callback);
    };
  }

  static cleanup() {
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.clear();
    this.chatRoomListeners.clear();
    this.isConnected = false;
    this.peers.clear();
    this.peerAddresses.clear();
    this.statusListeners.clear();
  }

  /**
   * Send a JSON-level ping every 15s as a fallback for environments where
   * native WebSocket ping frames aren't surfaced (e.g. some mobile browsers).
   * The server handles this with a 'pong' reply.
   * Real keepalive is done server-side via native ws.ping() every 20s.
   */
  private static startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          // Socket closed between check and send — onclose will trigger reconnect
        }
      }
    }, 15_000); // Every 15s — server pings at 20s, so we stay well inside the window
  }

  private static stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private static notifyStatus() {
    const snapshot = {
      connected: this.isConnected,
      peerCount: this.getPeerCount(),
      registrationRejected: this.registrationRejected,
    };
    this.statusListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (_err) {
        // Ignore listener errors
      }
    });
  }
}
