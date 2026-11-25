# payments-api

Tips on collaborative works, split between contributors who **all accepted** the work's
contribution split. Uses Stripe Connect *separate charges and transfers*; contributors
onboard to their own Stripe Express accounts (Stripe does KYC — Interpoll stores only
`userId → acct_…`).

```bash
STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... \
ALLOWED_ORIGINS=https://interpoll.example PLATFORM_BPS=1000 RESERVE_DAYS=180 \
node payments-api/server.mjs
```

Point a Stripe webhook at `/api/payments/webhook` for `checkout.session.completed`,
`account.updated`, `charge.refunded`, `charge.dispute.created`. Set `VITE_PAYMENTS_API`
in the web app to this service's origin to show tip / payout buttons.

| Endpoint | Purpose |
|---|---|
| `POST /api/payments/accounts/link` | Signed request → Stripe onboarding link |
| `GET /api/payments/accounts?userId=` | Payout status + reserved balance |
| `POST /api/payments/tips` | Verifies split history + signed acceptances → Checkout URL |
| `GET /api/payments/statements?workId=` | Every calculation, per contributor |
| `POST /api/payments/disputes` / `disputes/resolve` | Signed hold / release |

Rules: unaccepted or unlinked shares are **reserved** (never paid to the uploader) and expire
after `RESERVE_DAYS` for manual handling; disputes hold everything untransferred; refunds and
chargebacks are reversed proportionally. Forecast accuracy never earns money.

**Before going live:** jurisdiction-specific legal/tax review, Stripe platform agreement,
and moving the JSON ledger to a real database.
