//! Release 10: Agent's own key with a daily limit (src/agent.rs), and the R9-AL1 fix. Each test is the attack or the
//! promise it holds: the day boundary, the limit reached, a key above the limit refused, the kill switch, the bands
//! (Agent never pays what the phone's Face ID alone couldn't), the freeze and the recovery, the floor on a new key.
#![cfg(all(feature = "agent", not(feature = "modules")))]
mod common;
use account_policy::{AccountPolicy, Band, Change, Level, Step, DEVICE_METHODS, RELEASE_VERSION};
use agent_limits::{Budget, CoinLimit, Payout};
use common::finish_ok;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const NEW_PHONE: u8 = 0x11;
const AGENT: u8 = 0xA6;
/// A day's delay: the floor is 2 days, the fallback 7.
const FLOOR: u64 = 2 * DAY;
const FALLBACK: u64 = 7 * DAY;
/// The fee allowance Agent's key gets, which counts as NEAR in the 24-hour totals.
const ALLOWANCE: u128 = 250 * MILLI;
/// When the tests ask for Agent: after the account's first 24 hours (its set-up window), as on an upgraded account.
const ASK: u64 = DAY + 100;

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn api() -> AccountId {
    "api.example.near".parse().unwrap()
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

fn refused_with<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "refused".into()),
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

fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}

/// A day's delay, the phone named (sealed), the words set, Face ID up to 1 NEAR a day, else a day's wait.
fn account() -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// Agent may spend `per_day` NEAR a day, to anyone, for a year.
fn budget(per_day: u128) -> Budget {
    Budget { coins: vec![CoinLimit { coin: "near".into(), per_day: U128(per_day), per_month: U128(30 * per_day), convert_per_day: U128(per_day) }], recipients: vec![], ends_at_ns: U64(400 * DAY * SECOND), max_spends_per_day: 12 }
}

/// Agent set up with 0.5 NEAR a day: asked after the set-up window, run after the floor. Returns when it ran (s).
fn with_agent(p: &mut AccountPolicy) -> u64 {
    as_key(PHONE, ASK);
    let out = p.agent_set(key(AGENT), budget(500 * MILLI), None);
    assert!(!out.done, "a new key waits a change's wait");
    let at = ASK + FLOOR;
    as_key(PHONE, at);
    assert!(p.run(out.id.unwrap()).done);
    at
}

fn agent_pays(p: &mut AccountPolicy, at: u64, yocto: u128) -> String {
    as_key(AGENT, at);
    refused_with(|| copy_of(p).agent_pay(Payout::Near, api(), U128(yocto)))
}

#[test]
fn r10_release_and_the_phones_methods() {
    assert_eq!(RELEASE_VERSION, 10);
    assert!(DEVICE_METHODS.ends_with(",agent_set,agent_set_budget,agent_revoke,agent_renew_key"));
}

#[test]
fn r10_a_new_agent_key_waits_the_floor_then_gets_one_method_and_a_capped_allowance() {
    let mut p = account();
    as_key(PHONE, ASK);
    let out = p.agent_set(key(AGENT), budget(500 * MILLI), None);
    assert!(!out.done && !out.needs_device);
    assert_eq!(out.ready_at_ns.unwrap().0, (ASK + FLOOR) * SECOND, "the floor: the backup words can stop it first");
    assert!(p.agent().is_none());
    as_key(PHONE, ASK + FLOOR - 1);
    assert!(refused_with(|| copy_of(&p).run(out.id.unwrap())).contains("still waiting"));
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(out.id.unwrap()).done);
    let acts = actions();
    let add = acts.iter().find_map(|a| match a {
        MockAction::AddKeyWithFunctionCall { allowance, method_names, receiver_id, .. } => Some((allowance.map(|a| a.as_yoctonear()), method_names.clone(), receiver_id.clone())),
        _ => None,
    });
    assert_eq!(add, Some((Some(ALLOWANCE), vec!["agent_pay".to_string()], me())), "{acts:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_agent_key")), "a callback checks the add");
    assert!(p.spent_today().iter().any(|(c, a)| c == "near" && a.0 == ALLOWANCE), "the key's fee allowance counts as NEAR in the 24-hour totals");
    assert!(p.agent().is_some());
}

