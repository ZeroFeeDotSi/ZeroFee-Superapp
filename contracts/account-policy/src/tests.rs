use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, AccountId};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

fn me() -> AccountId {
    "me.near".parse().unwrap()
}

fn as_account(caller: &str, now_s: u64) {
    let caller: AccountId = caller.parse().unwrap();
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(caller.clone()).signer_account_id(caller).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000_000)).build());
}

/// This account's own call signed by the key filled with `fill` (the phone, a second device or the words).
fn as_key(fill: u8, now_s: u64) {
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap()).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000_000)).build());
}

/// Release 9 (R8-RS1): `finish_recovery`, then its callback with the add's result, at the same moment and signer.
fn finish_with(p: &mut AccountPolicy, result: near_sdk::PromiseResult) {
    let r = p.pending().expect("no recovery is waiting");
    let at = env::block_timestamp();
    p.finish_recovery();
    let mut b = VMContextBuilder::new();
    b.current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).signer_account_pk(env::signer_account_pk()).block_timestamp(env::block_timestamp()).account_balance(NearToken::from_near(1_000_000));
    env::state_write(&*p);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    AccountPolicy::on_recovery_key(r.new_key, r.ready_at_ns, U64(at));
    *p = env::state_read().expect("the callback leaves the state");
}

/// A finish whose add succeeded.
fn finish_ok(p: &mut AccountPolicy) {
    finish_with(p, near_sdk::PromiseResult::Successful(vec![]));
}

fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![ML_DSA_65_TAG];
    k.extend(std::iter::repeat(fill).take(ML_DSA_65_PUBLIC_KEY_LEN));
    Base64VecU8(k)
}

/// Under 10 NEAR: Face ID. Under 100 NEAR or 1,000 USDC: wait a day. Above: wait a day and the second device.
fn bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId },
        Band { up_to: Some(vec![("near".into(), U128(100 * NEAR)), (USDC.into(), U128(1_000_000_000))]), level: Level::Wait { seconds: U64(86_400) } },
        Band { up_to: None, level: Level::Both { seconds: U64(86_400) } },
    ]
}

fn simple_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(10 * NEAR))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(86_400) } },
    ]
}

/// A new account: no protection yet, so the first settings apply at once.
fn fresh() -> AccountPolicy {
    AccountPolicy::new(U64(60), vec![Band { up_to: None, level: Level::FaceId }], None, None)
}

/// A second device, then the three bands above.
fn protected() -> AccountPolicy {
    let mut p = fresh();
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(bands()).done);
    p
}

fn send(near: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(near) }]
}

fn intents(method: &str, args: &str) -> Vec<Step> {
    vec![Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(1), gas: U64(30_000_000_000_000) }]
}

fn bob() -> AccountId {
    "bob.near".parse().unwrap()
}

#[test]
fn small_payments_run_at_once() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let out = p.execute(bob(), send(5 * NEAR), None);
    assert!(out.done);
    assert!(p.waiting_requests().is_empty());
}

#[test]
fn bigger_payments_wait_and_can_be_cancelled() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let out = p.execute(bob(), send(50 * NEAR), None);
    assert!(!out.done);
    assert_eq!(out.ready_at_ns, Some(U64(86_400 * SECOND)));
    let id = out.id.unwrap();
    p.cancel(id);
    assert!(p.waiting_requests().is_empty());
    assert!(p.spent_today().is_empty(), "a cancelled payment doesn't count toward today's total");
}

#[test]
#[should_panic(expected = "still waiting")]
fn a_waiting_payment_cant_run_early() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let id = p.execute(bob(), send(50 * NEAR), None).id.unwrap();
    as_account("me.near", 86_399);
    p.run(id);
}

#[test]
fn a_waiting_payment_runs_after_the_wait() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let id = p.execute(bob(), send(50 * NEAR), None).id.unwrap();
    as_account("me.near", 86_400);
    assert!(p.run(id).done);
    assert!(p.waiting_requests().is_empty());
}

#[test]
fn splitting_a_big_payment_doesnt_dodge_its_band() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    assert!(p.execute(bob(), send(6 * NEAR), None).done);
    // 6 + 6 is more than 10 within 24 hours: the second one waits.
    assert!(!p.execute(bob(), send(6 * NEAR), None).done);
    // A day later the first no longer counts, but the waiting 6 does, until it runs or is cancelled.
    as_account("me.near", 86_400 + 1);
    assert_eq!(p.level_for(bob(), send(5 * NEAR), None), Level::Wait { seconds: U64(86_400) });
    assert_eq!(p.level_for(bob(), send(4 * NEAR), None), Level::FaceId);
}

#[test]
fn a_payment_that_waited_counts_from_when_it_ran() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let id = p.execute(bob(), send(9 * NEAR), None).id;
    assert!(id.is_some() && p.execute(bob(), send(2 * NEAR), None).id.is_some());
    as_account("me.near", 86_400);
    p.run(U64(2));
    as_account("me.near", 86_400 * 2 - 1);
    assert_eq!(p.level_for(bob(), send(9 * NEAR), None), Level::Wait { seconds: U64(86_400) }, "the 2 that ran a day ago still counts, plus the waiting 9");
}

#[test]
fn coins_inside_near_intents_are_measured() {
    as_account("me.near", 0);
    let p = protected();
    let intents_id: AccountId = "intents.near".parse().unwrap();
    let small = intents("mt_transfer", &format!(r#"{{"receiver_id":"bob.near","token_id":"{USDC}","amount":"500000000","approval":null}}"#));
    // 500 USDC isn't listed in the Face ID band (only NEAR is), so it waits a day; 2,000 USDC needs the second device too.
    assert_eq!(p.level_for(intents_id.clone(), small, None), Level::Wait { seconds: U64(86_400) });
    let big = intents("ft_withdraw", r#"{"token":"17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1","receiver_id":"bob.near","amount":"2000000000"}"#);
    assert_eq!(p.level_for(intents_id.clone(), big, None), Level::Both { seconds: U64(86_400) });
    // A step that can't be measured goes to the strictest band.
    assert_eq!(p.level_for(intents_id, intents("imt_burn", "{}"), None), Level::Both { seconds: U64(86_400) });
}

#[test]
fn the_second_device_must_approve_and_the_wait_still_applies() {
    as_account("me.near", 0);
    let mut p = fresh();
    assert!(p.add_second_device(key(9)).done);
    assert!(p.set_protection(simple_bands()).done);
    as_account("me.near", 1);
    let out = p.set_protection(bands());
    assert!(!out.done, "changing the protection takes the strictest level: a day's wait here");
    as_account("me.near", 86_401);
    assert!(p.run(out.id.unwrap()).done);
    assert_eq!(p.protection(), bands());

    let big = p.execute(bob(), send(500 * NEAR), None);
    assert!(!big.done && big.needs_device);
    let id = big.id.unwrap();
    // Approved before the wait ends: it still waits.
    as_key(9, 86_401);
    assert!(!p.approve(id).done);
    as_account("me.near", 86_401 + 86_400);
    assert!(p.run(id).done);
}

#[test]
#[should_panic(expected = "needs your second device")]
fn the_phone_alone_cant_run_what_needs_the_second_device() {
    as_account("me.near", 0);
    let mut p = protected();
    let id = p.execute(bob(), send(500 * NEAR), None).id.unwrap();
    as_account("me.near", 86_400 * 4);
    p.run(id);
}

#[test]
fn the_second_device_can_say_no() {
    as_account("me.near", 0);
    let mut p = protected();
    let id = p.execute(bob(), send(500 * NEAR), None).id.unwrap();
    as_key(9, 0);
    p.decline(id);
    assert!(p.waiting_requests().iter().all(|w| w.id != id));
}

#[test]
fn adding_a_second_device_to_a_protected_account_waits() {
    // In the account's first 24 hours (pairing a parent, the laptop offered at set-up) the first one goes at once.
    as_account("me.near", 0);
    let mut fresh = AccountPolicy::new(U64(60), simple_bands(), None, None);
    assert!(fresh.add_second_device(key(9)).done);
    assert_eq!(fresh.second_device_count(), 1);
    // After that, it waits like any change: the strictest level's wait, and at least the recovery delay plus as much.
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    as_account("me.near", 2 * 86_400);
    let out = p.add_second_device(key(9));
    assert!(!out.done && out.ready_at_ns == Some(U64((2 * 86_400 + 86_400) * SECOND)));
    assert_eq!(p.second_device_count(), 0);
}

#[test]
#[should_panic(expected = "can't be less protected")]
fn a_bigger_band_cant_be_weaker() {
    as_account("me.near", 0);
    AccountPolicy::new(
        U64(60),
        vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::Wait { seconds: U64(3600) } }, Band { up_to: None, level: Level::FaceId }], None, None
    );
}

#[test]
#[should_panic(expected = "add a second device")]
fn a_level_needing_a_second_device_needs_one() {
    as_account("me.near", 0);
    AccountPolicy::new(U64(60), bands(), None, None);
}

#[test]
#[should_panic(expected = "never calls")]
fn intents_keys_and_auth_are_never_touched() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    p.execute("intents.near".parse().unwrap(), intents("disable_auth_by_predecessor_id", "{}"), None);
}

