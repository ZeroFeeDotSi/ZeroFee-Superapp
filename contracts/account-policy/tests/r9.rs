//! Release 9: the second blind re-score's items (contract-proofs §12.9), each with the attack it closes.
//! RS1 (R8-RS1): a recovery's finish deletes the old phone keys only in a callback that saw the new key's add succeed.
//! AL: an upgrade goes only to a release on the account's list; the list grows only co-signed or after the fallback.
//! RF: a second device of age refills the backup words' fee allowance (I-2). GP: gas counts at 1e9 yocto a unit (I-4).
mod common;
use account_policy::{AccountPolicy, Band, Change, Level, Step};
use common::{finish_ok, finish_with, same_context};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
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
const LAPTOP2: u8 = 0x0A;
const NEW_PHONE: u8 = 0x11;
/// A day's delay: the floor is 2 days, the fallback 7.
const FLOOR: u64 = 2 * DAY;
const FALLBACK: u64 = 7 * DAY;

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

fn refused<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn refused_with<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
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

fn deletes(acts: &[MockAction]) -> usize {
    acts.iter().filter(|a| matches!(a, MockAction::DeleteKey { .. })).count()
}

fn adds(acts: &[MockAction]) -> usize {
    acts.iter().filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })).count()
}

fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}

fn bob() -> AccountId {
    "bob.near".parse().unwrap()
}

/// A day's delay, the words set, Face ID up to 1 NEAR, else a day's wait.
fn account() -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// The same with a laptop added at once (the setup window) and of age from FLOOR + 10.
fn with_laptop() -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    p
}

/// The callback alone, as NEAR runs it after the add (state from storage, the add's result as given).
thread_local! {
    /// When the last `finish` ran (its callback names it: re-freeze 2).
    static LAST_FINISH: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// `finish_recovery` alone (its callback not yet run), remembering when.
fn finish(p: &mut AccountPolicy) {
    LAST_FINISH.with(|c| c.set(env::block_timestamp()));
    p.finish_recovery();
}

/// The callback of the last `finish`.
fn callback(p: &mut AccountPolicy, now_s: u64, result: PromiseResult, new_key: Base64VecU8, ready_at_ns: U64) {
    callback_of(p, now_s, result, new_key, ready_at_ns, U64(LAST_FINISH.with(|c| c.get())));
}

/// The callback of the finish asked at `asked_at_ns`.
fn callback_of(p: &mut AccountPolicy, now_s: u64, result: PromiseResult, new_key: Base64VecU8, ready_at_ns: U64, asked_at_ns: U64) {
    env::state_write(&*p);
    as_key(PHONE, now_s);
    let ctx = same_context();
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    AccountPolicy::on_recovery_key(new_key, ready_at_ns, asked_at_ns);
    *p = env::state_read().unwrap();
}

/// A recovery to NEW_PHONE started at `t`, the words at its finish time; returns its ready_at_ns.
fn start(p: &mut AccountPolicy, t: u64) -> U64 {
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    let r = p.pending().unwrap().ready_at_ns;
    as_key(WORDS, t + DAY);
    r
}

// ── RS1: the finish's add is checked before the old keys go ─────────────────────────────────────────────────────

#[test]
fn rs1_the_finish_only_adds_the_new_key_and_asks_for_its_check() {
    let mut p = account();
    start(&mut p, 100);
    finish(&mut p);
    let acts = actions();
    assert_eq!((adds(&acts), deletes(&acts)), (1, 1), "{acts:?}");
    // The one delete is of the new key itself (a copy an earlier finish may have left: re-freeze 2), never an old key.
    assert!(acts.iter().all(|a| !matches!(a, MockAction::DeleteKey { public_key, .. } if near_sdk::borsh::to_vec(public_key).unwrap() != key(NEW_PHONE).0)), "{acts:?}");
    let r = get_created_receipts();
    assert_eq!(r.len(), 3, "delete, then add, then the callback: {r:?}");
    assert!(matches!(r[0].actions[..], [MockAction::DeleteKey { .. }]) && matches!(r[1].actions[..], [MockAction::AddKeyWithFunctionCall { .. }]), "{r:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_recovery_key")));
    assert!(p.pending().is_some(), "nothing is finished until the callback has seen the add");
    assert!(get_logs().iter().any(|l| l.contains("recovery_finishing")));
}

