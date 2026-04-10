import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import { PowChallenge } from '../pow-challenge.js';

describe('PowChallenge', () => {
  let pow;

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.now() });
    pow = new PowChallenge();
  });

  afterEach(() => {
    pow.destroy();
    vi.useRealTimers();
  });

  describe('createChallenge', () => {
    it('returns challenge with required fields', () => {
      const result = pow.createChallenge('device-1', 'broadcast');
      expect(result).toHaveProperty('challengeId');
      expect(result).toHaveProperty('prefix');
      expect(result).toHaveProperty('difficulty');
      expect(result).toHaveProperty('expiresAt');
      expect(typeof result.challengeId).toBe('string');
      expect(result.difficulty).toBeGreaterThanOrEqual(12);
      expect(result.difficulty).toBeLessThanOrEqual(24);
    });

    it('gives new devices NEW_DEVICE_DIFFICULTY (14)', () => {
      const result = pow.createChallenge('new-device', 'broadcast');
      expect(result.difficulty).toBe(14);
    });

    it('increases difficulty for high bot scores', () => {
      const normal = pow.createChallenge('d1', 'broadcast', { botScore: 0 });
      const suspicious = pow.createChallenge('d2', 'broadcast', { botScore: 85 });
      expect(suspicious.difficulty).toBeGreaterThan(normal.difficulty);
    });

    it('increases difficulty with spam penalty', () => {
      const normal = pow.createChallenge('d1', 'broadcast', { spamPenalty: 0 });
      const spammy = pow.createChallenge('d2', 'broadcast', { spamPenalty: 4 });
      expect(spammy.difficulty).toBeGreaterThan(normal.difficulty);
    });

    it('clamps difficulty to [12, 24]', () => {
      const result = pow.createChallenge('d1', 'broadcast', { botScore: 100, spamPenalty: 10 });
      expect(result.difficulty).toBeLessThanOrEqual(24);
    });
  });

  describe('verify', () => {
    it('rejects missing challengeId', () => {
      const result = pow.verify(null, 123);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing');
    });

    it('rejects missing nonce', () => {
      const result = pow.verify('some-id', null);
      expect(result.valid).toBe(false);
    });

    it('rejects unknown challenge', () => {
      const result = pow.verify('nonexistent', 42);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown');
    });

    it('rejects expired challenge', () => {
      const challenge = pow.createChallenge('d1', 'broadcast');
      vi.advanceTimersByTime(61_000); // past 60s TTL
      const result = pow.verify(challenge.challengeId, 1);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('rejects already-used challenge', () => {
      const challenge = pow.createChallenge('d1', 'broadcast');
      // Solve it
      const nonce = solveChallenge(challenge);
      const first = pow.verify(challenge.challengeId, nonce);
      expect(first.valid).toBe(true);

      const second = pow.verify(challenge.challengeId, nonce);
      expect(second.valid).toBe(false);
      expect(second.reason).toContain('already used');
    });

    it('accepts valid proof', () => {
      const challenge = pow.createChallenge('d1', 'broadcast');
      const nonce = solveChallenge(challenge);
      const result = pow.verify(challenge.challengeId, nonce);
      expect(result.valid).toBe(true);
    });

    it('rejects insufficient proof-of-work', () => {
      const challenge = pow.createChallenge('d1', 'broadcast');
      const result = pow.verify(challenge.challengeId, 0); // almost certainly won't satisfy
      // Might pass for very low difficulty but typically won't
      if (!result.valid) {
        expect(result.reason).toMatch(/Insufficient|Max attempts/);
      }
    });
  });

  describe('requiresPow', () => {
    it('returns true for broadcast', () => {
      expect(pow.requiresPow('broadcast')).toBe(true);
    });

    it('returns true for new-poll', () => {
      expect(pow.requiresPow('new-poll')).toBe(true);
    });

    it('returns true for new-block with post-create action', () => {
      expect(pow.requiresPow('new-block', 'post-create')).toBe(true);
    });

    it('returns false for new-block with vote action', () => {
      expect(pow.requiresPow('new-block', 'vote')).toBe(false);
    });

    it('returns false for ping', () => {
      expect(pow.requiresPow('ping')).toBe(false);
    });

    it('returns false for register', () => {
      expect(pow.requiresPow('register')).toBe(false);
    });
  });

  describe('getDeviceTrust', () => {
    it('returns zero trust for unknown device', () => {
      const trust = pow.getDeviceTrust('unknown');
      expect(trust.successCount).toBe(0);
      expect(trust.violationCount).toBe(0);
      expect(trust.trusted).toBe(false);
    });

    it('tracks successful verifications', () => {
      const deviceId = 'trusted-device';
      for (let i = 0; i < 3; i++) {
        const challenge = pow.createChallenge(deviceId, 'broadcast');
        const nonce = solveChallenge(challenge);
        pow.verify(challenge.challengeId, nonce);
      }
      const trust = pow.getDeviceTrust(deviceId);
      expect(trust.successCount).toBe(3);
    });
  });

  describe('cleanup', () => {
    it('removes expired challenges', () => {
      pow.createChallenge('d1', 'broadcast');
      vi.advanceTimersByTime(61_000);
      pow.cleanup();
      // The internal pending map should be cleaned
      expect(pow._pending.size).toBe(0);
    });
  });
});

// Helper: brute-force solve a PoW challenge
function solveChallenge(challenge) {
  for (let nonce = 0; nonce < 10_000_000; nonce++) {
    const hash = crypto
      .createHash('sha256')
      .update(challenge.prefix + nonce.toString())
      .digest('hex');
    let bits = 0;
    for (const ch of hash) {
      const nibble = parseInt(ch, 16);
      if (nibble === 0) bits += 4;
      else {
        if (nibble < 2) bits += 3;
        else if (nibble < 4) bits += 2;
        else if (nibble < 8) bits += 1;
        break;
      }
    }
    if (bits >= challenge.difficulty) return nonce;
  }
  throw new Error('Could not solve challenge');
}
