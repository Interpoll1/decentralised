import { GunService } from './gunService';
import { EncryptionService } from './encryptionService';
import { KeyVaultService } from './keyVaultService';
import { InviteLinkService } from './inviteLinkService';
import type {
  DecryptedChatRoomMeta,
  DecryptedChatRoomMessageContent,
  StoredEncryptionKey,
} from '../types/encryption';

export interface ChatRoom {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  isEncrypted: boolean;
  encryptionHint: string;
  createdAt: number;
  memberCount: number;
}

export interface DisplayMessage {
  id: string;
  roomId: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: number;
}

export class ChatRoomService {
  private static get gun() { return GunService.getGun(); }

  /**
   * Create a new encrypted chat room.
   * @returns { room, inviteLink }
   */
  static async createRoom(
    name: string,
    description: string,
    creatorId: string,
    password?: string
  ): Promise<{ room: ChatRoom; inviteLink: string }> {
    const roomId = `room-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let aesKey: CryptoKey;
    let method: StoredEncryptionKey['method'];
    if (password) {
      aesKey = await EncryptionService.deriveKeyFromPassword(password, roomId + 'interpoll-v2');
      method = 'password';
    } else {
      aesKey = await EncryptionService.generateKey();
      method = 'invite';
    }

    const meta: DecryptedChatRoomMeta = { name, description, creatorId };
    const encryptedMeta = await EncryptionService.encrypt(JSON.stringify(meta), aesKey);
    const encryptionHint = password ? 'Password-protected' : 'Invite-only';

    const roomData = {
      id: roomId,
      isEncrypted: true,
      encryptionHint,
      encryptedMeta,
      createdAt: Date.now(),
      memberCount: 1,
      name: '🔒 Encrypted Room',
      description: 'Encrypted chat room',
    };
    await new Promise<void>((resolve, reject) => {
      this.gun.get('chatrooms').get(roomId).put(roomData, (ack: any) => {
        if (ack.err) reject(ack.err);
        else resolve();
      });
    });

    const keyBase64 = await EncryptionService.exportKey(aesKey);
    await KeyVaultService.storeKey({
      id: roomId,
      type: 'chatroom',
      key: keyBase64,
      method,
      label: name,
      joinedAt: Date.now(),
    });

    const keyBase64Url = await EncryptionService.exportKeyAsBase64Url(aesKey);
    const inviteLink = InviteLinkService.generateInviteLink(roomId, 'chatroom', keyBase64Url);

    const room: ChatRoom = {
      id: roomId,
      name,
      description,
      creatorId,
      isEncrypted: true,
      encryptionHint,
      createdAt: roomData.createdAt,
      memberCount: 1,
    };

    return { room, inviteLink };
  }

  /**
   * Join an existing encrypted chat room using a key or password.
   */
  static async joinRoom(
    roomId: string,
    keyOrPassword: string,
    method: 'invite' | 'password'
  ): Promise<ChatRoom> {
    let aesKey: CryptoKey;
    if (method === 'password') {
      aesKey = await EncryptionService.deriveKeyFromPassword(keyOrPassword, roomId + 'interpoll-v2');
    } else {
      aesKey = await EncryptionService.importKeyFromBase64Url(keyOrPassword);
    }

    const roomData = await new Promise<any>((resolve) => {
      this.gun.get('chatrooms').get(roomId).once((data: any) => resolve(data));
      setTimeout(() => resolve(null), 3000);
    });

    if (!roomData?.encryptedMeta) {
      throw new Error('Chat room not found');
    }

    let meta: DecryptedChatRoomMeta;
    try {
      meta = JSON.parse(await EncryptionService.decrypt(roomData.encryptedMeta, aesKey));
    } catch {
      throw new Error('Invalid key or password — could not decrypt room');
    }

    const keyBase64 = await EncryptionService.exportKey(aesKey);
    await KeyVaultService.storeKey({
      id: roomId,
      type: 'chatroom',
      key: keyBase64,
      method,
      label: meta.name,
      joinedAt: Date.now(),
    });

    const currentCount = Number(roomData.memberCount) || 1;
    this.gun.get('chatrooms').get(roomId).get('memberCount').put(currentCount + 1);

    return {
      id: roomId,
      name: meta.name,
      description: meta.description,
      creatorId: meta.creatorId,
      isEncrypted: true,
      encryptionHint: roomData.encryptionHint || '',
      createdAt: roomData.createdAt,
      memberCount: currentCount + 1,
    };
  }

  /**
   * Send an encrypted message to a chat room.
   */
  static async sendMessage(roomId: string, text: string, senderId: string, senderName: string): Promise<DisplayMessage> {
    const storedKey = await KeyVaultService.getKey(roomId);
    if (!storedKey) throw new Error('No encryption key for this room');

    const aesKey = await EncryptionService.importKey(storedKey.key);
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = Date.now();

    const content: DecryptedChatRoomMessageContent = { text, senderId, senderName };
    const encryptedContent = await EncryptionService.encrypt(JSON.stringify(content), aesKey);
    const authTag = await EncryptionService.generateAuthTag(aesKey, msgId, String(timestamp), senderId);

    const msgData = {
      id: msgId,
      roomId,
      senderId,
      encryptedContent,
      authTag,
      timestamp,
    };
    this.gun.get('chatrooms').get(roomId).get('messages').get(msgId).put(msgData);

    return { id: msgId, roomId, text, senderId, senderName, timestamp };
  }

  /**
   * Subscribe to messages in a chat room (live updates).
   * Automatically decrypts and verifies messages.
   * Returns an unsubscribe function.
   */
  static subscribeToMessages(
    roomId: string,
    callback: (message: DisplayMessage) => void
  ): () => void {
    const seen = new Set<string>();
    let active = true;

    const listener = this.gun.get('chatrooms').get(roomId).get('messages')
      .map()
      .on(async (data: any, key: string) => {
        if (!active || !data?.id || !data?.encryptedContent || seen.has(key)) return;
        seen.add(key);

        try {
          const storedKey = await KeyVaultService.getKey(roomId);
          if (!storedKey) return;

          const aesKey = await EncryptionService.importKey(storedKey.key);

          if (data.authTag) {
            const valid = await EncryptionService.verifyAuthTag(
              aesKey, data.authTag, data.id, String(data.timestamp), data.senderId || ''
            );
            if (!valid) return;
          }

          const content: DecryptedChatRoomMessageContent = JSON.parse(
            await EncryptionService.decrypt(data.encryptedContent, aesKey)
          );

          callback({
            id: data.id,
            roomId,
            text: content.text,
            senderId: content.senderId,
            senderName: content.senderName,
            timestamp: data.timestamp,
          });
        } catch {
          // Silently skip messages that can't be decrypted
        }
      });

    return () => {
      active = false;
      if (listener) listener.off();
    };
  }

  /**
   * List all chat rooms the user has keys for.
   */
  static async listJoinedRooms(): Promise<ChatRoom[]> {
    const keys = await KeyVaultService.listKeysByType('chatroom');
    const rooms: ChatRoom[] = [];

    for (const storedKey of keys) {
      try {
        const roomData = await new Promise<any>((resolve) => {
          this.gun.get('chatrooms').get(storedKey.id).once((data: any) => resolve(data));
          setTimeout(() => resolve(null), 2000);
        });

        if (!roomData) continue;

        let name = storedKey.label;
        let description = '';
        let creatorId = '';

        if (roomData.encryptedMeta) {
          try {
            const aesKey = await EncryptionService.importKey(storedKey.key);
            const meta: DecryptedChatRoomMeta = JSON.parse(
              await EncryptionService.decrypt(roomData.encryptedMeta, aesKey)
            );
            name = meta.name;
            description = meta.description;
            creatorId = meta.creatorId;
          } catch {
            // Use stored label as fallback
          }
        }

        rooms.push({
          id: storedKey.id,
          name,
          description,
          creatorId,
          isEncrypted: true,
          encryptionHint: roomData.encryptionHint || '',
          createdAt: roomData.createdAt || storedKey.joinedAt,
          memberCount: Number(roomData.memberCount) || 1,
        });
      } catch {
        // Skip rooms that can't be loaded
      }
    }

    return rooms.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Leave a chat room (delete stored key).
   */
  static async leaveRoom(roomId: string): Promise<void> {
    await KeyVaultService.removeKey(roomId);
  }
}
