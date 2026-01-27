// src/services/websocketService.ts
// WebSocket client for cross-device/cross-browser sync

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

  // Change this to your relay server URL
  private static RELAY_URL = 'ws://localhost:8080';

  static initialize() {
    console.log('🌐 Initializing WebSocket P2P sync...');
    this.connect();
  }

  static connect() {
    try {
      this.ws = new WebSocket(this.RELAY_URL);

      this.ws.onopen = () => {
        console.log('✅ WebSocket connected to relay server');
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Register with server
        this.sendToRelay('register', { peerId: this.peerId });

        // Join default room
        this.sendToRelay('join-room', { roomId: 'default' });

        // Send queued messages
        while (this.messageQueue.length > 0) {
          const msg = this.messageQueue.shift();
          this.broadcast(msg.type, msg.data);
        }

        // Request sync from other peers
        setTimeout(() => {
          this.broadcast('request-sync', { peerId: this.peerId });
        }, 1000);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // Handle server messages
          if (message.type === 'welcome') {
            console.log('📡 Relay server:', message.message);
            return;
          }
          
          if (message.type === 'peer-list') {
            console.log('👥 Active peers:', message.peers.length);
            return;
          }

          if (message.type === 'peer-left') {
            console.log('👋 Peer left:', message.peerId);
            return;
          }

          // Handle P2P messages
          console.log('📨 Received WebSocket message:', message.type);
          
          const callback = this.callbacks.get(message.type);
          if (callback) {
            callback(message.data || message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        this.isConnected = false;

        // Attempt reconnection
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`🔄 Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
          setTimeout(() => this.connect(), this.reconnectDelay);
        } else {
          console.error('❌ Max reconnection attempts reached. Using local-only mode.');
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
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
      console.log('⏳ WebSocket not connected, queuing message:', type);
      this.messageQueue.push(message);
      return;
    }

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendToRelay('broadcast', message);
      console.log('📤 WebSocket broadcast sent:', type);
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

  static cleanup() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.callbacks.clear();
    this.isConnected = false;
  }
}