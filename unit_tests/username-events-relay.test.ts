import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
// @ts-expect-error plain JS module shared with the relay
import * as relay from '../shared-validation/username-events.js';
import * as client from '../src/utils/usernameEvents';
import { KeyService } from '../src/services/keyService';

const DAY = 86_400_000;
const T0 = 1_900_000_000_000;

function keypair() { const priv = KeyService.generatePrivateKey(); return { priv, pub: KeyService.getPublicKey(priv) }; }
const sign = (payload: string, priv: string) => bytesToHex(schnorr.sign(hexToBytes(bytesToHex(sha256(new TextEncoder().encode(payload)))), hexToBytes(priv)));

function claim(k: ReturnType<typeof keypair>, username: string): any {
  const ev: any = { type: 'claim', v: 1, username, pubkey: k.pub, claimedAt: T0, level: 'none', sig: '' };
  ev.sig = sign(relay.signingPayload(ev), k.priv); return ev;
}
function designation(holder: ReturnType<typeof keypair>, rec: ReturnType<typeof keypair>, username: string, at: number, timelockMs = 14 * DAY): any {
  const ev: any = { type: 'designation', v: 1, username, pubkey: holder.pub, recoveryPubkey: rec.pub, timelockMs, createdAt: at, sig: '' };
  ev.sig = sign(relay.signingPayload(ev), holder.priv); return ev;
}
function recoveryRotation(oldPub: string, next: ReturnType<typeof keypair>, rec: ReturnType<typeof keypair>, username: string, at: number): any {
  const ev: any = { type: 'rotation', v: 1, username, oldPubkey: oldPub, newPubkey: next.pub, createdAt: at };
  const p = relay.signingPayload(ev);
  ev.sigNew = sign(p, next.priv); ev.sigRecovery = sign(p, rec.priv); return ev;
}
function run(events: Array<[any, number]>) {
  let state: any = null; const results: any[] = [];
  for (const [ev, now] of events) {
    const r = relay.applyEvent(state, ev, now);
    results.push(r);
    if (r.ok) state = r.state;
  }
  return { state, results };
}

describe('relay and client agree on the canonical form', () => {
  it('computes the same event id and accepts client-signed events', () => {
    const k = keypair();
    const ev = claim(k, 'zed');
    expect(relay.eventId(ev)).toBe(client.eventId(ev));
    expect(relay.checkEvent(ev)).toBeNull();
    expect(client.verifyClaim(ev)).toBe(true);
  });
  it('rejects tampered events', () => {
    const k = keypair();
    const ev = claim(k, 'zed');
    expect(relay.checkEvent({ ...ev, username: 'other' })).toBe('BAD_SIGNATURE');
  });
});

