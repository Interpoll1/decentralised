# Utils — `src/utils/`

> **Keep this file updated** whenever you add or change a utility.

Pure functions with no side effects and no store/service dependencies.

## `chainValidation.ts` — `ChainValidation`

Static class with standalone block validation helpers. Use in tests or external tools where you don't want to go through `ChainService`.

- `validateBlockStructure(block)` — type/shape check only
- `validateBlockHash(block)` — recomputes and compares `currentHash`
- `validateBlockChain(current, previous)` — structure + index sequence + hash linkage
- `findInvalidBlock(blocks[])` — returns index of first invalid block, or `-1`

Note: `ChainService.validateBlock()` is the canonical runtime validator and also checks Schnorr signatures. `ChainValidation` skips signature checks — use only where signature verification isn't needed.

## `mnemonicHelper.ts` — `MnemonicHelper`

BIP-39 mnemonic utilities: `validate()`, `format()` (trim + lowercase), `toWords()`, `fromWords()`, `isValidWordCount()` (12 or 24), `getWordCount()`.

## `pseudonym.ts` — `generatePseudonym(postId, authorId)`

Generates a deterministic 3-word pseudonym (`adjective-landscape-animal`) for a `(postId, authorId)` pair using FNV-1a hashing. The same user gets a different name in each post, providing context-local anonymity. Used by post/comment cards — **not stored in GunDB**.

## `dataVersionSettings.ts` — Data version management

Reactive settings for which GunDB data versions (v1, v2, …) the user wants to see. Depends on `GUN_NAMESPACE` from `gunService.ts`.

- `enabledVersions` — reactive `ref<string[]>` of currently enabled versions (persisted in localStorage)
- `availableVersions` — reactive `ref<string[]>` populated by `probeForVersions()`
- `getEnabledVersions()` / `setEnabledVersions(versions)` — read/write helpers
- `isVersionEnabled(v)` — check if a specific version is enabled
- `probeForVersions(rawGun, currentNamespace)` — scans GunDB for which namespaces (v1 root-level, v2+ namespaced) actually contain post data; updates `availableVersions`

## `feedRanking.ts` — Personalized feed ranking helpers

Pure ranking/filtering utilities for Home and Community feed personalization.

- `rankFeedItems(items, preferences, joinedCommunityIds?)` — applies:
  - hard filters (muted communities, disabled content types)
  - scoring (freshness, engagement, keyword relevance, community affinity)
  - excluded-keyword demotion (keeps content visible but lowers rank)
  - deterministic ordering fallback by `createdAt`
- Works with `FeedPreferencesService` settings (mode, keywords, community preferences, ranking weights).

## `identityTrust.ts` — Username issuer trust parsing

Parses user identity-style usernames (e.g. `viktor@endles.sbs`) into a normalized trust signal for UI/service logic.

- `parseIdentityTrust(rawUsername)` returns `{ identityUsername, issuer, hasIssuer, isTrustedIssuer, trustLevel }`
- `trustLevel` is `'trusted-issuer'` when issuer domain is in the trusted issuer allowlist, otherwise `'unverified'`
- `formatTrustedIdentityLabel({ username, issuer })` returns `username@issuer` for trusted profiles, but preserves an already-qualified username so labels do not become duplicated like `name@issuer@issuer`

## `gunAsync.ts` — Async primitives over Gun's callback API

Gun's chain methods are fire-and-forget with no completion guarantee, so the old
code guessed with fixed `setTimeout`s and silently truncated or hung. **Every
helper here is guaranteed to settle**, and none of them reject — a failed write
is a value, because every caller wants to fall back to a local outbox rather than
unwind.

- `gunPut(node, data, timeoutMs = 8000)` → `{ ok, err? }`. `{ ok: false, err: 'timeout' }`
  rather than hanging when no ack arrives.
- `gunOnce<T>(node, timeoutMs = 5000)` → `T | null`. `null` instead of never
  resolving for a node no peer holds.
- `gunReadChildren<T>(node, { idleMs, minMs, maxMs })` → `{ key, value }[]`.
  **Settles on quiet, not on a stopwatch**: keeps collecting until nothing new has
  arrived for `idleMs`, bounded by `maxMs`. A slow relay gets the time it needs; a
  fast one returns immediately. Null children (Gun's representation of deleted
  entries) are skipped.
