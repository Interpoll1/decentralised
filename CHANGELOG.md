# Changelog

All notable changes to this **GenosDB edition of InterPoll** are documented here.

This is a fork of the original GunDB-based app, with its entire data, identity and
real-time layer rebuilt on [GenosDB](https://github.com/estebanrfp/gdb). The format
is based on [Keep a Changelog](https://keepachangelog.com/), and dates use ISO 8601.
See [WHY-GENOSDB.md](./WHY-GENOSDB.md) for the full rationale, metrics and evidence.

## [2026-06-21] — Governance, reactivity & moderation

### Added

- **Earned-role governance** (Security Manager RBAC + `governanceRules`). A public,
  identical-for-everyone ladder: a settled `guest` becomes a `member`, and a `member`
  climbs to `trusted` by posting (`postCount ≥ 3`), auto-demoting if activity drops.
  Roles are signed by a superadmin acting as a transparent *notary* (it only signs
  what the public rules dictate) and then **propagate and persist across peers** even
  after it goes offline — earned network-wide trust with no central censor and no
  global `delete`.
- **Reactive role badge** — a governance promotion climbs the badge **live, with no
  refresh**: the badge subscribes to the Security Manager `user:<address>` node via
  realtime `db.get`. Verified cross-peer (a write on one browser fires the
  subscription on another).
- **Community-scoped moderation via node ACLs.** Each post is an ACL-owned node (its
  author owns it), so an author can delete their **own** posts, and a community owner
  can delegate `delete` to trusted moderators — who may then remove a rule-violating
  post in **that** community only. There is no global `delete`, no platform-wide
  censor: each community governs its own space.
- **Markdown posts** with a minimalist Preview/Edit toggle.
- **Role-based identity** — the old external-issuer "verify" system was removed; the
  badge now shows `u/name · role`, with trust earned via governance instead of an
  issuer. Cryptographic-Identity card shows the abbreviated address per the GenosDB
  docs.

### Fixed

- **Blank page on Netlify / generic static hosts** — added `netlify.toml` (`publish =
  dist`, SPA `/* → /index.html` 200 redirect). The Vite production build uses absolute
  asset paths and loads GenosDB from `/genosdb/*`, so `dist/` must be served from the
  web root.
- **Production build 404s on GenosDB's runtime-loaded sibling modules** (`sm-*.min.js`,
  `genosrtc.min.js`, …). Letting the bundler split + hash GenosDB scattered the
  siblings it resolves via `new URL('./*.min.js', import.meta.url)`. The build now
  copies GenosDB's `dist/` intact into the output (`public/genosdb/`), served natively.

### Changed

- Netlify is the single source of truth (repo-linked auto-deploy: `git push` → live).
- Fresh P2P room name to start the governance demo from a clean slate.

## [2026-06-08] — Migration from GunDB to GenosDB

### Changed

- **Rebuilt the entire data, identity and P2P layer on GenosDB.** Gun, IPFS and libp2p
  are gone. What Gun needed ~30 dependencies + ~50 services + 3 relay servers for,
  GenosDB provides in **one dependency**: scoped OPFS storage off the main thread (Web
  Worker), Nostr-based peer discovery, WebRTC sync and reactive queries. Identity is
  the Security Manager signing key — not a spoofable device id — and **every operation
  is signed and verified by peers**, so stored data is inherently authentic.
- **Metrics:** services 40 → 21 · source ~46k → ~23.1k LOC (−50%) · runtime deps 28 →
  16 (P2P stack 13 → **1**) · relay servers 3 → **0** · zero Gun / IPFS / libp2p.
- Identical UI: Vue 3 + Ionic + Capacitor + Pinia + Vite kept verbatim — only the
  data/identity/P2P seam was swapped, with no friction in the app code.
