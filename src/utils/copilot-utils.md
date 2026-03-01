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
