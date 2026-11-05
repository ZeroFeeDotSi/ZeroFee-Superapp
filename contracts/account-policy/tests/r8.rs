//! Release 8: the blind re-score's items (contract-proofs §11.6), each with the attack it closes and what still holds.
//! RS-1: a single `execute` carries at most 250 Tgas in all. RS-2: every call's gas counts as NEAR against the bands.
//! RK: a key removal never deletes the CURRENT backup key, re-checked when it runs. FB-3: a second device's key is
//! recorded only while NEAR has it (the add's callback forgets a device whose add failed; a failed refill adds it alone).
mod common;
use common::finish_ok;
use account_policy::{AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const TGAS: u64 = 1_000_000_000_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const OTHER: u8 = 0x0B;
const NEW_PHONE: u8 = 0x11;
const USDC: &str = "nep141:usdc.near";

fn me() -> AccountId {
    "me.near".parse().unwrap()
}

fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
}

fn ctx(fill: u8, now_s: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000));
    b
}

fn as_key(fill: u8, now_s: u64) {
    testing_env!(ctx(fill, now_s).build());
}

/// The callback's context: called by the account itself (a receipt it made), with the add's result.
fn as_callback(now_s: u64, result: PromiseResult) {
    testing_env!(ctx(PHONE, now_s).build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
}

fn refused<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn bob() -> AccountId {
    "bob.near".parse().unwrap()
}

fn call(method: &str, args: &str, gas_t: u64) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(1), gas: U64(gas_t * TGAS) }
}

