//! B4: a sale out of the Safe priced by 1Click's own signed quote, so it counts in DOLLARS toward the bands.
//!
//! A band lists coin amounts (the core writes each band's dollars as an amount of every coin it can price, USDC at $1
//! among them). A coin no band lists can't be measured that way, so selling it took the last band. An `execute` may now
//! carry 1Click's signed answer to a real (`dry: false`) quote; when every check below holds, the coin sold counts as
//! the quote's `amountInUsd` of USDC, i.e. against each band's dollar limit (its USDC entry), in the same 24-hour budget
//! as everything else. Anything that fails, or can't be read, leaves the request exactly as before (per-coin bands).
//!
//! **What is signed (live proof, 5 Nov 2026, realmoney-all/20261105T0517Z-oneclick-sig-proof/PROOF.md):** 1Click's SDK
//! (`@defuse-protocol/one-click-sdk-typescript` 0.1.26, `quoteHash`/`verifyQuoteSignature`) signs, with Ed25519, the
//! ASCII text base58(sha256(J)), where J is json-stable-stringify of the request's and the quote's signed fields merged
//! with the timestamp. The execute carries J itself (`signed`) and the signature; this file hashes J with `env::sha256`,
//! base58-encodes the digest, checks it with `env::ed25519_verify` against 1Click's key, and only then reads J's fields.
//! Everything checked is read from those same signed bytes, never from anything else the caller sends.
//!
//! **The checks, all required:** the signature over exactly J; J an object with no repeated key and only the SDK's signed
//! field names (none of `referral`, `virtualChainRecipient`, `virtualChainRefundRecipient`, `customRecipientMsg`, which
//! are signed only when set); `dry` false and `depositType` INTENTS; the request one `mt_transfer` on intents.near (no
//! `_call`, no message) paying `depositAddress` exactly `amountIn` of `originAsset`; `recipient` = `refundTo` = this
//! account, `recipientType` = `refundType` = INTENTS; the signed `timestamp` at most 120 s before the block (and at most
//! 120 s after it) and the signed `deadline` after the block; `amountInUsd` a positive decimal (rounded UP to a
//! micro-dollar). Only `execute` and `level_for` read a quote, the same way; `execute_many`, Agent and every payment out
//! keep the per-coin bands, and buys are unchanged. No extra cap, no ratchet: the dollars join the band's own budget.
//!
//! **The key is a constant.** 1Click's quote key (`ONE_CLICK_MANAGER_PUB_KEY` in its SDK) is compiled in. Rotating it is
//! a new contract release, which reaches an account only through its guarded upgrade path (`upgrade`: the strictest
//! level, a release on the account's own list); until then a quote under a new key fails the check and sells take the
//! per-coin bands, as before.
//!
//! **Round 4 (B4-1):** the signed `amountOutUsd` must be at least 98% of `amountInUsd` and the signed `slippageTolerance`
//! at most 100 bps, else the per-coin bands (a live quote gives back about 99.5%).
//!
//! **Residual (stated):** whoever holds 1Click's quote key AND the unlocked phone AND passes Face ID can sell, inside the
//! dollar limit per 24 hours, at a price 1Click's key signs (its `amountInUsd`, its `minAmountOut` and slippage), into
//! this account's own NEAR Intents balance: the proceeds and any refund come back to this account, never elsewhere. The
//! phone and Face ID alone (no 1Click key) get today's per-coin bands; 1Click's key alone gets nothing (only this
//! account's keys call `execute`). A thin coin's dollars (round 4, C4-L3) are 1Click's price for it: a thin market can
//! make that price wrong, so its sale may count fewer dollars than it is worth; the 98% floor bounds what the sale
//! itself loses against that price, not the price.
use super::{add_move, parse_args, Step, INTENTS, SECOND};
use near_sdk::serde_json::Value;
use near_sdk::{env, near};

/// 1Click's quote key, `ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc` (its SDK's ONE_CLICK_MANAGER_PUB_KEY; the
/// core's ONE_CLICK_QUOTE_KEY, packages/core/src/quote-signature.ts). Changing it is a contract release.
pub const ONE_CLICK_QUOTE_KEY: [u8; 32] = [
    0x0c, 0xb7, 0xe9, 0x49, 0xe3, 0x87, 0x1e, 0xcf, 0x28, 0x4a, 0x50, 0xb8, 0xe7, 0x74, 0xab, 0x29, 0xb3, 0xf7, 0xb2, 0x36, 0x3e, 0x39, 0x8c, 0xef, 0x1d,
    0xf2, 0xe9, 0x44, 0x57, 0xb7, 0xe9, 0x43,
];
/// The coin a band's dollar limit is written in: mainnet's USDC, at $1, 6 decimals (core contractBands).
pub const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/// How old the signed timestamp may be at the block (and how far ahead of it).
const QUOTE_MAX_AGE_NS: u64 = 120 * SECOND;
/// The most slippage a priced sale may sign (B4-1): 1%, the core's own (convertRequest's slippageTolerance: 100).
const MAX_SLIPPAGE_BPS: u64 = 100;
/// The signed text's longest (a live one is about 860 bytes).
const MAX_SIGNED: usize = 2048;

