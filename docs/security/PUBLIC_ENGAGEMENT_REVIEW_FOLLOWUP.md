# Public engagement review follow-up

This follows review of `c5d660a3b64dd4e6f129926dc94e43b882e68526`.
No production calls, deployment, DM/group changes or bot-prevention claim.

## Relay package

See `deployment/public-engagement-v1/README.md`, patch, source manifest and
read-only verifier. The server source was supplied separately and differs from
repository master. Publishing a pinned patch permits review without overwriting
current backend work. HTTP content-vote/views, Gun firewall, shared transaction,
tally reader and tests must be reviewed together. The client and BOTH relays
need coordinated rollout; unsigned fallback is not allowed.

## Reaction availability and evidence

`reactionOutboxService.ts` durably queues the original signed envelope before
any transport attempt. Post/comment/poll-content callers await local signing
and persistence, not HTTP. They return `delivery: pending` for local intent;
only an exact accepted/duplicate receipt permits `accepted`. Existing tally
hints and optimistic displays do not constitute server evidence. The current
UI does not yet show a dedicated pending/failed reaction badge.

The metadata key is `public-reaction-outbox:v1:<actor>` with `{version:1,entries}`.
Entries contain an immutable action and pending/accepted/rejected/expired state.
The existing IndexedDB CAS transaction prevents lost updates across tabs.
Multiple tabs may transmit the same action; server ID dedup is mandatory.
A failed retry cannot erase another tab's accepted receipt. Signing never
creates or replaces an account key. Memory-only storage cannot pass the CAS.

Bound: 128 records per account, at most 16 attempted per flush. Pending entries
are never evicted for capacity; enqueue fails explicitly when full. Terminal
records are evicted oldest-first when space is required. Pending actions expire
at the existing five-minute signed-action freshness limit. Expiry never extends
or re-signs an action; a new user gesture is required. No historical status-log
retention is promised. No migration of old unsigned intent into signed actions.

A background flush starts after enqueue, on app startup and on browser reconnect;
pending work is retried after ten seconds between flushes. HTTP has two bounded
eight-second attempts; 429/network/5xx remain pending, explicit rejection or
incompatible receipts are terminal. The worker checks the current account before
each action, and a different active account cannot drain the old account queue.
An already in-flight signed request may still finish after an account switch.
Local database availability and existing bounded Gun prerequisite reads still
matter; this is not an instant/offline-delivery guarantee. Views retain their
previous bounded memory-only queue and are not migrated by this change.

## Legacy display policy

Retain legacy counts for compatibility, explicitly WITHOUT authenticated tally
claims. They can include unsigned historical records and mutable baselines.
The backend tally response labels this `legacy-inclusive-unverified`; an
upgraded row's signature/context is checked and its signed value is used rather
than sibling type. Invalid envelopes cannot fall back to legacy. No unsigned
record enters the accepted observation ledger or coordination analysis. Old
counts are not retroactively signed. Removing all legacy display contributions
and adding visible UI evidence labels require a separately reviewed migration.

## Test runners

The canonical `npm test` config already roots discovery in `unit_tests` and
includes only `.ts/.js`; the reported Node-suite collision did not reproduce on
that command here. Explicit tools/deployment exclusions now document the split.
`npm run test:coordination` runs the Node suite separately; backend tests run
only in the disposable patched backend tree. No test is deleted to hide failure.

## Maintainer rollout gates

Review the applied server diff against actual deployment source, lock backend
crypto dependencies, exercise real MySQL multi-process locking and restart,
then test signed post/comment/poll-content actions and views through HTTP and
Gun. No rollout is approved by local test doubles. This branch is a review
candidate, not a production-complete detector or authenticated legacy feed.
