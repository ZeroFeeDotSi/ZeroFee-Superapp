//! Independent audit, team A (manual review and specification), of the release build of the account contract at
//! 9b982d8 (release 6, no `modules`). Report: an internal review.
//!
//! Convention (METHOD.md 5): every `a*_` test is a finding's proof of concept. It asserts the guarantee: it failed at
//! 9b982d8 and passes once the finding is fixed (all FIXED in Security's next commit; the `info_*` tests now assert the
//! fixed behaviour where one was made). Every `v_*` test re-verifies an earlier finding (F*, R*, N*) with a variant of its
//! attack, and must pass.
mod common;
use common::finish_ok;
use account_policy::{moves, AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT: &str = "nep141:usdt.tether-token.near";
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const NEW_PHONE: u8 = 0x11;

fn me() -> AccountId {
    "me.near".parse().unwrap()
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

fn send(near: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(near) }]
}

fn call(method: &str, args: &str, deposit: u128) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(30_000_000_000_000) }
}

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}

/// The app's DEFAULT_PROTECTION at $2.50 a NEAR: Face ID up to $500 a day, then a 24-hour wait.
fn default_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } },
    ]
}

/// What "Ask my laptop above $5,000" (demo-core secondDeviceLimit) makes of the default bands.
fn laptop_above_5000() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: Some(vec![("near".into(), U128(2_000 * NEAR)), (USDC.into(), U128(5_000_000_000)), (USDT.into(), U128(5_000_000_000))]), level: Level::Wait { seconds: U64(DAY) } },
        Band { up_to: None, level: Level::Both { seconds: U64(DAY) } },
    ]
}

/// A mainnet account as the app makes it (demo-core setUp): phone named at `new`, first words in the setup batch, a
/// 7-day recovery, the default bands, no second device.
fn account() -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// The same account with the laptop the app offers at set-up (paired in hour 1, at once), now of age (day 10).
fn account_with_aged_laptop() -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 10 * DAY);
    assert_eq!(p.second_devices_of_age(), 1);
    p
}

// ═══ A-1 (Critical): with a second device of age, a recovery start doesn't freeze, and neither the words nor the
// ═══ second device can stop a wait-only payment the phone asks after it

/// Guarantee (header "While a recovery waits, spending is frozen too"; D44 "a recovery start freezes spending"; D44 (C)
/// "two of three then decide"): once the owner's words have started a recovery, nothing the phone alone asks runs before
/// that recovery can finish. On the app's default bands with the laptop it offers at set-up (now of age), a stolen phone
/// (or a bad app build) asks for the whole balance after the start; it waits only the band's day; the laptop can't decline
/// it (it doesn't need the laptop), the words can't start a second recovery, and the payment runs on day 1 of 7.
#[test]
fn a1_aged_laptop_no_freeze_whole_balance_leaves_during_the_owners_recovery() {
    let mut p = account_with_aged_laptop();
    let t = 10 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.frozen_until().is_some(), "FIXED (A-1): frozen during the recovery, second device or not");
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    assert!(!all.done);
    // The owner's laptop tries to refuse it: not allowed (it doesn't need the laptop).
    as_key(LAPTOP, t + 2);
    let laptop_refused = !fails(|| p.decline(all.id.unwrap()));
    // The owner's words try again: a recovery is already waiting.
    as_key(WORDS, t + 3);
    let words_stopped = !fails(|| p.start_recovery(key(NEW_PHONE)));
    as_key(PHONE, t + DAY + 1);
    let thief_ran = !fails(|| p.run(all.id.unwrap()));
    assert!(laptop_refused || words_stopped || !thief_ran, "A-1: the whole balance left on day 1 of the owner's 7-day recovery; neither the laptop nor the words could stop it");
}

/// A-1 on the bands the app makes for "Ask my laptop above $5,000": the thief takes the Face ID band at once and the
/// Wait band (to $5,000 a day) daily, for every day of the owner's recovery. The property: nothing the phone alone asks
/// after the start runs before the recovery can finish.
#[test]
fn a1b_ask_my_laptop_above_5000_still_bleeds_5000_a_day_through_the_recovery() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let limits = p.set_protection(laptop_above_5000());
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(limits.id.unwrap());
    as_key(PHONE, 18 * DAY + 2);
    assert!(p.run(limits.id.unwrap()).done);
    let t = 20 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    // The Wait band is one $5,000 budget per rolling 24 hours (a run counts from when it ran), so the thief asks every
    // two days; the owner finishes the recovery the moment it is ready (t + 7 days), which drops anything still waiting.
    let mut taken: u128 = 0;
    for k in 0..4u64 {
        let ask = t + 1 + k * (2 * DAY + 2);
        as_key(PHONE, ask);
        // 1,999 NEAR (just under $5,000 at $2.50) waits a day and needs no laptop.
        let o = p.execute(acct("thief.near"), send(1_999 * NEAR), None);
        assert!(!o.done);
        if ask + DAY < t + 7 * DAY {
            as_key(PHONE, ask + DAY);
            if !fails(|| p.run(o.id.unwrap())) {
                taken += 1_999;
            }
        }
    }
    assert_eq!(taken, 0, "A-1b: {taken} NEAR (~${}) left during the owner's recovery, phone alone", taken * 5 / 2);
}

