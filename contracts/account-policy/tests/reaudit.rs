//! Re-audit of the account contract at 8076d08 (CONTRACT-AUDIT.md, "Re-audit"). Every `r*` test was written to PASS
//! while its attack worked; each is now flipped (FIXED) and passes because the attack fails. `closed_*` tests try
//! variants of the first audit's findings and must keep passing; `fuzz_*` assert properties of the new rules.
mod common;
use common::finish_ok;
use account_policy::{AccountPolicy, Band, Change, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT: &str = "nep141:usdt.tether-token.near";

// Keys: 0x50 the setup batch's one-time key, 0x33 the phone, 0xEE the backup words, 0x09 the owner's laptop,
// 0x77 a thief's laptop, 0x11 / 0x12 new phones.
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;

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

#[cfg(feature = "modules")]
fn as_caller(caller: &str, now_s: u64) {
    let caller: AccountId = caller.parse().unwrap();
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(caller.clone()).signer_account_id(caller).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000_000)).build());
}

#[cfg(feature = "modules")]
fn callback(now_s: u64, result: near_sdk::PromiseResult) {
    testing_env!(
        VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000_000)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn send(near: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(near) }]
}

fn call(method: &str, args: &str, deposit: u128) -> Vec<Step> {
    vec![Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(30_000_000_000_000) }]
}

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn actions() -> Vec<MockAction> {
    get_created_receipts().into_iter().flat_map(|r| r.actions).collect()
}

/// The app's default mainnet bands at $2.50 a NEAR: Face ID up to $500 (one budget across NEAR, USDC, USDT), then 24 h.
fn default_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } },
    ]
}

/// A v5 account as `new` intends it (the phone named), with the first backup key from the setup batch. 7-day recovery.
fn sealed_account() -> AccountPolicy {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

// ══ R1 (High) — no second device (every default account): a stolen phone bleeds the Face ID band forever ═══════════

/// FIXED (R1): with no second device, a waiting recovery freezes spending, and so does the phone's cancel of one, for a
/// change's wait: every payment waits that long, so the owner's next start (which drops it) always comes first.
#[test]
fn r1_stolen_phone_without_second_device_drains_the_face_id_band_and_cancels_every_recovery() {
    let mut p = sealed_account();
    let mut last: Option<U64> = None;
    let mut day = 2;
    while day < 62 {
        let t = day * DAY;
        as_key(WORDS, t); // the owner restarts a recovery every day for two months
        p.start_recovery(key(0x11));
        assert!(p.frozen_until().unwrap().0 >= (t + 7 * DAY) * SECOND, "frozen at least until the recovery could finish");
        if let Some(id) = last {
            assert!(!p.waiting_requests().iter().any(|w| w.id == id), "yesterday's payment was dropped by the start");
        }
        as_key(PHONE, t + 1);
        assert!(p.cancel_recovery().done, "with no second device the phone still cancels at once");
        assert_eq!(p.frozen_until().unwrap().0, (t + 1 + 8 * DAY) * SECOND, "but spending stays frozen for 8 days");
        let pay = p.execute(acct("thief.near"), send(199 * NEAR), None);
        assert!(!pay.done, "and it can't pay itself");
        assert_eq!(pay.ready_at_ns.unwrap().0, (t + 1 + 8 * DAY) * SECOND);
        assert!(fails(|| p.run(pay.id.unwrap())));
        last = pay.id;
        day += 1;
    }
    // The freeze ends 8 days after the last cancel, and the Face ID band is back.
    as_key(PHONE, 61 * DAY + 1 + 8 * DAY);
    assert!(p.frozen_until().is_none());
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done);
}

// ══ R2 (High, new) — leaked words + no second device: the owner can never change the words ════════════════════════════

/// FIXED (R2) in release 6, then REOPENED by re-audit 2's N1 (a), the product's choice: the words beat the phone. The R2
/// fix let a stolen phone replace the words (N1). Now new words asked by the phone wait the floor and the leaked words'
/// start drops them, so without a second device the owner can't replace leaked words; but leaked words take nothing:
/// spending stays frozen and the phone stops each move (reaudit2.rs, n1a_cost_…). The app asks for a second device
/// before the vault holds more than $5,000.
#[test]
fn r2_leaked_words_block_their_own_replacement_forever() {
    let mut p = sealed_account();
    let t = 2 * DAY;
    as_key(PHONE, t);
    let rotate = p.set_recovery_key(key(0xEF));
    assert_eq!(rotate.ready_at_ns.unwrap().0, (t + 8 * DAY) * SECOND, "the floor, as any change");
    let pay = p.execute(acct("landlord.near"), send(1_000 * NEAR), None);
    assert!(!pay.done);
    as_key(WORDS, t + 3_600); // the leaked words, an hour later
    p.start_recovery(key(0x66));
    assert!(p.waiting_requests().is_empty(), "the rotation goes with the phone-only payment");
    as_key(PHONE, t + 3_601);
    // Release 10 (R1): new words may be asked while it waits, but the phone's ask alone never runs in it, and the stop
    // drops it.
    let again = p.set_recovery_key(key(0xF0));
    assert!(!again.done, "new words asked while the recovery waits wait");
    assert!(p.cancel_recovery().done, "the phone stops it at once");
    assert!(p.waiting_requests().iter().all(|w| w.id != again.id.unwrap()), "and the stop drops them");
    assert!(!p.execute(acct("bob.near"), send(NEAR), None).done, "and spending stays frozen for a change's wait");
}

