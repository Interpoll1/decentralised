# Proof of Judgment & Proof of Contribution (phase 1)

> Interpoll should prove who contributed — not merely who clicked upload or cast the final vote.

## Forecast polls (Proof of Judgment)

- Poll type is chosen at creation: **Opinion** (no correct answer) or **Forecast**.
- A forecast poll carries an author-signed spec: resolution source, criteria, resolve date, topic.
- Forecasters pick an option with **50–99 % confidence**, may revise any time, and each revision is a
  signed, timestamped receipt. No currency, stakes or prizes.
- Community probability = mean of each forecaster's latest distribution; history is charted.
- Only the poll author (same key that signed the spec) can resolve it as `resolved` (with evidence) or `void`.
- Scoring: multi-class Brier, accuracy, calibration buckets, streaks, "days ahead of the crowd",
  per-topic scores (shrunk toward 50 for small samples) and badges, shown on profiles.
- `popularityScore` ranks by velocity, breadth, disagreement, discussion, urgency and credibility
  with log scaling + time decay, so big communities don't permanently dominate.

Storage (separate from the frozen poll signature format):
`forecasts/<pollId>/{spec,entries/*,resolution}`, `forecasters/<userId>/<pollId>`.
Every record is re-verified on read; forged or unsigned records are dropped.

Code: `src/utils/forecastScoring.ts`, `src/services/forecastService.ts`,
`src/components/ForecastPanel.vue`, `src/components/ForecastRecord.vue`.

## Contributor credits (Proof of Contribution)

- The owner of a post/poll proposes a split: contributors, roles, shares (basis points, must total 100 %).
- Each contributor signs `accepted` / `disputed`. People appear as credited only after accepting.
- Versions are hash-chained (`prevHash`) and verified on load; changes list the affected contributors.
- `allocateRevenue` produces exact statements (largest-remainder rounding). Unaccepted or disputed
  shares are **held**, never redirected to the uploader. It is preview-only: **no money moves yet**.

Code: `src/utils/contributionSplit.ts`, `src/services/contributionService.ts`,
`src/components/ContributorCredits.vue`.

## Phase 2 (now shipped)

- **Leaderboards** — `/forecasters`, optional `?topic=`. Users self-publish a signed reputation
  summary; the top 10 rows are recomputed from raw signed forecasts and dropped if inflated.
- **Follow forecasters** — follow button + follower count on profiles.
- **Notifications** — `forecastWatchService` (every 10 min): ≥10-point probability moves on
  questions you forecast, resolutions/voids, and new forecasts by people you follow.
- **Feed ranking** — "For You" ranks polls with `popularityScore` (breadth, disagreement,
  urgency, log-scaled, time-decayed) instead of raw vote count.
- **Payments** — `payments-api/` (Stripe Connect separate charges & transfers, no SDK).
  Tips only on fully-accepted splits; unlinked shares reserved (default 180 days), disputes hold
  funds, refunds/chargebacks reversed proportionally, per-work revenue statements.
  Web app shows tip buttons / statements / payout setup only when `VITE_PAYMENTS_API` is set.

## Still to do before taking real money

- Legal/tax review per jurisdiction, Stripe platform agreement, live keys.
- Move `payments-api` ledger from JSON file to the database; deploy behind TLS.
- Memberships, paid collections, sponsorships and ads (the monetization order still applies).
- Never pay out for forecast accuracy.
