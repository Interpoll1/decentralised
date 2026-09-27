# InterPoll coordination pilot work report

27 September 2026. Review branch: `feat/coordination-pilot-v1`.

This branch contains the new pilot exporter, review runner, tests and operating instructions. It is follow-up work beyond the earlier contributions already merged into InterPoll. The pilot has not been deployed or connected to the live feed. Viktor can review and test the complete package from this branch.

Implementation and test base: `f746a471179f002e0b1e3c93deeb93c350a74553`. The saved local verification covered all 16 pilot source paths. Those bytes were checked again before publication; the only subsequent changes are the README publication note and this report. The executable code and test files are unchanged.

## What was added

A standalone tool reads accepted signed reactions from MySQL, produces a signed export and runs the analyzer with independent replay of its results. The sample is limited to pre-approved public posts, one relay and the current ten-minute window. The tool does not write to the database, ban accounts or change the feed.

Approval is bound to the post, its community and their privacy/deletion flags. Normal counter updates are allowed; the hash of the record actually read is preserved separately in the signed export manifest. This does not verify the meaning of the post or the author's identity.

## Local verification

- **131/131 tests passed**, with 0 failures and 0 skipped: 98 new pilot tests and 33 tests of the unchanged analyzer. Full saved test run: 37.47 seconds on Node.js v22.15.0.
- Coverage includes signature and policy tampering, privacy, expiry, limit violations, SQL projection through a test-double connection, query failures, transaction completion, file limits and CLI execution.
- A separate CLI run saved three reports. Independent replay returned `VERIFIED_RELATIVE_TO_SNAPSHOT` for each.

| Synthetic scenario | Result | Full run and replay |
| --- | --- | --- |
| Independent activity | `NO_PATTERN` | 0.888 s |
| Coordinated activity | `REVIEW_CANDIDATES` | 1.018 s |
| Legitimate organized campaign with the same actions | `REVIEW_CANDIDATES` | 0.466 s |

Each scenario contains 19 signed observations. The last two produce identical calculation receipts: intent cannot be determined from these data. These are individual small local runs, not measurements of server performance or accuracy with real users.

The existing analyzer tree remains `edccfed0b8efd6bde96dedaff8e93395381f7713`. Relative to the implementation base, the `src`, `shared-validation` and `deployment` directories, the existing analyzer and the root lockfile are unchanged. Only a test command was added to the root `package.json`. The new MySQL2 3.24.4 driver has a separate lockfile; a clean installation succeeded with install scripts disabled.

The test suite was not rerun for the publication-only documentation changes. The recorded test log SHA256 is `296c7aa28c855a670ac20d2658c671dfbeb58426b1cebd7e06437a6e3a5f55a8`; the original 16-path inventory SHA256 is `4d0c77d80fa1febbf65e63db8bc55a9ab69344e0fec49e95d5e7f8f60987e869`. These identify the saved local verification artifacts; the README publication edit is not part of that original inventory.

## How to check this branch

From a clean repository checkout, fetch and check out `origin/feat/coordination-pilot-v1`. Use Node.js 22.15.0 or newer and run from the repository root:

```sh
npm ci --ignore-scripts
npm ci --prefix tools/coordination-pilot --ignore-scripts
npm run test:coordination
npm run test:coordination-pilot
node tools/coordination-pilot/cli.mjs scenarios OUT_DIR
```

Replace `OUT_DIR` with a dedicated local directory outside the repository. Synthetic scenarios require no database credentials or real operator key. See the [setup and operating instructions](../../tools/coordination-pilot/README.md) and [pilot contract](COORDINATION_PILOT_V1.md) before any staging export.

## Before a real pilot

**A real MySQL server and real users have not been tested.** The Docker daemon was unavailable in the development environment; connection-double tests do not establish how a real SQL server behaves. The full web application build and test suite were not run during this pilot stage; application code was unchanged.

Viktor should validate the SQL and read-only account permissions on a staging server, approve the public posts and observer key, run controlled scenarios with volunteers and measure resource usage. The policy and key must be approved independently of the received export. Public test keys must not be used for real data.

Results apply to an incomplete retained sample. Ranking changes refer to the `window-net-reactions-v1` model, not the personalized feed. Signatures and replay do not establish database completeness, bot status, intent or launch readiness.

All example data are synthetic. No real database credentials, participant records or production access were used for this preparation.