#[test]
#[should_panic(expected = "own rules change only")]
fn the_account_cant_call_itself_through_execute() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    p.execute(me(), intents("set_protection", "{}"), None);
}

#[test]
#[should_panic(expected = "only this account")]
fn other_accounts_are_refused() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    as_account("thief.near", 1);
    p.execute(bob(), send(1), None);
}

#[test]
fn the_first_recovery_key_is_immediate_and_a_replacement_waits() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    assert!(p.set_recovery_key(key(1)).done);
    assert!(!p.set_recovery_key(key(2)).done, "replacing the backup words takes the strictest level");
}

#[test]
#[should_panic(expected = "backup key changes only")]
fn the_backup_key_cant_be_removed_as_a_phone() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    p.set_recovery_key(key(1));
    p.remove_key(key(1));
}

#[test]
fn recovery_waits_then_adds_a_restricted_key_and_the_phone_can_cancel() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    assert!(p.set_recovery_key(key(1)).done);
    as_key(1, 0);
    p.start_recovery(key(7));
    as_account("me.near", 0);
    p.cancel_recovery();
    assert!(p.pending().is_none());
    as_key(1, 0);
    p.start_recovery(key(7));
    as_key(1, 60);
    finish_ok(&mut p);
    assert!(get_logs().iter().any(|l| l.contains("recovery_finished")));
}

