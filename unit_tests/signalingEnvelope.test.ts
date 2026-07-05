import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';

// Keep the heavy Gun module out of the test; SignalingService only touches it in
// paths we don't exercise here. CryptoService stays REAL (we test real signatures).
vi.mock('@/services/gunService', () => ({
  GunService: {
    getGun: vi.fn(),
    getPeerStats: vi.fn(() => ({ isConnected: false })),
    onReconnect: vi.fn(),
  },
  default: {},
}));

const { webrtc } = vi.hoisted(() => ({
  webrtc: { broadcastToAll: vi.fn(), getConnectedPeers: vi.fn(() => [] as string[]) },
}));
vi.mock('@/services/webrtcService', () => ({ WebRTCService: webrtc, MESH_SIGNAL_TYPE: 'signal-relay' }));

import { SignalingService, type InboundSignal } from '@/services/signalingService';

function newKeypair() {
  const privBytes = randomBytes(32);
  const priv = bytesToHex(privBytes);
  const pub = bytesToHex(schnorr.getPublicKey(privBytes));
  return { priv, pub };
}

const me = newKeypair();
const alice = newKeypair();

/** Build a signed envelope as `from`, addressed to `target`, reusing the real signer. */
function envelopeFrom(
  from: { priv: string; pub: string },
  target: { pubkey?: string; peerId?: string },
  kind: 'offer' | 'answer' | 'ice' = 'offer',
): any {
  const S = SignalingService as any;
  const save = { pub: S.myPubkey, priv: S.myPrivkey };
  S.myPubkey = from.pub;
  S.myPrivkey = from.priv;
  const env = S.buildEnvelope(target, kind, { sdp: { type: 'offer', sdp: 'v=0' } }, `peer-${from.pub.slice(0, 6)}`);
  S.myPubkey = save.pub;
  S.myPrivkey = save.priv;
  return env;
}

beforeEach(() => {
  const S = SignalingService as any;
  S.myPubkey = me.pub;
  S.myPrivkey = me.priv;
  S.seen.clear();
  S.listeners.clear();
  webrtc.broadcastToAll.mockClear();
  webrtc.getConnectedPeers.mockReturnValue([]);
});

afterEach(() => { vi.useRealTimers(); });

describe('SignalingService signed envelope', () => {
  it('verifies a valid envelope and returns the decoded payload', () => {
    const env = envelopeFrom(alice, { pubkey: me.pub });
    const parsed = (SignalingService as any).verifyEnvelope(env);
    expect(parsed).not.toBeNull();
    expect(parsed.fromPubkey).toBe(alice.pub);
    expect(parsed.targetPubkey).toBe(me.pub);
    expect(parsed.sdp).toEqual({ type: 'offer', sdp: 'v=0' });
  });

  it('rejects a tampered payload', () => {
    const env = envelopeFrom(alice, { pubkey: me.pub });
    env.sdp = JSON.stringify({ type: 'offer', sdp: 'MALICIOUS' });
    expect((SignalingService as any).verifyEnvelope(env)).toBeNull();
  });

  it('rejects a bad signature', () => {
    const env = envelopeFrom(alice, { pubkey: me.pub });
    env.signature = 'f'.repeat(128);
    expect((SignalingService as any).verifyEnvelope(env)).toBeNull();
  });

  it('rejects a stale envelope', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const env = envelopeFrom(alice, { pubkey: me.pub });
    vi.setSystemTime(1_000_000 + 70_000); // past SIGNAL_TTL_MS
    expect((SignalingService as any).verifyEnvelope(env)).toBeNull();
  });
});

describe('SignalingService mesh relay', () => {
  it('delivers an envelope addressed to us', () => {
    const received: InboundSignal[] = [];
    SignalingService.onSignal((s) => received.push(s));
    const env = envelopeFrom(alice, { pubkey: me.pub });

    SignalingService.handleRelayEnvelope({ ...env, hop: 3 });

    expect(received).toHaveLength(1);
    expect(received[0].remotePubkey).toBe(alice.pub);
    expect(received[0].kind).toBe('offer');
    expect(webrtc.broadcastToAll).not.toHaveBeenCalled();
  });

  it('re-floods an envelope for someone else with a decremented hop', async () => {
    const other = newKeypair();
    const received: InboundSignal[] = [];
    SignalingService.onSignal((s) => received.push(s));
    const env = envelopeFrom(alice, { pubkey: other.pub });

    SignalingService.handleRelayEnvelope({ ...env, hop: 2 });
    await vi.waitFor(() => expect(webrtc.broadcastToAll).toHaveBeenCalled());

    expect(received).toHaveLength(0); // not for us → not delivered
    const [type, payload] = webrtc.broadcastToAll.mock.calls[0];
    expect(type).toBe('signal-relay');
    expect(payload.hop).toBe(1);
  });

  it('does not relay past the hop limit', async () => {
    const other = newKeypair();
    const env = envelopeFrom(alice, { pubkey: other.pub });
    SignalingService.handleRelayEnvelope({ ...env, hop: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(webrtc.broadcastToAll).not.toHaveBeenCalled();
  });

  it('drops a duplicate envelope (loop guard)', () => {
    const received: InboundSignal[] = [];
    SignalingService.onSignal((s) => received.push(s));
    const env = envelopeFrom(alice, { pubkey: me.pub });

    SignalingService.handleRelayEnvelope({ ...env, hop: 3 });
    SignalingService.handleRelayEnvelope({ ...env, hop: 3 });

    expect(received).toHaveLength(1); // second is deduped by msgId
  });
});
