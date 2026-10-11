import { describe, it, expect, vi, beforeAll } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

vi.mock('@/services/gunService', () => ({
  GunService: {
    getGun: vi.fn(),
    getPeerStats: vi.fn(() => ({ isConnected: false })),
    onReconnect: vi.fn(),
  },
  default: {},
}));
const { webrtc } = vi.hoisted(() => ({
  // A connected mesh peer exists, so a call signal falling through to Tier 3 would succeed.
  webrtc: { broadcastToAll: vi.fn(), getConnectedPeers: vi.fn(() => ['p1']) },
}));
vi.mock('@/services/webrtcService', () => ({ WebRTCService: webrtc, MESH_SIGNAL_TYPE: 'signal-relay' }));
vi.mock('@/services/websocketService', () => ({
  WebSocketService: { getConnectionStatus: () => false, getPeerId: () => 'me', broadcast: vi.fn(), subscribe: vi.fn() },
}));

import { SignalingService, isCallKind } from '@/services/signalingService';

const CID = 'c'.repeat(32);

beforeAll(() => {
  const priv = randomBytes(32);
  (SignalingService as any).myPrivkey = bytesToHex(priv);
  (SignalingService as any).myPubkey = bytesToHex(schnorr.getPublicKey(priv));
  (SignalingService as any).initialized = true;
});

describe('call signaling', () => {
  it('isCallKind only matches call-*', () => {
    expect(isCallKind('call-invite')).toBe(true);
    expect(isCallKind('offer')).toBe(false);
  });

  it('call envelope signature binds callId and target', async () => {
    await SignalingService.initialize();
    const env: any = (SignalingService as any).buildEnvelope(
      { pubkey: 'a'.repeat(64) }, 'call-invite', { callId: CID, meta: { video: true } }, 'peerX');
    const parsed = (SignalingService as any).verifyEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed.callId).toBe(CID);
    expect(parsed.meta).toEqual({ video: true });
    expect((SignalingService as any).verifyEnvelope({ ...env, callId: 'd'.repeat(32) })).toBeNull();
    expect((SignalingService as any).verifyEnvelope({ ...env, targetPubkey: 'b'.repeat(64) })).toBeNull();
  });

  it('rejects call envelope with malformed callId', async () => {
    await SignalingService.initialize();
    const env: any = (SignalingService as any).buildEnvelope(
      { pubkey: 'a'.repeat(64) }, 'call-invite', { callId: 'c1' }, 'peerX');
    expect((SignalingService as any).verifyEnvelope(env)).toBeNull();
  });

  it('legacy offer envelope has no callId in signed bytes', async () => {
    await SignalingService.initialize();
    const env: any = (SignalingService as any).buildEnvelope({ pubkey: 'a'.repeat(64) }, 'offer', { sdp: { type: 'offer', sdp: 'x' } }, 'p');
    expect(env.callId).toBeUndefined();
    expect((SignalingService as any).verifyEnvelope(env)).not.toBeNull();
  });

  it('call signals go to onCallSignal, not onSignal', () => {
    const mesh = vi.fn(); const call = vi.fn();
    SignalingService.onSignal(mesh); SignalingService.onCallSignal(call);
    (SignalingService as any).emit({ kind: 'call-invite', remoteId: 'r', reply: {}, callId: CID });
    expect(call).toHaveBeenCalledOnce(); expect(mesh).not.toHaveBeenCalled();
  });

  it('call kinds never use the mesh tier', async () => {
    await SignalingService.initialize();
    const ok = await SignalingService.sendSignal({ pubkey: 'a'.repeat(64) }, 'call-invite', { callId: CID });
    expect(ok).toBe(false); // test env: no WSS, no Gun
  });
});
