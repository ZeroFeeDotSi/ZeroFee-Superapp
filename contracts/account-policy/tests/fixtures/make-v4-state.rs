// Not compiled here. Made tests/fixtures/v4-state.json: copy it to tests/dump.rs in the v4 source (git archive 5cd0b98
// contracts/account-policy) and run it there with DUMP_TO=<path> cargo test --test dump (touch the sources first if the
// target dir is shared: git archive's old mtimes make cargo reuse a newer build).
//! Run against the v4 source (5cd0b98): an account with every part of its state in use, dumped as v4 stores it.
use account_policy::{AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{env, testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn me() -> AccountId { "me.near".parse().unwrap() }
fn acct(s: &str) -> AccountId { s.parse().unwrap() }
fn key(fill: u8) -> Base64VecU8 { let mut k = vec![2u8]; k.extend(std::iter::repeat(fill).take(1952)); Base64VecU8(k) }
fn as_key(fill: u8, now_s: u64) {
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap()).block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000)).build());
}
fn send(n: u128) -> Vec<Step> { vec![Step::Transfer { deposit: U128(n) }] }

#[test]
fn dump_v4_state() {
    as_key(0x33, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(200 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(7 * DAY), bands);
    assert!(p.set_recovery_key(key(0xEE)).done);
    let laptop = p.add_second_device(key(0x09));
    let legacy = p.legacy_setup(legacy::LegacyConfig { heirs: vec![legacy::Heir { account_id: acct("mia.near"), share_pct: 100 }], quiet_seconds: U64(180 * DAY), claim_delay_seconds: U64(30 * DAY), tokens: vec![] });
    let budget = agent_limits::Budget { coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(NEAR), per_month: U128(10 * NEAR), convert_per_day: U128(0) }], recipients: vec![acct("landlord.near")], ends_at_ns: U64(365 * DAY * SECOND), max_spends_per_day: 12 };
    let rent = agent_limits::OrderPlan { payout: agent_limits::Payout::Near, to: acct("landlord.near"), amount: U128(NEAR), dates_ns: vec![U64(30 * DAY * SECOND), U64(60 * DAY * SECOND)], grace_seconds: U64(3 * DAY) };
    let agent = p.agent_set(key(0x05), budget, vec![rent]);
    let kids = p.kids_set(kids::KidsRules { allowed: vec![acct("bob.near")], week: vec![("near".into(), U128(500 * NEAR))] });
    as_key(0x33, DAY + 100);
    for o in [laptop, legacy, agent, kids] {
        assert!(p.run(o.id.unwrap()).done);
    }
    as_key(0x33, 2 * DAY);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done); // a spent row, a kids log row
    assert!(!p.execute(acct("carol.near"), send(NEAR), None).done); // held: kids_why
    assert!(!p.execute(acct("bob.near"), send(400 * NEAR), None).done);
    assert!(!p.execute_many(vec![Group { receiver_id: acct("bob.near"), steps: send(1) }, Group { receiver_id: acct("bob.near"), steps: send(250 * NEAR) }]).done);
    assert!(!p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]).done);
    assert!(!p.upgrade(Base64VecU8(vec![0xAB; 32])).done);
    let pay = p.execute(acct("bob.near"), send(300 * NEAR), None);
    as_key(0x09, 2 * DAY + 1);
    p.approve(pay.id.unwrap()); // an approved request from v4 (no approver recorded)
    as_key(0xEE, 2 * DAY + 500);
    p.start_recovery(key(0x11));
    env::state_write(&p);
    let mut all: Vec<(Vec<u8>, Vec<u8>)> = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage()).into_iter().collect();
    all.sort();
    let hex = |b: &[u8]| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let rows: Vec<String> = all.iter().map(|(k, v)| format!("  [\"{}\", \"{}\"]", hex(k), hex(v))).collect();
    std::fs::write(std::env::var("DUMP_TO").unwrap(), format!("[\n{}\n]\n", rows.join(",\n"))).unwrap();
}