// ══ R3 (Medium, new) — a LOST second device makes leaked words a 7-day takeover nobody can stop ═══════════════════════

/// FIXED (R3): the phone's cancel waits a day and the second device may refuse it; a lost laptop refuses nothing, so the
/// cancel runs and the leaked words' recovery ends.
#[test]
fn r3_lost_laptop_plus_leaked_words_takes_the_account() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    // The laptop (on the account for more than the floor) is lost. The owner asks to remove it: the fallback, 21 days
    // (re-audit 7, R7-1; it was the 8-day floor).
    let t = 10 * DAY;
    as_key(PHONE, t);
    let rm = p.remove_key(key(LAPTOP));
    assert_eq!(rm.ready_at_ns.unwrap().0, (t + 21 * DAY) * SECOND);
    as_key(WORDS, t + 10);
    p.start_recovery(key(0x66));
    assert!(p.waiting_requests().is_empty());
    as_key(PHONE, t + 11);
    let stop = p.cancel_recovery();
    assert!(!stop.done && !stop.needs_device, "a day's wait, no yes needed");
    as_key(PHONE, t + 11 + DAY);
    assert!(p.run(stop.id.unwrap()).done);
    assert!(p.pending().is_none());
    as_key(WORDS, t + 10 + 7 * DAY);
    assert!(fails(|| p.finish_recovery()), "nothing left to finish");
    // A stop no second device said yes to leaves spending frozen for a change's wait (re-check 1, R-2), then the phone acts.
    as_key(PHONE, t + 11 + 7 * DAY);
    assert!(!p.execute(acct("bob.near"), send(1), None).done, "frozen for 8 days after the unrefused stop");
    as_key(PHONE, t + 11 + DAY + 8 * DAY);
    assert!(p.execute(acct("bob.near"), send(1), None).done, "the owner's phone still acts");
}

/// R3's other half: a safe laptop refuses a thief's cancel, and its yes ends the owner's own at once.
#[test]
fn r3_a_second_device_refuses_the_phones_cancel_or_ends_it_at_once() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 10 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(0x66));
    as_key(PHONE, t + 1);
    let thief = p.cancel_recovery();
    as_key(LAPTOP, t + 2);
    p.decline(thief.id.unwrap());
    as_key(PHONE, t + 1 + DAY);
    assert!(fails(|| p.run(thief.id.unwrap())));
    assert!(p.pending().is_some(), "the recovery still waits");
    // Re-audit 7 (R7-2): one stop per recovery once the laptop refused one; the owner's laptop ends it itself.
    assert!(fails(|| p.cancel_recovery()), "a second stop of the same recovery is refused");
    as_key(LAPTOP, t + 2 + DAY);
    p.refuse_recovery(None);
    assert!(p.pending().is_none());
}

// ══ R4 (Medium, new) — the first 24 hours: one Face ID tap gives a thief (or a bad build) two of three for good ═══════

/// FIXED (R4): a second device younger than a change's wait can't co-sign a change, can't approve or refuse a cancel,
/// and doesn't stop the freeze; so the words still drop everything and nothing the thief asked for runs.
#[test]
fn r4_first_day_second_device_gives_permanent_two_of_three() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    assert_eq!(loosen.ready_at_ns.unwrap().0, (3_600 + DAY) * SECOND);
    as_key(0x77, 3_601);
    assert!(fails(|| p.approve(loosen.id.unwrap())), "too young to co-sign");
    as_key(WORDS, 7_200);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "the loosening is dropped");
    as_key(PHONE, 7_201);
    assert!(p.cancel_recovery().done, "no second device of age: the phone cancels at once, and spending freezes");
    assert!(fails(|| p.run(loosen.id.unwrap())));
    let big = p.execute(acct("thief.near"), send(900_000 * NEAR), None);
    assert!(!big.done);
    assert_eq!(big.ready_at_ns.unwrap().0, (7_201 + 8 * DAY) * SECOND);
}

