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

## `betaFeatures.ts` — Beta feature flags

Reactive feature-flag system backed by localStorage (`interpoll_beta_features`).

- `betaFeatures` — reactive `ref<Record<BetaFeature, boolean>>` of current toggle states
- `setBetaFeature(feature, enabled)` — persists a toggle change
- `isBetaEnabled(feature)` — non-reactive check (for use in router guards)
- Current flags: `resilience` (default: off)

## `feedRanking.ts` — Personalized feed ranking helpers

Pure ranking/filtering utilities for Home and Community feed personalization.

- `rankFeedItems(items, preferences, joinedCommunityIds?)` — applies:
  - hard filters (muted communities, disabled content types)
  - scoring (freshness, engagement, keyword relevance, community affinity)
  - excluded-keyword demotion (keeps content visible but lowers rank)
  - deterministic ordering fallback by `createdAt`
- Works with `FeedPreferencesService` settings (mode, keywords, community preferences, ranking weights).
