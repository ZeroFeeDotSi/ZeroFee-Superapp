//! Adversarial audit of the account contract (CONTRACT-AUDIT.md). Every `f*` test PASSES when the attack WORKS: it
//! asserts the vulnerable behaviour, so a fix makes it fail (flip the assertion into a regression test then).
//! `fuzz_*` tests assert a property that must always hold; they pass when no counterexample is found.
//!
//! Unit-level only (near-sdk mocked blockchain): NEAR's key permissions, gas metering and receipt failures aren't
//! simulated here. Where a finding depends on them, the test shows the contract-side half and the report gives the
//! protocol numbers.
mod common;
use common::finish_ok;
use account_policy::{moves, AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT: &str = "nep141:usdt.tether-token.near";

fn me() -> AccountId {
    "me.near".parse().unwrap()
}

/// A call from one of the account's own keys (NEAR's key permissions decide which key may call what; the mock can't).
fn as_account(now_s: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000))
        .build());
}

/// A call from one of the account's own keys, signed by the ML-DSA key `key(fill)`: a particular phone, the backup key,
/// or a second device (the contract tells them apart by the signing key).
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

fn as_caller(caller: &str, now_s: u64) {
    let caller: AccountId = caller.parse().unwrap();
    testing_env!(VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller)
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000))
        .build());
}

#[cfg(feature = "modules")]
/// A callback (predecessor = the account) with one promise result.
fn callback(now_s: u64, result: near_sdk::PromiseResult) {
    testing_env!(
        VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000_000)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
}

fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
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

/// What the app installs on a new mainnet account (packages/core/src/demo-core.ts defaultBands + contractBands):
/// $500 a day at Face ID, measured separately in NEAR (here at $2.50: 200 NEAR), USDC and USDT; above, a 24 h wait.
fn app_default_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } },
    ]
}

/// The app's setup transaction: `new` with the default bands and the 7-day recovery delay, then the first recovery key.
fn app_account() -> AccountPolicy {
    as_account(0);
    let mut p = AccountPolicy::new(U64(7 * DAY), app_default_bands(), None, None);
    assert!(p.set_recovery_key(key(0xEE)).done);
    p
}

fn receipts_actions() -> Vec<MockAction> {
    get_created_receipts().into_iter().flat_map(|r| r.actions).collect()
}

// ══ F1 (High) — a stolen/compromised phone beats every defence on the default settings ════════════════════════════

/// FIXED (F1): a change to the rules or keys waits longer than a recovery takes, and starting a recovery drops what a
/// phone alone asked for; so the backup words stop the thief's loosening and code. And (re-audit R1) the thief's cancel
/// of the recovery buys nothing: while a recovery waits, and for a change's wait after a phone-only cancel, nothing runs
/// at Face ID.
#[test]
fn f1_stolen_phone_loosens_rules_and_upgrades_while_the_owner_cannot_stop_it() {
    let mut p = app_account();
    let t0 = 2 * DAY; // past the account's first 24 hours
    // The thief, with the unlocked phone (key 0x33).
    as_key(0x33, t0);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let evil = p.upgrade(Base64VecU8(vec![0xAB; 32]));
    let big = p.execute(acct("thief.near"), send(900_000 * NEAR), None);
    assert!(!loosen.done && !evil.done && !big.done);
    assert_eq!(loosen.ready_at_ns.unwrap().0, (t0 + 8 * DAY) * SECOND, "a change waits the 7-day recovery plus a day");
    // Release 10 (V2): a release not on the list is first its listing, which the phone alone runs only after the
    // words-only fallback (21 days here): the Outcome says so.
    assert_eq!(evil.ready_at_ns.unwrap().0, (t0 + 21 * DAY) * SECOND);
    // The owner, with the 24 words only (the backup key 0xEE), starts a recovery: everything the phone asked for goes.
    as_key(0xEE, t0 + 60);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "starting a recovery drops every waiting request a second device hasn't approved");
    // The thief cancels the recovery (no second device here) and asks again; the owner starts again: dropped again.
    as_key(0x33, t0 + 61);
    assert!(p.cancel_recovery().done);
    let again = p.upgrade(Base64VecU8(vec![0xAB; 32]));
    as_key(0xEE, t0 + 120);
    p.start_recovery(key(0x11));
    as_key(0x33, t0 + 9 * DAY);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(again.id.unwrap())));
    assert!(r.is_err(), "nothing the thief asked for is left to run");
    assert!(!receipts_actions().iter().any(|a| matches!(a, MockAction::UseGlobalContract { .. })), "no code is installed");
    // Not even the Face ID band: a recovery waits, so a payment waits a change's wait, and the recovery ends first.
    let small = p.execute(acct("thief.near"), send(100 * NEAR), None);
    assert!(!small.done);
    assert_eq!(small.ready_at_ns.unwrap().0, (t0 + 9 * DAY + 8 * DAY) * SECOND);
}

/// FIXED (F1): with a second device, a change the phone and the second device both signed (two of three) is beyond the
/// backup words' reach; it still waits its time. And the phone alone can't cancel a recovery at once: it waits a day and
/// the second device may refuse it, or say yes and end it now (re-audit R3). The second device co-signs once it has been
/// on the account for a change's wait (re-audit R4).
#[test]
fn f1_two_of_three_wins_and_a_phone_alone_cannot_cancel_a_recovery() {
    let mut p = app_account();
    as_key(0x33, 3_600);
    assert!(p.add_second_device(key(9)).done, "the first second device in the first 24 hours: at once");
    // Release 10 (round 2, G2): its yes to the stop needs it on the account for the fallback (21 days on 7 days).
    let t0 = 22 * DAY;
    as_key(0x33, t0);
    let rotate = p.set_recovery_key(key(0xEF));
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(9, t0 + 10);
    p.approve(rotate.id.unwrap());
    // Leaked words: their holder starts a recovery. The co-signed rotation stays; the phone-only loosening goes.
    as_key(0xEE, t0 + 60);
    p.start_recovery(key(0x66));
    let left: Vec<u64> = p.waiting_requests().iter().map(|w| w.id.0).collect();
    assert_eq!(left, vec![rotate.id.unwrap().0]);
    assert!(!left.contains(&loosen.id.unwrap().0));
    // The phone alone can't stop that recovery now: its cancel waits a day, and the second device's yes ends it at once.
    as_key(0x33, t0 + 61);
    let stop = p.cancel_recovery();
    assert!(!stop.done && !stop.needs_device);
    assert_eq!(stop.ready_at_ns.unwrap().0, (t0 + 61 + DAY) * SECOND);
    assert!(p.pending().is_some());
    as_key(9, t0 + 62);
    assert!(p.approve(stop.id.unwrap()).done);
    assert!(p.pending().is_none());
    // The rotation still waits its eight days, then runs.
    as_key(0x33, t0 + 8 * DAY);
    assert!(p.run(rotate.id.unwrap()).done);
}