// ═══ A-2 (High): no second device: a phone-only stop late in a recovery leaves what the phone queued during it a day
// ═══ from running, while frozen_until says "frozen for 8 more days"

/// Guarantee (header: "with no second device of age, at once, and spending then stays frozen for the floor"; security.md
/// "the phone's stop of a recovery keeps it frozen for a change's wait"): after a phone-only stop, nothing the phone
/// queued can run until the freeze ends, so the owner has a change's wait (8 days) to start again. Today the requests
/// queued during the recovery keep their own clocks (placed + floor): queued right after the start and stopped a second
/// before the recovery could finish, they run one day after the stop: the whole balance, and an upgrade to any code.
#[test]
fn a2_late_phone_stop_leaves_the_owner_one_day_not_eight() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    // The thief queues the whole balance and an upgrade right after the start. Both wait the floor (8 days).
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    let code = p.upgrade(Base64VecU8(vec![0xAB; 32]));
    assert!(!all.done && !code.done);
    // A second before the owner could finish, the thief stops the recovery (no second device: at once).
    as_key(PHONE, t + 7 * DAY - 1);
    assert!(p.cancel_recovery().done);
    let frozen_to = p.frozen_until().expect("frozen").0;
    assert_eq!(frozen_to, (t + 15 * DAY - 1) * SECOND, "the app is told: frozen for 8 more days");
    // One day and a second after the stop (still 7 days inside the freeze), the owner hasn't started again yet.
    as_key(PHONE, t + 8 * DAY + 1);
    let paid = !fails(|| p.run(all.id.unwrap()));
    let upgraded = !fails(|| p.run(code.id.unwrap()));
    assert!(!paid && !upgraded, "A-2: inside the announced freeze, the whole balance left (paid={paid}) and any code went in (upgraded={upgraded})");
}

// ═══ A-3 (Low): the 24-hour state of `spent` is unbounded: zero-value Face ID requests add a row each

/// Every Face ID request adds a `spent` row per coin, even with a zero amount, and rows live 24 hours. `spent` sits in
/// the main state that every call and callback loads and saves (and `upgrade_check` gets a fixed 50 Tgas to load).
/// Property: the rows a day of requests leaves stay bounded (e.g. zero amounts aren't stored, or rows are merged).
#[test]
fn a3_zero_value_requests_grow_state_without_bound() {
    let mut p = account();
    as_key(PHONE, DAY);
    // Each carries 30 Tgas, which counts as NEAR (the contract review, FB-1), so the 128-a-day cap holds them too.
    let mut ran = 0;
    for i in 0..3_000u64 {
        as_key(PHONE, DAY + i);
        if fails(|| p.execute(acct("wrap.near"), vec![call("near_deposit", "", 0)], None)) {
            break;
        }
        ran += 1;
    }
    assert_eq!(ran, 128, "the 129th in 24 hours is refused");
    // Called as a library the state isn't written to storage, so measure what the wrapper would write.
    let size = near_sdk::borsh::to_vec(&p).unwrap().len();
    assert!(size < 32 * 1024, "A-3: main state is {size} bytes after 3,000 zero-value requests in one day");
}

// ═══ A-4 (Low): after a finished recovery a second device nobody vouched for starts ageing at once

/// A thief's laptop added in hour 1 (no level) stays on the account through the owner's finished recovery (finish
/// deletes only phones) and comes of age a change's wait after the finish, before the owner's removal of it (which also
/// waits a change's wait) can run. Property: a finished recovery leaves no young second device that can come of age.
#[test]
fn a4_young_thief_laptop_survives_finish_and_comes_of_age_before_its_removal() {
    let mut p = account();
    as_key(PHONE, 60);
    assert!(p.add_second_device(key(0x77)).done, "hour 1: no level");
    as_key(WORDS, 2 * DAY);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, 9 * DAY);
    finish_ok(&mut p);
    as_key(NEW_PHONE, 9 * DAY + 60);
    let removal = p.remove_key(key(0x77));
    as_key(NEW_PHONE, 17 * DAY);
    let aged_before_removal = p.second_devices_of_age() == 1 && removal.ready_at_ns.unwrap().0 > 17 * DAY * SECOND;
    assert!(!aged_before_removal, "A-4: the thief's laptop counts fully from day 17 while its removal runs only after");
}

// ═══ Info PoCs (documented behaviour that differs from a claim) ═══════════════════════════════════════════════════

/// I-A1: in the first 24 hours a loosening waits only the strictest band (a day), not the floor; the header says "so
/// whoever holds an unlocked phone can't loosen the rules first", the floor-skip is documented for set-up steps.
#[test]
fn info_setup_window_loosening_waits_one_day_not_eight() {
    let mut p = account();
    as_key(PHONE, 23 * 3_600);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    assert_eq!(loosen.ready_at_ns.unwrap().0, (23 * 3_600 + DAY) * SECOND);
    as_key(PHONE, 23 * 3_600 + DAY);
    assert!(p.run(loosen.id.unwrap()).done);
    assert!(p.execute(acct("thief.near"), send(999_000 * NEAR), None).done, "everything at Face ID on day 2");
}

