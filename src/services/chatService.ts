// chatService.ts — 1:1 end-to-end encrypted direct messages over GenosDB.
//
// The RSA-OAEP pairwise encryption is kept (it is app-level WebCrypto, not Gun).
// What changes is the plumbing: the WebSocket relay + manual reconnect is replaced
// by GenosDB's P2P sync (encrypted message nodes deliver in real time on their own)
// and an ephemeral db.room channel for typing indicators. Recipient key discovery
// moves from a Gun path to a GenosDB node.
import { db } from './gdbServices'
import { StorageService } from './storageService'

export interface ChatMessage {
  id: string
  from: string
  to: string
  message: string
  timestamp: number
  read: boolean
  sent: boolean
}

export interface RecipientInfo {
  userId: string
  publicKey?: string
  name?: string
  avatar?: string
}

class ChatService {
  static readonly KEYPAIR_STORAGE_PREFIX = 'chat-keypair'
  private userId: string
  private keyPair: CryptoKeyPair | null = null
  private recipientKeys = new Map<string, CryptoKey>()
  private connected = false
  private typingChannel: { send: (data: unknown) => void; on: (ev: string, cb: (data: any, peerId: string) => void) => void } | null = null
  private unsubMessages: (() => void) | null = null

  public onMessage: ((msg: ChatMessage) => void) | null = null
  public onTyping: ((data: { from: string; isTyping: boolean }) => void) | null = null
  public onDelivered: ((data: { messageId: string; recipientId: string }) => void) | null = null
  public onReadReceipt: ((data: { from: string }) => void) | null = null
  public onConnectionChange: ((connected: boolean) => void) | null = null

  // wsUrl is accepted for API compatibility but unused — GenosDB needs no relay socket.
  constructor(_wsUrl: string, userId: string) {
    this.userId = userId
  }

  // ── Init ────────────────────────────────────────────────────────────────────
  async init(): Promise<string> {
    this.keyPair = await this.loadOrGenerateKeyPair()
    const pubKeyB64 = await this.exportPublicKey()

    // Publish our RSA public key so peers can encrypt to us.
    const { result } = await db.get(`chatKey:${this.userId}`)
    if (result?.value?.key !== pubKeyB64) {
      await db.sm.acls.set({ type: 'chatKey', userId: this.userId, key: pubKeyB64 }, `chatKey:${this.userId}`)
    }

    // Incoming messages arrive as synced nodes — only surface genuinely new ones.
    const { unsubscribe } = await db.map(
      { query: { type: 'dm', recipientId: this.userId } },
      async ({ value, action }) => {
        if (action !== 'added' || !value?.encryptedForRecipient) return
        try {
          const message = await this.decryptMessage(value.encryptedForRecipient)
          this.onMessage?.({ id: value.id, from: value.senderId, to: this.userId, message, timestamp: value.timestamp, read: false, sent: false })
        } catch { /* skip messages from a previous keypair */ }
      },
    )
    this.unsubMessages = unsubscribe

    // Ephemeral typing indicators travel over a room channel, not the database.
    this.typingChannel = db.room.channel('chat-typing')
    this.typingChannel!.on('message', (data: { from: string; to: string; isTyping: boolean }) => {
      if (data?.to === this.userId) this.onTyping?.({ from: data.from, isTyping: data.isTyping })
    })

    this.connected = true
    this.onConnectionChange?.(true)
    return pubKeyB64
  }

  // ── RSA key management ────────────────────────────────────────────────────────
  private getKeypairStorageKey(): string {
    return `${ChatService.KEYPAIR_STORAGE_PREFIX}:${this.userId}`
  }

  private isStoredKeyPair(value: unknown): value is CryptoKeyPair {
    return !!value && typeof value === 'object' && 'publicKey' in value && 'privateKey' in value
  }

