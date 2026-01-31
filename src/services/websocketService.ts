// src/services/websocketService.ts
type SyncMessage =
  | { type: 'new-poll'; data: any }
  | { type: 'new-block'; data: any }
  | { type: 'request-sync'; peerId: string }
  | { type: 'sync-response'; data: any };

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
  private static statusListeners: Set<(status: { connected: boolean; peerCount: number }) => void> = new Set();

  private static RELAY_URL = 'ws://localhost:8080';

  static initialize() {
    this.connect();
  }

  static connect() {
    try {
      this.ws = new WebSocket(this.RELAY_URL);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Assume at least our own peer is present while waiting for the first peer list
        this.peers.add(this.peerId);
        this.notifyStatus();

        this.sendToRelay('register', { peerId: this.peerId });

        this.sendToRelay('join-room', { roomId: 'default' });

        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          this.broadcast(msg.type, msg.data);
        }

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
              this.notifyStatus();
            }
            return;
          }

          const callback = this.callbacks.get(message.type);
          if (callback) {
            callback(message.data || message);
          }
        } catch (error) {
          // silently ignore
        }
      };

      this.ws.onerror = (error) => {
        // handled in onclose
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.peers.clear();
        this.notifyStatus();

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), this.reconnectDelay);
        }
      };
    } catch (error) {
      // silently ignore
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
    this.statusListeners.clear();
  }

  private static notifyStatus() {
    const snapshot = { connected: this.isConnected, peerCount: this.getPeerCount() };
    this.statusListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (_err) {
        // Ignore listener errors to avoid breaking status propagation
      }
    });
  }
}