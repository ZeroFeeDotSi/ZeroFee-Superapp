//! Release 8 mutation round (contract-proofs §12): tests that kill the mutants of release 8's lib.rs that the rest of the
//! suite left alive. Each names the mutant it kills (cargo-mutants 27.1.0, its line:column in lib.rs `5a39e768…084c`).
//! None changes the contract.
use account_policy::{moves, AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const FLOOR: u64 = 2 * DAY; // a day's delay: delay + min(delay, a day)
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const TGAS: u64 = 1_000_000_000_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const YOUNG: u8 = 0x0A;
const NEW_PHONE: u8 = 0x11;

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn bob() -> AccountId {
    "bob.near".parse().unwrap()
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
fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}
fn ft(amount: &str) -> Vec<Step> {
    vec![Step::FunctionCall { method_name: "ft_transfer".into(), args: Base64VecU8(format!(r#"{{"receiver_id":"bob.near","amount":"{amount}"}}"#).into_bytes()), deposit: U128(1), gas: U64(TGAS) }]
}

/// A day's delay; Face ID up to 1 NEAR (NEAR only), else a day's wait.
fn account() -> AccountPolicy {
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// The laptop added at t=10 (setup window: at once), of age at 10 + FLOOR; bands Face ID ≤ 1 NEAR, else a day and the
/// second device; then a second device added the normal way (the laptop co-signs), young until it has waited the floor.
fn two_devices() -> (AccountPolicy, u64) {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 20);
    let both = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Both { seconds: U64(DAY) } }];
    let set = p.set_protection(both);
    as_key(PHONE, 20 + DAY);
    assert!(p.run(set.id.unwrap()).done);
    let t = 3 * DAY;
    as_key(PHONE, t);
    let add = p.add_second_device(key(YOUNG));
    as_key(LAPTOP, t + 1);
    p.approve(add.id.unwrap());
    as_key(PHONE, t + FLOOR);
    assert!(p.run(add.id.unwrap()).done);
    assert_eq!((p.second_device_count(), p.second_devices_of_age()), (2, 1), "the second one is young");
    (p, t + FLOOR + 10)
}

/// Kills `598:68`, `598:85`, `598:145: replace && with || in AccountPolicy::approve` (the check that an aged device has
/// already co-signed THIS request). With any of them, an aged device's row for ANOTHER request made a young device's yes
/// leave no row at all, and a request with no row reads as co-signed: it would survive a recovery start.
#[test]
fn a_young_yes_never_co_signs_even_when_an_aged_device_co_signed_something_else() {
    let (mut p, t) = two_devices();
    as_key(PHONE, t);
    let a = p.set_protection(p.protection()); // a change: the laptop co-signs it
    as_key(LAPTOP, t + 1);
    p.approve(a.id.unwrap());
    as_key(PHONE, t + 2);
    let b = p.execute(bob(), send(5 * NEAR), None); // needs a second device
    assert!(b.needs_device);
    as_key(YOUNG, t + 3);
    p.approve(b.id.unwrap()); // a young device's yes: lets it through, never co-signs it
    as_key(WORDS, t + 4);
    p.start_recovery(key(NEW_PHONE));
    let ids: Vec<u64> = p.waiting_requests().iter().map(|w| w.id.0).collect();
    assert!(ids.contains(&a.id.unwrap().0), "the co-signed change survives the start");
    assert!(!ids.contains(&b.id.unwrap().0), "what only a young device said yes to is dropped by the start: {ids:?}");
}

/// Kills `1050:81 replace && with ||`, `1050:112 replace == with !=`, `1050:117 replace && with ||` and `1050:123
/// replace > with >=` in `level_for_moves` (which coins this request moves). A coin moved earlier today (and still
/// counting) that this request doesn't move, or moves 0 of, must not make it "move" a coin its band doesn't list.
#[test]
fn a_coin_moved_earlier_doesnt_count_as_moving_now() {
    let mut p = account();
    as_key(PHONE, 10);
    // 5 units of a coin no band lists: the strictest band (it waits), and it counts toward the 24 hours.
    let coin: AccountId = "coin.near".parse().unwrap();
    assert!(!p.execute(coin.clone(), ft("5"), None).done);
    // A small NEAR payment still fits Face ID: it moves NEAR only.
    assert_eq!(p.level_for(bob(), send(NEAR / 10), None), Level::FaceId);
    // And so does a 0-unit transfer of that coin (it moves only its gas and 1 yocto, as NEAR).
    assert_eq!(p.level_for(coin, ft("0"), None), Level::FaceId);
}

/// Kills `1143:77 replace < with <= in AccountPolicy::in_setup_window`: the setup window ends exactly 24 hours after
/// `new`; a change asked at that instant waits the floor.
#[test]
fn the_setup_window_ends_at_exactly_a_day() {
    let mut p = account();
    as_key(PHONE, DAY);
    let set = p.set_protection(p.protection());
    assert_eq!(set.ready_at_ns.unwrap().0, (DAY + FLOOR) * SECOND, "at 24 h exactly the floor applies");
    as_key(PHONE, DAY - 1);
    let early = p.set_protection(p.protection());
    assert_eq!(early.ready_at_ns.unwrap().0, (DAY - 1 + DAY) * SECOND, "a second earlier, only the band's day");
}

/// Kills `1192:33 replace != with == in AccountPolicy::unrecord_second_device`: unrecording one device must keep every
/// OTHER device's age, or a young device would read as of age (no record: "added before ages were kept").
#[test]
fn unrecording_a_device_keeps_the_others_ages() {
    let (p, t) = two_devices();
    env::state_write(&p);
    testing_env!(ctx(PHONE, t).build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_second_device_key(key(LAPTOP), false);
    let p: AccountPolicy = env::state_read().unwrap();
    assert_eq!(p.second_device_count(), 1);
    assert_eq!(p.second_devices_of_age(), 0, "the young device is still young");
}

/// Kills `1275:61 replace < with <= in AccountPolicy::restart_young_ages`: a device exactly of age when a recovery starts
/// is of age; its clock is not restarted.
#[test]
fn a_device_of_age_at_that_very_instant_stays_of_age_through_a_start() {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(WORDS, 10 + FLOOR);
    p.start_recovery(key(NEW_PHONE));
    assert_eq!(p.second_devices_of_age(), 1);
    assert!(p.recovery_status().unwrap().needs_device);
}

/// Kills `1505:5 replace dispatch_chain with ()` and `1509:171 replace + with - in dispatch_chain`: a chain at Face ID
/// sends its first group at once and attaches the check of the next with exactly the rest's gas plus its links.
#[test]
fn a_chain_at_face_id_sends_its_first_group_and_its_check_with_the_right_gas() {
    let mut p = account();
    as_key(PHONE, 10);
    let _ = get_created_receipts();
    let out = p.execute_many(vec![Group { receiver_id: bob(), steps: send(1) }, Group { receiver_id: "carol.near".parse().unwrap(), steps: send(2) }]);
    assert!(out.done);
    let r = get_created_receipts();
    assert!(r.iter().any(|x| x.receiver_id == bob()), "the first group was sent: {r:?}");
    let check_gas: Vec<u64> = r
        .iter()
        .flat_map(|x| x.actions.iter())
        .filter_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight { method_name, prepaid_gas, .. } if method_name == b"on_group_done" => Some(prepaid_gas.as_gas()),
            _ => None,
        })
        .collect();
    assert_eq!(check_gas, vec![40 * TGAS], "the rest (one group of transfers) and two links of 20 Tgas");
}

/// Kills `1627:30 replace != with == in moves`: a batch transfer on any contract whose ids and amounts differ in number
/// can't be measured.
#[test]
fn a_batch_transfer_with_mismatched_lists_cant_be_measured_on_any_contract() {
    let step = |args: &str| vec![Step::FunctionCall { method_name: "mt_batch_transfer".into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(1), gas: U64(TGAS) }];
    assert_eq!(moves("mt.near", &step(r#"{"receiver_id":"bob.near","token_ids":["a","b"],"amounts":["1"]}"#)), None);
    assert!(moves("mt.near", &step(r#"{"receiver_id":"bob.near","token_ids":["a"],"amounts":["1"]}"#)).is_some());
}

/// Kills `1677:5 replace is_ml_dsa_65_key -> bool with true` and `1677:49 replace && with || in is_ml_dsa_65_key`: only
/// a post-quantum key of exactly its size and tag is ever taken, as a second device, a backup key or a new phone.
#[test]
fn only_a_well_formed_ml_dsa_65_key_is_taken() {
    let mut p = account();
    let mut wrong_tag = key(LAPTOP);
    wrong_tag.0[0] = 0; // an ed25519 tag on a key of ML-DSA's length
    let short = Base64VecU8(vec![2u8; 33]); // the right tag, the wrong length
    for k in [wrong_tag, short] {
        as_key(PHONE, 10);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.add_second_device(k.clone()))).is_err());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.set_recovery_key(k.clone()))).is_err());
        as_key(WORDS, 11);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.start_recovery(k.clone()))).is_err());
    }
    assert_eq!(p.second_device_count(), 0);
}

