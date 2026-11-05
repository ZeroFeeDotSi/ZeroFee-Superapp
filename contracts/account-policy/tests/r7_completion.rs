//! Release 7 completion (the proofs' §11): tests that kill the mutants of the release-7 paths that the rest of the suite
//! left alive. Each says which mutant it kills; none changes the contract.
use account_policy::{AccountPolicy, Band, Change, Level, Step};
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
const YOUNG: u8 = 0x0A;
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

fn bob() -> AccountId {
    "bob.near".parse().unwrap()
}

/// Kills `src/lib.rs:785: replace != with == in AccountPolicy::refuse_recovery` (the confirmed stop's approver record).
///
/// The laptop's `refuse_recovery(Some(true))` records its yes to the phone's stop by replacing that stop's approver row,
/// and must keep every OTHER request's row. A request a young second device said yes to during the recovery carries an
/// empty row ("not co-signed"); were the rows of other requests dropped instead, that request would read as approved
/// before rows were kept ("co-signed") and survive the recovery's end. With the rows kept it is dropped, as every request
/// the phone asked alone during a dispute is.
#[test]
fn confirmed_stop_keeps_other_requests_approver_rows() {
    // A day's delay (floor 2 days); everything over 1 NEAR needs a second device and waits a day.
    as_key(SETUP, 0);
    let wait = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), wait, Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    // The laptop in the first 24 hours: at once; of age after the floor. Then the bands that need it.
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 20);
    let both = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Both { seconds: U64(DAY) } }];
    let set = p.set_protection(both); // the strictest level now: a day's wait
    as_key(PHONE, 20 + DAY);
    assert!(set.done || p.run(set.id.unwrap()).done);
    // Day 3: a second device added the normal way (the laptop co-signs, it waits the floor), young once it runs. Release 10
    // (round 2, G2): 100 s into it, so the laptop has been on the account for the fallback when it confirms the stop below.
    let t = 3 * DAY + 100;
    as_key(PHONE, t);
    let add = p.add_second_device(key(YOUNG));
    assert!(!add.done);
    as_key(LAPTOP, t + 1);
    p.approve(add.id.unwrap());
    as_key(PHONE, t + 3 * DAY);
    assert!(p.run(add.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 2);
    assert_eq!(p.second_devices_of_age(), 1, "the new device is young");
    // The words start a recovery; the phone asks a big payment, which the YOUNG device says yes to (its yes is kept as
    // not co-signed), and the phone asks its one stop.
    let t = t + 4 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let pay = p.execute(bob(), vec![Step::Transfer { deposit: U128(5 * NEAR) }], None);
    assert!(!pay.done && pay.needs_device);
    as_key(YOUNG, t + 2);
    let after = p.approve(pay.id.unwrap());
    assert!(!after.done, "a young device's yes doesn't run anything during a recovery");
    as_key(PHONE, t + 3);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    assert_eq!(p.waiting_requests().len(), 2);
    // The laptop (of age) confirms the phone's stop: two of three end the recovery, no freeze; what the phone asked
    // alone during it, the young-approved payment included, goes.
    as_key(LAPTOP, t + 4);
    p.refuse_recovery(Some(true));
    assert!(p.recovery_status().is_none());
    assert!(p.frozen_until().is_none(), "a confirmed stop doesn't freeze");
    assert!(
        !p.waiting_requests().iter().any(|r| matches!(r.change, Change::Spend { .. })),
        "the payment only a young device said yes to must not outlive the dispute: {:?}",
        p.waiting_requests()
    );
}
