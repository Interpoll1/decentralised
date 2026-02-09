import config from '../config';

type SyncMessage =
  | { type: 'new-poll'; data: any }
  | { type: 'new-block'; data: any }
  | { type: 'request-sync'; peerId: string }
  | { type: 'sync-response'; data: any }
  | { type: 'peer-addresses'; data: any }
  | { type: 'server-list'; data: any };

export interface KnownServer {
  websocket: string;
  gun: string;
  api: string;
  addedBy: string;         // peerId that reported it
  firstSeen: number;
}

export class WebSocketService {
  private static ws: WebSocket | null = null;
  private static peerId: string = Math.random().toString(36).substring(7);
  private static callbacks: Map<string, (data: any) => void> = new Map();
  private static isConnected = false;
  private static reconnectAttempts = 0;
  private static maxReconnectAttempts = 10;
  private static reconnectDelay = 3000;
  private static messageQueue: any[] = [];
  private static peers: Set<string> = new Set();
  private static peerAddresses: Map<string, { peerId: string; relayUrl: string; gunPeers: string[]; joinedAt: number }> = new Map();
  private static statusListeners: Set<(status: { connected: boolean; peerCount: number }) => void> = new Set();
  private static knownServers: Map<string, KnownServer> = new Map();

  static initialize() {
    this.loadKnownServers();
    this.connect();
  }

  static connect(wsUrl?: string) {
    // Close existing connection if any
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }

    const url = wsUrl || config.relay.websocket;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;

        this.peers.add(this.peerId);
        this.notifyStatus();

        this.sendToRelay('register', { peerId: this.peerId });
        this.sendToRelay('join-room', { roomId: 'default' });

        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          this.broadcast(msg.type, msg.data);
        }

        // Share our relay addresses with all peers
        this.broadcastAddresses();
        // Share our known server list
        this.broadcastServerList();

        setTimeout(() => {
          this.broadcast('request-sync', { peerId: this.peerId });
        }, 1000);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          if (message.type === 'welcome') {
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

          const callback = this.callbacks.get(message.type);
          if (callback) {
            callback(message.data || message);
          }
        } catch (_error) {
          // Malformed message
        }
      };

      this.ws.onerror = () => {
        // Handled in onclose
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.peers.clear();
        this.peerAddresses.clear();
        this.notifyStatus();

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), this.reconnectDelay);
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
      // Connection failed
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
    // Add our own current server to the list before broadcasting
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
    // Use the websocket URL as the unique key
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

  static broadcast(type: string, data: any) {
    const message = { type, data, timestamp: Date.now() };

    if (!this.isConnected) {
      this.messageQueue.push(message);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendToRelay('broadcast', message);
    }
  }

  static subscribe(type: string, callback: (data: any) => void) {
    this.callbacks.set(type, callback);
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.clear();
    this.isConnected = false;
    this.peers.clear();
    this.peerAddresses.clear();
    this.statusListeners.clear();
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