#[test]
fn moves_reads_the_standard_methods_and_refuses_to_guess() {
    let ft = intents("ft_transfer", r#"{"receiver_id":"bob.near","amount":"7"}"#);
    // Release 8 (RS-2): a coin's own call counts its 30 Tgas as NEAR too, as every call does.
    assert_eq!(moves("usdt.tether-token.near", &ft), Some(vec![("near".into(), 1 + 30_000_000_000_000 * 1_000_000_000), ("nep141:usdt.tether-token.near".into(), 7)]));
    let other = intents("deposit_and_stake", "{}");
    // An allowlisted method may be any contract's, so its 30 Tgas count as NEAR too (the contract review, FB-1).
    assert_eq!(moves("pool.near", &other), Some(vec![("near".into(), 1 + 30_000_000_000_000 * 1_000_000_000)]));
    assert_eq!(moves("intents.near", &intents("mt_transfer", r#"{"token_id":"x","amount":"1.5"}"#)), None, "an amount that isn't a whole number can't be measured");
    assert_eq!(moves("token.near", &intents("ft_withdraw", "{}")), None);
}

/// Round 4c (defence in depth): intents.near's ft_withdraw is measured only with the arguments it is read by or that
/// are harmless (token, receiver_id, amount, memo, msg). Any other, intents.near's own `storage_deposit` (NEAR paid out
/// of the ledger) included, can't be measured. Control: the app's withdrawals, with and without memo and msg.
#[test]
fn r4c_intents_ft_withdraw_takes_only_its_known_arguments() {
    let gas = 30_000_000_000_000u128 * 1_000_000_000;
    let usdc = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    let measured = |args: &str| moves("intents.near", &intents("ft_withdraw", args));
    let want = Some(vec![("near".to_string(), 1 + gas), (format!("nep141:{usdc}"), 7)]);
    assert_eq!(measured(&format!(r#"{{"token":"{usdc}","receiver_id":"bob.near","amount":"7"}}"#)), want, "control: a plain withdrawal");
    assert_eq!(measured(&format!(r#"{{"token":"{usdc}","receiver_id":"{usdc}","amount":"7","memo":"WITHDRAW_TO:x"}}"#)), want, "control: with a memo");
    assert_eq!(measured(&format!(r#"{{"token":"{usdc}","receiver_id":"intents.near","amount":"7","msg":""}}"#)), want, "control: with a msg");
    assert_eq!(measured(&format!(r#"{{"token":"{usdc}","receiver_id":"bob.near","amount":"7","storage_deposit":"1250000000000000000000"}}"#)), None, "storage_deposit");
    assert_eq!(measured(&format!(r#"{{"token":"{usdc}","receiver_id":"bob.near","amount":"7","min_gas":"1"}}"#)), None, "any other argument");
    assert_eq!(measured(&format!(r#"["{usdc}","bob.near","7"]"#)), None, "not an object");
}

fn group(receiver: &str, near: u128) -> Group {
    Group { receiver_id: receiver.parse().unwrap(), steps: send(near) }
}

#[test]
fn a_chain_counts_every_group_toward_the_bands() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    // 4 + 4 is within 10: one approval, at once.
    assert!(p.execute_many(vec![group("a.near", 4 * NEAR), group("b.near", 4 * NEAR)]).done);
    // 4 + 4 more is 16 today: the chain waits as one.
    assert!(!p.execute_many(vec![group("a.near", 4 * NEAR), group("b.near", 4 * NEAR)]).done);
    assert_eq!(p.level_for_many(vec![group("a.near", 1)]), Level::Wait { seconds: U64(86_400) });
}

#[test]
#[should_panic(expected = "own rules change only")]
fn a_chain_cant_call_the_account_itself() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    p.execute_many(vec![group("a.near", 1), Group { receiver_id: me(), steps: send(1) }]);
}

#[test]
fn a_chain_stops_when_a_group_fails() {
    as_account("me.near", 0);
    let _p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    testing_env!(
        VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).account_balance(NearToken::from_near(1_000)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Failed],
    );
    AccountPolicy::on_group_done(vec![group("b.near", NEAR)]);
    assert!(get_logs().iter().any(|l| l.contains("chain_stopped")));
}

#[test]
fn a_long_reply_from_a_group_is_still_a_success() {
    as_account("me.near", 0);
    let _p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    testing_env!(
        VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).account_balance(NearToken::from_near(1_000)).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![near_sdk::PromiseResult::Successful(vec![b'1'; 500])],
    );
    AccountPolicy::on_group_done(vec![group("b.near", NEAR)]);
    assert!(!get_logs().iter().any(|l| l.contains("chain_stopped")));
}

#[test]
fn upgrading_takes_the_strictest_level() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    // Release 9: a release not on the account's list is first added, which waits the words-only fallback (7 days here)
    // when no second device co-signs it; then the switch waits like any change to the account's rules.
    let add = p.upgrade(Base64VecU8(vec![7; 32]));
    assert!(!add.done, "the addition waits");
    assert!(matches!(p.waiting_requests()[0].change, Change::AllowRelease { .. }));
    as_account("me.near", 86_400);
    assert!(refused(|| copy_of(&p).run(add.id.unwrap())), "the phone alone adds a release only after the fallback");
    as_account("me.near", 7 * 86_400);
    assert!(p.run(add.id.unwrap()).done);
    assert_eq!(p.allowed_releases(), vec![Base64VecU8(vec![7; 32])]);
    let out = p.upgrade(Base64VecU8(vec![7; 32]));
    assert!(!out.done, "an upgrade waits like any change to the account's rules");
    assert!(matches!(p.waiting_requests()[0].change, Change::Upgrade { .. }));
    as_account("me.near", 8 * 86_400);
    assert!(p.run(out.id.unwrap()).done);
}

// ── v3: Legacy and Agent, merged ──

#[cfg(feature = "modules")]
fn as_caller(caller: &str, now_s: u64) {
    let caller: AccountId = caller.parse().unwrap();
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(caller.clone()).signer_account_id(caller).block_timestamp(now_s * SECOND).account_balance(NearToken::from_near(1_000)).build());
}

#[cfg(feature = "modules")]
fn legacy_rules() -> legacy::LegacyConfig {
    legacy::LegacyConfig {
        heirs: vec![legacy::Heir { account_id: "mia.near".parse().unwrap(), share_pct: 50 }, legacy::Heir { account_id: "leo.near".parse().unwrap(), share_pct: 50 }],
        quiet_seconds: U64(60),
        claim_delay_seconds: U64(60),
        tokens: vec![],
    }
}

#[cfg(feature = "modules")]
#[test]
fn legacy_setup_waits_behind_the_strictest_level() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let out = p.legacy_setup(legacy_rules());
    assert!(!out.done, "choosing heirs is a change of rules: it waits");
    assert!(p.legacy_status().is_none());
    as_account("me.near", 86_400);
    assert!(p.run(out.id.unwrap()).done);
    assert!(p.legacy_status().is_some());
}

#[cfg(feature = "modules")]
#[test]
fn the_owner_using_the_account_stops_a_waiting_claim() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.legacy_setup(legacy_rules());
    after_wait(&mut p, &[out]);
    as_caller("mia.near", 181);
    p.legacy_start_claim();
    // Any Face ID action by the owner is proof of life.
    as_account("me.near", 182);
    p.execute(bob(), send(1), None);
    assert!(get_logs().iter().any(|l| l.contains("legacy_claim_stopped")));
}

#[cfg(feature = "modules")]
#[test]
#[should_panic(expected = "inheritance claim is waiting")]
fn a_waiting_claim_blocks_moving_the_account() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.legacy_setup(legacy_rules());
    after_wait(&mut p, &[out]);
    as_caller("mia.near", 181);
    p.legacy_start_claim();
    as_account("me.near", 182);
    p.start_recovery(key(7));
}

#[cfg(feature = "modules")]
#[test]
#[should_panic(expected = "only someone named")]
fn a_stranger_cant_pay_out() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.legacy_setup(legacy_rules());
    after_wait(&mut p, &[out]);
    as_caller("mia.near", 181);
    p.legacy_start_claim();
    as_caller("thief.near", 320);
    p.legacy_distribute(vec![]);
}

#[cfg(feature = "modules")]
#[test]
fn an_heir_pays_everyone_out_after_the_delay() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.legacy_setup(legacy_rules());
    after_wait(&mut p, &[out]);
    as_caller("mia.near", 181);
    p.legacy_start_claim();
    as_caller("leo.near", 320);
    p.legacy_distribute(vec![]);
    assert!(get_logs().iter().any(|l| l.contains("legacy_paid_out")));
}

#[cfg(feature = "modules")]
/// A change asked for at the start, run once its wait is over (audit F1: a change to the rules waits the recovery delay
/// plus as much, 120 s on these 60-second accounts). The clock is then at 120 s.
fn after_wait(p: &mut AccountPolicy, outs: &[Outcome]) {
    as_account("me.near", 120);
    for out in outs {
        assert!(p.run(out.id.unwrap()).done);
    }
}

#[cfg(feature = "modules")]
fn agent_budget() -> agent_limits::Budget {
    agent_limits::Budget {
        coins: vec![agent_limits::CoinLimit { coin: "near".into(), per_day: U128(2 * NEAR), per_month: U128(10 * NEAR), convert_per_day: U128(0) }],
        recipients: vec!["landlord.near".parse().unwrap()],
        ends_at_ns: U64(365 * 86_400 * SECOND),
        max_spends_per_day: 12,
    }
}

#[cfg(feature = "modules")]
fn rent_order() -> agent_limits::OrderPlan {
    agent_limits::OrderPlan { payout: agent_limits::Payout::Near, to: "landlord.near".parse().unwrap(), amount: U128(NEAR), dates_ns: vec![U64(1_000 * SECOND)], grace_seconds: U64(3_600) }
}

#[cfg(feature = "modules")]
#[test]
fn giving_agent_a_budget_waits_behind_the_strictest_level() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    let out = p.agent_set(key(5), agent_budget(), vec![rent_order()]);
    assert!(!out.done, "a new spender loosens the rules: it waits");
    assert!(p.agent().is_none());
}

#[cfg(feature = "modules")]
#[test]
fn anyone_can_run_a_dated_order_once_and_it_counts_toward_todays_total() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.agent_set(key(5), agent_budget(), vec![rent_order()]);
    after_wait(&mut p, &[out]);
    as_caller("stranger.near", 1_000);
    p.run_order(U64(1));
    assert!(p.spent_today().iter().any(|(coin, amount)| coin == "near" && amount.0 == NEAR), "agent spends count in the 24-hour totals");
}

#[cfg(feature = "modules")]
#[test]
#[should_panic(expected = "agent.")]
fn a_paused_agent_pays_nothing() {
    as_account("me.near", 0);
    let mut p = fresh();
    let out = p.agent_set(key(5), agent_budget(), vec![rent_order()]);
    after_wait(&mut p, &[out]);
    p.agent_pause();
    as_caller("stranger.near", 1_000);
    p.run_order(U64(1));
}

#[cfg(feature = "modules")]
#[test]
fn agent_spends_dont_count_as_the_owner_being_alive() {
    as_account("me.near", 0);
    let mut p = fresh();
    let a = p.legacy_setup(legacy_rules());
    let b = p.agent_set(key(5), agent_budget(), vec![rent_order()]);
    after_wait(&mut p, &[a, b]);
    as_caller("mia.near", 181);
    p.legacy_start_claim();
    as_caller("stranger.near", 1_000);
    p.run_order(U64(1));
    assert!(!get_logs().iter().any(|l| l.contains("legacy_claim_stopped")));
}

// ── Kids: a child's account, where the parent (the second device) says yes outside the child's rules ──────────

#[cfg(feature = "modules")]
/// A child's account: the parent's phone as its second device; Face ID up to 5 NEAR, the parent above.
fn child() -> AccountPolicy {
    let mut p = fresh();
    assert!(p.add_second_device(key(9)).done);
    assert!(p
        .set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(5 * NEAR)), (USDC.into(), U128(100_000_000))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }])
        .done);
    p
}

#[cfg(feature = "modules")]
fn kid_rules(allowed: &[&str], near_a_week: u128) -> kids::KidsRules {
    kids::KidsRules { allowed: allowed.iter().map(|a| a.parse().unwrap()).collect(), week: vec![("near".into(), U128(near_a_week))] }
}

#[cfg(feature = "modules")]
/// The child sets (or changes) the rules: it waits for the parent's yes, like any loosening.
fn with_kids(mut p: AccountPolicy, rules: kids::KidsRules) -> AccountPolicy {
    let out = p.kids_set(rules);
    assert!(!out.done && out.needs_device, "the parent must say yes to the rules");
    assert!(p.approve(out.id.unwrap()).done);
    p
}

#[cfg(feature = "modules")]
#[test]
fn the_child_pays_listed_people_within_the_week_alone() {
    as_account("me.near", 1_000);
    let mut p = with_kids(child(), kid_rules(&["bob.near"], 3 * NEAR));
    assert_eq!(p.kids().unwrap().allowed, vec![bob()]);
    assert!(p.execute(bob(), send(2 * NEAR), None).done);
    assert_eq!(p.kids().unwrap().week[0].used, U128(2 * NEAR));
}

#[cfg(feature = "modules")]
#[test]
fn someone_not_on_the_list_needs_the_parent() {
    as_account("me.near", 1_000);
    let mut p = with_kids(child(), kid_rules(&["bob.near"], 3 * NEAR));
    let out = p.execute("carol.near".parse().unwrap(), send(NEAR / 10), None);
    assert!(!out.done && out.needs_device);
    assert_eq!(p.kids_why(), vec![(out.id.unwrap(), "not-allowed:carol.near".to_string())]);
    p.cancel(out.id.unwrap());
    assert!(p.kids_why().is_empty(), "the reason goes with the request");
    assert_eq!(p.level_for("carol.near".parse().unwrap(), send(NEAR / 10), None), Level::Device);
}

#[cfg(feature = "modules")]
#[test]
fn a_coin_contract_on_the_list_doesnt_let_the_child_pay_anyone_in_that_coin() {
    as_account("me.near", 1_000);
    let usdc = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    let mut p = with_kids(child(), kid_rules(&[usdc, "bob.near"], 3 * NEAR));
    let to = |who: &str| vec![Step::FunctionCall { method_name: "ft_transfer".into(), args: Base64VecU8(format!(r#"{{"receiver_id":"{who}","amount":"1000000"}}"#).into_bytes()), deposit: U128(1), gas: U64(30_000_000_000_000) }];
    assert!(p.execute(usdc.parse().unwrap(), to("bob.near"), None).done);
    let out = p.execute(usdc.parse().unwrap(), to("mallory.near"), None);
    assert!(!out.done && out.needs_device, "paying mallory in USDC needs the parent");
}

#[cfg(feature = "modules")]
#[test]
fn past_the_weekly_limit_the_parent_says_yes_and_a_no_gives_the_room_back() {
    as_account("me.near", 1_000);
    let mut p = with_kids(child(), kid_rules(&["bob.near"], 3 * NEAR));
    assert!(p.execute(bob(), send(2 * NEAR), None).done);
    let held = p.execute(bob(), send(2 * NEAR), None);
    assert!(!held.done && held.needs_device, "2 + 2 is past this week's 3");
    assert_eq!(p.kids_why(), vec![(held.id.unwrap(), format!("over-week:near:{}", 3 * NEAR))]);
    p.decline(held.id.unwrap());
    assert_eq!(p.kids().unwrap().week[0].used, U128(2 * NEAR));
    assert!(p.execute(bob(), send(NEAR), None).done);
    // A week after it ran, what was spent no longer counts.
    as_account("me.near", 1_000 + 8 * 86_400);
    assert!(p.execute(bob(), send(3 * NEAR), None).done);
}

#[cfg(feature = "modules")]
#[test]
fn turning_the_rules_off_also_needs_the_parent() {
    as_account("me.near", 1_000);
    let mut p = with_kids(child(), kid_rules(&["bob.near"], 3 * NEAR));
    let off = p.kids_off();
    assert!(!off.done && off.needs_device);
    assert!(p.approve(off.id.unwrap()).done);
    assert!(p.kids().is_none());
    assert!(p.execute("carol.near".parse().unwrap(), send(NEAR), None).done, "no rules: only the bands");
}

/// Release 9 had no Agent, Legacy or Kids (product decision, 28 Oct). Their places in `Change` are kept (CancelRecovery is
/// still stored as 15), their payloads can't be read or written, and an account with one waiting fails upgrade_check.
#[cfg(not(any(feature = "agent", feature = "modules")))]
#[test]
fn the_release_keeps_the_module_places_but_takes_none() {
    assert_eq!(borsh::to_vec(&Change::CancelRecovery).unwrap(), vec![15]);
    assert_eq!(borsh::from_slice::<Change>(&[15]).unwrap(), Change::CancelRecovery);
    for index in [9u8, 10, 11, 13] {
        assert!(borsh::from_slice::<Change>(&[index, 0, 0, 0, 0]).is_err(), "Agent's and Kids' payloads: {index}");
    }
    assert!(borsh::to_vec(&Change::AgentSetBudget { budget: Reserved }).is_err());
    as_account("me.near", 0);
    for change in [Change::LegacyOff, Change::AgentResume, Change::KidsOff, Change::LegacySetup { config_json: "{}".into() }] {
        let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
        p.pending.push(Pending { id: U64(1), change, ready_at_ns: U64(0), needs_device: false, approved: false });
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.upgrade_check(6, None))).is_err());
    }
    assert!(!DEVICE_METHODS.contains("agent") && !DEVICE_METHODS.contains("legacy") && !DEVICE_METHODS.contains("kids"));
}

/// Release 10 has Agent (set, budget) but no Legacy, Kids, standing orders or resume: their places stay, an account with
/// one waiting (or Agent with orders) fails upgrade_check, and the phone's method list has Agent's four, no others.
#[cfg(all(feature = "agent", not(feature = "modules")))]
#[test]
fn release_10_keeps_the_module_places_and_takes_only_agent() {
    assert_eq!(borsh::to_vec(&Change::CancelRecovery).unwrap(), vec![15]);
    for index in [12u8, 13] {
        assert!(borsh::from_slice::<Change>(&[index, 0, 0, 0, 0]).is_err(), "Kids' payloads: {index}");
    }
    as_account("me.near", 0);
    for change in [Change::LegacyOff, Change::AgentResume, Change::KidsOff, Change::LegacySetup { config_json: "{}".into() }, Change::AgentSet { public_key: key(5), budget: agent_limits::Budget { coins: vec![], recipients: vec![], ends_at_ns: U64(1), max_spends_per_day: 1 }, orders: vec![agent_limits::OrderPlan { payout: agent_limits::Payout::Near, to: "a.near".parse().unwrap(), amount: U128(1), dates_ns: vec![U64(1)], grace_seconds: U64(3_600) }] }] {
        let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
        p.pending.push(Pending { id: U64(1), change, ready_at_ns: U64(0), needs_device: false, approved: false });
        near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.upgrade_check(6, None))).is_err());
    }
    let p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    env::storage_write(b"order_tries", &[0]);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.upgrade_check(9, None))).is_err(), "standing orders' tries");
    env::storage_remove(b"order_tries");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, None);
    assert!(DEVICE_METHODS.ends_with(",upgrade,agent_set,agent_set_budget,agent_revoke,agent_renew_key") && !DEVICE_METHODS.contains("legacy") && !DEVICE_METHODS.contains("kids") && !DEVICE_METHODS.contains("order"));
}

