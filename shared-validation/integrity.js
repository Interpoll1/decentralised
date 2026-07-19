import crypto from 'crypto';
import { canonicalJSON, stableStringify, META_FIELDS } from './canonical.js';

export { canonicalJSON, stableStringify, META_FIELDS };

export function computeHash(obj) {
  const canonical = canonicalJSON(obj);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function verifyContentHash(message) {
  if (!message || typeof message !== 'object') return false;
  if (!message._hash || typeof message._hash !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(message._hash)) return false;
  try {
    const expected = computeHash(message);
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(message._hash, 'hex')
    );
  } catch {
    return false;
  }
}