#[test]
fn rs1_a_failed_add_keeps_the_old_phone_and_the_recovery() {
    let mut p = account();
    start(&mut p, 100);
    finish_with(&mut p, PromiseResult::Failed);
    assert_eq!(deletes(&actions()), 0, "no key is deleted");
    assert!(get_logs().iter().any(|l| l.contains("recovery_key_not_added")));
    assert!(p.pending().is_some(), "the recovery still waits");
    // The old phone is still the phone (its spending waits, as during any recovery).
    as_key(PHONE, 100 + DAY + 1);
    assert!(!refused(|| copy_of(&p).execute(bob(), send(1), None)));
    // And the new key is not: a key whose add failed never acts.
    as_key(NEW_PHONE, 100 + DAY + 1);
    assert!(refused(|| copy_of(&p).execute(bob(), send(1), None)));
    // The words finish again (after a top-up): now it finishes and only then do the old keys go.
    as_key(WORDS, 100 + DAY + 2);
    finish_ok(&mut p);
    assert!(p.pending().is_none());
    assert_eq!(deletes(&actions()), 2, "the old phone and the setup key");
    as_key(PHONE, 100 + DAY + 3);
    assert!(refused(|| copy_of(&p).execute(bob(), send(1), None)), "the old phone is replaced");
    as_key(NEW_PHONE, 100 + DAY + 3);
    assert!(copy_of(&p).execute(bob(), send(1), None).done, "the new phone acts");
}

#[test]
fn rs1_one_finish_at_a_time_and_a_lost_callback_can_be_retried_after_an_hour() {
    let mut p = account();
    let ready = start(&mut p, 100);
    finish(&mut p);
    assert!(refused_with(|| copy_of(&p).finish_recovery()).contains("finishing already"));
    as_key(WORDS, 100 + DAY + 3_599);
    assert!(refused(|| copy_of(&p).finish_recovery()));
    // The callback never ran (out of gas): an hour later the words may ask again.
    as_key(WORDS, 100 + DAY + 3_600);
    finish(&mut p);
    // Re-freeze 2 (the red team's RT3): the first add may have succeeded (the key is on NEAR), so the retry deletes that
    // copy in its own receipt first and adds the key in a receipt chained after it, which runs whatever the delete did.
    // Before, the retry's add met AddKeyAlreadyExists, its callback saw a failure, and no finish could ever complete.
    let r = get_created_receipts();
    assert!(matches!(&r[0].actions[..], [MockAction::DeleteKey { public_key, .. }] if near_sdk::borsh::to_vec(public_key).unwrap() == key(NEW_PHONE).0), "{r:?}");
    assert!(matches!(&r[1].actions[..], [MockAction::AddKeyWithFunctionCall { public_key, .. }] if near_sdk::borsh::to_vec(public_key).unwrap() == key(NEW_PHONE).0), "{r:?}");
    assert_eq!(r[1].receipt_indices, vec![0], "the add waits for the delete: {r:?}");
    assert!(matches!(&r[2].actions[..], [MockAction::FunctionCallWeight { method_name, .. }] if method_name == b"on_recovery_key"), "then the callback: {r:?}");
    callback(&mut p, 100 + DAY + 3_601, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready);
    assert!(p.pending().is_none());
}

#[test]
fn rs1_the_new_key_acts_only_once_its_recovery_has_finished() {
    let mut p = account();
    let ready = start(&mut p, 100);
    // While its recovery waits (its key isn't on NEAR, but the contract doesn't rely on that).
    as_key(NEW_PHONE, 100 + 10);
    assert!(refused_with(|| copy_of(&p).execute(bob(), send(1), None)).contains("only when the move to it has finished"));
    as_key(WORDS, 100 + DAY);
    finish(&mut p);
    // Between the add and the callback: the key is on NEAR, and still can't act nor take a role.
    as_key(NEW_PHONE, 100 + DAY);
    assert!(refused(|| copy_of(&p).execute(bob(), send(1), None)));
    assert!(refused(|| copy_of(&p).cancel_recovery()));
    as_key(PHONE, 100 + DAY);
    assert!(refused_with(|| copy_of(&p).add_second_device(key(NEW_PHONE))).contains("already on this account"));
    callback(&mut p, 100 + DAY + 1, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready);
    as_key(NEW_PHONE, 100 + DAY + 2);
    assert!(p.execute(bob(), send(1), None).done);
}

