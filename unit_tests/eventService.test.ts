import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import { EventService } from '../src/services/eventService';
import { EventKind } from '../src/types/nostr';
import type { NostrEvent, UnsignedEvent } from '../src/types/nostr';

// Helper: create a valid key pair
function generateKeyPair() {
  const privateKey = bytesToHex(randomBytes(32));
  const publicKey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
  return { privateKey, publicKey };
}

// Helper: create and sign an event manually
function createTestEvent(privateKey: string, publicKey: string): NostrEvent {
  const unsigned: UnsignedEvent = {
    pubkey: publicKey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EventKind.POLL_CREATION,
    tags: [['poll_id', 'test-poll-1']],
    content: JSON.stringify({ question: 'Test?' }),
  };

  const id = EventService.computeEventId(unsigned);
  const sig = EventService.signEventId(id, privateKey);

  return { ...unsigned, id, sig };
}

describe('EventService', () => {
  describe('serializeEvent', () => {
    it('produces canonical NIP-01 format', () => {
      const event: UnsignedEvent = {
        pubkey: 'aabbccdd',
        created_at: 1234567890,
        kind: EventKind.POLL_CREATION,
        tags: [['poll_id', 'abc']],
        content: '{"question":"test"}',
      };
      const serialized = EventService.serializeEvent(event);
      const parsed = JSON.parse(serialized);
      expect(parsed[0]).toBe(0);
      expect(parsed[1]).toBe('aabbccdd');
      expect(parsed[2]).toBe(1234567890);
      expect(parsed[3]).toBe(EventKind.POLL_CREATION);
      expect(parsed[4]).toEqual([['poll_id', 'abc']]);
      expect(parsed[5]).toBe('{"question":"test"}');
    });
  });

  describe('computeEventId', () => {
    it('returns a 64-char hex string', () => {
      const event: UnsignedEvent = {
        pubkey: 'aabb',
        created_at: 12345,
        kind: EventKind.VOTE_CAST,
        tags: [],
        content: 'test',
      };
      const id = EventService.computeEventId(event);
      expect(id).toHaveLength(64);
      expect(/^[0-9a-f]{64}$/.test(id)).toBe(true);
    });

    it('is deterministic', () => {
      const event: UnsignedEvent = {
        pubkey: 'aabb',
        created_at: 12345,
        kind: EventKind.VOTE_CAST,
        tags: [],
        content: 'test',
      };
      expect(EventService.computeEventId(event)).toBe(EventService.computeEventId(event));
    });

    it('changes when content changes', () => {
      const base: UnsignedEvent = {
        pubkey: 'aabb',
        created_at: 12345,
        kind: EventKind.VOTE_CAST,
        tags: [],
        content: 'test1',
      };
      const modified = { ...base, content: 'test2' };
      expect(EventService.computeEventId(base)).not.toBe(
        EventService.computeEventId(modified),
      );
    });
  });

  describe('signEventId', () => {
    it('returns a 128-char hex signature', () => {
      const { privateKey } = generateKeyPair();
      const eventId = bytesToHex(sha256(new TextEncoder().encode('test')));
      const sig = EventService.signEventId(eventId, privateKey);
      expect(sig).toHaveLength(128);
      expect(/^[0-9a-f]{128}$/.test(sig)).toBe(true);
    });
  });

  describe('verifyEventId', () => {
    it('returns true for valid event', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      expect(EventService.verifyEventId(event)).toBe(true);
    });

    it('returns false for tampered content', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      event.content = '{"tampered": true}';
      expect(EventService.verifyEventId(event)).toBe(false);
    });
  });

  describe('verifyEventSignature', () => {
    it('returns true for valid signature', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      expect(EventService.verifyEventSignature(event)).toBe(true);
    });

    it('returns false for wrong public key', () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      const event = createTestEvent(keys1.privateKey, keys1.publicKey);
      event.pubkey = keys2.publicKey; // wrong pubkey
      expect(EventService.verifyEventSignature(event)).toBe(false);
    });

    it('returns false for tampered signature', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      event.sig = 'a'.repeat(128);
      expect(EventService.verifyEventSignature(event)).toBe(false);
    });
  });

  describe('verifyEvent (full)', () => {
    it('returns true for fully valid event', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      expect(EventService.verifyEvent(event)).toBe(true);
    });

    it('returns false when id is tampered', () => {
      const { privateKey, publicKey } = generateKeyPair();
      const event = createTestEvent(privateKey, publicKey);
      event.id = 'b'.repeat(64);
      expect(EventService.verifyEvent(event)).toBe(false);
    });
  });
});

describe('EventKind constants', () => {
  it('has expected values', () => {
    expect(EventKind.POLL_CREATION).toBe(100);
    expect(EventKind.VOTE_CAST).toBe(101);
    expect(EventKind.POLL_UPDATE).toBe(102);
    expect(EventKind.POST_CREATION).toBe(103);
  });
});