#[test]
fn r10_a_key_above_the_limit_is_refused() {
    let mut p = account();
    as_key(PHONE, ASK);
    // The Face ID band is 1 NEAR a day: a day limit of 1.01 NEAR is more than the phone's Face ID alone ever allows.
    assert!(refused_with(|| copy_of(&p).agent_set(key(AGENT), budget(1_010 * MILLI), None)).contains("agent.limit.bands"));
    // A coin the Face ID band doesn't list never fits it.
    let mut usdc = budget(MILLI);
    usdc.coins[0].coin = "nep141:usdc.near".into();
    assert!(refused_with(|| copy_of(&p).agent_set(key(AGENT), usdc, None)).contains("agent.limit.bands"));
    // Exactly the band fits: 0.51 NEAR a day, the key's 0.25 NEAR allowance and 12 payments' gas (0.24 NEAR) make 1 NEAR.
    assert!(refused_with(|| copy_of(&p).agent_set(key(AGENT), budget(510 * MILLI), None)).is_empty());
    // And when it runs, the bands are read again: tightened meanwhile, it is refused then.
    let out = p.agent_set(key(AGENT), budget(510 * MILLI), None);
    let tighter = p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(NEAR / 2))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }]);
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(tighter.id.unwrap()).done);
    assert!(refused_with(|| copy_of(&p).run(out.id.unwrap())).contains("agent.limit.bands"));
}

#[test]
fn r10_agent_pays_within_its_limit_and_it_counts_with_the_phones() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    p.agent_pay(Payout::Near, api(), U128(300 * MILLI));
    let acts = actions();
    assert!(acts.iter().any(|a| matches!(a, MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == 300 * MILLI)), "{acts:?}");
    assert!(acts.iter().any(|a| matches!(a, MockAction::FunctionCallWeight { method_name, .. } if method_name == b"on_agent_settled")));
    assert!(get_logs().iter().any(|l| l.contains("agent_paid")));
    let near = p.spent_today().into_iter().find(|(c, _)| c == "near").unwrap().1 .0;
    assert_eq!(near, ALLOWANCE + 300 * MILLI);
    let view = p.agent().unwrap();
    assert_eq!(view.spent[0].1 .0, 300 * MILLI);
    assert_eq!(view.spends_today, 1);
}

#[test]
fn r10_the_limit_reached_is_refused() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    p.agent_pay(Payout::Near, api(), U128(300 * MILLI));
    assert!(agent_pays(&mut p, t + 1, 201 * MILLI).contains("agent.limit.day"), "0.3 + 0.201 is over 0.5 NEAR a day");
    assert!(agent_pays(&mut p, t + 1, 200 * MILLI).is_empty(), "exactly the limit is allowed");
    assert!(agent_pays(&mut p, t + 1, 0).contains("agent.amount.zero"));
}

#[test]
fn r10_the_day_boundary_is_rolling_24_hours() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    p.agent_pay(Payout::Near, api(), U128(500 * MILLI));
    assert!(agent_pays(&mut p, t + DAY - 1, MILLI).contains("agent.limit.day"), "a second before 24 hours: nothing left");
    assert!(agent_pays(&mut p, t + DAY, 500 * MILLI).is_empty(), "24 hours on, the whole limit again (no midnight reset)");
}

#[test]
fn r10_agent_never_pays_what_the_phones_face_id_alone_could_not() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    // The phone pays 0.6 NEAR at Face ID: with the key's allowance, 0.85 of the band's 1 NEAR is used.
    as_key(PHONE, t);
    assert!(p.execute("bob.near".parse().unwrap(), send(600 * MILLI), None).done);
    // Agent's own limit allows 0.2, but the band doesn't: refused, never placed to wait.
    assert!(agent_pays(&mut p, t + 1, 200 * MILLI).contains("agent.limit.bands"));
    assert!(agent_pays(&mut p, t + 1, 150 * MILLI).is_empty(), "what still fits the band runs");
    // A coin's payment carries gas, counted as NEAR like the phone's: a USDC payment needs NEAR in the band too.
}