/// The phone stops the recovery after the words' finish but before its callback (no second device: the stop is at
/// once). The callback then sees no such recovery: nothing finishes, and the new key comes off NEAR again.
#[test]
fn rs1_a_recovery_ended_before_the_callback_never_finishes_and_its_key_goes() {
    let mut p = account();
    let ready = start(&mut p, 100);
    finish(&mut p);
    as_key(PHONE, 100 + DAY);
    assert!(p.cancel_recovery().done);
    callback(&mut p, 100 + DAY + 1, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready);
    let acts = actions();
    assert_eq!(deletes(&acts), 1, "only the new key, which has no role: {acts:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::DeleteKey { public_key, .. } if near_sdk::borsh::to_vec(public_key).unwrap() == key(NEW_PHONE).0)));
    assert!(get_logs().iter().any(|l| l.contains("recovery_not_finished")));
    as_key(PHONE, 100 + DAY + 2);
    assert!(!refused(|| copy_of(&p).execute(bob(), send(1), None)), "the old phone stays the phone");
    as_key(NEW_PHONE, 100 + DAY + 2);
    assert!(refused(|| copy_of(&p).execute(bob(), send(1), None)), "the sealed list never learns the new key");
    // Release 10 (R2): until NEAR has deleted it, the key takes no role, a later recovery's included.
    as_key(WORDS, 100 + DAY + 3 * DAY);
    assert!(refused(|| copy_of(&p).start_recovery(key(NEW_PHONE))), "its delete hasn't run yet");
    AccountPolicy::on_recovery_key_deleted(key(NEW_PHONE));
    // Then a later recovery to the same key works as any (the marker is gone).
    p.start_recovery(key(NEW_PHONE));
}

/// A second device of age that said yes is removed before the callback (a co-signed removal ran meanwhile), and another
/// device of age is still there: the finish's rule (that device's yes, or the fallback) is checked again by the callback.
#[test]
fn rs1_the_callback_checks_the_finish_rule_again() {
    let mut p = with_laptop();
    as_key(PHONE, 20);
    assert!(!p.add_second_device(key(LAPTOP2)).done);
    let id = p.waiting_requests()[0].id;
    as_key(LAPTOP, FLOOR + 20);
    assert!(p.approve(id).done, "the aged laptop co-signs the second laptop");
    // Both of age at FLOOR + 20 + FLOOR. Then a co-signed removal of LAPTOP, asked now (it waits the fallback).
    let t = FALLBACK + 30; // release 10 (F1): its laptop on the account for the fallback
    as_key(PHONE, t);
    let rm = p.remove_key(key(LAPTOP)).id.unwrap();
    as_key(LAPTOP2, t + 1);
    p.approve(rm);
    let ready = start(&mut p, t + 2);
    as_key(LAPTOP, t + 3);
    p.approve_recovery(key(NEW_PHONE), ready);
    as_key(WORDS, t + 2 + DAY);
    finish(&mut p);
    // The removal runs before the callback (it waited the fallback; set the clock there).
    let at = t + FALLBACK + 1;
    as_key(PHONE, at);
    assert!(p.run(rm).done);
    assert_eq!(p.second_devices_of_age(), 1, "LAPTOP2 is still of age; the yes was LAPTOP's");
    callback(&mut p, at, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready);
    assert!(get_logs().iter().any(|l| l.contains("recovery_not_finished")), "{:?}", get_logs());
    assert!(p.pending().is_some(), "the recovery still waits: its yes came from a device no longer on the account");
    let acts = actions();
    assert_eq!(deletes(&acts), 1, "only the new key comes off NEAR again: {acts:?}");
    as_key(PHONE, at + 1);
    assert!(!refused(|| copy_of(&p).execute(bob(), send(1), None)), "the old phone stays the phone");
    // After the fallback the words finish without a yes. Release 10 (round 2, G-L1): once that delete's receipt has run
    // (NEAR runs it within a block or two); a finish before then is refused.
    as_key(WORDS, t + 2 + FALLBACK);
    assert!(refused(|| copy_of(&p).finish_recovery()));
    AccountPolicy::on_recovery_key_deleted(key(NEW_PHONE));
    finish_ok(&mut p);
    assert!(p.pending().is_none());
}

// ── AL: the release allowlist ───────────────────────────────────────────────────────────────────────────────────

fn hash(b: u8) -> Base64VecU8 {
    Base64VecU8(vec![b; 32])
}

#[test]
fn al_an_unlisted_release_is_added_first_and_the_phone_alone_waits_the_fallback() {
    let mut p = account();
    as_key(PHONE, 10);
    let out = p.upgrade(hash(1));
    let w = p.waiting_requests();
    assert!(matches!(&w[0].change, Change::AllowRelease { code_hash, asked_at_ns } if code_hash.0 == vec![1; 32] && asked_at_ns.0 == 10 * SECOND), "{w:?}");
    // The switch can be asked while the addition waits, and is placed as a switch.
    let up = p.upgrade(hash(1));
    assert!(matches!(&p.waiting_requests()[1].change, Change::Upgrade { .. }));
    as_key(PHONE, 10 + FLOOR);
    assert!(refused_with(|| copy_of(&p).run(out.id.unwrap())).contains("fallback"), "a change's wait isn't enough alone");
    assert!(refused_with(|| copy_of(&p).run(up.id.unwrap())).contains("isn't on this account's list"), "nor runs the switch first");
    as_key(PHONE, 10 + FALLBACK - 1);
    assert!(refused(|| copy_of(&p).run(out.id.unwrap())));
    as_key(PHONE, 10 + FALLBACK);
    assert!(p.run(out.id.unwrap()).done);
    assert_eq!(p.allowed_releases(), vec![hash(1)]);
    assert!(p.run(up.id.unwrap()).done);
    assert!(actions().iter().any(|a| matches!(a, MockAction::UseGlobalContract { .. })));
}

#[test]
fn al_a_second_device_of_age_co_signs_it_and_it_runs_after_a_changes_wait() {
    let mut p = with_laptop();
    as_key(PHONE, FLOOR + 20);
    let out = p.upgrade(hash(2));
    as_key(LAPTOP, FLOOR + 21);
    assert!(!p.approve(out.id.unwrap()).done, "co-signed, it still waits its change's wait");
    // Release 10 (R9-AL1): the laptop's yes counts only once it has been on the account for the fallback wait (added at
    // 10 s): at twice the floor it hasn't (tests/r10.rs checks the refusal); from 10 + FALLBACK it runs.
    as_key(PHONE, 10 + FALLBACK);
    assert!(p.run(out.id.unwrap()).done);
    assert_eq!(p.allowed_releases(), vec![hash(2)]);
}

#[test]
fn al_a_young_devices_yes_never_counts_as_the_co_sign() {
    let mut p = with_laptop();
    as_key(PHONE, 20);
    let out = p.upgrade(hash(3));
    as_key(LAPTOP, 21);
    assert!(refused(|| copy_of(&p).approve(out.id.unwrap())), "a young device can't co-sign a change");
    as_key(PHONE, 20 + FLOOR + 1);
    assert!(refused(|| copy_of(&p).run(out.id.unwrap())), "nobody co-signed: the fallback");
}

#[test]
fn al_the_words_start_drops_a_phone_alone_addition_and_its_switch() {
    let mut p = account();
    as_key(PHONE, 10);
    p.upgrade(hash(4));
    p.upgrade(hash(4));
    as_key(WORDS, 11);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.waiting_requests().is_empty());
    assert!(p.allowed_releases().is_empty());
}

