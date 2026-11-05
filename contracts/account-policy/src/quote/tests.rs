//! B4: a sale priced by 1Click's signed quote. Every refusal is checked against its control: the same request with a
//! quote that passes. 1Click's own key signs only the live quote (tests/fixtures/b4-live-*); every other quote is signed
//! with a test key (tests/fixtures/b4-quotes.mjs), which only this test build can put in 1Click's place (TEST_KEY).
use super::*;
use super::super::{AccountPolicy, Band, Level};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MS: u64 = 1_000_000;
/// The test vectors' signed timestamp, 2026-11-05T12:00:00.000Z.
const T0: u64 = 1_793_880_000_000 * MS;
/// The live quote's signed timestamp, 2026-11-05T05:16:38.175Z.
const LIVE_T: u64 = 1_793_855_798_175 * MS;
const COIN: &str = "nep141:coin-not-in-band.near";
const ADDRESS: &str = "e80205e4052c30ae65998fa9a4d11d4b3f40754e6a41213de0565594be0de014";
const FACE_ID: Level = Level::FaceId;
const DAY_WAIT: Level = Level::Wait { seconds: U64(86_400) };
const LAST: Level = Level::Wait { seconds: U64(172_800) };

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/b4-quotes.json")).unwrap()
}

fn vector(name: &str) -> SignedQuote {
    let v = &vectors()[name];
    SignedQuote { signed: v["signed"].as_str().unwrap().into(), signature: v["signature"].as_str().unwrap().into() }
}

fn live() -> SignedQuote {
    let answer: Value = serde_json::from_str(include_str!("../../tests/fixtures/b4-live-quote.json")).unwrap();
    SignedQuote { signed: include_str!("../../tests/fixtures/b4-live-signed.txt").into(), signature: answer["signature"].as_str().unwrap().into() }
}

fn test_key(on: bool) {
    let k: [u8; 32] = if on { hex(vectors()["test_key_hex"].as_str().unwrap()).try_into().unwrap() } else { ONE_CLICK_QUOTE_KEY };
    TEST_KEY.with(|c| c.set(on.then_some(k)));
}

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn at(account: &str, now_ns: u64) {
    let me: AccountId = account.parse().unwrap();
    testing_env!(VMContextBuilder::new().current_account_id(me.clone()).predecessor_account_id(me.clone()).signer_account_id(me).block_timestamp(now_ns).account_balance(NearToken::from_near(1_000_000)).build());
}

/// Face ID up to `face_usd` micro-dollars (and 20 NEAR), a day's wait up to ten times that, then two days.
fn dollar_bands(face_usd: u128, extra: &[(&str, u128)]) -> Vec<Band> {
    let mut face = vec![("near".to_string(), U128(20 * NEAR)), (USDC.to_string(), U128(face_usd))];
    face.extend(extra.iter().map(|(c, a)| (c.to_string(), U128(*a))));
    vec![
        Band { up_to: Some(face), level: FACE_ID },
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(10 * face_usd))]), level: DAY_WAIT },
        Band { up_to: None, level: LAST },
    ]
}

fn account(name: &str, now_ns: u64, bands: Vec<Band>) -> AccountPolicy {
    at(name, now_ns);
    AccountPolicy::new(U64(60), bands, None, None)
}

/// The deposit the core sends for a sale: one mt_transfer on intents.near (packages/wallet/src/moves.ts mtTransfer).
fn deposit_with(args: &str, method: &str) -> Vec<Step> {
    vec![Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(1), gas: U64(30_000_000_000_000) }]
}

