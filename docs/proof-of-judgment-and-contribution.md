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

## Deliberately not built yet

- Payments. Next steps follow the order: tips → memberships → paid collections → sponsorships → ads.
  Payouts must go through a regulated processor (e.g. Stripe Connect separate charges & transfers),
  with KYC identity kept separate from public creator names.
- Any cash or redeemable reward for forecast accuracy — get jurisdiction-specific legal review first.
- Push notifications for significant probability moves (`significantMove` is ready to hook into
  `notificationService`).
