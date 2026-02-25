// chatService.ts - P2P Chat Service for Vue

import { GunService } from './gunService';

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  message: string;
  timestamp: number;
  read: boolean;
  sent: boolean;
}

export interface RecipientInfo {
  userId: string;
  publicKey?: string;
  name?: string;
  avatar?: string;
}

class ChatService {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private userId: string;
  private peerId: string;
  private keyPair: CryptoKeyPair | null = null;
  private recipientKeys: Map<string, CryptoKey> = new Map();
  private connected: boolean = false;
  private reconnectTimer: number | null = null;

  public onMessage:          ((msg: ChatMessage) => void) | null = null;
  public onTyping:           ((data: { from: string; isTyping: boolean }) => void) | null = null;
  public onDelivered:        ((data: { messageId: string; recipientId: string }) => void) | null = null;
  public onReadReceipt:      ((data: { from: string }) => void) | null = null;
  public onConnectionChange: ((connected: boolean) => void) | null = null;

  constructor(wsUrl: string, userId: string) {
    this.wsUrl   = wsUrl;
    this.userId  = userId;
    this.peerId  = `peer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  async init(): Promise<string> {
    this.keyPair = await this.loadOrGenerateKeyPair();
    const pubKeyB64 = await this.exportPublicKey();

    // Publish RSA-OAEP public key to GunDB so peers can find it
    const gun = GunService.getGun();
    gun.get('users').get(this.userId).get('chatPublicKey').put(pubKeyB64);

    this.connect();
    return pubKeyB64;
  }

  // ── RSA Key Management ──────────────────────────────────────────────────────

  private async loadOrGenerateKeyPair(): Promise<CryptoKeyPair> {
    try {
      const stored = localStorage.getItem(`chat-keypair-${this.userId}`);
      if (stored) {
        const { privateKey, publicKey } = JSON.parse(stored);
        const pub = await crypto.subtle.importKey(
          'spki',
          Uint8Array.from(atob(publicKey), c => c.charCodeAt(0)),
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          true, ['encrypt']
        );
        const priv = await crypto.subtle.importKey(
          'pkcs8',
          Uint8Array.from(atob(privateKey), c => c.charCodeAt(0)),
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          true, ['decrypt']
        );
        return { publicKey: pub, privateKey: priv };
      }
    } catch {
      // Corrupt stored key — regenerate
    }

    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']
    );

    const pubExp  = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki',  pair.publicKey))));
    const privExp = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
    localStorage.setItem(`chat-keypair-${this.userId}`, JSON.stringify({ publicKey: pubExp, privateKey: privExp }));

    return pair;
  }

  async exportPublicKey(): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized');
    const exported = await crypto.subtle.exportKey('spki', this.keyPair.publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  private async importPublicKey(base64Key: string): Promise<CryptoKey> {
    const binary = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
      'spki', binary,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true, ['encrypt']
    );
  }

  // ── GunDB Key Fetch ─────────────────────────────────────────────────────────

  private async fetchRecipientChatKey(recipientId: string): Promise<string | null> {
    const gun = GunService.getGun();
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      gun.get('users').get(recipientId).get('chatPublicKey').once((key: any) => {
        clearTimeout(timer);
        resolve(typeof key === 'string' && key.length > 0 ? key : null);
      });
    });
  }

  // ── Encryption ──────────────────────────────────────────────────────────────

  private async encryptMessage(message: string, recipientPublicKey: CryptoKey): Promise<string> {
    const data      = new TextEncoder().encode(message);
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, data);
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  }

  private async decryptMessage(encryptedBase64: string): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized');
    const binary    = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const decrypted = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, this.keyPair.privateKey, binary);
    return new TextDecoder().decode(decrypted);
  }

  // ── GunDB Message Storage ───────────────────────────────────────────────────

  /**
   * Room key is sorted so both users share the same GunDB path.
   * e.g. chats/alice:bob/msg-123
   * Messages are stored twice — once encrypted for recipient, once for sender —
   * so both can decrypt their own copy.
   */
  private getRoomId(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  private async storeMessageInGun(
    roomId: string,
    messageId: string,
    senderId: string,
    recipientId: string,
    encryptedForRecipient: string,
    encryptedForSender: string,
    timestamp: number
  ): Promise<void> {
    const gun = GunService.getGun();
    gun.get('chats').get(roomId).get(messageId).put({
      id:                   messageId,
      senderId,
      recipientId,
      encryptedForRecipient, // decryptable by recipient
      encryptedForSender,    // decryptable by sender
      timestamp,
      readAt:               null,
    });
  }

  /**
   * Load and decrypt all messages for a conversation from GunDB.
   */
  async loadHistory(recipientId: string): Promise<ChatMessage[]> {
    const gun    = GunService.getGun();
    const roomId = this.getRoomId(this.userId, recipientId);
    const raw: any[] = [];

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      gun.get('chats').get(roomId).once((room: any) => {
        clearTimeout(timer);
        if (!room) { resolve(); return; }
        const keys = Object.keys(room).filter(k => k !== '_' && k.startsWith('msg-'));
        if (keys.length === 0) { resolve(); return; }

        let loaded = 0;
        keys.forEach((msgId) => {
          gun.get('chats').get(roomId).get(msgId).once((msg: any) => {
            if (msg && msg.senderId) raw.push(msg);
            loaded++;
            if (loaded === keys.length) resolve();
          });
        });
      });
    });

    // Sort by timestamp
    raw.sort((a, b) => a.timestamp - b.timestamp);

    const result: ChatMessage[] = [];
    for (const msg of raw) {
      try {
        const isSent        = msg.senderId === this.userId;
        const encryptedBlob = isSent ? msg.encryptedForSender : msg.encryptedForRecipient;
        const text          = await this.decryptMessage(encryptedBlob);
        result.push({
          id:        msg.id,
          from:      msg.senderId,
          to:        msg.recipientId,
          message:   text,
          timestamp: msg.timestamp,
          read:      !!msg.readAt,
          sent:      isSent,
        });
      } catch {
        // Skip messages from a previous keypair
      }
    }

    return result;
  }

  // ── WebSocket ───────────────────────────────────────────────────────────────

  private connect(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      if (this.onConnectionChange) this.onConnectionChange(true);
      this.ws!.send(JSON.stringify({ type: 'register', peerId: this.peerId, userId: this.userId }));
    };

    this.ws.onmessage = async (event) => {
      try { await this.handleMessage(JSON.parse(event.data)); }
      catch (err) { console.error('❌ Chat message error:', err); }
    };

    this.ws.onerror = (err) => console.error('❌ Chat WS error:', err);

    this.ws.onclose = () => {
      this.connected = false;
      if (this.onConnectionChange) this.onConnectionChange(false);
      this.reconnectTimer = window.setTimeout(() => this.connect(), 2000);
    };
  }

  private async handleMessage(data: any): Promise<void> {
    switch (data.type) {
      case 'chat-message':
        if (this.onMessage) {
          try {
            // Decrypt using our private key (encryptedForRecipient)
            const decrypted = await this.decryptMessage(data.encryptedForRecipient);
            this.onMessage({
              id:        data.messageId,
              from:      data.from,
              to:        this.userId,
              message:   decrypted,
              timestamp: data.timestamp,
              read:      false,
              sent:      false,
            });
          } catch (err) {
            console.error('❌ Decryption failed:', err);
          }
        }
        break;

      case 'chat-typing':
        if (this.onTyping) this.onTyping({ from: data.from, isTyping: data.isTyping });
        break;

      case 'chat-delivered':
        if (this.onDelivered) this.onDelivered({ messageId: data.messageId, recipientId: data.recipientId });
        break;

      case 'chat-read-receipt':
        if (this.onReadReceipt) this.onReadReceipt({ from: data.from });
        break;
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async startChat(recipient: RecipientInfo): Promise<void> {
    const gunKey = await this.fetchRecipientChatKey(recipient.userId);
    if (!gunKey) throw new Error(`No RSA chat key found for user ${recipient.userId}. Have them open the app first.`);

    const pubKey = await this.importPublicKey(gunKey);
    this.recipientKeys.set(recipient.userId, pubKey);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-start', recipientId: recipient.userId }));
    }
  }

  async sendMessage(recipientId: string, message: string): Promise<string> {
    let recipientKey = this.recipientKeys.get(recipientId);

    // Auto-recover if key not cached
    if (!recipientKey) {
      const keyB64 = await this.fetchRecipientChatKey(recipientId);
      if (!keyB64) throw new Error('Recipient public key not found. Have them open the app first.');
      recipientKey = await this.importPublicKey(keyB64);
      this.recipientKeys.set(recipientId, recipientKey);
    }

    // Encrypt once for recipient, once for ourselves (so we can decrypt sent msgs)
    const encryptedForRecipient = await this.encryptMessage(message, recipientKey);
    const encryptedForSender    = await this.encryptMessage(message, this.keyPair!.publicKey);

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();
    const roomId    = this.getRoomId(this.userId, recipientId);

    // Persist to GunDB (both encrypted blobs stored, neither is plaintext)
    await this.storeMessageInGun(
      roomId, messageId,
      this.userId, recipientId,
      encryptedForRecipient,
      encryptedForSender,
      timestamp
    );

    // Deliver in real-time via WebSocket relay
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type:                 'chat-message',
        recipientId,
        encryptedForRecipient, // relay forwards this to recipient
        messageId,
        timestamp,
      }));
    }

    return messageId;
  }

  sendTyping(recipientId: string, isTyping: boolean): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-typing', recipientId, isTyping }));
    }
  }

  markAsRead(recipientId: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat-read', recipientId }));
    }
    // Mark in GunDB too
    const gun    = GunService.getGun();
    const roomId = this.getRoomId(this.userId, recipientId);
    gun.get('chats').get(roomId).map().once((msg: any, msgId: string) => {
      if (msg && msg.recipientId === this.userId && !msg.readAt) {
        gun.get('chats').get(roomId).get(msgId).get('readAt').put(Date.now());
      }
    });
  }

  isConnected(): boolean { return this.connected; }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
  }
}

export default ChatService;