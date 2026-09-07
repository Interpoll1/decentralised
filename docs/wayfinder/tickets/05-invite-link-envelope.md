---
id: 05
title: Invite link envelope v2
map: ../MAP-p2p-recomposition.md
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [01, 02]
---

## Question

What exactly is in a v2 invite link, given the issuer chooses per link whether it is
transport-only or capability-bearing?

Decide:

- **Fields**: issuer public key, bootstrap hints (which tiers, in what form — relay URLs,
  LAN address/port, rendezvous topic/soul, helper discovery token), issue time, expiry,
  intended use (transport-only vs capability), the capability payload itself when present.
- **Signing and verification**: what the joiner can verify offline, what needs a peer,
  and what a signature means when the issuer's key is unknown to the joiner.
- **Encoding and size**: URL fragment vs path, base64url vs binary+compression, and the
  hard ceiling imposed by QR codes and chat apps that mangle long URLs.
- **Secrecy**: the fragment never hits a server, but links get pasted into logs and chats.
  What is safe in the clear, and what must be behind a second factor?
- **Expiry, revocation, single-use**: which of these are enforceable with no relay to hold
  the consumed-code state? The existing single-use invite codes consume atomically *in Gun* —
  say plainly what survives when Gun is unreachable.
- **Staleness**: LAN IPs and rendezvous topics rot. How does a joiner tell "this link is
  old" from "this network is down", and what does it do about it?
- **Backwards compatibility** with links `inviteLinkService` issues today.

## Why it matters

Links are the one artifact that leaves the system and comes back later. Every field is a
promise you cannot revise after the link is in someone's chat history.