/// R4's other half: a young device's yes on what NEEDS it still counts (a child's parent on day one), but a recovery
/// start drops what it approved.
#[test]
fn r4_a_young_device_says_yes_to_what_needs_it_but_its_yes_protects_nothing() {
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::Device }, Band { up_to: None, level: Level::Both { seconds: U64(3_600) } }];
    let mut k = AccountPolicy::new(U64(7 * DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    assert!(k.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 10);
    assert!(k.add_second_device(key(LAPTOP)).done);
    assert!(k.set_protection(bands).done, "in the first 24 hours, at once");
    let now = k.execute(acct("bob.near"), send(5 * NEAR), None);
    let later = k.execute(acct("bob.near"), send(50 * NEAR), None);
    as_key(LAPTOP, 11);
    assert!(k.approve(now.id.unwrap()).done, "a yes to what needs it runs");
    assert!(!k.approve(later.id.unwrap()).done);
    as_key(WORDS, 20);
    k.start_recovery(key(0x11));
    assert!(k.waiting_requests().is_empty(), "a young device's yes doesn't protect it from the words");
}

// ══ R5 (Medium, new) — the app doesn't name the phone at `new`, so v5 accounts are unsealed ══════════════════════════

#[cfg(feature = "modules")]
/// FIXED (R5): the app names the phone at `new` (6126b54), and `legacy_cancel_claim` now asks for a phone the account
/// knows. This account is made the old way (no `device_key`): the never-used phone's key is still on chain after the
/// recovery (the app removes unknown device keys after it, for accounts upgraded from v4), but it can't act at all.
#[test]
fn r5_unsealed_app_accounts_leave_a_never_used_phone_key_on_chain() {
    as_key(SETUP, 0);
    let mut q = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(q.set_recovery_key(key(WORDS)).done);
    as_key(0x44, 10); // the owner's real phone, used once to set up Legacy (and so learned)
    let cfg = legacy::LegacyConfig { heirs: vec![legacy::Heir { account_id: acct("mia.near"), share_pct: 100 }], quiet_seconds: U64(60), claim_delay_seconds: U64(600), tokens: vec![] };
    let l = q.legacy_setup(cfg);
    as_key(0x44, 200);
    q.run(l.id.unwrap());
    as_key(WORDS, 300);
    q.start_recovery(key(0x11));
    as_key(WORDS, 400);
    finish_ok(&mut q);
    let deleted = actions().iter().filter(|a| matches!(a, MockAction::DeleteKey { .. })).count();
    assert_eq!(deleted, 2, "only the learned keys (setup key, 0x44) are deleted; 0x33 stays on chain");
    as_key(PHONE, 401);
    assert!(fails(|| q.execute(acct("bob.near"), send(1), None)), "gated from owner methods");
    as_caller("mia.near", 401 + 60);
    q.legacy_start_claim();
    as_key(PHONE, 470);
    assert!(fails(|| q.legacy_cancel_claim()), "and from this one");
    assert!(q.legacy_status().unwrap().claim.is_some(), "the heir's claim stands");
    as_key(0x11, 471);
    q.legacy_cancel_claim();
    assert!(q.legacy_status().unwrap().claim.is_none(), "the new phone stops it");
}

// ══ R6 (Low, new) — three failed tries kill a standing order for every future date ═════════════════════════════════════

#[cfg(feature = "modules")]
/// FIXED (R6): tries are counted per date, and forgotten when that date's grace ends.
#[test]
fn r6_three_failures_on_one_date_kill_all_later_dates() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    let budget = agent_limits::Budget { coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(NEAR), per_month: U128(NEAR), convert_per_day: U128(0) }], recipients: vec![acct("landlord.near")], ends_at_ns: U64(365 * DAY * SECOND), max_spends_per_day: 12 };
    let rent = agent_limits::OrderPlan { payout: agent_limits::Payout::Ledger { token_id: USDC.into() }, to: acct("landlord.near"), amount: U128(400_000_000), dates_ns: vec![U64(10 * DAY * SECOND), U64(40 * DAY * SECOND), U64(70 * DAY * SECOND)], grace_seconds: U64(3 * DAY) };
    as_key(0x44, 10);
    let set = p.agent_set(key(5), budget, vec![rent]);
    as_key(0x44, 200);
    p.run(set.id.unwrap());
    // Rent day: the salary lands at noon. A stranger runs the order at 00:00, 01:00, 02:00 — three failures.
    let mut pid = 2;
    for h in 0..3u64 {
        let t = 10 * DAY + h * 3_601;
        as_caller("stranger.near", t);
        p.run_order(U64(1));
        callback(t + 1, near_sdk::PromiseResult::Failed);
        p.on_agent_settled(U64(pid), None);
        pid += 1;
    }
    // Noon the same day: that date has had its three tries.
    as_caller("landlord.near", 10 * DAY + 12 * 3_600);
    assert!(fails(|| p.run_order(U64(1))));
    // Next month, and the month after: their own tries.
    for t in [40 * DAY, 70 * DAY] {
        as_caller("landlord.near", t);
        p.run_order(U64(1));
        assert!(!get_created_receipts().is_empty(), "the date pays");
        callback(t + 1, near_sdk::PromiseResult::Successful(vec![]));
        p.on_agent_settled(U64(pid), None);
        pid += 1;
    }
    assert!(p.agent().unwrap().orders[0].slots.iter().take(3).skip(1).all(|s| matches!(s.state, agent_limits::SlotState::Paid)));
}

