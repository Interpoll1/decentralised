/**
 * 1:1 audio/video calls. Each call gets its OWN RTCPeerConnection, separate from
 * the data-channel mesh in WebRTCService, so a failed call never disturbs sync.
 *
 * Signaling rides SignalingService's signed `call-*` envelopes (WSS + Gun tiers
 * only). State transitions live in the pure `callMachine`; this class owns the
 * side effects: media, peer connection, timers, and the call log callback.
 */

import config from '@/config';
import { SignalingService, type InboundSignal, type SignalTarget, type CallSignalKind, type SignalPayload } from '@/services/signalingService';
import { INITIAL, reduce, glareWinner, type CallContext, type CallEvent, type EndReason } from '@/services/callMachine';

export interface CallSnapshot extends CallContext {
  muted: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
}

export interface CallLogEntry {
  peer: string;
  kind: 'completed' | 'missed' | 'declined' | 'failed';
  durationMs: number;
  video: boolean;
  outgoing: boolean;
}

const RING_MS = 30_000;
const CONNECT_MS = 15_000;
const DISCONNECT_GRACE_MS = 5_000;
const RESET_MS = 3_000;
const INVITE_MAX = 3;
const INVITE_WINDOW_MS = 60_000;
const INVITE_GLOBAL_MAX = 10;

type Timer = 'ring' | 'connect' | 'grace' | 'reset';

function randomCallId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

export class CallService {
  private static ctx: CallContext = INITIAL;
  private static muted = false;
  private static cameraOff = false;
  private static localStream: MediaStream | null = null;
  private static remoteStream: MediaStream | null = null;
  private static pc: RTCPeerConnection | null = null;
  private static target: SignalTarget = {};
  private static outgoing = false;
  private static inviteSent = false;
  private static pendingIce: RTCIceCandidateInit[] = [];
  private static timers = new Map<Timer, ReturnType<typeof setTimeout>>();
  private static inviteLog = new Map<string, number[]>();
  private static globalInvites: number[] = [];
  private static subs = new Set<(s: CallSnapshot) => void>();
  private static unsub: (() => void) | null = null;

  static onCallLogged: ((entry: CallLogEntry) => void) | null = null;
  /** Gate for incoming rings (e.g. existing DM contact). Unknown callers are dropped silently. */
  static allowIncoming: (peerPubkey: string) => boolean = () => true;

  static init(): void {
    if (this.unsub) return;
    this.unsub = SignalingService.onCallSignal((sig) => { void this.handleSignal(sig); });
  }

  static subscribe(cb: (s: CallSnapshot) => void): () => void {
    this.subs.add(cb);
    cb(this.getSnapshot());
    return () => { this.subs.delete(cb); };
  }

  static getSnapshot(): CallSnapshot {
    return { ...this.ctx, muted: this.muted, cameraOff: this.cameraOff, localStream: this.localStream, remoteStream: this.remoteStream };
  }

  static isSupported(): boolean {
    return typeof RTCPeerConnection !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && config.getIceServers().length > 0;
  }

  static async start(peerPubkey: string, opts: { video: boolean }): Promise<void> {
    if (this.ctx.state !== 'idle') return;
    const callId = randomCallId();
    this.outgoing = true;
    this.inviteSent = false;
    this.target = { pubkey: peerPubkey };
    this.dispatch({ t: 'start', callId, peer: peerPubkey, video: opts.video });
    if (!this.isSupported()) return this.dispatch({ t: 'media-error' }, 'unavailable');

    if (!(await this.acquireMedia(opts.video, callId))) return;

    this.inviteSent = true;
    const ok = await this.send('call-invite', { meta: { video: opts.video } });
    if (this.ctx.callId !== callId) return;
    if (!ok) return this.dispatch({ t: 'remote-end' }, 'unavailable');
    this.setTimer('ring', RING_MS, () => {
      void this.send('call-end');
      this.dispatch({ t: 'timeout' });
    });
  }

  static async accept(): Promise<void> {
    if (this.ctx.state !== 'incoming-ringing') return;
    const callId = this.ctx.callId;
    this.clearTimer('ring');
    if (!(await this.acquireMedia(this.ctx.video, callId))) {
      void this.send('call-end', {}, callId);
      return;
    }
    this.dispatch({ t: 'accepted' });
    void this.send('call-accept');
    this.armConnectTimer();
  }

  static decline(): void {
    if (this.ctx.state !== 'incoming-ringing') return;
    void this.send('call-decline');
    this.dispatch({ t: 'local-end' });
  }

  static end(): void {
    const s = this.ctx.state;
    if (s === 'incoming-ringing') return this.decline();
    if (s !== 'outgoing-ringing' && s !== 'connecting' && s !== 'in-call') return;
    if (this.inviteSent || !this.outgoing) void this.send('call-end');
    this.dispatch({ t: 'local-end' });
  }