#[test]
fn al_a_switch_never_runs_to_a_release_that_never_got_on_the_list() {
    let mut p = account();
    as_key(PHONE, 10);
    let add = p.upgrade(hash(5));
    let up = p.upgrade(hash(5));
    p.cancel(add.id.unwrap());
    as_key(PHONE, 10 + 31 * DAY);
    assert!(refused(|| copy_of(&p).run(up.id.unwrap())));
    // And a new switch to it asks for the addition again.
    p.upgrade(hash(5));
    assert!(p.waiting_requests().iter().any(|w| matches!(&w.change, Change::AllowRelease { .. })));
}

#[test]
fn al_upgrade_check_sets_the_list_to_the_release_being_installed() {
    let mut p = account();
    as_key(PHONE, 10);
    let add = p.upgrade(hash(6));
    as_key(PHONE, 10 + FALLBACK);
    p.run(add.id.unwrap());
    assert_eq!(p.allowed_releases(), vec![hash(6)]);
    // From release 8 (no hash given): empty, so a later release needs an addition first.
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(8, None);
    assert!(p.allowed_releases().is_empty());
    // From release 9 on, the switch tells the new code its hash: the list is exactly that.
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, Some(hash(7)));
    assert_eq!(p.allowed_releases(), vec![hash(7)]);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused(|| p.upgrade_check(9, Some(Base64VecU8(vec![1; 31])))), "a release is 32 bytes");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused(|| p.upgrade_check(account_policy::RELEASE_VERSION + 1, None)), "never back to an older release");
}

