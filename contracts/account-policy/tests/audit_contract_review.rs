//! Independent audit, the contract review (28 Oct), of the release build of the account contract at 9fb4fe7 (release 6, no
//! `modules`; pinned wasm sha256 289753a9…2127). Report: an internal review.
//!
//! Convention (METHOD.md 5): every `fb*_` test is a finding's proof of concept: it asserts the guarantee, so it FAILS at
//! 9fb4fe7 and passes once the finding is fixed. Every `p_*` test is a property the model claims and that holds today
//! (it must pass); `seq_*` runs random sequences of actor calls against the invariants.
mod common;
use common::{finish_ok, finish_with};
use account_policy::{moves, AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/// Mainnet defaults (demo-core.ts): a 7-day recovery delay, so a change's wait (the floor) is 8 days.
const DELAY: u64 = 7 * DAY;
const FLOOR: u64 = 8 * DAY;
/// The words-only fallback (3 times the delay): a second device's yes to a recovery counts only once it has been on the
/// account this long (release 10, F1).
const FALLBACK: u64 = 21 * DAY;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const LAPTOP2: u8 = 0x0A;
const NEW_PHONE: u8 = 0x11;
const THIEF_WORDS: u8 = 0xBB;

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

fn call(method: &str, args: &str, deposit: u128, gas: u64) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(gas) }
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

fn actions() -> Vec<MockAction> {
    get_created_receipts().into_iter().flat_map(|r| r.actions).collect()
}

/// The app's DEFAULT_PROTECTION at $2.50 a NEAR: Face ID up to $500 a day, then a 24-hour wait.
fn default_bands() -> Vec<Band> {
    vec![Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }]
}

/// "Ask my laptop above $5,000".
fn laptop_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: Some(vec![("near".into(), U128(2_000 * NEAR)), (USDC.into(), U128(5_000_000_000))]), level: Level::Wait { seconds: U64(DAY) } },
        Band { up_to: None, level: Level::Both { seconds: U64(DAY) } },
    ]
}

/// The setup batch as demo-core.ts sends it, at t=0: `new` names the phone, the words go in at Face ID.
fn mainnet_account(delay_s: u64) -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(delay_s), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// An account with a laptop that has come of age: added on day 0 (at once, in the setup window), of age at FLOOR.
fn account_with_aged_laptop(now_s: u64) -> AccountPolicy {
    let mut p = mainnet_account(DELAY);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done, "the first second device in the setup window goes at once");
    // A setup step in the first 24 hours skips the floor but still waits the strictest band (a day).
    let rules = p.set_protection(laptop_bands());
    assert!(!rules.done);
    as_key(PHONE, 10 + DAY);
    assert!(p.run(rules.id.unwrap()).done);
    assert!(now_s >= 10 + FLOOR);
    as_key(PHONE, now_s);
    assert_eq!(p.second_devices_of_age(), 1);
    p
}

// ── Findings (proofs of concept; each FAILS at 9fb4fe7) ──────────────────────────────────────────────────────────

/// FB-1 (Low). Network fees are not an amount: a zero-value call that the allowlist accepts (`near_deposit`, no
/// arguments) can carry 300 Tgas to ANY contract and runs at Face ID. A stolen, unlocked phone burns ~0.03 NEAR of the
/// account's balance per transaction with no band, no wait and no second device, until the account can't pay for its
/// own keys' transactions. Guarantee: "protection by amount" / "a stolen, unlocked phone can't skip it".
///
/// FIXED (Security, the review's H-1): the gas a call carries counts as NEAR at twice NEAR's lowest gas price, so such
/// calls spend the Face ID budget like any payment, and with the 128-a-day cap (A-3) a day of them is bounded. (The
/// review's original assertion, that one such call isn't Face ID, isn't what counting gives: one 0.06 NEAR call fits a
/// 200 NEAR band, as any small payment does.)
#[test]
fn fb1_gas_is_not_measured_a_zero_value_call_with_300_tgas_runs_at_face_id() {
    let mut p = mainnet_account(DELAY);
    as_key(PHONE, 100);
    // Release 8 (RS-1): a single execute carries at most 250 Tgas in all, so the most a call can carry is 250 Tgas.
    assert!(fails(|| p.execute(acct("burn.attacker.near"), vec![call("near_deposit", "", 0, 300_000_000_000_000)], None)));
    let burn = vec![call("near_deposit", "", 0, 250_000_000_000_000)];
    assert!(p.execute(acct("burn.attacker.near"), burn.clone(), None).done);
    let counted = |p: &AccountPolicy| p.spent_today().iter().find(|(c, _)| c == "near").map(|(_, a)| a.0);
    assert_eq!(counted(&p), Some(250_000_000_000_000 * 1_000_000_000), "250 Tgas counts as 0.25 NEAR (release 9: 10 times the lowest gas price)");
    for i in 1..128u64 {
        as_key(PHONE, 100 + i);
        assert!(p.execute(acct("burn.attacker.near"), burn.clone(), None).done);
    }
    as_key(PHONE, 300);
    assert!(fails(|| p.execute(acct("burn.attacker.near"), burn.clone(), None)), "the 129th in 24 hours is refused: a day's burn is bounded");
}

