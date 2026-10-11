// coturn REST-API ("use-auth-secret") credentials for 1:1 calls.
// username = "<unix-expiry>:<subject>", credential = base64(HMAC-SHA1(secret, username)).
// The shared secret lives only in TURN_SECRET on the relay and in coturn's config.
import crypto from 'crypto';

export function makeTurnCredentials(secret, subject, nowMs, ttlSec) {
  const username = `${Math.floor(nowMs / 1000) + ttlSec}:${subject}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential, ttl: ttlSec };
}

/** Stable, non-reversible subject for a user id or IP (never sent to coturn in the clear). */
export function turnSubject(id) {
  return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 32);
}