/// An account made by this release names its phone at `new`: the list is sealed from the start, and the setup batch's
/// own key can still add the first backup key in that batch.
#[test]
fn f1_a_new_account_names_its_phone_and_nothing_else_acts() {
    as_key(0x50, 0); // the setup batch's one-time key
    let mut p = AccountPolicy::new(U64(7 * DAY), app_default_bands(), Some(key(0x33)), None);
    assert!(p.set_recovery_key(key(0xEE)).done, "the setup batch adds the first backup key");
    as_key(0x33, 10);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done, "the named phone acts");
    as_key(0x44, 11);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(acct("bob.near"), send(NEAR), None)));
    assert!(r.is_err(), "a key the account never named can't act as its phone");
}

/// FIXED (F1): a finished recovery leaves the new phone as the only phone. Every other device key the account knows is
/// deleted, and the list is sealed: neither the old phone nor a key that never called before can act.
#[test]
fn f1b_finished_recovery_leaves_the_old_phone_in_and_it_cancels_its_own_removal() {
    let mut p = app_account();
    as_key(0x33, 100);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done); // the old phone has used the account
    as_key(0xEE, 200);
    p.start_recovery(key(0x11));
    as_key(0xEE, 200 + 7 * DAY);
    // Release 9 (R8-RS1): the finish adds the new key; its callback, having seen the add succeed, deletes the old ones.
    let added: Vec<MockAction> = finish_ok(&mut p).into_iter().flat_map(|r| r.actions).collect();
    assert!(added.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })));
    let acts = receipts_actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::DeleteKey { .. })), "the old phone's key is deleted");
    for old in [0x33u8, 0x44] {
        as_key(old, 201 + 7 * DAY);
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(acct("bob.near"), send(NEAR), None)));
        assert!(r.is_err(), "key {old:#x} (the old phone, or one that never called) can't act after the recovery");
    }
    as_key(0x11, 202 + 7 * DAY);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done, "the new phone can");
}

// ══ F2 (High) — the second device can decline ANY waiting request, including its own removal ═════════════════════

#[test]
fn f2_second_device_declines_requests_that_never_needed_it_including_its_own_removal() {
    // FIXED (F2): `decline` takes only requests that need the second device, and never a second device's removal.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }]).done);
    // Strictest is a wait only: neither its removal nor an over-band payment needs it, so it can decline neither.
    let rm = p.remove_key(key(9));
    assert!(!rm.done && !rm.needs_device);
    let pay = p.execute(acct("bob.near"), send(50 * NEAR), None);
    assert!(!pay.needs_device);
    as_key(9, 0);
    for id in [rm.id.unwrap(), pay.id.unwrap()] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.decline(id)));
        assert!(r.is_err(), "a request that doesn't need the second device can't be declined by it");
    }
    assert_eq!(p.waiting_requests().len(), 2, "both still wait");
    // Where the strictest level does need it: it may decline a payment, never a second device's removal.
    as_account(0);
    let mut q = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(q.add_second_device(key(9)).done);
    assert!(q.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }]).done);
    let pay = q.execute(acct("bob.near"), send(50 * NEAR), None);
    assert!(pay.needs_device);
    as_key(9, 0);
    q.decline(pay.id.unwrap());
    as_account(0);
    let rm = q.remove_key(key(9));
    as_key(9, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| q.decline(rm.id.unwrap())));
    assert!(r.is_err(), "no second device can stop a second device's removal");
}

// ══ F3 (High) — lose the second device and everything at the strictest level is locked for good ═══════════════════

#[test]
fn f3_lost_second_device_locks_settings_upgrades_and_unlisted_coins_and_recovery_cannot_help() {
    // FIXED (F3): a second device's removal never needs that device. It waits as a change does (and the backup words
    // can stop it), and once the last one is gone every level that needed it becomes a wait.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Both { seconds: U64(DAY) } }]).done);
    // The laptop is lost; the phone asks to remove it. It needs no laptop: it waits the longest of the band's day, a
    // change's floor and, for a device of age, the words-only fallback (re-audit 7, R7-1: 7 days here).
    as_account(2 * DAY);
    let rm = p.remove_key(key(9));
    assert!(!rm.done && !rm.needs_device);
    assert_eq!(rm.ready_at_ns.unwrap().0, (2 * DAY + 7 * DAY) * SECOND);
    as_account(9 * DAY);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
    assert_eq!(p.protection()[1].level, Level::Wait { seconds: U64(DAY) }, "Both(1 day) became a 1-day wait");
    // Settings, upgrades, unlisted coins and other Intents calls are no longer locked: they wait, and then run.
    let unlisted = p.execute(acct("intents.near"), call("native_withdraw", r#"{"receiver_id":"me2.near","amount":"1"}"#, 1), None);
    assert!(!unlisted.done && !unlisted.needs_device);
    as_account(10 * DAY + 1);
    assert!(p.run(unlisted.id.unwrap()).done);
}

#[cfg(feature = "modules")]
/// F3 on a child's account: the child's phone asks to remove the parent's device; the parent declines it (a parent who
/// lost their phone declines nothing, so it still goes after the wait).
#[test]
fn f3_a_child_cannot_remove_the_parent_but_a_lost_parent_device_still_goes() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(5 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }]).done);
    let rules = p.kids_set(kids::KidsRules { allowed: vec![acct("bob.near")], week: vec![("near".into(), U128(NEAR))] });
    as_key(9, 1);
    if !rules.done {
        assert!(p.approve(rules.id.unwrap()).done);
    }
    as_account(2 * DAY);
    let rm = p.remove_key(key(9));
    assert!(!rm.done && !rm.needs_device);
    as_key(9, 2 * DAY + 10);
    p.decline(rm.id.unwrap());
    assert!(p.waiting_requests().is_empty(), "the parent stopped it");
    as_account(2 * DAY + 20);
    let rm = p.remove_key(key(9));
    as_account(2 * DAY + 20 + 200);
    assert!(p.run(rm.id.unwrap()).done, "a lost parent device declines nothing: it goes after the wait");
    assert_eq!(p.second_device_count(), 0);
}

