/**
 * pow-server-patch.js — Relay server patch for client-generated PoW
 *
 * HOW TO INTEGRATE:
 * ─────────────────
 * 1. Copy this file to the same directory as relay-server-enhanced.js
 * 2. In relay-server-enhanced.js, add at the top:
 *      import { verifyPoWClientOrServer } from './pow-server-patch.js';
 *    (or require() if using CommonJS)
 * 3. Find the existing PoW verification block. It will look something like:
 *      const challenge = activeChallenges.get(proof.challengeId);
 *      if (!challenge) { reject(ws, 'Unknown challenge'); return; }
 *      ... hash check ...
 *    Replace it with:
 *      const result = verifyPoWClientOrServer(proof, activeChallenges);
 *      if (!result.ok) { sendError(ws, 403, result.reason); return; }
 * 4. Set environment variable: CLIENT_POW_DIFFICULTY=16
 *
 * BACKWARD COMPATIBILITY:
 * ───────────────────────
 * This patch accepts BOTH:
 *   A) Original flow: relay issues challenge → client solves → submits
 *   B) New flow:      client generates challenge deterministically → solves → submits
 *
 * Old clients continue to work unchanged (Path A).
 * New clients skip the challenge request round-trip (Path B).
 *
 * SECURITY:
 * ─────────
 * - Client challenges are bound to contentHash so they can't be reused on different content
 * - The 30s window prevents pre-mining for the far future
 * - The existing ReplayProtector still catches duplicate submissions regardless of challenge path
 * - Difficulty is the same for both paths (CLIENT_POW_DIFFICULTY env var)
 */

import crypto from 'crypto';

const CLIENT_POW_DIFFICULTY = parseInt(process.env.CLIENT_POW_DIFFICULTY || '16', 10);
const CHALLENGE_WINDOW_MS   = 30_000;
const MAX_CLOCK_SKEW_MS     = 60_000; // accept proofs from up to 2 windows back

function sha256hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function countLeadingZeroBits(hex) {
  let bits = 0;
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    if (n === 0) { bits += 4; continue; }
    if (n < 2) bits += 3;
    else if (n < 4) bits += 2;
    else if (n < 8) bits += 1;
    break;
  }
  return bits;
}

/**
 * Verify a PoW proof — accepts both server-issued and client-generated challenges.
 *
 * @param {object} proof
 *   proof.challengeId  — the challenge ID (required)
 *   proof.nonce        — the solved nonce (required)
 *   proof.contentHash  — content hash used for client-side challenge (Path B only)
 *   proof.windowTs     — window timestamp used for client-side challenge (Path B only)
 *   proof.clientGenerated — boolean hint from client (Path B)
 *
 * @param {Map} serverChallenges
 *   The relay's existing in-memory challenge store (Map<challengeId, {prefix, difficulty, expiresAt}>)
 *   Pass null if the relay doesn't use a Map (adjust to match your relay's data structure).
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyPoWClientOrServer(proof, serverChallenges) {
  const { challengeId, nonce, contentHash, windowTs } = proof || {};

  if (!challengeId || typeof nonce !== 'number') {
    return { ok: false, reason: 'Missing challengeId or nonce' };
  }

  // ── Path A: server-issued challenge (original flow) ────────────────────────
  if (serverChallenges && serverChallenges.has(challengeId)) {
    const challenge = serverChallenges.get(challengeId);

    if (Date.now() > challenge.expiresAt) {
      serverChallenges.delete(challengeId);
      return { ok: false, reason: 'Challenge expired' };
    }

    const hash = sha256hex(challenge.prefix + nonce.toString());
    if (countLeadingZeroBits(hash) < challenge.difficulty) {
      return { ok: false, reason: `Insufficient PoW difficulty (need ${challenge.difficulty})` };
    }

    serverChallenges.delete(challengeId); // single-use
    return { ok: true };
  }

  // ── Path B: client-generated challenge (offline / decentralised flow) ──────
  if (!contentHash || typeof windowTs !== 'number') {
    return { ok: false, reason: 'Unknown challenge — not in server store and missing contentHash/windowTs for client-mode PoW' };
  }

  // Clock skew check
  const now = Date.now();
  if (Math.abs(now - windowTs) > MAX_CLOCK_SKEW_MS + CHALLENGE_WINDOW_MS) {
    return { ok: false, reason: `Timestamp too stale (skew: ${Math.abs(now - windowTs)}ms, max: ${MAX_CLOCK_SKEW_MS + CHALLENGE_WINDOW_MS}ms)` };
  }

  // Try current window and one previous window (handles boundary cases)
  const windowsToCheck = [
    Math.floor(windowTs / CHALLENGE_WINDOW_MS) * CHALLENGE_WINDOW_MS,
    Math.floor((windowTs - CHALLENGE_WINDOW_MS) / CHALLENGE_WINDOW_MS) * CHALLENGE_WINDOW_MS,
  ];

  for (const wTs of windowsToCheck) {
    const expectedId = sha256hex(JSON.stringify({ contentHash, windowTs: wTs }));
    if (challengeId !== expectedId) continue;

    const prefix = expectedId.slice(0, 32);
    const hash   = sha256hex(prefix + nonce.toString());

    if (countLeadingZeroBits(hash) < CLIENT_POW_DIFFICULTY) {
      return { ok: false, reason: `Insufficient client PoW difficulty (need ${CLIENT_POW_DIFFICULTY}, got ${countLeadingZeroBits(hash)})` };
    }

    return { ok: true };
  }

  return { ok: false, reason: 'Client-generated challengeId does not match expected for given contentHash + windowTs' };
}

/**
 * Convenience: check if a message type requires PoW.
 * Mirrors PowService.requiresProof() on the client.
 */
export function requiresPoW(messageType, actionType) {
  const POW_TYPES = new Set(['broadcast', 'new-poll', 'new-block']);
  if (!POW_TYPES.has(messageType)) return false;
  if (messageType === 'new-block' && actionType && actionType !== 'post-create') return false;
  return true;
}
