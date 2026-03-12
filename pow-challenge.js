/**
 * pow-challenge.js — Hashcash-style proof-of-work challenge system for InterPoll.
 *
 * Adaptive difficulty based on bot score and spam penalty.
 * Challenges expire after 60 seconds and are single-use.
 */

import crypto from 'crypto';

const BASE_DIFFICULTY = 16;
const MIN_DIFFICULTY = 12;
const MAX_DIFFICULTY = 24;
const NEW_DEVICE_DIFFICULTY = 14;
const TRUSTED_THRESHOLD = 50;
const CHALLENGE_TTL_MS = 60_000;
const SECRET_ROTATION_MS = 24 * 60 * 60_000;
const MAX_USED_CHALLENGES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;
const MAX_CHALLENGE_ATTEMPTS = 5;
const TRUST_STALE_MS = 24 * 60 * 60_000; // 24 hours

const POW_REQUIRED_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);

function countLeadingZeroBits(hexHash) {
  let bits = 0;
  for (const ch of hexHash) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      bits += 4;
    } else {
      // Count leading zeros in this nibble (4-bit value)
      if (nibble < 2) bits += 3;
      else if (nibble < 4) bits += 2;
      else if (nibble < 8) bits += 1;
      break;
    }
  }
  return bits;
}

function adjustDifficulty(base, { botScore = 0, spamPenalty = 0 } = {}) {
  let difficulty = base;

  if (botScore > 80) difficulty += 8;
  else if (botScore > 60) difficulty += 6;
  else if (botScore > 30) difficulty += 4;

  difficulty += spamPenalty;

  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, difficulty));
}

