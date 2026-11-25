// src/services/paymentsService.ts — client for payments-api (Stripe Connect tips).
// Disabled unless VITE_PAYMENTS_API is set; every UI entry point checks `enabled`.
import { CryptoService } from './cryptoService';
import { KeyService } from './keyService';
import { canonicalJson } from '../utils/forecastScoring';
import type { Acceptance, SplitVersion } from '../utils/contributionSplit';

const BASE = (import.meta.env.VITE_PAYMENTS_API as string | undefined)?.replace(/\/$/, '') || '';

export interface PayoutStatus { linked: boolean; payoutsEnabled: boolean; reservedCents: number }
export interface WorkStatement {
  workId: string;
  disputed: boolean;
  totals: { grossCents: number; feeCents: number; refundedCents: number; platformCents: number; distributableCents: number };
  contributors: { contributorId: string; displayName: string; role: string; paidCents: number; reservedCents: number; heldCents: number; reversedCents: number }[];
  payments: { id: string; version: number; grossCents: number; feeCents: number; platformCents: number; distributableCents: number; refundedCents: number; paidAt: number; status: string }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Payments error ${res.status}`);
  return body as T;
}

export const PaymentsService = {
  enabled: !!BASE,

  async startPayoutOnboarding(userId: string): Promise<void> {
    const keys = await KeyService.getKeyPair();
    const ts = Date.now();
    const signature = CryptoService.sign(CryptoService.hash(canonicalJson({ v: 1, type: 'payout-link', userId, ts })), keys.privateKey);
    const { url } = await request<{ url: string }>('/api/payments/accounts/link', {
      method: 'POST', body: JSON.stringify({ userId, pubkey: keys.publicKey, ts, signature, returnUrl: window.location.href }),
    });
    window.location.assign(url);
  },

  payoutStatus(userId: string): Promise<PayoutStatus> {
    return request(`/api/payments/accounts?userId=${encodeURIComponent(userId)}`);
  },

  async tip(history: SplitVersion[], acceptances: Acceptance[], amountCents: number): Promise<void> {
    const { url } = await request<{ url: string }>('/api/payments/tips', {
      method: 'POST', body: JSON.stringify({ history, acceptances, amountCents, returnUrl: window.location.href }),
    });
    window.location.assign(url);
  },

  statement(workId: string): Promise<WorkStatement> {
    return request(`/api/payments/statements?workId=${encodeURIComponent(workId)}`);
  },

  reportDispute(acceptance: Acceptance): Promise<unknown> {
    return request('/api/payments/disputes', { method: 'POST', body: JSON.stringify({ acceptance }) });
  },

  resolveDispute(acceptance: Acceptance): Promise<unknown> {
    return request('/api/payments/disputes/resolve', { method: 'POST', body: JSON.stringify({ acceptance }) });
  },
};
