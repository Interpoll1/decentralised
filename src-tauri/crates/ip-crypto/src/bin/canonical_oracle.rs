//! Test oracle for the canonical-JSON differential test.
//!
//! Reads one JSON value per line on stdin, writes its canonical form per line on
//! stdout. Line-oriented so a single process can serve tens of thousands of
//! cases without paying process-spawn cost per case.
//!
//! Driven by `unit_tests/canonicalDifferential.test.ts`, which generates random
//! values, canonicalises them with the real `canonical.js`, and asserts the two
//! outputs match byte for byte.
//!
//! Input lines are `stableStringify` cases. A line prefixed with `C:` is a
//! `canonicalJSON` case instead (meta-field stripping applied).

use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    for line in stdin.lock().lines() {
        let line = line?;
        if line.is_empty() {
            continue;
        }

        let (strip_meta, payload) = match line.strip_prefix("C:") {
            Some(rest) => (true, rest),
            None => (false, line.as_str()),
        };

        let result = match serde_json::from_str::<serde_json::Value>(payload) {
            Ok(value) => {
                if strip_meta {
                    ip_crypto::canonical_json(&value)
                } else {
                    ip_crypto::stable_stringify(&value).unwrap_or_else(|| "undefined".to_string())
                }
            }
            // Surfaced rather than panicking: a parse failure is a real result
            // the test should see and report, not a crashed oracle.
            Err(err) => format!("PARSE_ERROR: {err}"),
        };

        writeln!(out, "{result}")?;
    }

    out.flush()
}