/// A day's delay (floor 2 days), the words set, Face ID up to `small` NEAR (and 1,000 USDC units), else a day's wait.
fn account(small: u128) -> AccountPolicy {
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(small)), (USDC.into(), U128(1_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// Every receipt's actions, as text (the mock's own Debug form; a call's method name spelled out, as "call:<name>").
fn actions() -> Vec<String> {
    get_created_receipts()
        .into_iter()
        .map(|r| {
            r.actions
                .iter()
                .map(|a| match a {
                    near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } => format!("call:{}", String::from_utf8_lossy(method_name)),
                    other => format!("{other:?}"),
                })
                .collect::<Vec<_>>()
                .join(" | ")
        })
        .collect()
}

// ── RS-1: a single execute's gas in all ──────────────────────────────────────────────────────────────────────────

#[test]
fn rs1_a_single_execute_over_250_tgas_in_all_is_refused_at_the_door() {
    let mut p = account(NEAR);
    as_key(PHONE, 10);
    // The re-score's case: two 200 Tgas steps (each under the 300 Tgas step cap) could never run.
    assert!(refused(|| p.execute(bob(), vec![call("do_a", "{}", 200), call("do_b", "{}", 200)], None)));
    assert!(refused(|| p.execute(bob(), vec![call("do_a", "{}", 125), call("do_b", "{}", 125), Step::Transfer { deposit: U128(1) }, call("do_c", "", 1)], None)), "251 Tgas in all");
    // Ten steps whose gas would overflow a u64 if added plainly: refused, never wrapped round to a small number.
    assert!(refused(|| p.execute(bob(), (0..10).map(|_| call("do", "{}", 300)).collect(), None)));
    assert!(p.waiting_requests().is_empty(), "nothing was placed");
    assert!(p.spent_today().is_empty(), "nothing counts toward the 24 hours");
}

#[test]
fn rs1_exactly_250_tgas_in_all_is_placed() {
    let mut p = account(NEAR);
    as_key(PHONE, 10);
    // Unmeasurable calls: the strictest band (a day's wait), placed, not refused.
    let out = p.execute(bob(), vec![call("do_a", "{}", 125), call("do_b", "{}", 125), Step::Transfer { deposit: U128(1) }], None);
    assert!(!out.done && out.id.is_some());
    // The chain's own cap is unchanged: 250 Tgas of steps and links.
    as_key(PHONE, 11);
    let g = |gas_t: u64| Group { receiver_id: bob(), steps: vec![call("do", "{}", gas_t)] };
    assert!(refused(|| p.execute_many(vec![g(115), g(116)])), "231 + 2 links of 20 = 271 Tgas");
    assert!(p.execute_many(vec![g(105), g(105)]).id.is_some(), "210 + 40 = 250 Tgas");
}

// ── RS-2: every call's gas counts as NEAR ─────────────────────────────────────────────────────────────────────────

#[test]
fn rs2_a_coins_own_call_counts_its_gas_as_near() {
    // Face ID up to 0.5 NEAR (and 1 USDC; release 9 counts gas at 1e9 a unit). The re-score's burner: ft_transfer_call of 1 unit at 240 Tgas, again and again.
    let mut p = account(NEAR / 2);
    let burn = || vec![call("ft_transfer_call", r#"{"receiver_id":"burner.near","amount":"1","msg":""}"#, 240)];
    let per = 240 * TGAS as u128 * 1_000_000_000 + 1; // 0.24 NEAR of gas (release 9), and the 1 yocto deposit
    as_key(PHONE, 10);
    assert_eq!(p.level_for("usdc.near".parse().unwrap(), burn(), None), Level::FaceId);
    assert!(p.execute("usdc.near".parse().unwrap(), burn(), None).done, "the first runs at Face ID");
    let near_today = |p: &AccountPolicy| p.spent_today().into_iter().find(|(c, _)| c == "near").map_or(0, |(_, a)| a.0);
    assert_eq!(near_today(&p), per, "its gas counts as NEAR");
    as_key(PHONE, 11);
    assert!(p.execute("usdc.near".parse().unwrap(), burn(), None).done, "the second fits too: 0.48 NEAR");
    // The third would pass the band's 0.5 NEAR: it waits. So a thief's gas burn is held to the band, as any spend is.
    as_key(PHONE, 12);
    assert_eq!(p.level_for("usdc.near".parse().unwrap(), burn(), None), Level::Wait { seconds: U64(DAY) });
    let third = p.execute("usdc.near".parse().unwrap(), burn(), None);
    assert!(!third.done, "the third waits");
    assert_eq!(near_today(&p), 3 * per);
}

#[test]
fn rs2_gas_counts_on_intents_and_on_the_allowlist_alike() {
    let p = account(NEAR);
    as_key(PHONE, 10);
    let m = account_policy::moves("intents.near", &[call("ft_withdraw", r#"{"token":"usdc.near","receiver_id":"bob.near","amount":"5"}"#, 100)]).unwrap();
    assert_eq!(m, vec![("near".to_string(), 1 + 100 * TGAS as u128 * 1_000_000_000), (USDC.to_string(), 5)]);
    let m = account_policy::moves("wrap.near", &[call("near_deposit", "", 10)]).unwrap();
    assert_eq!(m, vec![("near".to_string(), 1 + 10 * TGAS as u128 * 1_000_000_000)], "the allowlist's count is unchanged (FB-1)");
    // A transfer carries no gas: it counts its NEAR only.
    assert_eq!(account_policy::moves("bob.near", &[Step::Transfer { deposit: U128(5) }]).unwrap(), vec![("near".to_string(), 5)]);
    // Unmeasurable stays unmeasurable (the strictest band), gas or not.
    assert_eq!(account_policy::moves("bob.near", &[call("do", "{}", 1)]), None);
    drop(p);
}

#[test]
fn rs2_a_band_without_near_never_lets_a_call_through_at_its_level() {
    // A band listing only USDC (the app's always list NEAR too): a USDC call now moves NEAR (its gas), so it can't fit
    // that band and takes a stricter one. Stricter, never looser.
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![(USDC.into(), U128(1_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert_eq!(p.level_for("usdc.near".parse().unwrap(), vec![call("ft_transfer", r#"{"receiver_id":"bob.near","amount":"5"}"#, 10)], None), Level::Wait { seconds: U64(DAY) });
}

// ── RK: a removal never deletes the CURRENT backup key ──────────────────────────────────────────────────────────

/// The re-score's sequence: remove_key(K) waits; set_recovery_key(K) waits (K isn't in use yet); the new words run first,
/// then the removal. Release 7 deleted K's access key while the state still named it the backup; release 8 refuses.
#[test]
fn rk_a_removal_asked_before_new_words_never_deletes_them() {
    let mut p = account(NEAR);
    const K: u8 = 0x4B;
    as_key(PHONE, 10);
    let remove = p.remove_key(key(K));
    assert!(!remove.done);
    as_key(PHONE, 11);
    let words = p.set_recovery_key(key(K));
    assert!(!words.done, "new words wait the floor");
    as_key(PHONE, 11 + 3 * DAY);
    assert!(p.run(words.id.unwrap()).done);
    // K is the backup key now: its removal is refused when it runs, with the reason, and deletes nothing.
    as_key(PHONE, 12 + 3 * DAY);
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(remove.id.unwrap()))).err().map(|e| e.downcast_ref::<String>().cloned().unwrap_or_default()).unwrap_or_default();
    assert!(err.contains("the backup key changes only with new backup words"), "{err}");
    assert!(!actions().iter().any(|a| a.contains("DeleteKey")), "no key deleted: {:?}", actions());
    // The words still work: they start a recovery.
    as_key(K, 13 + 3 * DAY);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.recovery_status().is_some());
}

#[test]
fn rk_the_other_order_still_ends_with_k_as_the_backup_key() {
    let mut p = account(NEAR);
    const K: u8 = 0x4B;
    as_key(PHONE, 10);
    let remove = p.remove_key(key(K));
    as_key(PHONE, 11);
    let words = p.set_recovery_key(key(K));
    // The removal runs first (K isn't on the account: its delete fails only its own receipt), then the words add K.
    as_key(PHONE, 11 + 3 * DAY);
    assert!(p.run(remove.id.unwrap()).done);
    assert!(p.run(words.id.unwrap()).done);
    as_key(K, 12 + 3 * DAY);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.recovery_status().is_some(), "K is the backup key");
}

#[test]
fn rk_the_current_backup_key_is_refused_at_the_door_too() {
    // Release 7's check at the door stays: the current backup key is never even placed for removal.
    let mut p = account(NEAR);
    as_key(PHONE, 10);
    assert!(refused(|| p.remove_key(key(WORDS))), "at the door, as in release 7");
}

// ── FB-3: a second device recorded only while NEAR has it ─────────────────────────────────────────────────────────

fn with_laptop() -> AccountPolicy {
    let mut p = account(NEAR);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done, "in the first 24 hours: at once");
    p
}

#[test]
fn fb3_an_add_is_followed_by_its_check() {
    let _p = with_laptop();
    let a = actions();
    assert!(a.iter().any(|x| x.contains("AddKeyWithFunctionCall")), "the key is added: {a:?}");
    assert!(a.iter().any(|x| x.contains("call:on_second_device_key")), "and the callback follows it: {a:?}");
}

#[test]
fn fb3_a_failed_add_forgets_the_device() {
    let p = with_laptop();
    assert_eq!(p.second_device_count(), 1);
    env::state_write(&p);
    as_callback(11, PromiseResult::Failed);
    AccountPolicy::on_second_device_key(key(LAPTOP), false);
    let p: AccountPolicy = env::state_read().unwrap();
    assert_eq!(p.second_device_count(), 0, "a device NEAR doesn't have isn't recorded");
    assert!(p.second_device_ages().is_empty());
    assert!(get_logs().iter().any(|l| l.contains("second_device_not_added")));
    assert!(actions().is_empty(), "the callback deletes no key (a failed add can't remove a key already there): {:?}", actions());
    // So it never counts as of age: after the floor, a recovery finishes after the delay alone (no fallback forced).
    as_key(WORDS, 10 + 4 * DAY);
    let mut p = p;
    p.start_recovery(key(NEW_PHONE));
    assert!(!p.recovery_status().unwrap().needs_device);
    as_key(WORDS, 10 + 5 * DAY);
    finish_ok(&mut p);
    assert!(p.recovery_status().is_none());
}

#[test]
fn fb3_a_successful_add_changes_nothing() {
    let p = with_laptop();
    env::state_write(&p);
    as_callback(11, PromiseResult::Successful(vec![]));
    AccountPolicy::on_second_device_key(key(LAPTOP), false);
    let p: AccountPolicy = env::state_read().unwrap();
    assert_eq!(p.second_device_count(), 1);
    assert!(actions().is_empty(), "no receipt: {:?}", actions());
}

#[test]
fn fb3_a_failed_refill_adds_the_key_alone() {
    let mut p = with_laptop();
    as_key(PHONE, 20);
    assert!(p.add_second_device(key(LAPTOP)).done, "the refill goes at once");
    assert!(actions().iter().any(|x| x.contains("call:on_second_device_key")), "the refill is followed by its check");
    env::state_write(&p);
    as_callback(21, PromiseResult::Failed);
    AccountPolicy::on_second_device_key(key(LAPTOP), true);
    let a = actions();
    assert_eq!(a.len(), 1, "one receipt: the add alone {a:?}");
    assert!(!a[0].contains("DeleteKey") && a[0].contains("approve_recovery"), "{a:?}");
    let p: AccountPolicy = env::state_read().unwrap();
    assert_eq!(p.second_device_count(), 1, "a refill never removes the device");
}

#[test]
fn fb3_the_check_leaves_a_device_removed_meanwhile_and_any_other_key_alone() {
    let p = with_laptop();
    env::state_write(&p);
    as_callback(11, PromiseResult::Failed);
    AccountPolicy::on_second_device_key(key(OTHER), false);
    AccountPolicy::on_second_device_key(key(OTHER), true);
    let p: AccountPolicy = env::state_read().unwrap();
    assert_eq!(p.second_device_count(), 1, "the laptop stays");
    assert!(actions().is_empty(), "nothing added or deleted for a key that isn't a second device: {:?}", actions());
}

// `#[private]` (only the account's own receipts may call `on_second_device_key`) is enforced by near-sdk's wasm entry
// point, which unit tests bypass: it is checked on the node (the red team's r8 record).

#[test]
fn fb3_a_failed_add_of_the_last_device_leaves_no_level_needing_one() {
    let mut p = with_laptop();
    as_key(PHONE, 12);
    let both = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::Device }, Band { up_to: None, level: Level::Both { seconds: U64(DAY) } }];
    let set = p.set_protection(both); // the strictest level: a day's wait (no floor in the first 24 hours)
    as_key(PHONE, 12 + DAY);
    assert!(p.run(set.id.unwrap()).done);
    assert!(p.protection().iter().any(|b| b.level == Level::Device));
    env::state_write(&p);
    as_callback(13 + DAY, PromiseResult::Failed);
    AccountPolicy::on_second_device_key(key(LAPTOP), false);
    let p: AccountPolicy = env::state_read().unwrap();
    assert!(p.protection().iter().all(|b| !matches!(b.level, Level::Device | Level::Both { .. })), "{:?}", p.protection());
    assert!(p.protection().iter().all(|b| matches!(b.level, Level::Wait { seconds } if seconds.0 >= 2 * DAY)), "each waits at least the floor");
}

// ── Upgrade ──────────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn r8_upgrade_check_takes_a_release_7_account_and_never_goes_back() {
    let p = with_laptop();
    assert_eq!(p.release_version(), account_policy::RELEASE_VERSION);
    as_key(PHONE, 20);
    // Release 9 adds a second-device method (refill_recovery_key): from 7 or 8 the laptop's key is renewed; from 9, nothing.
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(7, None);
    assert!(actions().iter().any(|a| a.contains("refill_recovery_key")), "from release 7 the laptop gets the fifth method: {:?}", actions());
    as_key(PHONE, 21);
    // From an earlier build of the current release (round 4's, marker 10_003): every role key is renewed, as on every
    // install (round 4c, S1-1 and the audit's ruling): the laptop and the phone's keys (Agent's methods) too.
    near_sdk::env::storage_write(b"installed", &near_sdk::borsh::to_vec(&10_003u32).unwrap());
    p.upgrade_check(account_policy::RELEASE_VERSION, None);
    let acts = actions();
    assert!(acts.iter().any(|a| a.contains("refill_recovery_key")), "S1-1: the laptop is renewed on every install: {acts:?}");
    assert!(acts.iter().any(|a| a.contains("agent_set")), "round 4c: the phone's keys are renewed on every install: {acts:?}");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(8, None);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused(|| p.upgrade_check(account_policy::RELEASE_VERSION + 1, None)));
}

// ── R8-F1 (found by the widened fuzzer on release 8): a removal never takes the phone ─────────────────────────────

/// The fuzzer's exact sequence: the phone asks to remove K5 (a key with no role yet), the aged laptop co-signs it so a
/// recovery start doesn't drop it, the words start a recovery TO K5, the laptop says yes, the words finish (K5 is now the
/// only phone), then the removal runs. Before the fix it deleted the only phone key; now the finish drops it.
#[test]
fn r8_f1_a_removal_of_the_recoverys_new_key_never_outlives_the_finish() {
    let mut p = account(NEAR);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done, "set-up window: at once");
    const K5: u8 = 0x55;
    let t = 10 + 7 * DAY; // the laptop has been on the account for the fallback (release 10, F1)
    as_key(PHONE, t);
    let remove = p.remove_key(key(K5));
    assert!(!remove.done);
    as_key(LAPTOP, t + 1);
    p.approve(remove.id.unwrap()); // co-signed: it survives the start
    as_key(WORDS, t + 2);
    p.start_recovery(key(K5));
    assert!(p.waiting_requests().iter().any(|w| w.id == remove.id.unwrap()), "co-signed, it survived the start");
    let st = p.recovery_status().unwrap();
    as_key(LAPTOP, t + 3);
    p.approve_recovery(st.new_key.clone(), st.ready_at_ns);
    // While the recovery waits (and once its own wait is over), the removal of the new key is refused if run.
    as_key(PHONE, t + 3 * DAY);
    assert!(refused(|| p.run(remove.id.unwrap())), "refused while the recovery to that key waits");
    as_key(WORDS, t + 3 * DAY);
    finish_ok(&mut p);
    assert!(!p.waiting_requests().iter().any(|w| w.id == remove.id.unwrap()), "the finish dropped the removal of the new phone's key");
    as_key(K5, t + 4 * DAY);
    assert!(refused(|| p.run(remove.id.unwrap())), "it can't run: it is gone");
    assert!(p.execute(bob(), vec![Step::Transfer { deposit: U128(1) }], None).done, "K5 is the phone and pays");
}

/// The run-time re-check alone (an account whose phones are learned, not named at `new`): a removal never takes the
/// last key on the device list, whoever asked it.
#[test]
fn r8_f1_a_removal_never_takes_the_only_phone_key() {
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, None, None);
    const Q: u8 = 0x44;
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done); // the phone is learned
    as_key(Q, 2);
    let rm_phone = p.remove_key(key(PHONE)); // Q is learned too: the list is [PHONE, Q]
    as_key(PHONE, 3);
    let rm_q = p.remove_key(key(Q));
    as_key(PHONE, 3 + 3 * DAY);
    assert!(p.run(rm_q.id.unwrap()).done, "Q goes: the list is [PHONE]");
    let err = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.run(rm_phone.id.unwrap()))).err().map(|e| e.downcast_ref::<String>().cloned().unwrap_or_default()).unwrap_or_default();
    assert!(err.contains("only phone key"), "{err}");
}