describe('relay state machine', () => {
  it('first claim wins; a later claimant is refused whatever date it declares', () => {
    const a = keypair(), b = keypair();
    const backdated = { ...claim(b, 'ann'), claimedAt: 1 };
    backdated.sig = sign(relay.signingPayload(backdated), b.priv);
    const { results } = run([[claim(a, 'ann'), T0], [backdated, T0 + 1000]]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, status: 409, error: 'NAME_TAKEN' });
  });

  it('only the holder can register a recovery key', () => {
    const holder = keypair(), rec = keypair(), thief = keypair();
    const { results } = run([[claim(holder, 'bea'), T0], [designation(thief, thief, 'bea', T0 + 1000), T0 + 1000]]);
    expect(results[1]).toMatchObject({ ok: false, error: 'NOT_HOLDER' });
    void rec;
  });

  it('remembers the recovery key and uses the RELAY clock for the lock', () => {
    const holder = keypair(), rec = keypair(), next = keypair();
    const t1 = T0 + 1000, t2 = T0 + 5 * DAY;
    const { state, results } = run([
      [claim(holder, 'cyd'), T0],
      [designation(holder, rec, 'cyd', t1), t1],
      [recoveryRotation(holder.pub, next, rec, 'cyd', t2), t2],
    ]);
    expect(results.every(r => r.ok)).toBe(true);
    expect(state.recovery.pubkey).toBe(rec.pub);
    expect(state.pending.effectiveAt).toBe(t2 + 14 * DAY);
    expect(relay.settle(state, t2 + 14 * DAY - 1).owner).toBe(holder.pub);
    expect(relay.settle(state, t2 + 14 * DAY + 1).owner).toBe(next.pub);
  });

  it('a backdated recovery request is refused outright (declared time must match the relay clock)', () => {
    const holder = keypair(), rec = keypair(), next = keypair();
    const now = T0 + 20 * DAY;
    const { results } = run([
      [claim(holder, 'dia'), T0],
      [designation(holder, rec, 'dia', T0 + 1000), T0 + 1000],
      [recoveryRotation(holder.pub, next, rec, 'dia', T0 + 2000), now], // declared 20 days ago
    ]);
    expect(results[2]).toMatchObject({ ok: false, error: 'STALE_OR_FUTURE_EVENT' });
  });

  it('rejects a recovery request signed with the wrong recovery key, or when none is registered', () => {
    const holder = keypair(), rec = keypair(), wrong = keypair(), next = keypair();
    const t = T0 + DAY;
    expect(run([[claim(holder, 'edd'), T0], [recoveryRotation(holder.pub, next, wrong, 'edd', t), t]]).results[1])
      .toMatchObject({ ok: false, error: 'NO_RECOVERY_KEY' });
    expect(run([[claim(holder, 'edd'), T0], [designation(holder, rec, 'edd', T0 + 1000), T0 + 1000], [recoveryRotation(holder.pub, next, wrong, 'edd', t), t]]).results[2])
      .toMatchObject({ ok: false, error: 'RECOVERY_KEY_MISMATCH' });
  });

  it('only the holder can cancel, and only the pending rotation', () => {
    const holder = keypair(), rec = keypair(), next = keypair(), thief = keypair();
    const t = T0 + DAY;
    const rot = recoveryRotation(holder.pub, next, rec, 'fyn', t);
    const id = relay.eventId(rot);
    const cancel = (k: ReturnType<typeof keypair>) => {
      const ev: any = { type: 'cancel', v: 1, username: 'fyn', pubkey: k.pub, rotationId: id, createdAt: t + 1000, sig: '' };
      ev.sig = sign(relay.signingPayload(ev), k.priv); return ev;
    };
    const base: Array<[any, number]> = [[claim(holder, 'fyn'), T0], [designation(holder, rec, 'fyn', T0 + 1000), T0 + 1000], [rot, t]];
    expect(run([...base, [cancel(thief), t + 1000]]).results[3]).toMatchObject({ ok: false, error: 'NOTHING_TO_CANCEL' });
    const ok = run([...base, [cancel(holder), t + 1000]]);
    expect(ok.results[3].ok).toBe(true);
    expect(ok.state.pending).toBeNull();
  });

  it('blocks a second rotation and a recovery-key swap while one is pending', () => {
    const holder = keypair(), rec = keypair(), rec2 = keypair(), next = keypair(), other = keypair();
    const t = T0 + DAY;
    const { results } = run([
      [claim(holder, 'gus'), T0],
      [designation(holder, rec, 'gus', T0 + 1000), T0 + 1000],
      [recoveryRotation(holder.pub, next, rec, 'gus', t), t],
      [recoveryRotation(holder.pub, other, rec, 'gus', t + 1000), t + 1000],
      [designation(holder, rec2, 'gus', t + 2000), t + 2000],
    ]);
    expect(results[3]).toMatchObject({ ok: false, error: 'ROTATION_PENDING' });
    expect(results[4]).toMatchObject({ ok: false, error: 'ROTATION_PENDING' });
  });

  it('an old designation cannot be replayed to bring back a retired recovery key', () => {
    const holder = keypair(), r1 = keypair(), r2 = keypair();
    const t1 = T0 + 1000, t2 = T0 + 2000;
    const d1 = designation(holder, r1, 'hal', t1), d2 = designation(holder, r2, 'hal', t2);
    const { results, state } = run([[claim(holder, 'hal'), T0], [d1, t1], [d2, t2], [d1, t2 + 1000]]);
    expect(results[3]).toMatchObject({ ok: false, error: 'OLDER_DESIGNATION' });
    expect(state.recovery.pubkey).toBe(r2.pub);
  });

  it('refuses time locks outside the allowed range', () => {
    const holder = keypair(), rec = keypair();
    expect(relay.checkEvent(designation(holder, rec, 'ivy', T0, 1000))).toBe('BAD_TIMELOCK');
    expect(relay.checkEvent(designation(holder, rec, 'ivy', T0, 1000 * DAY))).toBe('BAD_TIMELOCK');
  });
});