/// Re-audit 3 lead (auditor B): the 24-hour list (`spent`) had no bound: a row for every coin of every request, zero
/// amounts and long coin names included, so enough tiny Face ID payments in a day grew the state until no method fit in a
/// transaction's gas. Now a zero amount adds no row, and the list holds at most MAX_SPENT_ROWS: a payment past it waits
/// for tomorrow; every other method still runs.
#[test]
fn the_24_hour_list_stays_small_whatever_is_sent() {
    as_account("me.near", 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), None, None);
    p.set_recovery_key(key(1));
    for _ in 0..50 {
        assert!(p.execute(bob(), send(0), None).done);
    }
    assert!(p.spent.is_empty(), "a zero amount counts nothing, so it adds no row");
    let long = |n: u32| format!("{}{n:04}.near", "t".repeat(54));
    let mut refused = 0;
    for n in 0..(MAX_SPENT_ROWS as u32 + 40) {
        let pay = vec![Step::FunctionCall { method_name: "ft_transfer".into(), args: Base64VecU8(r#"{"receiver_id":"bob.near","amount":"1"}"#.as_bytes().to_vec()), deposit: U128(1), gas: U64(10_000_000_000_000) }];
        let to: AccountId = long(n).parse().unwrap();
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(to.clone(), pay.clone(), None))).is_err() {
            refused += 1;
        }
    }
    assert!(p.spent.len() <= MAX_SPENT_ROWS, "{} rows", p.spent.len());
    assert!(refused >= 40, "past the cap a payment waits for tomorrow ({refused} refused)");
    // Everything else still runs, and the next day the room is back.
    as_key(1, 0);
    p.start_recovery(key(7));
    as_account("me.near", 0);
    p.cancel_recovery();
    as_account("me.near", 86_400 + 1);
    assert!(p.execute(bob(), send(1), None).done);
}

// ── Release 7: recovery needs the second device of age; the words-only fallback; roles checked by the contract ──────

const R7_SETUP: u8 = 0x50;
const R7_PHONE: u8 = 0x33;
const R7_WORDS: u8 = 0xEE;
const R7_LAPTOP: u8 = 0x09;
const R7_NEW: u8 = 0x11;

fn refused<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

/// An account made as the app makes one (delay 60 s, floor 120 s, the fallback 14 days), its words, and a laptop added
/// at set-up; `aged`: three days later, so the laptop is of age and the set-up window is over.
fn r7_account(aged: bool) -> AccountPolicy {
    as_key(R7_SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), Some(key(R7_PHONE)), None);
    assert!(p.set_recovery_key(key(R7_WORDS)).done);
    as_key(R7_PHONE, 1);
    assert!(p.add_second_device(key(R7_LAPTOP)).done);
    as_key(R7_PHONE, if aged { 3 * 86_400 } else { 2 });
    p
}

#[test]
fn r7_with_a_second_device_of_age_the_finish_needs_its_yes() {
    let mut p = r7_account(true);
    let t = 8 * 86_400; // release 10 (F1): its laptop on the account for the fallback
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    let status = p.recovery_status().unwrap();
    assert!(status.needs_device && !status.approved);
    assert_eq!(status.ready_at_ns.0, (t + 60) * SECOND);
    assert_eq!(status.fallback_at_ns.0, (t + 7 * 86_400) * SECOND);
    assert_eq!(status.can_finish_at_ns.0, status.fallback_at_ns.0, "without the yes, the words wait for the fallback");
    assert_eq!(p.frozen_until(), Some(status.fallback_at_ns));
    // After the delay, no yes: refused.
    as_key(R7_WORDS, t + 61);
    assert!(refused(|| p.finish_recovery()));
    assert!(p.pending().is_some());
    // The laptop says yes to this recovery (bound to its new key and finish time), then the words finish.
    as_key(R7_LAPTOP, t + 62);
    p.approve_recovery(key(R7_NEW), U64((t + 60) * SECOND));
    let status = p.recovery_status().unwrap();
    assert!(status.approved && status.can_finish_at_ns.0 == (t + 60) * SECOND);
    assert!(get_logs().iter().any(|l| l.contains("recovery_approved")));
    as_key(R7_WORDS, t + 63);
    finish_ok(&mut p);
    assert!(p.pending().is_none() && p.recovery_status().is_none());
    assert!(get_logs().iter().any(|l| l.contains("recovery_finished")));
    assert!(env::storage_read(RECOVERY_YES_KEY).is_none(), "the yes goes with the recovery");
    // The laptop was of age: it stays (re-audit 3, A-4 removes only young ones).
    assert_eq!(p.second_device_count(), 1);
}

