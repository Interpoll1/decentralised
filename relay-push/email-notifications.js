/**
 * Resend email fallback for the InterPoll relay.
 *
 * Companion to `push-notifications.js`. FCM stays the primary channel; this
 * covers the cases FCM cannot: the web build (no native push), a device that
 * never registered a token, or a token FCM has dropped. `attachPush` wires
 * this in automatically when RESEND_API_KEY is set — see docs/push-notifications.md.
 *
 * ── Authentication ────────────────────────────────────────────────────────
 * Identical to the FCM registration path: `userId` IS the x-only Schnorr
 * public key and the client signs (userId, email, ts) with the matching
 * private key, so nobody can bind an address to an identity they do not own,
 * or unbind someone else's.
 *
 * ── Privacy ───────────────────────────────────────────────────────────────
 * This is the one place the relay learns something durable and real-world
 * about an identity. Two consequences worth stating plainly:
 *
 *   • The address sits in a plaintext JSON file keyed by public key, so a
 *     relay operator (or anyone who takes the box) can deanonymise every
 *     user who opted in. Registration is therefore strictly opt-in and the
 *     client never enrols an address on its own.
 *   • The mail itself leaks metadata to the mail provider and to the
 *     recipient's inbox: that a message arrived, and roughly when. It never
 *     carries the message text — chat is end-to-end encrypted and the relay
 *     cannot read it — nor the sender's display name, which would leak the
 *     social graph to Resend. The mail says only "you have a new message".
 *
 * Addresses are NOT verified on registration. The abuse ceiling is low (an
 * attacker can only point their own identity at someone else's inbox, and
 * the per-recipient cooldown caps the volume at a few mails an hour), but
 * every mail carries a signed one-click unsubscribe link so a victim can cut
 * it off without an account. Add a confirm-link flow if you need more.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Don't mail the same person more than once per window, however many messages arrive. */
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

/** Deliberately permissive — we are not the authority on what a valid address looks like. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;

/** Persisted map: userId -> { email, updatedAt, lastSentAt }. */
class EmailStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.users    = new Map();
    this.secret   = '';
    this.load();
    if (!this.secret) {
      // Persisted rather than per-boot so unsubscribe links in already-sent
      // mail keep working across relay restarts.
      this.secret = crypto.randomBytes(32).toString('hex');
      this.save();
    }
  }

  load() {
    try {
      const obj = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.secret = typeof obj.secret === 'string' ? obj.secret : '';
      for (const [userId, rec] of Object.entries(obj.users || {})) this.users.set(userId, rec);
    } catch { /* first run — no file yet */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(
        this.filePath,
        JSON.stringify({ secret: this.secret, users: Object.fromEntries(this.users) }, null, 2),
        { mode: 0o600 },
      );
    } catch (err) {
      console.warn('[Email] Could not persist address store:', err.message);
    }
  }

  register(userId, email) {
    const prev = this.users.get(userId);
    this.users.set(userId, {
      email,
      updatedAt:  Date.now(),
      // Changing address clears the cooldown; re-registering the same one does not,
      // so a re-register loop cannot be used to bypass the rate limit.
      lastSentAt: prev && prev.email === email ? prev.lastSentAt || 0 : 0,
    });
    this.save();
  }

  unregister(userId) {
    if (!this.users.delete(userId)) return false;
    this.save();
    return true;
  }

  emailFor(userId) {
    const rec = this.users.get(userId);
    return rec ? rec.email : '';
  }

  /** @returns {boolean} true if a mail may go out now (and records the send). */
  claimSendSlot(userId, cooldownMs) {
    const rec = this.users.get(userId);
    if (!rec) return false;
    const now = Date.now();
    if (rec.lastSentAt && now - rec.lastSentAt < cooldownMs) return false;
    rec.lastSentAt = now;
    this.save();
    return true;
  }

  /** Signed so an unsubscribe link cannot be forged for an arbitrary identity. */
  unsubscribeToken(userId) {
    const mac = crypto.createHmac('sha256', this.secret).update(userId).digest('hex').slice(0, 32);
    return `${userId}.${mac}`;
  }

  /** @returns {string} the userId the token attests to, or '' if it does not verify. */
  verifyUnsubscribeToken(token) {
    if (typeof token !== 'string') return '';
    const dot = token.lastIndexOf('.');
    if (dot <= 0) return '';
    const userId = token.slice(0, dot);
    const expected = this.unsubscribeToken(userId);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return '';
    return userId;
  }
}

class ResendSender {
  constructor({ apiKey, from }) {
    this.apiKey = apiKey;
    this.from   = from;
  }

  /** @returns {Promise<'ok'|'stale'|'error'>} */
  async send({ to, subject, text, html, headers }) {
    let res;
    try {
      res = await fetch(RESEND_ENDPOINT, {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to: [to], subject, text, html, headers }),
      });
    } catch (err) {
      console.warn('[Email] Resend request failed:', err.message);
      return 'error';
    }
    if (res.ok) return 'ok';
    // 422 is Resend's "this address is not deliverable / is suppressed".
    if (res.status === 422) return 'stale';
    console.warn('[Email] Resend send failed:', res.status, await res.text().catch(() => ''));
    return 'error';
  }
}