#[cfg(feature = "modules")]
/// R6, overlapping dates: a date that failed three times doesn't hold up the next one inside its grace.
#[test]
fn r6_a_failed_out_date_does_not_hold_up_the_next() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    let budget = agent_limits::Budget { coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(NEAR), per_month: U128(NEAR), convert_per_day: U128(0) }], recipients: vec![acct("landlord.near")], ends_at_ns: U64(365 * DAY * SECOND), max_spends_per_day: 12 };
    let weekly = agent_limits::OrderPlan { payout: agent_limits::Payout::Ledger { token_id: USDC.into() }, to: acct("landlord.near"), amount: U128(100_000_000), dates_ns: vec![U64(10 * DAY * SECOND), U64(17 * DAY * SECOND)], grace_seconds: U64(14 * DAY) };
    as_key(0x44, 10);
    let set = p.agent_set(key(5), budget, vec![weekly]);
    as_key(0x44, 200);
    p.run(set.id.unwrap());
    let mut pid = 2;
    for h in 0..3u64 {
        let t = 10 * DAY + h * 3_601;
        as_caller("stranger.near", t);
        p.run_order(U64(1));
        callback(t + 1, near_sdk::PromiseResult::Failed);
        p.on_agent_settled(U64(pid), None);
        pid += 1;
    }
    as_caller("landlord.near", 11 * DAY);
    assert!(fails(|| p.run_order(U64(1))), "the first date is out of tries, and the second isn't due yet");
    // Day 17: the first date is still inside its grace, out of tries; the second pays.
    as_caller("landlord.near", 17 * DAY);
    p.run_order(U64(1));
    callback(17 * DAY + 1, near_sdk::PromiseResult::Successful(vec![]));
    p.on_agent_settled(U64(pid), None);
    let slots = &p.agent().unwrap().orders[0].slots;
    assert!(matches!(slots[0].state, agent_limits::SlotState::Waiting) && matches!(slots[1].state, agent_limits::SlotState::Paid));
}

// ══ R7 (Low, new) — start_recovery accepts a key already in use; finishing deletes every phone and adds none ═══════════

/// FIXED (R7): a recovery to a key already on the account is refused at the start.
#[test]
fn r7_recovery_to_a_key_in_use_leaves_no_phone() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(WORDS, 2 * DAY);
    for k in [LAPTOP, PHONE, WORDS] {
        assert!(fails(|| p.start_recovery(key(k))), "{k:#x}");
    }
    assert!(p.pending().is_none());
    p.start_recovery(key(0x11));
    assert!(p.pending().is_some());
}

// ══ Closed findings: variants (must keep passing) ═════════════════════════════════════════════════════════════════════

#[test]
fn closed_f2_second_device_cannot_decline_wait_only_requests_or_any_second_device_removal() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 9 * DAY; // the laptop is of age (re-audit R4)
    as_key(PHONE, t);
    let b = p.add_second_device(key(0x0A)); // waits the floor
    as_key(LAPTOP, t + 1);
    p.approve(b.id.unwrap());
    as_key(PHONE, t + 8 * DAY + 2);
    p.run(b.id.unwrap());
    let rm = p.remove_key(key(0x0A));
    let pay = p.execute(acct("bob.near"), send(1_000 * NEAR), None);
    as_key(LAPTOP, t + 8 * DAY + 3);
    assert!(fails(|| p.decline(rm.id.unwrap())), "another second device's removal");
    // Release 10 (round 2, the laptop veto, decision A): a laptop of age turns down a wait-only payment the phone asked
    // alone (before: refused); the removal stays.
    p.decline(pay.id.unwrap());
    assert_eq!(p.waiting_requests().into_iter().map(|w| w.id).collect::<Vec<_>>(), vec![rm.id.unwrap()]);
}

#[test]
fn closed_f4_and_f17_allowances_are_capped_and_renewable_only_for_the_same_key() {
    let mut p = sealed_account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let caps: Vec<Option<NearToken>> = actions().into_iter().filter_map(|a| if let MockAction::AddKeyWithFunctionCall { allowance, .. } = a { Some(allowance) } else { None }).collect();
    assert_eq!(caps, vec![Some(NearToken::from_near(1))]);
    // Renewing is at once for the same key, but can't be used to slip in a new one.
    as_key(PHONE, 2 * DAY);
    assert!(p.add_second_device(key(LAPTOP)).id.is_none());
    assert!(!p.add_second_device(key(0x77)).done);
}