/// FB-2 (Low). A yes from a second device NOT yet of age overwrites the record of a yes from one that IS of age, so a
/// request the owner's phone and aged laptop asked for together stops counting as co-signed, and the next recovery start
/// drops it (and `run` refuses it while one waits). The header: "a yes given while a device was young never counts as
/// co-signed" — it should not UN-count an aged one either.
#[test]
fn fb2_a_young_devices_later_yes_removes_an_aged_devices_co_sign() {
    let mut p = account_with_aged_laptop(10 + FLOOR);
    // A second laptop, added later: young for a floor.
    let add = p.add_second_device(key(LAPTOP2));
    assert!(!add.done && add.needs_device);
    as_key(LAPTOP, 10 + FLOOR + 1);
    assert!(!p.approve(add.id.unwrap()).done, "approved, still waiting its floor");
    as_key(PHONE, 10 + 2 * FLOOR + 10);
    assert!(p.run(add.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 2);
    assert_eq!(p.second_devices_of_age(), 1);
    // The owner asks for new protection; the aged laptop co-signs it (two of three), then the young one also says yes.
    let t = 10 + 2 * FLOOR + 20;
    as_key(PHONE, t);
    let change = p.set_protection(default_bands());
    assert!(!change.done);
    let id = change.id.unwrap();
    as_key(LAPTOP, t + 1);
    assert!(!p.approve(id).done);
    as_key(LAPTOP2, t + 2);
    assert!(fails(|| p.approve(id)) || !p.approve(id).done, "a young device's yes to a setting is refused or kept as a plain yes");
    // Leaked words start a recovery: what the phone and the aged laptop asked together must survive (two of three).
    as_key(WORDS, t + 3);
    p.start_recovery(key(THIEF_WORDS));
    assert!(p.waiting_requests().iter().any(|w| w.id == id), "the aged laptop's co-sign was overwritten by the young laptop's yes, so the words dropped it");
}

/// FB-3 (Low). A finished recovery adds the new phone's key and deletes the old ones in SEPARATE receipts, and so does a
/// change of backup words. The contract's state (sealed to the new key; the new words) is final before any of them runs.
/// If the add fails on its own (the account can't pay the ~2 KB key's storage, or the key exists), the account has no
/// phone key on chain while its state says it has one: one more recovery (7 days) or the old words' next change is the
/// only way out. One batch for the adds and the deletes makes them succeed or fail together.
///
/// Release 9 (the blind re-score's R8-RS1; ignored from release 6 to 8): fixed by a callback instead of one batch (one
/// batch can't hold the deletes: the setup key on the device list is no longer on NEAR, so its delete would fail the
/// whole batch). `finish_recovery` makes the add alone; the deletes come only from `on_recovery_key`, once it has seen
/// the add succeed. A failed add deletes nothing, changes nothing, and the words finish again later.
#[test]
fn fb3_finish_recovery_adds_and_deletes_keys_in_separate_receipts() {
    fb3_body();
}

/// Round 4c (G4-1): `on_recovery_key`'s success branch needs about 30.8 Tgas at the largest state (about 209 KB, measured
/// on near-sandbox 2.13.4); the finish reserves it at least 10 Tgas more (45 Tgas, static, plus a share of what is left).
#[test]
fn g4_1_the_recovery_callback_reserves_the_max_state_need_and_10_tgas() {
    const MAX_STATE_NEED: u64 = 30_800_000_000_000;
    const MARGIN: u64 = 10_000_000_000_000;
    let mut p = mainnet_account(DELAY);
    as_key(WORDS, 100);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, 100 + DELAY);
    let _ = get_created_receipts();
    let made: Vec<MockAction> = finish_with(&mut p, near_sdk::PromiseResult::Successful(vec![])).into_iter().flat_map(|r| r.actions).collect();
    let reserved: Vec<u64> = made.iter().filter_map(|a| match a {
        MockAction::FunctionCallWeight { method_name, prepaid_gas, .. } if method_name == b"on_recovery_key" => Some(prepaid_gas.as_gas()),
        _ => None,
    }).collect();
    assert_eq!(reserved.len(), 1, "{made:?}");
    assert!(reserved[0] >= MAX_STATE_NEED + MARGIN, "on_recovery_key reserves {} Tgas, needs {} + 10", reserved[0] / 1_000_000_000_000, MAX_STATE_NEED as f64 / 1e12);
}

fn fb3_body() {
    let mut p = mainnet_account(DELAY);
    as_key(WORDS, 100);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, 100 + DELAY);
    let _ = get_created_receipts();
    // The add fails (the storage edge): the callback deletes nothing and the recovery still waits.
    let made: Vec<MockAction> = finish_with(&mut p, near_sdk::PromiseResult::Failed).into_iter().flat_map(|r| r.actions).collect();
    let count = |acts: &[MockAction], add: bool| acts.iter().filter(|a| if add { matches!(a, MockAction::AddKeyWithFunctionCall { .. }) } else { matches!(a, MockAction::DeleteKey { .. }) }).count();
    assert_eq!((count(&made, true), count(&made, false)), (1, 1), "the finish itself adds the new phone's key and deletes only a copy of that key (re-freeze 2), never an old one");
    assert!(made.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_recovery_key")), "and its callback follows the add");
    assert_eq!(count(&actions(), false), 0, "a failed add: no key is deleted");
    assert!(p.pending().is_some(), "a failed add: the recovery still waits");
    // The old phone still acts (spending waits, as during any recovery), so the account is never left without a phone.
    as_key(PHONE, 101 + DELAY);
    assert!(!p.execute(acct("bob.near"), send(1), None).done);
    // After a top-up the words finish again; now the add succeeds and only then are the old keys deleted.
    as_key(WORDS, 200 + DELAY);
    let made: Vec<MockAction> = finish_ok(&mut p).into_iter().flat_map(|r| r.actions).collect();
    assert_eq!((count(&made, true), count(&made, false)), (1, 1));
    assert_eq!(count(&actions(), false), 2, "the callback deletes the old phone and the setup key");
    assert!(p.pending().is_none());
}

