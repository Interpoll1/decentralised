# InterPoll Protocol (IPP) — Whitepaper (superseded)

**Version:** 0.5 → superseded
**Status:** Superseded by the numbered IPP specification series

---

> **This single-document whitepaper has been superseded** by a versioned,
> NIP-style set of numbered specifications in [`docs/protocol/`](./protocol/),
> which use RFC 2119 requirements language and separate normative behavior from
> current-implementation notes. This file is retained for historical reference
> and to keep existing links resolvable.
>
> **Start here:** [`docs/protocol/IPP-00-overview.md`](./protocol/IPP-00-overview.md)

## Where each section went

| Old whitepaper section | New spec |
|---|---|
| §1 Ethos, §2 What it is, §3 Why unique, §16 Reference map | [IPP-00 Overview](./protocol/IPP-00-overview.md) |
| §5.1 Boot & identity; identity portions | [IPP-01 Identity](./protocol/IPP-01-identity.md) |
| §7.1 Integrity-sealed requests | [IPP-02 Canonical Format & Integrity Envelope](./protocol/IPP-02-canonical-format.md) |
| §4 Protocol objects (Vote, Block, Receipt) | [IPP-03 Domain Objects](./protocol/IPP-03-domain-objects.md) + [schemas/](./protocol/schemas/) |
| §4.4 Signed events (kinds 100–103) | [IPP-04 Events](./protocol/IPP-04-events.md) |
| §5.2 Vote path, §11 Relay trust | [IPP-05 Vote Flow](./protocol/IPP-05-vote-flow.md) |
| §6 Replication, §7 Transport, §8 Discovery | [IPP-06 Replication & Discovery](./protocol/IPP-06-replication-discovery.md) |
| *(new)* Multi-relay vote quorum | [IPP-07 Multi-Relay Quorum](./protocol/IPP-07-multi-relay-quorum.md) — **Proposed** |
| §9 Anti-abuse, §5.5 Verified usernames | [IPP-08 Anti-Abuse](./protocol/IPP-08-anti-abuse.md) |
| §15 Encrypted communities | [IPP-09 Encrypted Communities](./protocol/IPP-09-encrypted-communities.md) |

The §12 app-origin trust boundary, §13 receipt semantics, and §14 threat model /
non-goals content is distributed across IPP-03 (receipts), IPP-05 (relay trust),
and the overview scope statements.
