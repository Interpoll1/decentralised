import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotSyncService } from '../src/services/snapshotSyncService';

const subscribeMock = vi.fn();
const broadcastMock = vi.fn(async () => {});
const getPeerIdMock = vi.fn(() => 'local-peer');

vi.mock('../src/services/websocketService', () => ({
  WebSocketService: {
    subscribe: subscribeMock,
    broadcast: broadcastMock,
    getPeerId: getPeerIdMock,
  },
}));

function makeSnapshot() {
  return {
    version: '2.0',
    exportDate: Date.now(),
    meta: {
      postCount: 3,
      communityCount: 2,
      blockHeight: 9,
    },
    chain: {
      blocks: [],
    },
    gun: {
      posts: [],
      communities: [],
      comments: [],
      users: [],
      events: [],
    },
  };
}

beforeEach(() => {
  subscribeMock.mockClear();
  broadcastMock.mockClear();
  getPeerIdMock.mockClear();

  const service = SnapshotSyncService as any;
  service.transfer = null;
  service.serializedData = '';
  service.pendingOffers.clear();
  service.onOfferCallbacks.clear();
  service.onProgressCallbacks.clear();
  service.onCompleteCallbacks.clear();
  service.onErrorCallbacks.clear();
  service.initialized = false;
});

describe('SnapshotSyncService', () => {
  it('auto-initializes when offering a snapshot', async () => {
    await SnapshotSyncService.offerSnapshot(makeSnapshot() as any);

    expect(subscribeMock).toHaveBeenCalledTimes(5);
    expect(broadcastMock).toHaveBeenCalledWith(
      'snapshot-offer',
      expect.objectContaining({
        peerId: 'local-peer',
        size: expect.any(Number),
        hash: expect.any(String),
        meta: {
          postCount: 3,
          communityCount: 2,
          blockHeight: 9,
        },
      }),
    );
  });

  it('cleanup does not cause duplicate websocket subscriptions', async () => {
    await SnapshotSyncService.initialize();
    expect(subscribeMock).toHaveBeenCalledTimes(5);

    SnapshotSyncService.cleanup();
    await SnapshotSyncService.initialize();

    expect(subscribeMock).toHaveBeenCalledTimes(5);
  });
});
