//! Release 10, the 4 Nov internal proofing (round 1): one regression test per verified finding, named after its ID (the
//! tracker's). Each is the round's proof of concept turned round: it failed on the audited build (f2cb13660) and passes
//! on the fix. Release-like: `cargo test --no-default-features --features agent,short-waits --test r10_audit`.
#![cfg(all(feature = "agent", not(feature = "modules")))]
#![allow(unused_imports, dead_code)]
mod common;
use account_policy::{moves, AccountPolicy, Band, Change, Group, Level, Step, SECOND_DEVICE_METHODS};
use agent_limits::{Budget, CoinLimit};
use common::finish_ok;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const THIEF_LAPTOP: u8 = 0x7A;
const NEW_PHONE: u8 = 0x11;
const AGENT: u8 = 0xA6;
const UNKNOWN: u8 = 0x77;
/// A day's delay: the floor is 2 days, the fallback 7.
const FLOOR: u64 = 2 * DAY;
const FALLBACK: u64 = 7 * DAY;
/// After the account's first 24 hours (its set-up window).
const ASK: u64 = DAY + 100;
/// The one-shot install marker's storage key (K1). A test that plays an account from release 9 removes it.
const INSTALLED: &[u8] = b"installed";

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
}
fn as_key(fill: u8, now_s: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000))
        .build());
}
fn refused_with<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "refused".into()),
    }
}
/// A copy of the state (a refused call in the mock leaves the struct half changed; NEAR would roll it back).
fn copy_of(p: &AccountPolicy) -> AccountPolicy {
    near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(p).unwrap()).unwrap()
}
fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}
fn actions() -> Vec<MockAction> {
    get_created_receipts().into_iter().flat_map(|r| r.actions).collect()
}
fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}
fn call(method: &str, args: &str, deposit: u128, gas: u64) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(gas) }
}
fn near_today(p: &AccountPolicy) -> u128 {
    p.spent_today().into_iter().find(|(c, _)| c == "near").map_or(0, |(_, a)| a.0)
}

/// A `delay`-second account: the phone named (sealed), the words set, Face ID up to 1 NEAR a day, else a day's wait.
fn account_with_delay(delay: u64) -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(delay), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}
fn account() -> AccountPolicy {
    account_with_delay(DAY)
}
/// ...and the owner's laptop, added at `at` in the set-up window (at once): of age from `at` + the floor.
fn account_with_laptop(at: u64) -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, at);
    assert!(p.add_second_device(key(LAPTOP)).done, "the first second device in the set-up window goes at once");
    p
}
fn budget(per_day: u128) -> Budget {
    Budget { coins: vec![CoinLimit { coin: "near".into(), per_day: U128(per_day), per_month: U128(30 * per_day), convert_per_day: U128(per_day) }], recipients: vec![], ends_at_ns: U64(400 * DAY * SECOND), max_spends_per_day: 12 }
}
/// Agent set up at `ask` (after the set-up window) and run a floor later; returns that moment.
fn with_agent(p: &mut AccountPolicy, k: u8, per_day: u128, ask: u64) -> u64 {
    as_key(PHONE, ask);
    let out = p.agent_set(key(k), budget(per_day), None);
    assert!(!out.done);
    let at = ask + FLOOR;
    as_key(PHONE, at);
    assert!(p.run(out.id.unwrap()).done);
    at
}

// ── F1 (Medium): a second device's yes to a recovery counts only from a device on the account for the fallback ──────