- `verifySoulOnRelay(soul, deadlineMs)` → `true` (relay holds it) / `false`
  (endpoint answered, soul absent) / `null` (endpoint unreachable — inconclusive,
  retry rather than assume loss). **Deliberately an HTTP side-channel**
  (`GET {gunRelayBase}/db/soul?soul=...`), not a Gun read: with
  `localStorage:false, radisk:false` a `.once()` resolves from the copy we just
  wrote locally and confirms nothing.
- `toGunRecord(source)` — flattens to primitives, **dropping `undefined` and
  `null`**. A node whose every value is null is an *empty* node and Gun never acks
  an empty put; that is the failure mode that once stopped polls replicating.
- `sleep(ms)`.

Tested in `unit_tests/gunAsync.test.ts`.

## `hybridCrypto.ts` — Envelope encryption for direct messages

RSA-OAEP with a 2048-bit modulus and SHA-256 carries at most **190 bytes** of
plaintext. DMs used to be encrypted with it directly over the message text, so
anything longer threw inside `crypto.subtle.encrypt` — and the chat view swallowed
the failure, which is why normal-length messages disappeared on send.

- `seal(text, recipientPublicKey, senderPublicKey)` → `{ ciphertext, keyForRecipient, keyForSender }`.
  A fresh AES-256-GCM key encrypts the body (`iv || ciphertext`, base64); only the
  32-byte AES key is RSA-wrapped, once per side. Length is unbounded and every
  already-published RSA identity key keeps working.
- `open(envelope, privateKey, 'recipient' | 'sender')` → plaintext. Falls back to
  the v1 layout (`encryptedForRecipient` / `encryptedForSender`) so older
  conversations stay readable.
- `generateIdentityKeyPair()` / `exportPublicKey()` / `importPublicKey()` — the
  private key is generated non-extractable; a key pair's *public* key is
  extractable regardless, which is what publishing to Gun relies on.
- `toBase64` / `fromBase64` — `toBase64` is chunked because
  `String.fromCharCode(...bytes)` overflows the call stack on inputs of this size,
  now reachable since message length is uncapped. `fromBase64` returns an
  `ArrayBuffer`, which is what WebCrypto wants.

Tested in `unit_tests/hybridCrypto.test.ts`.

## `messageOrder.ts` — Deterministic chat ordering

`compareMessages(a, b)` / `sortMessages(list)`: timestamp → per-sender `seq` → id.
Ordering on wall clock alone rendered a conversation differently on each side
whenever two devices' clocks disagreed, and left same-millisecond messages in
whatever order the graph happened to yield. `seq` is a per-device counter
(monotonic even when that device's clock is not) and only means anything *within*
one sender's stream; the id is the final tiebreak, so every participant computes
the same order. Used by both `chatService.ts` and `chatRoomService.ts`.

Tested in `unit_tests/messageOrder.test.ts`.

## `boundedMap.ts` — Size- and age-capped caches

`BoundedMap<K, V>` and `BoundedSet<T>` are drop-in replacements for `Map`/`Set` in
service-level caches. Prefer them over a bare `Map` for anything keyed by an entity
id (post, comment, community, pubkey, message, nonce): those grow one entry per
item the session has ever touched, and before this existed nothing ever released
them — not even at `emergency` memory pressure.

- `new BoundedMap({ maxSize, ttlMs?, onEvict? })` — LRU eviction past `maxSize`;
  optional per-entry TTL, expired entries read as absent.
- Map-compatible: `get`/`set`/`has`/`delete`/`clear`/`size`/`keys`/`values`/
  `entries`/`forEach`/iterator. Iteration skips expired entries.
- `peek(key)` — read without marking the entry as recently used.
- `prune()` — drop expired entries eagerly. Lazy expiry only reclaims entries that
  are read again, so a cache gone cold holds memory until this is called; the
  memory watchdog calls it at `light` pressure.
- `trimTo(n)` — shrink to `n` entries, least-recently-used first.

`BoundedSet<T>` is the same thing for membership guards (`add`/`has`/`delete`/
`clear`/`prune`/`trimTo`/`size`).

**Caveat:** do not bound a cache whose in-memory contents are the source of truth
for a whole-map persistence write. `VoteTallyService.polls` is deliberately left
unbounded for this reason — its `persist()` serializes the entire map, so evicting
an entry from memory would erase those votes from storage on the next write.