fn deposit(to: &str, token: &str, amount: &str) -> Vec<Step> {
    deposit_with(&format!(r#"{{"receiver_id":"{to}","token_id":"{token}","amount":"{amount}","approval":null}}"#), "mt_transfer")
}

fn sale() -> Vec<Step> {
    deposit(ADDRESS, COIN, "1000")
}

fn intents() -> AccountId {
    "intents.near".parse().unwrap()
}

/// The level `level_for` previews and the level `execute` then places, which must agree.
fn level(p: &mut AccountPolicy, steps: Vec<Step>, q: Option<SignedQuote>) -> Level {
    let preview = p.level_for(intents(), steps.clone(), q.clone());
    let out = p.execute(intents(), steps, q);
    let wait = U64(out.ready_at_ns.map_or(0, |r| r.0).saturating_sub(near_sdk::env::block_timestamp()) / SECOND);
    let placed = match (out.done, out.needs_device) {
        (true, _) => FACE_ID,
        (false, false) => Level::Wait { seconds: wait },
        (false, true) => Level::Both { seconds: wait },
    };
    assert_eq!(preview, placed, "level_for's preview is what execute places");
    placed
}

/// A fresh test-key account at T0 + `after_s`, and the level of `steps` with `q`.
fn level_at(after_s: u64, steps: Vec<Step>, q: Option<SignedQuote>) -> Level {
    test_key(true);
    let mut p = account("me.near", T0 + after_s * SECOND, dollar_bands(50_000_000, &[]));
    level(&mut p, steps, q)
}

#[test]
fn b4_the_control_a_valid_quote_under_the_dollar_limit_is_face_id() {
    assert_eq!(level_at(1, sale(), None), LAST, "without a quote a coin no band lists takes the last band (today)");
    assert_eq!(level_at(1, sale(), Some(vector("valid"))), FACE_ID, "$30.50 under the $50 limit");
}

#[test]
fn b4_a_valid_quote_over_the_dollar_limit_takes_the_next_band() {
    assert_eq!(level_at(1, sale(), Some(vector("over_limit"))), DAY_WAIT, "$60 over the $50 limit, under $500");
}

#[test]
fn b4_each_broken_quote_falls_back_to_the_per_coin_band() {
    for name in [
        "forged", "altered", "duplicate_key", "recipient_other", "refund_other", "recipient_type", "refund_type", "referral", "custom_msg",
        "virtual_chain", "unknown_field", "dry", "dry_with_address", "origin_chain", "zero_usd", "bad_usd", "bad_time",
    ] {
        assert_eq!(level_at(1, sale(), Some(vector(name))), LAST, "{name}");
    }
}

#[test]
fn b4_the_deposit_must_be_exactly_the_quoted_one() {
    let q = || Some(vector("valid"));
    assert_eq!(level_at(1, sale(), q()), FACE_ID, "control");
    let other_address = "0000000000000000000000000000000000000000000000000000000000000001";
    assert_eq!(level_at(1, deposit(other_address, COIN, "1000"), q()), LAST, "wrong deposit address");
    assert_eq!(level_at(1, deposit(ADDRESS, COIN, "999"), q()), LAST, "amount mismatch");
    assert_eq!(level_at(1, deposit(ADDRESS, COIN, "01000"), q()), LAST, "the same amount spelled otherwise");
    assert_eq!(level_at(1, deposit(ADDRESS, "nep141:other-coin.near", "1000"), q()), LAST, "asset mismatch");
    let args = format!(r#"{{"receiver_id":"{ADDRESS}","token_id":"{COIN}","amount":"1000","approval":null}}"#);
    assert_eq!(level_at(1, deposit_with(&args, "mt_transfer"), q()), FACE_ID, "control, built by hand");
    assert_eq!(level_at(1, deposit_with(&args.replace("}", r#","msg":"x"}"#), "mt_transfer_call"), q()), LAST, "a _call with a message");
    assert_eq!(level_at(1, deposit_with(&args, "mt_transfer_call"), q()), LAST, "a _call");
    assert_eq!(level_at(1, deposit_with(&args.replace("null", r#""a""#), "mt_transfer"), q()), LAST, "an approval");
    assert_eq!(level_at(1, deposit_with(&args.replace("}", r#","memo":"sale"}"#), "mt_transfer"), q()), FACE_ID, "a memo is fine");
    assert_eq!(level_at(1, deposit_with(&args.replace("}", r#","sender_id":"x"}"#), "mt_transfer"), q()), LAST, "a foreign argument");
    let mut two = sale();
    two.push(Step::Transfer { deposit: U128(1) });
    assert_eq!(level_at(1, two, q()), LAST, "another step besides the deposit");
    test_key(true);
    let p = account("me.near", T0 + SECOND, dollar_bands(50_000_000, &[]));
    assert_eq!(p.level_for("bob.near".parse().unwrap(), sale(), q()), LAST, "not on intents.near");
}

#[test]
fn b4_the_signed_time_bounds() {
    let q = || Some(vector("valid"));
    assert_eq!(level_at(120, sale(), q()), FACE_ID, "120 s old: control");
    assert_eq!(level_at(121, sale(), q()), LAST, "stale: 121 s old");
    test_key(true);
    let mut p = account("me.near", T0 - 120 * SECOND, dollar_bands(50_000_000, &[]));
    assert_eq!(level(&mut p, sale(), q()), FACE_ID, "120 s ahead of the block: control");
    let mut p = account("me.near", T0 - 121 * SECOND, dollar_bands(50_000_000, &[]));
    assert_eq!(level(&mut p, sale(), q()), LAST, "121 s ahead of the block");
    // its deadline one minute after its timestamp
    assert_eq!(level_at(59, sale(), Some(vector("deadline_soon"))), FACE_ID, "deadline ahead: control");
    assert_eq!(level_at(60, sale(), Some(vector("deadline_soon"))), LAST, "at the deadline");
    assert_eq!(level_at(61, sale(), Some(vector("deadline_soon"))), LAST, "past the deadline");
}

#[test]
fn b4_the_dollars_count_toward_the_24_hours() {
    test_key(true);
    let mut p = account("me.near", T0 + SECOND, dollar_bands(50_000_000, &[]));
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), FACE_ID, "$30.50");
    assert!(p.spent_today().iter().any(|(c, a)| c == USDC && a.0 == 30_500_000), "counted as $30.50 of USDC");
    assert!(!p.spent_today().iter().any(|(c, _)| c == COIN));
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), DAY_WAIT, "$61 in 24 hours: over $50");
}

#[test]
fn b4_a_band_coin_with_a_quote_counts_its_dollars() {
    test_key(true);
    // the coin is listed with a big limit: per coin it is Face ID; its quote says $60, over the $50 limit
    let bands = dollar_bands(50_000_000, &[(COIN, 1_000_000)]);
    let mut p = account("me.near", T0 + SECOND, bands.clone());
    assert_eq!(level(&mut p, sale(), None), FACE_ID, "per coin");
    let mut p = account("me.near", T0 + SECOND, bands);
    assert_eq!(level(&mut p, sale(), Some(vector("over_limit"))), DAY_WAIT, "by its dollars");
    // USDC itself: a quote's dollars stand for it
    let mut p = account("me.near", T0 + SECOND, dollar_bands(50_000_000, &[]));
    let usdc_sale = deposit(ADDRESS, USDC, "30500000");
    assert_eq!(level(&mut p, usdc_sale, Some(vector("usdc_sale"))), FACE_ID);
}

#[test]
fn b4_no_dollar_limit_no_dollars() {
    test_key(true);
    // a band list with no USDC (testnet's NEAR-only bands): the quote changes nothing
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(20 * NEAR))]), level: FACE_ID }, Band { up_to: None, level: LAST }];
    let mut p = account("me.near", T0 + SECOND, bands);
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), LAST);
    assert!(p.spent_today().iter().any(|(c, a)| c == COIN && a.0 == 1000) && !p.spent_today().iter().any(|(c, _)| c == USDC), "its own coin's row, as today");
}

#[test]
fn b4_one_clicks_live_quote_sells_a_coin_no_band_lists_at_face_id() {
    // the live quote of 5 Nov 2026 (0.01 wNEAR, $0.0402), signed by 1Click's own key; no band lists wNEAR
    test_key(false);
    let sell = || deposit(ADDRESS, "nep141:wrap.near", "10000000000000000000000");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), None), LAST, "without the quote: the last band");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(live())), FACE_ID, "$0.0402 under a $0.05 limit");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(40_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(live())), DAY_WAIT, "$0.0402 over a $0.04 limit");
    let mut p = account("other.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(live())), LAST, "another account: not its recipient");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 121 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(live())), LAST, "stale");
    let mut forged = live();
    forged.signed = forged.signed.replace("\"amountInUsd\":\"0.040200000000\"", "\"amountInUsd\":\"0.000200000000\"");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(forged)), LAST, "its dollars changed");
    // the test key is not 1Click's: a test-signed quote fails under the real key
    let mut p = account("me.near", T0 + SECOND, dollar_bands(50_000_000, &[]));
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), LAST, "signed by the test key, checked with 1Click's");
}

