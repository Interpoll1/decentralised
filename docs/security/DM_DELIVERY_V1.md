# DM delivery evidence v1

`pending` means there is no qualifying recipient evidence. Encryption may still be pending. Once encryption succeeds, the envelope journal exists durably before transmission. A failed write, timeout, relay forwarding acknowledgement, or Gun callback leaves the message pending. Existing automatic retry limits (12 attempts / seven days) remain; lack of further automatic retries does not imply delivery.

`published` is not emitted by this DM path: gunPut acknowledges local/unspecified peer acceptance, not durable remote storage. No stronger persistence contract is available in this tree.

`confirmed` is retained for UI compatibility and means **delivered to the current cryptographic session peer**. It requires a successfully decrypted receipt with a matching outgoing message ID and envelope digest, and the receipt sender must match that outgoing recipient. It does not prove the peer displayed/read the content, retained it forever, or is the intended account owner (identity binding is separate work).

Outgoing `read` is not asserted. Unauthenticated relay read frames are ignored. Local read state for incoming messages remains local. Legacy confirmation/read flags alone do not qualify; the upgraded message projection suppresses them without inventing evidence.

## Receipt payload and processing

A receipt is an ordinary v3 encrypted DM whose plaintext starts with NUL followed by `DM-DELIVERED-1:` and JSON `{ "id": <original message id>, "digest": <lowercase SHA-256 hex> }`.

The digest hashes UTF-8 JSON of this ordered array:

```
["interpoll-dm-delivery-1", id, senderId, recipientId,
 v, eph-or-empty-string, opkId-or-empty-string, dh, n, pn, ct]
```

1. Recipient authenticates and atomically stores the original message with its receiver state/OPK changes.
2. It creates an encrypted control receipt with deterministic local ID `dm-receipt-v1:<digest>`. Its own sending state and immutable envelope journal use the normal transaction.
3. Sender authenticates and atomically accepts the receipt. It then checks the digest and peer before projecting `deliveryEvidence` and `confirmed` onto the original row.
4. If interrupted between receipt acceptance and status projection, flushOutbox replays the durable accepted receipt. No new decryption or sending position is needed.
5. Control receipts are excluded from message rendering and never trigger receipts of their own. Duplicate receipt processing is idempotent for durable evidence; a later retry of an original message can retransmit the same receipt envelope.

## Storage and rollout

No IndexedDB version bump or ratchet-state rewrite. Additive metadata journal entries and optional `control`/`deliveryEvidence` row fields are used. Journals are intentionally retained; garbage collection requires a separate proof that stale logical-message retries cannot consume a fresh position.

The cryptographic envelope remains v3. Receipt plaintext and media descriptor formats are explicitly versioned. New media uses `_file:true, _encryptedMedia:1, media:{version:1,...}`; old inline and relay-URL history can still render. Unknown media versions fail closed.

Both peers must upgrade for meaningful confirmation and new media rendering. Older clients do not understand the receipt control payload and may display it as text; they cannot generate qualifying receipts. Older clients cannot decrypt the new media format through their legacy renderer. This is a coordinated-client rollout requirement, not transparent interoperability. Close/reload every client sharing the database before use. No Signal compatibility claim is made.

Metadata such as accounts, timings, ciphertext length, and blob access remains visible to the transport. The live relay/native-client combinations have not been validated by these local tests.