/// The round's PoC: on a 24-hour account the phone and leaked words add their own laptop (a change, a floor's wait the
/// owner's laptop can't decline), let it come of age (another floor) and have it say yes to their recovery: finished 5
/// days after their first move, under the 7-day fallback. Now that yes is refused until the device has been on the
/// account for the fallback, so the words alone wait the fallback.
#[test]
fn r10_audit_f1_a_laptop_the_phone_added_says_yes_to_a_recovery_only_after_the_fallback() {
    let mut p = account_with_laptop(2);
    let t0 = 3 * DAY;
    as_key(PHONE, t0);
    let add = p.add_second_device(key(THIEF_LAPTOP));
    assert!(!add.done && !add.needs_device);
    as_key(PHONE, t0 + FLOOR);
    assert!(p.run(add.id.unwrap()).done);
    let t1 = t0 + 2 * FLOOR;
    as_key(PHONE, t1);
    assert_eq!(p.second_devices_of_age(), 2, "the thief's laptop is of age (on for the floor)");
    as_key(WORDS, t1);
    p.start_recovery(key(NEW_PHONE));
    let status = p.recovery_status().unwrap();
    // Its yes is refused: on the account for two floors, not the fallback.
    as_key(THIEF_LAPTOP, t1 + 1);
    let why = refused_with(|| copy_of(&p).approve_recovery(key(NEW_PHONE), status.ready_at_ns));
    assert!(why.contains("fallback"), "the thief's laptop said yes: {why:?}");
    // A yes it gave anyway (recorded by an earlier release, say) doesn't count in the view or at the finish.
    env::storage_write(b"recovery_yes", &near_sdk::borsh::to_vec(&(env::sha256(&key(NEW_PHONE).0), status.ready_at_ns.0, env::sha256(&key(THIEF_LAPTOP).0))).unwrap());
    let st = p.recovery_status().unwrap();
    assert!(!st.approved, "a young-for-the-fallback yes reads as approved");
    assert_eq!(st.can_finish_at_ns.0, (t1 + FALLBACK) * SECOND);
    as_key(WORDS, t1 + DAY);
    assert!(refused_with(|| copy_of(&p).finish_recovery()).contains("hasn't said yes"));
    // The words alone: after the fallback from the start, 11 days after the thief's first move.
    as_key(WORDS, t1 + FALLBACK);
    let _ = finish_ok(&mut p);
    assert!(p.recovery_status().is_none());
    assert!((t1 + FALLBACK - t0) >= FALLBACK);
    // Control: the owner's own laptop, on the account since 2 s, says yes once it has been on for the fallback.
    let mut q = account_with_laptop(2);
    as_key(WORDS, 2 + FALLBACK);
    q.start_recovery(key(NEW_PHONE));
    let s = q.recovery_status().unwrap();
    as_key(LAPTOP, 2 + FALLBACK + 1);
    q.approve_recovery(key(NEW_PHONE), s.ready_at_ns);
    let s = q.recovery_status().unwrap();
    assert!(s.needs_device && s.approved);
    assert_eq!(s.can_finish_at_ns, s.ready_at_ns, "with its yes, after the delay");
    // refuse_recovery keeps the floor's rule: a laptop of age (not of the fallback's) still ends a recovery.
    let mut r = account_with_laptop(2);
    as_key(WORDS, 2 + FLOOR);
    r.start_recovery(key(NEW_PHONE));
    as_key(LAPTOP, 2 + FLOOR + 1);
    r.refuse_recovery(None);
    assert!(r.recovery_status().is_none());
}

// ── V1 (Low): removing any second device waits the fallback ────────────────────────────────────────────────────────