#[test]
fn b4_reading_its_numbers() {
    assert_eq!(iso_ns("1970-01-01T00:00:00Z"), Some(0));
    assert_eq!(iso_ns("2026-11-05T05:16:38.175Z"), Some(LIVE_T));
    assert_eq!(iso_ns("2000-02-29T23:59:59.999999999Z"), Some(951_868_799_999_999_999));
    for bad in ["2026-11-05T05:16:38.175", "2026-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-11-05T24:00:00Z", "2026-11-05T05:16:38.Z", "2026-11-05T05:16:38.1234567890Z", "1969-12-31T23:59:59Z", "2026-11-05T05:16:38+00:00", "+026-11-05T05:16:38Z", "2026-11-05T05:16:3éZ"] {
        assert_eq!(iso_ns(bad), None, "{bad}");
    }
    assert_eq!(usd_micros("0.040200000000"), Some(40_200));
    assert_eq!(usd_micros("0.0402000001"), Some(40_201), "rounded up");
    assert_eq!(usd_micros("12"), Some(12_000_000));
    assert_eq!(usd_micros("999999999999999.999999"), Some(999_999_999_999_999_999_999));
    for bad in ["", ".5", "5.", "-1", "1e3", "1,5", " 1", "1234567890123456", "0x10"] {
        assert_eq!(usd_micros(bad), None, "{bad}");
    }
    let sig = "oSgqHtF2DYmfwDBGACKjQ27uchbdoRdKUKXAGnzyjNFzpwcSnE65Jxtu7vTT2yjyspcvVysgMVHj5iRFBkGgrWf";
    assert_eq!(base58_encode(&base58_decode(sig).unwrap()), sig);
    assert_eq!(base58_decode("reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc").unwrap(), ONE_CLICK_QUOTE_KEY.to_vec());
    assert_eq!(base58_encode(&[0, 0, 1]), "112");
    assert_eq!(base58_decode("0OIl"), None);
}

