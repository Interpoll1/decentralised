import type { StoredChatMessage } from '../types/social';

export interface RoomPreview {
  unread: number;
  lastMessage: string;
  lastMessageTime: number;
}

/**
 * Summarise a room for the conversation list. Rows that never render in the
 * thread (cleared/corrupted, empty, delivery-receipt control frames) must not
 * become the preview, or the list shows a blank "You:" after "Delete all".
 * Returns null when nothing visible is left.
 */
export function summarizeRoom(rows: StoredChatMessage[]): RoomPreview | null {
  const visible = rows.filter(r => (r.syncStatus as string) !== 'corrupted' && !!r.text && !r.control);
  if (visible.length === 0) return null;
  const latest = visible.reduce((n, r) => (r.timestamp > n.timestamp ? r : n));
  const body = latest.text.length > 80 ? `${latest.text.slice(0, 79)}…` : latest.text;
  return {
    unread: visible.filter(r => !r.outgoing && !r.readAt).length,
    lastMessage: latest.outgoing ? `You: ${body}` : body,
    lastMessageTime: latest.timestamp,
  };
}