/// The round's PoC: a removal asked one second before the laptop came of age waited only the floor, ran when the
/// laptop had been of age for almost a floor, and phone + words then recovered without it, under the fallback.
#[test]
fn r10_audit_v1_removing_a_young_second_device_waits_the_fallback() {
    let mut p = account_with_laptop(10);
    let ask = 10 + FLOOR - 1;
    as_key(PHONE, ask);
    assert_eq!(p.second_devices_of_age(), 0);
    let out = p.remove_key(key(LAPTOP));
    assert_eq!(out.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND, "a young device's removal waits the fallback too");
    as_key(PHONE, ask + FLOOR);
    assert!(refused_with(|| copy_of(&p).run(out.id.unwrap())).contains("still waiting"));
    as_key(PHONE, ask + FALLBACK);
    assert!(p.run(out.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
}

/// And when it runs: a removal asked for a key that was no second device then (so it waited only the floor), which
/// became one before it ran, still waits the fallback from when it was asked.
#[test]
fn r10_audit_v1_a_removal_rechecks_the_fallback_when_it_runs() {
    let mut p = account();
    as_key(PHONE, 2);
    let rm = p.remove_key(key(LAPTOP));
    assert_eq!(rm.ready_at_ns.unwrap().0, (2 + FLOOR) * SECOND, "no second device when asked: the floor");
    as_key(PHONE, 3);
    assert!(p.add_second_device(key(LAPTOP)).done, "then the same key as the laptop, in the set-up window");
    as_key(PHONE, 2 + FLOOR);
    let why = refused_with(|| copy_of(&p).run(rm.id.unwrap()));
    assert!(why.contains("fallback"), "a second device removed after the floor only: {why:?}");
    as_key(PHONE, 2 + FALLBACK);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
}

// ── A1: an upgrade from release 9 renews every second device's key ───────────────────────────────────────────────

/// The round's PoC: `upgrade_check` renewed second devices only from release 8 or earlier, trusting `from_version`;
/// an account that reached release 9 from release 4 (whose `upgrade` never calls the check) kept its laptop on
/// "approve,decline", and the 9 -> 10 upgrade passed 9.
#[test]
fn r10_audit_a1_an_upgrade_from_9_renews_every_second_devices_key() {
    let p = account_with_laptop(10);
    env::storage_remove(INSTALLED); // as an account on release 9
    as_key(PHONE, 30);
    p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
    let renewed = actions().into_iter().any(|a| {
        matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. }
            if public_key.key_data() == &key(LAPTOP).0[1..] && method_names.join(",") == SECOND_DEVICE_METHODS)
    });
    assert!(renewed, "from 9, the laptop gets this release's methods and a fresh allowance");
}

// ── A2: a tightening asked while frozen is no tightening when it runs ────────────────────────────────────────────

/// The round's PoC (finding 6's account, the last band needs the laptop): after the laptop refused a recovery, the
/// phone asked the current budget again ("tightens": Face ID, made a floor's wait by the freeze), phone-only; later it
/// ran by the phone alone as a loosening of the tighter budget set meanwhile. Now, frozen, it is asked at the strictest
/// band (the laptop's yes).
#[test]
fn r10_audit_a2_a_tightening_asked_while_frozen_takes_the_strictest_band() {
    let mut p = account();
    as_key(PHONE, 2);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
    let out = p.set_protection(bands);
    if !out.done {
        as_key(PHONE, DAY + 3);
        assert!(p.run(out.id.unwrap()).done);
    }
    as_key(PHONE, ASK);
    let id = p.agent_set(key(AGENT), budget(500 * MILLI), None).id.unwrap();
    as_key(LAPTOP, ASK + FLOOR);
    let _ = p.approve(id);
    assert!(p.agent().is_some());
    let t = ASK + FLOOR + 10;
    as_key(PHONE, t);
    assert!(p.agent_set_budget(budget(100 * MILLI)).done, "a tightening, not frozen: at once");
    as_key(WORDS, t + 1);
    p.start_recovery(key(NEW_PHONE));
    as_key(LAPTOP, t + 2);
    p.refuse_recovery(None);
    assert!(p.pending().is_none() && p.frozen_until().is_some());
    as_key(PHONE, t + 3);
    let same = p.agent_set_budget(budget(100 * MILLI));
    assert!(!same.done && same.needs_device, "frozen, a tightening is asked at the strictest band: {same:?}");
    as_key(PHONE, t + 3 + FLOOR);
    assert!(p.agent_set_budget(budget(10 * MILLI)).done);
    let why = refused_with(|| copy_of(&p).run(same.id.unwrap()));
    assert!(why.contains("second device"), "the phone alone ran it: {why:?}");
    assert_eq!(p.agent().unwrap().budget.coins[0].per_day.0, 10 * MILLI);
}