  static toggleMute(): void {
    this.muted = !this.muted;
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !this.muted; });
    this.notify();
  }

  static toggleCamera(): void {
    this.cameraOff = !this.cameraOff;
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = !this.cameraOff; });
    this.notify();
  }

  // ── Inbound signals ────────────────────────────────────────

  private static async handleSignal(sig: InboundSignal): Promise<void> {
    const peer = sig.remotePubkey;
    if (!peer || !sig.callId) return;

    if (sig.kind === 'call-invite') return this.handleInvite(sig, peer, sig.callId);

    if (sig.callId !== this.ctx.callId || peer !== this.ctx.peer) return;
    this.target = { ...this.target, ...sig.reply };

    switch (sig.kind) {
      case 'call-accept':
        if (this.ctx.state !== 'outgoing-ringing') return;
        this.clearTimer('ring');
        this.dispatch({ t: 'accepted' });
        this.armConnectTimer();
        await this.buildPeerConnection();
        if (!this.pc) return;
        try {
          const offer = await this.pc.createOffer();
          await this.pc.setLocalDescription(offer);
          void this.send('call-offer', { sdp: offer });
        } catch { this.failConnect(); }
        return;

      case 'call-offer':
        if (this.ctx.state !== 'connecting' || this.outgoing || !sig.sdp) return;
        await this.buildPeerConnection();
        if (!this.pc) return;
        try {
          await this.pc.setRemoteDescription(sig.sdp);
          await this.flushIce();
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          void this.send('call-answer', { sdp: answer });
        } catch { this.failConnect(); }
        return;

      case 'call-answer':
        if (!this.pc || !sig.sdp) return;
        try {
          await this.pc.setRemoteDescription(sig.sdp);
          await this.flushIce();
        } catch { this.failConnect(); }
        return;

      case 'call-ice':
        if (!sig.candidate) return;
        if (this.pc?.remoteDescription) {
          try { await this.pc.addIceCandidate(sig.candidate); } catch { /* stale candidate */ }
        } else {
          this.pendingIce.push(sig.candidate);
        }
        return;

      case 'call-decline':
        return this.dispatch({ t: 'declined' }, sig.meta?.reason === 'busy' ? 'busy' : undefined);

      case 'call-end':
        return this.dispatch({ t: 'remote-end' });
    }
  }

  private static handleInvite(sig: InboundSignal, peer: string, callId: string): void {
    // Spam control: at most INVITE_MAX invites per sender per window; excess dropped silently.
    // Plus a global cap: fresh keypairs are free, so per-sender limits alone don't bound a flood.
    const now = Date.now();
    this.globalInvites = this.globalInvites.filter(t => now - t < INVITE_WINDOW_MS);
    if (this.globalInvites.length >= INVITE_GLOBAL_MAX) return;
    for (const [k, ts] of this.inviteLog) {
      if (!ts.some(t => now - t < INVITE_WINDOW_MS)) this.inviteLog.delete(k);
    }
    const recent = (this.inviteLog.get(peer) ?? []).filter(t => now - t < INVITE_WINDOW_MS);
    if (recent.length >= INVITE_MAX) return;
    recent.push(now);
    this.inviteLog.set(peer, recent);
    this.globalInvites.push(now);

    const reply = sig.reply;
    // Silent drop (no reply) when we can't take calls or don't know the caller:
    // replying would confirm to an arbitrary sender that we're online — and, for
    // Anonymity Mode, that we're in it.
    if (!this.isSupported()) return;
    try { if (!this.allowIncoming(peer)) return; } catch { return; }

    if (this.ctx.state !== 'idle') {
      const glare = this.ctx.state === 'outgoing-ringing' && this.ctx.peer === peer;
      if (glare) {
        if (glareWinner(SignalingService.getMyPubkey(), peer) === 'me') return; // they'll yield to ours
        void this.send('call-end');
        this.abortSilently();
      } else {
        if (callId === this.ctx.callId) return;
        void SignalingService.sendSignal(reply, 'call-decline', { callId, meta: { reason: 'busy' } });
        return;
      }
    }

    this.outgoing = false;
    this.inviteSent = false;
    this.target = { ...reply };
    this.dispatch({ t: 'recv-invite', callId, peer, video: sig.meta?.video === true });
    this.setTimer('ring', RING_MS, () => this.dispatch({ t: 'timeout' }));
  }

  // ── Internals ──────────────────────────────────────────────

  private static async acquireMedia(video: boolean, callId: string): Promise<boolean> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    } catch {
      if (this.ctx.callId === callId) this.dispatch({ t: 'media-error' }, 'permission');
      return false;
    }
    if (this.ctx.callId !== callId || this.ctx.state === 'ended') {
      stream.getTracks().forEach(t => t.stop()); // call ended while the prompt was open
      return false;
    }
    this.localStream = stream;
    this.notify();
    return true;
  }

  private static async buildPeerConnection(): Promise<void> {
    const callId = this.ctx.callId;
    const turn = await this.turnServers();
    if (this.ctx.callId !== callId || this.ctx.state === 'ended') return;
    const pc = new RTCPeerConnection({ iceServers: [...config.getIceServers(), ...turn] });
    this.pc = pc;
    this.localStream?.getTracks().forEach(t => pc.addTrack(t, this.localStream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) void this.send('call-ice', { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      this.remoteStream = e.streams[0] ?? new MediaStream([e.track]);
      this.notify();
    };
    pc.oniceconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') {
        this.clearTimer('connect');
        this.clearTimer('grace');
        this.dispatch({ t: 'ice-connected' });
      } else if (s === 'failed') {
        this.failConnect();
      } else if (s === 'disconnected') {
        this.setTimer('grace', DISCONNECT_GRACE_MS, () => {
          void this.send('call-end');
          this.dispatch({ t: 'remote-end' }, 'disconnected');
        });
      }
    };
  }

  /** TURN creds from the relay, authenticated with a fresh device-key signature. */
  private static async turnServers(): Promise<RTCIceServer[]> {
    try {
      const [{ KeyService }, { CryptoService }] = await Promise.all([
        import('@/services/keyService'), import('@/services/cryptoService'),
      ]);
      const kp = await KeyService.getKeyPair();
      const ts = Date.now();
      const sig = CryptoService.sign(`interpoll-turn:${kp.publicKey}:${ts}`, kp.privateKey);
      return await config.getTurnServers({ pk: kp.publicKey, ts, sig });
    } catch {
      return [];
    }
  }

  private static async flushIce(): Promise<void> {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const c of queued) {
      try { await this.pc?.addIceCandidate(c); } catch { /* stale candidate */ }
    }
  }

  private static armConnectTimer(): void {
    this.setTimer('connect', CONNECT_MS, () => this.failConnect());
  }

  private static failConnect(): void {
    void this.send('call-end');
    this.dispatch({ t: 'ice-failed' });
  }

  private static send(kind: CallSignalKind, extra: Omit<SignalPayload, 'callId'> = {}, callId = this.ctx.callId): Promise<boolean> {
    return SignalingService.sendSignal(this.target, kind, { ...extra, callId });
  }

  private static dispatch(ev: CallEvent, reason?: EndReason): void {
    const next = reduce(this.ctx, ev);
    if (next === this.ctx) return;
    this.ctx = next.state === 'ended' && reason ? { ...next, endReason: reason } : next;
    if (this.ctx.state === 'ended') {
      this.teardown(true);
      this.setTimer('reset', RESET_MS, () => this.dispatch({ t: 'reset' }));
    } else if (this.ctx.state === 'idle') {
      this.muted = false;
      this.cameraOff = false;
      this.remoteStream = null;
    }
    this.notify();
  }

  /** Abort the current call without logging it (glare loser). */
  private static abortSilently(): void {
    this.teardown(false);
    this.ctx = INITIAL;
  }

  private static teardown(log: boolean): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.oniceconnectionstatechange = null;
      try { this.pc.close(); } catch { /* already closed */ }
      this.pc = null;
    }
    this.pendingIce = [];
    if (log) this.logCall();
  }

  private static logCall(): void {
    const c = this.ctx;
    let kind: CallLogEntry['kind'];
    if (c.startedAt) kind = 'completed';
    else if (c.endReason === 'no-answer' || c.endReason === 'cancelled') kind = 'missed';
    else if (c.endReason === 'declined' || c.endReason === 'busy') kind = 'declined';
    else kind = 'failed';
    try {
      this.onCallLogged?.({
        peer: c.peer,
        kind,
        durationMs: c.startedAt ? Date.now() - c.startedAt : 0,
        video: c.video,
        outgoing: this.outgoing,
      });
    } catch { /* logging must never break teardown */ }
  }

  private static setTimer(name: Timer, ms: number, fn: () => void): void {
    this.clearTimer(name);
    this.timers.set(name, setTimeout(() => { this.timers.delete(name); fn(); }, ms));
  }

  private static clearTimer(name: Timer): void {
    const t = this.timers.get(name);
    if (t) clearTimeout(t);
    this.timers.delete(name);
  }

  private static notify(): void {
    const snap = this.getSnapshot();
    for (const cb of this.subs) {
      try { cb(snap); } catch { /* ignore subscriber errors */ }
    }
  }

  /** Test hook: drop all state and listeners. */
  static resetForTests(): void {
    this.teardown(false);
    this.ctx = INITIAL;
    this.muted = false;
    this.cameraOff = false;
    this.remoteStream = null;
    this.target = {};
    this.outgoing = false;
    this.inviteSent = false;
    this.inviteLog.clear();
    this.globalInvites = [];
    this.subs.clear();
    this.unsub?.();
    this.unsub = null;
    this.onCallLogged = null;
    this.allowIncoming = () => true;
  }
}

export default CallService;
