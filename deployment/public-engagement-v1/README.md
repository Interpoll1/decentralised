# Public engagement relay review package

Status: review candidate, NOT deployment approval. This package belongs with the
client branch and offline coordination prototype. Do not deploy the client alone.

## Live-tree pin (2026-09-26, supersedes the archive pin below)

`backend.patch` and `manifest.json` are now pinned to the live relay tree on the
prod VPS (`/var/www/interpoll`), snapshotted 2026-09-26. Three relay-server files
matched the original preimage byte-for-byte. `gun-relay/gun-relay-enhanced.js`
did not: the 2026-09-25 content-firewall deploy changed it. The pre-firewall
backup matched the original preimage, so the gun-relay hunk is a 3-way merge of
the author patch with the content firewall (one adjacency conflict: both setup
blocks kept, firewall first). The original pin is kept under `previousPin`.

Staging evidence (local, not prod): VPS dependency lockfiles (`@noble/curves`
2.2.0, `@noble/hashes` 2.2.0 in `shared-validation/`), Node 22.16 and 24.0.0
(the VPS version), MySQL 8.0 with the prod schema (no data):

- `tests/engagement.test.mjs`: 38/38. Needs `typescript@5` (7.x breaks the
  route extraction) and `NODE_PATH=<backend>/gun-relay/node_modules` so the test
  finds Gun.
- `client-relay.integration.test.mjs`: 4/4.
- `staging-e2e.mjs` (real HTTP + Gun WS against both patched relays + MySQL):
  27/28, also after restarting both processes. The one miss: a signed Gun put
  commits but the writer never receives an ack. The client does not wait for
  that ack (`void gunPut`), so it is advisory only.

## Source and scope

`backend.patch` contains ten changed/new paths: HTTP content-vote/views routes,
SQL admission/deduplication, Gun admission before forwarding, signed tally reads,
shared verification helpers and local tests. It is a unified patch against the
team-supplied 38-file archive, SHA-256
`c2b34fa670c66f7b3644aed5ec3b2a3592c49b094eebc8ee51d625431de39955`.
The archive reports dirty base `3961bd105d8f6d1c1088c1cd7b0ef4962c7b7526`:
that Git SHA alone does NOT identify the source. It is not repository master.
Live deployed byte equality remains unverified. No environment files, databases,
logs, deployment-state dump or whole server archive are included here.

`manifest.json` pins every affected preimage and postimage after CRLF-to-LF
normalization, plus the exact patch digest. `verify.mjs` is read-only and rejects
an unexpected source tree. Never overlay archived files onto current master.
If Viktor has newer backend changes, reconcile them explicitly and rerun tests.

## Local review procedure

Use a disposable copy of the supplied backend source; keep its normal dependencies.
Run the verifier from this checkout with the absolute path to that copy:

```sh
node deployment/public-engagement-v1/verify.mjs /path/to/backend-copy before
```

From the backend copy, check and apply the absolute patch path:

```sh
git apply --check /path/to/checkout/deployment/public-engagement-v1/backend.patch
git apply /path/to/checkout/deployment/public-engagement-v1/backend.patch
```

Verify the postimage from the checkout, then run tests in the backend copy:

```sh
node deployment/public-engagement-v1/verify.mjs /path/to/backend-copy after
# From backend copy:
node --test tests/engagement.test.mjs
```

Tests require the existing Gun, TypeScript and noble dependencies. The shared
engagement verifier must match the client `shared-validation/engagement.js`.
Locally tested crypto versions: `@noble/curves` 2.3.0 and `@noble/hashes`
1.8.0 on Node 22.15.0. The supplied archive has no authoritative backend
package lock; maintainers must explicitly lock compatible dependencies in the
deployment project. Do not assume the existing VPS installation includes them.

These tests use a deterministic SQL transaction double, actual extracted HTTP
callbacks, and in-memory Gun. They do not establish real MySQL locking,
production interoperability, rate-limit adequacy or deployment correctness.

## Compatibility and rollout

Deploy coordinated upgraded clients AND both relay processes. Legacy unsigned
writes are rejected; no unsigned fallback. The new SQL table is
`engagement_actions_v1` (InnoDB); both process startup paths initialize it.
Record action receipts only after transactions commit. Retried actions retain
exact IDs/signatures. Keep old clients off upgraded write paths during rollout.

Existing unsigned records and aggregate baselines remain unverified DISPLAY
compatibility only. `/api/vote-tally` now states
`evidence: "legacy-inclusive-unverified"`; signed rows are read from their verified
envelope, never mutable sibling `type`. Malformed signed rows cannot downgrade
to legacy. The UI still displays compatibility counts; it does not display an
authenticated total. No historical signature is invented and no unsigned record
is admitted to the observation ledger or coordination snapshot. A future
verified-only tally/visible legacy-label migration requires separate review;
do not market these displayed aggregate counts as authenticated in the meantime.

Before deployment, Viktor must test actual MySQL transactions/restarts, BOTH
transport paths, old-client rejection, exact duplicate receipts, unavailable
relay recovery and comment/post/poll-content reactions. No poll ballot, DM,
group, identity or personalized-feed redesign is included.

## Client/relay callback composition test

From this checkout, set `REVIEW_BACKEND_DIR` to the absolute disposable patched
backend path and run:

```sh
node --test deployment/public-engagement-v1/client-relay.integration.test.mjs
```

This executes the actual client signing/publishing functions and backend HTTP
handler with a local acceptance double. It verifies matching receipts, lost
responses, immutable retries, invalid context and legacy receipt rejection.
There are no sockets or production requests. Backend SQL correctness is tested
separately above; these callbacks are not a real database/deployment test.
