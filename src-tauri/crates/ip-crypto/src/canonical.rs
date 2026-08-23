//! Canonical JSON — a byte-exact port of `shared-validation/canonical.js`.
//!
//! # Why this file is written the hard way
//!
//! Signatures cover `sha256(canonicalJSON(msg))`. If Rust and JS disagree about
//! the canonical bytes for even one value, the desktop app produces signatures
//! that verify against itself and fail against the network — intermittently, and
//! only for the content that happens to contain the divergent value. That class
//! of bug is close to undiagnosable from the outside, which is why the canonical
//! form is reproduced here explicitly rather than delegated.
//!
//! Two deliberate non-choices:
//!
//! * **Not RFC 8785 / JCS.** JCS is a fine canonicalisation standard and the
//!   wrong one here: its number formatting differs from `JSON.stringify`, and
//!   the network's definition of canonical is whatever `canonical.js` emits.
//! * **Not `serde_json::to_string`.** serde_json formats floats via Ryū, so
//!   `1.0` serialises as `"1.0"` where JavaScript emits `"1"`. Every
//!   integer-valued float in the protocol would diverge.
//!
//! Where this port and `canonical.js` disagree, `canonical.js` is correct by
//! definition — it is what the deployed relays already run.

use serde_json::{Map, Value};

/// Envelope fields computed and attached *after* signing, and therefore excluded
/// from the canonical form.
///
/// Note what is absent: `_ts` and `_nonce` are freshness fields that MUST stay
/// inside the signed bytes. Stripping them would let an attacker replay a
/// captured message with a fresh timestamp while the signature still verified.
pub const META_FIELDS: [&str; 4] = ["_hash", "_sig", "_pub", "_pow"];

/// Serialise a value to its canonical form: object keys sorted, `undefined`
/// dropped, no insignificant whitespace.
///
/// Mirrors `stableStringify`. Returns `None` where JS returns `undefined` —
/// which JS only does for `undefined` itself, a case `serde_json` cannot
/// represent, so in practice this is always `Some`. The signature is kept
/// faithful to the original so the array and object branches below can express
/// their JS behaviour directly.
pub fn stable_stringify(value: &Value) -> Option<String> {
    match value {
        Value::Null => Some("null".to_string()),
        Value::Bool(b) => Some(if *b { "true" } else { "false" }.to_string()),
        Value::Number(_) => Some(format_number(value)),
        Value::String(s) => Some(quote_string(s)),

        Value::Array(items) => {
            // JS: `val.map(v => stableStringify(v) ?? 'null')`. Array holes and
            // `undefined` elements serialise as `null`, never vanish — dropping
            // one would shift every later index and change the value.
            let parts: Vec<String> = items
                .iter()
                .map(|v| stable_stringify(v).unwrap_or_else(|| "null".to_string()))
                .collect();
            Some(format!("[{}]", parts.join(",")))
        }

        Value::Object(map) => {
            // JS: `Object.keys(val).sort()`. `Array.prototype.sort` without a
            // comparator orders by UTF-16 code unit. Rust's `str` ordering is by
            // Unicode scalar value, which agrees for everything in the Basic
            // Multilingual Plane but NOT for astral characters (U+10000 and up):
            // those are a surrogate pair in UTF-16, and a lone high surrogate
            // (0xD800..) sorts *below* U+E000..U+FFFF, while in Rust the scalar
            // sorts above. Keys are compared as UTF-16 here so astral-plane keys
            // — emoji in a user-supplied field, say — cannot diverge.
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| cmp_utf16(a, b));

            let mut pairs: Vec<String> = Vec::with_capacity(keys.len());
            for key in keys {
                // `if (sv !== undefined)` — a key whose value is `undefined` is
                // omitted entirely, unlike in an array.
                if let Some(serialised) = stable_stringify(&map[key]) {
                    pairs.push(format!("{}:{}", quote_string(key), serialised));
                }
            }
            Some(format!("{{{}}}", pairs.join(",")))
        }
    }
}

/// Strip the derived meta fields, then serialise. Mirrors `canonicalJSON`.
///
/// Non-object input returns `"{}"`, matching the JS, which does
/// `Object.entries(obj)` on whatever it is handed.
pub fn canonical_json(value: &Value) -> String {
    let mut stripped = Map::new();
    if let Value::Object(map) = value {
        for (key, val) in map {
            if !META_FIELDS.contains(&key.as_str()) {
                stripped.insert(key.clone(), val.clone());
            }
        }
    }
    stable_stringify(&Value::Object(stripped)).unwrap_or_else(|| "{}".to_string())
}