#[test]
fn al_the_list_holds_at_most_four_and_drops_the_oldest() {
    let mut p = account();
    for b in 1..=5u8 {
        let t = 10 + u64::from(b) * (FALLBACK + 1);
        as_key(PHONE, t);
        let add = p.upgrade(hash(b));
        as_key(PHONE, t + FALLBACK);
        assert!(p.run(add.id.unwrap()).done);
    }
    assert_eq!(p.allowed_releases(), vec![hash(2), hash(3), hash(4), hash(5)]);
}

// ── RF: a second device of age refills the backup words ─────────────────────────────────────────────────────────

#[test]
fn rf_an_aged_second_device_refills_the_words_key() {
    let mut p = with_laptop();
    as_key(LAPTOP, FLOOR + 10);
    let _ = get_created_receipts();
    p.refill_recovery_key();
    let acts = actions();
    assert_eq!((deletes(&acts), adds(&acts)), (1, 1), "one delete-and-add batch: {acts:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, allowance: Some(t), method_names, .. } if near_sdk::borsh::to_vec(public_key).unwrap() == key(WORDS).0 && t.as_yoctonear() == 250_000_000_000_000_000_000_000 && *method_names == vec!["start_recovery".to_string(), "finish_recovery".to_string(), "end_dispute".to_string()])));
    assert_eq!(get_created_receipts().len(), 1);
    // Also while a recovery waits (the case it is for: the phone lost, leaked words draining the allowance).
    as_key(WORDS, FLOOR + 11);
    p.start_recovery(key(NEW_PHONE));
    // Release 10 (round 2, L3): a day after the last refill (at most one a day); the recovery still waits (a day's delay).
    as_key(LAPTOP, FLOOR + 10 + DAY);
    assert!(p.recovery_status().is_some());
    p.refill_recovery_key();
    assert_eq!(adds(&actions()), 1);
}

#[test]
fn rf_only_a_second_device_of_age_refills() {
    let p = with_laptop();
    as_key(LAPTOP, FLOOR + 9);
    assert!(refused_with(|| copy_of(&p).refill_recovery_key()).contains("less than a change's wait"));
    for k in [PHONE, WORDS, NEW_PHONE] {
        as_key(k, FLOOR + 20);
        assert!(refused_with(|| copy_of(&p).refill_recovery_key()).contains("only a second device"));
    }
}

#[test]
fn rf_an_account_without_words_has_nothing_to_refill() {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(LAPTOP, FLOOR + 10);
    assert!(refused_with(|| copy_of(&p).refill_recovery_key()).contains("no backup words"));
}

#[test]
fn rf_upgrade_check_from_8_gives_every_second_device_the_fifth_method() {
    let p = with_laptop();
    as_key(PHONE, 20);
    let _ = get_created_receipts();
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(8, None);
    let acts = actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { method_names, allowance: Some(t), .. } if method_names.iter().any(|m| m == "refill_recovery_key") && method_names.len() == 5 && *t == NearToken::from_near(1))), "{acts:?}");
    // One renewal for the laptop and, release 10 (round 2, the laptop veto), one for the words' key with its third method
    // (release 10 also renews the phone's keys, with no fee limit: not counted here).
    assert_eq!(acts.iter().filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { allowance: Some(_), .. })).count(), 2);
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } if near_sdk::borsh::to_vec(public_key).unwrap() == key(WORDS).0 && method_names.len() == 3 && method_names[2] == "end_dispute")), "{acts:?}");
    as_key(PHONE, 21);
    // From an earlier build of the current release (round 4's, marker 10_003): the laptop and the words again, as on
    // every install (round 4c, S1-1), and the phone's keys too (the audit's ruling: every role key on every install).
    near_sdk::env::storage_write(b"installed", &near_sdk::borsh::to_vec(&10_003u32).unwrap());
    p.upgrade_check(account_policy::RELEASE_VERSION, None);
    let acts = actions();
    assert_eq!(acts.iter().filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { allowance: Some(_), .. })).count(), 2, "{acts:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { allowance: None, .. })), "the phone's key: {acts:?}");
}