#[test]
fn r7_a_yes_counts_only_for_the_recovery_it_names() {
    let mut p = r7_account(true);
    let t = 8 * 86_400; // release 10 (F1): its laptop on the account for the fallback
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    as_key(R7_LAPTOP, t + 1);
    assert!(refused(|| p.approve_recovery(key(0x12), U64((t + 60) * SECOND))), "another new key");
    assert!(refused(|| p.approve_recovery(key(R7_NEW), U64((t + 61) * SECOND))), "another finish time");
    assert!(!p.recovery_status().unwrap().approved);
    p.approve_recovery(key(R7_NEW), U64((t + 60) * SECOND));
    assert!(p.recovery_status().unwrap().approved);
    // The laptop changes its mind: the recovery ends, and its yes with it; the next start has no yes.
    p.refuse_recovery(None);
    assert!(p.pending().is_none());
    as_key(R7_WORDS, t + 2);
    p.start_recovery(key(R7_NEW));
    assert!(!p.recovery_status().unwrap().approved);
    as_key(R7_WORDS, t + 70);
    assert!(refused(|| p.finish_recovery()));
    // A yes from a laptop no longer on the account doesn't count either (the record names the device by hash).
    as_key(R7_LAPTOP, t + 71);
    p.approve_recovery(key(R7_NEW), U64((t + 62) * SECOND));
    assert!(p.recovery_status().unwrap().approved);
    p.second_devices.clear();
    assert!(!p.recovery_status().unwrap().approved);
}

#[test]
fn r7_the_second_device_refuses_a_recovery_and_spending_stays_frozen() {
    let mut p = r7_account(true);
    let t = 3 * 86_400;
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    // What the phone asks alone during it waits the floor and goes with the refusal.
    as_key(R7_PHONE, t + 1);
    let alone = p.execute(bob(), send(NEAR), None);
    assert!(!alone.done);
    as_key(R7_LAPTOP, t + 2);
    p.refuse_recovery(None);
    assert!(get_logs().iter().any(|l| l.contains("recovery_refused")));
    assert!(p.pending().is_none());
    assert!(p.waiting_requests().is_empty(), "what the phone asked alone is dropped");
    assert_eq!(p.frozen_until(), Some(U64((t + 2 + 120) * SECOND)), "frozen for the floor, as after the phone's stop");
    as_key(R7_PHONE, t + 3);
    let pay = p.execute(bob(), send(NEAR), None);
    assert!(!pay.done && pay.ready_at_ns == Some(U64((t + 3 + 120) * SECOND)), "a payment waits the floor while frozen");
    // Nothing to refuse once it's over.
    as_key(R7_LAPTOP, t + 4);
    assert!(refused(|| p.refuse_recovery(None)));
}

#[test]
fn r7_the_words_alone_finish_after_the_fallback() {
    let mut p = r7_account(true);
    let t = 3 * 86_400;
    assert_eq!(p.fallback_seconds().0, 7 * 86_400);
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    as_key(R7_WORDS, t + 7 * 86_400 - 1);
    assert!(refused(|| p.finish_recovery()), "a second before the fallback");
    as_key(R7_WORDS, t + 7 * 86_400);
    finish_ok(&mut p);
    assert!(p.pending().is_none());
    assert_eq!(p.second_device_count(), 1);
}

#[test]
fn r7_the_fallback_is_set_at_new_within_its_bounds() {
    as_key(R7_SETUP, 0);
    let day = 86_400;
    assert!(refused(|| AccountPolicy::new(U64(60), simple_bands(), None, Some(U64(7 * day - 1)))), "less than a week");
    assert!(refused(|| AccountPolicy::new(U64(60), simple_bands(), None, Some(U64(30 * day + 1)))), "more than 30 days");
    assert!(refused(|| AccountPolicy::new(U64(3 * day), simple_bands(), None, Some(U64(8 * day)))), "less than 3 times the delay");
    let p = AccountPolicy::new(U64(60), simple_bands(), None, Some(U64(7 * day)));
    assert_eq!(p.fallback_seconds().0, 7 * day);
    let p = AccountPolicy::new(U64(2 * day), simple_bands(), None, Some(U64(30 * day)));
    assert_eq!(p.fallback_seconds().0, 30 * day, "longer, up to 30 days, is the person's choice");
    // The defaults for the app's choices (product decision, 29 Oct): 24 h, 48 h, 3 and 7 days; and the 30-day edge.
    for (delay, floor, fallback) in [(day, 2 * day, 7 * day), (2 * day, 3 * day, 7 * day), (3 * day, 4 * day, 9 * day), (7 * day, 8 * day, 21 * day), (30 * day, 31 * day, 30 * day)] {
        let p = AccountPolicy::new(U64(delay), simple_bands(), None, None);
        assert_eq!(p.fallback_seconds().0, fallback, "fallback for a {delay} s delay");
        assert_eq!(p.floor_ns(), floor * SECOND, "floor for a {delay} s delay");
        assert_eq!(p.delay_seconds().0, delay);
    }
    assert!(refused(|| AccountPolicy::new(U64(30 * day + 1), simple_bands(), None, None)), "more than 30 days");
}

/// The release wasm is built without `short-waits`: a day is the least delay (product decision, 29 Oct). `cargo test
/// --no-default-features --lib r7_release_minimum` runs the first branch; the sandbox suite checks the pinned wasm itself.
#[test]
fn r7_release_minimum_delay_is_a_day_and_the_test_build_allows_a_minute() {
    #[cfg(not(feature = "short-waits"))]
    {
        assert_eq!(MIN_RECOVERY_DELAY_NS, DAY_NS);
        as_key(R7_SETUP, 0);
        assert!(refused(|| AccountPolicy::new(U64(86_399), simple_bands(), None, None)), "a second under a day");
        assert!(refused(|| AccountPolicy::new(U64(60), simple_bands(), None, None)), "a minute");
        let p = AccountPolicy::new(U64(86_400), simple_bands(), None, None);
        assert_eq!(p.delay_seconds().0, 86_400);
    }
    #[cfg(feature = "short-waits")]
    {
        assert_eq!(MIN_RECOVERY_DELAY_NS, 60 * SECOND);
        as_key(R7_SETUP, 0);
        assert!(refused(|| AccountPolicy::new(U64(59), simple_bands(), None, None)));
    }
}

/// Every release-7 rule at the app's two main choices, 24 and 48 hours: the floor, the fallback, the device's yes, the
/// refusal's freeze, and the words-only finish, each at the exact second.
#[test]
fn r7_the_rules_hold_at_24_and_48_hours() {
    let day = 86_400;
    for delay in [day, 2 * day] {
        let floor = delay + day;
        as_key(R7_SETUP, 0);
        let mut p = AccountPolicy::new(U64(delay), simple_bands(), Some(key(R7_PHONE)), None);
        assert!(p.set_recovery_key(key(R7_WORDS)).done);
        as_key(R7_PHONE, 1);
        assert!(p.add_second_device(key(R7_LAPTOP)).done);
        // Of age exactly a floor after it was added; a change waits exactly the floor.
        as_key(R7_PHONE, floor);
        assert_eq!(p.second_devices_of_age(), 0);
        as_key(R7_PHONE, floor + 1);
        assert_eq!(p.second_devices_of_age(), 1);
        let change = p.set_protection(bands_for_test());
        assert_eq!(change.ready_at_ns, Some(U64((floor + 1 + floor) * SECOND)), "a change waits the floor ({floor} s)");
        p.cancel(change.id.unwrap());
        // A recovery: the delay, then the device's yes; without it, the fallback (7 days for both).
        let t = 10 * day;
        as_key(R7_WORDS, t);
        p.start_recovery(key(R7_NEW));
        let st = p.recovery_status().unwrap();
        assert_eq!((st.ready_at_ns.0, st.fallback_at_ns.0), ((t + delay) * SECOND, (t + 7 * day) * SECOND));
        as_key(R7_WORDS, t + delay);
        assert!(refused(|| p.finish_recovery()), "no yes");
        as_key(R7_LAPTOP, t + delay + 1);
        p.approve_recovery(key(R7_NEW), U64((t + delay) * SECOND));
        as_key(R7_WORDS, t + delay + 2);
        finish_ok(&mut p);
        // The new phone; the laptop stays; a refusal freezes exactly a floor.
        as_key(R7_WORDS, t + delay + 3);
        p.start_recovery(key(0x12));
        as_key(R7_LAPTOP, t + delay + 4);
        p.refuse_recovery(None);
        assert_eq!(p.frozen_until(), Some(U64((t + delay + 4 + floor) * SECOND)));
        as_key(R7_NEW, t + delay + 4 + floor - 1);
        assert!(!p.execute(bob(), send(1), None).done, "still frozen at the last second");
        as_key(R7_NEW, t + delay + 4 + floor);
        assert!(p.execute(bob(), send(1), None).done, "unfrozen");
        // Words only, after the fallback, with the laptop still there.
        let t2 = 30 * day;
        as_key(R7_WORDS, t2);
        p.start_recovery(key(0x13));
        as_key(R7_WORDS, t2 + 7 * day - 1);
        assert!(refused(|| p.finish_recovery()));
        as_key(R7_WORDS, t2 + 7 * day);
        finish_ok(&mut p);
        assert_eq!(p.second_device_count(), 1);
    }
}

