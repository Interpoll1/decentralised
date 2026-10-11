/**
 * Pure 1:1 call state machine. No I/O — CallService feeds it events and acts on
 * the resulting context. Illegal (state, event) pairs return the SAME context
 * reference so callers can cheaply detect a no-op.
 */

export type CallState = 'idle' | 'outgoing-ringing' | 'incoming-ringing' | 'connecting' | 'in-call' | 'ended';
export type EndReason =
  | 'hangup' | 'declined' | 'busy' | 'no-answer' | 'cancelled'
  | 'failed' | 'unavailable' | 'permission' | 'disconnected';
export type CallEvent =
  | { t: 'start'; callId: string; peer: string; video: boolean }
  | { t: 'recv-invite'; callId: string; peer: string; video: boolean }
  | { t: 'accepted' } | { t: 'declined' } | { t: 'ice-connected' }
  | { t: 'ice-failed' } | { t: 'timeout' } | { t: 'remote-end' } | { t: 'local-end' }
  | { t: 'media-error' } | { t: 'reset' };

export interface CallContext {
  state: CallState;
  callId: string;
  peer: string;
  video: boolean;
  endReason?: EndReason;
  startedAt?: number;
}

export const INITIAL: CallContext = Object.freeze({ state: 'idle', callId: '', peer: '', video: false }) as CallContext;

const end = (ctx: CallContext, endReason: EndReason): CallContext => ({ ...ctx, state: 'ended', endReason });

export function reduce(ctx: CallContext, ev: CallEvent, now?: number): CallContext {
  if (ev.t === 'reset') return ctx.state === 'ended' ? INITIAL : ctx;

  switch (ctx.state) {
    case 'idle':
      if (ev.t === 'start') return { state: 'outgoing-ringing', callId: ev.callId, peer: ev.peer, video: ev.video };
      if (ev.t === 'recv-invite') return { state: 'incoming-ringing', callId: ev.callId, peer: ev.peer, video: ev.video };
      return ctx;

    case 'outgoing-ringing':
      switch (ev.t) {
        case 'accepted': return { ...ctx, state: 'connecting' };
        case 'declined': return end(ctx, 'declined');
        case 'timeout': return end(ctx, 'no-answer');
        case 'local-end': return end(ctx, 'cancelled');
        case 'remote-end': return end(ctx, 'declined');
        case 'media-error': return end(ctx, 'permission');
        default: return ctx;
      }

    case 'incoming-ringing':
      switch (ev.t) {
        case 'accepted': return { ...ctx, state: 'connecting' };
        case 'timeout': return end(ctx, 'no-answer');
        case 'local-end': return end(ctx, 'declined');
        case 'remote-end': return end(ctx, 'no-answer'); // caller gave up → missed
        case 'media-error': return end(ctx, 'permission');
        default: return ctx;
      }

    case 'connecting':
      switch (ev.t) {
        case 'ice-connected': return { ...ctx, state: 'in-call', startedAt: now ?? Date.now() };
        case 'ice-failed':
        case 'timeout': return end(ctx, 'failed');
        case 'local-end':
        case 'remote-end': return end(ctx, 'hangup');
        case 'media-error': return end(ctx, 'permission');
        default: return ctx;
      }

    case 'in-call':
      switch (ev.t) {
        case 'local-end':
        case 'remote-end': return end(ctx, 'hangup');
        case 'ice-failed': return end(ctx, 'disconnected');
        default: return ctx;
      }

    default:
      return ctx;
  }
}

/** Simultaneous invites to each other: the lower pubkey keeps its outgoing call. */
export function glareWinner(myPubkey: string, peerPubkey: string): 'me' | 'peer' {
  return myPubkey < peerPubkey ? 'me' : 'peer';
}
