# Coordination pilot v1: local preparation and staging handoff

This package prepares a manual, supervised review pilot for explicitly approved public volunteer posts. It exports one retained ledger sample, verifies the operator's policy and signed export, runs the existing coordination calculation in a disposable worker, then replays any receipt in a separate fresh worker. It does not alter accounts, admission, votes, feeds, moderation or transport.

The governing contract is [COORDINATION_PILOT_V1.md](../../docs/security/COORDINATION_PILOT_V1.md). The calculation remains [coordination-impact-experiment-v1](../coordination-impact/README.md). Pilot authority and export semantics are additional bindings; they do not change the meaning of older snapshots or receipts.

This is a review package for staging, not a production deployment. The [work report](../../docs/security/COORDINATION_PILOT_REPORT_2026-09-27.md) records the completed local checks and pending staging work. Real MySQL execution has **not been tested** in this environment: the Docker daemon was unavailable. Injected-connection tests exercise query construction and failure handling; they do not establish actual server isolation, privilege enforcement, timeout behavior or rollback behavior.

## Local setup

Use Node.js 22.15.0 or newer. Run these commands from the repository root, keeping the complete repository layout: the pilot imports the unchanged analysis and shared validation modules.

```text
npm ci --ignore-scripts
npm ci --prefix tools/coordination-pilot --ignore-scripts
npm run test:coordination-pilot
```

Root dependencies are required by the shared validator and analysis code. The pilot's separate package and lockfile pin its MySQL driver to `mysql2` 3.24.4. Installation does not provision a database, create an operator identity or start a server. Record the actual test results and exact source revision used for a handoff; dependency installation alone is not validation.

The three synthetic scenarios require no database or operator key:

```text
node tools/coordination-pilot/cli.mjs scenarios OUT_DIR
```

Replace `OUT_DIR` with a dedicated local directory outside the repository. This creates three synthetic reports: `normal`, `coordinated`, and `legitimate-campaign`. The latter two deliberately use identical observable evidence and must produce the same arithmetic result. Their labels are fixture context, not a capability to infer intent. Public synthetic identities are confined to fixtures and must never be used for a real operator or volunteer.

## Operator authority and files

Before a staging export, Viktor and the responsible operator must approve the exact volunteer posts, their direct communities, the single relay, namespace, policy interval and observer public key. Participation and public visibility require explicit human review. A signature on a community record does not authenticate its privacy flags. Missing flags do not independently authorize collection.

Keep the database configuration, observer private key, policy and participant evidence in an access-restricted local directory outside the repository and outside shared/synchronized folders. Use a **dedicated real operator key**, provisioned through the operator's approved key-management process. Do not reuse a fixture key, a participant's account key or an application's relay credential. The CLI does not generate or replace an operator key.

`KEY_FILE` contains the dedicated observer's 64-character lowercase hexadecimal private key, with optional surrounding whitespace. Its public key must match `policy.observer`. Pass the file path only: do not place secret values in command-line arguments, environment variables, examples, reports or messages. Restrict file access with the operating system's permissions; POSIX mode requests do not establish Windows ACL protection.

The policy is JSON with exactly these fields:

| Field | Required meaning |
| --- | --- |
| `version` | Integer `1`. |
| `scope` | Exactly `operator-reviewed-public-posts`. |
| `relayId` | Approved single-relay identifier. |
| `namespace` | Approved namespace, such as `v5`. |
| `observer` | The dedicated observer's 64-character lowercase hexadecimal public key. |
| `validFrom`, `validUntil` | Unix epoch milliseconds as safe integers; expiry is later than start and at most 24 hours after it. |
| `targets` | One to twenty exact entries, each with `id`, `communityId`, `postReviewHash`, `communityReviewHash`. No duplicate post IDs. |

Post and community roots are addressed as `NAMESPACE/posts/POST_ID` and `NAMESPACE/communities/COMMUNITY_ID`. Each root post must link directly to its approved community. Comments, views, poll ballots, private/group content and automatic discovery are excluded.

The approval pins cover stable reviewed identity, direct community linkage and visibility/deletion metadata. They deliberately exclude the full record body and mutable counters: upvote, downvote or member-count changes must not invalidate an otherwise unchanged approval. The analyzer does not read post text; approving these pins is not approval or authentication of body semantics.

The exact review digest is `digest(['interpoll.coordination-pilot-target-review.v1', projection])`, where `projection` contains only `soul`, `id`, `communityId`, `isPrivate`, `isEncrypted`, `deleted`, `isDeleted`, and `encrypted`. The first four privacy/deletion flags normalize `null` to `false`; `encrypted` must be explicitly `false` for an admitted record. This normalization only operates under an independently approved policy and is not evidence of public visibility by itself.

For policy preparation, the operator and DBA must review the selected roots and obtain the bounded metadata projection described in `mysql-source.mjs`. Do not collect post bodies or unrelated records for the exporter. Prepare one projected metadata object per reviewed root, containing those eight fields plus `dataHash`. Compute its approval pin with the exported `reviewDigest` function:

```text
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {reviewDigest} from './tools/coordination-pilot/export.mjs'; console.log(reviewDigest(JSON.parse(readFileSync(process.argv[1], 'utf8'))));" REVIEW_RECORD
```

`REVIEW_RECORD` is the local reviewed metadata JSON file, not a received bundle. Place the post result in `postReviewHash` and its directly linked community result in `communityReviewHash`. Shared communities must have one consistent approval pin. Changes to identity, linkage or reviewed flags require new human review and a newly approved policy.

Separately, `dataHash` is SHA-256 of the complete stored `gun_nodes.data` value as observed by the database projection. It remains signed manifest evidence of the observed record bytes and is **not** the approval pin. A counter-only change can change `dataHash` while leaving the review pin unchanged. Editing the raw hash in an already signed manifest still invalidates that signature. Neither kind of digest proves that the source's assertions are true. Do not reinterpret older raw-record hash fields as this version's review-projection pins.

`DIGEST` is the externally approved policy digest computed by the existing `digest(policy)` function, using canonical JSON. It is not an ordinary hash of a pretty-printed JSON file. Review the local policy first, record the approved digest separately, and transfer that approval through the operator's trusted handoff. Never accept a digest solely because a received bundle embeds the same policy or digest.

For an already reviewed policy file, the following command computes that canonical digest. It does not grant approval:

```text
node --input-type=module -e "import {readFileSync} from 'node:fs'; import {digest} from './tools/coordination-impact/core.mjs'; console.log(digest(JSON.parse(readFileSync(process.argv[1], 'utf8'))));" POLICY
```

## Database prerequisites

A database administrator must separately provision a SELECT-only account for the staging database, limited to the required `engagement_actions_v1` and `gun_nodes` reads. Confirm its effective grants independently. The tool requests a read-only transaction; that request is not proof that the account has only read privileges. Do not use the application's pool, import its connection module, grant write privileges, or run a migration as part of this pilot.

`DB_CONFIG` is a private JSON file. Its only allowed keys are `host`, `port`, `socketPath`, `user`, `password`, and `database`. `user`, `password`, and `database` must be nonempty strings. For TCP, `host` must be exactly `127.0.0.1` or `::1`, with an integer `port`; the hostname `localhost` and remote hosts are rejected. Alternatively, provide an absolute local Unix `socketPath` and omit both `host` and `port`.

The connection uses a separate driver with multiple statements disabled and safe BIGINT handling. Capture requests repeatable-read isolation and a consistent read-only transaction, obtains database time, selects only approved reaction/post ledger rows and target metadata, then rolls back. No commit or data-changing SQL is issued. Query timeout settings are 2 seconds per query; these are not a verified end-to-end runtime guarantee on an actual server.

Before staging, verify the actual MySQL version, schema, table engines, ledger admission rules and retention settings on both relays. Run one relay per bundle. This exporter provides no cross-relay reconciliation or proof that both relays have identical data or deployed code.

## One manual export and review

The command shapes are:

```text
node tools/coordination-pilot/cli.mjs export POLICY DIGEST DB_CONFIG KEY_FILE OUT_DIR
node tools/coordination-pilot/cli.mjs run BUNDLE DIGEST OUT_DIR
```

Replace uppercase words with local paths or the separately approved digest; quote paths containing spaces. `BUNDLE` is the completed file path printed by a successful export. `run` consumes that file and the external approval pin; it does not contact MySQL. There is no background loop, scheduler, historical-window argument or browser import.

Use a policy whose validity begins at the approved start of observation, then allow a full ten minutes before capture: the entire inclusive window `[readAt - 600000, readAt]` must fall within the policy interval. Do not backdate authorization to make an early export pass. The database clock must be within 30 seconds of the exporter clock. Complete review while the policy remains valid; reissuing a policy requires renewed approval, not editing an old bundle.

The exporter admits at most 1,000 signed observations and reads up to 1,001 rows to detect overflow. It preserves `up`, `down`, and `none` transitions and checks every duplicated ledger column against the actor-signed envelope. It rechecks freshness at the stored `received_at`. Oversized or malformed rows, duplicate IDs, unknown targets, missing metadata, mismatched pins, explicit privacy/deletion state and invalid signatures reject the whole export; there is no partial sample fallback.

Limits include 2,048 UTF-8 bytes per payload, 64 KiB per source graph record inspected for metadata, 1 MiB per snapshot, 2 MiB per bundle/report and 20 approved posts. An oversized graph record rejects rather than transferring its body. Existing analysis graph limits still apply. Analysis and fresh replay each have a separate worker deadline of at most 5 seconds and a 64 MiB old-generation heap limit. The combined export, verification, analysis and replay is not a single five-second operation or a 64 MiB total-process memory guarantee.

Successful export prints `EXPORTED_REVIEW_SAMPLE`, its path and observation count. Review reports use these outcomes:

| Outcome | Interpretation |
| --- | --- |
| `REVIEW_CANDIDATES` | The supplied sample contains qualifying relationships. A receipt is returned only after independent worker replay. |
| `NO_PATTERN` | No qualifying relation was found in this sample. It does not establish that participants are human or activity is benign. |
| `CANNOT_ESTABLISH` | Validation, resource limits, worker execution or replay prevented an accepted result. Inspect the coded reason; never relabel this as `NO_PATTERN`. |
| `VERIFIED_RELATIVE_TO_SNAPSHOT` | The separate replay reproduced a receipt from the accepted snapshot. It does not verify source completeness, honesty or participant identity. |

The evidence is a **retained committed sample**, with completeness explicitly `not-established`. The ledger retains only ten minutes; pruning, late commits, clock differences and omitted pre-window state prevent completeness claims. `received_at` is the relay admission-attempt receipt clock persisted by a successful transaction, not its commit time or a globally first receipt. Metadata reflects capture-time eligibility, not a verified history of continuous public visibility throughout the window. A signed observer export attests to its supplied observations; it does not make the database trustworthy.

Rank changes describe the fixed `window-net-reactions-v1` model. They are not effects on the production personalized feed. Do not infer bots, unique humans, malicious intent or production protection from either a candidate or its counterfactual ranking.

## Volunteer staging protocol

Agree the participants, approved public posts, schedule, independent case labels, performance limits and stop conditions before collecting evidence. Keep identities and consent records separate from exported pseudonymous observations. Use a disposable staging database for invalid-input and privacy controls; do not modify real production records to manufacture a test.

1. **Normal activity:** have volunteers react independently, with a schedule that does not create the repeated synchronized relation. Record the known schedule separately, export once after the eligible observation period, and compare the report with the planned control.
2. **Coordinated activity:** use at least five volunteer accounts acting in the same direction on at least three approved posts, within the model's 60-second pairwise coincidence interval. Verify exact event IDs and receipt-time gaps in the resulting witnesses, rather than treating a status label as sufficient evidence.
3. **Legitimate campaign:** repeat the observable schedule under an explicitly legitimate campaign label. Comparable evidence should produce the same arithmetic outcome. This is a required demonstration that the model cannot infer intent.
4. **Controls:** include a valid empty window, one shared target, opposing directions and clear-to-`none` transitions. On disposable staging fixtures, separately exercise wrong pins, invalid signatures, duplicate IDs, expired policy, changed community links/privacy, overflow, oversized payloads, rollback/query failure and a boundary event at each window endpoint. Record whether the expected acceptance or refusal actually occurred.

Run the synthetic scenarios and local tests before real volunteer staging. Then validate the real database behavior: accepted rows are committed and transactionally visible, uncommitted concurrent writes are excluded as expected, later commits and pruning have the documented limitations, the account cannot write, and connection/query/rollback failures produce no accepted partial artifact. These checks remain pending until performed against a real MySQL instance.

## Manual performance and accuracy gates

For each bounded run, record the exact source revision, policy digest, relay/schema versions, input count, timing, result/reason and replay outcome. Compare server latency/CPU/memory and volunteer browser responsiveness against a baseline while the capture runs. The report's worker heap measurement is heap usage at the end of computation, not peak memory or total server load. Measure export SQL and the complete operation separately from worker timings.

Use pre-agreed resource ceilings and stop if a run exceeds them; retain `CANNOT_ESTABLISH` outcomes in the assessment. Evaluate false positives on representative consented normal activity and legitimate campaigns, with independently recorded labels. A synchronized campaign may be a correct observation of coordination and still be a false positive for an interpretation of maliciousness. This pilot has no basis for a bot-detection accuracy percentage or launch-readiness claim without a separate evaluation design and evidence.

Viktor's staging handoff should include the reviewed source revision, local validation results, actual database checks, externally approved public targets/policy/observer pin, volunteer protocol and measured resource/false-positive results. Do not enable production collection or enforcement merely because unit tests and synthetic scenarios pass. The tool has no enforcement action and should remain review-only throughout this pilot.

## Evidence storage and cleanup

Use a dedicated managed output directory containing only generated `pilot-*.bundle.json` and `pilot-*.report.json` artifacts. The writer publishes completed files exclusively and refuses overwrites. It caps each artifact kind at 20 files, checks both filename timestamps and modification times for its 24-hour retention limit, and uses a directory lock to prevent concurrent publication races. It does not automatically delete evidence.

The operator must manually review and delete evidence within 24 hours, keeping at most 20 bundles and their reports. The checks cover the managed directory's observed file names and metadata, not copies, backups, external directories or historical retention. Provision a private directory with restrictive ACLs on Windows and verify permissions on the actual host: the tool does not harden pre-existing permissions or Windows DACLs. No participant evidence should be published automatically.

If a run reports `OUTPUT_BUSY`, an unmanaged file, expired evidence or a partial-write problem, inspect the directory and confirm that no process is active before manual cleanup. Do not treat `.pilot-writing` or a leftover lock as a completed export, and do not bypass the cap by silently creating accumulating output directories. Keep operational records free of private keys, passwords, tokens and raw database error text.