fn bands_for_test() -> Vec<Band> {
    vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(3_600) } }]
}

#[test]
fn r7_the_thief_with_the_phone_and_the_words_cant_finish_within_the_delay() {
    let mut p = r7_account(true);
    let t = 3 * 86_400;
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    // Neither the phone nor the words can say yes for the laptop.
    as_key(R7_PHONE, t + 1);
    assert!(refused(|| p.approve_recovery(key(R7_NEW), U64((t + 60) * SECOND))));
    as_key(R7_WORDS, t + 1);
    assert!(refused(|| p.approve_recovery(key(R7_NEW), U64((t + 60) * SECOND))));
    // After the delay, and a day later: still refused.
    for at in [t + 60, t + 61, t + 86_400] {
        as_key(R7_WORDS, at);
        assert!(refused(|| p.finish_recovery()), "{at}");
    }
    assert!(p.pending().is_some());
    // The thief's phone can't spend meanwhile (frozen), and the owner's laptop ends it.
    as_key(R7_PHONE, t + 86_401);
    assert!(!p.execute(bob(), send(NEAR), None).done);
    as_key(R7_LAPTOP, t + 86_402);
    p.refuse_recovery(None);
    assert!(p.pending().is_none());
}

#[test]
fn r7_a_young_second_device_changes_nothing_about_a_recovery() {
    let mut p = r7_account(false);
    let t = 2;
    assert_eq!(p.second_devices_of_age(), 0);
    as_key(R7_WORDS, t);
    p.start_recovery(key(R7_NEW));
    assert!(!p.recovery_status().unwrap().needs_device);
    as_key(R7_LAPTOP, t + 1);
    assert!(refused(|| p.approve_recovery(key(R7_NEW), U64((t + 60) * SECOND))), "too young to say yes");
    assert!(refused(|| p.refuse_recovery(None)), "too young to refuse");
    // As before: the words alone finish after the delay, and the young device goes with the old phone (A-4).
    as_key(R7_WORDS, t + 60);
    finish_ok(&mut p);
    assert_eq!(p.second_device_count(), 0);
}

#[test]
fn r7_the_contract_checks_who_may_call_what() {
    let mut p = r7_account(true);
    let t = 3 * 86_400;
    as_key(R7_LAPTOP, t);
    assert!(refused(|| p.execute(bob(), send(1), None)), "a second device can't pay");
    assert!(refused(|| p.set_protection(simple_bands())), "a second device can't change the rules");
    assert!(refused(|| p.start_recovery(key(R7_NEW))), "a second device can't start a recovery");
    as_key(R7_WORDS, t);
    assert!(refused(|| p.execute(bob(), send(1), None)), "the words can't pay");
    assert!(refused(|| p.cancel_recovery()), "the words can't act as the phone");
    assert!(refused(|| p.approve(U64(1))), "the words can't answer");
    as_key(R7_PHONE, t);
    assert!(refused(|| p.start_recovery(key(R7_NEW))), "the phone can't start a recovery");
    assert!(refused(|| p.finish_recovery()), "the phone can't finish one");
    assert!(refused(|| p.refuse_recovery(None)), "the phone can't refuse one");
    assert!(refused(|| p.approve(U64(1))), "the phone can't answer as a second device");
    as_key(0x77, t);
    assert!(refused(|| p.execute(bob(), send(1), None)), "an unknown key is refused (sealed list)");
    assert!(refused(|| p.start_recovery(key(R7_NEW))), "an unknown key can't start a recovery");
    assert!(refused(|| p.approve_recovery(key(R7_NEW), U64(0))), "an unknown key can't say yes");
    // The phone still works.
    as_key(R7_PHONE, t);
    assert!(p.execute(bob(), send(1), None).done);
}

#[test]
fn p1_a_step_over_300_tgas_is_refused_at_the_door() {
    let mut p = r7_account(true);
    let step = |gas: u64| vec![Step::FunctionCall { method_name: "near_deposit".into(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas) }];
    assert!(refused(|| p.execute(bob(), step(300_000_000_000_001), None)));
    assert!(refused(|| p.execute_many(vec![Group { receiver_id: bob(), steps: step(u64::MAX) }])));
    // Release 8 (RS-1): a single execute is held to the chain's 250 Tgas in all, so a lone 300 Tgas step is refused too.
    assert!(refused(|| p.execute(bob(), step(300_000_000_000_000), None)));
    let ok = p.execute(bob(), step(250_000_000_000_000), None);
    assert!(ok.done || ok.id.is_some());
}

#[test]
fn r7_upgrade_check_gives_an_older_account_the_default_fallback() {
    let p = r7_account(true);
    env::storage_remove(FALLBACK_KEY);
    assert_eq!(p.fallback_seconds().0, 7 * 86_400, "read as the default until stored");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(6, None);
    assert_eq!(load_key::<u64>(FALLBACK_KEY), Some(7 * 86_400 * SECOND));
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused(|| p.upgrade_check(11, None)), "never back to an older release");
    assert_eq!(p.release_version(), RELEASE_VERSION);
}

#[test]
fn r7_a_second_device_key_gets_the_four_methods() {
    as_key(R7_SETUP, 0);
    let mut p = AccountPolicy::new(U64(60), simple_bands(), Some(key(R7_PHONE)), None);
    as_key(R7_PHONE, 1);
    assert!(p.add_second_device(key(R7_LAPTOP)).done);
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("approve_recovery") && a.contains("refuse_recovery") && a.contains("approve") && a.contains("decline")), "{actions:?}");
    assert_eq!(SECOND_DEVICE_METHODS, "approve,decline,approve_recovery,refuse_recovery,refill_recovery_key");
}

// ── Re-audit 7: the auditor's proofs of concept as regression tests. Each `poc_*` fails before its fix and
// asserts the fixed behaviour; the `poc_holds_*` ones assert what the auditor found holding. A 48-hour account unless said.

const PA_D: u64 = 86_400;
const PA_DELAY: u64 = 48 * 3_600;
const PA_FLOOR: u64 = PA_DELAY + PA_D;
const PA_FALLBACK: u64 = 7 * PA_D;
const PA_NEW: u8 = 0x15;

fn copy_of(p: &AccountPolicy) -> AccountPolicy {
    borsh::from_slice(&borsh::to_vec(p).unwrap()).unwrap()
}

fn fails_with<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
        Ok(_) => panic!("expected a refusal"),
    }
}

/// An account with the given delay, its phone named at `new`, words, and a laptop added in the set-up window; handed
/// back at `t` (the laptop is of age from a floor after it was added).
fn pa_account(delay_s: u64, t: u64) -> AccountPolicy {
    as_key(R7_SETUP, 0);
    let mut p = AccountPolicy::new(U64(delay_s), simple_bands(), Some(key(R7_PHONE)), None);
    assert!(p.set_recovery_key(key(R7_WORDS)).done);
    as_key(R7_PHONE, 0);
    assert!(p.add_second_device(key(R7_LAPTOP)).done);
    as_key(R7_PHONE, t);
    p
}

/// R7-1 (High): the phone and the words could remove the laptop of age (72 h, unrefusable) and then recover without it
/// (48 h): five days, under the 7-day fallback. Now the removal of a device of age waits the fallback (the laptop shows
/// it for a week); release 10 (V1): a young one's removal too.
#[test]
fn poc_r7_1_removing_a_laptop_of_age_waits_the_fallback() {
    let mut p = pa_account(PA_DELAY, 4 * PA_D);
    let t0 = 4 * PA_D;
    let out = p.remove_key(key(R7_LAPTOP));
    assert!(!out.done && !out.needs_device);
    assert_eq!(out.ready_at_ns.unwrap().0, (t0 + PA_FALLBACK) * SECOND, "the removal waits the 7-day fallback, not the 72-hour floor");
    // Still F2/F3: the laptop can't refuse it, and refuse_recovery has nothing to refuse.
    as_key(R7_LAPTOP, t0 + 1);
    let e = fails_with(|| copy_of(&p).decline(out.id.unwrap()));
    assert!(e.contains("second device's removal") || e.contains("doesn't need your second device"), "{e}");
    assert!(fails_with(|| copy_of(&p).refuse_recovery(None)).contains("no recovery is waiting"));
    // At the floor it's still waiting; a thief's recovery started then can't finish before the owner's laptop acts.
    as_key(R7_PHONE, t0 + PA_FLOOR);
    assert!(fails_with(|| copy_of(&p).run(out.id.unwrap())).contains("still waiting"));
    as_key(R7_WORDS, t0 + PA_FLOOR);
    p.start_recovery(key(PA_NEW));
    assert!(p.waiting_requests().is_empty(), "the start drops the removal (it was asked by the phone alone)");
    assert!(p.recovery_status().unwrap().needs_device, "the laptop is still there and of age");
    // A lost laptop still goes, after the fallback.
    let mut q = pa_account(PA_DELAY, 4 * PA_D);
    let gone = q.remove_key(key(R7_LAPTOP));
    as_key(R7_PHONE, t0 + PA_FALLBACK);
    assert!(q.run(gone.id.unwrap()).done);
    assert_eq!(q.second_device_count(), 0);
    // Release 10 (V1): a young laptop's removal waits the fallback too (it comes of age before it would run).
    let mut y = pa_account(PA_DELAY, PA_D);
    let young = y.remove_key(key(R7_LAPTOP));
    assert_eq!(young.ready_at_ns.unwrap().0, (PA_D + PA_FALLBACK) * SECOND);
}

