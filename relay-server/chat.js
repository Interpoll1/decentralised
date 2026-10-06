// chat.js — P2P chat storage and retrieval
import { db, queryMySQL } from './db.js';
import crypto from 'crypto';

export function getChatRoomId(u1, u2) { return [u1, u2].sort().join(':'); }

export async function storeChatMessage(roomId, senderId, recipientId, encryptedContent, clientMessageId) {
  if (!db) return;
  if (!encryptedContent) return; // column is NOT NULL — skip unencrypted messages
  // Large files go through /api/chat-media; the Signal payload is only a small
  // JSON envelope. Reject anything suspiciously large at the DB layer.
  if (encryptedContent.length > 131072) {
    console.warn(`[chat] Rejected oversized message from ${senderId} (${encryptedContent.length} bytes)`);
    return;
  }
  // Use the client-supplied messageId so that Gun (which keys by client id), the WS
  // delivery frame, the server DB row, and the receiver's IDB row all share the same id.
  // Without this, the server generates a new id, the receiver stores it under that id,
  // then Gun re-delivers the same message under the original client id — which the receiver
  // doesn't recognise as a duplicate — causing a double entry on every refresh.
  const messageId = (clientMessageId && /^[\w\-]{8,128}$/.test(clientMessageId))
    ? clientMessageId
    : `msg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    await db.execute(
      `INSERT IGNORE INTO chat_messages (id, room_id, sender_id, recipient_id, encrypted_content, timestamp) VALUES (?, ?, ?, ?, ?, ?)`,
      [messageId, roomId, senderId, recipientId, encryptedContent, Date.now()]
    );
    return messageId;
  } catch (err) { console.error('❌ Chat storage error:', err.message); }
}

export async function getChatHistory(roomId, limit = 50) {
  if (!db) return [];
  try {
    const messages = await queryMySQL(
      `SELECT id, sender_id, recipient_id, encrypted_content, timestamp, read_at FROM chat_messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [roomId, limit]
    );
    return (messages || []).reverse();
  } catch { return []; }
}

// Fetch all unread messages addressed to a given userId, across all rooms.
// Used to flush pending offline messages when the recipient reconnects.
// Rows that have already been delivered (delivered_at IS NOT NULL) are excluded —
// they are still waiting for a chat-read DELETE but have already been sent to the
// client once; re-delivering them on every reconnect before chat-read arrives is
// the source of the "double message on refresh" bug on the server side.
export async function getPendingMessagesForUser(recipientId, limit = 200) {
  if (!db) return [];
  try {
    const messages = await queryMySQL(
      `SELECT id, room_id, sender_id, recipient_id, encrypted_content, timestamp
       FROM chat_messages
       WHERE recipient_id = ? AND read_at IS NULL AND delivered_at IS NULL
       ORDER BY timestamp ASC
       LIMIT ?`,
      [recipientId, limit]
    );
    return messages || [];
  } catch (err) {
    console.error('❌ getPendingMessagesForUser error:', err.message);
    return [];
  }
}

// Mark a batch of message rows as delivered (sent to the recipient's WS connection).
// Called immediately after the relay replays offline messages on reconnect.
// This prevents the rows from being re-delivered on subsequent reconnects before
// the client has a chance to send a chat-read frame that would DELETE them.
export async function markMessagesDelivered(messageIds) {
  if (!db || !messageIds?.length) return;
  try {
    const placeholders = messageIds.map(() => '?').join(',');
    await db.execute(
      `UPDATE chat_messages SET delivered_at = ? WHERE id IN (${placeholders})`,
      [Date.now(), ...messageIds]
    );
  } catch (err) {
    console.error('❌ markMessagesDelivered error:', err.message);
  }
}

// Messages are ephemeral on the server — delete them once the recipient has
// collected them. Anything still unread after 30 days is purged by the relay's
// hourly cleanup job (relay-server-enhanced.js).
export async function markMessagesAsRead(roomId, userId) {
  if (!db) return;
  try {
    await db.execute(
      `DELETE FROM chat_messages WHERE room_id = ? AND recipient_id = ? AND read_at IS NULL`,
      [roomId, userId]
    );
  } catch (err) { console.error('❌ Mark read error:', err.message); }
}