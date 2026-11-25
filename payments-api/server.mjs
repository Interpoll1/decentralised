// Entry point. Disabled unless STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set.
import { createServer } from 'node:http';
import { createPaymentsApp } from './app.mjs';
import { createStripe } from './stripe.mjs';
import { openLedger } from './ledger.mjs';

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error('payments-api: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required. Refusing to start.');
  process.exit(1);
}
const app = createPaymentsApp({
  stripe: createStripe(STRIPE_SECRET_KEY),
  ledger: openLedger(process.env.PAYMENTS_LEDGER_PATH || './payments-ledger.json'),
  config: {
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    platformBps: Number(process.env.PLATFORM_BPS || 1000),
    reserveDays: Number(process.env.RESERVE_DAYS || 180),
    currency: process.env.PAYMENTS_CURRENCY || 'usd',
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  },
});
setInterval(() => app.sweepExpired(), 3_600_000).unref();
const port = Number(process.env.PORT || 8790);
createServer(app.handle).listen(port, () => console.log(`payments-api listening on :${port}`));
