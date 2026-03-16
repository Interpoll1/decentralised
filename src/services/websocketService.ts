import config from '../config';

type SyncMessage =
  | { type: 'new-poll'; data: any }
  | { type: 'new-block'; data: any }
  | { type: 'request-sync'; peerId: string }
  | { type: 'sync-response'; data: any }
  | { type: 'peer-addresses'; data: any }
  | { type: 'server-list'; data: any }
  | { type: 'chatroom-message'; roomId: string; data: any };

/** Message types that may require proof-of-work on the relay server.
 *  Must stay in sync with POW_REQUIRED_TYPES in src/services/powService.ts. */
const POW_CONTENT_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);

export interface KnownServer {
  websocket: string;
  gun: string;
  api: string;
  addedBy: string;
  firstSeen: number;
}

export class WebSocketService {
  private static ws: WebSocket | null = null;
  private static peerId: string = Math.random().toString(36).substring(7);
  private static callbacks: Map<string, (data: any) => void> = new Map();
  private static isConnected = false;
  private static reconnectAttempts = 0;
  private static maxReconnectAttempts = Infinity;
  private static baseReconnectDelay = 1000;
  private static maxReconnectDelay = 30000;
  private static messageQueue: any[] = [];
  private static peers: Set<string> = new Set();
  private static peerAddresses: Map<string, { peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }> = new Map();
  private static statusListeners: Set<(status: { connected: boolean; peerCount: number }) => void> = new Set();
  private static knownServers: Map<string, KnownServer> = new Map();
  private static keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private static reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private static lastConnectUrl: string | null = null;
  private static syncRequestCallback: (() => void) | null = null;
  private static chatRoomListeners: Map<string, Set<(data: any) => void>> = new Map();

  /**
   * Register a callback that fires on every (re)connect to request incremental sync.
   */
  static onConnectSyncRequest(callback: () => void) {
    this.syncRequestCallback = callback;
  }

  static initialize() {
    this.loadKnownServers();
    this.connect();
  }

  // Tracks whether we intentionally closed the socket so onclose skips reconnect
  private static intentionalClose = false;

  static connect(wsUrl?: string) {
    // If a connection attempt is already in progress (CONNECTING), don't close
    // it — closing a CONNECTING socket fires onclose which triggers another
    // reconnect, creating an infinite spam loop.
    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) {
        // Already trying to connect to the same URL — just wait
        if (!wsUrl || wsUrl === this.lastConnectUrl) return;
      }
      this.intentionalClose = true;
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalClose = false;
    const url = wsUrl || this.lastConnectUrl || config.relay.websocket;
    this.lastConnectUrl = url;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = async () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;

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

        if (this.syncRequestCallback) {
          this.syncRequestCallback();
        } else {
          setTimeout(() => {
            this.broadcast('request-sync', { peerId: this.peerId });
          }, 1000);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'welcome' || message.type === 'pong') {
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

          const callback = this.callbacks.get(message.type);
          if (callback) {
            callback(message.data || message);
          }
        } catch (_error) {
          // Malformed message — ignore
        }
      };

      this.ws.onerror = (_event) => {
        // Errors are followed by onclose, which handles reconnect.
        // Avoid logging here to prevent duplicate/spammy output.
      };

      this.ws.onclose = (event) => {
        // If we closed intentionally (e.g. switching URLs), don't reconnect
        if (this.intentionalClose) {
          this.intentionalClose = false;
          return;
        }

        if (event.code !== 1000 && event.code !== 1001 && this.reconnectAttempts === 0) {
          console.warn(`WebSocket closed: code=${event.code} reason=${event.reason || 'none'}`);
        }
        this.isConnected = false;
        this.peers.clear();
        this.peerAddresses.clear();
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

      // Listen for address broadcasts from other peers
      this.subscribe('peer-addresses', (data: any) => {
        if (data?.peerId && data.peerId !== this.peerId) {
          this.peerAddresses.set(data.peerId, {
            peerId: data.peerId,
            relayUrl: data.relayUrl || '',
            gunPeers: data.gunPeers || [],
            joinedAt: data.joinedAt || Date.now(),
          });
        }
      });

      // Listen for server list broadcasts from other peers
      this.subscribe('server-list', (data: any) => {
        if (data?.servers && Array.isArray(data.servers)) {
          this.mergeServerList(data.servers, data.peerId || 'unknown');
        }
      });
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
    this.addKnownServer({
      websocket: config.relay.websocket,
      gun: config.relay.gun,
      api: config.relay.api,
      addedBy: this.peerId,
      firstSeen: Date.now(),
    });

    const servers = Array.from(this.knownServers.values());
    this.broadcast('server-list', {
      peerId: this.peerId,
      servers,
    });
  }

  private static mergeServerList(servers: KnownServer[], fromPeerId: string) {
    for (const server of servers) {
      this.addKnownServer({
        ...server,
        addedBy: server.addedBy || fromPeerId,
      });
    }
  }

  static addKnownServer(server: KnownServer) {
    const key = server.websocket;
    if (!this.knownServers.has(key)) {
      this.knownServers.set(key, {
        ...server,
        firstSeen: server.firstSeen || Date.now(),
      });
      this.saveKnownServers();
    }
  }

  static removeKnownServer(websocketUrl: string) {
    this.knownServers.delete(websocketUrl);
    this.saveKnownServers();
  }

  static getKnownServers(): KnownServer[] {
    return Array.from(this.knownServers.values());
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
        for (const server of servers) {
          this.knownServers.set(server.websocket, server);
        }
      }
    } catch {
      // Corrupted data; ignore
    }
  }

  private static sendToRelay(type: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
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
      this.messageQueue.push(message);
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
        this.messageQueue.push(message);
        return;
      }

      // Re-check connection after async PoW (may have disconnected during solve)
      if (this.ws?.readyState !== WebSocket.OPEN) {
        this.messageQueue.push(message);
        return;
      }
    }

    this.sendToRelay('broadcast', message);
  }

  static subscribe(type: string, callback: (data: any) => void) {
    this.callbacks.set(type, callback);
  }

  /**
   * Broadcast an already-encrypted chat room message via the relay.
   * The relay forwards the opaque blob to all other connected clients.
   */
  static broadcastChatRoomMessage(roomId: string, messageData: any) {
    const message = { type: 'chatroom-message' as const, roomId, data: messageData };

    if (!this.isConnected) {
      this.messageQueue.push(message);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
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

  static getPeerCount(): number {
    const totalPeers = this.peers.size || (this.isConnected ? 1 : 0);
    return Math.max(0, totalPeers - 1);
  }

  static getPeerAddresses(): Map<string, { peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }> {
    return new Map(this.peerAddresses);
  }

  static onStatusChange(callback: (status: { connected: boolean; peerCount: number }) => void): () => void {
    this.statusListeners.add(callback);
    callback({ connected: this.isConnected, peerCount: this.getPeerCount() });

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
      this.intentionalClose = true;
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
    const snapshot = { connected: this.isConnected, peerCount: this.getPeerCount() };
    this.statusListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (_err) {
        // Ignore listener errors
      }
    });
  }
}