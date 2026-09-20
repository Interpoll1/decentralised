import config from '../config';
import { currentUserId, signForRelay } from './relayIdentity';

/**
 * Email notification fallback (Resend, relay-side).
 *
 * FCM (`pushNotifications.ts`) stays the primary channel. This covers what it
 * cannot reach: the web build, a device that never registered a token, or a
 * token Firebase has dropped. The relay mails the address only when a chat
 * message arrives for a user it could not push to, at most once per cooldown
 * window — see `relay-push/email-notifications.js`.
 *
 * Strictly opt-in, and worth being honest with the user about why: an
 * InterPoll identity is a keypair with no real-world handle attached, and
 * handing the relay an address is the one action that ties the two together.
 * The relay stores it in plaintext keyed by public key, so an operator who
 * wanted to deanonymise opted-in users could. The mail itself carries no
 * message text and no sender name — only "you have a new message".
 *
 * The address is kept locally too, purely so Settings can show what is
 * currently registered without asking the relay (which would hand it a way to
 * probe which identities have addresses on file).
 */

const EMAIL_KEY = 'interpoll_email_notifications';

/** The address this device last registered, or '' if none. */
export function getEmailNotificationAddress(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) || '';
  } catch {
    return '';
  }
}

function rememberAddress(email: string): void {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
    else localStorage.removeItem(EMAIL_KEY);
  } catch { /* private mode — the display value just won't stick */ }
}

/**
 * Canonical strings signed for the relay's email endpoints.
 * Keep in sync with `relay-push/email-notifications.js`.
 */
function emailRegisterMessage(userId: string, email: string, ts: number): string {
  return `interpoll-email-register-1:${userId}:${email}:${ts}`;
}
function emailUnregisterMessage(userId: string, ts: number): string {
  return `interpoll-email-unregister-1:${userId}:${ts}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface EmailNotificationResult {
  ok: boolean;
  error?: string;
}

/**
 * Bind an address to this identity so the relay can mail it when push cannot
 * reach the user. Replaces any address previously registered for the identity.
 */
export async function registerEmailNotifications(email: string): Promise<EmailNotificationResult> {
  const address = email.trim();
  if (!EMAIL_RE.test(address)) return { ok: false, error: 'That does not look like an email address.' };

  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Your profile is not ready yet — try again in a moment.' };

  try {
    const ts  = Date.now();
    const sig = await signForRelay(emailRegisterMessage(userId, address, ts));

    const res = await fetch(`${config.relay.api}/api/push/email/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId, email: address, ts, sig }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `Relay rejected the address (${res.status}).` };
    }
    rememberAddress(address);
    return { ok: true };
  } catch (err) {
    console.warn('[Email] Registration failed', err);
    return { ok: false, error: 'Could not reach the relay.' };
  }
}

/** Stop the relay mailing this identity. Safe to call when nothing is registered. */
export async function unregisterEmailNotifications(): Promise<EmailNotificationResult> {
  const userId = await currentUserId();
  if (!userId) {
    // No identity to sign with — clear the local display value and move on.
    rememberAddress('');
    return { ok: true };
  }

  try {
    const ts  = Date.now();
    const sig = await signForRelay(emailUnregisterMessage(userId, ts));

    const res = await fetch(`${config.relay.api}/api/push/email/unregister`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId, ts, sig }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error || `Relay rejected the request (${res.status}).` };
    }
    rememberAddress('');
    return { ok: true };
  } catch (err) {
    console.warn('[Email] Unregistration failed', err);
    return { ok: false, error: 'Could not reach the relay.' };
  }
}

/**
 * Re-send the stored address, e.g. after a relay URL change puts us in front
 * of a relay that has never seen it. No-op when nothing is registered.
 */
export async function refreshEmailRegistration(): Promise<void> {
  const address = getEmailNotificationAddress();
  if (address) await registerEmailNotifications(address);
}
