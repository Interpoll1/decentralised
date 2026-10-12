import { describe, it, expect } from 'vitest';
import { KeyService } from '../src/services/keyService';
import {
  DEFAULT_TIMELOCK_MS, NOTICE_MS, eventId, resolveUsername, signingPayload, signWith,
  type KeyRotation, type RecoveryDesignation, type RotationCancel, type UsernameClaim,
} from '../src/utils/usernameEvents';

function keypair() {
  const priv = KeyService.generatePrivateKey();
  return { priv, pub: KeyService.getPublicKey(priv) };
}
const DAY = 24 * 60 * 60 * 1000;

function claim(k: ReturnType<typeof keypair>, username: string, at: number, level: 'none' | 'issuer' = 'none'): UsernameClaim {
  const c: UsernameClaim = { type: 'claim', v: 1, username, pubkey: k.pub, claimedAt: at, level, sig: '' };
  c.sig = signWith(signingPayload(c), k.priv);
  return c;
}
function designate(holder: ReturnType<typeof keypair>, rec: ReturnType<typeof keypair>, username: string, at: number, timelockMs = DEFAULT_TIMELOCK_MS): RecoveryDesignation {
  const d: RecoveryDesignation = { type: 'designation', v: 1, username, pubkey: holder.pub, recoveryPubkey: rec.pub, timelockMs, createdAt: at, sig: '' };
  d.sig = signWith(signingPayload(d), holder.priv);
  return d;
}
function recoveryRotation(oldPub: string, next: ReturnType<typeof keypair>, rec: ReturnType<typeof keypair>, username: string, at: number): KeyRotation {
  const r: KeyRotation = { type: 'rotation', v: 1, username, oldPubkey: oldPub, newPubkey: next.pub, createdAt: at, sigNew: '' };
  const p = signingPayload(r);
  r.sigNew = signWith(p, next.priv);
  r.sigRecovery = signWith(p, rec.priv);
  return r;
}
function voluntaryRotation(old: ReturnType<typeof keypair>, next: ReturnType<typeof keypair>, username: string, at: number): KeyRotation {
  const r: KeyRotation = { type: 'rotation', v: 1, username, oldPubkey: old.pub, newPubkey: next.pub, createdAt: at, sigNew: '' };
  const p = signingPayload(r);
  r.sigNew = signWith(p, next.priv);
  r.sigOld = signWith(p, old.priv);
  return r;
}

describe('claims', () => {
  it('earliest signed claim wins, forged claims are ignored', () => {
    const a = keypair(), b = keypair();
    const forged = { ...claim(b, 'alice', 1), pubkey: a.pub }; // signed by b, claims to be a
    const r = resolveUsername('alice', [claim(b, 'alice', 2000), claim(a, 'alice', 1000), forged], 5000);
    expect(r.owner).toBe(a.pub);
  });
  it('is case-insensitive and deterministic', () => {
    const a = keypair();
    const events = [claim(a, 'Alice', 10)];
    expect(resolveUsername('ALICE', events, 100).owner).toBe(a.pub);
    expect(resolveUsername('alice', [...events].reverse(), 100)).toEqual(resolveUsername('alice', events, 100));
  });
  it('an issuer-certified claim beats an earlier uncertified one', () => {
    const a = keypair(), b = keypair();
    const early = claim(a, 'bob', 100);
    const certified = { ...claim(b, 'bob', 900, 'issuer'), cert: { ok: true } } as UsernameClaim;
    certified.sig = signWith(signingPayload(certified), b.priv);
    expect(resolveUsername('bob', [early, certified], 2000, { isCertValid: () => true }).owner).toBe(b.pub);
  });
  it('a claim with a junk certificate does NOT outrank an earlier one (fails closed)', () => {
    const a = keypair(), b = keypair();
    const early = claim(a, 'bob2', 100);
    const fake = { ...claim(b, 'bob2', 900, 'issuer'), cert: { issuerDomain: 'evil' } } as UsernameClaim;
    fake.sig = signWith(signingPayload(fake), b.priv);
    expect(resolveUsername('bob2', [early, fake], 2000).owner).toBe(a.pub);
    expect(resolveUsername('bob2', [early, fake], 2000, { isCertValid: () => false }).owner).toBe(a.pub);
  });
  it('a backdated claim cannot displace a holder this observer already pinned', () => {
    const owner = keypair(), thief = keypair();
    const real = claim(owner, 'kim', 5000);
    const backdated = claim(thief, 'kim', 1);
    const naive = resolveUsername('kim', [real, backdated], 9000);
    expect(naive.owner).toBe(thief.pub); // documents the residual risk for a brand-new observer
    const pinned = resolveUsername('kim', [real, backdated], 9000, { pinnedOwner: owner.pub });
    expect(pinned.owner).toBe(owner.pub);
    expect(pinned.conflict).toBe(true);
  });
  it('events dated in the future are ignored', () => {
    const a = keypair(), b = keypair();
    const future = claim(b, 'lee', 1_000_000 + 60 * 60 * 1000);
    expect(resolveUsername('lee', [future], 1_000_000).owner).toBeNull();
    expect(resolveUsername('lee', [claim(a, 'lee', 900_000), future], 1_000_000).owner).toBe(a.pub);
  });
  it('unclaimed name resolves to no owner', () => {
    expect(resolveUsername('nobody', [], 1).owner).toBeNull();
  });
});

