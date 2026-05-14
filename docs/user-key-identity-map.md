# User Key / Identity Architecture Map

Read-only architecture note for the first user/key identity pass.

## Goal

Define a small identity model before changing runtime code:

- public key = durable identity
- username = readable alias
- private key stays local only
- profile records should be signed by the user key
- multi-device support comes later
- encrypted community keys stay separate from identity keys

## Existing relevant files

### src/services/keyService.ts

Handles Schnorr keypair generation / import / export.

This appears to be the closest existing service for identity/signing keys.

Relevant role:

- generate keypair
- import/export keypair
- provide signing/verification primitives or key material for other services

### src/services/userService.ts

Contains UserProfile, UserStats, and user/profile CRUD/search logic.

Likely place where readable profile data belongs:

- username
- display name
- avatar
- stats
- public profile metadata

Open question: whether UserService should become identity-authoritative, or only manage display/profile records.

### src/services/keyVaultService.ts

Manages stored encryption keys.

This should probably remain focused on encryption/community access keys, not identity/auth keys.

Important separation:

- identity key = signs user/profile/actions
- encryption key = unlocks private community/content

### src/services/encryptionService.ts

Provides AES/HMAC primitives.

Useful for private communities and encrypted content, but should not be mixed with identity semantics directly.

### src/services/communityService.ts

Handles community creation, joining, signing/verifying, private community metadata, and key-related flows.

This is important for future encrypted communities, but should not be touched in the first identity PR.

### src/components/KeyManagementSection.vue

UI for key import/export/delete flows.

Should not be changed in the first docs-only PR.

### Stores

Relevant stores include:

- src/stores/communityStore.ts
- src/stores/postStore.ts
- src/stores/pollStore.ts
- src/stores/commentStore.ts

They contain local/session tracking and hooks into private community/content flows.

These should not be changed in the first identity PR.

## Proposed v1 identity model

For the first version:

- identity is the user public key
- username is a human-readable alias
- profile record is signed by the identity key
- private key never leaves local device storage
- if two users choose the same username, UI can show a short public-key fingerprint
- global unique usernames are out of scope

Example display:

```text
pavlo#A91F
```