# Public engagement v1 — local implementation contract

Status: implementation for review; not deployed. Scope: post/comment reactions and
post/poll views as inputs to review-only coordination analysis. No poll-ballot,
DM, group, moderation-UI or human-uniqueness redesign.

## Authority and bytes

The actor is the existing account's lowercase 64-hex x-only Schnorr public key.
The signing key must equal this actor and, for Gun, the actor in the soul. This
proves key control, not ownership of a human name, an OAuth account or one human.
No replacement account key or second identity root is generated.

An action has exactly these fields: `version`, `namespace`, `kind`, `actor`, `targetType`,
`targetId`, `value`, `createdAt`, `nonce`, `id`, `signature`.
Version is 1. Kind is `reaction` or `view`. Reactions target `post`/`comment` and
have value `up`/`down`/`none`; views target `post`/`poll` and have value `view`.
Target identifiers use lowercase ASCII `[a-z0-9_.:-]{1,128}`. Mixed-case IDs fail
closed because existing MySQL identifier columns compare case-insensitively;
do not silently lowercase historical IDs. Namespace is the configured `vN`.
The nonce is 128 random
bits encoded as lowercase hex; createdAt is a safe integer in milliseconds.

The signed UTF-8 bytes are JSON.stringify of this fixed array:

`["interpoll.public-engagement.v1",1,namespace,kind,actor,targetType,targetId,value,createdAt,nonce]`

The action ID is lowercase SHA-256 of those bytes. The Schnorr signature is over
that 32-byte digest. Unknown fields, missing/malformed signatures, wrong subject,
target or namespace are rejected. A valid signature under another key cannot
authorize an action at the expected actor's Gun path.

## Acceptance and persistence

Fresh admission allows a maximum five-minute age and 30-second future skew.
Historical signature validation is separate from fresh admission. SQL acceptance
uses a transaction and a locked current reaction row. The deterministic order is
`(createdAt,id)`; lower/equal competing positions cannot replace a newer reaction.
This is a per-key ordering rule, not proof of the user's real action time.

Gun reactions carry the complete JSON envelope as one scalar `envelope` field at
`<namespace>/postVotes/<target>/<actor>` or `commentVotes/<target>/<actor>`.
Partial field signatures are not supported. The firewall must be installed
before Gun's universe/HAM handlers, on both `in` and `out`. Bare legacy reaction
fields cannot enter the protected write path. Canonical directory links contain
no reaction authority. HTTP and Gun call the same verifier/store. Raw immediate
WebSocket ACKs and `/db/write` bypasses are disabled for protected reaction paths.
The legacy buffering adapter skips leaves already committed by the transaction.
Gun clocks for these leaves come from the durable relay-assigned monotonic clock,
not caller-controlled HAM metadata. Gun replication is an advisory cache, not
global consensus or a second durable acceptance boundary.

Action dedup, current reaction/view and accepted-event observation commit in one
SQL transaction. A failed transaction produces no detector observation. Exact
retries reuse the envelope. Duplicate views for one account/target do not create
extra accepted engagement. Receiver observation time comes from the server.

Accepted-event history is short-lived (ten minutes, indexed cleanup); this is
longer than the fresh-admission window, so expiration does not make old signed
events fresh. Existing current reaction rows remain durable. Clock/database
rollback resistance against the host administrator is not claimed.
Cleanup runs every minute in the HTTP relay, at most 5,000 rows per run. This is
not a hard storage quota: operators must monitor backlog and capacity. An expired
Gun read can repeat only the exact current SQL envelope, without adding an event.

HTTP reactions use `{action}` and reply `{id,status}` where status is `accepted`
or `duplicate`. Views use `{actions:[...]}` (maximum 32) and return per-action
receipts. The body parser bounds bytes (4 KiB / 32 KiB), handles malformed/null
JSON and aborts, and replies only once. A batch is atomic per action, not per
whole request; retrying a partly committed batch deduplicates earlier successes.

The client signs with an existing persisted account key and does not generate a
key on this path. Reaction retries (two HTTP attempts) reuse the exact envelope;
a local Gun ACK cannot substitute for an exact HTTP receipt. View pending state
is memory-only, capped at 256; successful-session IDs at 4,096; expired unsigned
or signed observations are dropped after five minutes, never re-signed as new.
Account changes discard old pending observations. Beacon queueing is not server
acceptance. Pending views do not survive app termination; loss is preferred to
inventing accepted engagement or retaining background tracking indefinitely.

## Compatibility and rollout

This is an explicitly versioned write contract and requires coordinated client
and relay rollout. Unsigned legacy writes receive an upgrade-required rejection;
there is no automatic unsigned fallback. Legacy records/totals are not signed by
migration and must not be input to authenticated coordination analysis. Old
aggregate display values do not become verified engagement merely because new
writes use v1. Historical signed envelopes may be read after their admission
window expires; they may not be replayed as fresh authority.
Legacy display records without envelopes remain readable; an invalid envelope
cannot fall back to an unsigned `type` field. Legacy baseline corrections are
display hints only and are no longer appended to new signed leaves.

Deploy backend schema and both server patches with the client update. Old clients
cannot submit unsigned writes to upgraded relays. The new client requires exact
v1 HTTP receipts, so old servers cannot silently confirm these actions. Do not
mix old/new writable relay processes against the same database. Review and
quarantine old reaction caches before enabling the new Gun gate; never assign
authentication to old cached data. The schema adds `engagement_actions_v1` and
new signed leaf data; it does not rewrite history or alter account/DM state.

Archive baseline for backend patches:
`c2b34fa670c66f7b3644aed5ec3b2a3592c49b094eebc8ee51d625431de39955`.
Client branch base: `645ddea39c593a3c4c5504266eb22ef14985fb1d`.
The backend archive is a dirty deployment snapshot, not current master. Preserve
it unchanged and review backend patches separately; never overlay the entire
archive onto master. No deployment or live endpoint testing is authorized here.

## Review-only analysis

Only successfully committed v1 actions may acquire an internal verified-action
marker. No arbitrary client flag authorizes this marker. Timing/target overlap
may suggest coordination, including legitimate campaigns. It cannot classify
people or justify automatic bans. Raw WebSocket scores, unsigned Gun records,
legacy view IDs, private messages and failed authentication are excluded.

The local experiment's existing bounds and false-positive limitations remain.
Other relays/clients can apply different policies; this is not network-wide
consensus, global Sybil resistance or a calibrated production bot detector.

The existing offline detector is still not wired to the running application.
This pass supplies attributable, deduplicated observation input, not a deployed
detector. A separate adapter must prove target existence/public visibility before
exporting observations for review: a signed target identifier alone proves
neither. Post/comment creation, view-truthfulness, CAPTCHA/human uniqueness,
rate-limit redesign, private-content policy and moderation decisions are not
implemented here. A key owner can generate many keys or lie about viewing.

## Local regression evidence

- Client: `unit_tests/publicEngagement.test.ts` covers account binding, immutable
  retries, exact receipts, signed reads, active writer wiring, signed beacons,
  expired/bounded pending views and account switching.
- Separate backend source copy: `tests/engagement.test.mjs` covers field tamper,
  wrong subject/path/namespace, 64 concurrent duplicate consumers, rollback,
  reopen/expiry, signed view dedup, real request callbacks and real in-memory Gun
  admission/forwarding. MySQL transactions use a deterministic local double;
  a real MySQL/multi-process and full server interoperability test is still due.