/// I-A2: an unmeasurable request (any group unmeasurable) adds no `spent` rows, so a measurable coin moved in the same
/// chain doesn't count toward the next 24 hours' Face ID budget.
#[test]
fn info_unmeasurable_chain_does_not_count_its_measured_coins() {
    let mut p = account();
    as_key(PHONE, 2 * DAY);
    let big = p.execute_many(vec![
        Group { receiver_id: acct("thief.near"), steps: send(10_000 * NEAR) },
        Group { receiver_id: acct("any.near"), steps: vec![call("whatever", "{}", 0)] },
    ]);
    as_key(PHONE, 3 * DAY);
    assert!(p.run(big.id.unwrap()).done);
    // FIXED (I-A2): what could be measured counts toward the next 24 hours, so the Face ID band is used up; and from
    // release 10 (M1/F2) the unmeasurable group's NEAR too (its call's 30 Tgas, counted as 0.03 NEAR).
    assert_eq!(p.spent_today(), vec![("near".to_string(), U128(10_000 * NEAR + 3 * NEAR / 100))]);
    assert!(!p.execute(acct("thief.near"), send(199 * NEAR), None).done);
}

/// I-A3: no upper bound on the recovery delay; near u64::MAX ns the floor overflowed and every owner call panicked.
/// FIXED: `new` refuses a delay over 30 days.
#[test]
fn info_huge_recovery_delay_bricks_every_owner_call() {
    reset();
    as_key(SETUP, 0);
    assert!(fails(|| AccountPolicy::new(U64(u64::MAX / SECOND - 1), default_bands(), Some(key(PHONE)), None)), "refused at new");
    assert!(fails(|| AccountPolicy::new(U64(30 * DAY + 1), default_bands(), Some(key(PHONE)), None)));
    let mut p = AccountPolicy::new(U64(30 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(WORDS, 40 * DAY);
    p.start_recovery(key(NEW_PHONE));
}

// ═══ Variants of earlier findings (must pass) ═══════════════════════════════════════════════════════════════════

/// F1 variant: every setting waits the floor outside the window (protection, a second device, a key removal, an
/// upgrade, new words), a start drops them all, and after a finish the old phone can't even cancel or view-change.
#[test]
fn v_f1_every_setting_waits_the_floor_and_the_old_phone_is_sealed_out() {
    let mut p = account();
    let t = 3 * DAY;
    as_key(PHONE, t);
    let floor = (t + 8 * DAY) * SECOND;
    let outs = [
        p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]),
        p.add_second_device(key(0x44)),
        p.upgrade(Base64VecU8(vec![1; 32])),
        p.set_recovery_key(key(0x45)),
    ];
    for o in [&outs[0], &outs[1], &outs[3]] {
        assert_eq!(o.ready_at_ns.unwrap().0, floor);
    }
    // Release 10 (V2): the upgrade (a release not on the list: its listing) says when the phone alone can run it, the
    // words-only fallback (21 days here).
    assert_eq!(outs[2].ready_at_ns.unwrap().0, (t + 21 * DAY) * SECOND);
    as_key(WORDS, t + 7 * DAY);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.waiting_requests().is_empty());
    as_key(WORDS, t + 14 * DAY);
    finish_ok(&mut p);
    as_key(PHONE, t + 14 * DAY + 1);
    assert!(fails(|| p.cancel(U64(1))));
    assert!(fails(|| p.execute(acct("a.near"), send(1), None)));
    assert!(fails(|| p.cancel_recovery()));
    as_key(NEW_PHONE, t + 14 * DAY + 2);
    assert!(p.execute(acct("a.near"), send(1), None).done);
}

/// F2 variant: the laptop never declines its own removal. Release 10 (round 2, the laptop veto, decision A): a laptop of
/// age now turns down a wait-only setting the phone asked alone (before: refused), and its no keeps the removal.
#[test]
fn v_f2_laptop_declines_only_what_needs_it() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let removal = p.remove_key(key(LAPTOP));
    as_key(LAPTOP, 10 * DAY + 1);
    assert!(fails(|| p.decline(removal.id.unwrap())));
    assert_eq!(p.waiting_requests().len(), 2);
    p.decline(loosen.id.unwrap());
    assert_eq!(p.waiting_requests().into_iter().map(|w| w.id).collect::<Vec<_>>(), vec![removal.id.unwrap()]);
}

/// F3 variant: with two laptops, removing one keeps the device levels; removing the last turns Both{1 day} into a wait
/// of at least the floor, never a looser level.
#[test]
fn v_f3_last_laptop_gone_levels_become_floor_waits() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let both = p.set_protection(laptop_above_5000());
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(both.id.unwrap());
    as_key(PHONE, 18 * DAY + 1);
    p.run(both.id.unwrap());
    // Re-audit 7 (R7-1): removing a laptop of age waits the fallback (21 days on a 7-day account), not the 8-day floor.
    let r = p.remove_key(key(LAPTOP));
    assert_eq!(r.ready_at_ns.unwrap().0, (18 * DAY + 1 + 21 * DAY) * SECOND);
    as_key(PHONE, 39 * DAY + 2);
    p.run(r.id.unwrap());
    let bands = p.protection();
    assert_eq!(bands.last().unwrap().level, Level::Wait { seconds: U64(8 * DAY) });
    assert!(bands.iter().all(|b| !matches!(b.level, Level::Device | Level::Both { .. })));
}

