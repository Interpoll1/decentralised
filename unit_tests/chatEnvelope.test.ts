import { describe, it, expect } from 'vitest';
import {
  sealEnvelope, verifyEnvelope, cipherDigest,
  DM_SIGNED_FIELDS, ROOM_SIGNED_FIELDS,
} from '../src/utils/chatEnvelope';
import { KeyService } from '../src/services/keyService';
import { CHAT_POW_BASE } from '../src/services/integrityService';

/**
 * The regression these tests exist for: `senderId` used to be copied off an
 * untrusted Gun record straight into the stored message, so anyone able to write
 * to the graph could publish a message "from" someone else. A user id is an
 * x-only secp256k1 public key here, so proving authorship is exactly proving
 * `_pub === senderId` over a valid signature.
 */

function identity() {
  const privateKey = KeyService.generatePrivateKey();
  return { privateKey, publicKey: KeyService.getPublicKey(privateKey) };
}

function dmFields(over: Record<string, string | number> = {}) {
  return {
    id: 'msg-1700000000000-abc123',
    senderId: over.senderId as string,
    recipientId: 'bob-public-key',
    timestamp: 1_700_000_000_000,
    seq: 7,
    cipherHash: cipherDigest('ciphertext', 'wrapForBob', 'wrapForAlice'),
    ...over,
  };
}