/// The field names 1Click's SDK signs on a real quote, as they appear in J. The four foreign ones are absent on purpose.
const SIGNED_FIELDS: [&str; 28] = [
    "dry", "swapType", "slippageTolerance", "originAsset", "depositType", "destinationAsset", "amount", "refundTo", "refundType", "recipient",
    "recipientType", "deadline", "quoteWaitingTimeMs", "amountIn", "amountInFormatted", "amountInUsd", "minAmountIn", "amountOut",
    "amountOutFormatted", "amountOutUsd", "minAmountOut", "depositAddress", "depositMemo", "timeWhenInactive", "timeEstimate", "refundFee",
    "withdrawFee", "timestamp",
];
/// The only argument names the deposit's `mt_transfer` may carry (the core's mtTransfer: `approval: null`, an optional memo).
const DEPOSIT_ARGS: [&str; 5] = ["receiver_id", "token_id", "amount", "approval", "memo"];

/// 1Click's signed answer to a real quote, as an `execute` carries it: `signed` is the exact text 1Click signed (J,
/// above), `signature` its `signature` field ("ed25519:" and base58).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct SignedQuote {
    pub signed: String,
    pub signature: String,
}

#[cfg(test)]
thread_local! {
    /// The unit tests' own quote key, so a test can sign a broken quote; None is 1Click's. Not in any build but tests.
    pub(crate) static TEST_KEY: core::cell::Cell<Option<[u8; 32]>> = const { core::cell::Cell::new(None) };
}

fn quote_key() -> [u8; 32] {
    #[cfg(test)]
    if let Some(k) = TEST_KEY.with(|k| k.get()) {
        return k;
    }
    ONE_CLICK_QUOTE_KEY
}

/// The request's coin rows with the coin it sells counted as dollars (USDC micro-units), when `quote` passes every check
/// for this very request at this block; None otherwise (the caller keeps the per-coin rows). `moves` is what `measure`
/// read from the same steps.
pub(crate) fn priced(receiver: &str, steps: &[Step], moves: &[(String, u128)], quote: &SignedQuote) -> Option<Vec<(String, u128)>> {
    let (token, units, usd) = checked(receiver, steps, quote)?;
    let mut out: Vec<(String, u128)> = vec![];
    for (coin, amount) in moves {
        if *coin == token {
            // One step: the coin's own row is exactly that transfer's amount.
            if *amount != units {
                return None;
            }
        } else {
            add_move(&mut out, coin, *amount);
        }
    }
    add_move(&mut out, USDC, usd);
    Some(out)
}

/// (the coin sold, its amount, its dollars in micro-dollars) when every check holds.
fn checked(receiver: &str, steps: &[Step], quote: &SignedQuote) -> Option<(String, u128, u128)> {
    // 1. 1Click signed exactly these bytes.
    let signed = quote.signed.as_bytes();
    if signed.is_empty() || signed.len() > MAX_SIGNED {
        return None;
    }
    let sig: [u8; 64] = base58_decode(quote.signature.strip_prefix("ed25519:")?)?.try_into().ok()?;
    let digest: [u8; 32] = env::sha256_array(signed);
    if !env::ed25519_verify(&sig, base58_encode(&digest).as_bytes(), &quote_key()) {
        return None;
    }
    // 2. Its fields, read from those bytes only: no repeated key, nothing the SDK doesn't sign.
    let Value::Object(q) = parse_args(signed)? else { return None };
    if !q.keys().all(|k| SIGNED_FIELDS.contains(&k.as_str())) {
        return None;
    }
    let text = |k: &str| q.get(k).and_then(Value::as_str);
    if q.get("dry") != Some(&Value::Bool(false)) || text("depositType")? != "INTENTS" {
        return None;
    }
    // 3. This request is that deposit: one mt_transfer on intents.near, to the signed address, of the signed coin and amount.
    let [Step::FunctionCall { method_name, args, .. }] = steps else { return None };
    if receiver != INTENTS || method_name != "mt_transfer" {
        return None;
    }
    let Value::Object(a) = parse_args(&args.0)? else { return None };
    if !a.keys().all(|k| DEPOSIT_ARGS.contains(&k.as_str())) || !a.get("approval").map_or(true, Value::is_null) || !a.get("memo").map_or(true, Value::is_string) {
        return None;
    }
    let token = a.get("token_id")?.as_str()?;
    let amount = a.get("amount")?.as_str()?;
    if a.get("receiver_id")?.as_str()? != text("depositAddress")? || token != text("originAsset")? || amount != text("amountIn")? {
        return None;
    }
    let units: u128 = amount.parse().ok()?;
    // 4. It pays this account's own NEAR Intents balance and refunds there too.
    let me = env::current_account_id();
    if text("recipient")? != me.as_str() || text("refundTo")? != me.as_str() || text("recipientType")? != "INTENTS" || text("refundType")? != "INTENTS" {
        return None;
    }
    // 5. Fresh: signed at most 120 s before this block (or after it), and still open.
    let now = env::block_timestamp();
    let at = iso_ns(text("timestamp")?)?;
    if at.saturating_add(QUOTE_MAX_AGE_NS) < now || at > now.saturating_add(QUOTE_MAX_AGE_NS) || iso_ns(text("deadline")?)? <= now {
        return None;
    }
    // 6. Its dollars, and what comes back for them (round 4, B4-1): at least 98% of them in signed `amountOutUsd`, at
    // most 1% (100 bps) signed slippage, so a quote can't skim the sale. In rounded UP, out rounded DOWN.
    let usd = usd_micros(text("amountInUsd")?)?;
    if usd == 0 {
        return None;
    }
    let out = usd_micros_down(text("amountOutUsd")?)?;
    if out.checked_mul(100)? < usd.checked_mul(98)? || q.get("slippageTolerance").and_then(Value::as_u64).filter(|s| *s <= MAX_SLIPPAGE_BPS).is_none() {
        return None;
    }
    Some((token.to_string(), units, usd))
}

