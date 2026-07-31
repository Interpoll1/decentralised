import { beforeEach, describe, expect, it, vi } from 'vitest';

const { snapshotSvc, storage } = vi.hoisted(() => ({
  snapshotSvc: {
    export: vi.fn(async () => ({ meta: { blockHeight: 1, postCount: 0, commentCount: 0, communityCount: 0, userCount: 0 } })),
    import: vi.fn(async () => ({})),
  },
  storage: {
    setMetadata: vi.fn(async () => {}),
    getMetadata: vi.fn(async () => null as unknown),
  },
}));

vi.mock('@/services/snapshotService', () => ({ SnapshotService: snapshotSvc }));
vi.mock('@/services/storageService', () => ({ StorageService: storage }));

import { SnapshotAutoService } from '@/services/snapshotAutoService';

beforeEach(() => {
  vi.clearAllMocks();
  (SnapshotAutoService as any).lastSignature = '';
  (SnapshotAutoService as any).saving = false;
});

describe('SnapshotAutoService.save', () => {
  it('exports and persists the snapshot to metadata', async () => {
    await SnapshotAutoService.save();
    expect(snapshotSvc.export).toHaveBeenCalledTimes(1);
    expect(storage.setMetadata).toHaveBeenCalledWith('last-snapshot', expect.objectContaining({ meta: expect.any(Object) }));
  });

  it('skips persisting when nothing material changed', async () => {
    await SnapshotAutoService.save();               // writes
    await SnapshotAutoService.save();               // same meta → skipped
    expect(storage.setMetadata).toHaveBeenCalledTimes(1);
  });

  it('persists again when the snapshot changes', async () => {
    await SnapshotAutoService.save();
    snapshotSvc.export.mockResolvedValueOnce({ meta: { blockHeight: 2, postCount: 3, commentCount: 0, communityCount: 0, userCount: 0 } } as any);
    await SnapshotAutoService.save();
    expect(storage.setMetadata).toHaveBeenCalledTimes(2);
  });
});

describe('SnapshotAutoService.restore', () => {
  it('imports a stored snapshot and reports success', async () => {
    storage.getMetadata.mockResolvedValueOnce({ meta: { blockHeight: 5 }, chain: {}, gun: {} });
    const ok = await SnapshotAutoService.restore();
    expect(ok).toBe(true);
    expect(snapshotSvc.import).toHaveBeenCalledTimes(1);
  });

  it('returns false when no snapshot exists', async () => {
    storage.getMetadata.mockResolvedValueOnce(null);
    const ok = await SnapshotAutoService.restore();
    expect(ok).toBe(false);
    expect(snapshotSvc.import).not.toHaveBeenCalled();
  });
});