#[test]
fn r10_while_a_recovery_waits_agent_pays_nothing_and_the_finish_deletes_its_key() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    assert!(agent_pays(&mut p, t + 1, MILLI).contains("agent.limit.bands"), "frozen: nothing runs at Face ID");
    // A new budget asked by the old phone meanwhile waits, and goes with the finish.
    as_key(PHONE, t + 2);
    let loosen = p.agent_set_budget(budget(510 * MILLI));
    assert!(!loosen.done);
    as_key(WORDS, t + DAY + 5);
    let _ = finish_ok(&mut p);
    let acts = actions();
    assert!(p.agent().is_none(), "the recovery revoked Agent");
    assert!(acts.iter().any(|a| matches!(a, MockAction::DeleteKey { public_key, .. } if public_key.key_data() == &key(AGENT).0[1..])), "Agent's key is deleted: {acts:?}");
    assert!(!p.waiting_requests().iter().any(|w| matches!(w.change, Change::AgentSetBudget { .. } | Change::AgentSet { .. })));
}

#[test]
fn r10_the_kill_switch_deletes_the_key_at_once() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(PHONE, t);
    p.agent_revoke();
    assert!(actions().iter().any(|a| matches!(a, MockAction::DeleteKey { public_key, .. } if public_key.key_data() == &key(AGENT).0[1..])));
    assert!(p.agent().is_none());
    assert!(agent_pays(&mut p, t + 1, MILLI).contains("no Agent"));
    // A waiting set goes with the kill switch too.
    as_key(PHONE, t + 2);
    let again = p.agent_set(key(AGENT + 1), budget(MILLI), None);
    assert!(!again.done);
    p.agent_revoke();
    assert!(p.waiting_requests().is_empty());
    assert!(refused_with(|| copy_of(&p).agent_revoke()).contains("no Agent"));
}

#[test]
fn r10_agents_key_can_do_nothing_else() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    assert!(refused_with(|| copy_of(&p).execute("bob.near".parse().unwrap(), send(MILLI), None)).contains("Agent's key can't do this"));
    assert!(refused_with(|| copy_of(&p).agent_revoke()).contains("Agent's key can't do this"));
    assert!(refused_with(|| copy_of(&p).agent_set_budget(budget(MILLI))).contains("Agent's key can't do this"));
    assert!(refused_with(|| copy_of(&p).upgrade(Base64VecU8(vec![1; 32]))).contains("Agent's key can't do this"));
    // And the phone can't pay as Agent.
    as_key(PHONE, t);
    assert!(refused_with(|| copy_of(&p).agent_pay(Payout::Near, api(), U128(MILLI))).contains("agent.key.not-agent"));
    // Agent's key takes no other role.
    assert!(refused_with(|| copy_of(&p).add_second_device(key(AGENT))).contains("already on this account"));
    as_key(WORDS, t);
    assert!(refused_with(|| copy_of(&p).start_recovery(key(AGENT))).contains("already on this account"));
}

#[test]
fn r10_never_this_account_or_intents_itself() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    assert!(refused_with(|| copy_of(&p).agent_pay(Payout::Near, me(), U128(MILLI))).contains("agent.recipient.never"));
    assert!(refused_with(|| copy_of(&p).agent_pay(Payout::Near, "intents.near".parse().unwrap(), U128(MILLI))).contains("agent.recipient.never"));
}

#[test]
fn r10_a_tighter_budget_is_at_once_a_looser_one_waits() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(PHONE, t);
    assert!(p.agent_set_budget(budget(200 * MILLI)).done, "tightening: at once");
    assert_eq!(p.agent().unwrap().budget.coins[0].per_day.0, 200 * MILLI);
    let loosen = p.agent_set_budget(budget(400 * MILLI));
    assert!(!loosen.done && loosen.ready_at_ns.unwrap().0 == (t + FLOOR) * SECOND, "loosening waits the floor");
}