/// R7-1 control (held before and after): with the laptop and a copy of the words, the owner's start drops the removal
/// and the approved recovery finishes at the delay.
#[test]
fn poc_r7_1_control_owner_with_laptop_and_words_wins() {
    let mut p = pa_account(PA_DELAY, 8 * PA_D);
    let t0 = 8 * PA_D; // release 10 (F1): its laptop on the account for the fallback
    let id = p.remove_key(key(R7_LAPTOP)).id.unwrap();
    as_key(R7_WORDS, t0 + 2 * PA_D);
    p.start_recovery(key(PA_NEW));
    assert!(p.waiting_requests().iter().all(|q| q.id != id));
    as_key(R7_LAPTOP, t0 + 2 * PA_D);
    p.approve_recovery(key(PA_NEW), U64((t0 + 2 * PA_D + PA_DELAY) * SECOND));
    as_key(R7_PHONE, t0 + 2 * PA_D);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    let id2 = p.remove_key(key(R7_LAPTOP)).id.unwrap();
    as_key(R7_LAPTOP, t0 + 2 * PA_D + 1);
    p.decline(stop.id.unwrap());
    as_key(R7_PHONE, t0 + 2 * PA_D + PA_FALLBACK);
    assert!(fails_with(|| copy_of(&p).run(id2)).contains("a move to a new phone is waiting"));
    as_key(R7_WORDS, t0 + 2 * PA_D + PA_DELAY);
    finish_ok(&mut p);
    assert!(p.recovery_status().is_none());
}

/// R7-2 (Medium): the phone could ask stop after stop (each refusal paid by the laptop's allowance) and, once the laptop
/// stopped answering, an unanswered stop ended a recovery the laptop had said yes to. Now: one stop per recovery with a
/// device of age, and a stop nobody answered never ends an approved recovery.
#[test]
fn poc_r7_2_one_stop_per_recovery_and_no_unanswered_stop_of_an_approved_one() {
    let mut p = pa_account(PA_DELAY, 8 * PA_D);
    let t0 = 8 * PA_D; // release 10 (F1): its laptop on the account for the fallback
    as_key(R7_WORDS, t0);
    p.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, t0);
    p.approve_recovery(key(PA_NEW), U64((t0 + PA_DELAY) * SECOND));
    assert!(!p.recovery_status().unwrap().stop_asked, "no stop asked yet (the app shows Stop it)");
    as_key(R7_PHONE, t0 + 1);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    assert!(p.recovery_status().unwrap().stop_asked, "recovery_status says the one stop is spent");
    as_key(R7_LAPTOP, t0 + 2);
    p.decline(stop.id.unwrap());
    assert!(p.recovery_status().unwrap().stop_asked, "still spent after the laptop's refusal of it");
    // A second stop of the same recovery: refused, however many times.
    for i in 3..10u64 {
        as_key(R7_PHONE, t0 + i);
        assert!(fails_with(|| copy_of(&p).cancel_recovery()).contains("already asked one stop"), "round {i}");
    }
    // The next recovery gets its one stop again.
    as_key(R7_LAPTOP, t0 + 20);
    p.refuse_recovery(None);
    as_key(R7_WORDS, t0 + 21);
    p.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, t0 + 22);
    p.approve_recovery(key(PA_NEW), U64((t0 + 21 + PA_DELAY) * SECOND));
    as_key(R7_PHONE, t0 + 23);
    let stop2 = p.cancel_recovery();
    assert_eq!(stop2.ready_at_ns.unwrap().0, (t0 + 23 + PA_D) * SECOND);
    // Unanswered: after its day the phone can't run it against the laptop's yes; the recovery and its yes stay.
    as_key(R7_PHONE, t0 + 23 + PA_D);
    assert!(fails_with(|| copy_of(&p).run(stop2.id.unwrap())).contains("said yes to this move"));
    assert!(p.recovery_status().unwrap().approved);
    // The words finish; the stale stop goes with the finish.
    as_key(R7_WORDS, t0 + 21 + PA_DELAY);
    finish_ok(&mut p);
    assert!(p.waiting_requests().is_empty());
    // Without the laptop's yes, an unanswered stop still ends the recovery after its day (re-audit R3), and freezes.
    let mut q = pa_account(PA_DELAY, 8 * PA_D);
    env::storage_remove(FREEZE_KEY);
    as_key(R7_WORDS, t0);
    q.start_recovery(key(PA_NEW));
    as_key(R7_PHONE, t0 + 1);
    let s = q.cancel_recovery();
    as_key(R7_PHONE, t0 + 1 + PA_D);
    assert!(q.run(s.id.unwrap()).done);
    assert!(q.recovery_status().is_none());
    assert_eq!(q.frozen_until().unwrap().0, (t0 + 1 + PA_D + PA_FLOOR) * SECOND);
}

/// R7-3 (Medium): a release-6 laptop key only has approve and decline. upgrade_check from release 6 renews every second
/// device's key with this release's four methods and a fresh allowance.
#[test]
fn poc_r7_3_upgrade_from_release_6_renews_the_second_devices_keys() {
    let p = pa_account(PA_DELAY, 4 * PA_D);
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).block_timestamp(4 * PA_D * SECOND).build());
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(6, None);
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("DeleteKey")), "{actions:?}");
    assert!(actions.iter().any(|a| a.contains("approve_recovery") && a.contains("refuse_recovery") && a.contains("1000000000000000000000000")), "{actions:?}");
    // From release 9 too (release 10, A1: from any earlier release, whatever release last renewed them). Release 10
    // renews the phone's keys from 9 (Agent's methods), and from 10 itself nothing.
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).block_timestamp(4 * PA_D * SECOND).build());
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, None);
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("approve_recovery")), "{actions:?}");
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).block_timestamp(4 * PA_D * SECOND).build());
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(RELEASE_VERSION, None);
    // Round 4 (D4-1b): no marker is a build before 10_002, whose words had two methods: the words are renewed. Round 4b
    // (R2-1): no marker is also main's unmarked release-10 build, whose laptop key may lack this release's methods: the
    // second devices are renewed too.
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("end_dispute")), "{actions:?}");
    assert!(actions.iter().any(|a| a.contains("approve_recovery") && a.contains("refuse_recovery") && a.contains("refill_recovery_key")), "{actions:?}");
    // Round 4c (S1-1): from round 4's build (marker 10_003) too: every install renews the words and the second devices.
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).block_timestamp(4 * PA_D * SECOND).build());
    near_sdk::env::storage_write(INSTALLED_KEY, &borsh::to_vec(&10_003u32).unwrap());
    p.upgrade_check(RELEASE_VERSION, None);
    let actions: Vec<String> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).map(|a| format!("{a:?}")).collect();
    assert!(actions.iter().any(|a| a.contains("end_dispute")), "{actions:?}");
    assert!(actions.iter().any(|a| a.contains("approve_recovery") && a.contains("refill_recovery_key")), "{actions:?}");
    // Control: on this build itself (its marker), the check refuses and renews nothing.
    testing_env!(VMContextBuilder::new().current_account_id(me()).predecessor_account_id(me()).signer_account_id(me()).block_timestamp(4 * PA_D * SECOND).build());
    near_sdk::env::storage_write(INSTALLED_KEY, &borsh::to_vec(&RELEASE_BUILD).unwrap());
    assert!(fails_with(|| p.upgrade_check(RELEASE_VERSION, None)).contains("installed already"));
    assert!(near_sdk::test_utils::get_created_receipts().is_empty());
}