// ══ F4 (High) — the second device's key has no fee allowance: it can burn the account's NEAR to zero ══════════════

#[test]
fn f4_second_device_key_is_added_with_unlimited_fee_allowance() {
    // FIXED (F4): a second device's key has a 1 NEAR fee cap, and the phone refills it (add_second_device again, at once).
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.add_second_device(key(9)).done);
    let fc_keys: Vec<(Option<NearToken>, Vec<String>)> = receipts_actions()
        .into_iter()
        .filter_map(|a| match a {
            MockAction::AddKeyWithFunctionCall { allowance, method_names, .. } => Some((allowance, method_names)),
            _ => None,
        })
        .collect();
    assert_eq!(fc_keys.len(), 1);
    // Release 7: a second device also says yes to, or refuses, a recovery.
    assert_eq!(fc_keys[0].1, vec!["approve".to_string(), "decline".to_string(), "approve_recovery".to_string(), "refuse_recovery".to_string(), "refill_recovery_key".to_string()]);
    assert_eq!(fc_keys[0].0, Some(NearToken::from_near(1)), "1 NEAR of fees at most");
    // The refill: the same key deleted and added again with a fresh 1 NEAR, in one batch; still one second device.
    as_account(10);
    let renewed = p.add_second_device(key(9));
    assert!(renewed.done && renewed.id.is_none());
    let acts = receipts_actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::DeleteKey { .. })));
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { allowance: Some(t), .. } if *t == NearToken::from_near(1))));
    let count = p.waiting_requests().len();
    assert_eq!(count, 0);
}

// ══ F5 (Medium) — calls the contract can't measure run at Face ID (the Step::FunctionCall escape) ═════════════════

