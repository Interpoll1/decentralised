import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/services/gunService', () => ({ GunService: { getGun: () => ({ get: () => ({ get: () => ({}) }) }) } }));
vi.mock('../src/services/voteTrackerService', () => ({ VoteTrackerService: { getDeviceId: async () => 'device' } }));
vi.mock('../src/services/keyService', () => ({ KeyService: {} }));
vi.mock('../src/services/cryptoService', () => ({ CryptoService: {} }));
vi.mock('../src/services/storageService', () => ({ StorageService: {} }));
vi.mock('@/utils/identityTrust', () => ({ parseIdentityTrust: () => ({ identityUsername: undefined, issuer: undefined, trustLevel: undefined }) }));

import { foldKarmaEvents } from '../src/services/userService';

const event = (value: -1 | 0 | 1 | number) => ({ value: { value } });

describe('foldKarmaEvents', () => {
  it('sums one contribution per voter+source leaf', () => {
    const entries = [event(1), event(1), event(-1)];
    expect(foldKarmaEvents(entries)).toBe(1);
  });

  it('a voter changing their vote is one leaf overwritten, not two summed', () => {
    // setKarmaEvent always overwrites the same (voterId, sourceId) leaf, so a
    // flip from up to down is represented as a single leaf now holding -1 —
    // never as two leaves (+1 and -1) landing side by side.
    const afterFlip = [event(-1)];
    expect(foldKarmaEvents(afterFlip)).toBe(-1);
  });

  it('ignores malformed or out-of-range leaf values', () => {
    const entries = [event(1), { value: { value: 5 } }, { value: 'not-an-object' }, { value: null }];
    expect(foldKarmaEvents(entries)).toBe(1);
  });

  it('returns zero for no events', () => {
    expect(foldKarmaEvents([])).toBe(0);
  });

  // The property that motivated the rewrite: the old version read
  // `user.karma`, added `points`, and wrote the scalar back — for votes from
  // *other* users this had no ack or retry at all, so concurrent voters on
  // the same author routinely lost each other's contribution. Per-voter,
  // per-source keys cannot collide.
  it('keeps every voter contribution when many people vote on the same author at once', () => {
    const entries = Array.from({ length: 25 }, () => event(1))
      .concat(Array.from({ length: 10 }, () => event(-1)));
    expect(foldKarmaEvents(entries)).toBe(15);
  });
});
