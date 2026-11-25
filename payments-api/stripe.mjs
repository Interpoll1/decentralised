// Minimal Stripe REST client (no SDK dependency) + webhook signature check.
import { createHmac, timingSafeEqual } from 'node:crypto';

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out); else out.append(key, String(v));
  }
  return out;
}

export function createStripe(secretKey, fetchImpl = globalThis.fetch) {
  async function call(method, path, params, idempotencyKey) {
    const headers = { Authorization: `Bearer ${secretKey}` };
    let body;
    let url = `https://api.stripe.com/v1${path}`;
    if (method === 'GET') { if (params) url += `?${form(params)}`; }
    else { body = form(params || {}); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetchImpl(url, { method, headers, body });
    const json = await res.json();
    if (!res.ok) throw Object.assign(new Error(json?.error?.message || `Stripe ${res.status}`), { stripe: json?.error });
    return json;
  }
  return {
    post: (p, params, key) => call('POST', p, params, key),
    get: (p, params) => call('GET', p, params),
  };
}

/** Verify a Stripe-Signature header (v1 scheme, 5-minute tolerance). */
export function verifyWebhook(rawBody, header, secret, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')).filter((p) => p.length === 2).map(([k, v]) => [k, v]));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