/// And when it runs: a budget change not co-signed and not asked at the strictest band (its record gone, as for one
/// placed by any other path) runs only if it still tightens.
#[test]
fn r10_audit_a2_a_budget_not_asked_at_the_strictest_must_still_tighten_when_it_runs() {
    let mut p = account();
    let t = with_agent(&mut p, AGENT, 100 * MILLI, ASK) + 10;
    as_key(PHONE, t);
    let loosen = p.agent_set_budget(budget(500 * MILLI));
    assert!(!loosen.done);
    env::storage_remove(b"agent_budget_strict");
    as_key(PHONE, t + FLOOR);
    let why = refused_with(|| copy_of(&p).run(loosen.id.unwrap()));
    assert!(why.contains("loosen"), "a loosening ran without the strictest band: {why:?}");
    assert_eq!(p.agent().unwrap().budget.coins[0].per_day.0, 100 * MILLI);
    // Asked at the strictest band (its record kept), the same loosening runs.
    as_key(PHONE, t + FLOOR + 1);
    let again = p.agent_set_budget(budget(500 * MILLI));
    as_key(PHONE, t + 2 * FLOOR + 1);
    assert!(p.run(again.id.unwrap()).done);
    assert_eq!(p.agent().unwrap().budget.coins[0].per_day.0, 500 * MILLI);
}

// ── A3: a refused Agent key drops what waits for Agent ───────────────────────────────────────────────────────────

/// The round's PoC: `on_agent_key` forgot Agent when NEAR refused its key but left a waiting budget, which then ran on
/// the next Agent (another key, set up with a smaller budget).
#[test]
fn r10_audit_a3_a_refused_agent_key_drops_what_waits_for_agent() {
    let mut p = account();
    let t = with_agent(&mut p, AGENT, 100 * MILLI, ASK);
    as_key(PHONE, t);
    let loosen = p.agent_set_budget(budget(500 * MILLI));
    assert!(!loosen.done);
    env::state_write(&p);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_agent_key(key(AGENT));
    let mut p: AccountPolicy = env::state_read().unwrap();
    assert!(p.agent().is_none());
    assert!(!p.waiting_requests().iter().any(|w| matches!(w.change, Change::AgentSet { .. } | Change::AgentSetBudget { .. })), "a budget for the forgotten Agent still waits");
    let t2 = with_agent(&mut p, AGENT + 1, 50 * MILLI, t + 10);
    as_key(PHONE, t2);
    assert!(!refused_with(|| copy_of(&p).run(loosen.id.unwrap())).is_empty());
    assert_eq!(p.agent().unwrap().budget.coins[0].per_day.0, 50 * MILLI);
}

// ── K1: upgrade_check runs once per release ──────────────────────────────────────────────────────────────────────

/// The round's PoC: `upgrade_check` had no gate but `#[private]`, so any of the account's own keys (were NEAR's method
/// lists ever wrong) could call it directly to rewrite the release list (and upgrade after the floor instead of the
/// fallback) or renew every key's allowance. Now it runs once per installed release.
#[test]
fn r10_audit_k1_upgrade_check_runs_once_per_release() {
    for signer in [PHONE, LAPTOP, WORDS, AGENT, UNKNOWN] {
        let p = account_with_laptop(10);
        as_key(signer, 3 * DAY);
        let why = refused_with(|| p.upgrade_check(10, Some(Base64VecU8(vec![0xBA; 32]))));
        assert!(why.contains("installed"), "signer {signer:#x} ran upgrade_check on an installed release: {why:?}");
        assert!(p.allowed_releases().is_empty());
        let why = refused_with(|| p.upgrade_check(8, None));
        assert!(!why.is_empty(), "signer {signer:#x} renewed the keys");
    }
    // An account from release 9 (no marker) passes once, and only once.
    let p = account_with_laptop(10);
    env::storage_remove(INSTALLED);
    as_key(PHONE, 3 * DAY);
    p.upgrade_check(9, Some(Base64VecU8(vec![0xBA; 32])));
    assert_eq!(p.allowed_releases(), vec![Base64VecU8(vec![0xBA; 32])]);
    as_key(PHONE, 3 * DAY + 1);
    assert!(refused_with(|| p.upgrade_check(9, Some(Base64VecU8(vec![0xBB; 32])))).contains("installed"));
    assert_eq!(p.allowed_releases(), vec![Base64VecU8(vec![0xBA; 32])]);
}

// ── M1 / F2: an unmeasurable request still counts its NEAR ───────────────────────────────────────────────────────

