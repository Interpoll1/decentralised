// payments-api/split.mjs — server-side port of src/utils/contributionSplit.ts
// and the signature scheme in src/services/cryptoService.ts. Kept in sync by
// unit_tests/paymentsParity.test.ts.
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1.js';

export const TOTAL_BPS = 10_000;
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

export const hash = (s) => bytesToHex(sha256(new TextEncoder().encode(s)));

/** Same as CryptoService.verify(CryptoService.hash(payload), sig, pub). */
export function verifySigned(payload, signature, pubkey) {
  try {
    return schnorr.verify(hexToBytes(signature), hexToBytes(hash(hash(payload))), hexToBytes(pubkey));
  } catch { return false; }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function splitContentPayload(v) {
  const entries = [...v.entries]
    .sort((a, b) => a.contributorId.localeCompare(b.contributorId))
    .map(({ contributorId, role, shareBps }) => ({ contributorId, role, shareBps }));
  return canonicalJson({
    v: 1, type: 'contribution-split', workId: v.workId, workKind: v.workKind,
    version: v.version, entries, proposedBy: v.proposedBy, proposedAt: v.proposedAt, prevHash: v.prevHash,
  });
}

export function acceptancePayload(a) {
  const { signature: _s, ...rest } = a;
  return canonicalJson({ v: 1, type: 'contribution-acceptance', ...rest });
}

export function verifyAcceptance(a) {
  if (!a?.signature || !a.pubkey) return false;
  if (HEX_PUBKEY.test(a.contributorId) && a.contributorId.toLowerCase() !== a.pubkey.toLowerCase()) return false;
  return verifySigned(acceptancePayload(a), a.signature, a.pubkey);
}

export function validateSplit(entries) {
  if (!Array.isArray(entries) || !entries.length) return false;
  const ids = new Set();
  let total = 0;
  for (const e of entries) {
    if (!e.contributorId || ids.has(e.contributorId) || !Number.isInteger(e.shareBps) || e.shareBps < 0) return false;
    ids.add(e.contributorId); total += e.shareBps;
  }
  return total === TOTAL_BPS;
}

/** Verify a full version history and return the current version, or null. */
export function verifyHistory(history) {
  const sorted = [...(history || [])].sort((a, b) => a.version - b.version);
  if (!sorted.length) return null;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (v.version !== i + 1 || v.prevHash !== (i === 0 ? '' : sorted[i - 1].hash)) return null;
    if (!validateSplit(v.entries)) return null;
    const { hash: h, ...rest } = v;
    if (hash(splitContentPayload(rest)) !== h) return null;
  }
  return sorted[sorted.length - 1];
}

export function acceptanceStates(version, acceptances) {
  const states = new Map(version.entries.map((e) => [e.contributorId, 'pending']));
  const latest = new Map();
  for (const a of acceptances || []) {
    if (a.workId !== version.workId || a.version !== version.version || a.versionHash !== version.hash) continue;
    if (!states.has(a.contributorId) || !verifyAcceptance(a)) continue;
    const prev = latest.get(a.contributorId);
    if (!prev || a.at > prev.at) latest.set(a.contributorId, a);
  }
  for (const [id, a] of latest) states.set(id, a.state);
  return states;
}

export function splitStatus(version, acceptances) {
  const s = [...acceptanceStates(version, acceptances).values()];
  if (s.some((x) => x === 'disputed' || x === 'declined')) return 'disputed';
  return s.every((x) => x === 'accepted') ? 'active' : 'draft';
}

/** Largest-remainder split of `amount` by basis points. */
export function apportion(amount, entries) {
  const raw = entries.map((e) => (amount * e.shareBps) / TOTAL_BPS);
  const out = raw.map(Math.floor);
  let rem = amount - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  return out;
}

export function allocate({ grossCents, feeCents, platformBps }, version) {
  const net = Math.max(0, grossCents - feeCents);
  const platformCents = Math.floor((net * platformBps) / TOTAL_BPS);
  const distributable = net - platformCents;
  const amounts = apportion(distributable, version.entries);
  return {
    net, platformCents, distributable,
    lines: version.entries.map((e, i) => ({ contributorId: e.contributorId, displayName: e.displayName, role: e.role, shareBps: e.shareBps, amountCents: amounts[i] })),
  };
}