#[test]
fn f5_value_moving_calls_that_measure_as_zero() {
    // FIXED (F5): calls on other contracts are measured by allowlist; anything else takes the strictest band.
    let p = app_account();
    let strictest = Level::Wait { seconds: U64(DAY) };
    for (receiver, method, args, deposit) in [
        ("nft.example.near", "nft_approve", r#"{"token_id":"1","account_id":"thief.near"}"#, NEAR / 100),
        ("nft.example.near", "nft_transfer_payout", r#"{"receiver_id":"thief.near","token_id":"1","balance":"1"}"#, 1),
        ("mt.example.near", "mt_approve", r#"{"token_ids":["a"],"amounts":["1000000"],"account_id":"thief.near"}"#, 1),
        ("v2.ref-finance.near", "mft_transfer", r#"{"token_id":":3879","receiver_id":"thief.near","amount":"99999999999999999999"}"#, 1),
        ("token.example.near", "ft_approve", r#"{"spender_id":"thief.near","amount":"1000000000"}"#, 1),
        (&USDC[7..], "storage_unregister", r#"{"force":true}"#, 1),
        ("intents.testnet", "execute_intents", r#"{"signed":[]}"#, 0),
        // A known name with a recipient isn't let through either.
        ("pool.example.near", "withdraw", r#"{"amount":"1","receiver_id":"thief.near"}"#, 0),
    ] {
        assert_eq!(p.level_for(acct(receiver), call(method, args, deposit), None), strictest, "{method}");
    }
    // What the app itself calls still measures as its attached NEAR: wrapping, storage, staking and taking it back.
    for (receiver, method, args, deposit) in [
        ("wrap.near", "near_deposit", "{}", NEAR),
        ("wrap.near", "near_withdraw", r#"{"amount":"1"}"#, 1),
        (&USDC[7..], "storage_deposit", r#"{"account_id":"bob.near","registration_only":true}"#, 1_250_000_000_000_000_000_000),
        ("pool.example.near", "deposit_and_stake", "{}", NEAR),
        ("pool.example.near", "unstake", r#"{"amount":"1"}"#, 0),
        ("pool.example.near", "unstake_all", "", 0),
        ("pool.example.near", "withdraw", r#"{"amount":"1"}"#, 0),
    ] {
        assert_eq!(p.level_for(acct(receiver), call(method, args, deposit), None), Level::FaceId, "{method}");
    }
    // An heir's call on another ZeroFee account: measured only with Legacy (`modules`); the release has no Legacy.
    let heir = p.level_for(acct("mum.near"), call("legacy_start_claim", "", 0), None);
    assert_eq!(heir, if cfg!(feature = "modules") { Level::FaceId } else { strictest });
}

// ══ F6 (Medium) — "$500 a day" is $500 per coin; one Face ID request moves $1,500 ══════════════════════════════════

#[test]
fn f6_dollar_band_is_per_coin_so_one_face_id_chain_moves_three_times_it() {
    let mut p = app_account();
    as_account(10);
    let chain = vec![
        Group { receiver_id: acct("thief.near"), steps: send(199 * NEAR) },
        Group { receiver_id: USDC[7..].parse().unwrap(), steps: call("ft_transfer", r#"{"receiver_id":"thief.near","amount":"500000000"}"#, 1) },
        Group { receiver_id: acct("usdt.tether-token.near"), steps: call("ft_transfer", r#"{"receiver_id":"thief.near","amount":"500000000"}"#, 1) },
    ];
    // FIXED (F6): the band is one budget across its coins, so $1,500 doesn't fit a $500 Face ID band: it waits.
    let out = p.execute_many(chain);
    assert!(!out.done, "$500 of NEAR + $500 USDC + $500 USDT is $1,500 of a $500 budget");
    // Within the budget across coins it runs: $200 of NEAR ($2.50) and $250 of USDC.
    let mut q = app_account();
    as_account(10);
    assert!(q.execute(acct("bob.near"), send(80 * NEAR), None).done);
    assert!(q.execute(USDC[7..].parse().unwrap(), call("ft_transfer", r#"{"receiver_id":"bob.near","amount":"250000000"}"#, 1), None).done);
    // and $100 more in USDT takes the day past $500: it waits.
    assert!(!q.execute(acct("usdt.tether-token.near"), call("ft_transfer", r#"{"receiver_id":"bob.near","amount":"100000000"}"#, 1), None).done);
}

// ══ F7 (Medium) — `upgrade` accepts any 32-byte hash ═════════════════════════════════════════════════════════════

#[test]
fn f7_upgrade_installs_any_global_contract_hash() {
    // FIXED (F7): the switch and a call to the new code's own upgrade_check go in ONE batch, so NEAR keeps the old code
    // unless the new one reads this state, is this release or newer, and has the check at all. (NEAR's all-or-nothing
    // batch can't run in the mock; this shows the batch, and the check itself.)
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    // Release 9: the hash goes on the account's list first (the phone alone: after the 7-day fallback), then the switch.
    let add = p.upgrade(Base64VecU8(vec![0x66; 32]));
    as_account(7 * DAY);
    assert!(p.run(add.id.unwrap()).done);
    let up = p.upgrade(Base64VecU8(vec![0x66; 32]));
    as_account(7 * DAY + 120);
    assert!(p.run(up.id.unwrap()).done);
    let acts = receipts_actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::UseGlobalContract { .. })));
    let hash64 = near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, [0x66u8; 32]);
    assert!(
        acts.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"upgrade_check" && args == format!("{{\"from_version\":{},\"code_hash\":\"{hash64}\"}}", account_policy::RELEASE_VERSION).as_bytes())),
        "the check rides in the same batch, told the hash it runs as: {acts:?}"
    );
    assert!(get_created_receipts().iter().any(|r| r.actions.len() == 2), "one receipt, both actions");
    // The check: this release or newer passes; going back to an older one doesn't.
    as_account(121);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(account_policy::RELEASE_VERSION, None);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    let back = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.upgrade_check(account_policy::RELEASE_VERSION + 1, None)));
    assert!(back.is_err());
}

// ══ F8 (Medium) — a stranger re-runs a failing standing order: phantom spend pushes the owner off Face ID ═════════

#[cfg(feature = "modules")]
fn agent_budget() -> agent_limits::Budget {
    agent_limits::Budget {
        coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(2 * NEAR), per_month: U128(10 * NEAR), convert_per_day: U128(0) }],
        recipients: vec![acct("landlord.near")],
        ends_at_ns: U64(365 * DAY * SECOND),
        max_spends_per_day: 12,
    }
}

#[cfg(feature = "modules")]
#[test]
fn f8_failing_order_rerun_by_a_stranger_inflates_spent_without_bound() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(NEAR)), (USDC.into(), U128(500_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }], None, None);
    let pay = || call("ft_transfer", r#"{"receiver_id":"bob.near","amount":"1"}"#, 1);
    // Monthly rent of 400 USDC from the Intents balance, approved by the owner (strictest level ran at t=0 for brevity).
    let rent = agent_limits::OrderPlan { payout: agent_limits::Payout::Ledger { token_id: USDC.into() }, to: acct("landlord.near"), amount: U128(400_000_000), dates_ns: vec![U64(2 * DAY * SECOND)], grace_seconds: U64(31 * DAY) };
    let id = p.agent_set(key(5), agent_budget(), vec![rent]).id.unwrap();
    as_account(DAY);
    assert!(p.run(id).done);
    assert_eq!(p.level_for(USDC[7..].parse().unwrap(), pay(), None), Level::FaceId, "before: a tiny USDC payment is Face ID");
    // FIXED (F8): a failed payment's rows leave the 24-hour totals, and a date is tried at most three times, an hour apart.
    let mut payment_id = 2; // the agent's own id counter: order 1, then payments 2, 3, …
    let mut refused = 0;
    for i in 0..50u64 {
        as_caller("stranger.near", 2 * DAY + i * 3);
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run_order(U64(1)))).is_err() {
            refused += 1;
            continue;
        }
        callback(2 * DAY + 1 + i * 3, near_sdk::PromiseResult::Failed);
        p.on_agent_settled(U64(payment_id), Some(U64(2 + i)));
        payment_id += 1;
    }
    assert_eq!(refused, 49, "after the first failure, the next try must wait an hour");
    assert!(p.spent_today().iter().all(|(c, _)| c != USDC), "the failed payment's 400 USDC left the totals");
    as_account(2 * DAY + 200);
    assert!(p.execute(USDC[7..].parse().unwrap(), pay(), None).done, "the owner's tiny payment is still Face ID");
    // Three failures in all, an hour apart, then the date is refused for good.
    for h in 1..=2u64 {
        as_caller("stranger.near", 2 * DAY + h * 3_700);
        p.run_order(U64(1));
        callback(2 * DAY + h * 3_700 + 1, near_sdk::PromiseResult::Failed);
        p.on_agent_settled(U64(payment_id), None);
        payment_id += 1;
    }
    as_caller("stranger.near", 2 * DAY + 4 * 3_700);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run_order(U64(1)))).is_err(), "three failures: no more tries");
}

// ══ F9 (Low) — two waiting agent_set requests leave an orphan agent key that agent_revoke never deletes ══════════════

#[cfg(feature = "modules")]
#[test]
fn f9_second_agent_set_orphans_the_first_key() {
    // FIXED (F9): a second agent_set can't finish while an agent exists, and revoking drops anything for Agent waiting.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(60) } }], None, None);
    let a = p.agent_set(key(5), agent_budget(), vec![]).id.unwrap();
    let b = p.agent_set(key(6), agent_budget(), vec![]).id.unwrap(); // allowed: no agent exists *yet*
    as_account(120);
    assert!(p.run(a).done);
    let second = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(b)));
    assert!(second.is_err(), "an agent exists: the second can't finish");
    as_account(121);
    p.agent_revoke();
    assert!(p.waiting_requests().iter().all(|w| w.id != b), "revoking dropped the waiting agent_set");
    assert!(p.agent().is_none());
}

// ══ F10 (Low) — second-device bookkeeping: no cap at finish, no dedupe, ghost entries ═══════════════════════════════

#[test]
fn f10_more_than_four_second_devices_and_duplicates() {
    // FIXED (F10): the cap and the "not already on the account" check are made again when each one runs.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(60) } }], None, None);
    as_account(2 * DAY); // past the first 24 hours: every one waits
    let ids: Vec<U64> = (0..6).map(|i| p.add_second_device(key(if i < 5 { 10 + i } else { 10 })).id.unwrap()).collect();
    as_account(2 * DAY + 600);
    let mut ran = 0;
    for id in ids {
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(id))).is_ok() {
            ran += 1;
        }
    }
    assert_eq!(ran, 4);
    assert_eq!(p.second_device_count(), 4, "four at most, no duplicates");
}

// ══ F11 (Medium) — an heir can lock a living owner out for good once they've been quiet 30 days ═══════════════════

#[cfg(feature = "modules")]
#[test]
fn f11_heir_vetoes_every_recovery_then_pays_out() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(7 * DAY), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.set_recovery_key(key(0xEE)).done);
    let cfg = legacy::LegacyConfig {
        heirs: vec![legacy::Heir { account_id: acct("mia.near"), share_pct: 100 }],
        quiet_seconds: U64(180 * DAY),
        claim_delay_seconds: U64(30 * DAY),
        tokens: vec![],
    };
    // (since F1 a change to the rules waits the recovery delay plus as much: asked for, then run once that is over)
    let setup = p.legacy_setup(cfg);
    as_account(8 * DAY);
    assert!(p.run(setup.id.unwrap()).done);
    // FIXED (F11): the owner's phone breaks; 31 days later they find the words and start a recovery. Mia can't stop it:
    // heirs may stop a recovery only after the whole quiet period (180 days here), when they could claim anyway.
    as_account(8 * DAY + 31 * DAY);
    p.start_recovery(key(0x11));
    as_caller("mia.near", 8 * DAY + 31 * DAY + 1);
    let veto = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.legacy_cancel_recovery()));
    assert!(veto.is_err(), "within the quiet period the words win");
    as_key(0xEE, 8 * DAY + 38 * DAY + 2);
    finish_ok(&mut p);
    assert!(p.pending().is_none());
    // After the whole quiet period of silence, heirs may still stop a recovery (the owner may be gone; words can be stolen).
    as_key(0xEE, 8 * DAY + 38 * DAY + 2 + 180 * DAY);
    p.start_recovery(key(0x12));
    as_caller("mia.near", 8 * DAY + 38 * DAY + 3 + 180 * DAY);
    p.legacy_cancel_recovery();
    assert!(p.pending().is_none());
}

