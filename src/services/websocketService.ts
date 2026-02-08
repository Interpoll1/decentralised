import config from '../config';

type SyncMessage =
  | { type: 'new-poll'; data: any }
  | { type: 'new-block'; data: any }
  | { type: 'request-sync'; peerId: string }
  | { type: 'sync-response'; data: any }
  | { type: 'peer-addresses'; data: any };

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

  static initialize() {
    this.connect();
  }

  static connect() {
    try {
      this.ws = new WebSocket(config.relay.websocket);

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
    } catch (_error) {
      // Connection failed
    }
  }

  private static broadcastAddresses() {
    this.broadcast('peer-addresses', {
      peerId: this.peerId,
      relayUrl: config.relay.websocket,
      gunPeers: [config.relay.gun],
      joinedAt: Date.now(),
    });
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