/// The round's PoCs: an unmeasurable `execute` (a transfer beside an unknown call; NEAR attached to a DEX swap; its gas)
/// counted none of its NEAR toward the 24 hours, so a Face ID band's worth still ran at once beside it. It still takes
/// the strictest band; its NEAR now counts, in `execute` and in a chain's unmeasurable group.
#[test]
fn r10_audit_m1_f2_an_unmeasurable_request_counts_its_near() {
    // A transfer and an unknown call in one request.
    let mut p = account();
    as_key(PHONE, 2 * DAY);
    let big = p.execute(acct("dex.near"), vec![Step::Transfer { deposit: U128(10 * NEAR) }, call("swap", "{}", 0, 30_000_000_000_000)], None);
    assert!(!big.done, "unmeasurable: the strictest band");
    assert_eq!(near_today(&p), 10 * NEAR + 30 * MILLI, "the transfer and the gas count");
    as_key(PHONE, 3 * DAY);
    assert!(p.run(big.id.unwrap()).done);
    assert_ne!(p.level_for(acct("bob.near"), send(900 * MILLI), None), Level::FaceId);
    assert!(!p.execute(acct("bob.near"), send(900 * MILLI), None).done);
    // F2: 0.9 NEAR attached to a swap and 100 Tgas (0.1 NEAR as counted): the whole Face ID band, at once.
    let mut q = account();
    as_key(PHONE, 2 * DAY);
    let swap = q.execute(acct("dex.near"), vec![call("swap", r#"{"pool_id":1}"#, 900 * MILLI, 100_000_000_000_000)], None);
    assert!(!swap.done);
    assert_eq!(near_today(&q), NEAR);
    assert_ne!(q.level_for(acct("bob.near"), send(1), None), Level::FaceId);
    // A chain whose only group can't be measured counts its NEAR too.
    let mut r = account();
    as_key(PHONE, 2 * DAY);
    let chain = r.execute_many(vec![Group { receiver_id: acct("dex.near"), steps: vec![call("swap", "{}", 5 * NEAR, 0)] }]);
    assert!(!chain.done);
    assert_eq!(near_today(&r), 5 * NEAR);
    // A measurable request is measured as before.
    assert_eq!(moves("bob.near", &send(NEAR)), Some(vec![("near".to_string(), NEAR)]));
}

// ── M2: a coin name over 128 bytes is unmeasurable ───────────────────────────────────────────────────────────────

/// The round's PoC: the 24-hour rows took coin names of any length from a step's args (up to ~4 KB), so 128 rows grew
/// the state far past what the callbacks are sized for. A name over 128 bytes (the bands' own limit) now makes the
/// request unmeasurable (the strictest band, and no row for it).
#[test]
fn r10_audit_m2_a_coin_name_over_128_bytes_is_unmeasurable() {
    let token = |n: usize| format!(r#"{{"receiver_id":"a.near","token_id":"nep141:{}","amount":"1"}}"#, "x".repeat(n));
    let step = |n: usize| vec![call("mt_transfer", &token(n), 1, 0)];
    // "nep141:" + 121 = 128 bytes: measured; one more: not.
    assert!(moves("intents.near", &step(121)).is_some());
    assert_eq!(moves("intents.near", &step(122)), None);
    let long = format!(r#"{{"receiver_id":"a.near","token_id":"{}","amount":"1"}}"#, "y".repeat(3_900));
    assert_eq!(moves("intents.near", &[call("mt_transfer", &long, 1, 0)]), None);
    // On a token contract with a long name, its own name makes the coin too long.
    let id = format!("{}.near", "t".repeat(59));
    assert!(moves(&id, &[call("mt_transfer", &format!(r#"{{"receiver_id":"a.near","token_id":"{}","amount":"1"}}"#, "z".repeat(64)), 1, 0)]).is_none());
    let mut p = account();
    as_key(PHONE, 2 * DAY);
    let out = p.execute(acct("intents.near"), vec![call("mt_transfer", &long, 1, 0)], None);
    assert!(!out.done, "the strictest band");
    assert!(p.spent_today().iter().all(|(c, _)| c.len() <= 128), "a long coin name was stored: {:?}", p.spent_today().iter().map(|(c, _)| c.len()).collect::<Vec<_>>());
}

// ── M-L1: duplicate JSON keys are unmeasurable ───────────────────────────────────────────────────────────────────

/// The round's lead: `moves` read serde_json's Value, where the last of two equal keys wins; a token whose parser takes
/// the first would move more than was measured. Any duplicate key in args `moves` reads now makes it unmeasurable.
#[test]
fn r10_audit_m_l1_duplicate_json_keys_are_unmeasurable() {
    let usdt = "usdt.tether-token.near";
    let ft = |args: &str| vec![call("ft_transfer", args, 1, 0)];
    assert!(moves(usdt, &ft(r#"{"receiver_id":"x.near","amount":"1"}"#)).is_some(), "control");
    assert_eq!(moves(usdt, &ft(r#"{"receiver_id":"x.near","amount":"1000000000","amount":"1"}"#)), None);
    // The same key escaped is the same key.
    assert_eq!(moves(usdt, &ft(r#"{"receiver_id":"x.near","amount":"1000000000","amount":"1"}"#)), None);
    // A duplicate in a key moves() doesn't read, or nested, too.
    assert_eq!(moves(usdt, &ft(r#"{"receiver_id":"x.near","receiver_id":"y.near","amount":"1"}"#)), None);
    assert_eq!(moves(usdt, &ft(r#"{"receiver_id":"x.near","amount":"1","memo":{"a":1,"a":2}}"#)), None);
    let batch = r#"{"receiver_id":"x.near","token_ids":["nep141:a.near"],"amounts":["1"],"amounts":["1"]}"#;
    assert_eq!(moves("intents.near", &[call("mt_batch_transfer", batch, 1, 0)]), None);
    // And in a call measured by its NEAR alone (an allowlisted method with its own arguments).
    assert_eq!(moves("wrap.near", &[call("near_withdraw", r#"{"amount":"1","amount":"2"}"#, 1, 0)]), None);
    assert!(moves("wrap.near", &[call("near_withdraw", r#"{"amount":"1"}"#, 1, 0)]).is_some());
}

// ── V2: AllowRelease says when it can run, and a yes that can't run it yet is recorded ────────────────────────────

/// The round's PoC: an AllowRelease asked by the phone alone said it was ready after the floor (Outcome and
/// `waiting_requests`), while `run` refused until the fallback; and the laptop's yes after that "ready" time reverted.
#[test]
fn r10_audit_v2_allow_release_says_when_it_can_run() {
    let mut p = account_with_laptop(10);
    let ask = 1000;
    as_key(PHONE, ask);
    let out = p.upgrade(Base64VecU8(vec![9; 32]));
    let w = p.waiting_requests();
    assert!(matches!(w[0].change, Change::AllowRelease { .. }));
    assert_eq!(out.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND, "the Outcome says the fallback");
    assert_eq!(w[0].ready_at_ns.0, (ask + FALLBACK) * SECOND, "the waiting list says the fallback");
    // The laptop, of age but not on for the fallback, says yes: recorded, still waiting.
    as_key(LAPTOP, ask + FLOOR);
    assert_eq!(p.second_devices_of_age(), 1);
    let yes = p.approve(out.id.unwrap());
    assert!(!yes.done && !yes.needs_device, "{yes:?}");
    assert_eq!(yes.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND);
    assert!(p.waiting_requests()[0].approved);
    as_key(PHONE, ask + FALLBACK);
    assert!(p.run(out.id.unwrap()).done);
    // A laptop on the account for the fallback: its yes makes it ready after the floor.
    let mut q = account_with_laptop(10);
    let ask = 10 + FALLBACK;
    as_key(PHONE, ask);
    let out = q.upgrade(Base64VecU8(vec![9; 32]));
    as_key(LAPTOP, ask + 1);
    let yes = q.approve(out.id.unwrap());
    assert_eq!(yes.ready_at_ns.unwrap().0, (ask + FLOOR) * SECOND);
    assert_eq!(q.waiting_requests()[0].ready_at_ns.0, (ask + FLOOR) * SECOND);
}

// ── V3: frozen_until never names a past moment while spending is frozen ──────────────────────────────────────────

#[test]
fn r10_audit_v3_frozen_until_never_names_a_past_moment() {
    let mut p = account_with_laptop(10);
    as_key(WORDS, 1000);
    p.start_recovery(key(NEW_PHONE));
    let later = 1000 + FALLBACK + DAY;
    as_key(PHONE, later);
    let until = p.frozen_until().unwrap().0 / SECOND;
    assert_ne!(p.level_for(acct("bob.near"), send(1), None), Level::FaceId, "still frozen");
    assert!(until >= later, "frozen until {until}, now {later}");
}

// ── F-L1 (H-8): the phone's stop is placed with the queue full ───────────────────────────────────────────────────

#[test]
fn r10_audit_f_l1_the_phones_stop_is_placed_with_the_queue_full() {
    let mut p = account_with_laptop(10);
    let t = 10 + FLOOR;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    for i in 0..20 {
        as_key(PHONE, t + 1 + i);
        assert!(!p.execute(acct("bob.near"), send(1), None).done);
    }
    as_key(PHONE, t + 30);
    assert!(refused_with(|| copy_of(&p).execute(acct("bob.near"), send(1), None)).contains("too many"), "the queue is full");
    let mut stop = None;
    let why = refused_with(|| stop = Some(p.cancel_recovery()));
    assert!(why.is_empty(), "the phone can't stop the recovery: {why:?}");
    let stop = stop.unwrap();
    assert!(!stop.done && stop.id.is_some());
    assert!(p.waiting_requests().iter().any(|w| matches!(w.change, Change::CancelRecovery)));
    // Still one stop only.
    assert!(refused_with(|| copy_of(&p).cancel_recovery()).contains("already"));
}

// ── C1: with the last second device gone, nothing is left waiting for its yes ────────────────────────────────────

/// The round's PoC: a payment waiting for the laptop's yes outlived the laptop's removal, needing a device that was no
/// longer there: it could never run, and its 24-hour rows counted for as long as it waited.
#[test]
fn r10_audit_c1_a_request_waiting_for_the_last_device_waits_a_change_instead() {
    let mut p = account();
    as_key(PHONE, 2);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
    let out = p.set_protection(bands);
    if !out.done {
        as_key(PHONE, DAY + 3);
        assert!(p.run(out.id.unwrap()).done);
    }
    as_key(PHONE, ASK);
    let pay = p.execute(acct("bob.near"), send(5 * NEAR), None);
    assert!(!pay.done && pay.needs_device);
    let rm = p.remove_key(key(LAPTOP));
    let gone = rm.ready_at_ns.unwrap().0 / SECOND;
    as_key(PHONE, gone);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
    let w = p.waiting_requests().into_iter().find(|w| w.id == pay.id.unwrap()).unwrap();
    assert!(!w.needs_device, "still waiting for a device that is gone");
    // Round 2 (E1): a change's wait from its ask, not from the device's removal (which took longer), so it runs with it.
    assert_eq!(w.ready_at_ns.0, (ASK + FLOOR) * SECOND, "a change's wait from its ask");
    assert!(ASK + FLOOR <= gone);
    assert!(p.run(pay.id.unwrap()).done);
}

// ── R1: new words co-signed by a laptop of age while a recovery waits ────────────────────────────────────────────

/// The round's PoC: `set_recovery_key` was refused while any recovery waited, so the owner's phone and laptop of age
/// could replace leaked words only in the gap after a stop, three transactions racing the leaked words' next start.
/// Now they ask while it waits; the phone's ask alone still can't run in it and goes at its end.
#[test]
fn r10_audit_r1_new_words_co_signed_while_a_recovery_waits() {
    let mut p = account_with_laptop(10);
    let t = 10 + FLOOR + 100;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let ask = p.set_recovery_key(key(0xEF));
    assert!(!ask.done);
    as_key(LAPTOP, t + 2);
    p.approve(ask.id.unwrap());
    as_key(PHONE, t + 1 + FLOOR);
    assert!(p.run(ask.id.unwrap()).done);
    assert!(p.pending().is_none(), "the leaked words' recovery ends with them");
    as_key(WORDS, t + 2 + FLOOR);
    assert!(refused_with(|| copy_of(&p).start_recovery(key(NEW_PHONE))).contains("only the backup words"));
    // The phone alone: placed, never run in the recovery, dropped at its end.
    let mut q = account_with_laptop(10);
    as_key(WORDS, t);
    q.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let ask = q.set_recovery_key(key(0xEF));
    as_key(PHONE, t + 1 + FLOOR);
    assert!(refused_with(|| copy_of(&q).run(ask.id.unwrap())).contains("only what your second device said yes to"));
    as_key(LAPTOP, t + 2 + FLOOR);
    q.refuse_recovery(None);
    assert!(q.waiting_requests().is_empty());
}

// ── R2: a recovery's key that didn't become the phone is refused until NEAR has deleted it ───────────────────────

/// The round's PoC: on an account that learns its phone keys, a finish whose recovery ended before its callback left
/// the new key on NEAR until its delete receipt ran; meanwhile nothing refused it, so it was learned as a phone and paid.
#[test]
fn r10_audit_r2_a_not_finished_recoverys_key_waits_for_its_delete() {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, None, None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 10 + FLOOR + 100;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    let ready = p.pending().unwrap().ready_at_ns;
    as_key(PHONE, t + 10);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    as_key(WORDS, t + FALLBACK);
    p.finish_recovery();
    as_key(LAPTOP, t + FALLBACK);
    p.approve(stop.id.unwrap());
    assert!(p.pending().is_none());
    // The add succeeded; the callback finds the recovery gone and asks NEAR to delete the key.
    env::state_write(&p);
    as_key(PHONE, t + FALLBACK + 1);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(vec![])]);
    AccountPolicy::on_recovery_key(key(NEW_PHONE), ready, U64((t + FALLBACK) * SECOND));
    let mut p: AccountPolicy = env::state_read().unwrap();
    assert!(actions().iter().any(|a| matches!(a, MockAction::DeleteKey { public_key, .. } if public_key.key_data() == &key(NEW_PHONE).0[1..])));
    // Before that delete has run, the key is no phone, and no other role.
    as_key(NEW_PHONE, t + FALLBACK + 1);
    let why = refused_with(|| copy_of(&p).execute(acct("bob.near"), send(NEAR / 2), None));
    assert!(why.contains("becomes the phone only"), "the words' own key paid as a phone: {why:?}");
    as_key(WORDS, t + FALLBACK + 2);
    assert!(refused_with(|| copy_of(&p).start_recovery(key(NEW_PHONE))).contains("already on this account"));
    // Once NEAR has deleted it, a later recovery may choose it again.
    AccountPolicy::on_recovery_key_deleted(key(NEW_PHONE));
    as_key(WORDS, t + FALLBACK + 3);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.pending().is_some());
}

// ── W1: backup words NEAR refused to add are forgotten ───────────────────────────────────────────────────────────

/// The round's finding: the words' key add had no callback. Refused by NEAR (a balance at the storage edge, or the key
/// already there), the account still named words that can't sign, and a lost phone then meant no recovery.
#[test]
fn r10_audit_w1_backup_words_near_refused_are_forgotten() {
    let p = account();
    assert!(actions().iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_recovery_words_key")), "the add has a callback");
    env::state_write(&p);
    as_key(PHONE, 2);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_recovery_words_key(key(WORDS));
    let mut p: AccountPolicy = env::state_read().unwrap();
    as_key(WORDS, 2 * DAY);
    assert!(refused_with(|| copy_of(&p).start_recovery(key(NEW_PHONE))).contains("only the backup words"), "the account still names words NEAR doesn't hold");
    // The app asks for words again. Round 2 (X3): past the set-up window, as any new words (the floor), not at once.
    as_key(PHONE, 2 * DAY);
    let again = p.set_recovery_key(key(0xEF));
    assert!(!again.done);
    as_key(PHONE, 2 * DAY + FLOOR);
    assert!(p.run(again.id.unwrap()).done);
    // A refused add of words that are no longer the account's changes nothing.
    env::state_write(&p);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_recovery_words_key(key(WORDS));
    let mut p: AccountPolicy = env::state_read().unwrap();
    as_key(0xEF, 2 * DAY + FLOOR + 1);
    p.start_recovery(key(NEW_PHONE));
}
