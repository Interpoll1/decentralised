# IPP-09: Encrypted Communities and Private Spaces

**Status:** Draft
**Version:** 1
**Supersedes:** `docs/protocol-whitepaper.md` v0.5 (§15)

Requirements language: see [[IPP-00-overview]].

---

## 1. Model

InterPoll supports fully encrypted communities where community metadata and all
content (posts, polls, comments, chat) are encrypted **client-side before** being
written to the content graph. A community's *existence* and member count remain
visible (`isEncrypted: true` shell); only content is hidden from non-members.

A conforming implementation MUST encrypt content client-side before replication —
plaintext MUST NOT be written to a shared root for an encrypted community. The
reference client writes redacted placeholder shells from the first write.

| Object | Encrypted payload | Public shell |
|---|---|---|
| Community meta | `name`, `displayName`, `description`, `rules[]` → `encryptedMeta` | `isEncrypted`, member count, creator id, `🔒 Private Community` |
| Post / Poll / Comment | all content fields → `encryptedContent` | `🔒 Encrypted …` placeholder |
| Chat room / messages | room meta / message text+sender → `encryptedMeta` / `encryptedContent` | `🔒 Encrypted Room` / none |

## 2. Encryption algorithm

Content encryption MUST use **AES-256-GCM** (Web Crypto):

- A fresh random 96-bit IV MUST be generated per operation and prepended to the
  ciphertext; `IV(12) || ciphertext` is base64-encoded as the stored blob.
- Decryption extracts the IV from the first 12 bytes and relies on GCM
  authentication to detect tampering.
- Each blob MUST additionally carry an **HMAC-SHA256 auth tag** derived from the
  community key via HKDF, domain-separated with `'interpoll-hmac-auth-v1'` — an
  anti-sabotage check independent of the GCM tag.

For an encrypted community, encryption failure MUST be fatal (fail closed — never
fall back to writing plaintext).

## 3. Key distribution

Two join methods:

- **Invite-link (random key).** Creator generates a random AES-256 key. The
  invite URL is `{origin}/join/community/{id}#{base64url-key}`. The `#fragment`
  MUST NOT be sent to any server (it lives only in the URL bar). The invitee
  extracts the key from the fragment.
- **Password (derived key).** Key derived via PBKDF2-SHA-256, 600,000 iterations,
  salt = `communityId + 'interpoll-v2'`. Any peer who knows the password and
  community id derives the same key.

Keys MUST be stored locally only (IndexedDB via `KeyVaultService`), never
replicated. Keys MAY be exported/imported as JSON for backup.

## 4. Trust model and limitations (normative disclosures)

| Actor | Can observe |
|---|---|
| Content-graph / WebSocket relays, backend | Encrypted blobs only |
| Uninvited peers | Community existence + member count |
| Members | Full plaintext after decryption |

Implementations and operators MUST disclose:

- **Frontend must be trusted** — a compromised bundle can exfiltrate keys or
  plaintext before encryption.
- **Invite links must be shared securely** — invisible to servers but present in
  browser history and copy-pasteable.
- **Key loss is permanent** — no recovery mechanism.
- **No key revocation/rotation** — every member with the key retains permanent
  read access to all past content.
- **Metadata still leaks** — community existence, membership/activity size,
  timing, social-graph hints (which keys join which encrypted communities), and
  network metadata (IP/session). Encryption protects payload confidentiality, not
  traffic shape. There is no cover traffic or mixnet.

## 5. Key storage record

```ts
{
  id: string,                                   // communityId | chatRoomId | 'server'
  type: 'community' | 'chatroom' | 'server',
  key: string,                                  // base64 AES-256
  method: 'invite' | 'password',
  label: string,
  joinedAt: number
}
```

`'server'` keys support operator-wide `encryptAll`, deriving all communities on a
relay instance from one server password. Encryption keys are separate from the
identity keypair of [[IPP-01-identity]] and MUST NOT be conflated with it.

---

## Conformance checklist

- [ ] Content is encrypted client-side (AES-256-GCM, per-op 96-bit IV, HKDF HMAC tag) before replication; no plaintext on shared roots for encrypted communities.
- [ ] Encryption failure for an encrypted community fails closed.
- [ ] Invite-link key material lives only in the URL fragment and is never sent to a server; password keys use PBKDF2-SHA-256 600k iterations with the specified salt.
- [ ] Encryption keys are stored locally only, never replicated, and kept separate from identity keys.
- [ ] The frontend-trust, key-loss, no-revocation, and metadata-leakage limitations are disclosed.