#[test]
fn r10_a_failed_payment_still_counts() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(AGENT, t);
    p.agent_pay(Payout::Near, api(), U128(400 * MILLI));
    // Its callback with a failed result: nothing is given back (its gas burned; a coin may have moved).
    env::state_write(&p);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_agent_settled(U64(1));
    let p: AccountPolicy = env::state_read().unwrap();
    assert!(get_logs().iter().any(|l| l.contains("agent_payment_failed")));
    assert_eq!(p.agent().unwrap().spent[0].1 .0, 400 * MILLI);
    assert_eq!(p.spent_today().into_iter().find(|(c, _)| c == "near").unwrap().1 .0, ALLOWANCE + 400 * MILLI);
}

#[test]
fn r10_a_key_near_refused_leaves_no_agent() {
    let mut p = account();
    let _ = with_agent(&mut p);
    env::state_write(&p);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    AccountPolicy::on_agent_key(key(AGENT + 1));
    let q: AccountPolicy = env::state_read().unwrap();
    assert!(q.agent().is_some(), "another key's failure changes nothing");
    AccountPolicy::on_agent_key(key(AGENT));
    let q: AccountPolicy = env::state_read().unwrap();
    assert!(q.agent().is_none(), "NEAR refused Agent's key: Agent is forgotten");
}

#[test]
fn r10_an_unsealed_account_gets_no_agent() {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }];
    let mut p = AccountPolicy::new(U64(DAY), bands, None, None);
    as_key(PHONE, 1);
    assert!(refused_with(|| copy_of(&p).agent_set(key(AGENT), budget(MILLI), None)).contains("sealed"));
}

#[test]
fn r10_no_standing_orders() {
    let mut p = account();
    as_key(PHONE, ASK);
    let order = agent_limits::OrderPlan { payout: Payout::Near, to: api(), amount: U128(MILLI), dates_ns: vec![U64(200 * SECOND)], grace_seconds: U64(3_600) };
    assert!(refused_with(|| copy_of(&p).agent_set(key(AGENT), budget(MILLI), Some(vec![order]))).contains("no standing orders"));
}

#[test]
fn r10_upgrade_check_from_9_gives_the_phone_agents_methods() {
    let p = account();
    as_key(PHONE, 10);
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
    let renewed = actions().into_iter().find_map(|a| match a {
        MockAction::AddKeyWithFunctionCall { public_key, allowance, method_names, .. } if public_key.key_data() == &key(PHONE).0[1..] => Some((allowance, method_names)),
        _ => None,
    });
    let (allowance, methods) = renewed.expect("the phone's key is renewed");
    assert_eq!(allowance, None, "no fee limit, as before");
    assert_eq!(methods.join(","), DEVICE_METHODS);
}

/// The phone alone, in the set-up window: adds a laptop it holds (no floor), waits for it to come of age, has it co-sign
/// an AllowRelease. Release 9 listed it in twice the floor (4 days); now not before the fallback (7 days). Each moment
/// runs on a fresh scenario: the mock keeps a refused call's storage writes, which NEAR would roll back.
fn al1_scenario() -> (AccountPolicy, U64) {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, FLOOR + 20);
    let out = p.upgrade(Base64VecU8(vec![9; 32]));
    as_key(LAPTOP, FLOOR + 21);
    assert!(!p.approve(out.id.unwrap()).done);
    (p, out.id.unwrap())
}

#[test]
fn r9_al1_a_laptop_the_phone_added_lists_a_release_only_after_the_fallback() {
    for at in [2 * FLOOR + 20, 10 + FALLBACK - 1] {
        let (p, id) = al1_scenario();
        as_key(PHONE, at);
        assert!(refused_with(|| copy_of(&p).run(id)).contains("fallback"), "at {at}");
    }
    let (mut p, id) = al1_scenario();
    as_key(PHONE, 10 + FALLBACK);
    assert!(p.run(id).done, "the laptop has been on the account for the fallback wait");
    assert_eq!(p.allowed_releases(), vec![Base64VecU8(vec![9; 32])]);
}

