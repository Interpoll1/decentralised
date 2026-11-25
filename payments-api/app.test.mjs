import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { createPaymentsApp } from './app.mjs';
import { hash, splitContentPayload, acceptancePayload, canonicalJson } from './split.mjs';

const key = () => { const priv = bytesToHex((schnorr.utils.randomSecretKey ?? schnorr.utils.randomPrivateKey)()); return { priv, pub: bytesToHex(schnorr.getPublicKey(hexToBytes(priv))) }; };
const sign = (payload, priv) => bytesToHex(schnorr.sign(hexToBytes(hash(hash(payload))), hexToBytes(priv)));
const people = { a: key(), b: key() };
const entries = [
  { contributorId: people.a.pub, displayName: 'A', role: 'host', shareBps: 7000 },
  { contributorId: people.b.pub, displayName: 'B', role: 'editor', shareBps: 3000 },
];
const base = { workId: 'w1', workKind: 'video', version: 1, entries, proposedBy: people.a.pub, proposedAt: 1, prevHash: '' };
const version = { ...base, hash: hash(splitContentPayload(base)) };
const accept = (p, state = 'accepted', at = 2) => {
  const a = { workId: 'w1', version: 1, versionHash: version.hash, contributorId: p.pub, state, at, pubkey: p.pub };
  return { ...a, signature: sign(acceptancePayload(a), p.priv) };
};

function setup() {
  const calls = [];
  const stripe = {
    async post(path, params) {
      calls.push(['POST', path, params]);
      if (path === '/checkout/sessions') return { id: 'cs_1', url: 'https://checkout' };
      if (path === '/transfers') return { id: `tr_${calls.length}` };
      if (path === '/accounts') return { id: 'acct_b' };
      if (path === '/account_links') return { url: 'https://onboard' };
      return {};
    },
    async get(path) { calls.push(['GET', path]); return { latest_charge: { id: 'ch_1', amount: 10_000, balance_transaction: { fee: 500 } } }; },
  };
  const ledger = { state: { accounts: { [people.a.pub]: { stripeAccountId: 'acct_a', payoutsEnabled: true } }, payments: {}, allocations: [] }, save() {} };
  const app = createPaymentsApp({ stripe, ledger, config: { webhookSecret: 'whsec', platformBps: 1000, allowedOrigins: ['https://app'] } });
  return { app, calls, ledger };
}

async function call(app, method, path, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { method, url: path, headers });
  return new Promise((resolve) => {
    const res = { status: 0, writeHead(s) { this.status = s; }, end(b) { resolve({ status: this.status, body: b ? JSON.parse(b) : null }); } };
    app.handle(req, res);
  });
}
const webhook = (app, evt) => {
  const raw = JSON.stringify(evt), t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec').update(`${t}.${raw}`).digest('hex');
  return call(app, 'POST', '/api/payments/webhook', raw, { 'stripe-signature': `t=${t},v1=${sig}` });
};

test('rejects tips until every contributor accepted', async () => {
  const { app } = setup();
  const r = await call(app, 'POST', '/api/payments/tips', { history: [version], acceptances: [accept(people.a)], amountCents: 10_000, returnUrl: 'https://app/p' });
  assert.equal(r.status, 409);
});

test('rejects tampered split history and foreign return URLs', async () => {
  const { app } = setup();
  const bad = { ...version, entries: entries.map((e) => ({ ...e, shareBps: 5000 })) };
  assert.equal((await call(app, 'POST', '/api/payments/tips', { history: [bad], acceptances: [], amountCents: 500, returnUrl: 'https://app' })).status, 400);
  assert.equal((await call(app, 'POST', '/api/payments/tips', { history: [version], acceptances: [accept(people.a), accept(people.b)], amountCents: 500, returnUrl: 'https://evil' })).status, 400);
});

test('full flow: tip → pay linked contributor, reserve unlinked → release on onboarding → proportional refund', async () => {
  const { app, calls, ledger } = setup();
  const r = await call(app, 'POST', '/api/payments/tips', { history: [version], acceptances: [accept(people.a), accept(people.b)], amountCents: 10_000, returnUrl: 'https://app/p' });
  assert.equal(r.status, 200);
  const paymentId = r.body.paymentId;
  assert.equal((await webhook(app, { type: 'checkout.session.completed', data: { object: { payment_intent: 'pi_1', metadata: { paymentId } } } })).status, 200);
  // $100 - $5 fee = $95; 10% platform = $9.50; $85.50 distributable → 70/30
  const [la, lb] = ledger.state.allocations;
  assert.equal(la.amountCents, 5985); assert.equal(la.status, 'paid');
  assert.equal(lb.amountCents, 2565); assert.equal(lb.status, 'reserved');
  assert.equal(calls.filter((c) => c[1] === '/transfers').length, 1);

  ledger.state.accounts[people.b.pub] = { stripeAccountId: 'acct_b', payoutsEnabled: false };
  await webhook(app, { type: 'account.updated', data: { object: { id: 'acct_b', payouts_enabled: true } } });
  assert.equal(lb.status, 'paid');

  await webhook(app, { type: 'charge.refunded', data: { object: { id: 'ch_1', amount_refunded: 10_000 } } });
  assert.equal(la.reversedCents + lb.reversedCents, 8550);
  assert.equal(calls.filter((c) => c[1].endsWith('/reversals')).length, 2);
  const st = await call(app, 'GET', '/api/payments/statements?workId=w1');
  assert.equal(st.body.totals.platformCents, 950);
});

test('a signed dispute holds untransferred money and blocks new tips', async () => {
  const { app, ledger } = setup();
  const r = await call(app, 'POST', '/api/payments/tips', { history: [version], acceptances: [accept(people.a), accept(people.b)], amountCents: 10_000, returnUrl: 'https://app/p' });
  await webhook(app, { type: 'checkout.session.completed', data: { object: { payment_intent: 'pi', metadata: { paymentId: r.body.paymentId } } } });
  assert.equal((await call(app, 'POST', '/api/payments/disputes', { acceptance: accept(people.b, 'disputed', 5) })).status, 200);
  assert.equal(ledger.state.allocations[1].status, 'held');
  assert.equal((await call(app, 'POST', '/api/payments/tips', { history: [version], acceptances: [accept(people.a), accept(people.b)], amountCents: 500, returnUrl: 'https://app' })).status, 409);
  assert.equal((await call(app, 'POST', '/api/payments/disputes/resolve', { acceptance: accept(people.b, 'accepted', 9) })).status, 200);
  assert.equal(ledger.state.allocations[1].status, 'reserved');
});

test('webhook rejects bad signatures; account link requires a valid signature', async () => {
  const { app } = setup();
  assert.equal((await call(app, 'POST', '/api/payments/webhook', '{}', { 'stripe-signature': 't=1,v1=00' })).status, 400);
  const ts = Date.now();
  const good = { userId: people.b.pub, pubkey: people.b.pub, ts, returnUrl: 'https://app/profile', signature: sign(canonicalJson({ v: 1, type: 'payout-link', userId: people.b.pub, ts }), people.b.priv) };
  assert.equal((await call(app, 'POST', '/api/payments/accounts/link', good)).body.url, 'https://onboard');
  assert.equal((await call(app, 'POST', '/api/payments/accounts/link', { ...good, ts: ts + 1 })).status, 403);
});