/// F4 / F17 variants: the laptop's key goes in with a 1 NEAR allowance and only approve/decline; the words' key with
/// 0.25 NEAR and only start/finish; renewing either changes nothing else and goes at once.
#[test]
fn v_f4_f17_allowances_and_method_lists() {
    let mut p = account();
    let actions: Vec<String> = get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("start_recovery") && a.contains("finish_recovery") && a.contains("250000000000000000000000")), "{actions:?}");
    as_key(PHONE, 3_600);
    p.add_second_device(key(LAPTOP));
    let actions: Vec<String> = get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("approve") && a.contains("decline") && a.contains("1000000000000000000000000")), "{actions:?}");
    as_key(PHONE, 2 * DAY);
    assert!(p.add_second_device(key(LAPTOP)).done && p.set_recovery_key(key(WORDS)).done);
    assert_eq!(p.second_device_count(), 1);
}

/// F5 / F18 variants: argument smuggling into allowlisted methods, allowlisted names on intents.near, nested JSON, a
/// number amount, case changes and trailing spaces all go to the strictest band; standard moves are measured.
#[test]
fn v_f5_measurement_allowlist_variants() {
    let none = |r: &str, m: &str, a: &str| moves(r, &[call(m, a, 0)]).is_none();
    assert!(none("wrap.near", "near_withdraw", r#"{"amount":"1","receiver_id":"thief.near"}"#));
    assert!(none("wrap.near", "storage_deposit", r#"{"account_id":"x.near","msg":"pay"}"#));
    assert!(none("intents.near", "near_withdraw", r#"{"amount":"1"}"#));
    assert!(none("intents.near", "storage_deposit", "{}"));
    assert!(none("intents.near", "native_withdraw", r#"{"receiver_id":"t.near","amount":"1"}"#));
    assert!(none("intents.near", "mt_withdraw", "{}"));
    assert!(none("intents.near", "execute_intents", "{}"));
    assert!(none("intents.near", "mt_transfer", r#"{"token_id":"nep141:usdt.tether-token.near","amount":5}"#));
    assert!(none("usdt.tether-token.near", "FT_TRANSFER", r#"{"amount":"1"}"#));
    assert!(none("usdt.tether-token.near", "ft_transfer ", r#"{"amount":"1"}"#));
    assert!(none("usdt.tether-token.near", "storage_unregister", r#"{"force":true}"#));
    assert!(none("x.near", "nft_approve", "{}"));
    assert!(none("x.near", "ft_withdraw", r#"{"token":"a","amount":"1"}"#));
    assert!(none("wrap.near", "near_deposit", "[]"));
    // Only argument NAMES are matched: a wrong-typed value is left to the callee to refuse (wrap.near does).
    assert!(!none("wrap.near", "near_withdraw", r#"{"amount":{"amount":"1"}}"#));
    assert_eq!(moves("usdt.tether-token.near", &[call("ft_transfer_call", r#"{"receiver_id":"intents.near","amount":"7","msg":"thief.near"}"#, 1)]).unwrap(), vec![("near".to_string(), 1 + 30_000_000_000_000 * 1_000_000_000), (USDT.to_string(), 7)], "release 8 (RS-2): its 30 Tgas count as NEAR");
    // Round 4c (defence in depth): an Intents withdrawal with storage_deposit (NEAR paid out of the ledger, unmeasured)
    // or any argument but token, receiver_id, amount, memo and msg can't be measured. Before, it counted the 9 alone.
    assert!(none("intents.near", "ft_withdraw", r#"{"token":"usdt.tether-token.near","receiver_id":"t.near","amount":"9","storage_deposit":"1000000000000000000000000"}"#));
    assert_eq!(moves("intents.near", &[call("ft_withdraw", r#"{"token":"usdt.tether-token.near","receiver_id":"t.near","amount":"9"}"#, 1)]).unwrap(), vec![("near".to_string(), 1 + 30_000_000_000_000 * 1_000_000_000), (USDT.to_string(), 9)]);
    assert!(moves("intents.near", &[call("mt_batch_transfer", r#"{"token_ids":["a","b"],"amounts":["1"]}"#, 1)]).is_none());
}

/// F6 variant: three coins at a third of their limits plus one unit is over the one budget; rounding is up.
#[test]
fn v_f6_one_budget_across_coins_rounds_up() {
    let mut p = account();
    as_key(PHONE, 2 * DAY);
    let third = |l: u128| l / 3 + 1;
    let o = p.execute_many(vec![
        Group { receiver_id: acct("thief.near"), steps: send(third(200 * NEAR)) },
        Group { receiver_id: acct("usdt.tether-token.near"), steps: vec![call("ft_transfer", &format!(r#"{{"receiver_id":"t.near","amount":"{}"}}"#, third(500_000_000)), 0)] },
        Group { receiver_id: acct("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), steps: vec![call("ft_transfer", &format!(r#"{{"receiver_id":"t.near","amount":"{}"}}"#, third(500_000_000)), 0)] },
    ]);
    assert!(!o.done, "over one budget: waits");
}

/// F7 / R8 variants: an upgrade is the strictest level plus the floor; the switch and upgrade_check are one receipt;
/// upgrade_check refuses an older from_version and any module storage key, even only `kids_why` or `order_tries`.
#[test]
fn v_f7_r8_upgrade_variants() {
    let mut p = account();
    // Release 9: the hash on the list first (as release 9's upgrade_check sets it).
    as_key(PHONE, 2 * DAY);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
    let up = p.upgrade(Base64VecU8(vec![7; 32]));
    assert_eq!(up.ready_at_ns.unwrap().0, 10 * DAY * SECOND);
    assert!(fails(|| p.upgrade(Base64VecU8(vec![7; 31]))));
    as_key(PHONE, 10 * DAY);
    let _ = get_created_receipts();
    p.run(up.id.unwrap());
    let r = get_created_receipts();
    assert!(r.iter().any(|x| x.actions.len() == 2 && format!("{:?}", x.actions).contains("UseGlobalContract") && format!("{:?}", x.actions).contains("FunctionCall")), "{r:?}");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(fails(|| p.upgrade_check(account_policy::RELEASE_VERSION + 1, None)));
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(6, None);
    for k in [&b"kids_why"[..], b"order_tries", b"legacy"] {
        env::storage_write(k, &[0]);
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(fails(|| p.upgrade_check(6, None)));
        env::storage_remove(k);
    }
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(6, None);
}

/// F10 variant: two waiting adds of the same new key: the second fails at finish; a fifth device fails at finish.
#[test]
fn v_f10_cap_and_duplicates_rechecked_at_finish() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let a = p.add_second_device(key(0x41));
    let b = p.add_second_device(key(0x41));
    let c = p.add_second_device(key(0x42));
    let d = p.add_second_device(key(0x43));
    as_key(PHONE, 18 * DAY);
    p.run(a.id.unwrap());
    assert!(fails(|| p.run(b.id.unwrap())));
    p.run(c.id.unwrap());
    p.run(d.id.unwrap());
    assert_eq!(p.second_device_count(), 4);
    assert!(fails(|| p.add_second_device(key(0x44))));
}

/// F12 variant: the queue refuses past 64 KB of waiting requests (here ~41 KB each), not past only 20.
#[test]
fn v_f12_waiting_bytes_capped() {
    let mut p = account();
    as_key(PHONE, 2 * DAY);
    let big = |n: u8| Group { receiver_id: acct("x.near"), steps: (0..10).map(|_| call("m", &"a".repeat(4_000), n as u128)).collect() };
    let mut placed = 0;
    for i in 0..5u8 {
        if !fails(|| p.execute_many(vec![big(i)])) {
            placed += 1;
        }
    }
    assert!(placed < 5, "refused once the queue would pass 64 KB");
}

/// F14 / N1 variants: words rotation co-signed by a laptop of age survives a start and ends the leaked words'
/// recovery; one co-signed by a young laptop is dropped.
#[test]
fn v_f14_n1_rotation_variants() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let rot = p.set_recovery_key(key(0x46));
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(rot.id.unwrap());
    as_key(WORDS, 11 * DAY);
    p.start_recovery(key(0x66));
    assert_eq!(p.waiting_requests().len(), 1, "co-signed by a laptop of age: kept");
    as_key(PHONE, 18 * DAY);
    p.run(rot.id.unwrap());
    assert!(p.pending().is_none(), "the leaked words' recovery went with them");
    // Young co-signer: dropped.
    let mut q = account();
    as_key(PHONE, 60);
    q.add_second_device(key(0x77));
    as_key(PHONE, 2 * DAY);
    let rot = q.set_recovery_key(key(0x46));
    as_key(0x77, 2 * DAY + 1);
    assert!(fails(|| q.approve(rot.id.unwrap())), "a young laptop can't co-sign a setting");
    as_key(WORDS, 3 * DAY);
    q.start_recovery(key(0x66));
    assert!(q.waiting_requests().is_empty());
}

/// R1 variant: frozen without a second device: execute_many and a split payment all wait the floor; level_for agrees.
#[test]
fn v_r1_freeze_variants() {
    let mut p = account();
    as_key(WORDS, 2 * DAY);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 2 * DAY + 1);
    assert_eq!(p.level_for(acct("a.near"), send(1), None), Level::Wait { seconds: U64(8 * DAY) });
    assert!(!p.execute(acct("a.near"), send(1), None).done);
    assert!(!p.execute_many(vec![Group { receiver_id: acct("a.near"), steps: send(1) }]).done);
    assert!(p.cancel_recovery().done);
    as_key(PHONE, 10 * DAY);
    assert!(!p.execute(acct("a.near"), send(1), None).done, "last second of the freeze");
    as_key(PHONE, 10 * DAY + 1);
    assert!(p.execute(acct("a.near"), send(1), None).done, "freeze over");
}

/// R3 variant: with a laptop of age the phone's stop waits min(1 day, delay/2); the laptop may refuse it; only one stop
/// waits at a time; a young laptop can't refuse.
#[test]
fn v_r3_stop_timing_variants() {
    let mut p = account_with_aged_laptop();
    as_key(WORDS, 10 * DAY);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 10 * DAY + 1);
    let stop = p.cancel_recovery();
    assert_eq!(stop.ready_at_ns.unwrap().0, (11 * DAY + 1) * SECOND);
    assert!(fails(|| p.cancel_recovery()), "one stop at a time");
    as_key(LAPTOP, 10 * DAY + 2);
    p.decline(stop.id.unwrap());
    assert!(p.pending().is_some());
    // 60-second account: half the delay.
    reset();
    as_key(SETUP, 0);
    let mut q = AccountPolicy::new(U64(60), default_bands(), Some(key(PHONE)), None);
    q.set_recovery_key(key(WORDS));
    as_key(PHONE, 1);
    q.add_second_device(key(LAPTOP));
    as_key(WORDS, 10 * DAY);
    q.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 10 * DAY + 1);
    assert_eq!(q.cancel_recovery().ready_at_ns.unwrap().0, (10 * DAY + 31) * SECOND);
}

/// R4 / N2 variants: a device added during a recovery doesn't age until it ends; after a phone-only stop it ages from
/// the freeze's end; a young device's approval of a setting is refused and its approval of a Device payment doesn't
/// protect it from a start.
#[test]
fn v_r4_n2_age_variants() {
    let mut p = account();
    as_key(WORDS, 2 * DAY);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 2 * DAY + 1);
    // Outside the window: waits the floor and the finish drops it, so add one in a fresh account's window instead.
    assert!(!p.add_second_device(key(0x77)).done);
    let mut q = account();
    as_key(WORDS, 60);
    q.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 120);
    assert!(q.add_second_device(key(0x77)).done, "the window: at once, during a recovery");
    assert_eq!(q.second_device_ages()[0].1, U64(u64::MAX));
    assert!(q.cancel_recovery().done, "young: phone-only stop");
    let freeze_end = q.frozen_until().unwrap().0;
    assert_eq!(q.second_device_ages()[0].1 .0, freeze_end + 8 * DAY * SECOND);
}

/// R7 variant: the new phone can't be the laptop, the words, the phone or the (deleted) setup key's slot.
#[test]
fn v_r7_new_key_in_use_variants() {
    let mut p = account_with_aged_laptop();
    as_key(WORDS, 10 * DAY);
    for k in [LAPTOP, WORDS, PHONE] {
        assert!(fails(|| p.start_recovery(key(k))));
    }
    p.start_recovery(key(NEW_PHONE));
}

/// Access control: no key-less caller, no other account, can reach any owner method; callbacks are private.
#[test]
fn v_strangers_and_callbacks() {
    let mut p = account();
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(acct("x.near")).signer_account_id(acct("x.near")).block_timestamp(DAY * SECOND).build());
    assert!(fails(|| p.execute(acct("a.near"), send(1), None)));
    assert!(fails(|| p.start_recovery(key(1))));
    assert!(fails(|| p.finish_recovery()));
    assert!(fails(|| p.approve(U64(1))));
}

// ═══ A-5 (High): the app still makes a child's account on mainnet (Face ID for everything), and this release has no
// ═══ Kids, so the parent's rules can never be put on it

/// apps/web Welcome -> "Who is this bank for?" -> "My child" sends account.create {kid: true} on every network
/// (screens/Kid.tsx WhoFor, kid.ts createParams, App.tsx:267); the core then calls `new` with the one band
/// `[{up_to: null, level: FaceId}]` (demo-core.ts:946), relying on Kids' `kids_set` for the parent's limits. Release 6
/// has no `kids_set` (DEVICE_METHODS, the 30 exports), so the account stays Face ID for any amount, even with the
/// parent's device paired. The contract runs the bands its owner chose; the FIX is the app's (Security): the core refuses
/// `kid: true` on a release without Kids, and the app shows "My child" only where Kids exists (core rearm/kid tests,
/// apps/web child-apps). This test now records the contract's side: bands of Face ID for any amount do move everything,
/// so the app must never make them.
#[cfg(not(feature = "modules"))]
#[test]
fn a5_childs_account_moves_everything_at_face_id_and_the_parents_rules_cannot_exist() {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done, "the parent's phone, paired in hour 1");
    assert!(!account_policy::DEVICE_METHODS.contains("kids_set"), "no Kids in this release");
    as_key(PHONE, 2 * DAY);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    assert!(all.done, "Face ID for any amount is what such bands say: the app never makes them (the core refuses a child's account here)");
}

// ═══ Property test: random sequences of the release's methods ════════════════════════════════════════════════════

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Random owner/thief/words/laptop sequences on the app's account, half with a laptop of age. Asserted (must hold):
/// (P1) a request waiting, and not co-signed, when a recovery starts never runs; (P2) after a finished recovery the old
/// phone can't call anything; (P3) a setting never runs before placed + floor (outside the first day); (P4) `run`
/// succeeds only when the request is ready and, if it needs the laptop, approved; (P5) level_for agrees with execute.
/// Counted, not asserted (A-1 / A-2): phone-only payments that ran while a recovery waited or `frozen_until` said frozen.
#[test]
fn fuzz_release_properties_and_freeze_leaks() {
    let (mut leaks_aged, mut leaks_none, mut runs, mut starts, mut finishes) = (0u32, 0u32, 0u32, 0u32, 0u32);
    let mut face_id_while_frozen = 0u32;
    for seed in 1..=300u64 {
        let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let laptop = seed % 2 == 0;
        let mut p = if laptop { account_with_aged_laptop() } else { account() };
        let mut now = 22 * DAY; // release 10 (F1): its laptop on the account for the fallback
        let mut phone = PHONE;
        let mut next_phone = 0x60u8;
        let mut old_phones: Vec<u8> = vec![];
        // id -> (placed_at, is_setting, needs_device, approved, doomed_by_start)
        let mut asked_in_recovery: std::collections::HashSet<u64> = Default::default();
        let mut book: std::collections::HashMap<u64, (u64, bool, bool, bool, bool)> = Default::default();
        for _ in 0..60 {
            match r.below(12) {
                0..=2 => {
                    as_key(phone, now);
                    let amount = [NEAR, 150 * NEAR, 2_000 * NEAR, 50_000 * NEAR][r.below(4) as usize];
                    // Release 10 (round 2): the preview refuses what execute refuses (M-I1), a laptop's dispute too (the veto);
                    // round 3 (B3-2): and a full queue.
                    let Ok(lvl) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.level_for(acct("x.near"), send(amount), None))) else {
                        assert!(p.dispute_until().is_some() || p.waiting_requests().len() >= 20, "seed {seed}: the preview refused outside a dispute, with room in the queue");
                        continue;
                    };
                    let Ok(o) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(acct("x.near"), send(amount), None))) else { continue };
                    assert_eq!(o.done, lvl == Level::FaceId, "P5 seed {seed}");
                    if o.done {
                        if p.pending().is_some() || p.frozen_until().is_some() {
                            if laptop { leaks_aged += 1 } else { face_id_while_frozen += 1 }
                        }
                    } else {
                        if p.pending().is_some() {
                            asked_in_recovery.insert(o.id.unwrap().0);
                        }
                        book.insert(o.id.unwrap().0, (now, false, o.needs_device, false, false));
                    }
                }
                3 => {
                    as_key(phone, now);
                    let Ok(o) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]))) else { continue };
                    assert!(o.ready_at_ns.unwrap().0 >= (now + 8 * DAY) * SECOND, "P3 at placement, seed {seed}: now {now} ready {:?} bands {:?} pending {:?} frozen {:?} delay {:?}", o.ready_at_ns, p.protection(), p.pending(), p.frozen_until(), p.delay_seconds());
                    book.insert(o.id.unwrap().0, (now, true, o.needs_device, false, false));
                }
                4 if laptop => {
                    if let Some(w) = p.waiting_requests().first().cloned() {
                        as_key(LAPTOP, now);
                        if !fails(|| p.approve(w.id)) {
                            if let Some(b) = book.get_mut(&w.id.0) {
                                b.3 = true;
                            }
                        }
                    }
                }
                5 | 6 => {
                    let ws = p.waiting_requests();
                    if ws.is_empty() {
                        continue;
                    }
                    let w = ws[r.below(ws.len() as u64) as usize].clone();
                    as_key(phone, now);
                    let ok = !fails(|| p.run(w.id));
                    // While a recovery waits only a co-signed request (the laptop of age said yes) or the phone's stop runs
                    // (FIXED A-2: the finish drops the rest, so finishing late can't let it through first).
                    let co_signed_or_stop = w.approved || matches!(w.change, account_policy::Change::CancelRecovery);
                    let ready = now * SECOND >= w.ready_at_ns.0 && (!w.needs_device || w.approved) && (p.pending().is_none() || co_signed_or_stop);
                    assert_eq!(ok, ready, "P4 seed {seed}");
                    if ok {
                        runs += 1;
                        if let Some(b) = book.get(&w.id.0) {
                            assert!(!b.4, "P1 seed {seed}: a request the start should have dropped ran");
                            if b.1 && b.0 >= 2 * DAY {
                                assert!(now >= b.0 + 8 * DAY, "P3 seed {seed}: placed {} now {} ready {} change {:?}", b.0, now, w.ready_at_ns.0 / SECOND, w.change);
                            }
                            if !b.1 && !b.3 && b.0 > 0 {
                                // a phone-only payment that ran while a recovery waits or frozen_until says frozen. Without a laptop that
                                // can only be A-2: it was asked while a recovery waited (the freeze end is after its ready time).
                                if p.pending().is_some() || p.frozen_until().is_some() {
                                    if !laptop {
                                        assert!(asked_in_recovery.contains(&w.id.0), "no laptop: only A-2's requests (asked during a recovery) leak (seed {seed})");
                                    }
                                    if laptop { leaks_aged += 1 } else { leaks_none += 1 }
                                }
                            }
                        }
                    }
                }
                7 => {
                    as_key(WORDS, now);
                    if p.pending().is_none() {
                        let k = next_phone;
                        next_phone += 1;
                        p.start_recovery(key(k));
                        starts += 1;
                        let alive: Vec<u64> = p.waiting_requests().iter().map(|w| w.id.0).collect();
                        for (id, b) in book.iter_mut() {
                            if !alive.contains(id) {
                                b.4 = true;
                            }
                        }
                    }
                }
                8 => {
                    as_key(phone, now);
                    let _ = fails(|| p.cancel_recovery());
                }
                9 => {
                    as_key(WORDS, now);
                    if let Some(rec) = p.pending() {
                        if now * SECOND >= rec.ready_at_ns.0 {
                            let new = rec.new_key.0[1];
                            // Release 7: with the laptop of age on the account, the finish needs its yes to this recovery.
                            if laptop {
                                as_key(LAPTOP, now);
                                p.approve_recovery(rec.new_key.clone(), rec.ready_at_ns);
                                as_key(WORDS, now);
                            }
                            finish_ok(&mut p);
                            finishes += 1;
                            old_phones.push(phone);
                            phone = new;
                            for old in &old_phones {
                                as_key(*old, now);
                                assert!(fails(|| p.execute(acct("x.near"), send(1), None)), "P2 seed {seed}");
                                assert!(fails(|| p.cancel_recovery()), "P2 seed {seed}");
                            }
                        }
                    }
                }
                10 if laptop => {
                    if let Some(w) = p.waiting_requests().last().cloned() {
                        as_key(LAPTOP, now);
                        let _ = fails(|| p.decline(w.id));
                    }
                }
                _ => {
                    now += [1, 3_600, DAY, DAY + 1, 7 * DAY - 1, 8 * DAY, r.below(3 * DAY)][r.below(7) as usize];
                }
            }
        }
    }
    assert_eq!(face_id_while_frozen, 0, "R1: nothing at Face ID while frozen (no laptop of age)");
    // FIXED (A-1, A-2): no phone-only payment runs while a recovery waits or the freeze holds, laptop of age or not.
    assert_eq!((leaks_aged, leaks_none), (0, 0), "phone-only payments during a recovery or freeze");
    println!("fuzz: runs {runs}, starts {starts}, finishes {finishes}; phone-only payments during a recovery/freeze: with a laptop of age {leaks_aged}, without {leaks_none}");
}

/// A-2b: the same one-day margin when the owner finishes late: a payment the phone asks right after the start waits
/// placed + floor (start + 8 days); the recovery is ready at start + 7 days. If the owner's finish comes more than a day
/// after it's ready, the thief's payment runs first, while `pending()` still shows the recovery waiting.
#[test]
fn a2b_owner_finishing_a_day_late_loses_what_the_phone_queued() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    as_key(PHONE, t + 8 * DAY + 1);
    assert!(p.pending().is_some(), "the owner's recovery is ready (since day 7) but not finished yet");
    assert!(fails(|| p.run(all.id.unwrap())), "A-2b: the whole balance left while the recovery waited to be finished");
}

// ═══ Each part of the A-1 and A-2 fixes on its own (each test fails with that part undone: Security's mutation check)

/// A-1: a Face ID payment doesn't run at once while a recovery waits, on an account with a second device of age too.
#[test]
fn a1c_face_id_waits_during_a_recovery_with_an_aged_laptop() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done, "before the recovery, 1 NEAR runs at Face ID");
    as_key(WORDS, 10 * DAY + 1);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 10 * DAY + 2);
    assert!(!p.execute(acct("bob.near"), send(NEAR), None).done, "A-1: Face ID ran while a recovery waits");
}

/// A-1: the second device of age refuses what the phone asked alone during a recovery, even a wait-only payment that
/// doesn't need it; it can't refuse its own removal.
#[test]
fn a1d_the_aged_laptop_refuses_what_the_phone_asks_alone_during_a_recovery() {
    let mut p = account_with_aged_laptop();
    let t = 10 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    let removal = p.remove_key(key(LAPTOP));
    as_key(LAPTOP, t + 2);
    assert!(!fails(|| p.decline(all.id.unwrap())), "A-1: the laptop couldn't refuse a wait-only payment during the recovery");
    assert!(!p.waiting_requests().iter().any(|w| Some(w.id) == all.id));
    assert!(fails(|| p.decline(removal.id.unwrap())), "a second device can't refuse its own removal this way");
}

/// A-2: a stop the second device co-signs drops what the phone asked alone during the recovery, as a phone-only stop does.
#[test]
fn a2c_a_co_signed_stop_drops_what_the_phone_asked_alone() {
    let mut p = account_with_aged_laptop();
    // Release 10 (round 2, G2): its yes to the stop needs the laptop on the account for the fallback (21 days on 7 days).
    let t = 22 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    let stop = p.cancel_recovery();
    assert!(!stop.done, "with a second device of age the phone's stop waits for its yes");
    as_key(LAPTOP, t + 2);
    assert!(p.approve(stop.id.unwrap()).done);
    assert!(p.pending().is_none());
    assert!(!p.waiting_requests().iter().any(|w| Some(w.id) == all.id), "A-2: the phone's request outlived the co-signed stop");
    as_key(PHONE, t + 2 * DAY);
    assert!(fails(|| p.run(all.id.unwrap())));
}

/// Re-check 1, R-I1: a yes given while the device was young never counts as co-signed, even after it comes of age: the
/// request goes at a recovery start as any phone-only one does.
#[test]
fn ri1_a_yes_given_while_young_never_co_signs() {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done, "hour 1, no level");
    let b = p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(200 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Both { seconds: U64(DAY) } }]);
    as_key(PHONE, 3_600 + DAY);
    assert!(p.run(b.id.unwrap()).done);
    as_key(PHONE, 2 * DAY);
    let pay = p.execute(acct("bob.near"), send(999 * NEAR), None);
    as_key(0x77, 2 * DAY + 1);
    assert_eq!(p.second_devices_of_age(), 0);
    assert!(!p.approve(pay.id.unwrap()).done, "approved young; still waiting its day");
    as_key(WORDS, 9 * DAY);
    assert_eq!(p.second_devices_of_age(), 1, "of age by now");
    p.start_recovery(key(NEW_PHONE));
    assert!(!p.waiting_requests().iter().any(|w| Some(w.id) == pay.id), "R-I1: a yes given while young counted as co-signed once of age");
}