#[test]
fn r10_one_first_day_agent_with_a_new_account_runs_at_once_and_only_one() {
    // The diff review's M-1: at once only for a budget that ends with the account's first 24 hours, once per account.
    let first_day = |per_day: u128| Budget { ends_at_ns: U64(DAY * SECOND), ..budget(per_day) };
    let mut p = account();
    as_key(PHONE, 100);
    assert!(!copy_of(&p).agent_set(key(AGENT), budget(500 * MILLI), None).done, "a budget that outlives the first day waits the floor");
    let late = Budget { ends_at_ns: U64(DAY * SECOND + 1), ..budget(500 * MILLI) };
    assert!(!copy_of(&p).agent_set(key(AGENT), late, None).done, "a second past the first day: waits");
    assert!(p.agent_set(key(AGENT), first_day(500 * MILLI), None).done, "ends with the first day: at once");
    assert!(p.agent().is_some());
    // A looser budget waits the floor even inside the window.
    assert!(!p.agent_set_budget(first_day(510 * MILLI)).done);
    // Turned off and set up again on the same first day: no second first-day Agent, it waits.
    as_key(PHONE, 200);
    p.agent_revoke();
    assert!(!p.agent_set(key(AGENT + 1), first_day(100 * MILLI), None).done, "only one first-day Agent per account");
    // Past the first day the budget has ended: Agent pays nothing.
    let mut q = account();
    as_key(PHONE, 100);
    assert!(q.agent_set(key(AGENT), first_day(500 * MILLI), None).done);
    assert!(agent_pays(&mut q, DAY, MILLI).contains("agent.ended"));
}

#[test]
fn r10_remove_key_never_takes_agents_key() {
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(PHONE, t);
    assert!(refused_with(|| copy_of(&p).remove_key(key(AGENT))).contains("Agent's off switch"));
}

#[test]
fn r10_an_older_agent_stays_on_its_release() {
    let p = account();
    // A readable older Agent with no standing orders (release 4 wrote the same borsh shape).
    let older = agent_limits::Agent::new(&key(PHONE).0, key(AGENT).0, budget(MILLI), vec![], env::block_timestamp(), &me()).unwrap();
    env::storage_write(b"agent", &near_sdk::borsh::to_vec(&older).unwrap());
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused_with(|| p.upgrade_check(4, None)).contains("older Agent"), "the diff review's L-1");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused_with(|| p.upgrade_check(9, None)).contains("older Agent"));
    env::storage_remove(b"agent");
    near_sdk::env::storage_remove(b"installed"); // as an account on an earlier release (K1)
    assert!(refused_with(|| p.upgrade_check(9, None)).is_empty());
}

// ── The 4 Nov security audit (QA): its findings 6 and 16 and its RemoveKey proof of concept ─────────────────

/// An account whose last band needs the laptop (a key change does too): the laptop added in its set-up window, then
/// that band set (it waits the old strictest band's day), all before Agent is asked for.
fn laptop_account() -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, 2);
    assert!(p.add_second_device(key(LAPTOP)).done, "the first second device in the set-up window goes at once");
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
    let out = p.set_protection(bands);
    if !out.done {
        as_key(PHONE, DAY + 3);
        assert!(p.run(out.id.unwrap()).done);
    }
    assert_eq!(p.protection().last().unwrap().level, Level::Device);
    p
}

/// Agent set up on the laptop account: asked after the set-up window, the laptop says yes after the floor.
fn with_agent_and_laptop(p: &mut AccountPolicy) -> u64 {
    as_key(PHONE, ASK);
    let id = p.agent_set(key(AGENT), budget(500 * MILLI), None).id.unwrap();
    let at = ASK + FLOOR;
    as_key(LAPTOP, at);
    if !p.approve(id).done {
        as_key(PHONE, at);
        assert!(p.run(id).done);
    }
    assert!(p.agent().is_some());
    at
}

