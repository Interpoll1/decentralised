/**
 * Drop-in FCM push for the InterPoll relay.
 *
 * The relay source (relay-server/relay-server-enhanced.js) is gitignored and
 * lives on the VPS, so this module is written to be copied there and wired in
 * with two lines — see docs/push-notifications.md.
 *
 *   const { attachPush } = require('./push-notifications');
 *   const push = attachPush(app, { tokenStorePath: './push-tokens.json' });
 *   // …wherever a chat frame is relayed:
 *   push.notifyChatMessage({ toUserId, fromUserId, senderName });
 *
 * Zero npm dependencies beyond @noble (already a relay dependency): the OAuth2
 * access token is minted by signing a JWT with node's built-in crypto.
 *
 * ── Authentication ────────────────────────────────────────────────────────
 * There is no session to trust here — InterPoll identities are keys, not
 * accounts, and the relay is explicitly untrusted. So registration is
 * self-authenticating: `userId` IS the x-only Schnorr public key, and the
 * client signs the (userId, deviceId, token, ts) tuple with the matching
 * private key. The relay verifies that signature against `userId` itself, so
 * nobody can bind their FCM token to someone else's identity (which would
 * leak who is messaging that user) or unregister someone else's device
 * (which would silence them). Timestamps must be fresh and each signature is
 * accepted once, so captured registrations cannot be replayed.
 *
 * Privacy note: message bodies are end-to-end encrypted and the relay cannot
 * read them, so the push carries only "who" and a generic body. The device
 * shows the real text once the app opens and decrypts locally.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const { schnorr }             = require('@noble/curves/secp256k1.js');
const { sha256 }              = require('@noble/hashes/sha256');
const { bytesToHex, hexToBytes } = require('@noble/hashes/utils');

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** How far a registration's timestamp may drift before it is rejected. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Verify a Schnorr signature over sha256(data) — mirrors CryptoService.sign on the client. */
function verifyRawSchnorr(data, signatureHex, publicKeyHex) {
  try {
    const hash = bytesToHex(sha256(new TextEncoder().encode(data)));
    return schnorr.verify(hexToBytes(signatureHex), hexToBytes(hash), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

/** Remembers recently accepted signatures so a captured request cannot be replayed. */
class ReplayGuard {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.seen     = new Map(); // signature -> expiry
  }

  /** @returns {boolean} true if this signature is fresh (and records it) */
  accept(signature) {
    const now = Date.now();
    if (this.seen.size > 10_000) this.prune(now);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, now + this.windowMs * 2);
    return true;
  }

  prune(now) {
    for (const [sig, expiry] of this.seen) if (expiry <= now) this.seen.delete(sig);
  }
}

/** Coarse per-IP limiter — registration is rare, so the budget can be tight. */
class RateLimiter {
  constructor(max, windowMs) {
    this.max      = max;
    this.windowMs = windowMs;
    this.hits     = new Map(); // ip -> { count, resetAt }
  }

  allow(ip) {
    const now = Date.now();
    const rec = this.hits.get(ip);
    if (!rec || now >= rec.resetAt) {
      if (this.hits.size > 10_000) {
        for (const [key, value] of this.hits) if (now >= value.resetAt) this.hits.delete(key);
      }
      this.hits.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    rec.count += 1;
    return rec.count <= this.max;
  }
}

/** Persisted map: deviceId -> { userId, token, platform, updatedAt }. */
class TokenStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.devices  = new Map();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const obj = JSON.parse(raw);
      for (const [deviceId, rec] of Object.entries(obj)) this.devices.set(deviceId, rec);
    } catch { /* first run — no file yet */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.devices), null, 2));
    } catch (err) {
      console.warn('[Push] Could not persist token store:', err.message);
    }
  }

  register({ deviceId, userId, token, platform }) {
    this.devices.set(deviceId, { userId, token, platform: platform || 'android', updatedAt: Date.now() });
    this.save();
  }

  /** Only the identity that registered a device may remove it. */
  unregister(deviceId, userId) {
    const rec = this.devices.get(deviceId);
    if (!rec || rec.userId !== userId) return false;
    this.devices.delete(deviceId);
    this.save();
    return true;
  }

  /** Drop a token FCM told us is dead. */
  removeToken(token) {
    let changed = false;
    for (const [deviceId, rec] of this.devices) {
      if (rec.token === token) { this.devices.delete(deviceId); changed = true; }
    }
    if (changed) this.save();
  }

  tokensFor(userId) {
    const out = [];
    for (const rec of this.devices.values()) if (rec.userId === userId) out.push(rec.token);
    return out;
  }
}

class FcmSender {
  /** @param {object} serviceAccount parsed service-account JSON */
  constructor(serviceAccount) {
    this.sa          = serviceAccount;
    this.accessToken = '';
    this.expiresAt   = 0;
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;

    const now    = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss:   this.sa.client_email,
      scope: FCM_SCOPE,
      aud:   TOKEN_URL,
      iat:   now,
      exp:   now + 3600,
    }));
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    const signature = signer.sign(this.sa.private_key).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const assertion = `${header}.${claims}.${signature}`;

    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);

    const json      = await res.json();
    this.accessToken = json.access_token;
    this.expiresAt   = Date.now() + (json.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  /** @returns {Promise<'ok'|'stale'|'error'>} */
  async send(token, { title, body, data }) {
    const accessToken = await this.getAccessToken();
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data,
            android: {
              priority: 'HIGH',
              notification: { channel_id: 'interpoll-chat', tag: data.fromUserId },
            },
          },
        }),
      },
    );
    if (res.ok) return 'ok';
    // 404 UNREGISTERED / 403 on the token means it is dead.
    if (res.status === 404 || res.status === 403) return 'stale';
    console.warn('[Push] FCM send failed:', res.status, await res.text());
    return 'error';
  }
}

