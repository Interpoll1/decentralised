// src/types/encryption.ts

/** Base64-encoded AES-256-GCM encrypted payload (IV prepended to ciphertext) */
export type EncryptedBlob = string;

/** Stored in IndexedDB encryption-keys object store */
export interface StoredEncryptionKey {
  id: string;                // communityId or chatRoomId
  type: 'community' | 'chatroom' | 'server';
  key: string;               // base64-encoded raw AES-256 key
  method: 'invite' | 'password';
  label: string;             // human-readable name (decrypted community/room name)
  joinedAt: number;          // timestamp when key was stored
}

/** Parsed from an invite link URL fragment */
export interface InviteLinkData {
  id: string;                // communityId or chatRoomId
  type: 'community' | 'chatroom' | 'server';
  key: string;               // base64url-encoded AES-256 key
}

/** Community with encryption enabled */
export interface EncryptedCommunityData {
  id: string;
  isEncrypted: true;
  encryptionHint: string;    // "Password-protected" | "Invite-only" (visible to non-members)
  encryptedMeta: EncryptedBlob;  // AES-GCM encrypted: { name, displayName, description, rules[] }
  creatorId: string;
  createdAt: number;
  memberCount: number;
  postCount?: number;
}

/** Decrypted community metadata (inside encryptedMeta) */
export interface DecryptedCommunityMeta {
  name: string;
  displayName: string;
  description: string;
  rules: string[];
}

/** Encrypted chat room stored in GunDB */
export interface EncryptedChatRoom {
  id: string;
  isEncrypted: true;
  encryptionHint: string;
  encryptedMeta: EncryptedBlob;  // AES-GCM encrypted: { name, description, creatorId }
  createdAt: number;
  memberCount: number;
}

/** Decrypted chat room metadata */
export interface DecryptedChatRoomMeta {
  name: string;
  description: string;
  creatorId: string;
}

/** Chat room message stored in GunDB */
export interface ChatRoomMessage {
  id: string;
  roomId: string;
  encryptedContent: EncryptedBlob;  // AES-GCM encrypted: { text, senderId, senderName }
  authTag: string;                  // HMAC-SHA256 for anti-sabotage verification
  timestamp: number;
}

/** Decrypted chat room message content */
export interface DecryptedChatRoomMessageContent {
  text: string;
  senderId: string;
  senderName: string;
}

/** Content signature fields added to posts/comments for anti-sabotage */
export interface ContentSignature {
  authorPubkey: string;      // x-only Schnorr public key (64 hex chars)
  contentSignature: string;  // Schnorr signature (128 hex chars)
}

/** Encrypted post data stored in GunDB */
export interface EncryptedPostData {
  id: string;
  communityId: string;
  isEncrypted: true;
  encryptedContent: EncryptedBlob;  // AES-GCM encrypted: post fields
  authTag: string;                  // HMAC-SHA256 anti-sabotage
  timestamp: number;
}

/** Server-wide encryption configuration */
export interface ServerEncryptionConfig {
  encryptAll: boolean;
  serverPassword?: string;        // Used to derive server-wide AES key via PBKDF2
  requireInviteToJoin: boolean;
}