/// FB-4 (Low). Removing the last second device rewrites every band that needed it to a wait of at least the floor. With
/// the longest allowed delay (30 days) the floor is 31 days, more than the 30-day most a band may wait: the account then
/// holds protection `set_protection` itself refuses, and the person can't set the same rules back.
#[test]
fn fb4_removing_the_last_device_can_leave_a_band_no_one_may_set() {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(30 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let rules = p.set_protection(laptop_bands());
    assert!(!rules.done, "waits the strictest band's day (setup window: no floor)");
    as_key(PHONE, 10 + DAY);
    assert!(p.run(rules.id.unwrap()).done);
    let remove = p.remove_key(key(LAPTOP));
    assert!(!remove.done);
    as_key(PHONE, 10 + DAY + 61 * DAY + 1);
    assert!(p.run(remove.id.unwrap()).done);
    let bands = p.protection();
    let last = &bands[bands.len() - 1].level;
    assert!(matches!(last, Level::Wait { .. }));
    // The rules the account now holds must be rules it accepts.
    assert!(!fails(|| p.set_protection(bands.clone())), "the account holds a band ({last:?}) that set_protection refuses (a wait can be at most 30 days)");
}

// ── Properties that hold at 9fb4fe7 (my model's claims, each must pass) ─────────────────────────────────────────

/// P1: the setup batch as the app sends it leaves the phone sealed and the words in, with exactly their method lists.
#[test]
fn p1_setup_batch_keys_and_method_lists() {
    let _ = mainnet_account(DELAY);
    let adds: Vec<String> = actions().into_iter().filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })).map(|a| format!("{a:?}")).collect();
    // `new` adds no key itself (the batch does); set_recovery_key adds the words' key with its two methods and a 0.25 NEAR cap.
    assert_eq!(adds.len(), 1, "{adds:?}");
    assert!(adds[0].contains("start_recovery") && adds[0].contains("finish_recovery") && !adds[0].contains("execute") && adds[0].contains("250000000000000000000000"), "{}", adds[0]);
}

/// P2: the phone can't act as the second device or the words inside the contract's own checks — every role check is
/// NEAR's method list on the key, so the contract must never hand a key a longer list than its role.
#[test]
fn p2_every_key_the_contract_adds_has_its_roles_methods_only() {
    let mut p = account_with_aged_laptop(10 + FALLBACK);
    let _ = get_created_receipts();
    // A new phone by recovery.
    as_key(WORDS, 10 + FALLBACK + 1);
    p.start_recovery(key(NEW_PHONE));
    as_key(LAPTOP, 10 + FALLBACK + 2);
    p.approve_recovery(key(NEW_PHONE), U64((10 + FALLBACK + 1 + DELAY) * SECOND));
    as_key(WORDS, 10 + FALLBACK + 1 + DELAY);
    let made = finish_ok(&mut p);
    let lists: Vec<String> = made.into_iter().flat_map(|r| r.actions).filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })).map(|a| format!("{a:?}")).collect();
    assert_eq!(lists.len(), 1, "{lists:?}");
    let a = &lists[0];
    for m in ["execute", "execute_many", "run", "cancel", "set_protection", "add_second_device", "remove_key", "set_recovery_key", "cancel_recovery", "upgrade"] {
        assert!(a.contains(&format!("\"{m}\"")) || a.contains(m), "{a}");
    }
    assert!(a.contains("allowance: None"), "the phone's key has no fee cap: {a}");
    assert!(!a.contains("approve") && !a.contains("start_recovery") && !a.contains("upgrade_check") && !a.contains("on_group_done"), "{a}");
}

