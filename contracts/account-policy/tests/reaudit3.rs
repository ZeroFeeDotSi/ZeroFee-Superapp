//! Re-audit 3 of the account contract at 9b982d8 (release 6, cut): leads from auditor B, each confirmed here by a test
//! that failed before its fix. The 24-hour list's bound is in src/tests.rs (it reads the list itself).
mod common;
use common::finish_ok;
use account_policy::{AccountPolicy, Band, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
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

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn send(near: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(near) }]
}

fn account() -> AccountPolicy {
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(200 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(7 * DAY), bands, Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// Lead (Medium): a waiting recovery's new key could be added as a second device (in the first 24 hours, at once), so
/// finishing it failed to add the key as the phone (it was already on the account) while it still deleted the old phone:
/// no key could spend until a second recovery. FIXED: the new key is "in use" while the recovery waits.
#[test]
fn a_waiting_recoverys_new_key_cant_become_anything_else() {
    let mut p = account();
    as_key(WORDS, 10);
    p.start_recovery(key(0x11));
    as_key(PHONE, 20);
    assert!(fails(|| p.add_second_device(key(0x11))), "not as a second device");
    assert!(p.second_device_ages().is_empty());
}

/// Lead (Low): an approval by a second device that is later removed counted as of age (its age record goes with it, and
/// an unknown approver read as one from before ages were kept), so a young device's yes outlived a recovery start once
/// that device was gone. FIXED: an approval protects a request only while its approver is one of the second devices.
#[test]
fn a_removed_second_devices_approval_doesnt_outlive_a_start() {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 9 * DAY; // the laptop is of age
    as_key(PHONE, t);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let removal = p.remove_key(key(LAPTOP));
    as_key(LAPTOP, t + 1);
    p.approve(loosen.id.unwrap());
    // Re-audit 7 (R7-1): a laptop of age's removal waits the fallback (21 days), not the 8-day floor.
    as_key(PHONE, t + 21 * DAY);
    assert!(p.run(removal.id.unwrap()).done, "the laptop is gone");
    as_key(WORDS, t + 21 * DAY + 1);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "its yes doesn't protect the loosening any more");
}

/// Info (auditor B): finishing deletes every other key on the device list, the setup batch's one-time key included (that
/// batch already deleted it, so its receipt fails, on purpose: a setup that left it couldn't keep it). The old phone
/// can't act after the finish.
#[test]
fn finishing_a_recovery_still_works_and_seals_the_list() {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.execute("bob.near".parse().unwrap(), send(1), None).done);
    as_key(WORDS, 20);
    p.start_recovery(key(0x11));
    as_key(WORDS, 20 + 7 * DAY);
    finish_ok(&mut p);
    as_key(PHONE, 30 + 7 * DAY);
    assert!(fails(|| p.execute("bob.near".parse().unwrap(), send(1), None)), "the old phone can't act");
}