/// Compare two strings by UTF-16 code unit, as `Array.prototype.sort` does.
fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Format a number as `JSON.stringify` does.
///
/// JavaScript has one numeric type. `1`, `1.0` and `1e0` are the same value and
/// all serialise as `"1"`; serde_json would emit `"1.0"` for the second. This
/// implements ECMA-262 `Number::toString(x, 10)`, which is where that behaviour
/// actually comes from.
fn format_number(value: &Value) -> String {
    let n = match value.as_f64() {
        Some(n) => n,
        // Not representable as f64 — only reachable via serde_json's optional
        // arbitrary-precision support, which we do not enable.
        None => return value.to_string(),
    };

    // JSON has no NaN or Infinity; `JSON.stringify` emits null for both.
    if !n.is_finite() {
        return "null".to_string();
    }
    // JS `-0` stringifies as "0" (String(-0) === "0"), though `Object.is`
    // distinguishes it. Handled here because Rust's formatter would emit "-0".
    if n == 0.0 {
        return "0".to_string();
    }

    let negative = n < 0.0;
    let abs = n.abs();

    // Shortest round-tripping decimal digits and a base-10 exponent.
    //
    // NOT `format!("{:e}", abs)`. Rust's default float formatting produces *a*
    // shortest representation that round-trips, but when several do, it may pick
    // a different one than V8. Real divergence caught by the differential test:
    // 1738474848680198.2 formats as "1.7384748486801983e15" in Rust and
    // "1.7384748486801982e15" in JavaScript — both 17 digits, both round-trip.
    //
    // ECMA-262 `Number::toString` requires the FEWEST digits that round-trip,
    // and among those the value closest to x. Asking for an explicit precision
    // gives correctly-rounded — hence closest — digits, so we walk precisions
    // upward and stop at the first that round-trips. That is the spec's rule
    // stated directly, rather than a hope that two shortest-float algorithms
    // agree.
    let exp_form = shortest_round_trip(abs); // e.g. "1.2345e2", "1e0", "1e-7"
    let (mantissa, exponent) = exp_form.split_once('e').expect("LowerExp always emits 'e'");
    let exponent: i32 = exponent.parse().expect("LowerExp always emits an integer exponent");

    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    // A zero mantissa is unreachable: n == 0.0 returned above.
    let digits = if digits.is_empty() { "0" } else { digits };

    let k = digits.len() as i32; // number of significant digits
    let n_exp = exponent + 1; // position of the decimal point, per the spec's `n`

    let body = if k <= n_exp && n_exp <= 21 {
        // Integer with trailing zeros: 1e3 -> "1000"
        format!("{}{}", digits, "0".repeat((n_exp - k) as usize))
    } else if 0 < n_exp && n_exp <= 21 {
        // Decimal point inside the digits: 12.34 -> "12.34"
        format!("{}.{}", &digits[..n_exp as usize], &digits[n_exp as usize..])
    } else if -6 < n_exp && n_exp <= 0 {
        // Small magnitudes keep positional notation down to 1e-6:
        // 0.000001 -> "0.000001"
        format!("0.{}{}", "0".repeat((-n_exp) as usize), digits)
    } else {
        // Exponential notation. JS writes an explicit '+' for positive
        // exponents ("1e+21") and no zero padding ("1e-7").
        let e = n_exp - 1;
        let sign = if e >= 0 { "+" } else { "-" };
        if k == 1 {
            format!("{}e{}{}", digits, sign, e.abs())
        } else {
            format!("{}.{}e{}{}", &digits[..1], &digits[1..], sign, e.abs())
        }
    };

    if negative {
        format!("-{}", body)
    } else {
        body
    }
}

/// Scientific-notation form of `x` using the fewest significant digits that
/// still parse back to exactly `x`.
///
/// An f64 carries at most 17 significant decimal digits, so the loop always
/// terminates by p = 17; the fallback exists only to keep the function total.
/// Most protocol numbers are small integers and exit within a few iterations.
///
/// One acknowledged gap: when a decimal sits exactly halfway between two f64
/// values, ECMA-262 specifies the larger digit string, whereas Rust's formatter
/// rounds half to even. Reaching that requires an exact tie at the shortest
/// round-tripping precision, which the 20k-case differential test has not
/// produced; if it ever does, the test fails loudly rather than shipping a bad
/// signature.
fn shortest_round_trip(x: f64) -> String {
    for precision in 0..=16 {
        let candidate = format!("{:.*e}", precision, x);
        if candidate.parse::<f64>() == Ok(x) {
            return candidate;
        }
    }
    format!("{:.16e}", x)
}

