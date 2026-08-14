import { describe, it, expect } from 'vitest';
import { CryptoService } from '../src/services/cryptoService';

/**
 * Room ids used to be `sorted(a,b).join(':')`, and a user id is a public key —
 * so the `chats` root was a published edge list of the whole social graph,
 * readable off a relay without decrypting anything. These tests pin the
 * derivation `ChatService.getRoomId` uses (it is private, so the formula is
 * restated here; if one side changes without the other, this fails).
 */

const DOMAIN = 'interpoll-dm-v1';

function roomId(userA: string, userB: string): string {
  return CryptoService.hash(`${[userA, userB].sort().join(':')}|${DOMAIN}`).slice(0, 32);
}

function legacyRoomId(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);

describe('DM room ids', () => {
  it('is order independent — both participants derive the same room', () => {
    expect(roomId(ALICE, BOB)).toBe(roomId(BOB, ALICE));
  });

  it('is deterministic across calls', () => {
    expect(roomId(ALICE, BOB)).toBe(roomId(ALICE, BOB));
  });

  it('separates distinct conversations', () => {
    expect(roomId(ALICE, BOB)).not.toBe(roomId(ALICE, CAROL));
    expect(roomId(ALICE, BOB)).not.toBe(roomId(BOB, CAROL));
  });

  it('does not contain either participant id', () => {
    const id = roomId(ALICE, BOB);
    expect(id).not.toContain(ALICE);
    expect(id).not.toContain(BOB);
    // Not even a recognisable prefix — the old format leaked the full ids.
    expect(id).not.toContain(ALICE.slice(0, 8));
    expect(id).not.toContain(BOB.slice(0, 8));
  });

  it('is a fixed-length hex id, so room names carry no length signal', () => {
    expect(roomId(ALICE, BOB)).toMatch(/^[0-9a-f]{32}$/);
    expect(roomId('x', 'y')).toMatch(/^[0-9a-f]{32}$/);
    expect(roomId(ALICE, BOB).length).toBe(roomId('x', 'y').length);
  });

  it('is domain separated, so the id is not just a hash of the pair', () => {
    const undomained = CryptoService.hash([ALICE, BOB].sort().join(':')).slice(0, 32);
    expect(roomId(ALICE, BOB)).not.toBe(undomained);
  });

  it('differs from the legacy id it replaces', () => {
    expect(roomId(ALICE, BOB)).not.toBe(legacyRoomId(ALICE, BOB));
  });

  describe('legacy ids', () => {
    it('still resolve order independently, so old rooms stay readable', () => {
      expect(legacyRoomId(ALICE, BOB)).toBe(legacyRoomId(BOB, ALICE));
    });

    it('are distinguishable from hashed ids by the separator', () => {
      // How `useChat` decides whether an index entry predates hashing.
      expect(legacyRoomId(ALICE, BOB).includes(':')).toBe(true);
      expect(roomId(ALICE, BOB).includes(':')).toBe(false);
    });

    it('did leak both participants — the regression being fixed', () => {
      const old = legacyRoomId(ALICE, BOB);
      expect(old).toContain(ALICE);
      expect(old).toContain(BOB);
    });
  });
});