describe('recovery', () => {
  const T0 = 1_000_000_000_000;
  function setup() {
    const holder = keypair(), rec = keypair(), next = keypair();
    const events = [claim(holder, 'carol', T0), designate(holder, rec, 'carol', T0 + 1000)];
    return { holder, rec, next, events };
  }

  it('recovery takes effect only after the time lock', () => {
    const { holder, rec, next, events } = setup();
    events.push(recoveryRotation(holder.pub, next, rec, 'carol', T0 + DAY));
    const during = resolveUsername('carol', events, T0 + DAY + DEFAULT_TIMELOCK_MS - 1000);
    expect(during.owner).toBe(holder.pub);
    expect(during.pending?.newPubkey).toBe(next.pub);
    const after = resolveUsername('carol', events, T0 + DAY + DEFAULT_TIMELOCK_MS + 1000);
    expect(after.owner).toBe(next.pub);
    expect(after.pending).toBeNull();
    expect(after.recovery).toBeNull(); // new owner must re-designate
  });

  it('the current holder can cancel a pending recovery', () => {
    const { holder, rec, next, events } = setup();
    const rot = recoveryRotation(holder.pub, next, rec, 'carol', T0 + DAY);
    events.push(rot);
    const pending = resolveUsername('carol', events, T0 + DAY + 1000).pending!;
    const cancel: RotationCancel = { type: 'cancel', v: 1, username: 'carol', pubkey: holder.pub, rotationId: pending.rotationId, createdAt: T0 + 2 * DAY, sig: '' };
    cancel.sig = signWith(signingPayload(cancel), holder.priv);
    events.push(cancel);
    const r = resolveUsername('carol', events, T0 + 30 * DAY);
    expect(r.owner).toBe(holder.pub);
    expect(r.pending).toBeNull();
  });

  it('a stranger cannot cancel', () => {
    const { holder, rec, next, events } = setup();
    events.push(recoveryRotation(holder.pub, next, rec, 'carol', T0 + DAY));
    const id = resolveUsername('carol', events, T0 + DAY + 1).pending!.rotationId;
    const evil = keypair();
    const cancel: RotationCancel = { type: 'cancel', v: 1, username: 'carol', pubkey: evil.pub, rotationId: id, createdAt: T0 + 2 * DAY, sig: '' };
    cancel.sig = signWith(signingPayload(cancel), evil.priv);
    events.push(cancel);
    expect(resolveUsername('carol', events, T0 + 30 * DAY).owner).toBe(next.pub);
  });

  it('a rotation signed with the wrong recovery key is ignored', () => {
    const { holder, next, events } = setup();
    const wrong = keypair();
    events.push(recoveryRotation(holder.pub, next, wrong, 'carol', T0 + DAY));
    expect(resolveUsername('carol', events, T0 + 60 * DAY).owner).toBe(holder.pub);
  });

  it('a recovery key that was never designated cannot move the name', () => {
    const holder = keypair(), rec = keypair(), next = keypair();
    const events = [claim(holder, 'dave', T0), recoveryRotation(holder.pub, next, rec, 'dave', T0 + DAY)];
    expect(resolveUsername('dave', events, T0 + 60 * DAY).owner).toBe(holder.pub);
  });

  it('a designation made after the request does not retroactively authorise it', () => {
    const holder = keypair(), rec = keypair(), next = keypair();
    const events = [
      claim(holder, 'erin', T0),
      recoveryRotation(holder.pub, next, rec, 'erin', T0 + DAY),
      designate(holder, rec, 'erin', T0 + 2 * DAY),
    ];
    expect(resolveUsername('erin', events, T0 + 60 * DAY).owner).toBe(holder.pub);
  });

  it('a designation by a non-holder is ignored', () => {
    const holder = keypair(), rec = keypair(), thief = keypair(), next = keypair();
    const events = [
      claim(holder, 'fay', T0),
      designate(thief, thief, 'fay', T0 + 1000),
      recoveryRotation(holder.pub, next, thief, 'fay', T0 + DAY),
    ];
    void rec;
    expect(resolveUsername('fay', events, T0 + 60 * DAY).owner).toBe(holder.pub);
  });

  it('a time lock below the minimum is rejected', () => {
    const holder = keypair(), rec = keypair(), next = keypair();
    const events = [
      claim(holder, 'gus', T0),
      designate(holder, rec, 'gus', T0 + 1000, 1000),
      recoveryRotation(holder.pub, next, rec, 'gus', T0 + DAY),
    ];
    expect(resolveUsername('gus', events, T0 + 60 * DAY).owner).toBe(holder.pub);
  });
});

