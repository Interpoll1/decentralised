// bundle-auth.js — server-side verification of authenticated DM signal bundles.
//
// Mirrors verifyAuthenticatedBundle() in src/services/dmIdentity.ts. A bundle is
// accepted only if the account key (the 64-hex userId) signed the device binding,
// and the binding's identity signing key signed the SPK and every OPK. This makes
// the bundle itself the proof of ownership, so the relay no longer has to trust
// "a WS client with that userId is online".
import { webcrypto } from 'node:crypto';
import { verifyRawSchnorr } from '../shared-validation/signatures.js';

const { subtle } = webcrypto;
const UUID    = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT = /^[0-9a-f]{64}$/;
const isPosInt = (n) => Number.isSafeInteger(n) && n > 0;
const canonical = (fields) => JSON.stringify(fields);

const bindingBytes = (b) => canonical(['interpoll/dm/device-binding', 1, b.accountId, b.deviceId, b.generation, b.ik, b.ikSignPub, 'dm-auth-v1']);
const spkBytes = (b) => canonical(['interpoll/dm/spk', 1, b.binding.accountId, b.binding.deviceId, b.binding.generation, b.ik, b.ikSignPub, b.spkId, b.spkGeneration, b.spk]);
const opkBytes = (b, opk) => canonical(['interpoll/dm/opk', 1, b.binding.accountId, b.binding.deviceId, b.binding.generation, b.ik, b.spkId, b.spkGeneration, opk.id, opk.pub]);

function bytes(value, length) {
  if (typeof value !== 'string') throw new Error('Missing key/signature encoding');
  const buf = Buffer.from(value, 'base64');
  if (buf.length !== length || buf.toString('base64') !== value) throw new Error('Noncanonical key/signature encoding');
  return buf;
}

async function verifyEcdsa(pub, payload, signature) {
  const key = await subtle.importKey('raw', bytes(pub, 65), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(signature, 64), new TextEncoder().encode(payload));
  if (!ok) throw new Error('Unauthorized prekey');
}

/** Throws unless `b` is a fully signed bundle for account `expectedAccount`. */
export async function verifyAuthenticatedBundle(b, expectedAccount) {
  const bind = b?.binding;
  if (b?.version !== 1 || !bind) throw new Error('Authenticated bundle required');
  if (bind.version !== 1 || !ACCOUNT.test(expectedAccount) || bind.accountId !== expectedAccount ||
      !UUID.test(bind.deviceId) || !isPosInt(bind.generation) || bind.capabilities !== 'dm-auth-v1' ||
      !/^[0-9a-f]{128}$/.test(bind.signature)) throw new Error('Invalid account/device binding');
  await subtle.importKey('raw', bytes(bind.ik, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  await subtle.importKey('raw', bytes(bind.ikSignPub, 65), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!verifyRawSchnorr(bindingBytes(bind), bind.signature, expectedAccount)) throw new Error('Account did not authorize messaging identity');
  if (b.ik !== bind.ik || b.ikSignPub !== bind.ikSignPub || !UUID.test(b.spkId) || !isPosInt(b.spkGeneration))
    throw new Error('SPK subject mismatch');
  await subtle.importKey('raw', bytes(b.spk, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  await verifyEcdsa(b.ikSignPub, spkBytes(b), b.spkAuthorization);
  if (!Array.isArray(b.opks) || b.opks.length > 1000 || !('selectedOPK' in b)) throw new Error('Explicit OPK choice required');
  const ids = new Set();
  for (const opk of b.opks) {
    if (!opk || !UUID.test(opk.id) || ids.has(opk.id)) throw new Error('Invalid OPK identity');
    ids.add(opk.id);
    await subtle.importKey('raw', bytes(opk.pub, 65), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    await verifyEcdsa(b.ikSignPub, opkBytes(b, opk), opk.signature);
  }
  if (b.selectedOPK !== null) {
    const opk = b.opks.find(p => p.id === b.selectedOPK?.id);
    if (!opk || opk.pub !== b.selectedOPK.pub || opk.signature !== b.selectedOPK.signature || b.opkId !== opk.id || b.opk !== opk.pub)
      throw new Error('OPK selection mismatch');
  } else if (b.opkId || b.opk) throw new Error('No-OPK transcript mismatch');
}

/** True if `next` would roll the stored bundle back to an older device/SPK generation. */
export function isRollback(storedJson, next) {
  if (!storedJson) return false;
  let prev; try { prev = JSON.parse(storedJson); } catch { return false; }
  const pg = prev?.binding?.generation ?? 0, ng = next.binding.generation;
  // A different device is a reinstall/new phone whose generation may restart — allow it.
  if (prev?.binding?.deviceId !== next.binding.deviceId) return false;
  return ng < pg || (ng === pg && next.spkGeneration < (prev.spkGeneration ?? 0));
}