#[test]
fn closed_f5_allowlist_argument_names_and_receivers() {
    let p = sealed_account();
    let strict = Level::Wait { seconds: U64(DAY) };
    // Extra argument names on an allowlisted method are refused.
    for (r, m, a) in [
        ("wrap.near", "near_withdraw", r#"{"amount":"1","receiver_id":"thief.near"}"#),
        ("usdc.near", "storage_deposit", r#"{"account_id":"thief.near","registration_only":true,"amount":"1"}"#),
        ("pool.near", "withdraw", r#"{"amount":"1","beneficiary":"thief.near"}"#),
        ("pool.near", "unstake_all", r#"{"to":"thief.near"}"#),
        ("x.near", "withdraw", r#"["thief.near","1"]"#),
        ("x.near", "withdraw", "not json"),
        ("intents.near", "storage_deposit", r#"{"account_id":"thief.near"}"#),
        ("intents.testnet", "execute_intents", r#"{"signed":[]}"#),
        ("nft.near", "nft_approve", r#"{"token_id":"1","account_id":"thief.near"}"#),
        ("usdc.near", "storage_unregister", r#"{"force":true}"#),
    ] {
        assert_eq!(p.level_for(acct(r), call(m, a, 1), None), strict, "{r}.{m}({a})");
    }
    // Staking to any pool (a malicious one too) is measured as the NEAR sent.
    assert_eq!(p.level_for(acct("evil-pool.near"), call("deposit_and_stake", "", 300 * NEAR), None), strict);
    assert_eq!(p.level_for(acct("evil-pool.near"), call("deposit_and_stake", "", 10 * NEAR), None), Level::FaceId);
    // Info: the allowlist is by method name on ANY receiver: `withdraw {amount}` on an arbitrary contract is Face ID.
    assert_eq!(p.level_for(acct("anything.near"), call("withdraw", r#"{"amount":"999999"}"#, 0), None), Level::FaceId);
}

#[test]
fn closed_f6_one_budget_math() {
    as_key(SETUP, 0);
    let bands = |l: Vec<(&str, u128)>| vec![Band { up_to: Some(l.into_iter().map(|(c, a)| (c.to_string(), U128(a))).collect()), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(60) } }];
    // No gas on the coin's call here: from release 8 (RS-2) a call's gas counts as NEAR, which would tip these exact sums.
    let usdc = |n: u128| (USDC[7..].parse::<AccountId>().unwrap(), vec![Step::FunctionCall { method_name: "ft_transfer".into(), args: Base64VecU8(format!(r#"{{"receiver_id":"b.near","amount":"{n}"}}"#).into_bytes()), deposit: U128(0), gas: U64(0) }]);
    // Half and half fits exactly; a third of each of three coins (rounded up) does not.
    let p = AccountPolicy::new(U64(60), bands(vec![("near", 100), (USDC, 100)]), None, None);
    let g = vec![Group { receiver_id: acct("b.near"), steps: send(50) }, Group { receiver_id: usdc(50).0, steps: usdc(50).1 }];
    assert_eq!(p.level_for_many(g), Level::FaceId);
    let g = vec![Group { receiver_id: acct("b.near"), steps: send(51) }, Group { receiver_id: usdc(50).0, steps: usdc(50).1 }];
    assert_ne!(p.level_for_many(g), Level::FaceId);
    // A zero limit never fits; an unlisted coin never fits; the same coin listed twice counts twice (stricter).
    let z = AccountPolicy::new(U64(60), bands(vec![("near", 0), (USDC, 100)]), None, None);
    assert_ne!(z.level_for(acct("b.near"), send(1), None), Level::FaceId);
    assert_ne!(z.level_for(acct("intents.near"), call("mt_transfer", r#"{"receiver_id":"b.near","token_id":"nep141:wrap.near","amount":"1"}"#, 0), None), Level::FaceId);
    let d = AccountPolicy::new(U64(60), bands(vec![("near", 100), ("near", 100)]), None, None);
    assert_ne!(d.level_for(acct("b.near"), send(60), None), Level::FaceId);
    // Huge limits (the overflow branch) still compare correctly.
    let h = AccountPolicy::new(U64(60), bands(vec![("near", u128::MAX), (USDC, 100)]), None, None);
    assert_eq!(h.level_for(acct("b.near"), send(u128::MAX / 2), None), Level::FaceId);
    let g = vec![Group { receiver_id: acct("b.near"), steps: send(u128::MAX / 2 + u128::MAX / 4) }, Group { receiver_id: usdc(30).0, steps: usdc(30).1 }];
    assert_ne!(h.level_for_many(g), Level::FaceId);
}

#[cfg(feature = "modules")]
#[test]
fn closed_f8_order_paid_after_an_hour_never_pays_twice() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    let budget = agent_limits::Budget { coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(NEAR), per_month: U128(NEAR), convert_per_day: U128(0) }], recipients: vec![acct("landlord.near")], ends_at_ns: U64(365 * DAY * SECOND), max_spends_per_day: 12 };
    let rent = agent_limits::OrderPlan { payout: agent_limits::Payout::Near, to: acct("landlord.near"), amount: U128(NEAR), dates_ns: vec![U64(1_000 * SECOND)], grace_seconds: U64(10 * DAY) };
    as_key(0x44, 1);
    let set = p.agent_set(key(5), budget, vec![rent]);
    as_key(0x44, 200);
    p.run(set.id.unwrap());
    as_caller("x.near", 1_000);
    p.run_order(U64(1)); // payment id 2 sent; its settle is late
    as_caller("x.near", 1_000 + 3_601);
    p.run_order(U64(1)); // taken as paid
    assert!(matches!(p.agent().unwrap().orders[0].slots[0].state, agent_limits::SlotState::PaidUnconfirmed), "and said to be unconfirmed by the chain");
    // The late settle now says it FAILED: the date stays paid (money safe, landlord unpaid), and no one can pay again.
    callback(1_000 + 3_700, near_sdk::PromiseResult::Failed);
    p.on_agent_settled(U64(2), None);
    as_caller("x.near", 1_000 + 3 * 3_601);
    assert!(fails(|| p.run_order(U64(1))), "never sent twice");
}

#[cfg(feature = "modules")]
#[test]
fn closed_f16_forwarders_need_the_parent_except_a_deposit_to_ones_own_intents() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    assert!(p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(5 * NEAR)), (USDC.into(), U128(100_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }]).done);
    let usdc = &USDC[7..];
    let set = p.kids_set(kids::KidsRules { allowed: vec![acct(usdc), acct("intents.near"), acct("bob.near")], week: vec![] });
    as_key(LAPTOP, 11);
    assert!(p.approve(set.id.unwrap()).done);
    as_key(PHONE, 12);
    for msg in ["mallory.near", r#"{\"receiver_id\":\"me.near\"}"#, " ", "me.near "] {
        let a = format!(r#"{{"receiver_id":"intents.near","amount":"1","msg":"{msg}"}}"#);
        assert_eq!(p.level_for(acct(usdc), call("ft_transfer_call", &a, 1), None), Level::Device, "{msg}");
    }
    assert_eq!(p.level_for(acct("intents.near"), call("ft_withdraw", r#"{"token":"x.near","receiver_id":"bob.near","amount":"1","msg":"mallory.near"}"#, 1), None), Level::Device);
    assert_eq!(p.level_for(acct(usdc), call("ft_transfer_call", r#"{"receiver_id":"intents.near","amount":"1","msg":""}"#, 1), None), Level::FaceId);
}

#[cfg(feature = "modules")]
#[test]
fn closed_f11_heir_cannot_veto_inside_the_quiet_period() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 1);
    let l = p.legacy_setup(legacy::LegacyConfig { heirs: vec![legacy::Heir { account_id: acct("mia.near"), share_pct: 100 }], quiet_seconds: U64(180 * DAY), claim_delay_seconds: U64(30 * DAY), tokens: vec![] });
    as_key(PHONE, 200);
    p.run(l.id.unwrap());
    as_key(WORDS, 179 * DAY);
    p.start_recovery(key(0x11));
    as_caller("mia.near", 179 * DAY + 1);
    assert!(fails(|| p.legacy_cancel_recovery()));
}

// ══ Fuzz with the new rules ═════════════════════════════════════════════════════════════════════════════════════════

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

fn random_request(rng: &mut Rng) -> (Vec<Group>, Vec<(String, u128)>) {
    let mut gs = vec![];
    let mut total: Vec<(String, u128)> = vec![];
    let mut add = |c: &str, a: u128| match total.iter_mut().find(|(x, _)| x == c) {
        Some((_, t)) => *t += a,
        None => total.push((c.to_string(), a)),
    };
    for _ in 0..1 + rng.below(3) {
        let amount = (rng.below(8_000) as u128) * NEAR / 1_000;
        match rng.below(4) {
            0 => {
                gs.push(Group { receiver_id: acct("bob.near"), steps: send(amount) });
                add("near", amount);
            }
            1 => {
                let units = amount / 1_000_000_000_000_000_000;
                gs.push(Group { receiver_id: USDC[7..].parse().unwrap(), steps: call("ft_transfer", &format!(r#"{{"receiver_id":"bob.near","amount":"{units}"}}"#), 1) });
                add("near", 1);
                add(USDC, units);
            }
            2 => {
                gs.push(Group { receiver_id: acct("intents.near"), steps: call("mt_transfer", &format!(r#"{{"receiver_id":"bob.near","token_id":"{USDC}","amount":"{}"}}"#, amount / 1_000_000_000_000_000_000), 1) });
                add("near", 1);
                add(USDC, amount / 1_000_000_000_000_000_000);
            }
            _ => {
                gs.push(Group { receiver_id: acct("wrap.near"), steps: call("near_deposit", "", amount) });
                add("near", amount);
            }
        }
    }
    (gs, total)
}

/// Properties, with a second device on half the seeds, recoveries started/cancelled/finished, co-signing, time jumps:
/// P1 Face ID runs in any 24 h fit the Face ID band as ONE budget (Σ share ≤ 1, exact, floor-rounded);
/// P2 a set_protection placed outside the first 24 h never runs before placed + recovery delay + min(delay, 1 day);
/// P3 a request a second device hadn't approved when a recovery started never runs;
/// P4 `run` succeeds exactly when ready and (if needed) approved;
/// P5 with no second device of age, nothing runs at Face ID while a recovery waits or within a change's wait of the
///    phone cancelling one (re-audit R1).
#[test]
fn fuzz_new_rules_one_budget_floor_and_recovery_drop() {
    let face = vec![("near".to_string(), 10 * NEAR), (USDC.to_string(), 10_000_000u128)];
    let delay = DAY; // 1-day recovery: floor 2 days
    let mut stats = (0u64, 0u64, 0u64, 0u64);
    for seed in 1..=300u64 {
        // Each seed its own account: the mock keeps storage across testing_env!, so the side keys (freeze, ages,
        // approvers) would leak from one seed into the next (re-audit 2, info).
        let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut phone = PHONE;
        as_key(SETUP, 0);
        let mut p = AccountPolicy::new(U64(delay), vec![Band { up_to: Some(face.iter().map(|(c, a)| (c.clone(), U128(*a))).collect()), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(3_600) } }], Some(key(PHONE)), None);
        assert!(p.set_recovery_key(key(WORDS)).done);
        let mut laptop = seed % 2 == 0;
        let mut now = 2 * DAY;
        let mut freeze_until = 0u64;
        // The laptop's age, modelled apart from the contract (re-audit 2, N2): it counts from `laptop_from` (u64::MAX: its
        // clock is stopped); while young, a start stops it, a phone-only stop restarts it at the freeze's end, a finish now.
        let mut laptop_from = 10u64;
        let floor = 2 * delay;
        if laptop {
            as_key(PHONE, 10);
            assert!(p.add_second_device(key(LAPTOP)).done);
        }
        let mut face_runs: Vec<(u64, Vec<(String, u128)>)> = vec![];
        let mut placed: std::collections::HashMap<u64, (u64, bool)> = Default::default(); // id -> (placed_s, is_setting)
        let mut poisoned: std::collections::HashSet<u64> = Default::default();
        let mut next_phone = 0x60u8;
        // The Face ID band in force (None: Face ID unlimited), and what each waiting set_protection would set.
        let mut current: Option<Vec<(String, u128)>> = Some(face.clone());
        let mut sets: std::collections::HashMap<u64, Option<Vec<(String, u128)>>> = Default::default();
        for _ in 0..70 {
            if p.waiting_requests().len() >= 18 {
                as_key(phone, now);
                let w = p.waiting_requests()[0].id;
                p.cancel(w);
            }
            match rng.below(12) {
                0..=4 => {
                    let (groups, total) = random_request(&mut rng);
                    as_key(phone, now);
                    let out = if groups.len() == 1 { p.execute(groups[0].receiver_id.clone(), groups[0].steps.clone(), None) } else { p.execute_many(groups) };
                    // A waiting recovery freezes every account (audit A, A-1); a phone-only stop's freeze is set only with no
                    // second device of age.
                    let frozen = p.pending().is_some() || now < freeze_until;
                    assert!(!(out.done && frozen), "seed {seed}: P5, a Face ID run while frozen");
                    if out.done {
                        stats.0 += 1;
                        face_runs.push((now, total));
                        // P1: one budget, floor-rounded (the contract rounds up, so it is stricter still).
                        let mut used: u128 = 0;
                        for (c, limit) in current.iter().flatten() {
                            let sum: u128 = face_runs.iter().filter(|(t, _)| *t + DAY > now).flat_map(|(_, m)| m.iter()).filter(|(x, _)| x == c).map(|(_, a)| *a).sum();
                            used += sum * 1_000_000 / limit;
                        }
                        assert!(used <= 1_000_000, "seed {seed}: Face ID moved {used} ppm of its band in 24 h");
                    } else {
                        placed.insert(out.id.unwrap().0, (now, false));
                    }
                }
                5 => {
                    as_key(phone, now);
                    let loose = rng.below(2) == 0;
                    let bands = if loose { vec![Band { up_to: None, level: Level::FaceId }] } else { vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(7_200) } }] };
                    let out = p.set_protection(bands);
                    assert!(!out.done, "after the first day a change never runs at once");
                    placed.insert(out.id.unwrap().0, (now, true));
                    sets.insert(out.id.unwrap().0, if loose { None } else { Some(vec![("near".to_string(), NEAR)]) });
                }
                6 => {
                    if laptop {
                        if let Some(w) = p.waiting_requests().get(rng.below(20) as usize).cloned() {
                            as_key(LAPTOP, now);
                            let ok = !fails(|| p.approve(w.id));
                            if ok && !p.waiting_requests().iter().any(|x| x.id == w.id) {
                                stats.1 += 1;
                                if let Some(b) = sets.remove(&w.id.0) {
                                    current = b;
                                }
                                assert!(!poisoned.contains(&w.id.0), "seed {seed}: a request dropped by a recovery ran");
                                if let Some((t, s)) = placed.get(&w.id.0) {
                                    assert!(!*s || now >= t + 2 * delay, "seed {seed}: a setting ran before its floor");
                                }
                            }
                        }
                    }
                }
                7 => {
                    if let Some(w) = p.waiting_requests().get(rng.below(20) as usize).cloned() {
                        as_key(phone, now);
                        // While a recovery waits only a co-signed request (approved by the laptop while of age) or the phone's
                        // stop runs (re-audit 3, A-2).
                        let co_signed = w.approved && p.second_devices_of_age() > 0;
                        let ready = now * SECOND >= w.ready_at_ns.0 && (!w.needs_device || w.approved) && (p.pending().is_none() || co_signed || matches!(w.change, Change::CancelRecovery));
                        let ok = !fails(|| p.run(w.id));
                        assert_eq!(ok, ready, "seed {seed}: P4");
                        // A stop that waited out its day with no yes freezes as a phone-only one does (re-check 1, R-2).
                        if ok && matches!(w.change, Change::CancelRecovery) && !co_signed {
                            freeze_until = now + floor;
                            if laptop && now < laptop_from.saturating_add(floor) {
                                laptop_from = freeze_until;
                            }
                            assert_eq!(p.frozen_until().map(|u| u.0), Some(freeze_until * SECOND), "seed {seed}: R-2");
                        }
                        if ok {
                            stats.1 += 1;
                            if let Some(b) = sets.remove(&w.id.0) {
                                current = b;
                            }
                            assert!(!poisoned.contains(&w.id.0), "seed {seed}: P3");
                            if let Some((t, s)) = placed.get(&w.id.0) {
                                assert!(!*s || now >= t + 2 * delay, "seed {seed}: P2");
                            }
                        }
                    }
                }
                8 => {
                    // One draw in three: a recovery waiting holds back every request it doesn't co-sign (A-2), so starting
                    // one at every chance would leave too few held runs to check.
                    if p.pending().is_none() && rng.below(3) == 0 {
                        let before: Vec<(u64, bool)> = p.waiting_requests().iter().map(|w| (w.id.0, w.approved)).collect();
                        as_key(WORDS, now);
                        next_phone += 1;
                        p.start_recovery(key(next_phone));
                        stats.2 += 1;
                        if laptop && now < laptop_from.saturating_add(floor) {
                            laptop_from = u64::MAX;
                        }
                        for (id, approved) in before {
                            if !approved {
                                poisoned.insert(id);
                                assert!(!p.waiting_requests().iter().any(|w| w.id.0 == id), "seed {seed}: an unapproved request survived a recovery start");
                            }
                        }
                    }
                }
                9 => {
                    if p.pending().is_some() {
                        as_key(phone, now);
                        let aged = laptop && now >= laptop_from.saturating_add(floor);
                        if p.waiting_requests().iter().any(|w| matches!(w.change, Change::CancelRecovery)) {
                            assert!(fails(|| p.cancel_recovery()), "seed {seed}: one stop at a time");
                            continue;
                        }
                        // Re-audit 7 (R7-2): with a laptop of age, one stop per recovery; a second one (after the laptop refused the
                        // first) is refused, and the recovery goes on.
                        let out = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.cancel_recovery())) {
                            Ok(out) => out,
                            Err(e) => {
                                let msg = e.downcast_ref::<String>().cloned().unwrap_or_default();
                                assert!(aged && msg.contains("already asked one stop"), "seed {seed}: {msg}");
                                continue;
                            }
                        };
                        assert_eq!(out.done, !aged, "the phone alone cancels at once only without a second device of age");
                        if !aged {
                            freeze_until = now + floor;
                            if laptop {
                                laptop_from = freeze_until;
                            }
                        } else if rng.below(2) == 0 {
                            as_key(LAPTOP, now);
                            // Release 10 (round 2, G2): its yes to the stop counts only once it has been on the account for
                            // the fallback (as F1's yes to a recovery, below); before, it is refused and the stop waits.
                            if now >= laptop_from.saturating_add(7 * DAY) {
                                assert!(p.approve(out.id.unwrap()).done);
                                assert!(p.pending().is_none());
                            } else {
                                assert!(fails(|| p.approve(out.id.unwrap())), "seed {seed}: G2, a laptop not on for the fallback said yes to a stop");
                                assert!(p.pending().is_some());
                            }
                        }
                    }
                }
                10 => {
                    if let Some(r) = p.pending() {
                        if now * SECOND >= r.ready_at_ns.0 {
                            let before: Vec<(u64, bool)> = p.waiting_requests().iter().map(|w| (w.id.0, w.approved)).collect();
                            // Release 7: a laptop of age must say yes to this recovery first (a young one can't, and isn't asked).
                            // Release 10 (F1): its yes counts only once it has been on the account for the fallback;
                            // before then the words wait the fallback.
                            let st = p.recovery_status().unwrap();
                            if st.needs_device {
                                if now >= laptop_from.saturating_add(7 * DAY) {
                                    as_key(LAPTOP, now);
                                    p.approve_recovery(r.new_key.clone(), r.ready_at_ns);
                                } else if now * SECOND < st.fallback_at_ns.0 {
                                    continue;
                                }
                            }
                            as_key(WORDS, now);
                            finish_ok(&mut p);
                            freeze_until = 0;
                            // A second device still young when the move finishes leaves with the old phone (audit A-1).
                            if laptop && now < laptop_from.saturating_add(floor) {
                                laptop = false;
                                assert_eq!(p.second_devices_of_age(), 0, "seed {seed}: a young laptop outlived the move");
                            }
                            stats.3 += 1;
                            for (id, approved) in before {
                                if !approved {
                                    poisoned.insert(id);
                                }
                            }
                            let old = phone;
                            phone = r.new_key.0[1];
                            as_key(old, now);
                            assert!(fails(|| p.execute(acct("bob.near"), send(1), None)), "seed {seed}: the old phone still acts");
                        }
                    }
                }
                _ => {
                    now += match rng.below(4) {
                        0 => 1 + rng.below(3_600),
                        1 => DAY - 1 + rng.below(3),
                        2 => 2 * DAY - 1 + rng.below(3),
                        _ => rng.below(3 * DAY),
                    };
                }
            }
        }
    }
    eprintln!("REAUDIT-FUZZ coverage (face_id_runs, held_runs, recoveries_started, recoveries_finished) = {stats:?}");
    assert!(stats.0 > 300 && stats.1 > 100 && stats.2 > 100 && stats.3 > 10, "coverage {stats:?}");
}