// ── GP: gas at a conservative price ──────────────────────────────────────────────────────────────────────────────

#[test]
fn gp_gas_counts_at_ten_times_the_lowest_price() {
    let call = |gas_t: u64| Step::FunctionCall { method_name: "near_deposit".into(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas_t * TGAS) };
    assert_eq!(account_policy::moves("wrap.near", &[call(1)]).unwrap(), vec![("near".to_string(), 1_000 * NEAR / 1_000_000)], "1 Tgas = 0.001 NEAR");
    // A request's most (250 Tgas) counts as 0.25 NEAR: what it could burn at ten times NEAR's lowest price.
    assert_eq!(account_policy::moves("wrap.near", &[call(125), call(125)]).unwrap(), vec![("near".to_string(), NEAR / 4)]);
    let mut p = account();
    as_key(PHONE, 10);
    // Face ID up to 1 NEAR: four 250 Tgas calls fit (1 NEAR), the fifth waits.
    for i in 0..4 {
        as_key(PHONE, 10 + i);
        assert!(p.execute("wrap.near".parse().unwrap(), vec![call(125), call(125)], None).done);
    }
    as_key(PHONE, 20);
    assert!(!p.execute("wrap.near".parse().unwrap(), vec![call(1)], None).done);
}

// ── Re-freeze 2: the red team's RT3/RT4 and the fuzzer's RT3-b (a finish whose callback was lost) ─────────────────

/// RT3: the first finish's add succeeded but its callback never ran (out of gas). The retry an hour later deletes that
/// copy of the key first, so its add succeeds and its callback finishes. The first finish's callback, arriving late
/// after the retry replaced its record, does nothing at all: no finish, no delete under the retry's feet.
#[test]
fn rt3_a_late_callback_after_a_retry_does_nothing() {
    let mut p = account();
    let ready = start(&mut p, 100);
    finish(&mut p);
    let first = U64((100 + DAY) * SECOND);
    as_key(WORDS, 100 + DAY + 3_600);
    finish(&mut p);
    // The lost one turns up now, before the retry's own: superseded.
    callback_of(&mut p, 100 + DAY + 3_601, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready, first);
    assert!(get_logs().iter().any(|l| l.contains("recovery_finish_superseded")), "{:?}", get_logs());
    assert!(actions().is_empty(), "no key deleted or added: {:?}", actions());
    assert!(p.pending().is_some(), "nothing finished");
    // The retry's own callback finishes it.
    callback(&mut p, 100 + DAY + 3_602, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready);
    assert!(p.pending().is_none());
    assert_eq!(deletes(&actions()), 2, "the old phone and the setup key");
    // A late callback after the finish completed is inert as well.
    callback_of(&mut p, 100 + DAY + 3_603, PromiseResult::Successful(vec![]), key(NEW_PHONE), ready, first);
    assert!(actions().is_empty());
}

/// RT3-b: a lost finish to K5, then the phone's stop ends that recovery, then the words recover to K6. K5 may be on NEAR
/// with the phone's methods; once K6's finish replaces the record, K5 would no longer be refused (an account that learns
/// its phones would take it), so K6's finish deletes K5 in a receipt of its own.
#[test]
fn rt3b_a_lost_finishs_key_goes_when_another_finish_replaces_its_record() {
    let mut p = account();
    start(&mut p, 100);
    finish(&mut p);
    // While its record stands, K5 (NEW_PHONE) can't act and can't take a role.
    as_key(PHONE, 100 + DAY + 1);
    assert!(p.cancel_recovery().done, "no device of age: the stop is at once");
    as_key(NEW_PHONE, 100 + DAY + 2);
    assert!(refused(|| copy_of(&p).execute(bob(), send(1), None)));
    as_key(WORDS, 100 + DAY + 3);
    assert!(refused_with(|| copy_of(&p).start_recovery(key(NEW_PHONE))).contains("already on this account"), "nor a recovery to it");
    p.start_recovery(key(0x12));
    as_key(WORDS, 100 + 2 * DAY + 3_600);
    finish(&mut p);
    let r = get_created_receipts();
    assert!(r.iter().any(|x| matches!(&x.actions[..], [MockAction::DeleteKey { public_key, .. }] if near_sdk::borsh::to_vec(public_key).unwrap() == key(NEW_PHONE).0)), "the lost finish's key is deleted: {r:?}");
}
