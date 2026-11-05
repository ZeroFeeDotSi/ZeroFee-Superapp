//! Re-audit R8: a v4 account's real stored state (tests/fixtures/v4-state.json, written by the v4 source at 5cd0b98 with
//! tests/fixtures/make-v4-state.rs) is read by this release. `upgrade_check` passes on it, and the phone, the second
//! device, the backup words, Agent's orders, Legacy and Kids all still work; state this release can't read fails the
//! check, so the switch is undone.
use account_policy::AccountPolicy;
#[cfg(feature = "modules")]
use near_sdk::json_types::U64;
use near_sdk::json_types::{Base64VecU8, U128};
#[cfg(feature = "modules")]
use near_sdk::test_utils::get_created_receipts;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{env, testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const PHONE: u8 = 0x33;
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

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn send(near: u128) -> Vec<account_policy::Step> {
    vec![account_policy::Step::Transfer { deposit: U128(near) }]
}

/// The v4 account, as v4 left it: the second device added, Legacy, Agent (an order on days 30 and 60) and Kids set up,
/// six requests waiting (one approved by the laptop), and a recovery started with the words on day 2.
fn v4_account(now_s: u64) -> AccountPolicy {
    as_key(PHONE, now_s);
    let rows: Vec<(String, String)> = near_sdk::serde_json::from_str(include_str!("fixtures/v4-state.json")).unwrap();
    let bytes = |h: &str| (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect::<Vec<u8>>();
    for (k, v) in &rows {
        env::storage_write(&bytes(k), &bytes(v));
    }
    env::state_read().unwrap()
}

#[cfg(feature = "modules")]
#[test]
fn a_v4_account_upgrades_and_everything_still_works() {
    let mut p = v4_account(2 * DAY + 600);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(4, None);
    assert_eq!(p.release_version(), account_policy::RELEASE_VERSION);
    assert_eq!(p.waiting_requests().len(), 6);
    assert!(p.pending().is_some(), "the recovery v4 started still waits");
    assert!(!p.kids_why().is_empty());
    assert!(p.legacy_status().is_some() && p.kids().is_some());
    assert_eq!(p.agent().unwrap().orders[0].slots.len(), 2);
    // A waiting recovery freezes spending on every account (audit A, A-1); a second device from before ages were kept
    // counts as of age, so the phone's cancel waits for its yes.
    assert!(p.frozen_until().is_some());
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    as_key(LAPTOP, 2 * DAY + 601);
    assert!(p.approve(stop.id.unwrap()).done);
    assert!(p.pending().is_none());
    // The request the laptop approved under v4 runs when its day is up.
    let approved = p.waiting_requests().into_iter().find(|w| w.approved).unwrap();
    as_key(PHONE, 3 * DAY + 10);
    assert!(p.run(approved.id).done);
    // The phone still pays (it's learned on its first call: v4 kept no device list).
    let pay = p.execute("bob.near".parse().unwrap(), send(NEAR), None);
    assert!(pay.done || pay.id.is_some());
    // Agent's dated order runs on its day.
    as_caller("anyone.near", 30 * DAY + 60);
    p.run_order(U64(p.agent().unwrap().orders[0].id.0));
    assert!(!get_created_receipts().is_empty());
}

#[cfg(feature = "modules")]
#[test]
fn state_this_release_cannot_read_fails_the_check() {
    for (k, junk) in [(&b"agent"[..], vec![1u8, 2, 3]), (b"kids_why", vec![9]), (b"legacy", vec![]), (b"kids", vec![0xFF; 3]), (b"devices", vec![7]), (b"order_tries", vec![1]), (b"device_ages", vec![5]), (b"approved_by", vec![2, 0]), (b"freeze", vec![1])] {
        let p = v4_account(2 * DAY + 600);
        env::storage_write(k, &junk);
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(fails(|| p.upgrade_check(4, None)), "{}", String::from_utf8_lossy(k));
        env::storage_remove(k);
    }
    let p = v4_account(2 * DAY + 600);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(fails(|| p.upgrade_check(9, None)), "a release can't go back to an older one");
}

/// The release has no Agent, Legacy or Kids: the v4 account still using them is refused (they'd be gone with their
/// methods), and the same account without them (their keys left out of v4's stored state) upgrades and works.
#[cfg(not(feature = "modules"))]
#[test]
fn the_release_refuses_a_v4_account_using_modules_and_takes_one_without() {
    let p = v4_account(2 * DAY + 600);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(fails(|| p.upgrade_check(4, None)), "Agent, Legacy and Kids are set up on it");
    for k in MODULE_KEYS {
        env::storage_remove(k);
    }
    let mut p: AccountPolicy = env::state_read().unwrap();
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(4, None);
    assert_eq!(p.release_version(), account_policy::RELEASE_VERSION);
    assert_eq!(p.waiting_requests().len(), 6);
    assert!(p.pending().is_some(), "the recovery v4 started still waits");
    assert!(p.frozen_until().is_some(), "a waiting recovery freezes spending on every account (audit A, A-1)");
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    as_key(LAPTOP, 2 * DAY + 601);
    assert!(p.approve(stop.id.unwrap()).done);
    assert!(p.pending().is_none());
    let approved = p.waiting_requests().into_iter().find(|w| w.approved).unwrap();
    as_key(PHONE, 3 * DAY + 10);
    assert!(p.run(approved.id).done);
    let pay = p.execute("bob.near".parse().unwrap(), send(NEAR), None);
    assert!(pay.done || pay.id.is_some());
    // Any one of the module keys back: refused again.
    for k in MODULE_KEYS {
        env::storage_write(k, &[0]);
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(fails(|| p.upgrade_check(4, None)), "{}", String::from_utf8_lossy(k));
        env::storage_remove(k);
    }
}

/// The keys only Agent, Legacy and Kids write (the contract's MODULE_KEYS).
#[cfg(not(feature = "modules"))]
const MODULE_KEYS: [&[u8]; 5] = [b"legacy", b"agent", b"kids", b"kids_why", b"order_tries"];

#[cfg(not(feature = "modules"))]
#[test]
fn state_the_release_cannot_read_fails_the_check() {
    for (k, junk) in [(&b"devices"[..], vec![7u8]), (b"device_ages", vec![5]), (b"approved_by", vec![2, 0]), (b"freeze", vec![1])] {
        let _ = v4_account(2 * DAY + 600);
        for m in MODULE_KEYS {
            env::storage_remove(m);
        }
        let p: AccountPolicy = env::state_read().unwrap();
        env::storage_write(k, &junk);
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(fails(|| p.upgrade_check(4, None)), "{}", String::from_utf8_lossy(k));
    }
}