// ══ F12 (Medium) — fixed callback gas vs. unbounded state size ════════════════════════════════════════════════════

/// on_group_done gets 15 Tgas and on_agent_settled 10 Tgas, but both deserialize and re-write the WHOLE contract
/// state (a `&mut self` method). Storage costs (nearcore params): read 5.6 Mgas/byte, write 31 Mgas/byte, plus 32
/// Mgas/byte for the evicted old value ⇒ ≈ 69 Mgas per byte of state, so ≈150 KB of state exhausts 10 Tgas and
/// ≈215 KB exhausts 15 Tgas. One waiting execute_many with full-size steps is already past that.
#[test]
fn f12_one_waiting_request_makes_state_too_big_for_the_callbacks() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(60) } }], None, None);
    let big = |r: &str| Group { receiver_id: acct(r), steps: (0..10).map(|_| Step::FunctionCall { method_name: "m".into(), args: Base64VecU8(vec![b' '; 4096]), deposit: U128(NEAR), gas: U64(1) }).collect() };
    // FIXED (F12): what may wait is capped (64 KB serialized), so a callback's load and save of the state stays a few Tgas.
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute_many(vec![big("a.near"), big("b.near"), big("c.near"), big("d.near")])));
    assert!(refused.is_err(), "165 KB more waiting is refused");
    // Fill to the cap with smaller waiting requests: the state stays under ~70 KB, a few Tgas to load and store.
    let mid = |r: &str| Group { receiver_id: acct(r), steps: (0..2).map(|_| Step::FunctionCall { method_name: "m".into(), args: Base64VecU8(vec![b' '; 4096]), deposit: U128(NEAR), gas: U64(1) }).collect() };
    while std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute_many(vec![mid("a.near")]))).is_ok() {}
    let bytes = near_sdk::borsh::to_vec(&p).unwrap().len();
    let gas_per_byte: u128 = 5_611_005 + 31_018_038 + 32_117_307;
    let tgas = bytes as u128 * gas_per_byte / 1_000_000_000_000;
    assert!(bytes < 70_000 && tgas < 5, "state {bytes} bytes ⇒ ~{tgas} Tgas to load+store in a callback (it gets 15–20 plus unused gas)");
}

#[cfg(feature = "modules")]
/// The consequence for standing orders: if on_agent_settled never lands, the slot stays `Paying` forever — the date is
/// never retried and the order is never pruned (it holds one of the 8 order slots).
#[test]
fn f12b_a_lost_settle_callback_strands_an_order_date() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    let rent = agent_limits::OrderPlan { payout: agent_limits::Payout::Near, to: acct("landlord.near"), amount: U128(NEAR), dates_ns: vec![U64(1_000 * SECOND)], grace_seconds: U64(3_600) };
    // (since F1 a change to the rules waits the recovery delay plus as much: asked for, then run once that is over)
    let set = p.agent_set(key(5), agent_budget(), vec![rent]);
    as_account(120);
    assert!(p.run(set.id.unwrap()).done);
    as_caller("stranger.near", 1_000);
    p.run_order(U64(1));
    // (callback ran out of gas: no settle)
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run_order(U64(1))));
    assert!(again.is_err(), "nothing due yet: it is paying");
    // FIXED (F12): an hour later the payment is taken as paid (it may have gone through, so it's never sent twice), and
    // the order isn't stuck for good.
    as_caller("stranger.near", 1_000 + 3_601);
    p.run_order(U64(1));
    assert!(get_logs().iter().any(|l| l.contains("agent_payment_unconfirmed")));
    assert!(receipts_actions().iter().all(|a| !matches!(a, MockAction::Transfer { .. })), "nothing is sent again");
    as_caller("stranger.near", 1_000 + 365 * DAY);
    let still = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run_order(U64(1))));
    assert!(still.is_err(), "its one date is done");
}

// ══ F13 (Low) — a child's rules mean nothing unless the APP checks the strictest level ═════════════════════════════

#[cfg(feature = "modules")]
#[test]
fn f13_contract_accepts_kids_rules_on_a_face_id_account_and_the_child_turns_them_off() {
    // FIXED (F13): a child's rules need the parent's device at the strictest level, checked by the contract itself.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.kids_set(kids::KidsRules { allowed: vec![acct("bob.near")], week: vec![("near".into(), U128(NEAR))] })));
    assert!(r.is_err(), "no parent device at the top: no rules the child could switch off");
}

// ══ F14 (Low) — replacing the backup key with a key already on the account ══════════════════════════════════════════

