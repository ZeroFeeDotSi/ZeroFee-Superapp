//! H01 (JOURNEY-HOLES.md, 1 Nov 2026), no contract change: the core now writes a dollar limit for every coin it can
//! price, up to MAX_COINS (32). This runs the contract's own `new` and `level_for` on exactly the bands the core writes
//! for a new mainnet account (tests/fixtures/h01-bands.json, pinned to `contractBands` by
//! packages/core/src/h01-band-coins.test.ts): NEAR at $2.50, SOL at $100, Face ID up to $500 in any 24 hours.
use account_policy::{AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const TGAS: u64 = 1_000_000_000_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const LAMPORTS: u128 = 1_000_000_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn me() -> AccountId {
    "me.near".parse().unwrap()
}

fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
}

fn as_key(fill: u8, now_s: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000));
    testing_env!(b.build());
}

fn bands() -> Vec<Band> {
    near_sdk::serde_json::from_str(include_str!("fixtures/h01-bands.json")).expect("the core's bands parse as the contract's")
}

fn account() -> AccountPolicy {
    as_key(SETUP, 0);
    let p = AccountPolicy::new(U64(2 * DAY), bands(), Some(key(PHONE)), None);
    as_key(PHONE, 10);
    p
}

fn intents() -> AccountId {
    "intents.near".parse().unwrap()
}

/// A ledger move of `amount` of `token` (1Click's deposit, a send), as the core sends it: mt_transfer on intents.near.
fn ledger_move(token: &str, amount: u128) -> Vec<Step> {
    let args = format!(r#"{{"receiver_id":"someone.near","token_id":"{token}","amount":"{amount}"}}"#);
    vec![Step::FunctionCall { method_name: "mt_transfer".into(), args: Base64VecU8(args.into_bytes()), deposit: U128(1), gas: U64(30 * TGAS) }]
}

#[test]
fn h01_the_core_bands_list_32_coins_and_the_contract_takes_them() {
    let b = bands();
    assert_eq!(b[0].up_to.as_ref().unwrap().len(), 32);
    let p = account();
    assert_eq!(p.protection().len(), 2);
}

#[test]
fn h01_five_dollars_of_sol_is_face_id_now_not_the_strictest_band() {
    let p = account();
    assert_eq!(p.level_for(intents(), ledger_move("nep141:sol.omft.near", LAMPORTS / 20), None), Level::FaceId, "0.05 SOL = $5");
    assert_eq!(p.level_for(intents(), ledger_move("nep141:sol.omft.near", 4 * LAMPORTS), None), Level::FaceId, "4 SOL = $400");
    assert_eq!(p.level_for(intents(), ledger_move("nep141:sol.omft.near", 6 * LAMPORTS), None), Level::Wait { seconds: U64(DAY) }, "6 SOL = $600: over the band");
}

#[test]
fn h01_wnear_in_the_ledger_counts_like_near() {
    let p = account();
    assert_eq!(p.level_for(intents(), ledger_move("nep141:wrap.near", 2 * NEAR), None), Level::FaceId, "2 wNEAR = $5");
    assert_eq!(p.level_for(intents(), ledger_move("nep141:wrap.near", 300 * NEAR), None), Level::Wait { seconds: U64(DAY) }, "300 wNEAR = $750");
}

#[test]
fn h01_one_dollar_budget_across_coins_and_an_unlisted_coin_still_waits() {
    let p = account();
    // $300 of SOL and $300 of USDC on Solana in one request: $600 against one $500 budget (audit F6), so it waits
    let groups = vec![
        Group { receiver_id: intents(), steps: ledger_move("nep141:sol.omft.near", 3 * LAMPORTS) },
        Group { receiver_id: intents(), steps: ledger_move("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", 300_000_000) },
    ];
    assert_eq!(p.level_for_many(groups), Level::Wait { seconds: U64(DAY) });
    assert_eq!(p.level_for(intents(), ledger_move("nep141:not-listed.near", 1), None), Level::Wait { seconds: U64(DAY) }, "a coin the core can't price still takes the strictest band");
}
