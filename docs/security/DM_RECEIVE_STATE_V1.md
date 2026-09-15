# DM receive-state contract v1

## States and authority

OBSERVED means a transport supplied bytes; no cryptographic authority or permanent dedup follows. PENDING/RETRYABLE means a bounded durable inbox entry awaits initialization, discovery, bootstrap/session prerequisites or a successful storage transaction. ACCEPTED means AEAD, epoch admissibility and the durable acceptance transaction succeeded. DUPLICATE_ACCEPTED is an idempotent lookup of that exact accepted authenticated position and ciphertext, with no second message/ratchet commit. REJECTED_AUTH and REJECTED_STALE are terminal for that attempt; they are not retried automatically or assigned accepted status. A corrected ciphertext may use the same outer ID because rejected transport bytes cannot reserve an authenticated position.

Missing bundle/bootstrap and transient storage failure are retryable. Invalid structure/signature/AEAD with available authoritative state, stale F06 generations, consumed/evicted positions and excessive gaps are terminal. Terminal bytes are removed from the pending inbox; no unbounded rejection history is kept. Future transport repetition may be validated/rejected again, but is never automatically retried. Typed receive results distinguish accepted, duplicate, retryable, rejected-auth and rejected-stale.

## Skipped keys

MAX_SKIP=1000 missing positions per forward operation on a chain; MAX_TOTAL_SKIPPED=1000 per ratchet. Retained keys are indexed by DH public key and message number within their owning authenticated epoch/session state. They cannot be shared across epoch states. Retain keys through at most four subsequent receive DH transitions. Evict oldest insertion first when the total bound is exceeded; transition-age expiry is applied deterministically. Both age/order persist across restart. The F06 current and at-most-one simultaneous receive-only branch each obey these bounds (at most 2000 keys for the pair). Epoch replacement discards prior-generation private states as already specified by F06.

A skipped key is consumed only with successful AEAD and acceptance commit. Forged input cannot consume or age/evict it durably. A previously advanced current-chain position without a retained key is stale. Recent closed-chain public keys remain a bounded rejection window; older unknown DH keys cannot recreate erased message keys from the one-way ratchet and must authenticate before any tentative state commits. Resource-bound eviction may make otherwise valid delayed traffic permanently undecryptable; that is explicit policy, not a reset trigger.

Existing v5 skipped keys in the current chain are assigned age zero on first successful receive under this policy; already discarded keys cannot be recovered. This is a local storage extension, not a wire change or legacy epoch trust promotion.

## Pending inbox and identity

The durable inbox is namespaced by local account. Entries identify routing accounts plus a SHA-256 fingerprint of the exact protocol envelope (excluding outer ID/timestamp). Authenticated position identity uses verified session/bootstrap ID, sender account, DH key and message number. Candidate routing/context is untrusted until signature/epoch validation succeeds; queue membership never grants authority.

Limits: 64 entries, 2 MiB aggregate serialized entries, 256 KiB maximum candidate envelope, 24-hour lifetime from first local observation. Duplicate exact candidates coalesce without refreshing lifetime. Oldest first-observed entry is evicted first, with fingerprint lexical order as a tie-breaker. Expiry/eviction do not create accepted tombstones. The full entry, timestamp and context persist across normal restart. Storage outage may prevent durable enqueue; return retryable without claiming persistence, and rely on caller/transport retry.

Retry pending work on initialization, regular receive/outbox servicing and successful prerequisite acceptance. A bounded batch attempts each retained entry at most once; terminal outcomes remove it, successful outcomes remove it atomically with crypto acceptance. In-memory admission is also bounded; excess concurrent observations return retryable rather than allocating an unbounded per-sender promise queue. A pending entry expiring/being evicted is not guaranteed eventual delivery.

## Atomic acceptance and dedup

The transaction jointly commits ratchet/skipped-key state, epoch/OPK/identity changes, accepted chat row, authenticated-position dedup record and pending removal. Any failed transaction commits none of these. Dedup records survive restart independently of volatile seenIds. The record binds the exact ciphertext fingerprint to its authenticated position and original accepted outer ID. Changed outer metadata cannot produce a second acceptance; same outer ID with different bytes cannot inherit acceptance. F06 stale generation checks precede duplicate lookup. Accepted history has no timed expiry here, consistent with F06; bounded inbox claims do not imply bounded accepted conversation history.

Transient receive failure does not mutate crypto state. Durable inbox writes are observation bookkeeping, never session authority. Existing accepted v5 rows can be recognized by their stored envelope; no migration invents dedup/authority for unauthenticated legacy rows. Legacy epoch quarantine remains unchanged. Whole-storage rollback, transport liveness, device compromise and F11+ remain outside scope.
