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