/// `usd_micros`, rounded down.
fn usd_micros_down(s: &str) -> Option<u128> {
    let up = usd_micros(s)?;
    let exact = s.split_once('.').map_or(true, |(_, f)| f.len() <= 6 || f[6..].bytes().all(|b| b == b'0'));
    Some(if exact { up } else { up - 1 })
}

/// "12.345678912" dollars → micro-dollars, rounded up; None for anything but plain digits with an optional fraction.
fn usd_micros(s: &str) -> Option<u128> {
    let (whole, frac) = s.split_once('.').unwrap_or((s, ""));
    let digits = |x: &str| x.bytes().all(|b| b.is_ascii_digit());
    if whole.is_empty() || whole.len() > 15 || !digits(whole) || frac.len() > 30 || !digits(frac) || (s.contains('.') && frac.is_empty()) {
        return None;
    }
    let (head, tail) = frac.split_at(frac.len().min(6));
    let mut micros: u128 = whole.parse::<u128>().ok()? * 1_000_000 + format!("{head:0<6}").parse::<u128>().ok()?;
    if tail.bytes().any(|b| b != b'0') {
        micros += 1;
    }
    Some(micros)
}

/// "2026-11-05T05:16:38.175Z" (UTC, 0–9 fraction digits) → nanoseconds since 1970; None for anything else.
fn iso_ns(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || *b.last()? != b'Z' {
        return None;
    }
    let num = |r: core::ops::Range<usize>| -> Option<u64> { s.get(r.clone()).filter(|x| x.bytes().all(|c| c.is_ascii_digit())).and_then(|x| x.parse().ok()) };
    let (y, mo, d, h, mi, se) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let frac = &s[19..s.len() - 1];
    let nanos = match frac.strip_prefix('.') {
        None if frac.is_empty() => 0,
        Some(f) if !f.is_empty() && f.len() <= 9 && f.bytes().all(|c| c.is_ascii_digit()) => format!("{f:0<9}").parse::<u64>().ok()?,
        _ => return None,
    };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if y < 1970 || !(1..=12).contains(&mo) || d < 1 || d > month_days[(mo - 1) as usize] || h > 23 || mi > 59 || se > 59 {
        return None;
    }
    // Days from 1970-01-01 (Howard Hinnant's days_from_civil).
    let (yy, mm) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = yy / 400;
    let yoe = yy - era * 400;
    let doy = (153 * mm + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = (era * 146_097 + doe).checked_sub(719_468)?;
    let secs = days.checked_mul(86_400)?.checked_add(h * 3600 + mi * 60 + se)?;
    secs.checked_mul(SECOND)?.checked_add(nanos)
}

const B58: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

fn base58_encode(bytes: &[u8]) -> String {
    let mut digits: Vec<u8> = vec![];
    for &byte in bytes {
        let mut carry = byte as u32;
        for d in digits.iter_mut() {
            carry += (*d as u32) << 8;
            *d = (carry % 58) as u8;
            carry /= 58;
        }
        while carry > 0 {
            digits.push((carry % 58) as u8);
            carry /= 58;
        }
    }
    let zeros = bytes.iter().take_while(|&&b| b == 0).count();
    core::iter::repeat(b'1').take(zeros).chain(digits.iter().rev().map(|&d| B58[d as usize])).map(char::from).collect()
}

fn base58_decode(s: &str) -> Option<Vec<u8>> {
    if s.is_empty() || s.len() > 128 {
        return None;
    }
    let mut bytes: Vec<u8> = vec![];
    for c in s.bytes() {
        let mut carry = B58.iter().position(|&x| x == c)? as u32;
        for b in bytes.iter_mut() {
            carry += (*b as u32) * 58;
            *b = (carry & 0xff) as u8;
            carry >>= 8;
        }
        while carry > 0 {
            bytes.push((carry & 0xff) as u8);
            carry >>= 8;
        }
    }
    let zeros = s.bytes().take_while(|&c| c == b'1').count();
    Some(core::iter::repeat(0).take(zeros).chain(bytes.into_iter().rev()).collect())
}

#[cfg(test)]
mod tests;
