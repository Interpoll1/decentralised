import { describe, it, expect } from 'vitest';
import { INITIAL, reduce, glareWinner } from '@/services/callMachine';

const start = reduce(INITIAL, { t: 'start', callId: 'c', peer: 'p', video: true });
describe('callMachine', () => {
  it('outgoing happy path', () => {
    let c = start; expect(c.state).toBe('outgoing-ringing');
    c = reduce(c, { t: 'accepted' }); expect(c.state).toBe('connecting');
    c = reduce(c, { t: 'ice-connected' }, 1000); expect(c.state).toBe('in-call'); expect(c.startedAt).toBe(1000);
    c = reduce(c, { t: 'local-end' }); expect(c).toMatchObject({ state: 'ended', endReason: 'hangup' });
  });
  it('incoming ring → timeout = no-answer', () => {
    let c = reduce(INITIAL, { t: 'recv-invite', callId: 'c', peer: 'p', video: false });
    expect(c.state).toBe('incoming-ringing');
    expect(reduce(c, { t: 'timeout' })).toMatchObject({ state: 'ended', endReason: 'no-answer' });
  });
  it('declined / ice-failed / media-error / remote-end', () => {
    expect(reduce(start, { t: 'declined' }).endReason).toBe('declined');
    expect(reduce(reduce(start, { t: 'accepted' }), { t: 'ice-failed' }).endReason).toBe('failed');
    expect(reduce(start, { t: 'media-error' }).endReason).toBe('permission');
    expect(reduce(start, { t: 'remote-end' }).state).toBe('ended');
  });
  it('invite while busy is ignored (state unchanged)', () => {
    expect(reduce(start, { t: 'recv-invite', callId: 'z', peer: 'q', video: false })).toBe(start);
  });
  it('illegal events are no-ops; reset returns to idle', () => {
    expect(reduce(INITIAL, { t: 'accepted' })).toBe(INITIAL);
    expect(reduce(reduce(start, { t: 'local-end' }), { t: 'reset' })).toEqual(INITIAL);
  });
  it('glare: lower pubkey wins', () => {
    expect(glareWinner('a', 'b')).toBe('me');
    expect(glareWinner('b', 'a')).toBe('peer');
  });
});
