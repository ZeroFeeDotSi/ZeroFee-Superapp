//! Release 9 mutation round (contract-proofs §13): tests that kill the mutants of release 9's lib.rs that the rest of the
//! suite left alive. Each names the mutants it kills (cargo-mutants 27.1.0, line:column in the frozen lib.rs of tag
//! `r9-frozen-3`, `e83ec614…ec5e`). None changes the contract.
use account_policy::{AccountPolicy, Band, Level};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const STRANGER: u8 = 0x44;

fn me() -> AccountId {
    "me.near".parse().unwrap()
}

fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
}

fn ctx(fill: u8, now_s: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000))
        .build()
}

fn as_key(fill: u8, now_s: u64) {
    testing_env!(ctx(fill, now_s));
}

fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}

/// The keys deleted by the receipts made since the last look.
fn deleted() -> Vec<Vec<u8>> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::DeleteKey { public_key, .. } => Some(near_sdk::borsh::to_vec(&public_key).unwrap()),
            _ => None,
        })
        .collect()
}

/// A day's delay, the words set, Face ID up to 1 NEAR, else a day's wait; a laptop added at once (the setup window).
fn with_laptop() -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    p
}

/// The contract's `Finishing` record (storage key `recovery_finishing`), with the same borsh layout.
#[derive(near_sdk::borsh::BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
struct FinishingRecord {
    new_key: Vec<u8>,
    ready_at_ns: u64,
    asked_at_ns: u64,
}

/// `on_recovery_key` for a finish on record (written by hand: through the contract's methods a key with a role can never
/// be a finish's new key) whose add succeeded, while no recovery waits: the state from storage, the add Successful.
fn callback_on_record(p: &mut AccountPolicy, now_s: u64, new_key: Base64VecU8) {
    env::state_write(&*p);
    let asked = 100 * SECOND;
    let rec = FinishingRecord { new_key: new_key.0.clone(), ready_at_ns: DAY * SECOND, asked_at_ns: asked };
    env::storage_write(b"recovery_finishing", &near_sdk::borsh::to_vec(&rec).unwrap());
    testing_env!(ctx(PHONE, now_s), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Successful(vec![])]);
    AccountPolicy::on_recovery_key(new_key, U64(DAY * SECOND), U64(asked));
    assert!(get_logs().iter().any(|l| l.contains("recovery_not_finished")), "the role guard's path ran: {:?}", get_logs());
    assert!(env::storage_read(b"recovery_finishing").is_none(), "the record is gone");
    *p = env::state_read().unwrap();
}

/// Kills `853:45 replace && with ||` and `853:86 replace && with ||` in `AccountPolicy::on_recovery_key` (the guard on
/// taking an added key off NEAR again when its recovery didn't finish: "unless a role holds it"; the suite also kills
/// that line's other mutants). A key that is a second device, the backup words or a phone is never deleted by that path;
/// only a key with no role is. With 853:45, the second device's or the words' key would be deleted; with 853:86, any key
/// not on the phone list (the second device's, the words').
#[test]
fn a_callback_for_a_recovery_that_did_not_finish_never_deletes_a_key_that_holds_a_role() {
    let mut p = with_laptop();
    let _ = get_created_receipts();
    for (who, k) in [("the second device", LAPTOP), ("the backup words", WORDS), ("the phone", PHONE)] {
        callback_on_record(&mut p, 100, key(k));
        assert!(deleted().is_empty(), "{who}'s key must stay on NEAR");
        assert!(p.pending().is_none());
    }
    assert_eq!(p.second_device_count(), 1, "the second device is still recorded");
    callback_on_record(&mut p, 101, key(STRANGER));
    assert_eq!(deleted(), vec![key(STRANGER).0], "a key with no role comes off NEAR");
}
