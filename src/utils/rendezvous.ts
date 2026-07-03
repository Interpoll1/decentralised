// Deterministic time-rotating rendezvous derivation — the "DGA" of InterPoll's
// resilience layer.
//
// Inspired by how the GameOver-Zeus P2P botnet stayed reachable under takedown
// pressure: when every hard-coded / gossiped endpoint is blocked, honest nodes
// fall back to a *domain-generation-algorithm*-style scheme where each node
// independently computes the SAME rotating rendezvous point for the current
// time window and reconverges there.
//
// Here that "rendezvous point" is not a registrable domain (this is a browser
// app and we never blindly probe generated hosts) but a Gun graph soul name.
// Every node that shares the protocol seed derives the same soul per epoch,
// publishes its *signed* presence announcement under it, and subscribes to it —
// so peers rediscover each other even when the fixed discovery root is being
// censored or flooded.
//
// This module is intentionally pure (no browser/service dependencies) so it can
// be unit-tested in isolation and reused from any layer.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Public protocol salt. NOT a secret in the cryptographic sense — presence at a
 * rendezvous soul proves nothing on its own (records still require a valid
 * signature). It only makes the rotation app-specific and unguessable-at-a-glance,
 * exactly like the seed baked into a botnet DGA. Bump the version suffix to force
 * a network-wide rendezvous rotation.
 */
export const RENDEZVOUS_SECRET = 'interpoll-rdv-v1';

/**
 * Length of a rendezvous window. Kept deliberately wide (6h → 4 windows/day) so
 * that honest nodes with modest clock skew still land on the same soul; the ±1
 * neighbour subscription (see {@link activeSouls}) is the safety margin around
 * epoch boundaries.
 */
export const EPOCH_MS = 6 * 60 * 60_000;

/** Hex length of a derived rendezvous soul (128 bits of SHA-256 is ample). */
const SOUL_HEX_LEN = 32;

/** Integer index of the rendezvous window containing `now`. */
export function currentEpoch(now: number = Date.now()): number {
  return Math.floor(now / EPOCH_MS);
}

/**
 * Deterministically derive the rendezvous soul for a given epoch. Every node
 * that shares {@link RENDEZVOUS_SECRET} computes the identical value, with no
 * coordination — this is the core of the reconvergence scheme.
 */
export function rendezvousSoul(epoch: number): string {
  const seed = `${RENDEZVOUS_SECRET}:${epoch}`;
  return bytesToHex(sha256(new TextEncoder().encode(seed))).slice(0, SOUL_HEX_LEN);
}

/**
 * The souls a node should be active on right now: the current epoch plus its two
 * neighbours. Publishing to and subscribing across all three means two peers who
 * straddle an epoch boundary (one just before, one just after) still meet on the
 * overlapping soul instead of missing each other for up to a full window.
 */
export function activeSouls(now: number = Date.now()): string[] {
  const epoch = currentEpoch(now);
  return [epoch - 1, epoch, epoch + 1].map(rendezvousSoul);
}
