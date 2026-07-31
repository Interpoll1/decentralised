# User Key / Identity PR Checklist

Scope for branch: pavlo-user-keys-v1

## Goal

Create a minimal, safe foundation for InterPoll user identity:

- public key = real identity
- username = readable alias
- private key stays local only
- profile/user record should be signed by the user key
- multi-device support comes later
- encrypted communities stay separate from identity keys

## Current state

Existing relevant files:

- src/services/keyService.ts
 - existing keypair generation / import / export logic
- src/services/userService.ts
 - current user/profile CRUD and search
- src/services/keyVaultService.ts
 - encryption key storage / import / export
- src/services/encryptionService.ts
 - AES/HMAC primitives
- src/services/communityService.ts
 - community signing/verifying and private community key logic

## Recommended first PR

Start with documentation only:

- add docs/user-key-identity-map.md
- add this checklist
- do not change runtime behavior yet

This gives the team a clear model to review before code changes.

## Optional second PR

If the team agrees, add a tiny identity helper:

- src/services/userIdentityService.ts

Possible responsibilities:

- create signed profile record
- verify signed profile record
- treat public key as identity
- treat username as alias
- never store private key outside local device storage

## Do not touch in this PR

- relay-server.js
- OAuth/session logic
- GunDB sync logic
- private community encryption flow
- invite link logic
- UI components
- multi-device approval
- global username registry

## Open questions for maintainers

1. Should profile signing reuse existing KeyService directly?
2. Is current UserService intended to be identity-authoritative, or only profile/display data?
3. Should username uniqueness be local/UI-only for v1?
4. Should signed profiles be stored in GunDB as public profile records?
5. Should public key fingerprints be displayed when usernames collide?
6. Should encrypted community keys stay fully separate from identity keys?

## Suggested v1 identity language

For v1:

- identity is the public key
- username is an alias
- private key stays local
- profile records are signed
- global unique usernames are out of scope
- multi-device identity recovery is out of scope