#[test]
fn f14_set_recovery_key_to_an_existing_device_key_pins_that_key_and_kills_the_words() {
    // FIXED (F14): a key already on the account (here the phone's own) can't become the backup key.
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    as_key(0x33, 1);
    assert!(p.set_recovery_key(key(0xEE)).done); // the phone (0x33) has acted, so the account knows it
    as_key(0x33, 2);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.set_recovery_key(key(0x33))));
    assert!(r.is_err(), "the phone's own key can't be made the backup key");
}

/// A pending recovery survives a change of backup words: whoever holds the NEW words can finish the OLD request
/// (which may name an attacker's key).
#[test]
fn f14b_pending_recovery_survives_backup_key_rotation() {
    // FIXED (F14): a recovery started with the old words goes when the backup key changes. Since re-audit 2's N1 (a)
    // a start drops new words the phone asked alone, and (release 10, R1) those it asks while a recovery waits never run
    // in it: only new words the phone and a second device asked together outlast a start (the old words' holder starting
    // one), and when they run that recovery goes.
    as_key(0x33, 0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], Some(key(0x33)), None);
    assert!(p.set_recovery_key(key(0xEE)).done);
    assert!(p.add_second_device(key(9)).done);
    as_key(0x33, 200); // the laptop is of age (the floor here is 120 s)
    let rotate = p.set_recovery_key(key(0xEF));
    as_key(9, 201);
    p.approve(rotate.id.unwrap());
    as_key(0xEE, 202);
    p.start_recovery(key(0x66)); // started with the old (stolen) words
    as_key(0x33, 203);
    let during = p.set_recovery_key(key(0xF1));
    assert!(!during.done, "asked during it: placed, never at once");
    as_key(0x33, 200 + 120);
    assert!(p.run(rotate.id.unwrap()).done);
    assert!(p.pending().is_none(), "cleared with the old words");
    assert!(p.waiting_requests().iter().all(|w| w.id != during.id.unwrap()), "and the phone's ask during it with it");
}

// ══ F15 (Low) — the agent key may be a key already on the account; revoke then deletes it with no level ═══════════

#[cfg(feature = "modules")]
#[test]
fn f15_agent_key_equal_to_the_backup_key_lets_agent_revoke_delete_the_words_at_once() {
    // FIXED (F15): Agent's key can't be a key already on the account (the backup key, a second device or a phone).
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }], None, None);
    assert!(p.set_recovery_key(key(0xEE)).done);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.agent_set(key(0xEE), agent_budget(), vec![])));
    assert!(r.is_err(), "the backup key can't become Agent's");
}

/// FIXED (F17): the phone refills the backup key's fee allowance at once (set_recovery_key with the same key), so leaked
/// words burning it with junk can't leave the real words unable to start a recovery.
#[test]
fn f17_the_backup_keys_fee_allowance_can_be_refilled() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(7 * DAY), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.set_recovery_key(key(0xEE)).done);
    as_account(30 * DAY);
    let again = p.set_recovery_key(key(0xEE));
    assert!(again.done && again.id.is_none(), "at once: who it is doesn't change");
    let acts = receipts_actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::DeleteKey { .. })));
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })));
}

// ══ F16 (Medium) — Kids: ft_transfer_call's msg names the real payee; `parties` doesn't read it ══════════════════════

