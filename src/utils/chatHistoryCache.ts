import type { ChatMessage } from '../services/chatService';

/**
 * In-memory "last seen" messages per conversation. Shared across ChatView instances so reopening a chat
 * (or switching conversations in the desktop pane) paints instantly while storage/relay catch up.
 * Never persisted: it is a speed-up, not a store.
 */
const MAX_CHATS = 20, MAX_MESSAGES = 200;
const cache = new Map<string, ChatMessage[]>();

export function readHistory(key: string): ChatMessage[] | undefined { return cache.get(key); }

export function stashHistory(key: string, messages: ChatMessage[]): void {
  if (!messages.length) return;
  cache.delete(key);                                           // re-insert → most recently used last
  cache.set(key, messages.slice(-MAX_MESSAGES)
    .filter(m => !m.id.startsWith('upload-'))
    // blob: URLs belong to a view that is going away; the real history re-creates them
    .map(m => (m.mediaUrl?.startsWith('blob:') ? { ...m, mediaUrl: undefined } : m) as ChatMessage));
  while (cache.size > MAX_CHATS) cache.delete(cache.keys().next().value as string);
}