/// Quote and escape a string as `JSON.stringify` does.
///
/// Escapes exactly what the spec's `QuoteJSONString` escapes and nothing more.
/// In particular non-ASCII characters are emitted literally — escaping them
/// would be valid JSON and the wrong bytes.
fn quote_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Remaining C0 controls use the \u00XX long form, lowercase hex.
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Expectations taken from what `JSON.stringify` actually emits. The
    /// differential test in `unit_tests/canonicalDifferential.test.ts` checks
    /// this against a live JS engine over random input; these pin the specific
    /// cases known to diverge between implementations.
    #[test]
    fn numbers_match_javascript() {
        let cases: &[(f64, &str)] = &[
            (1.0, "1"),           // serde_json would emit "1.0"
            (-1.0, "-1"),
            (0.0, "0"),
            (-0.0, "0"),          // String(-0) === "0"
            (1.5, "1.5"),
            (100.0, "100"),
            (1e3, "1000"),
            (1e20, "100000000000000000000"),  // last positional magnitude
            (1e21, "1e+21"),                  // first exponential magnitude
            (1.5e21, "1.5e+21"),
            (1e-6, "0.000001"),               // last positional small
            (1e-7, "1e-7"),                   // first exponential small
            (1.5e-7, "1.5e-7"),
            (0.1, "0.1"),
            (1234.5678, "1234.5678"),
            (9007199254740991.0, "9007199254740991"), // Number.MAX_SAFE_INTEGER
            (5e-324, "5e-324"),                        // Number.MIN_VALUE
            (1.7976931348623157e308, "1.7976931348623157e+308"), // MAX_VALUE
        ];
        for (input, expected) in cases {
            assert_eq!(
                stable_stringify(&json!(input)).unwrap(),
                *expected,
                "formatting {input}"
            );
        }
    }

    #[test]
    fn non_finite_becomes_null() {
        assert_eq!(format_number(&json!(f64::NAN)), "null");
        assert_eq!(format_number(&json!(f64::INFINITY)), "null");
    }

    #[test]
    fn keys_sort_by_utf16_code_unit() {
        // U+1F600 is a surrogate pair in UTF-16 (0xD83D 0xDE00), so it sorts
        // BELOW U+FF5E — the opposite of Rust's scalar-value ordering. A naive
        // `keys.sort()` gets this backwards.
        let value = json!({ "\u{1F600}": 1, "\u{FF5E}": 2 });
        assert_eq!(
            stable_stringify(&value).unwrap(),
            "{\"\u{1F600}\":1,\"\u{FF5E}\":2}"
        );
    }

    #[test]
    fn keys_are_sorted() {
        let value = json!({ "b": 1, "a": 2, "C": 3, "_z": 4 });
        // Uppercase sorts before lowercase; '_' (0x5F) between them.
        assert_eq!(stable_stringify(&value).unwrap(), r#"{"C":3,"_z":4,"a":2,"b":1}"#);
    }

    #[test]
    fn strings_escape_like_javascript() {
        assert_eq!(quote_string("a\"b\\c"), r#""a\"b\\c""#);
        assert_eq!(quote_string("\n\t\r"), r#""\n\t\r""#);
        // C0 controls without a short form use the lowercase \u00XX long form.
        assert_eq!(quote_string("\u{0000}\u{001f}"), "\"\\u0000\\u001f\"");
        assert_eq!(quote_string("\u{0008}\u{000c}"), r#""\b\f""#);
        // Non-ASCII stays literal.
        assert_eq!(quote_string("héllo → 😀"), "\"héllo → 😀\"");
    }

    #[test]
    fn canonical_json_strips_only_derived_meta_fields() {
        let value = json!({
            "_sig": "deadbeef", "_hash": "x", "_pub": "y", "_pow": 1,
            "_ts": 123, "_nonce": "abc",
            "payload": "hi",
        });
        // _ts and _nonce MUST survive: they are replay-protection fields and
        // must be inside the signed bytes.
        assert_eq!(
            canonical_json(&value),
            r#"{"_nonce":"abc","_ts":123,"payload":"hi"}"#
        );
    }

    #[test]
    fn nested_structures_recurse() {
        let value = json!({ "b": [1, { "d": 4, "c": 3 }], "a": null });
        assert_eq!(canonical_json(&value), r#"{"a":null,"b":[1,{"c":3,"d":4}]}"#);
    }

    #[test]
    fn non_object_input_yields_empty_object() {
        assert_eq!(canonical_json(&json!(42)), "{}");
        assert_eq!(canonical_json(&json!("str")), "{}");
    }
}