/** Canonical strings the client signs. Keep in sync with src/native/emailNotifications.ts. */
function emailRegisterMessage({ userId, email, ts }) {
  return `interpoll-email-register-1:${userId}:${email}:${ts}`;
}
function emailUnregisterMessage({ userId, ts }) {
  return `interpoll-email-unregister-1:${userId}:${ts}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function buildMail({ appUrl, unsubscribeUrl }) {
  const open = `${appUrl.replace(/\/+$/, '')}/chat`;
  const text = [
    'You have a new message waiting on InterPoll.',
    '',
    `Open it: ${open}`,
    '',
    'The message itself is end-to-end encrypted — it can only be read in the app,',
    'and this relay never sees its contents or who sent it.',
    '',
    `Stop these emails: ${unsubscribeUrl}`,
  ].join('\n');

  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111">',
    '<p>You have a new message waiting on InterPoll.</p>',
    `<p><a href="${escapeHtml(open)}" style="display:inline-block;padding:10px 18px;`,
    'background:#4f46e5;color:#fff;border-radius:6px;text-decoration:none">Open InterPoll</a></p>',
    '<p style="color:#555;font-size:13px">The message itself is end-to-end encrypted — it can ',
    'only be read in the app, and this relay never sees its contents or who sent it.</p>',
    `<p style="color:#888;font-size:12px"><a href="${escapeHtml(unsubscribeUrl)}">`,
    'Stop these emails</a></p>',
    '</div>',
  ].join('');

  return { text, html };
}

/**
 * Build the email fallback. Returns `null` when unconfigured, so callers can
 * treat "no Resend key" as simply "no fallback" rather than a failure.
 *
 * @param {import('express').Express} app
 * @param {{
 *   apiKey?: string, from?: string, appUrl?: string, storePath?: string,
 *   cooldownMs?: number, json?: () => Function, guard?: (req, res) => boolean,
 *   authenticate?: (req, buildMessage, extraFields) => object,
 * }} opts
 */
function attachEmailFallback(app, opts = {}) {
  const apiKey = opts.apiKey || process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    console.log('[Email] No RESEND_API_KEY — email fallback disabled');
    return null;
  }

  const from   = opts.from   || process.env.RESEND_FROM   || 'InterPoll <notifications@endless.sbs>';
  const appUrl = opts.appUrl || process.env.APP_PUBLIC_URL || process.env.FRONTEND_ORIGIN
    || 'https://endless.sbs';
  // The open-the-app link points at the frontend; the unsubscribe link has to
  // point at this relay, which is a different origin in every real deployment.
  const relayUrl = opts.relayUrl || process.env.SERVER_ORIGIN || appUrl;
  const storePath = opts.storePath || process.env.EMAIL_STORE || './push-emails.json';
  const cooldownMs = Number(opts.cooldownMs || process.env.EMAIL_COOLDOWN_MS || DEFAULT_COOLDOWN_MS);

  const store  = new EmailStore(storePath);
  const sender = new ResendSender({ apiKey, from });
  const json   = opts.json || (() => (req, _res, next) => next());
  const guard  = opts.guard || (() => true);
  const authenticate = opts.authenticate;

  if (typeof authenticate !== 'function') {
    throw new Error('attachEmailFallback requires the relay authenticate() helper');
  }

  console.log(`[Email] Resend fallback enabled, from ${from}`);

  app.post('/api/push/email/register', json(), (req, res) => {
    if (!guard(req, res)) return;

    const auth = authenticate(req, emailRegisterMessage, { email: MAX_EMAIL_LEN });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const email = String(auth.body.email).trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'email is not a valid address' });
    }
    store.register(auth.body.userId, email);
    res.json({ ok: true });
  });

  app.post('/api/push/email/unregister', json(), (req, res) => {
    if (!guard(req, res)) return;

    const auth = authenticate(req, emailUnregisterMessage, {});
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Silent success for an unknown user — the caller already proved who they
    // are, and there is nothing to leak either way.
    store.unregister(auth.body.userId);
    res.json({ ok: true });
  });

  /**
   * One-click unsubscribe, for the recipient of an unwanted mail. No identity
   * key needed — they may not be an InterPoll user at all — so the token in
   * the link is the authority.
   */
  app.get('/api/push/email/unsubscribe', (req, res) => {
    const userId = store.verifyUnsubscribeToken(req.query && req.query.token);
    if (!userId) return res.status(403).type('text/plain').send('Invalid unsubscribe link.');
    store.unregister(userId);
    res.type('text/plain').send('Done — this address will no longer receive InterPoll emails.');
  });

  /**
   * Mail one recipient about an incoming chat message.
   * @returns {Promise<boolean>} whether a mail actually went out.
   */
  async function notifyChatMessage({ toUserId }) {
    const to = store.emailFor(toUserId);
    if (!to) return false;
    // Claimed before sending so two concurrent messages cannot both slip through.
    if (!store.claimSendSlot(toUserId, cooldownMs)) return false;

    const unsubscribeUrl =
      `${relayUrl.replace(/\/+$/, '')}/api/push/email/unsubscribe`
      + `?token=${encodeURIComponent(store.unsubscribeToken(toUserId))}`;
    const { text, html } = buildMail({ appUrl, unsubscribeUrl });

    const result = await sender.send({
      to,
      subject: 'You have a new message on InterPoll',
      text,
      html,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (result === 'stale') store.unregister(toUserId);
    return result === 'ok';
  }

  return { notifyChatMessage, store };
}

module.exports = {
  attachEmailFallback, EmailStore, ResendSender,
  emailRegisterMessage, emailUnregisterMessage,
};