  private async loadOrGenerateKeyPair(): Promise<CryptoKeyPair> {
    try {
      const stored = await StorageService.getMetadata(this.getKeypairStorageKey())
      if (this.isStoredKeyPair(stored)) return stored
    } catch { /* fall through to generate */ }

    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      false, ['encrypt', 'decrypt'],
    )
    await StorageService.setMetadata(this.getKeypairStorageKey(), pair)
    return pair
  }

  async exportPublicKey(): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized')
    const exported = await crypto.subtle.exportKey('spki', this.keyPair.publicKey)
    return btoa(String.fromCharCode(...new Uint8Array(exported)))
  }

  private async importPublicKey(base64Key: string): Promise<CryptoKey> {
    const binary = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0))
    return crypto.subtle.importKey('spki', binary, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt'])
  }

  private async fetchRecipientChatKey(recipientId: string): Promise<string | null> {
    const { result } = await db.get(`chatKey:${recipientId}`)
    const key = result?.value?.key
    return typeof key === 'string' && key.length > 0 ? key : null
  }

  // ── Encryption ────────────────────────────────────────────────────────────────
  private async encryptMessage(message: string, recipientPublicKey: CryptoKey): Promise<string> {
    const encrypted = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, new TextEncoder().encode(message))
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)))
  }

  private async decryptMessage(encryptedBase64: string): Promise<string> {
    if (!this.keyPair) throw new Error('Key pair not initialized')
    const binary = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0))
    const decrypted = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, this.keyPair.privateKey, binary)
    return new TextDecoder().decode(decrypted)
  }

  /** Stable conversation id shared by both participants. */
  private getRoomId(userA: string, userB: string): string {
    return [userA, userB].sort().join(':')
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  async startChat(recipient: RecipientInfo): Promise<void> {
    const keyB64 = await this.fetchRecipientChatKey(recipient.userId)
    if (!keyB64) throw new Error(`No RSA chat key found for user ${recipient.userId}. Have them open the app first.`)
    this.recipientKeys.set(recipient.userId, await this.importPublicKey(keyB64))
  }

  async sendMessage(recipientId: string, message: string): Promise<string> {
    let recipientKey = this.recipientKeys.get(recipientId)
    if (!recipientKey) {
      const keyB64 = await this.fetchRecipientChatKey(recipientId)
      if (!keyB64) throw new Error('Recipient public key not found. Have them open the app first.')
      recipientKey = await this.importPublicKey(keyB64)
      this.recipientKeys.set(recipientId, recipientKey)
    }

    // Encrypt for the recipient and for ourselves, so both can read history.
    const encryptedForRecipient = await this.encryptMessage(message, recipientKey)
    const encryptedForSender = await this.encryptMessage(message, this.keyPair!.publicKey)
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const timestamp = Date.now()

    // The synced node IS the delivery — no relay forwarding needed.
    // ACL-owned by the sender; the recipient gets `write` (not `delete`) so they
    // can mark it read but cannot remove it, and no other peer can touch it.
    await db.sm.acls.set({
      type: 'dm',
      id: messageId,
      roomId: this.getRoomId(this.userId, recipientId),
      senderId: this.userId,
      recipientId,
      encryptedForRecipient,
      encryptedForSender,
      timestamp,
      readAt: null,
    }, messageId)
    await db.sm.acls.grant(messageId, recipientId, 'write')

    return messageId
  }

  /** Load the full conversation history, decrypted and ordered oldest→newest. */
  async loadHistory(recipientId: string): Promise<ChatMessage[]> {
    const roomId = this.getRoomId(this.userId, recipientId)
    const { results } = await db.map({ query: { type: 'dm', roomId } })
    const raw = results.map((n: any) => n.value).sort((a: any, b: any) => a.timestamp - b.timestamp)

    const out: ChatMessage[] = []
    for (const msg of raw) {
      try {
        const sent = msg.senderId === this.userId
        const text = await this.decryptMessage(sent ? msg.encryptedForSender : msg.encryptedForRecipient)
        out.push({ id: msg.id, from: msg.senderId, to: msg.recipientId, message: text, timestamp: msg.timestamp, read: !!msg.readAt, sent })
      } catch { /* skip messages from a previous keypair */ }
    }
    return out
  }

  sendTyping(recipientId: string, isTyping: boolean): void {
    this.typingChannel?.send({ from: this.userId, to: recipientId, isTyping })
  }

  async markAsRead(recipientId: string): Promise<void> {
    const roomId = this.getRoomId(this.userId, recipientId)
    const { results } = await db.map({ query: { type: 'dm', roomId, recipientId: this.userId } })
    await Promise.all(
      results
        .filter(n => !n.value.readAt)
        .map(n => db.put({ ...n.value, readAt: Date.now() }, n.value.id)),
    )
  }

  isConnected(): boolean { return this.connected }

  disconnect(): void {
    this.unsubMessages?.()
    this.unsubMessages = null
    this.connected = false
    this.onConnectionChange?.(false)
  }
}

export default ChatService