#[cfg(feature = "modules")]
#[test]
fn f16_child_pays_a_stranger_through_an_allowed_forwarder() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(5 * NEAR)), (USDC.into(), U128(100_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }]).done);
    let usdc = &USDC[7..];
    // The parent allows USDC, NEAR Intents (the app's own balance) and Bob.
    let set = p.kids_set(kids::KidsRules { allowed: vec![acct(usdc), acct("intents.near"), acct("bob.near")], week: vec![(USDC.into(), U128(100_000_000))] });
    assert!(p.approve(set.id.unwrap()).done);
    // Paying mallory directly needs the parent…
    assert_eq!(p.level_for(acct(usdc), call("ft_transfer", r#"{"receiver_id":"mallory.near","amount":"50000000"}"#, 1), None), Level::Device);
    // FIXED (F16): a deposit into NEAR Intents credited to mallory (msg = receiver) has no known payee: the parent decides.
    let out = p.execute(acct(usdc), call("ft_transfer_call", r#"{"receiver_id":"intents.near","amount":"50000000","msg":"mallory.near"}"#, 1), None);
    assert!(!out.done && out.needs_device, "the parent says yes first");
    // A plain deposit into the child's own Intents balance (empty msg) is still the allowed "intents.near".
    assert_eq!(p.level_for(acct(usdc), call("ft_transfer_call", r#"{"receiver_id":"intents.near","amount":"1000000","msg":""}"#, 1), None), Level::FaceId);
    assert_eq!(p.level_for(acct(usdc), call("ft_transfer_call", r#"{"receiver_id":"intents.near","amount":"1000000","msg":"me.near"}"#, 1), None), Level::FaceId, "the child's own name as the msg: its own balance");
}

// ══ Info — measurement details ═══════════════════════════════════════════════════════════════════════════════════

#[test]
fn info_duplicate_json_keys_measure_the_last_value_and_duplicate_band_coins_pick_any() {
    // serde_json::Value keeps the last duplicate; Rust token contracts reject duplicates, other parsers may keep the first.
    // Release 10 (M-L1): so a repeated key makes the request unmeasurable (the strictest band).
    assert_eq!(moves(USDC.strip_prefix("nep141:").unwrap(), &call("ft_transfer", r#"{"receiver_id":"x.near","amount":"1000000000","amount":"1"}"#, 1)), None);
    // check_bands accepts the same coin twice in one band. Since F6 both entries count against the one budget, so the
    // stricter one decides: never looser.
    as_account(0);
    let p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(1)), ("near".into(), U128(1_000 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(60) } }], None, None);
    assert_eq!(p.level_for(acct("bob.near"), send(999 * NEAR), None), Level::Wait { seconds: U64(60) });
}

#[test]
fn info_recovery_delay_minimum_is_60_seconds_and_fixed_forever() {
    as_account(0);
    let p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
    assert_eq!(p.delay_seconds(), U64(60), "accepted on mainnet; no method changes it later");
}

// ══ Attacks that FAILED (kept as regression tests) ═════════════════════════════════════════════════════════════════

#[test]
fn held_unmeasurable_and_self_calls_are_refused() {
    let mut p = app_account();
    let strict = Level::Wait { seconds: U64(DAY) };
    // Any intents.near method other than the three measured ones is strictest.
    for m in ["execute_intents", "mt_withdraw", "nft_withdraw", "native_withdraw", "storage_deposit", "ft_withdraw_call", "mt_transfer_call_with_fee", "simulate_intents"] {
        assert_eq!(p.level_for(acct("intents.near"), call(m, "{}", 0), None), strict, "{m}");
    }
    // Malformed amounts → unmeasurable → strictest.
    for args in [r#"{"receiver_id":"x.near","amount":1}"#, r#"{"receiver_id":"x.near","amount":"-1"}"#, r#"{"receiver_id":"x.near","amount":"1e9"}"#, r#"{"receiver_id":"x.near"}"#, "not json", r#"{"receiver_id":"x.near","amount":"340282366920938463463374607431768211456"}"#] {
        assert_eq!(p.level_for(USDC[7..].parse().unwrap(), call("ft_transfer", args, 1), None), strict, "{args}");
    }
    // Batch length mismatch.
    assert_eq!(p.level_for(acct("intents.near"), call("mt_batch_transfer", r#"{"receiver_id":"x.near","token_ids":["a","b"],"amounts":["1"]}"#, 1), None), strict);
    // Intents and direct USDC are one coin: 300 + 300 > 500 → the second waits.
    as_account(5);
    assert!(p.execute(USDC[7..].parse().unwrap(), call("ft_transfer", r#"{"receiver_id":"x.near","amount":"300000000"}"#, 1), None).done);
    assert!(!p.execute(acct("intents.near"), call("mt_transfer", &format!(r#"{{"receiver_id":"x.near","token_id":"{USDC}","amount":"300000000"}}"#), 1), None).done);
    // NEVER_CALLED holds on every receiver, in chains too.
    for m in ["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"] {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute_many(vec![Group { receiver_id: acct("bob.near"), steps: send(1) }, Group { receiver_id: acct("intents.near"), steps: call(m, "{}", 1) }])));
        assert!(r.is_err(), "{m}");
    }
    // Strangers can't touch owner methods.
    as_caller("thief.near", 6);
    for r in [
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(p.approve(U64(1))))),
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(p.run(U64(1))))),
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.finish_recovery())),
    ] {
        assert!(r.is_err());
    }
    let _ = get_logs();
}

#[test]
fn rolling_window_edges_hold() {
    as_account(0);
    let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }], None, None);
    assert!(p.execute(acct("b.near"), send(10 * NEAR), None).done);
    as_account(DAY - 1);
    assert!(!p.execute(acct("b.near"), send(1), None).done, "1 ns-scale step inside the window still counts");
    p.cancel(p.waiting_requests()[0].id);
    as_account(DAY);
    assert!(p.execute(acct("b.near"), send(10 * NEAR), None).done, "exactly 24 h later the first no longer counts");
    // At MAX_PENDING the queue refuses new held requests instead of letting them through.
    for _ in 0..20 {
        p.execute(acct("b.near"), send(100 * NEAR), None);
    }
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(acct("b.near"), send(100 * NEAR), None)));
    assert!(r.is_err());
}

// ══ Property test: Face ID never moves more than the Face ID band in any 24 h ═════════════════════════════════════

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

#[derive(Clone)]
struct Req {
    placed_s: u64,
}

const COINS: [&str; 3] = ["near", USDC, "nep141:wrap.near"];

fn random_request(rng: &mut Rng) -> (Vec<Group>, Vec<(String, u128)>) {
    let groups = 1 + rng.below(3) as usize;
    let mut gs = vec![];
    let mut total: Vec<(String, u128)> = vec![];
    let mut add = |c: &str, a: u128| match total.iter_mut().find(|(x, _)| x == c) {
        Some((_, t)) => *t += a,
        None => total.push((c.to_string(), a)),
    };
    for _ in 0..groups {
        let amount = match rng.below(4) {
            0 => rng.below(3) as u128 * NEAR,
            1 => (1 + rng.below(12)) as u128 * NEAR,
            2 => rng.below(10_000) as u128 * NEAR / 1000,
            _ => (rng.below(5) as u128 + 9) * NEAR + rng.below(2) as u128,
        };
        match rng.below(4) {
            0 => {
                gs.push(Group { receiver_id: acct("bob.near"), steps: send(amount) });
                add("near", amount);
            }
            1 => {
                let units = amount / 1_000_000_000_000_000_000; // 6-decimal coin
                gs.push(Group { receiver_id: USDC[7..].parse().unwrap(), steps: call("ft_transfer", &format!(r#"{{"receiver_id":"bob.near","amount":"{units}"}}"#), 1) });
                add("near", 1);
                add(USDC, units);
            }
            2 => {
                let coin = COINS[rng.below(3) as usize];
                let coin = if coin == "near" { "nep141:wrap.near" } else { coin };
                gs.push(Group { receiver_id: acct("intents.near"), steps: call("mt_transfer", &format!(r#"{{"receiver_id":"bob.near","token_id":"{coin}","amount":"{amount}"}}"#), 1) });
                add("near", 1);
                add(coin, amount);
            }
            _ => {
                // A call that moves nothing more than the NEAR attached (since F5 only allowlisted ones measure: staking).
                gs.push(Group { receiver_id: acct("pool.near"), steps: call("deposit_and_stake", "{}", amount) });
                add("near", amount);
            }
        }
    }
    (gs, total)
}

fn limits_of(bands: &[Band]) -> Vec<(String, u128)> {
    bands[0].up_to.clone().unwrap().into_iter().map(|(c, a)| (c, a.0)).collect()
}

#[test]
fn fuzz_face_id_never_exceeds_its_band_in_any_24h_and_held_requests_honour_their_level() {
    let band_sets: [Vec<Band>; 2] = [
        vec![
            Band { up_to: Some(vec![("near".into(), U128(10 * NEAR)), (USDC.into(), U128(10_000_000))]), level: Level::FaceId },
            Band { up_to: Some(vec![("near".into(), U128(100 * NEAR)), (USDC.into(), U128(100_000_000))]), level: Level::Wait { seconds: U64(3_600) } },
            Band { up_to: None, level: Level::Both { seconds: U64(3_600) } },
        ],
        vec![
            Band { up_to: Some(vec![("near".into(), U128(5 * NEAR)), (USDC.into(), U128(3_000_000)), ("nep141:wrap.near".into(), U128(2 * NEAR))]), level: Level::FaceId },
            Band { up_to: None, level: Level::Both { seconds: U64(7_200) } },
        ],
    ];
    let mut violations = 0;
    let mut face_id_runs = 0u64;
    let mut held_runs = 0u64;
    for seed in 1..=400u64 {
        let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        let mut now: u64 = 1;
        as_account(now);
        let mut p = AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None);
        assert!(p.add_second_device(key(9)).done);
        let mut current = band_sets[0].clone();
        assert!(p.set_protection(current.clone()).done);
        // (run time s, moves) for everything that ran at Face ID.
        let mut ran_face_id: Vec<(u64, Vec<(String, u128)>)> = vec![];
        let mut reqs: std::collections::HashMap<u64, Req> = Default::default();
        let mut pending_bands: std::collections::HashMap<u64, Vec<Band>> = Default::default();
        for _ in 0..80 {
            // Keep room in the queue (MAX_PENDING refusals are tested separately).
            if p.waiting_requests().len() >= 19 {
                let w = p.waiting_requests()[rng.below(19) as usize].id;
                p.cancel(w);
            }
            match rng.below(10) {
                0 | 1 | 2 | 3 => {
                    let (groups, total) = random_request(&mut rng);
                    let before = p.level_for_many(groups.clone());
                    let out = if groups.len() == 1 && rng.below(2) == 0 { p.execute(groups[0].receiver_id.clone(), groups[0].steps.clone(), None) } else { p.execute_many(groups) };
                    let id = out.id.unwrap().0;
                    assert_eq!(out.done, before == Level::FaceId, "level_for_many agrees with execute");
                    if out.done {
                        face_id_runs += 1;
                        ran_face_id.push((now, total.clone()));
                        // Property: everything that ran at Face ID in (now-24h, now] fits the Face ID band in force now.
                        let limits = limits_of(&current);
                        for (coin, _) in &total {
                            let sum: u128 = ran_face_id.iter().filter(|(t, _)| *t + DAY > now).flat_map(|(_, m)| m.iter()).filter(|(c, _)| c == coin).map(|(_, a)| *a).sum();
                            let limit = limits.iter().find(|(c, _)| c == coin).map(|(_, l)| *l);
                            if sum > 0 && limit.map_or(true, |l| sum > l) {
                                violations += 1;
                                eprintln!("seed {seed}: Face ID moved {sum} of {coin} in 24 h, limit {limit:?}");
                            }
                        }
                        // Since F6, the stronger property: the band is one budget, so the coins' shares of their limits,
                        // added up over the same 24 hours, are at most the whole (as f64: a tolerance well below one unit).
                        let shares: f64 = limits
                            .iter()
                            .map(|(c, l)| {
                                let sum: u128 = ran_face_id.iter().filter(|(t, _)| *t + DAY > now).flat_map(|(_, m)| m.iter()).filter(|(m, _)| m == c).map(|(_, a)| *a).sum();
                                sum as f64 / *l as f64
                            })
                            .sum();
                        if shares > 1.0 + 1e-9 {
                            violations += 1;
                            eprintln!("seed {seed}: Face ID used {shares:.6} of its one budget in 24 h");
                        }
                    } else {
                        reqs.insert(id, Req { placed_s: now });
                    }
                }
                4 => {
                    // Tighten or loosen: always strictest level.
                    let next = band_sets[rng.below(2) as usize].clone();
                    let out = p.set_protection(next.clone());
                    assert!(!out.done, "a change of protection never runs at once on a protected account");
                    pending_bands.insert(out.id.unwrap().0, next);
                }
                5 => {
                    if let Some(w) = p.waiting_requests().get(rng.below(25) as usize) {
                        p.cancel(w.id);
                    }
                }
                6 => {
                    if let Some(w) = p.waiting_requests().get(rng.below(25) as usize).cloned() {
                        if w.needs_device {
                            as_key(9, now);
                            let out = p.approve(w.id);
                            as_account(now);
                            if out.done {
                                held_runs += 1;
                                if let Some(b) = pending_bands.remove(&w.id.0) {
                                    current = b;
                                }
                                if let Some(r) = reqs.remove(&w.id.0) {
                                    assert!(now * SECOND >= w.ready_at_ns.0 && now >= r.placed_s, "ran before its wait");
                                }
                            }
                        }
                    }
                }
                7 => {
                    if let Some(w) = p.waiting_requests().get(rng.below(25) as usize).cloned() {
                        let ready = now * SECOND >= w.ready_at_ns.0 && (!w.needs_device || w.approved);
                        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(w.id)));
                        assert_eq!(r.is_ok(), ready, "run succeeds exactly when the wait is over and the device said yes");
                        if ready {
                            held_runs += 1;
                            if let Some(b) = pending_bands.remove(&w.id.0) {
                                current = b;
                            }
                            reqs.remove(&w.id.0);
                        }
                    }
                }
                _ => {
                    now += match rng.below(5) {
                        0 => 1,
                        1 => 3_599 + rng.below(3),
                        2 => DAY - 1 + rng.below(3),
                        3 => rng.below(DAY),
                        _ => rng.below(3 * DAY),
                    };
                    as_account(now);
                }
            }
        }
    }
    assert_eq!(violations, 0);
    // (One budget across coins, F6, lets fewer requests through at Face ID than per-coin limits did: about 190 of 1,560.)
    assert!(face_id_runs > 150 && held_runs > 300, "the fuzzer exercised both paths: {face_id_runs} Face ID, {held_runs} held");
}

/// Same property with the measurement itself in the loop: amounts the contract measured as moving must equal what the
/// steps actually move for every standard method (no under-count).
#[test]
fn fuzz_moves_never_under_counts_standard_transfers() {
    let mut rng = Rng(0xDEADBEEF);
    for _ in 0..5_000 {
        let (groups, total) = random_request(&mut rng);
        let mut measured: Vec<(String, u128)> = vec![];
        for g in &groups {
            for (c, a) in moves(g.receiver_id.as_str(), &g.steps).expect("standard steps are measurable") {
                match measured.iter_mut().find(|(x, _)| *x == c) {
                    Some((_, t)) => *t += a,
                    None => measured.push((c, a)),
                }
            }
        }
        for (c, a) in total {
            let m = measured.iter().find(|(x, _)| *x == c).map(|(_, v)| *v).unwrap_or(0);
            assert!(m >= a, "{c}: moved {a}, measured {m}");
        }
    }
}
