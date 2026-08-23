//! Protocol crypto primitives for the desktop build.
//!
//! Everything here must produce bytes identical to the JavaScript
//! implementation in `src/services/cryptoService.ts` and
//! `shared-validation/`. The network is the specification; where this crate and
//! the JS disagree, this crate is wrong.
//!
//! Phase 0 ships the canonical-JSON layer only, because it is the foundation
//! every signature and hash rests on and the one most likely to diverge
//! silently. Hashing, BIP-340 Schnorr signing and proof-of-work follow in
//! Phases 2 and 4.

pub mod canonical;

pub use canonical::{canonical_json, stable_stringify, META_FIELDS};