#[test]
fn r10_audit_6_a_new_agent_key_needs_the_laptop_where_key_changes_do() {
    let mut p = laptop_account();
    as_key(PHONE, ASK);
    let out = p.agent_set(key(AGENT), budget(500 * MILLI), None);
    assert!(!out.done && out.needs_device, "a key change at the strictest band: the laptop's yes (it was Face ID)");
    assert_eq!(out.ready_at_ns.unwrap().0, (ASK + FLOOR) * SECOND, "and the floor");
    as_key(PHONE, ASK + FLOOR);
    assert!(!refused_with(|| copy_of(&p).run(out.id.unwrap())).is_empty(), "the phone alone never runs it");
    assert!(p.agent().is_none());
    // Control: with the laptop's yes, it goes.
    with_agent_and_laptop(&mut laptop_account());
}

#[test]
fn r10_audit_6_a_looser_budget_needs_the_laptop_a_tighter_one_goes_at_once() {
    let mut p = laptop_account();
    let t = with_agent_and_laptop(&mut p) + 10;
    as_key(PHONE, t);
    assert!(p.agent_set_budget(budget(200 * MILLI)).done, "tightening: at once, as before");
    let loosen = p.agent_set_budget(budget(400 * MILLI));
    assert!(!loosen.done && loosen.needs_device, "loosening is as much as a new key: the laptop's yes");
    assert_eq!(loosen.ready_at_ns.unwrap().0, (t + FLOOR) * SECOND, "and the floor");
}

#[test]
fn r10_audit_6_the_first_day_agent_is_unchanged() {
    // In its first day an account's last band is still the one it was made with (here a day's wait, stricter than Face
    // ID): the one first-day Agent still goes at once, and any other still waits.
    let first_day = Budget { ends_at_ns: U64(DAY * SECOND), ..budget(500 * MILLI) };
    let mut p = account();
    as_key(PHONE, 2);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 100);
    assert!(!copy_of(&p).agent_set(key(AGENT), budget(500 * MILLI), None).done, "control: a longer budget waits");
    assert!(p.agent_set(key(AGENT), first_day, None).done, "a new account's one first-day Agent keeps the Face ID level");
}

#[test]
fn r10_audit_16_a_renewal_is_refused_past_the_face_id_band() {
    // The audit's proof of concept: the Face ID band used up, then renewals ran at once.
    let mut p = account();
    let t = with_agent(&mut p) + 10;
    as_key(PHONE, t);
    assert!(refused_with(|| copy_of(&p).agent_renew_key()).is_empty(), "control: inside the band, at once");
    assert!(p.execute("bob.near".parse().unwrap(), send(700 * MILLI), None).done);
    as_key(PHONE, t + 1);
    assert!(refused_with(|| copy_of(&p).agent_renew_key()).contains("agent.renew.level"), "past the band: refused");
    // A day later the band has room again: at once.
    as_key(PHONE, t + DAY + 1);
    assert!(refused_with(|| copy_of(&p).agent_renew_key()).is_empty());
}

#[test]
fn r10_audit_16_a_renewal_is_refused_while_a_recovery_waits() {
    let mut p = account();
    let t = with_agent(&mut p) + DAY + 10; // a fresh day: the band has room
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    assert!(refused_with(|| copy_of(&p).agent_renew_key()).contains("agent.renew.level"), "frozen: never at once");
}

#[test]
fn r10_audit_a_waiting_removal_never_deletes_a_later_agent_key() {
    // The audit's proof of concept: a removal asked for a key with no role yet, then that key set up as Agent's.
    let mut p = account();
    as_key(PHONE, ASK);
    let rm = p.remove_key(key(AGENT));
    assert!(!rm.done);
    let out = p.agent_set(key(AGENT), budget(500 * MILLI), None);
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(out.id.unwrap()).done);
    let r = refused_with(|| copy_of(&p).run(rm.id.unwrap()));
    assert!(r.contains("Agent's off switch"), "re-checked when it runs: {r}");
    assert!(!actions().iter().any(|a| matches!(a, MockAction::DeleteKey { public_key, .. } if public_key.key_data() == &key(AGENT).0[1..])));
}
