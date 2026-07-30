import { describe, it, expect, vi } from 'vitest';

// Comments and chat messages need a durable home: Gun runs with
// `localStorage:false` and `radisk:false`, so without these stores the only copy
// of a comment or message is a volatile in-memory graph the memory watchdog is
// free to evict. Exercised through the in-memory fallback, which mirrors the
// IndexedDB behaviour (see storageFallback.test.ts).
vi.mock('idb', () => ({
  openDB: vi.fn(async () => { throw new Error('IndexedDB disabled'); }),
}));

import { StorageService } from '../src/services/storageService';
import type { StoredComment, StoredChatMessage } from '../src/types/social';

function comment(id: string, postId: string, patch: Partial<StoredComment> = {}): StoredComment {
  return {
    id, postId,
    communityId: 'c1',
    authorId: 'author-1',
    authorName: 'anon',
    content: `body of ${id}`,
    createdAt: 1_000,
    upvotes: 0, downvotes: 0, score: 0,
    syncStatus: 'pending',
    syncAttempts: 0,
    authoredLocally: false,
    updatedAt: 1_000,
    ...patch,
  };
}

function message(id: string, roomId: string, patch: Partial<StoredChatMessage> = {}): StoredChatMessage {
  return {
    id, roomId,
    kind: 'dm',
    senderId: 'alice',
    recipientId: 'bob',
    text: `text of ${id}`,
    timestamp: 1_000,
    seq: 1,
    outgoing: true,
    syncStatus: 'pending',
    syncAttempts: 0,
    ...patch,
  };
}

describe('StorageService — comment mirror', () => {
  it('saves and reads a comment back by id', async () => {
    await StorageService.saveComment(comment('cm-1', 'post-1'));
    expect(await StorageService.getComment('cm-1')).toMatchObject({ id: 'cm-1', content: 'body of cm-1' });
  });

  it('the by-post index returns only that post’s comments', async () => {
    await StorageService.saveComments([
      comment('cm-a', 'post-A'),
      comment('cm-b', 'post-B'),
      comment('cm-c', 'post-A'),
    ]);
    const forA = await StorageService.getCommentsByPost('post-A');
    expect(forA.map(c => c.id).sort()).toEqual(['cm-a', 'cm-c']);
  });

  it('re-saving the same id updates in place rather than duplicating', async () => {
    await StorageService.saveComment(comment('cm-dup', 'post-D'));
    await StorageService.saveComment(comment('cm-dup', 'post-D', { content: 'edited', syncStatus: 'confirmed' }));

    const rows = await StorageService.getCommentsByPost('post-D');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ content: 'edited', syncStatus: 'confirmed' });
  });

  it('deleteComment removes it', async () => {
    await StorageService.saveComment(comment('cm-del', 'post-X'));
    await StorageService.deleteComment('cm-del');
    expect(await StorageService.getComment('cm-del')).toBeUndefined();
  });

  it('pruning never discards a comment this device authored and has not synced', async () => {
    await StorageService.saveComments([
      comment('cm-mine', 'post-P', { authoredLocally: true, syncStatus: 'pending', createdAt: 1 }),
      ...Array.from({ length: 12 }, (_, i) =>
        comment(`cm-remote-${i}`, 'post-P', { createdAt: 100 + i, syncStatus: 'confirmed' })),
    ]);

    await StorageService.pruneComments(5);

    // The locally-authored row survives — losing it would lose the only copy.
    expect(await StorageService.getComment('cm-mine')).toMatchObject({ id: 'cm-mine' });
  });
});

describe('StorageService — chat message mirror', () => {
  it('saves and reads a message back by id', async () => {
    await StorageService.saveChatMessage(message('m-1', 'alice:bob'));
    expect(await StorageService.getChatMessage('m-1')).toMatchObject({ id: 'm-1', text: 'text of m-1' });
  });

  it('the by-room index isolates conversations', async () => {
    await StorageService.saveChatMessages([
      message('m-a', 'alice:frank'),
      message('m-b', 'alice:carol'),
      message('m-c', 'alice:frank'),
    ]);
    const room = await StorageService.getChatMessagesByRoom('alice:frank');
    expect(room.map(m => m.id).sort()).toEqual(['m-a', 'm-c']);
  });

  it('status updates overwrite the same row', async () => {
    await StorageService.saveChatMessage(message('m-status', 'alice:grace'));
    const stored = await StorageService.getChatMessage('m-status');
    await StorageService.saveChatMessage({ ...stored!, syncStatus: 'confirmed', syncAttempts: 2 });

    const rows = await StorageService.getChatMessagesByRoom('alice:grace');
    expect(rows.filter(m => m.id === 'm-status')).toHaveLength(1);
    expect(await StorageService.getChatMessage('m-status')).toMatchObject({
      syncStatus: 'confirmed', syncAttempts: 2,
    });
  });

  it('pruning keeps outgoing messages that have not been delivered', async () => {
    const roomId = 'alice:dave';
    await StorageService.saveChatMessages([
      message('m-unsent', roomId, { syncStatus: 'pending', outgoing: true, timestamp: 1 }),
      ...Array.from({ length: 10 }, (_, i) =>
        message(`m-old-${i}`, roomId, { syncStatus: 'confirmed', outgoing: false, timestamp: 100 + i })),
    ]);

    await StorageService.pruneChatMessages(4);

    expect(await StorageService.getChatMessage('m-unsent')).toMatchObject({ id: 'm-unsent' });
  });

  it('deleteChatMessage removes it', async () => {
    await StorageService.saveChatMessage(message('m-del', 'alice:erin'));
    await StorageService.deleteChatMessage('m-del');
    expect(await StorageService.getChatMessage('m-del')).toBeUndefined();
  });
});