#[test]
fn b4_r4_a_re_serialized_quote_fails_the_signature() {
    // the audit's condition 1: the signature covers 1Click's exact bytes; the same fields reordered or spaced are refused
    assert_eq!(level_at(1, sale(), Some(vector("valid"))), FACE_ID, "control: the bytes 1Click signed");
    assert_eq!(level_at(1, sale(), Some(vector("reordered"))), LAST, "keys reordered");
    assert_eq!(level_at(1, sale(), Some(vector("spaced"))), LAST, "spaces between fields");
    // the same with 1Click's own key on the live quote
    test_key(false);
    let sell = || deposit(ADDRESS, "nep141:wrap.near", "10000000000000000000000");
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, sell(), Some(live())), FACE_ID, "control: the live bytes");
    for (what, signed) in [
        ("spaced", live().signed.replace("\",\"", "\", \"")),
        ("a trailing newline", format!("{}\n", live().signed)),
        ("the first two keys swapped", live().signed.replacen("{\"amount\":\"10000000000000000000000\",\"amountIn\":\"10000000000000000000000\"", "{\"amountIn\":\"10000000000000000000000\",\"amount\":\"10000000000000000000000\"", 1)),
    ] {
        assert_ne!(signed, live().signed, "{what}: the text differs");
        let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
        assert_eq!(level(&mut p, sell(), Some(SignedQuote { signed, signature: live().signature })), LAST, "{what}");
    }
}