/** Canonical strings the client signs. Keep in sync with src/native/pushNotifications.ts. */
function registerMessage({ userId, deviceId, token, ts }) {
  return `interpoll-push-register-1:${userId}:${deviceId}:${token}:${ts}`;
}
function unregisterMessage({ userId, deviceId, ts }) {
  return `interpoll-push-unregister-1:${userId}:${deviceId}:${ts}`;
}

/**
 * @param {import('express').Express} app
 * @param {{ serviceAccountPath?: string, tokenStorePath?: string, isUserOnline?: (userId: string) => boolean }} opts
 */
function attachPush(app, opts = {}) {
  const serviceAccountPath = opts.serviceAccountPath
    || process.env.FCM_SERVICE_ACCOUNT
    || './fcm-service-account.json';
  const tokenStorePath = opts.tokenStorePath
    || process.env.PUSH_TOKEN_STORE
    || './push-tokens.json';

  const store   = new TokenStore(tokenStorePath);
  const replay  = new ReplayGuard(MAX_CLOCK_SKEW_MS);
  const limiter = new RateLimiter(20, 60_000);

  let sender = null;
  try {
    const sa = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    sender = new FcmSender(sa);
    console.log(`[Push] FCM enabled for project ${sa.project_id}`);
  } catch {
    console.log('[Push] No FCM service account — registration works, sending is disabled');
  }

  /**
   * Shared validation for both endpoints: shape, freshness, signature, replay.
   * @returns {{ ok: true, body: object } | { ok: false, status: number, error: string }}
   */
  function authenticate(req, buildMessage, extraFields) {
    const body = req.body || {};
    const { userId, deviceId, ts, sig } = body;

    if (typeof userId !== 'string' || !HEX64.test(userId)) {
      return { ok: false, status: 400, error: 'userId must be a 64-char hex public key' };
    }
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 128) {
      return { ok: false, status: 400, error: 'deviceId is required' };
    }
    if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) {
      return { ok: false, status: 400, error: 'sig must be a 128-char hex Schnorr signature' };
    }
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      return { ok: false, status: 400, error: 'ts is required' };
    }
    for (const [field, maxLen] of Object.entries(extraFields || {})) {
      const value = body[field];
      if (typeof value !== 'string' || !value || value.length > maxLen) {
        return { ok: false, status: 400, error: `${field} is required` };
      }
    }
    if (Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
      return { ok: false, status: 401, error: 'stale request' };
    }

    // The identity IS the public key, so this both authenticates the caller and
    // proves they own the userId they are claiming.
    if (!verifyRawSchnorr(buildMessage(body), sig, userId)) {
      return { ok: false, status: 403, error: 'invalid signature' };
    }
    if (!replay.accept(sig)) {
      return { ok: false, status: 409, error: 'replayed request' };
    }
    return { ok: true, body };
  }

  function guard(req, res) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!limiter.allow(ip)) {
      res.status(429).json({ error: 'too many registrations' });
      return false;
    }
    return true;
  }

  app.post('/api/push/register', express_json(), (req, res) => {
    if (!guard(req, res)) return;

    const auth = authenticate(req, registerMessage, { token: 4096 });
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { userId, token, deviceId, platform } = auth.body;
    store.register({ userId, token, deviceId, platform });
    res.json({ ok: true });
  });

  app.post('/api/push/unregister', express_json(), (req, res) => {
    if (!guard(req, res)) return;

    const auth = authenticate(req, unregisterMessage, {});
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { userId, deviceId } = auth.body;
    // Succeeds silently for an unknown device — the caller has already proved
    // who they are, and there is nothing to leak either way.
    store.unregister(deviceId, userId);
    res.json({ ok: true });
  });

  /**
   * Fire a push for one incoming chat message.
   * Call this from the relay's chat-forwarding path. Pass `force: true` to
   * push even when the recipient has a live socket (useful while testing).
   */
  async function notifyChatMessage({ toUserId, fromUserId, senderName, force = false }) {
    if (!sender || !toUserId || !fromUserId) return;
    if (!force && typeof opts.isUserOnline === 'function' && opts.isUserOnline(toUserId)) return;

    const tokens = store.tokensFor(toUserId);
    if (!tokens.length) return;

    const payload = {
      title: senderName || 'New message',
      body:  'Sent you a message',
      data:  {
        fromUserId,
        senderName: senderName || '',
        path: `/chat/${encodeURIComponent(fromUserId)}`,
      },
    };

    for (const token of tokens) {
      try {
        const result = await sender.send(token, payload);
        if (result === 'stale') store.removeToken(token);
      } catch (err) {
        console.warn('[Push] send error:', err.message);
      }
    }
  }

  return { notifyChatMessage, store };
}

/**
 * Local JSON body parser so this module works whether or not the host relay
 * already applied `express.json()` globally.
 */
function express_json() {
  return function parseJson(req, res, next) {
    if (req.body !== undefined) return next();
    let raw = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      next();
    });
  };
}

module.exports = {
  attachPush, TokenStore, FcmSender,
  registerMessage, unregisterMessage, verifyRawSchnorr,
};