/// Kills `1727:5 replace forget_approver with ()` and `1730:17 replace != with == in forget_approver`: a request that
/// ran leaves no approver row behind, so the list every approval loads stays small.
#[test]
fn a_finished_request_leaves_no_approver_row() {
    let (mut p, t) = two_devices();
    as_key(PHONE, t);
    let pay = p.execute(bob(), send(5 * NEAR), None);
    as_key(LAPTOP, t + 1);
    p.approve(pay.id.unwrap());
    let rows = || env::storage_read(b"approved_by").map(|b| near_sdk::borsh::from_slice::<Vec<(u64, Vec<u8>)>>(&b).unwrap()).unwrap_or_default();
    assert!(rows().iter().any(|(i, _)| *i == pay.id.unwrap().0), "the yes is on record while it waits");
    as_key(PHONE, t + DAY);
    assert!(p.run(pay.id.unwrap()).done);
    assert!(rows().is_empty(), "no row left once it ran: {:?}", rows().iter().map(|(i, _)| *i).collect::<Vec<_>>());
}

/// Kills `1785:36 replace / with % in share_ppm`: past what can be scaled to millionths, a coin's share comes from a
/// coarser limit, still about right (here a quarter of the limit), so a second coin's small share still fits the band.
#[test]
fn a_huge_amount_is_still_measured_as_its_share() {
    as_key(SETUP, 0);
    let huge = u128::MAX / 2;
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(huge)), ("nep141:usdc.near".into(), U128(100))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 10);
    let groups = vec![Group { receiver_id: bob(), steps: send(u128::MAX / 8) }, Group { receiver_id: "usdc.near".parse().unwrap(), steps: ft("1") }];
    assert_eq!(p.level_for_many(groups), Level::FaceId, "a quarter of the NEAR limit and 1% of the USDC one fit together");
}
