// src/services/chatRoomService.ts — encrypted group chat rooms (zero-trust transport).
//
// Group rooms use a shared AES key (per-room, distributed via invite link or
// password) which GenosDB's per-user SM encryption does not cover, so the
// EncryptionService + KeyVaultService crypto layer is kept as-is. Only the
// transport changes: Gun nodes → GenosDB nodes, with a single reactive
// db.map subscription replacing the once()/map().on() machinery.
import { db } from './gdbServices'
import { EncryptionService } from './encryptionService'
import { KeyVaultService } from './keyVaultService'
import { InviteLinkService } from './inviteLinkService'
import type {
  DecryptedChatRoomMeta,
  DecryptedChatRoomMessageContent,
  StoredEncryptionKey,
} from '../types/encryption'

export interface ChatRoom {
  id: string
  name: string
  description: string
  creatorId: string
  isEncrypted: boolean
  encryptionHint: string
  createdAt: number
  memberCount: number
}

export interface DisplayMessage {
  id: string
  roomId: string
  text: string
  senderId: string
  senderName: string
  timestamp: number
}

export class ChatRoomService {
  static async createRoom(
    name: string,
    description: string,
    creatorId: string,
    password?: string,
  ): Promise<{ room: ChatRoom; inviteLink: string }> {
    const roomId = `room-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

    let aesKey: CryptoKey
    let method: StoredEncryptionKey['method']
    if (password) {
      aesKey = await EncryptionService.deriveKeyFromPassword(password, roomId + 'interpoll-v2')
      method = 'password'
    } else {
      aesKey = await EncryptionService.generateKey()
      method = 'invite'
    }

    const meta: DecryptedChatRoomMeta = { name, description, creatorId }
    const encryptedMeta = await EncryptionService.encrypt(JSON.stringify(meta), aesKey)
    const encryptionHint = password ? 'Password-protected' : 'Invite-only'
    const createdAt = Date.now()

    // ACL-owned by the creator; only they can edit the room node. Membership is
    // modelled as signed `roomMember` nodes (like community memberships), so the
    // member count is derived — no peer mutates a shared counter.
    await db.sm.acls.set({
      type: 'chatRoom',
      id: roomId,
      isEncrypted: true,
      encryptionHint,
      encryptedMeta,
      createdAt,
    }, roomId)
    await db.sm.acls.set({ type: 'roomMember', roomId, member: creatorId, joinedAt: createdAt }, `roomMember:${roomId}:${creatorId}`)

    const keyBase64 = await EncryptionService.exportKey(aesKey)
    await KeyVaultService.storeKey({ id: roomId, type: 'chatroom', key: keyBase64, method, label: name, joinedAt: Date.now() })

    const keyBase64Url = await EncryptionService.exportKeyAsBase64Url(aesKey)
    const inviteLink = InviteLinkService.generateInviteLink(roomId, 'chatroom', keyBase64Url)

    return {
      room: { id: roomId, name, description, creatorId, isEncrypted: true, encryptionHint, createdAt, memberCount: 1 },
      inviteLink,
    }
  }

  static async joinRoom(roomId: string, keyOrPassword: string, method: 'invite' | 'password'): Promise<ChatRoom> {
    const aesKey = method === 'password'
      ? await EncryptionService.deriveKeyFromPassword(keyOrPassword, roomId + 'interpoll-v2')
      : await EncryptionService.importKeyFromBase64Url(keyOrPassword)

    const { result } = await db.get(roomId)
    const roomData = result?.value
    if (!roomData?.encryptedMeta) throw new Error('Chat room not found')

    let meta: DecryptedChatRoomMeta
    try {
      meta = JSON.parse(await EncryptionService.decrypt(roomData.encryptedMeta, aesKey))
    } catch {
      throw new Error('Invalid key or password — could not decrypt room')
    }

    const keyBase64 = await EncryptionService.exportKey(aesKey)
    await KeyVaultService.storeKey({ id: roomId, type: 'chatroom', key: keyBase64, method, label: meta.name, joinedAt: Date.now() })

    // Join = a signed roomMember node owned by the joiner; the room node (the
    // creator's) stays untouched. Member count is derived from these nodes.
    const me = db.sm.getActiveEthAddress()
    if (me) await db.sm.acls.set({ type: 'roomMember', roomId, member: me, joinedAt: Date.now() }, `roomMember:${roomId}:${me}`)
    const memberCount = await this.countRoomMembers(roomId)

    return {
      id: roomId,
      name: meta.name,
      description: meta.description,
      creatorId: meta.creatorId,
      isEncrypted: true,
      encryptionHint: roomData.encryptionHint || '',
      createdAt: roomData.createdAt,
      memberCount,
    }
  }

  static async sendMessage(roomId: string, text: string, senderId: string, senderName: string): Promise<DisplayMessage> {
    const storedKey = await KeyVaultService.getKey(roomId)
    if (!storedKey) throw new Error('No encryption key for this room')

    const aesKey = await EncryptionService.importKey(storedKey.key)
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
    const timestamp = Date.now()

    const content: DecryptedChatRoomMessageContent = { text, senderId, senderName }
    const encryptedContent = await EncryptionService.encrypt(JSON.stringify(content), aesKey)
    const authTag = await EncryptionService.generateAuthTag(aesKey, msgId, String(timestamp), senderId)

    // ACL-owned by the sender; no other peer can delete or overwrite a room message.
    await db.sm.acls.set({ type: 'chatMessage', id: msgId, roomId, senderId, encryptedContent, authTag, timestamp }, msgId)
    return { id: msgId, roomId, text, senderId, senderName, timestamp }
  }

  /** Live, auto-decrypting subscription to a room's messages. */
  static subscribeToMessages(roomId: string, callback: (message: DisplayMessage) => void): () => void {
    let active = true
    let unsub: (() => void) | undefined

    const handle = async ({ value, action }: { value: any; action: string }) => {
      if (!active || action === 'removed' || !value?.encryptedContent) return
      try {
        const storedKey = await KeyVaultService.getKey(roomId)
        if (!storedKey) return
        const aesKey = await EncryptionService.importKey(storedKey.key)
        if (value.authTag) {
          const valid = await EncryptionService.verifyAuthTag(aesKey, value.authTag, value.id, String(value.timestamp), value.senderId || '')
          if (!valid) return
        }
        const content: DecryptedChatRoomMessageContent = JSON.parse(await EncryptionService.decrypt(value.encryptedContent, aesKey))
        if (active) callback({ id: value.id, roomId, text: content.text, senderId: content.senderId, senderName: content.senderName, timestamp: value.timestamp })
      } catch {
        // Skip messages that cannot be decrypted/verified.
      }
    }

    void (async () => {
      const { unsubscribe } = await db.map({ query: { type: 'chatMessage', roomId } }, handle)
      unsub = unsubscribe
    })()

    return () => { active = false; unsub?.() }
  }

  static async listJoinedRooms(): Promise<ChatRoom[]> {
    const keys = await KeyVaultService.listKeysByType('chatroom')
    const rooms: ChatRoom[] = []

    for (const storedKey of keys) {
      const { result } = await db.get(storedKey.id)
      const roomData = result?.value
      if (!roomData) continue

      let name = storedKey.label
      let description = ''
      let creatorId = ''
      if (roomData.encryptedMeta) {
        try {
          const aesKey = await EncryptionService.importKey(storedKey.key)
          const meta: DecryptedChatRoomMeta = JSON.parse(await EncryptionService.decrypt(roomData.encryptedMeta, aesKey))
          name = meta.name; description = meta.description; creatorId = meta.creatorId
        } catch { /* fall back to stored label */ }
      }

      const memberCount = await this.countRoomMembers(storedKey.id)
      rooms.push({
        id: storedKey.id,
        name,
        description,
        creatorId,
        isEncrypted: true,
        encryptionHint: roomData.encryptionHint || '',
        createdAt: roomData.createdAt || storedKey.joinedAt,
        memberCount,
      })
    }

    return rooms.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Derive a room's member count from its signed roomMember nodes. */
  private static async countRoomMembers(roomId: string): Promise<number> {
    const { results } = await db.map({ query: { type: 'roomMember', roomId } })
    return results.length || 1
  }

  static async leaveRoom(roomId: string): Promise<void> {
    const me = db.sm.getActiveEthAddress()
    if (me) await db.sm.acls.delete(`roomMember:${roomId}:${me}`).catch(() => {})
    await KeyVaultService.removeKey(roomId)
  }
}