#[test]
fn b4_r4_only_native_usdc_is_the_dollar_limit() {
    // the audit's condition 2: a band whose only "USDC" is bridged has no dollar path
    test_key(true);
    let bridged = ["nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"];
    let bands = |usdc: &[&str]| {
        let mut face = vec![("near".to_string(), U128(20 * NEAR))];
        face.extend(usdc.iter().map(|c| (c.to_string(), U128(50_000_000))));
        vec![Band { up_to: Some(face), level: FACE_ID }, Band { up_to: None, level: LAST }]
    };
    let mut p = account("me.near", T0 + SECOND, bands(&[USDC]));
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), FACE_ID, "control: native USDC (nep141:17208628…a1)");
    let mut p = account("me.near", T0 + SECOND, bands(&bridged));
    assert_eq!(level(&mut p, sale(), Some(vector("valid"))), LAST, "bridged USDC only");
    assert!(p.spent_today().iter().any(|(c, a)| c == COIN && a.0 == 1000) && !p.spent_today().iter().any(|(c, _)| c == USDC), "its own coin's row, as today");
    assert_eq!(USDC, "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
}

#[test]
fn b4_r4_dollars_round_up_at_a_fraction_of_a_cent() {
    // the audit's condition 3: amountInUsd -> USDC's 6 decimals, rounded UP
    let counted = |name: &str| {
        test_key(true);
        let mut p = account("me.near", T0 + SECOND, dollar_bands(50_000_000, &[]));
        assert_eq!(level(&mut p, sale(), Some(vector(name))), FACE_ID, "{name}");
        p.spent_today().into_iter().find(|(c, _)| c == USDC).map(|(_, a)| a.0)
    };
    assert_eq!(counted("valid"), Some(30_500_000), "control: $30.50 exactly");
    assert_eq!(counted("usd_round_up"), Some(30_500_001), "$30.5000001: a tenth of a micro-dollar more is one more");
    assert_eq!(counted("usd_tenth_cent"), Some(1_001), "$0.0010000000001: a tenth of a cent and a hair is 1,001");
    assert_eq!(usd_micros("0.0049999"), Some(5_000), "half a cent, less a hair: 5,000");
    assert_eq!(usd_micros("0.004999"), Some(4_999), "control: exact at 6 decimals");
}

#[test]
fn b4_r4_b4_1_a_quote_must_give_back_98_percent_at_1_percent_slippage() {
    assert_eq!(level_at(1, sale(), Some(vector("valid"))), FACE_ID, "control: $30.39 back for $30.50 (99.6%), 100 bps");
    assert_eq!(level_at(1, sale(), Some(vector("out_98"))), FACE_ID, "control: exactly 98% back");
    assert_eq!(level_at(1, sale(), Some(vector("skim"))), LAST, "a skim: a tenth of a micro-dollar under 98% back (rounded down, not up)");
    assert_eq!(level_at(1, sale(), Some(vector("slippage_101"))), LAST, "101 bps slippage");
    assert_eq!(level_at(1, sale(), Some(vector("slippage_float"))), LAST, "a slippage that isn't whole bps");
    assert_eq!(level_at(1, sale(), Some(vector("no_out_usd"))), LAST, "no amountOutUsd signed");
    // the live quote: $0.040042586220 back for $0.0402 (99.6%), 100 bps: Face ID (b4_one_clicks_live_quote_... too)
    test_key(false);
    let mut p = account("zf-aaaaaaaaaa.near", LIVE_T + 60 * SECOND, dollar_bands(50_000, &[]));
    assert_eq!(level(&mut p, deposit(ADDRESS, "nep141:wrap.near", "10000000000000000000000"), Some(live())), FACE_ID);
    assert_eq!(usd_micros_down("29.8899999"), Some(29_889_999));
    assert_eq!(usd_micros_down("29.89"), Some(29_890_000));
    assert_eq!(usd_micros_down("0.040042586220"), Some(40_042));
}