describe('time locks use first-seen, not the declared clock', () => {
  it('a backdated recovery request still waits the full lock from when it was first seen', () => {
    const T0 = 1_000_000_000_000;
    const holder = keypair(), rec = keypair(), next = keypair();
    const claimEv = claim(holder, 'mo', T0);
    const des = designate(holder, rec, 'mo', T0 + 1000);
    const rot = recoveryRotation(holder.pub, next, rec, 'mo', T0 + DAY); // declared a day after the claim
    const seenAt = T0 + 20 * DAY;                                           // ...but only seen 20 days later
    const seen = (id: string) => (id === eventId(rot) ? seenAt : undefined);
    // Declared time alone would have finished the lock long ago.
    expect(resolveUsername('mo', [claimEv, des, rot], T0 + 20 * DAY + 1000).owner).toBe(next.pub);
    // With first-seen, the lock runs from the day it was observed.
    const during = resolveUsername('mo', [claimEv, des, rot], seenAt + DEFAULT_TIMELOCK_MS - 1000, { firstSeen: seen });
    expect(during.owner).toBe(holder.pub);
    expect(during.pending?.newPubkey).toBe(next.pub);
    expect(resolveUsername('mo', [claimEv, des, rot], seenAt + DEFAULT_TIMELOCK_MS + 1000, { firstSeen: seen }).owner).toBe(next.pub);
  });
});

describe('relay witness', () => {
  it('a backdated claim loses once relay first-seen stamps are used', () => {
    const owner = keypair(), thief = keypair();
    const real = claim(owner, 'wit', 5000);
    const backdated = claim(thief, 'wit', 1);
    const stamps: Record<string, number> = { [eventId(real)]: 10_000, [eventId(backdated)]: 20_000 };
    const r = resolveUsername('wit', [real, backdated], 30_000, { witness: (id) => stamps[id] });
    expect(r.owner).toBe(owner.pub);
  });
});

describe('voluntary rotation', () => {
  it('moves the name after the notice window', () => {
    const T0 = 2_000_000_000_000;
    const old = keypair(), next = keypair();
    const events = [claim(old, 'hana', T0), voluntaryRotation(old, next, 'hana', T0 + 1000)];
    expect(resolveUsername('hana', events, T0 + 1000 + NOTICE_MS - 5).owner).toBe(old.pub);
    expect(resolveUsername('hana', events, T0 + 1000 + NOTICE_MS + 5).owner).toBe(next.pub);
  });
  it('a rotation lacking the old key signature is not voluntary', () => {
    const T0 = 2_000_000_000_000;
    const old = keypair(), next = keypair();
    const r: KeyRotation = { type: 'rotation', v: 1, username: 'ivy', oldPubkey: old.pub, newPubkey: next.pub, createdAt: T0 + 1000, sigNew: '' };
    r.sigNew = signWith(signingPayload(r), next.priv);
    expect(resolveUsername('ivy', [claim(old, 'ivy', T0), r], T0 + 10 * DAY).owner).toBe(old.pub);
  });
});