export class PowChallenge {
  constructor() {
    this._serverSecret = crypto.randomBytes(32);
    this._secretCreatedAt = Date.now();

    /** @type {Map<string, { prefix: string, difficulty: number, deviceId: string, expiresAt: number, createdAt: number }>} */
    this._pending = new Map();

    /** @type {Set<string>} */
    this._used = new Set();
    this._usedOrder = [];

    /** @type {Map<string, { successCount: number, violationCount: number, lastSeen: number }>} */
    this._deviceTrust = new Map();

    this._cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  _rotateSecretIfNeeded() {
    if (Date.now() - this._secretCreatedAt > SECRET_ROTATION_MS) {
      this._serverSecret = crypto.randomBytes(32);
      this._secretCreatedAt = Date.now();
    }
  }

  _getBaseDifficulty(deviceId) {
    const trust = this._deviceTrust.get(deviceId);
    if (!trust) return NEW_DEVICE_DIFFICULTY;
    if (trust.successCount >= TRUSTED_THRESHOLD && trust.violationCount === 0) {
      return MIN_DIFFICULTY;
    }
    return BASE_DIFFICULTY;
  }

  _recordUsed(challengeId) {
    this._used.add(challengeId);
    this._usedOrder.push(challengeId);
    while (this._usedOrder.length > MAX_USED_CHALLENGES) {
      const oldest = this._usedOrder.shift();
      this._used.delete(oldest);
    }
  }

  /**
   * Create a new challenge for a device.
   * @param {string} deviceId
   * @param {string} action
   * @param {{ botScore?: number, spamPenalty?: number }} [opts]
   * @returns {{ challengeId: string, prefix: string, difficulty: number, expiresAt: number }}
   */
  createChallenge(deviceId, action, { botScore = 0, spamPenalty = 0 } = {}) {
    this._rotateSecretIfNeeded();

    const challengeId = crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    const prefix = crypto
      .createHash('sha256')
      .update(challengeId + deviceId + now.toString() + this._serverSecret.toString('hex'))
      .digest('hex');

    const base = this._getBaseDifficulty(deviceId);
    const difficulty = adjustDifficulty(base, { botScore, spamPenalty });
    const expiresAt = now + CHALLENGE_TTL_MS;

    this._pending.set(challengeId, {
      prefix,
      difficulty,
      deviceId,
      expiresAt,
      createdAt: now,
      attemptsLeft: MAX_CHALLENGE_ATTEMPTS,
    });

    // Update trust lastSeen
    const trust = this._deviceTrust.get(deviceId);
    if (trust) trust.lastSeen = now;

    return { challengeId, prefix, difficulty, expiresAt };
  }

  /**
   * Verify a PoW solution.
   * @param {string} challengeId
   * @param {number|string} nonce
   * @returns {{ valid: boolean, reason?: string }}
   */
  verify(challengeId, nonce) {
    if (!challengeId || nonce == null) {
      return { valid: false, reason: 'Missing challengeId or nonce' };
    }

    if (this._used.has(challengeId)) {
      return { valid: false, reason: 'Challenge already used' };
    }

    const challenge = this._pending.get(challengeId);
    if (!challenge) {
      return { valid: false, reason: 'Unknown or expired challenge' };
    }

    if (Date.now() > challenge.expiresAt) {
      this._pending.delete(challengeId);
      return { valid: false, reason: 'Challenge expired' };
    }

    const now = Date.now();

    const hash = crypto
      .createHash('sha256')
      .update(challenge.prefix + nonce.toString())
      .digest('hex');

    const zeroBits = countLeadingZeroBits(hash);
    if (zeroBits < challenge.difficulty) {
      // Always record the violation before checking attempts
      let trust = this._deviceTrust.get(challenge.deviceId);
      if (!trust) {
        trust = { successCount: 0, violationCount: 0, lastSeen: now };
        this._deviceTrust.set(challenge.deviceId, trust);
      }
      trust.violationCount++;
      trust.lastSeen = now;

      // Decrement remaining attempts
      challenge.attemptsLeft--;
      if (challenge.attemptsLeft <= 0) {
        this._pending.delete(challengeId);
        return { valid: false, reason: 'Max attempts exceeded' };
      }

      return { valid: false, reason: 'Insufficient proof-of-work' };
    }

    // Valid solution
    this._pending.delete(challengeId);
    this._recordUsed(challengeId);

    // Update device trust
    let trust = this._deviceTrust.get(challenge.deviceId);
    if (!trust) {
      trust = { successCount: 0, violationCount: 0, lastSeen: now };
      this._deviceTrust.set(challenge.deviceId, trust);
    }
    trust.successCount++;
    trust.lastSeen = now;

    return { valid: true };
  }

  /**
   * Check if a message type requires PoW.
   * @param {string} messageType
   * @param {string} [actionType]
   * @returns {boolean}
   */
  requiresPow(messageType, actionType) {
    if (!POW_REQUIRED_TYPES.has(messageType)) return false;
    if (messageType === 'new-block' && actionType && actionType !== 'post-create') {
      return false;
    }
    return true;
  }

  /**
   * Get device trust level.
   * @param {string} deviceId
   * @returns {{ successCount: number, violationCount: number, trusted: boolean }}
   */
  getDeviceTrust(deviceId) {
    const trust = this._deviceTrust.get(deviceId) || { successCount: 0, violationCount: 0 };
    return {
      ...trust,
      trusted: trust.successCount >= TRUSTED_THRESHOLD && trust.violationCount === 0,
    };
  }

  /** Remove expired challenges and stale trust entries. */
  cleanup() {
    const now = Date.now();
    for (const [id, challenge] of this._pending) {
      if (now > challenge.expiresAt) {
        this._pending.delete(id);
      }
    }
    // Remove trust entries with no activity for 24 hours
    for (const [deviceId, trust] of this._deviceTrust) {
      if (trust.lastSeen && now - trust.lastSeen > TRUST_STALE_MS) {
        this._deviceTrust.delete(deviceId);
      }
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this._pending.clear();
    this._used.clear();
    this._usedOrder.length = 0;
    this._deviceTrust.clear();
  }
}
