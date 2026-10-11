import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  sent: [] as Array<{ t: any; k: string; p: any }>,
  cb: null as null | ((s: any) => void),
  ice: [{ urls: 'stun:x' }] as any[],
  sendOk: true,
}));
const ME = 'm'.repeat(64);
vi.mock('@/services/signalingService', () => ({
  SignalingService: {
    sendSignal: vi.fn(async (t: any, k: string, p: any) => { h.sent.push({ t, k, p }); return h.sendOk; }),
    onCallSignal: (cb: any) => { h.cb = cb; return () => {}; },
    getMyPubkey: () => 'm'.repeat(64),
  },
}));
vi.mock('@/config', () => ({ default: { getIceServers: () => h.ice, getTurnServers: async () => [] } }));

import { CallService } from '@/services/callService';

function fakeStream() {
  const tracks = [{ kind: 'audio', enabled: true, stop: vi.fn() }, { kind: 'video', enabled: true, stop: vi.fn() }];
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter(t => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter(t => t.kind === 'video'),
  };
}
class FakePC {
  static last: FakePC | null = null;
  remoteDescription: any = null; iceConnectionState = 'new';
  onicecandidate: any; ontrack: any; oniceconnectionstatechange: any;
  close = vi.fn(); addTrack = vi.fn(); addIceCandidate = vi.fn(async () => {});
  constructor() { FakePC.last = this; }
  async createOffer() { return { type: 'offer', sdp: 'o' }; }
  async createAnswer() { return { type: 'answer', sdp: 'a' }; }
  async setLocalDescription() {}
  async setRemoteDescription(d: any) { this.remoteDescription = d; }
}

let gum: ReturnType<typeof vi.fn>;
let stream: ReturnType<typeof fakeStream>;
const P = 'p'.repeat(64);
const A = 'a'.repeat(64); // lower than ME
const Z = 'z'.repeat(64); // higher than ME
const kinds = () => h.sent.map(s => s.k);
const inbound = (kind: string, from: string, callId: string, meta: any = {}) =>
  h.cb!({ kind, remoteId: from, remotePubkey: from, reply: { pubkey: from }, callId, meta });

beforeEach(() => {
  vi.useFakeTimers();
  h.sent.length = 0; h.ice = [{ urls: 'stun:x' }]; h.sendOk = true;
  stream = fakeStream();
  gum = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: gum } });
  vi.stubGlobal('RTCPeerConnection', FakePC);
  (CallService as any).resetForTests();
  CallService.init();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('CallService', () => {
  it('start sends invite with 32-hex callId; 30 s no answer → no-answer + call-end', async () => {
    await CallService.start(P, { video: true });
    const inv = h.sent.find(s => s.k === 'call-invite')!;
    expect(inv.p.callId).toMatch(/^[0-9a-f]{32}$/);
    expect(inv.p.meta).toEqual({ video: true });
    expect(CallService.getSnapshot().state).toBe('outgoing-ringing');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(CallService.getSnapshot()).toMatchObject({ state: 'ended', endReason: 'no-answer' });
    expect(kinds()).toContain('call-end');
  });

  it('invite while busy → call-decline busy, snapshot unchanged', async () => {
    await CallService.start(P, { video: false });
    const before = CallService.getSnapshot();
    inbound('call-invite', Z, 'e'.repeat(32), { video: false });
    await vi.advanceTimersByTimeAsync(0);
    const dec = h.sent.find(s => s.k === 'call-decline')!;
    expect(dec.p.meta).toEqual({ reason: 'busy' });
    expect(dec.p.callId).toBe('e'.repeat(32));
    expect(CallService.getSnapshot().callId).toBe(before.callId);
  });

  it('Anonymity Mode (no ICE servers) → decline unsupported, no ring', async () => {
    h.ice = [];
    inbound('call-invite', P, 'e'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent.find(s => s.k === 'call-decline')!.p.meta).toEqual({ reason: 'unsupported' });
    expect(CallService.getSnapshot().state).toBe('idle');
  });

  it('4th invite from the same sender within 60 s is dropped silently', async () => {
    for (let i = 0; i < 3; i++) {
      inbound('call-invite', P, String(i).repeat(32));
      await vi.advanceTimersByTimeAsync(0);
      CallService.decline();
      await vi.advanceTimersByTimeAsync(3_000); // reset to idle
    }
    h.sent.length = 0;
    inbound('call-invite', P, '9'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(CallService.getSnapshot().state).toBe('idle');
    expect(h.sent).toHaveLength(0);
  });

  it('glare: peer wins → abort ours and ring for theirs', async () => {
    await CallService.start(A, { video: false });
    const mine = CallService.getSnapshot().callId;
    inbound('call-invite', A, 'e'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent.some(s => s.k === 'call-end' && s.p.callId === mine)).toBe(true);
    expect(CallService.getSnapshot()).toMatchObject({ state: 'incoming-ringing', callId: 'e'.repeat(32) });
  });

  it('glare: we win → ignore theirs', async () => {
    await CallService.start(Z, { video: false });
    const mine = CallService.getSnapshot().callId;
    inbound('call-invite', Z, 'e'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(CallService.getSnapshot()).toMatchObject({ state: 'outgoing-ringing', callId: mine });
    expect(kinds()).not.toContain('call-end');
  });

  it('getUserMedia rejects → ended/permission, no invite sent', async () => {
    gum.mockRejectedValueOnce(new Error('NotAllowedError'));
    await CallService.start(P, { video: true });
    expect(CallService.getSnapshot()).toMatchObject({ state: 'ended', endReason: 'permission' });
    expect(kinds()).not.toContain('call-invite');
  });

  it('accept: getUserMedia rejects → call-end sent, tracks of nothing left running', async () => {
    inbound('call-invite', P, 'e'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    gum.mockRejectedValueOnce(new Error('NotFoundError'));
    await CallService.accept();
    expect(CallService.getSnapshot()).toMatchObject({ state: 'ended', endReason: 'permission' });
    expect(kinds()).toContain('call-end');
  });

  it('ignores signals for a different callId', async () => {
    await CallService.start(P, { video: false });
    inbound('call-accept', P, 'f'.repeat(32));
    await vi.advanceTimersByTimeAsync(0);
    expect(CallService.getSnapshot().state).toBe('outgoing-ringing');
  });

  it('full outgoing call; end() stops tracks, closes pc, logs once', async () => {
    const log = vi.fn();
    CallService.onCallLogged = log;
    await CallService.start(P, { video: true });
    const id = CallService.getSnapshot().callId;
    inbound('call-accept', P, id);
    await vi.advanceTimersByTimeAsync(0);
    expect(kinds()).toContain('call-offer');
    const pc = FakePC.last!;
    inbound('call-answer', P, id, {});
    await vi.advanceTimersByTimeAsync(0);
    pc.iceConnectionState = 'connected'; pc.oniceconnectionstatechange();
    expect(CallService.getSnapshot().state).toBe('in-call');
    CallService.toggleMute();
    expect(stream.tracks[0].enabled).toBe(false);
    CallService.end();
    expect(kinds()).toContain('call-end');
    expect(stream.tracks.every(t => t.stop.mock.calls.length > 0)).toBe(true);
    expect(pc.close).toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatchObject({ peer: P, kind: 'completed', outgoing: true, video: true });
  });

  it('unreachable peer → ended/unavailable', async () => {
    h.sendOk = false;
    await CallService.start(P, { video: false });
    expect(CallService.getSnapshot()).toMatchObject({ state: 'ended', endReason: 'unavailable' });
  });
});

void ME;
