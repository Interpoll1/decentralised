// payments-api/app.mjs — tips on collaborative works, split via Stripe Connect
// "separate charges and transfers". Interpoll never holds a wallet: money sits
// in the platform's Stripe balance until transferred to contributors' own
// Stripe Express accounts (Stripe handles KYC; public names stay separate).
//
// Rules enforced here (mirrors docs/proof-of-judgment-and-contribution.md):
//  - Tips only on works whose current split every contributor accepted.
//  - Shares of contributors without a payout account are reserved, not paid to the uploader.
//  - A dispute holds everything not yet transferred.
//  - Refunds/chargebacks are clawed back proportionally from every line.
//  - Reserved money expires after RESERVE_DAYS and is flagged for manual handling.
//  - No forecast accuracy ever earns money.
import { randomUUID } from 'node:crypto';
import {
  allocate, apportion, canonicalJson, splitStatus, verifyAcceptance, verifyHistory, verifySigned,
} from './split.mjs';
import { verifyWebhook } from './stripe.mjs';

const HEX_PUBKEY = /^[0-9a-f]{64}$/i;
const DAY = 86_400_000;

export function createPaymentsApp({ stripe, ledger, config, now = () => Date.now() }) {
  const cfg = {
    platformBps: 1000, reserveDays: 180, minTipCents: 100, maxTipCents: 50_000,
    currency: 'usd', allowedOrigins: [], ...config,
  };
  const S = ledger.state;
  S.disputedWorks ||= {};

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

  const safeReturnUrl = (url) => {
    try {
      const u = new URL(url);
      return cfg.allowedOrigins.includes(u.origin) ? u.toString() : null;
    } catch { return null; }
  };

  async function readBody(req, limit = 512 * 1024) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > limit) throw new Error('Body too large'); chunks.push(c); }
    return Buffer.concat(chunks).toString('utf8');
  }

  function payoutReady(contributorId) {
    const a = S.accounts[contributorId];
    return !!a?.payoutsEnabled;
  }

  async function transferLine(line, payment) {
    const acct = S.accounts[line.contributorId];
    const t = await stripe.post('/transfers', {
      amount: line.amountCents, currency: payment.currency, destination: acct.stripeAccountId,
      transfer_group: payment.id,
      ...(line.reservedAt ? {} : { source_transaction: payment.chargeId }),
      metadata: { workId: payment.workId, contributorId: line.contributorId, role: line.role },
    }, `tr-${line.id}`);
    line.transferId = t.id; line.status = 'paid'; line.paidAt = now();
  }

  // ── handlers ────────────────────────────────────────────────────────────

  async function linkAccount(body) {
    const { userId, pubkey, ts, signature, returnUrl } = body;
    if (!userId || !pubkey || !signature || !ts) return [400, { error: 'Missing fields' }];
    if (HEX_PUBKEY.test(userId) && userId.toLowerCase() !== pubkey.toLowerCase()) return [403, { error: 'Key mismatch' }];
    if (Math.abs(now() - Number(ts)) > 5 * 60_000) return [400, { error: 'Stale request' }];
    if (!verifySigned(canonicalJson({ v: 1, type: 'payout-link', userId, ts: Number(ts) }), signature, pubkey)) {
      return [403, { error: 'Bad signature' }];
    }
    const back = safeReturnUrl(returnUrl);
    if (!back) return [400, { error: 'Return URL not allowed' }];
    let acct = S.accounts[userId];
    if (!acct) {
      const created = await stripe.post('/accounts', {
        type: 'express', capabilities: { transfers: { requested: true } }, metadata: { interpollUserId: userId },
      }, `acct-${userId}`);
      acct = S.accounts[userId] = { stripeAccountId: created.id, payoutsEnabled: false, createdAt: now() };
      ledger.save();
    }
    const link = await stripe.post('/account_links', {
      account: acct.stripeAccountId, type: 'account_onboarding', return_url: back, refresh_url: back,
    });
    return [200, { url: link.url }];
  }

  function accountStatus(userId) {
    const a = S.accounts[userId];
    const reserved = S.allocations.filter((l) => l.contributorId === userId && l.status === 'reserved')
      .reduce((s, l) => s + l.amountCents, 0);
    return [200, { linked: !!a, payoutsEnabled: !!a?.payoutsEnabled, reservedCents: reserved }];
  }

  async function createTip(body) {
    const version = verifyHistory(body.history);
    if (!version) return [400, { error: 'Split history failed verification' }];
    const acceptances = (body.acceptances || []).filter(verifyAcceptance);
    if (splitStatus(version, acceptances) !== 'active') return [409, { error: 'Every contributor must accept the split before tips are enabled' }];
    if (S.disputedWorks[version.workId]) return [409, { error: 'This work has an open dispute' }];
    const amount = Number(body.amountCents);
    if (!Number.isInteger(amount) || amount < cfg.minTipCents || amount > cfg.maxTipCents) return [400, { error: 'Invalid amount' }];
    const back = safeReturnUrl(body.returnUrl);
    if (!back) return [400, { error: 'Return URL not allowed' }];

    const id = `pay_${randomUUID()}`;
    const session = await stripe.post('/checkout/sessions', {
      mode: 'payment',
      success_url: `${back}${back.includes('?') ? '&' : '?'}tip=success`,
      cancel_url: `${back}${back.includes('?') ? '&' : '?'}tip=cancelled`,
      line_items: { 0: { quantity: 1, price_data: { currency: cfg.currency, unit_amount: amount, product_data: { name: 'Tip for a collaborative work on Interpoll' } } } },
      payment_intent_data: { transfer_group: id, metadata: { paymentId: id, workId: version.workId } },
      metadata: { paymentId: id, workId: version.workId },
    }, id);
    S.payments[id] = {
      id, workId: version.workId, version: version.version, versionHash: version.hash,
      entries: version.entries, amountCents: amount, currency: cfg.currency,
      status: 'pending', sessionId: session.id, createdAt: now(),
    };
    ledger.save();
    return [200, { url: session.url, paymentId: id }];
  }

  async function onCheckoutCompleted(session) {
    const payment = S.payments[session.metadata?.paymentId];
    if (!payment || payment.status !== 'pending') return;
    const pi = await stripe.get(`/payment_intents/${session.payment_intent}`, { expand: { 0: 'latest_charge.balance_transaction' } });
    const charge = pi.latest_charge;
    payment.chargeId = charge.id;
    payment.feeCents = charge.balance_transaction?.fee ?? 0;
    payment.grossCents = charge.amount;
    const alloc = allocate({ grossCents: payment.grossCents, feeCents: payment.feeCents, platformBps: cfg.platformBps }, payment);
    payment.platformCents = alloc.platformCents;
    payment.distributableCents = alloc.distributable;
    payment.status = 'succeeded';
    payment.paidAt = now();
    const disputed = !!S.disputedWorks[payment.workId];
    for (const l of alloc.lines) {
      const line = { id: `${payment.id}:${l.contributorId}`, paymentId: payment.id, workId: payment.workId, ...l, status: 'pending' };
      S.allocations.push(line);
      if (disputed) { line.status = 'held'; continue; }
      if (line.amountCents === 0) { line.status = 'paid'; continue; }
      if (payoutReady(line.contributorId)) {
        try { await transferLine(line, payment); } catch (e) { line.status = 'reserved'; line.reservedAt = now(); line.expiresAt = now() + cfg.reserveDays * DAY; line.error = e.message; }
      } else {
        line.status = 'reserved'; line.reservedAt = now(); line.expiresAt = now() + cfg.reserveDays * DAY;
      }
    }
    ledger.save();
  }

  async function onAccountUpdated(account) {
    const userId = Object.keys(S.accounts).find((k) => S.accounts[k].stripeAccountId === account.id);
    if (!userId) return;
    S.accounts[userId].payoutsEnabled = !!account.payouts_enabled;
    if (account.payouts_enabled) {
      for (const line of S.allocations.filter((l) => l.contributorId === userId && l.status === 'reserved')) {
        if (S.disputedWorks[line.workId]) continue;
        try { await transferLine(line, S.payments[line.paymentId]); } catch (e) { line.error = e.message; }
      }
    }
    ledger.save();
  }

  /** Claw back a refund/chargeback proportionally from every line of the payment. */
  async function onRefund(charge) {
    const payment = Object.values(S.payments).find((p) => p.chargeId === charge.id);
    if (!payment) return;
    const already = payment.refundedCents || 0;
    const delta = (charge.amount_refunded ?? 0) - already;
    if (delta <= 0) return;
    payment.refundedCents = already + delta;
    const lines = S.allocations.filter((l) => l.paymentId === payment.id);
    // Contributors bear the refund in proportion to their share of the distributable amount.
    const fromContributors = Math.floor((delta * payment.distributableCents) / payment.grossCents);
    const cuts = apportion(fromContributors, lines);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], cut = Math.min(cuts[i], line.amountCents - (line.reversedCents || 0));
      if (cut <= 0) continue;
      if (line.status === 'paid' && line.transferId) {
        await stripe.post(`/transfers/${line.transferId}/reversals`, { amount: cut }, `rev-${line.id}-${payment.refundedCents}`);
      }
      line.reversedCents = (line.reversedCents || 0) + cut;
    }
    if (payment.refundedCents >= payment.grossCents) payment.status = 'refunded';
    ledger.save();
  }

  function recordDispute(body) {
    const a = body.acceptance;
    if (!a || a.state !== 'disputed' || !verifyAcceptance(a)) return [400, { error: 'Signed dispute required' }];
    S.disputedWorks[a.workId] = { by: a.contributorId, at: now(), reason: a.reason || '' };
    for (const line of S.allocations.filter((l) => l.workId === a.workId && l.status === 'reserved')) line.status = 'held';
    ledger.save();
    return [200, { held: true }];
  }

  function resolveDispute(body) {
    // A fresh signed acceptance from the disputing contributor clears the hold.
    const a = body.acceptance, d = S.disputedWorks[a?.workId];
    if (!d || !a || a.state !== 'accepted' || a.contributorId !== d.by || !verifyAcceptance(a)) return [400, { error: 'Signed acceptance from the disputing contributor required' }];
    delete S.disputedWorks[a.workId];
    for (const line of S.allocations.filter((l) => l.workId === a.workId && l.status === 'held')) {
      line.status = 'reserved'; line.reservedAt = now(); line.expiresAt = now() + cfg.reserveDays * DAY;
    }
    ledger.save();
    return [200, { released: true }];
  }

  function sweepExpired() {
    let n = 0;
    for (const l of S.allocations) {
      if (l.status === 'reserved' && l.expiresAt && l.expiresAt < now()) { l.status = 'expired'; n++; }
    }
    if (n) ledger.save();
    return n;
  }

  function statement(workId) {
    const payments = Object.values(S.payments).filter((p) => p.workId === workId && p.status !== 'pending');
    const lines = S.allocations.filter((l) => l.workId === workId);
    const byContributor = {};
    for (const l of lines) {
      const c = byContributor[l.contributorId] ||= { contributorId: l.contributorId, displayName: l.displayName, role: l.role, paidCents: 0, reservedCents: 0, heldCents: 0, reversedCents: 0 };
      const net = l.amountCents - (l.reversedCents || 0);
      if (l.status === 'paid') c.paidCents += net;
      else if (l.status === 'reserved') c.reservedCents += net;
      else if (l.status === 'held') c.heldCents += net;
      c.reversedCents += l.reversedCents || 0;
    }
    const sum = (k) => payments.reduce((a, p) => a + (p[k] || 0), 0);
    return [200, {
      workId, disputed: !!S.disputedWorks[workId],
      totals: { grossCents: sum('grossCents'), feeCents: sum('feeCents'), refundedCents: sum('refundedCents'), platformCents: sum('platformCents'), distributableCents: sum('distributableCents') },
      contributors: Object.values(byContributor),
      payments: payments.map(({ id, version, amountCents, grossCents, feeCents, platformCents, distributableCents, refundedCents, paidAt, status }) =>
        ({ id, version, amountCents, grossCents, feeCents, platformCents, distributableCents, refundedCents: refundedCents || 0, paidAt, status })),
    }];
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://local');
    const origin = req.headers.origin;
    const cors = origin && cfg.allowedOrigins.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', Vary: 'Origin' } : {};
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    try {
      if (req.method === 'POST' && url.pathname === '/api/payments/webhook') {
        const raw = await readBody(req);
        if (!verifyWebhook(raw, req.headers['stripe-signature'], cfg.webhookSecret, Math.floor(now() / 1000))) return json(res, 400, { error: 'Bad signature' });
        const evt = JSON.parse(raw);
        const obj = evt.data?.object;
        if (evt.type === 'checkout.session.completed') await onCheckoutCompleted(obj);
        else if (evt.type === 'account.updated') await onAccountUpdated(obj);
        else if (evt.type === 'charge.refunded') await onRefund(obj);
        else if (evt.type === 'charge.dispute.created') {
          const p = Object.values(S.payments).find((x) => x.chargeId === obj.charge);
          if (p) { for (const l of S.allocations.filter((l) => l.paymentId === p.id && l.status === 'reserved')) l.status = 'held'; ledger.save(); }
        }
        return json(res, 200, { received: true });
      }
      let result;
      if (req.method === 'GET' && url.pathname === '/api/payments/health') result = [200, { ok: true, enabled: true }];
      else if (req.method === 'GET' && url.pathname === '/api/payments/accounts') result = accountStatus(url.searchParams.get('userId') || '');
      else if (req.method === 'GET' && url.pathname === '/api/payments/statements') result = statement(url.searchParams.get('workId') || '');
      else if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (url.pathname === '/api/payments/accounts/link') result = await linkAccount(body);
        else if (url.pathname === '/api/payments/tips') result = await createTip(body);
        else if (url.pathname === '/api/payments/disputes') result = recordDispute(body);
        else if (url.pathname === '/api/payments/disputes/resolve') result = resolveDispute(body);
      }
      if (!result) return json(res, 404, { error: 'Not found' }, cors);
      return json(res, result[0], result[1], cors);
    } catch (e) {
      console.error('[payments]', e);
      return json(res, 500, { error: 'Payment service error' }, cors);
    }
  }

  return { handle, sweepExpired, _internal: { onCheckoutCompleted, onAccountUpdated, onRefund } };
}
