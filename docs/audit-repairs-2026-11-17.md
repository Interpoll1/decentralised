# Audit follow-up: first use, media and build traceability

These changes follow the review of master `904840b2ef7a0c8ef7509861e1774e82a76ba6a5` and the first-use fixes in Draft PR #64. They are source changes for review, not a production security approval.

## Changes

- A shared poll no longer starts Home's tour over its answer controls. Answer labels work, multiple selections remain independent, and votes save plain option arrays to IndexedDB.
- Chat media authenticates its key, IV and protected descriptor on every render, including warm ciphertext-cache reads. Ciphertext caches are partitioned by authorization context using a digest; tokens and plaintext are not persisted in that cache. Direct decrypt calls return independently owned object URLs. Chat history retains a display URL per exact identity/message/envelope only after authentication and revokes duplicate allocations.
- Poll reads reject invalid signatures when present, including offline backups and decrypted private content. Both historical signing encodings are recognized explicitly. This is **legacy field verification only**: historical signatures cover question, community, timestamp and, in the newer legacy encoding, the vote trust policy. They do not bind answer labels, the entire poll, result completeness or a unique human. Unsigned legacy polls remain readable. A required, fully canonical poll signature needs a versioned writer/reader/relay migration; it is not silently assigned to old records.
- Trust-level lookup verifies issuer signatures, identity binding and expiry instead of accepting a graph record's `verified` label. Cached certificates are revalidated.
- Poll creation's timeout recovery keeps root and community confirmation variables in scope on both the offline and repair paths.
- Feed toggles read native HTML change events, storage controls use the policy's actual field names, QR relay scanning returns raw values, and relay connection events carry their declared endpoint object. Broken profile/chat and peer-health references were repaired.
- Application TypeScript configuration inherits the real target and path aliases. Strictness and unused-code checks remain enabled; stale declarations were removed. The existing generic Gun-outbox API expected by tests was restored separately from active signed-reaction and encrypted-message outboxes. It does not publish until a handler explicitly registers and a caller enqueues a write.
- Gun/SEA are bundled from the installed lockfile-pinned package. Client startup and Node tests no longer execute scripts from a CDN. The relay kit now has a lockfile too.
- Android runs a full Capacitor sync after building its current native web bundle. Previously tracked generated web assets/configuration are removed from the index and regenerated during builds, so stale generated files cannot masquerade as source or dirty every native build.
- Capacitor 6's default import is adapted to the security-patched tar 7 namespace in the CLI process. Clean template extraction is tested. The tar security override stays in place and installed dependencies are not patched on disk.
- Public web/relay defaults, native share origin, robots/canonical/Open Graph/sitemap and setup instructions use `.social`. Saved built-in `.sbs` relay transports migrate; custom relays and certificate issuer names are preserved. The documented `VITE_WS_RELAY_URL`, `VITE_GUN_RELAY_URL`, `VITE_API_BASE_URL` and `VITE_WEB_ORIGIN` build overrides work.

## Validation

Run from the repository root:

```sh
npm ci
npm ci --prefix community-relay/kit
npm ci --prefix tools/coordination-pilot
npm run typecheck
npm test
npm run test:coordination
npm run test:coordination-v2
npm run test:coordination-pilot
npm run test:poll-first-use
npm run build
npm run verify:build
```

Local Playwright uses installed Chrome. CI installs the pinned Playwright Chromium. The browser suite tests fresh poll links, tours, answer controls, actual local vote storage/receipts, keyboard navigation, settings persistence and two fresh browser profiles replicating data through an isolated real Gun relay. Production HTTP and WebSockets are intercepted; the real relay case allows only its loopback Gun endpoint and starts with no upstream peers. These checks do not establish production synchronization or physical-device behavior.

## Build identity and deployment

Each web/native build writes `build-info.json` with the full source SHA, dirty flag, public endpoint configuration and SHA-256 digests of emitted bundle artifacts. Digests are calculated from final written bytes. `npm run verify:build` detects changed artifacts and a mismatched checkout. CI requires clean source. This manifest is build metadata, not an independent signed attestation or a proof that the production server uses it.

Build timestamps and service-worker build IDs can change bundle bytes when rebuilding the same commit. Different generated filenames or bundle digests alone do not prove different source commits. Compare the reviewed, shipped artifact and its manifest rather than expecting an arbitrary rebuild to be byte-identical.

The deployment job validates configuration before building, runs checks and preserves its build artifact. Configure repository secrets `FTP_USER` and `FTP_PASS`, and repository variables `FTP_HOST` and `REMOTE_DIR`. Use a certificate-valid FTPS hostname and the **actual SPA destination**, after confirming how that app is hosted alongside the separate Nuxt site. No destination is guessed. Certificate validation and encrypted FTP data are required; uploads retain old hashed chunks and publish `index.html` last.

Missing credentials or an unknown server directory cannot be fixed in source. The job intentionally fails before uploading anything until the owner supplies them. Do not print credentials while diagnosing it. After an authorized deployment, retrieve `build-info.json` with cache bypass and compare the listed bundle bytes against the reviewed artifact.

FTP secrets are scoped to preflight/upload steps, outside dependency installation and tests. The password is passed through lftp's documented `LFTP_PASSWORD` environment mechanism, not its process arguments. See the [lftp manual](https://lftp.yar.ru/lftp-man.html).

## Remaining owner/protocol work

- Establish the current production and APK source revisions. No production deployment or production voting is performed by these changes.
- Verify vote authorization, receipt confirmation, reconnect/restart and result propagation across two physical devices against the actual production relay.
- Review private relay modules and their contracts. The public community Gun relay is reproducible; it does not implement the private production WebSocket/OAuth/voting backend.
- Coordinate a versioned canonical poll-signature migration before claiming integrity of all poll fields. Removing all signature fields from an otherwise unsigned-compatible legacy object cannot establish its origin.
- Multi-relay quorum remains the proposal in IPP-07. Receipts and duplicate controls do not establish global consensus, complete tally coverage or one-person-one-vote.
- Keep certificate issuer identifiers and verified email-sender configuration separate from the website's transport-domain migration.

Frozen audit reports, research evidence, past APKs and videos are unchanged.
# Graphite appearance follow-up

The default web and Android appearance restores the reviewed light graphite palette:
canvas `#e7e9ec`, cards `#f7f8f9`, text `#232a31`, and accent `#17664b`.
The terminal theme import is removed. Settings now provides an accessible, persistent
dark-mode switch with a muted graphite counterpart rather than pure black and neon.

The legacy `theme=dark` value was automatically written by the application, so it
cannot establish a deliberate user preference. On the first upgrade it migrates to
light graphite; subsequent explicit choices use `echo_theme_preference_v1`.
This migration does not clear user identity, conversations, votes or other storage.

Onboarding, the Home tour, recovery controls, post actions and accent-button
foregrounds now use theme roles. The existing Grand Hotel wordmark font is bundled
locally with its upstream OFL license so it also renders offline. Android launch,
WebView and system-bar colors follow graphite; a small Capacitor plugin synchronizes
the bars and icon brightness when the user changes appearance.

Regression coverage includes legacy-preference migration, blocked storage,
first paint, keyboard/touch theme selection, reload persistence, mobile/landscape/
desktop layouts, and contrast of key feed, onboarding and tour controls.