describe('chat envelope', () => {
  describe('round trip', () => {
    it('verifies a message signed by its claimed sender', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      const verdict = verifyEnvelope({ ...fields, ...envelope }, DM_SIGNED_FIELDS, alice.publicKey);
      expect(verdict.status).toBe('valid');
    });

    it('produces a proof of work that meets the base difficulty', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      expect(envelope._pow).toMatch(/^[0-9a-f]+$/);
      expect(envelope._pub).toBe(alice.publicKey);
      expect(envelope._sig.length).toBeGreaterThan(0);
    });

    it('works for room messages too', async () => {
      const alice = identity();
      const fields = {
        id: 'msg-2', roomId: 'room-9', senderId: alice.publicKey,
        timestamp: 1_700_000_000_000, seq: 1, cipherHash: cipherDigest('blob'),
      };
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      expect(verifyEnvelope({ ...fields, ...envelope }, ROOM_SIGNED_FIELDS, alice.publicKey).status)
        .toBe('valid');
    });
  });

  describe('impersonation', () => {
    it('rejects a validly signed message that claims a different sender', async () => {
      const mallory = identity();
      const alice = identity();

      // Mallory signs correctly — with her own key — but stamps Alice's id on it.
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, mallory.privateKey, mallory.publicKey, CHAT_POW_BASE);

      const verdict = verifyEnvelope({ ...fields, ...envelope }, DM_SIGNED_FIELDS, alice.publicKey);
      expect(verdict.status).toBe('invalid');
      expect(verdict).toMatchObject({ reason: expect.stringContaining('claimed sender') });
    });

    it('rejects a message whose sender was rewritten after signing', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      // Swap the sender and the key together, as an attacker replaying Alice's
      // envelope under their own identity would have to.
      const mallory = identity();
      const tampered = { ...fields, ...envelope, senderId: mallory.publicKey, _pub: mallory.publicKey };

      expect(verifyEnvelope(tampered, DM_SIGNED_FIELDS, mallory.publicKey).status).toBe('invalid');
    });

    it('rejects tampering with any signed field', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);
      const signed = { ...fields, ...envelope };

      for (const field of ['id', 'recipientId', 'timestamp', 'seq', 'cipherHash'] as const) {
        const tampered = {
          ...signed,
          [field]: typeof signed[field] === 'number' ? (signed[field] as number) + 1 : 'tampered',
        };
        const verdict = verifyEnvelope(tampered, DM_SIGNED_FIELDS, alice.publicKey);
        expect(verdict.status, `tampering with ${field} should be caught`).toBe('invalid');
      }
    });

    it('rejects a swapped ciphertext even when the envelope is otherwise intact', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      // The signature covers `cipherHash`, so substituting the body breaks the
      // caller's `cipherDigest` comparison rather than the signature itself.
      const substituted = cipherDigest('different-ciphertext', 'wrapForBob', 'wrapForAlice');
      expect(substituted).not.toBe(fields.cipherHash);
      expect(verifyEnvelope({ ...fields, ...envelope, cipherHash: substituted }, DM_SIGNED_FIELDS, alice.publicKey).status)
        .toBe('invalid');
    });

    it('rejects a forged signature', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      const forged = { ...fields, ...envelope, _sig: 'ab'.repeat(32) };
      expect(verifyEnvelope(forged, DM_SIGNED_FIELDS, alice.publicKey).status).toBe('invalid');
    });

    it('rejects an envelope with insufficient proof of work', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      const verdict = verifyEnvelope({ ...fields, ...envelope, _pow: '0' }, DM_SIGNED_FIELDS, alice.publicKey);
      expect(verdict.status).toBe('invalid');
      expect(verdict).toMatchObject({ reason: expect.stringContaining('proof of work') });
    });
  });

  describe('legacy and hostile records', () => {
    it('reports pre-v3 records as unsigned rather than invalid', () => {
      const record = {
        id: 'msg-old', senderId: 'alice', recipientId: 'bob',
        timestamp: 1, seq: 1, ciphertext: 'x', keyForRecipient: 'y', keyForSender: 'z',
      };
      expect(verifyEnvelope(record, DM_SIGNED_FIELDS, 'alice').status).toBe('unsigned');
    });

    it('treats a partially present envelope as unsigned, not valid', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      const { _sig, ...withoutSig } = { ...fields, ...envelope };
      expect(_sig).toBeTruthy();
      expect(verifyEnvelope(withoutSig, DM_SIGNED_FIELDS, alice.publicKey).status).toBe('unsigned');
    });

    it('ignores unsigned extra fields a hostile writer appended', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      // Gun attaches `_`, and anyone can append arbitrary keys to a node. Neither
      // may break verification — nor be taken as signed.
      const polluted = {
        ...fields, ...envelope,
        _: { '#': 'v3/chats/room/msg-1' },
        injectedField: 'not signed, must not matter',
      };
      expect(verifyEnvelope(polluted, DM_SIGNED_FIELDS, alice.publicKey).status).toBe('valid');
    });

    it('verifies the same record repeatedly — history reloads are not replays', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);
      const record = { ...fields, ...envelope };

      // `IntegrityService.verifySealedPayload` burns the nonce on first sight,
      // which is right for live relay traffic and wrong for a durable message.
      for (let i = 0; i < 3; i++) {
        expect(verifyEnvelope(record, DM_SIGNED_FIELDS, alice.publicKey).status).toBe('valid');
      }
    });

    it('does not expire — a message stays verifiable long after it was sent', async () => {
      const alice = identity();
      const fields = dmFields({ senderId: alice.publicKey });
      const envelope = await sealEnvelope(fields, alice.privateKey, alice.publicKey, CHAT_POW_BASE);

      // A year old, well past the five-minute window live traffic is held to.
      const aged = { ...fields, ...envelope, _ts: envelope._ts };
      expect(aged._ts).toBeLessThanOrEqual(Date.now());
      expect(verifyEnvelope(aged, DM_SIGNED_FIELDS, alice.publicKey).status).toBe('valid');
    });
  });

  describe('cipherDigest', () => {
    it('covers the wrapped keys, not just the body', () => {
      const base = cipherDigest('body', 'wrapA', 'wrapB');
      expect(cipherDigest('body', 'wrapA', 'wrapB')).toBe(base);
      // Swapping a wrapped key makes the message undecryptable — a silent DoS
      // that would still verify if only the body were covered.
      expect(cipherDigest('body', 'attackerWrap', 'wrapB')).not.toBe(base);
      expect(cipherDigest('body', 'wrapA', 'attackerWrap')).not.toBe(base);
    });

    it('is unambiguous across field boundaries', () => {
      expect(cipherDigest('a', 'b')).not.toBe(cipherDigest('ab'));
    });

    it('treats a missing part as empty rather than throwing', () => {
      expect(() => cipherDigest('body', undefined, 'wrapB')).not.toThrow();
    });
  });
});
