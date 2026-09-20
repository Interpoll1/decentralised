import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// The relay module is CommonJS (it is copied onto the CJS relay host), while
// this package is type: module — so load it through a .cjs shim.
const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Kept inside the repo so node resolves @noble from the project's node_modules.
const cjsCopy = path.join(repoRoot, 'relay-push', `.push-notifications.${process.pid}.cjs`);
fs.copyFileSync(path.join(repoRoot, 'relay-push', 'push-notifications.js'), cjsCopy);
const { attachPush, registerMessage, unregisterMessage } = require(cjsCopy);

afterAll(() => {
  try { fs.unlinkSync(cjsCopy); } catch { /* already gone */ }
});

function makeIdentity() {
  const privateKey = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const userId = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
  return { privateKey, userId };
}

function sign(message, privateKey) {
  const hash = bytesToHex(sha256(new TextEncoder().encode(message)));
  return bytesToHex(schnorr.sign(hexToBytes(hash), hexToBytes(privateKey)));
}

/** Minimal express stand-in: records handlers, invokes them with a fake res. */
function fakeApp() {
  const routes = new Map();
  return {
    post(routePath, ...handlers) {
      routes.set(routePath, handlers[handlers.length - 1]);
    },
    call(routePath, body, ip = '1.2.3.4') {
      const handler = routes.get(routePath);
      if (!handler) throw new Error(`no handler for ${routePath}`);
      const res = {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(obj) { this.payload = obj; return this; },
      };
      handler({ body, ip, socket: {} }, res);
      return res;
    },
  };
}

describe('relay push registration auth', () => {
  let app;
  let storePath;

  beforeEach(() => {
    storePath = path.join(os.tmpdir(), `push-tokens-${Math.random().toString(36).slice(2)}.json`);
    app = fakeApp();
    attachPush(app, { tokenStorePath: storePath, serviceAccountPath: '/nonexistent.json' });
  });

  function registerBody(identity, overrides = {}) {
    const deviceId = overrides.deviceId ?? 'device-1';
    const token    = overrides.token ?? 'fcm-token-abc';
    const ts       = overrides.ts ?? Date.now();
    const userId   = overrides.userId ?? identity.userId;
    const body = { userId, deviceId, token, platform: 'android', ts };
    body.sig = overrides.sig
      ?? sign(registerMessage({ userId: identity.userId, deviceId, token, ts }), identity.privateKey);
    return body;
  }

  it('accepts a correctly signed registration', () => {
    const me = makeIdentity();
    const res = app.call('/api/push/register', registerBody(me));
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  it('rejects a registration with no signature', () => {
    const me = makeIdentity();
    const body = registerBody(me);
    delete body.sig;
    const res = app.call('/api/push/register', body);
    expect(res.statusCode).toBe(400);
  });

  it('refuses to bind a token to someone else\'s identity', () => {
    const attacker = makeIdentity();
    const victim   = makeIdentity();
    // Attacker signs with their own key but claims the victim's userId.
    const body = registerBody(attacker, { userId: victim.userId });
    const res = app.call('/api/push/register', body);
    expect(res.statusCode).toBe(403);
  });

  it('rejects a stale timestamp', () => {
    const me = makeIdentity();
    const res = app.call('/api/push/register', registerBody(me, { ts: Date.now() - 10 * 60 * 1000 }));
    expect(res.statusCode).toBe(401);
  });

  it('rejects a replayed request', () => {
    const me = makeIdentity();
    const body = registerBody(me);
    expect(app.call('/api/push/register', body).statusCode).toBe(200);
    expect(app.call('/api/push/register', body).statusCode).toBe(409);
  });

  it('rejects a userId that is not a public key', () => {
    const me = makeIdentity();
    const res = app.call('/api/push/register', registerBody(me, { userId: 'alice' }));
    expect(res.statusCode).toBe(400);
  });

  it('will not let another identity unregister your device', () => {
    const me       = makeIdentity();
    const attacker = makeIdentity();
    app.call('/api/push/register', registerBody(me));

    const ts = Date.now();
    const res = app.call('/api/push/unregister', {
      userId: attacker.userId,
      deviceId: 'device-1',
      ts,
      sig: sign(unregisterMessage({ userId: attacker.userId, deviceId: 'device-1', ts }), attacker.privateKey),
    });
    // Signature is valid for the attacker, but the device belongs to someone else.
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(stored['device-1']).toBeDefined();
    expect(stored['device-1'].userId).toBe(me.userId);
  });

  it('lets the owner unregister their own device', () => {
    const me = makeIdentity();
    app.call('/api/push/register', registerBody(me));

    const ts = Date.now();
    const res = app.call('/api/push/unregister', {
      userId: me.userId,
      deviceId: 'device-1',
      ts,
      sig: sign(unregisterMessage({ userId: me.userId, deviceId: 'device-1', ts }), me.privateKey),
    });
    expect(res.statusCode).toBe(200);
    const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(stored['device-1']).toBeUndefined();
  });

  it('rate-limits a flood of registrations from one IP', () => {
    const me = makeIdentity();
    let sawLimit = false;
    for (let i = 0; i < 30; i++) {
      const res = app.call('/api/push/register', registerBody(me, { deviceId: `device-${i}` }), '9.9.9.9');
      if (res.statusCode === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });
});

vi.stubGlobal('crypto', globalThis.crypto);
