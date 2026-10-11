import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const h = vi.hoisted(() => ({
  sub: null as null | ((s: any) => void),
  supported: true,
  svc: {} as any,
}));
vi.mock('@/services/callService', () => {
  h.svc = {
    init: vi.fn(),
    subscribe: vi.fn((cb: any) => { h.sub = cb; return () => {}; }),
    getSnapshot: () => ({ state: 'idle', callId: '', peer: '', video: false, muted: false, cameraOff: false, localStream: null, remoteStream: null }),
    isSupported: () => h.supported,
    start: vi.fn(async () => {}), accept: vi.fn(async () => {}), decline: vi.fn(), end: vi.fn(),
    toggleMute: vi.fn(), toggleCamera: vi.fn(),
    onCallLogged: null, allowIncoming: () => true,
  };
  return { CallService: h.svc };
});
vi.mock('@/services/signalingService', () => ({ SignalingService: { getMyPubkey: () => 'me' } }));
vi.mock('@/services/storageService', () => ({ StorageService: { getMetadata: vi.fn(async () => null) } }));

import { useCallStore } from '@/stores/callStore';

beforeEach(() => { setActivePinia(createPinia()); h.supported = true; });

describe('callStore', () => {
  it('mirrors CallService snapshots and derives flags', () => {
    const s = useCallStore();
    expect(h.svc.init).toHaveBeenCalled();
    h.sub!({ ...h.svc.getSnapshot(), state: 'incoming-ringing', peer: 'p' });
    expect(s.snapshot.state).toBe('incoming-ringing');
    expect(s.isRinging).toBe(true);
    expect(s.isActive).toBe(true);
    h.sub!({ ...h.svc.getSnapshot(), state: 'ended' });
    expect(s.isActive).toBe(false);
  });

  it('actions delegate to CallService', async () => {
    const s = useCallStore();
    await s.start('p', true);
    expect(h.svc.start).toHaveBeenCalledWith('p', { video: true });
    await s.accept(); s.decline(); s.end(); s.toggleMute(); s.toggleCamera();
    for (const k of ['accept', 'decline', 'end', 'toggleMute', 'toggleCamera']) expect(h.svc[k]).toHaveBeenCalled();
  });

  it('supported reflects CallService.isSupported', () => {
    h.supported = false;
    expect(useCallStore().supported).toBe(false);
  });

  it('only known peers may ring; logged calls land in history', () => {
    const s = useCallStore();
    expect(h.svc.allowIncoming('stranger')).toBe(false);
    s.markKnown('friend');
    expect(h.svc.allowIncoming('friend')).toBe(true);
    h.svc.onCallLogged({ peer: 'friend', kind: 'missed', durationMs: 0, video: false, outgoing: false });
    expect(s.historyFor('friend')[0]).toMatchObject({ kind: 'missed' });
    expect(s.historyFor('other')).toHaveLength(0);
  });
});