/// P3: nothing the phone asks alone ever runs while a recovery waits: spends, settings, an upgrade, and a stop with an
/// aged laptop that didn't say yes; and every one of them is gone once the recovery ends either way.
#[test]
fn p3_while_a_recovery_waits_the_phone_alone_runs_nothing() {
    for finish in [true, false] {
        let mut p = account_with_aged_laptop(10 + FALLBACK);
        let t0 = 10 + FALLBACK + 5; // release 10 (F1): its laptop on the account for the fallback
        as_key(WORDS, t0);
        p.start_recovery(key(NEW_PHONE));
        as_key(PHONE, t0 + 1);
        let small = p.execute(acct("bob.near"), send(NEAR), None);
        assert!(!small.done, "even $2.50 waits while a recovery waits");
        assert_eq!(small.ready_at_ns, Some(U64((t0 + 1 + FLOOR) * SECOND)));
        let big = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
        let change = p.set_protection(default_bands());
        let up = p.upgrade(Base64VecU8(vec![7u8; 32]));
        let stop = p.cancel_recovery();
        assert!(!stop.done);
        // Far later than any wait, the recovery still open (nobody finished or stopped it): nothing runs.
        as_key(PHONE, t0 + 40 * DAY);
        for id in [small.id, big.id, change.id, up.id] {
            assert!(fails(|| p.run(id.unwrap())), "ran {id:?} while a recovery waited");
        }
        assert!(p.run(stop.id.unwrap()).done, "the phone's stop waited out its day: it runs, and freezes spending");
        assert!(p.pending().is_none());
        assert!(p.waiting_requests().is_empty(), "a stop drops what the phone asked alone");
        assert!(p.frozen_until().is_some());
        if finish {
            // The other ending: a finish.
            let mut p = account_with_aged_laptop(10 + FALLBACK);
            as_key(WORDS, t0);
            p.start_recovery(key(NEW_PHONE));
            as_key(PHONE, t0 + 1);
            let _ = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
            let _ = p.set_protection(default_bands());
            as_key(LAPTOP, t0 + 2);
            p.approve_recovery(key(NEW_PHONE), U64((t0 + DELAY) * SECOND));
            as_key(WORDS, t0 + DELAY);
            finish_ok(&mut p);
            assert!(p.waiting_requests().is_empty());
            assert!(fails(|| {
                as_key(PHONE, t0 + DELAY + 1);
                p.execute(acct("bob.near"), send(NEAR), None)
            }), "the old phone was replaced");
        }
    }
}

