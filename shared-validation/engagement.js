import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const ACTION_MAX_AGE_MS = 300_000;
export const ACTION_FUTURE_SKEW_MS = 30_000;
const fields = ['version', 'namespace', 'kind', 'actor', 'targetType', 'targetId', 'value', 'createdAt', 'nonce', 'id', 'signature'];
const hex = (s, size) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${size}}$`).test(s);
// Existing MySQL identifiers compare case-insensitively. Fail closed on mixed
// case rather than let two signed targets alias the same durable SQL row.
const target = s => typeof s === 'string' && /^[a-z0-9_.:-]{1,128}$/.test(s);
const digest = text => bytesToHex(sha256(new TextEncoder().encode(text)));

export function actionBytes(a) {
  return JSON.stringify(['interpoll.public-engagement.v1', 1, a.namespace, a.kind, a.actor, a.targetType, a.targetId, a.value, a.createdAt, a.nonce]);
}
function validPayload(a) {
  return a && a.version === 1 && typeof a.namespace === 'string' && /^v[1-9][0-9]{0,3}$/.test(a.namespace) && hex(a.actor, 64) && target(a.targetId)
    && Number.isSafeInteger(a.createdAt) && a.createdAt >= 0 && hex(a.nonce, 32)
    && ((a.kind === 'reaction' && ['post', 'comment'].includes(a.targetType) && ['up', 'down', 'none'].includes(a.value))
      || (a.kind === 'view' && ['post', 'poll'].includes(a.targetType) && a.value === 'view'));
}
export function signAction(payload, privateKey) {
  const a = { version: 1, ...payload };
  if (!validPayload(a) || bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey))) !== a.actor) throw new Error('ACTION_IDENTITY_MISMATCH');
  const id = digest(actionBytes(a));
  const signed = { ...a, id, signature: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKey))) };
  if (!verifyAction(signed, { fresh: false })) throw new Error('INVALID_ACTION');
  return Object.freeze(signed);
}
export function verifyAction(a, { now = Date.now(), fresh = true, namespace, actor, targetType, targetId } = {}) {
  try {
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).length !== fields.length
      || !fields.every(f => Object.prototype.hasOwnProperty.call(a, f)) || !validPayload(a)
      || !hex(a.id, 64) || !hex(a.signature, 128)) return false;
    if ((namespace !== undefined && namespace !== a.namespace) || (actor !== undefined && actor !== a.actor) || (targetType !== undefined && targetType !== a.targetType)
      || (targetId !== undefined && targetId !== a.targetId)) return false;
    if (fresh && (!Number.isSafeInteger(now) || a.createdAt < now - ACTION_MAX_AGE_MS || a.createdAt > now + ACTION_FUTURE_SKEW_MS)) return false;
    return digest(actionBytes(a)) === a.id && schnorr.verify(hexToBytes(a.signature), hexToBytes(a.id), hexToBytes(a.actor));
  } catch { return false; }
}
export function readAction(envelope, expected = {}) {
  if (typeof envelope !== 'string' || envelope.length > 2048) return null;
  try { const a = JSON.parse(envelope); return verifyAction(a, expected) ? a : null; } catch { return null; }
}
export function reactionSoul(a, namespace) {
  return `${namespace}/${a.targetType === 'post' ? 'postVotes' : 'commentVotes'}/${a.targetId}/${a.actor}`;
}
export function protectedReactionSoul(soul) {
  // Includes legacy namespaces: they cannot launder unsigned writes into v1.
  return typeof soul === 'string' && /(^|\/)(postVotes|commentVotes)(\/|$)/.test(soul);
}
export function actionForSoul(soul, envelope, namespace, options = {}) {
  const a = readAction(envelope, { ...options, namespace });
  return a?.kind === 'reaction' && reactionSoul(a, namespace) === soul ? a : null;
}
export function compareActions(a, b) {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
