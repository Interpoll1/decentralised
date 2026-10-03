import { describe, it, expect } from 'vitest';
import { summarizeRoom } from '../src/utils/chatPreview';

const row = (o: Record<string, unknown>) => ({
  id: 'm', roomId: 'a:b', kind: 'dm', senderId: 'a', recipientId: 'b', text: 'hi',
  timestamp: 1, seq: 0, outgoing: true, syncStatus: 'pending', syncAttempts: 0, ...o,
}) as any;

describe('summarizeRoom', () => {
  it('uses the latest visible message with a "You:" prefix for outgoing', () => {
    expect(summarizeRoom([row({ text: 'Hey', timestamp: 1 }), row({ text: 'Hola', timestamp: 2 })]))
      .toMatchObject({ lastMessage: 'You: Hola', lastMessageTime: 2 });
  });

  it('ignores blanked (Delete all) rows instead of showing an empty "You:"', () => {
    const rows = [row({ text: 'Hey', timestamp: 1 }), row({ text: '', syncStatus: 'corrupted', timestamp: 5 })];
    expect(summarizeRoom(rows)?.lastMessage).toBe('You: Hey');
  });

  it('ignores delivery-receipt control rows', () => {
    const rows = [row({ text: 'yo', outgoing: false, timestamp: 1 }), row({ text: 'dm-receipt', control: 'delivery-receipt-v1', timestamp: 9 })];
    expect(summarizeRoom(rows)).toMatchObject({ lastMessage: 'yo', unread: 1 });
  });

  it('returns null when everything was cleared', () => {
    expect(summarizeRoom([row({ text: '', syncStatus: 'corrupted' })])).toBeNull();
  });
});