/// R7-4 (Low): the laptop's refusal froze the owner's spending even with the phone's stop waiting (the phone and the
/// laptop together are the owner). Now a refusal with a stop waiting is the laptop's yes to that stop: no freeze.
#[test]
fn poc_r7_4_refusal_with_the_phones_stop_waiting_is_a_cosigned_stop_without_freeze() {
    // Release 10 (round 2, G2): a yes to the stop needs the laptop on the account for the fallback, so it is a day past it.
    let t0 = PA_FALLBACK + PA_D;
    let mut p = pa_account(PA_DELAY, t0);
    env::storage_remove(FREEZE_KEY);
    as_key(R7_WORDS, t0);
    p.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, t0 + 1);
    p.refuse_recovery(None);
    assert_eq!(p.frozen_until().unwrap().0, (t0 + 1 + PA_FLOOR) * SECOND, "alone, the refusal freezes (whoever started it may hold the phone)");
    let mut p = pa_account(PA_DELAY, t0);
    env::storage_remove(FREEZE_KEY);
    as_key(R7_WORDS, t0);
    p.start_recovery(key(PA_NEW));
    as_key(R7_PHONE, t0 + 1);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    as_key(R7_LAPTOP, t0 + 2);
    // R7-9: a plain refusal with the stop waiting still freezes (the stop may be a thief's, placed to lift the freeze).
    let mut plain = copy_of(&p);
    plain.refuse_recovery(None);
    assert!(plain.recovery_status().is_none() && plain.waiting_requests().is_empty());
    assert_eq!(plain.frozen_until().unwrap().0, (t0 + 2 + PA_FLOOR) * SECOND, "a plain refusal always freezes");
    env::storage_remove(FREEZE_KEY); // the mock's storage is shared by the copy: undo its freeze for the account below
    // Only the device's explicit confirmation of the phone's stop is two of three: no freeze.
    let mut none = pa_account(PA_DELAY, t0);
    as_key(R7_WORDS, t0);
    none.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, t0 + 2);
    assert!(fails_with(|| none.refuse_recovery(Some(true))).contains("no stop from the phone"), "nothing to confirm without a waiting stop");
    p.refuse_recovery(Some(true));
    assert!(p.recovery_status().is_none() && p.waiting_requests().is_empty());
    assert!(p.frozen_until().is_none(), "two of three ended it: no freeze");
    as_key(R7_PHONE, t0 + 3);
    assert!(p.execute(bob(), send(NEAR), None).done);
}

/// R7-5 (Low): a chain of four groups could carry 4 x 300 Tgas past the door. Now the chain's gas, links included, fits
/// one transaction.
#[test]
fn poc_r7_5_a_chains_whole_gas_fits_one_transaction() {
    let mut p = pa_account(PA_DELAY, 4 * PA_D);
    let big = |g: u64| vec![Step::FunctionCall { method_name: "near_deposit".into(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g) }];
    let groups: Vec<Group> = (0..4).map(|_| Group { receiver_id: bob(), steps: big(MAX_STEP_GAS) }).collect();
    assert!(fails_with(|| copy_of(&p).execute_many(groups)).contains("at most 250 Tgas in all"));
    let over: Vec<Group> = (0..2).map(|_| Group { receiver_id: bob(), steps: big(MAX_CHAIN_GAS / 2 - CHAIN_LINK_GAS + 1) }).collect();
    assert!(fails_with(|| copy_of(&p).execute_many(over)).contains("at most 250 Tgas in all"), "a gas unit over the cap");
    let two: Vec<Group> = (0..2).map(|_| Group { receiver_id: bob(), steps: big(MAX_CHAIN_GAS / 2 - CHAIN_LINK_GAS) }).collect();
    let out = p.execute_many(two);
    assert!(out.done || out.id.is_some(), "exactly 250 Tgas with its two links is accepted");
}

/// Held (the auditor's E-2): a 30-day account's fallback equals its delay; a 10-day one's is 30 days; the bounds at new.
#[test]
fn poc_holds_e2_thirty_day_fallback_equals_delay() {
    let mut p = pa_account(30 * PA_D, 40 * PA_D);
    assert_eq!(p.fallback_seconds().0, 30 * PA_D);
    as_key(R7_WORDS, 40 * PA_D);
    p.start_recovery(key(PA_NEW));
    let s = p.recovery_status().unwrap();
    assert!(s.needs_device && !s.approved && s.can_finish_at_ns == s.ready_at_ns);
    as_key(R7_SETUP, 0);
    assert_eq!(AccountPolicy::new(U64(10 * PA_D), simple_bands(), Some(key(R7_PHONE)), None).fallback_seconds().0, 30 * PA_D);
    assert!(refused(|| AccountPolicy::new(U64(PA_DELAY), simple_bands(), Some(key(R7_PHONE)), Some(U64(PA_FALLBACK - 1)))));
    assert!(refused(|| AccountPolicy::new(U64(PA_DELAY), simple_bands(), Some(key(R7_PHONE)), Some(U64(30 * PA_D + 1)))));
}

/// Held: a yes is bound to (new key, finish time), wiped at every start and end; the roles are checked by the contract.
#[test]
fn poc_holds_yes_binding_and_roles() {
    let t0 = 8 * PA_D; // release 10 (F1): its laptop on the account for the fallback
    let mut p = pa_account(PA_DELAY, t0);
    as_key(R7_WORDS, t0);
    p.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, t0);
    assert!(fails_with(|| copy_of(&p).approve_recovery(key(PA_NEW), U64((t0 + PA_DELAY + 1) * SECOND))).contains("isn't the recovery"));
    assert!(fails_with(|| copy_of(&p).approve_recovery(key(6), U64((t0 + PA_DELAY) * SECOND))).contains("isn't the recovery"));
    p.approve_recovery(key(PA_NEW), U64((t0 + PA_DELAY) * SECOND));
    p.refuse_recovery(None);
    as_key(R7_WORDS, t0);
    p.start_recovery(key(PA_NEW));
    assert!(!p.recovery_status().unwrap().approved, "restarted in the same block with the same key: the yes doesn't survive");
    as_key(R7_LAPTOP, t0);
    assert!(fails_with(|| copy_of(&p).execute(bob(), send(1), None)).contains("second device can only answer"));
    as_key(R7_WORDS, t0);
    assert!(fails_with(|| copy_of(&p).cancel_recovery()).contains("backup words can only"));
    as_key(R7_PHONE, t0);
    assert!(fails_with(|| copy_of(&p).approve_recovery(key(PA_NEW), U64((t0 + PA_DELAY) * SECOND))).contains("only a second device"));
    assert!(fails_with(|| copy_of(&p).finish_recovery()).contains("only the backup words"));
}

/// Held: a young laptop vouches for nothing, its clock stops during the recovery, and the finish deletes it.
#[test]
fn poc_holds_young_laptop() {
    let mut p = pa_account(PA_DELAY, PA_D);
    as_key(R7_LAPTOP, PA_D);
    assert!(refused(|| copy_of(&p).refuse_recovery(None)));
    as_key(R7_WORDS, PA_D);
    p.start_recovery(key(PA_NEW));
    as_key(R7_LAPTOP, PA_D + 1);
    assert!(fails_with(|| copy_of(&p).approve_recovery(key(PA_NEW), U64((PA_D + PA_DELAY) * SECOND))).contains("less than a change's wait"));
    assert!(fails_with(|| copy_of(&p).refuse_recovery(None)).contains("less than a change's wait"));
    as_key(R7_WORDS, 10 * PA_D);
    assert_eq!(p.second_devices_of_age(), 0);
    finish_ok(&mut p);
    assert_eq!(p.second_device_count(), 0);
    as_key(R7_PHONE, 10 * PA_D);
    assert!(fails_with(|| copy_of(&p).execute(bob(), send(1), None)).contains("replaced"));
    as_key(PA_NEW, 10 * PA_D);
    assert!(p.execute(bob(), send(1), None).done);
}

/// Held: a 24-hour account: the floor 48 h, the phone's stop waits 12 h, the fallback 7 days.
#[test]
fn poc_holds_24h_account_times() {
    let mut p = pa_account(PA_D, 3 * PA_D);
    env::storage_remove(FREEZE_KEY);
    assert_eq!(p.fallback_seconds().0, PA_FALLBACK);
    as_key(R7_WORDS, 3 * PA_D);
    p.start_recovery(key(PA_NEW));
    as_key(R7_PHONE, 3 * PA_D);
    let stop = p.cancel_recovery();
    assert_eq!(stop.ready_at_ns.unwrap().0, (3 * PA_D + 12 * 3_600) * SECOND);
    as_key(R7_PHONE, 3 * PA_D + 12 * 3_600);
    assert!(p.run(stop.id.unwrap()).done);
    assert_eq!(p.frozen_until().unwrap().0, (3 * PA_D + 12 * 3_600 + 2 * PA_D) * SECOND);
}