/// P4: a 24-hour total can't be dodged by splitting, by chains, by mixing coins in a band, or by a request that waits.
#[test]
fn p4_the_24_hour_total_is_one_budget_across_coins_and_chains() {
    let p = mainnet_account(DELAY);
    as_key(PHONE, 100);
    let mut p = p;
    assert!(p.execute(acct("bob.near"), send(100 * NEAR), None).done, "$250 of $500");
    // (A real ft_transfer attaches 1 yocto, which counts as NEAR and, rounded up, tips an exactly-full budget: by design.
    // So does its gas from release 8 (RS-2): this one carries none, so the budget is exactly whole.)
    let usdc = call("ft_transfer", r#"{"receiver_id":"bob.near","amount":"250000000"}"#, 0, 0);
    assert!(p.execute(acct("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), vec![usdc.clone()], None).done, "another $250: exactly the whole");
    assert!(!p.execute(acct("bob.near"), send(1), None).done, "one yocto more waits");
    // A chain: measured as one, its coins added up.
    let chain = p.execute_many(vec![Group { receiver_id: acct("bob.near"), steps: send(1) }, Group { receiver_id: acct("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), steps: vec![usdc] }]);
    assert!(!chain.done);
    // Tomorrow, the two that ran no longer count, but the two that wait do.
    as_key(PHONE, 100 + DAY + 1);
    assert_eq!(p.spent_today().iter().find(|(c, _)| c == "near").map(|(_, a)| a.0), Some(2));
    // The waiting chain's 250 USDC is half the band's budget, so 99 NEAR (plus the waiting yoctos) still fits and 100 doesn't.
    assert_eq!(p.level_for(acct("bob.near"), send(99 * NEAR), None), Level::FaceId);
    assert_ne!(p.level_for(acct("bob.near"), send(100 * NEAR), None), Level::FaceId, "the waiting ones still count");
}

/// P5: what can't be measured takes the strictest band: Intents by another name, an unknown method, a standard method
/// with a number instead of a string, a batch with mismatched lists, storage_unregister, and an allowlisted method
/// with an extra argument.
#[test]
fn p5_unmeasurable_requests_take_the_strictest_band() {
    let p = mainnet_account(DELAY);
    as_key(PHONE, 100);
    let strictest = Level::Wait { seconds: U64(DAY) };
    let cases: Vec<(&str, Step)> = vec![
        ("intents.near", call("mt_transfer", r#"{"receiver_id":"bob.near","token_id":"nep141:x","amount":1}"#, 0, 1)),
        ("intents.near", call("mt_batch_transfer", r#"{"receiver_id":"bob.near","token_ids":["a","b"],"amounts":["1"]}"#, 0, 1)),
        ("intents.near", call("native_withdraw", r#"{"receiver_id":"bob.near","amount":"1"}"#, 0, 1)),
        ("intents.near", call("storage_deposit", "", 0, 1)),
        ("usdc.near", call("storage_unregister", r#"{"force":true}"#, 1, 1)),
        ("usdc.near", call("ft_transfer", r#"{"receiver_id":"bob.near","amount":1}"#, 1, 1)),
        ("wrap.near", call("near_withdraw", r#"{"amount":"1","receiver_id":"bob.near"}"#, 0, 1)),
        ("wrap.near", call("near_withdraw", "[1]", 0, 1)),
        ("pool.near", call("withdraw", r#"{"amount":"1","token_id":"usdc.near"}"#, 0, 1)),
        ("me2.near", call("add_public_key", "", 0, 1)),
    ];
    for (receiver, step) in cases {
        if receiver == "me2.near" {
            // Release 10 (round 2, M-I1): execute refuses this method ("never calls"), and so does its preview now.
            let preview = refused_with_msg(|| p.level_for(acct(receiver), vec![step.clone()], None));
            assert!(preview.contains("never calls that method"), "{preview:?}");
            assert!(fails(|| moves(receiver, &[step.clone()])) || preview.contains("never calls that method"));
            continue;
        }
        assert_eq!(moves(receiver, &[step.clone()]), None, "{receiver} {step:?}");
        assert_eq!(p.level_for(acct(receiver), vec![step], None), strictest);
    }
}

/// P6: the floor beats the delay for every allowed delay: a change the phone asks alone is never ready before a recovery
/// started one block later can finish, and the phone's stop of a recovery is always ready before the recovery is.
#[test]
fn p6_floor_beats_delay_and_stop_beats_finish_for_every_delay() {
    for delay in [60u64, 61, 3_600, DAY - 1, DAY, DAY + 1, 7 * DAY, 30 * DAY] {
        reset();
        as_key(SETUP, 0);
        let mut p = AccountPolicy::new(U64(delay), default_bands(), Some(key(PHONE)), None);
        assert!(p.set_recovery_key(key(WORDS)).done);
        as_key(PHONE, DAY + 1); // after the setup window
        let change = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
        assert!(!change.done);
        let ready = change.ready_at_ns.unwrap().0;
        assert!(ready > (DAY + 2 + delay) * SECOND, "delay {delay}: a change is ready at {ready} before a recovery started a second later could finish");
        // A phone-only stop (no aged device) is at once; with an aged laptop it waits at most half the delay.
        as_key(WORDS, DAY + 2);
        p.start_recovery(key(NEW_PHONE));
        as_key(PHONE, DAY + 3);
        assert!(p.cancel_recovery().done);
        assert_eq!(p.frozen_until(), Some(U64((DAY + 3 + delay + delay.min(DAY)) * SECOND)));
    }
}

/// P7: no path lets the account call its own methods through a spend, and no step may name NEAR Intents' key methods.
#[test]
fn p7_a_spend_never_targets_this_account_or_intents_key_methods() {
    let mut p = mainnet_account(DELAY);
    as_key(PHONE, 100);
    assert!(fails(|| p.execute(me(), vec![call("set_protection", "{}", 0, 1)], None)));
    assert!(fails(|| p.execute_many(vec![Group { receiver_id: acct("bob.near"), steps: send(1) }, Group { receiver_id: me(), steps: vec![call("upgrade_check", "{}", 0, 1)] }])));
    for m in ["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"] {
        assert!(fails(|| p.execute(acct("intents.near"), vec![call(m, "{}", 0, 1)], None)), "{m}");
    }
    assert!(p.waiting_requests().is_empty() && p.spent_today().is_empty());
}

/// P8: a device key that never called, on an account `new` sealed, can never act; and the setup key, though on the
/// sealed list, is removed by a finished recovery.
#[test]
fn p8_sealed_list_refuses_a_stranger_and_recovery_drops_the_setup_key() {
    let mut p = mainnet_account(DELAY);
    as_key(0x77, 100);
    assert!(fails(|| p.execute(acct("bob.near"), send(1), None)), "a key the account never named can't act as the phone");
    assert!(fails(|| p.set_protection(default_bands())));
    // The setup key is on the list: it was deleted by the batch, but if a setup had left it, it could act until a recovery.
    as_key(SETUP, 101);
    assert!(p.execute(acct("bob.near"), send(1), None).done, "the setup key acts as the phone (the batch deletes it on chain)");
    as_key(WORDS, 200);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, 200 + DELAY);
    finish_ok(&mut p);
    as_key(SETUP, 201 + DELAY);
    assert!(fails(|| p.execute(acct("bob.near"), send(1), None)));
    as_key(PHONE, 201 + DELAY);
    assert!(fails(|| p.execute(acct("bob.near"), send(1), None)));
    as_key(NEW_PHONE, 201 + DELAY);
    assert!(p.execute(acct("bob.near"), send(1), None).done);
}

/// P9: a lost laptop can never lock the owner out: its removal needs no laptop, and once the last one is gone every band
/// that needed one becomes a wait of at least the floor; the words can still replace the phone.
#[test]
fn p9_lost_laptop_never_locks_the_owner_out() {
    let mut p = account_with_aged_laptop(10 + FLOOR);
    let t = 10 + FLOOR;
    let big = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
    assert!(!big.done && big.needs_device);
    let remove = p.remove_key(key(LAPTOP));
    assert!(!remove.done && !remove.needs_device, "removing the laptop never needs the laptop");
    as_key(LAPTOP, t + 1);
    assert!(fails(|| p.decline(remove.id.unwrap())), "the laptop can't refuse its own removal");
    // Re-audit 7 (R7-1): a laptop of age's removal waits the fallback (21 days here), not the floor.
    assert_eq!(remove.ready_at_ns.unwrap().0, (t + 21 * DAY) * SECOND);
    as_key(PHONE, t + 21 * DAY);
    assert!(p.run(remove.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
    assert!(p.protection().iter().all(|b| !matches!(b.level, Level::Device | Level::Both { .. })));
    // Release 10 (C1; round 2, E1): the old request no longer needs the device; it waits a change's wait from its ask,
    // long past here, so it could run now. The owner may still cancel it.
    let w = p.waiting_requests().into_iter().find(|w| w.id == big.id.unwrap()).unwrap();
    assert!(!w.needs_device && w.ready_at_ns.0 == (t + FLOOR) * SECOND, "{w:?}");
    p.cancel(big.id.unwrap());
    let again = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
    assert!(!again.done && !again.needs_device);
}

/// P10: a recovery's new key can't be taken by any other role meanwhile, and the finish removes every young device.
#[test]
fn p10_new_key_is_reserved_and_young_devices_leave_at_finish() {
    let mut p = account_with_aged_laptop(10 + FALLBACK);
    let t = 10 + FALLBACK; // release 10 (F1): its laptop on the account for the fallback
    let add = p.add_second_device(key(LAPTOP2));
    as_key(LAPTOP, t + 1);
    assert!(!p.approve(add.id.unwrap()).done);
    as_key(PHONE, t + FLOOR + 1);
    assert!(p.run(add.id.unwrap()).done);
    as_key(WORDS, t + FLOOR + 2);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + FLOOR + 3);
    assert!(fails(|| p.add_second_device(key(NEW_PHONE))));
    assert!(fails(|| p.set_recovery_key(key(NEW_PHONE))));
    as_key(LAPTOP, t + FLOOR + 4);
    p.approve_recovery(key(NEW_PHONE), U64((t + FLOOR + 2 + DELAY) * SECOND));
    as_key(WORDS, t + FLOOR + 2 + DELAY);
    finish_ok(&mut p);
    assert_eq!(p.second_device_count(), 1, "the young second laptop left with the old phone");
    assert_eq!(p.second_devices_of_age(), 1);
}

// ── Random sequences against the invariants ───────────────────────────────────────────────────────────────────

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn pick(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// Invariants every reachable state keeps, whoever calls what in whatever order:
/// I1 bounded lists; I2 unique ids; I3 while a recovery waits, no unapproved spend runs and no spend is Face ID;
/// I4 a recovery start leaves only approved requests; I5 never more than 4 second devices; I6 every view loads;
/// I7 after a finish no young device remains and the old phone can't act; I8 the floor is never shorter than the delay.
#[test]
fn seq_random_actor_sequences_keep_the_invariants() {
    for seed in 1..=40u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        let delay = [60u64, 3_600, DELAY][rng.pick(3) as usize];
        reset();
        as_key(SETUP, 0);
        let mut p = AccountPolicy::new(U64(delay), default_bands(), Some(key(PHONE)), None);
        assert!(p.set_recovery_key(key(WORDS)).done);
        let mut now = 1u64;
        let mut phone = PHONE;
        let mut new_phone_n = 0u8;
        let laptops = [LAPTOP, LAPTOP2];
        for _step in 0..80 {
            now += [1u64, 60, 3_600, DAY, delay, delay * 2 + DAY][rng.pick(6) as usize];
            let recovering = p.pending().is_some();
            let waiting = p.waiting_requests();
            let pick_id = |rng: &mut Rng| waiting.get(rng.pick(waiting.len().max(1) as u64) as usize).map(|w| w.id);
            match rng.pick(14) {
                0 | 1 => {
                    as_key(phone, now);
                    let amount = [NEAR, 150 * NEAR, 300 * NEAR, 3_000 * NEAR][rng.pick(4) as usize];
                    // Release 10 (round 2): the preview may refuse (a laptop's dispute, M-I1); a refusal is never Face ID.
                    let level = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.level_for(acct("bob.near"), send(amount), None))).ok();
                    if recovering || p.frozen_until().is_some() {
                        assert_ne!(level, Some(Level::FaceId), "I3: Face ID while a recovery waits or spending is frozen");
                    }
                    let _ = fails(|| p.execute(acct("bob.near"), send(amount), None));
                }
                2 => {
                    as_key(phone, now);
                    if let Some(id) = pick_id(&mut rng) {
                        let before = waiting.iter().find(|w| w.id == id).cloned().unwrap();
                        let ran = !fails(|| p.run(id));
                        if ran && recovering {
                            assert!(before.approved || matches!(before.change, account_policy::Change::CancelRecovery), "I3: ran an unapproved request while a recovery waited");
                        }
                    }
                }
                3 => {
                    as_key(phone, now);
                    if let Some(id) = pick_id(&mut rng) {
                        let _ = fails(|| p.cancel(id));
                    }
                }
                4 => {
                    as_key(phone, now);
                    let choices = [default_bands(), laptop_bands(), vec![Band { up_to: None, level: Level::FaceId }]];
                    let bands = choices[rng.pick(3) as usize].clone();
                    let _ = fails(|| p.set_protection(bands));
                }
                5 => {
                    as_key(phone, now);
                    let _ = fails(|| p.add_second_device(key(laptops[rng.pick(2) as usize])));
                }
                6 => {
                    as_key(phone, now);
                    let _ = fails(|| p.remove_key(key(laptops[rng.pick(2) as usize])));
                }
                7 => {
                    as_key(phone, now);
                    let _ = fails(|| p.cancel_recovery());
                }
                8 => {
                    as_key(phone, now);
                    let _ = fails(|| p.upgrade(Base64VecU8(vec![1u8; 32])));
                }
                9 | 10 => {
                    as_key(laptops[rng.pick(2) as usize], now);
                    if let Some(id) = pick_id(&mut rng) {
                        if rng.pick(2) == 0 {
                            let _ = fails(|| p.approve(id));
                        } else {
                            let _ = fails(|| p.decline(id));
                        }
                    }
                }
                11 => {
                    as_key(WORDS, now);
                    let before = p.waiting_requests();
                    if !fails(|| p.start_recovery(key(0xA0 + new_phone_n))) {
                        let after = p.waiting_requests();
                        assert!(after.iter().all(|w| w.approved), "I4: an unapproved request survived a recovery start");
                        assert!(after.len() <= before.len());
                    }
                }
                12 => {
                    as_key(WORDS, now);
                    if !fails(|| finish_ok(&mut p)) {
                        assert_eq!(p.second_devices_of_age(), p.second_device_count(), "I7: a young device survived a finish");
                        assert!(p.waiting_requests().iter().all(|w| w.approved));
                        let old = phone;
                        phone = 0xA0 + new_phone_n;
                        new_phone_n += 1;
                        as_key(old, now + 1);
                        assert!(fails(|| p.execute(acct("bob.near"), send(1), None)), "I7: the old phone still acts");
                    }
                }
                _ => {
                    as_key(phone, now);
                    let _ = fails(|| p.set_recovery_key(key(0xC0 + rng.pick(3) as u8)));
                }
            }
            // Invariants after every step.
            let w = p.waiting_requests();
            assert!(w.len() <= 20, "I1");
            let mut ids: Vec<u64> = w.iter().map(|x| x.id.0).collect();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), w.len(), "I2");
            assert!(p.second_device_count() <= 4, "I5");
            let _ = (p.protection(), p.spent_today(), p.second_device_ages(), p.frozen_until(), p.delay_seconds(), p.release_version()); // I6
            assert!(p.delay_seconds().0 * 2 >= p.delay_seconds().0 + p.delay_seconds().0.min(DAY), "I8");
            if p.pending().is_some() {
                let level = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.level_for(acct("bob.near"), send(1), None))).ok();
                assert_ne!(level, Some(Level::FaceId), "I3");
            }
            // Release 10 (round 2, the laptop veto): while a laptop's dispute is open, nothing pays at Face ID.
            if p.dispute_until().is_some() {
                as_key(phone, now);
                assert!(fails(|| copy_of(&p).execute(acct("bob.near"), send(1), None)), "V: Face ID paid during a dispute");
            }
        }
    }
}

/// P11: an upgrade is ONE receipt: the switch to the global contract and the new code's `upgrade_check(from_version: 6)`,
/// so a release that can't read this state is never left installed.
#[test]
fn p11_upgrade_is_one_batch_switch_plus_check() {
    let mut p = mainnet_account(DELAY);
    // Release 9: the hash on the account's list first (as an upgrade_check from release 9 sets it).
    as_key(PHONE, DAY);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, Some(Base64VecU8(vec![9u8; 32])));
    as_key(PHONE, DAY + 1);
    let up = p.upgrade(Base64VecU8(vec![9u8; 32]));
    assert!(!up.done);
    assert_eq!(up.ready_at_ns, Some(U64((DAY + 1 + FLOOR) * SECOND)), "an upgrade waits the floor, never less");
    as_key(PHONE, DAY + 1 + FLOOR);
    let _ = get_created_receipts();
    assert!(p.run(up.id.unwrap()).done);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1, "{receipts:?}");
    let acts: Vec<String> = receipts[0].actions.iter().map(|a| format!("{a:?}")).collect();
    assert_eq!(acts.len(), 2, "{acts:?}");
    assert!(acts.iter().any(|a| a.contains("GlobalContract")), "{acts:?}");
    // The mock prints method names as bytes: "upgrade_check".
    let check = acts.iter().find(|a| a.contains("[117, 112, 103, 114, 97, 100, 101, 95, 99, 104, 101, 99, 107]")).expect("the new code's check is in the batch");
    // args = {"from_version":<this release>,"code_hash":"<the hash>"} (release 9 on: the new code is told the hash it runs as)
    let args: Vec<u8> = format!("{{\"from_version\":{},\"code_hash\":\"{}\"}}", account_policy::RELEASE_VERSION, near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [9u8; 32])).into_bytes();
    assert!(check.contains(&format!("{args:?}")), "from_version is this release, with the hash: {check}");
}

/// P12: the biggest numbers never panic the measurement: a limit of u128::MAX, an amount of u128::MAX, a 30-day wait,
/// and the longest coin names; and an amount over the whole is never Face ID.
#[test]
fn p12_numeric_extremes_never_panic_and_never_pass() {
    reset();
    as_key(SETUP, 0);
    let huge = Band { up_to: Some(vec![("near".into(), U128(u128::MAX)), ("x".repeat(128), U128(1))]), level: Level::FaceId };
    let mut p = AccountPolicy::new(U64(30 * DAY), vec![huge, Band { up_to: None, level: Level::Wait { seconds: U64(30 * DAY) } }], Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 1);
    assert_eq!(p.level_for(acct("bob.near"), send(u128::MAX), None), Level::FaceId, "the whole of a u128::MAX limit still fits");
    assert_eq!(p.level_for(acct("bob.near"), send(u128::MAX / 2), None), Level::FaceId);
    // (Totals add with saturation: against a u128::MAX limit nothing can be over, which no real limit is.)
    let change = p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(u128::MAX / 1_000_000 + 7))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(30 * DAY) } }]);
    as_key(PHONE, 1 + 30 * DAY + 1);
    assert!(p.run(change.id.unwrap()).done, "a setup step in the first day waits only the strictest band (30 days here)");
    // A limit too big to scale by a million: the coarser share still refuses what's over it and accepts the whole.
    assert_eq!(p.level_for(acct("bob.near"), send(u128::MAX / 1_000_000 + 7), None), Level::FaceId);
    assert_ne!(p.level_for(acct("bob.near"), send(u128::MAX / 1_000_000 + 8), None), Level::FaceId, "over the whole by one yocto");
    assert!(p.execute(acct("bob.near"), send(100 * NEAR), None).done);
    assert_ne!(p.level_for(acct("bob.near"), send(u128::MAX / 1_000_000 + 7 - 100 * NEAR + 1), None), Level::FaceId, "today's 100 NEAR count");
    assert!(fails(|| p.execute(acct("bob.near"), vec![Step::Transfer { deposit: U128(1) }; 11], None)), "eleven steps");
    let zero = Band { up_to: Some(vec![("near".into(), U128(0))]), level: Level::FaceId };
    let change = p.set_protection(vec![zero, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }]);
    assert!(!change.done);
    as_key(PHONE, 1 + 30 * DAY + 1 + 31 * DAY + 1);
    assert!(p.run(change.id.unwrap()).done);
    assert_ne!(p.level_for(acct("bob.near"), send(1), None), Level::FaceId, "a zero limit lets nothing through");
    assert_eq!(p.level_for(acct("bob.near"), vec![call("near_deposit", "", 0, 0)], None), Level::FaceId, "and a request moving nothing (no gas either: FB-1) fits any band");
}

/// P13: a yes from a second device not yet of age lets through what needs a device, but never co-signs: a recovery start
/// still drops the request, and so does the start even after the device would have come of age (R-I1).
#[test]
fn p13_a_young_devices_yes_never_co_signs() {
    let mut p = mainnet_account(DELAY);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 10 + DAY + 1; // after the setup window, laptop young for 8 days from t=10
    as_key(PHONE, t);
    let change = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    assert!(!change.done);
    as_key(LAPTOP, t + 1);
    assert!(fails(|| p.approve(change.id.unwrap())), "a young device can't co-sign a setting at all");
    as_key(PHONE, t + 1);
    let big = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
    assert!(!big.done && !big.needs_device, "default bands: a day's wait, no device");
    // Give the bands a device level so a request needs the laptop, then have the young laptop say yes to it.
    as_key(PHONE, t + 2);
    let rules = p.set_protection(laptop_bands());
    as_key(PHONE, t + 2 + FLOOR);
    assert!(p.run(rules.id.unwrap()).done);
    let needs = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
    assert!(needs.needs_device);
    as_key(LAPTOP, t + 3 + FLOOR);
    assert_eq!(p.second_devices_of_age(), 1, "by now the laptop is of age; make it young again first");
    // A fresh young device: added now (waits the floor, laptop co-signs), then says yes while young.
    as_key(PHONE, t + 3 + FLOOR);
    let add = p.add_second_device(key(LAPTOP2));
    as_key(LAPTOP, t + 4 + FLOOR);
    assert!(!p.approve(add.id.unwrap()).done);
    as_key(PHONE, t + 4 + 2 * FLOOR);
    assert!(p.run(add.id.unwrap()).done);
    let needs2 = p.execute(acct("bob.near"), send(3_000 * NEAR), None);
    as_key(LAPTOP2, t + 5 + 2 * FLOOR);
    assert!(p.approve(needs2.id.unwrap()).done == false, "approved by a young device: it waits its day");
    assert!(p.waiting_requests().iter().find(|w| w.id == needs2.id.unwrap()).unwrap().approved);
    // Left waiting (nobody ran it) until the second laptop has come of age: the yes it gave while young still counts
    // for nothing, so the words drop the payment (R-I1).
    as_key(PHONE, t + 6 + 3 * FLOOR);
    assert_eq!(p.second_devices_of_age(), 2);
    as_key(WORDS, t + 7 + 3 * FLOOR);
    p.start_recovery(key(NEW_PHONE));
    assert!(!p.waiting_requests().iter().any(|w| w.id == needs2.id.unwrap()), "a yes given while young protected a payment from the words once the device came of age");
    assert!(!p.waiting_requests().iter().any(|w| w.id == needs.id.unwrap()));
}

fn refused_with_msg<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "refused".into()),
    }
}

/// A copy of the state (a refused call in the mock leaves the struct half changed; NEAR would roll it back).
fn copy_of(p: &AccountPolicy) -> AccountPolicy {
    near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(p).unwrap()).unwrap()
}
