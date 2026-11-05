use super::*;
use near_sdk::borsh;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR: &str = "nep141:wrap.near";
const YEAR: u64 = 365 * 86_400;
const MONTH: u64 = 30 * 86_400;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn me() -> AccountId {
    acc("me.near")
}

fn heir(name: &str, share_pct: u8) -> Heir {
    Heir { account_id: acc(name), share_pct }
}

fn config(heirs: Vec<Heir>) -> LegacyConfig {
    LegacyConfig { heirs, quiet_seconds: U64(YEAR), claim_delay_seconds: U64(MONTH), tokens: vec![USDC.into(), WNEAR.into()] }
}

/// Mia and Leo, half each; 12 months of quiet, then a 30-day claim delay. Set up at t = 0.
fn family() -> LegacyState {
    setup(&me(), config(vec![heir("mia.near", 50), heir("leo.near", 50)]), 0).unwrap()
}

fn s(seconds: u64) -> u64 {
    seconds * SECOND
}

/// A family whose claim (started by Mia right at the end of the quiet period) is ready to pay out.
fn ready() -> (LegacyState, u64) {
    let mut l = family();
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    (l, s(YEAR + MONTH))
}

// ── Setup ────────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn setup_starts_the_quiet_period_now() {
    let l = setup(&me(), config(vec![heir("mia.near", 50), heir("leo.near", 50)]), s(1_000)).unwrap();
    assert_eq!(l.last_seen_ns, U64(s(1_000)));
    assert_eq!(l.claimable_at_ns(), s(1_000 + YEAR));
    assert_eq!(l.claim, None);
    assert_eq!(l.status(s(1_000)).stage, Stage::Quiet);
}

#[test]
fn shares_must_add_up_to_100() {
    let err = setup(&me(), config(vec![heir("mia.near", 50), heir("leo.near", 40)]), 0).unwrap_err();
    assert!(err.contains("add up to 90%"), "{err}");
    let err = setup(&me(), config(vec![heir("mia.near", 60), heir("leo.near", 60)]), 0).unwrap_err();
    assert!(err.contains("add up to 120%"), "{err}");
}

#[test]
fn every_heir_gets_at_least_one_percent() {
    let err = setup(&me(), config(vec![heir("mia.near", 100), heir("leo.near", 0)]), 0).unwrap_err();
    assert!(err.contains("at least 1%"), "{err}");
}

#[test]
fn nobody_is_named_twice() {
    let err = setup(&me(), config(vec![heir("mia.near", 50), heir("mia.near", 50)]), 0).unwrap_err();
    assert!(err.contains("named twice"), "{err}");
}

#[test]
fn the_account_cannot_be_its_own_heir() {
    let err = setup(&me(), config(vec![heir("me.near", 100)]), 0).unwrap_err();
    assert!(err.contains("its own heir"), "{err}");
}

#[test]
fn between_one_and_ten_heirs() {
    assert!(setup(&me(), config(vec![]), 0).unwrap_err().contains("between one and ten"));
    let ten: Vec<Heir> = (0..10).map(|i| heir(&format!("h{i}.near"), 10)).collect();
    assert!(setup(&me(), config(ten), 0).is_ok());
    let mut eleven: Vec<Heir> = (0..10).map(|i| heir(&format!("h{i}.near"), 9)).collect();
    eleven.push(heir("h10.near", 10));
    assert!(setup(&me(), config(eleven), 0).unwrap_err().contains("between one and ten"));
}

#[test]
fn periods_have_limits() {
    let with = |quiet: u64, delay: u64| setup(&me(), LegacyConfig { quiet_seconds: U64(quiet), claim_delay_seconds: U64(delay), ..config(vec![heir("mia.near", 100)]) }, 0);
    assert!(with(60, 60).is_ok(), "60 seconds is the demo minimum");
    assert!(with(59, 60).unwrap_err().contains("quiet period"));
    assert!(with(60, 59).unwrap_err().contains("claim delay"));
    assert!(with(10 * YEAR, YEAR).is_ok());
    assert!(with(10 * YEAR + 1, MONTH).unwrap_err().contains("quiet period"));
    assert!(with(YEAR, YEAR + 1).unwrap_err().contains("claim delay"));
    assert!(with(u64::MAX, MONTH).unwrap_err().contains("quiet period"), "an overflowing number of seconds is refused, not wrapped");
}

#[test]
fn only_fungible_intents_tokens_can_be_listed() {
    let with = |tokens: Vec<&str>| setup(&me(), LegacyConfig { tokens: tokens.into_iter().map(String::from).collect(), ..config(vec![heir("mia.near", 100)]) }, 0);
    assert!(with(vec![]).is_ok(), "NEAR alone");
    assert!(with(vec![USDC, "nep245:v2_1.omni.hot.tg:56_11111111111111111111"]).is_ok());
    for bad in ["near", "nep171:nft.near:1", "nep141:", "nep141:Not An Account", "nep245:multi.near", "nep245:multi.near:", "usdc"] {
        assert!(with(vec![bad]).unwrap_err().contains("can split"), "{bad} should be refused");
    }
    assert!(with(vec![USDC, USDC]).unwrap_err().contains("listed twice"));
    let many: Vec<String> = (0..33).map(|i| format!("nep141:t{i}.near")).collect();
    assert!(setup(&me(), LegacyConfig { tokens: many, ..config(vec![heir("mia.near", 100)]) }, 0).unwrap_err().contains("at most 32"));
}

// ── Claims ───────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_stranger_can_never_start_a_claim() {
    let mut l = family();
    let err = l.start_claim(&acc("thief.near"), s(10 * YEAR)).unwrap_err();
    assert!(err.contains("only someone named"), "{err}");
    let err = l.start_claim(&me(), s(10 * YEAR)).unwrap_err();
    assert!(err.contains("only someone named"), "the owner's own account isn't an heir either: {err}");
    assert_eq!(l.claim, None);
}

#[test]
fn an_heir_cannot_ask_before_the_full_quiet_period() {
    let mut l = family();
    let err = l.start_claim(&acc("mia.near"), s(YEAR - 1)).unwrap_err();
    assert_eq!(err, "you can ask in 1 seconds");
    let err = l.start_claim(&acc("mia.near"), s(YEAR) - 1).unwrap_err();
    assert_eq!(err, "you can ask in 1 seconds", "partial seconds round up, never down to 0");
    assert_eq!(l.claim, None);
}

#[test]
fn after_the_quiet_period_an_heir_can_ask_and_the_delay_starts() {
    let mut l = family();
    assert_eq!(l.status(s(YEAR)).stage, Stage::CanClaim);
    l.start_claim(&acc("leo.near"), s(YEAR + 5)).unwrap();
    assert_eq!(l.claim, Some(Claim { by: acc("leo.near"), started_at_ns: U64(s(YEAR + 5)), ready_at_ns: U64(s(YEAR + 5 + MONTH)) }));
    assert_eq!(l.status(s(YEAR + 5)).stage, Stage::ClaimWaiting);
    assert_eq!(l.status(s(YEAR + 5 + MONTH)).stage, Stage::CanPayOut);
}

#[test]
fn a_second_claim_cannot_restart_the_delay() {
    let mut l = family();
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    let err = l.start_claim(&acc("leo.near"), s(YEAR + 100)).unwrap_err();
    assert!(err.contains("already started"), "{err}");
    assert_eq!(l.claim.as_ref().unwrap().ready_at_ns, U64(s(YEAR + MONTH)));
}

// ── The owner is alive ───────────────────────────────────────────────────────────────────────────────────────

#[test]
fn any_owner_activity_restarts_the_quiet_period() {
    let mut l = family();
    assert_eq!(l.on_owner_activity(s(YEAR - 10)), None);
    assert_eq!(l.claimable_at_ns(), s(2 * YEAR - 10));
    assert!(l.start_claim(&acc("mia.near"), s(YEAR + 10)).unwrap_err().contains("you can ask in"));
}

#[test]
fn activity_never_moves_the_clock_backwards() {
    let mut l = family();
    l.on_owner_activity(s(500));
    l.on_owner_activity(s(100));
    assert_eq!(l.last_seen_ns, U64(s(500)));
}

#[test]
fn owner_activity_stops_a_waiting_claim_and_says_so() {
    let mut l = family();
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    let stopped = l.on_owner_activity(s(YEAR + 7)).expect("the claim is stopped");
    assert_eq!(stopped.by, acc("mia.near"));
    assert_eq!(l.claim, None);
    assert_eq!(l.last_stopped, Some(StoppedClaim { claim: stopped, stopped_at_ns: U64(s(YEAR + 7)), by: StoppedBy::Activity }));
    assert_eq!(l.status(s(YEAR + 7)).stage, Stage::Quiet);
    assert_eq!(l.claimable_at_ns(), s(2 * YEAR + 7), "the quiet period starts again from the activity");
    assert!(l.payout_plan(s(YEAR + MONTH), 10 * NEAR, &[]).unwrap_err().contains("no claim"), "nothing can be paid out after it stopped");
}

#[test]
fn the_owner_can_stop_a_claim_explicitly() {
    let mut l = family();
    assert!(l.cancel_claim(s(5)).unwrap_err().contains("no claim is waiting"));
    assert_eq!(l.last_seen_ns, U64(0), "a refused call changes nothing");
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    let stopped = l.cancel_claim(s(YEAR + 60)).unwrap();
    assert_eq!(stopped.by, acc("mia.near"));
    assert_eq!(l.last_stopped.as_ref().unwrap().by, StoppedBy::Owner);
    assert_eq!(l.claimable_at_ns(), s(2 * YEAR + 60));
}

#[test]
fn an_owner_who_comes_back_after_the_delay_stops_further_payouts() {
    let (mut l, now) = ready();
    assert!(l.payout_plan(now, 10 * NEAR, &[]).is_ok());
    l.on_owner_activity(now + s(1));
    assert!(l.payout_plan(now + s(2), 10 * NEAR, &[]).unwrap_err().contains("no claim"));
}

// ── Payout ───────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn nothing_is_paid_before_the_claim_delay() {
    let mut l = family();
    assert!(l.payout_plan(s(10 * YEAR), 10 * NEAR, &[]).unwrap_err().contains("no claim has started"));
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    let err = l.payout_plan(s(YEAR + MONTH - 1), 10 * NEAR, &[]).unwrap_err();
    assert_eq!(err, "it can be paid out in 1 seconds");
}

#[test]
fn the_payout_splits_near_and_tokens_by_share() {
    let (l, now) = ready();
    let plan = l.payout_plan(now, 12 * NEAR, &[(USDC.into(), 1_240_500_000)]).unwrap();
    assert_eq!(
        plan,
        vec![
            Payout { receiver_id: acc("mia.near"), near: 6 * NEAR, tokens: vec![(USDC.into(), 620_250_000)] },
            Payout { receiver_id: acc("leo.near"), near: 6 * NEAR, tokens: vec![(USDC.into(), 620_250_000)] },
        ]
    );
}

#[test]
fn rounding_leftovers_go_to_the_first_heir_and_nothing_is_created() {
    let mut l = setup(&me(), config(vec![heir("a.near", 33), heir("b.near", 33), heir("c.near", 34)]), 0).unwrap();
    l.start_claim(&acc("b.near"), s(YEAR)).unwrap();
    let plan = l.payout_plan(s(YEAR + MONTH), 0, &[(USDC.into(), 101)]).unwrap();
    let parts: Vec<u128> = plan.iter().map(|p| p.tokens[0].1).collect();
    assert_eq!(parts, vec![34, 33, 34], "33% of 101 is 33.33 → 33, plus the 1 left over; 34% of 101 is 34.34 → 34");
    assert_eq!(parts.iter().sum::<u128>(), 101);
}

#[test]
fn shares_never_add_up_to_more_than_the_balance() {
    let shares: [&[u8]; 5] = [&[100], &[50, 50], &[33, 33, 34], &[1, 99], &[10, 10, 10, 10, 10, 10, 10, 10, 10, 10]];
    let amounts = [0u128, 1, 2, 3, 99, 100, 101, 999_999, 1_240_500_000, 7 * NEAR + 13, u128::MAX - 1, u128::MAX];
    for pcts in shares {
        let heirs: Vec<Heir> = pcts.iter().enumerate().map(|(i, p)| heir(&format!("h{i}.near"), *p)).collect();
        let mut l = setup(&me(), config(heirs), 0).unwrap();
        l.start_claim(&acc("h0.near"), s(YEAR)).unwrap();
        for amount in amounts {
            let parts = l.split(amount);
            assert_eq!(parts.iter().sum::<u128>(), amount, "{pcts:?} of {amount}");
            for (i, part) in parts.iter().enumerate().skip(1) {
                // Every heir but the first gets exactly their share, rounded down.
                let exact = amount / 100 * u128::from(pcts[i]) + amount % 100 * u128::from(pcts[i]) / 100;
                assert_eq!(*part, exact, "{pcts:?} of {amount}, heir {i}");
            }
        }
    }
}

#[test]
fn an_heir_whose_share_rounds_to_nothing_is_left_out() {
    let mut l = setup(&me(), config(vec![heir("big.near", 99), heir("small.near", 1)]), 0).unwrap();
    l.start_claim(&acc("small.near"), s(YEAR)).unwrap();
    let plan = l.payout_plan(s(YEAR + MONTH), 50, &[(USDC.into(), 0)]).unwrap();
    assert_eq!(plan, vec![Payout { receiver_id: acc("big.near"), near: 50, tokens: vec![] }]);
}

#[test]
fn an_empty_estate_is_an_error_not_an_empty_plan() {
    let (l, now) = ready();
    assert!(l.payout_plan(now, 0, &[(USDC.into(), 0)]).unwrap_err().contains("nothing to pay out"));
}

#[test]
fn only_coins_the_owner_listed_can_be_paid_out() {
    let (l, now) = ready();
    let err = l.payout_plan(now, NEAR, &[("nep141:evil.near".into(), 1_000)]).unwrap_err();
    assert!(err.contains("isn't one of the coins"), "{err}");
    let err = l.payout_plan(now, NEAR, &[(USDC.into(), 10), (USDC.into(), 10)]).unwrap_err();
    assert!(err.contains("listed twice"), "a coin counted twice would pay out twice: {err}");
    let many: Vec<(String, u128)> = (0..33).map(|_| (USDC.to_string(), 1)).collect();
    assert!(l.payout_plan(now, NEAR, &many).unwrap_err().contains("at most 32"));
}

#[test]
fn the_payout_can_run_again_for_money_that_arrives_later() {
    let (l, now) = ready();
    assert_eq!(l.payout_plan(now, 2 * NEAR, &[]).unwrap().len(), 2);
    // Paying out doesn't change the state: a deposit after the first payout is split the same way.
    assert_eq!(l.payout_plan(now + s(86_400), 4 * NEAR, &[]).unwrap()[1].near, 2 * NEAR);
    assert_eq!(l.status(now + s(86_400)).stage, Stage::CanPayOut);
}

// ── Recovery (the 24 words) ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_waiting_claim_blocks_a_recovery_until_its_delay_ends() {
    let mut l = family();
    assert!(!l.blocks_recovery(s(YEAR)));
    l.start_claim(&acc("mia.near"), s(YEAR)).unwrap();
    assert!(l.blocks_recovery(s(YEAR)));
    assert!(l.blocks_recovery(s(YEAR + MONTH) - 1));
    assert!(!l.blocks_recovery(s(YEAR + MONTH)), "after the delay the owner can come back with their words; heirs can still cancel");
}

#[test]
fn heirs_can_cancel_a_recovery_only_once_the_owner_is_silent_for_the_whole_quiet_period() {
    // Audit F11: a living owner who lost their phone comes back with the words within the quiet period they chose.
    let l = family();
    assert!(!l.can_cancel_recovery(&acc("mia.near"), s(MONTH)), "30 days isn't enough any more");
    assert!(!l.can_cancel_recovery(&acc("mia.near"), s(YEAR) - 1));
    assert!(l.can_cancel_recovery(&acc("mia.near"), s(YEAR)));
    assert!(!l.can_cancel_recovery(&acc("thief.near"), s(10 * YEAR)), "never a stranger");
    assert!(!l.can_cancel_recovery(&me(), s(10 * YEAR)), "the owner cancels through their own phone, not as an heir");
}

#[test]
fn the_heirs_veto_waits_exactly_the_quiet_period() {
    let l = setup(&me(), LegacyConfig { quiet_seconds: U64(60), claim_delay_seconds: U64(60), ..config(vec![heir("mia.near", 100)]) }, 0).unwrap();
    assert!(!l.can_cancel_recovery(&acc("mia.near"), s(59)));
    assert!(l.can_cancel_recovery(&acc("mia.near"), s(60)));
}

#[test]
fn an_active_owner_keeps_the_heirs_out_of_recovery() {
    let mut l = family();
    l.on_owner_activity(s(MONTH - 1));
    assert!(!l.can_cancel_recovery(&acc("mia.near"), s(YEAR + 1)), "the quiet period counts again from the owner's last action");
    assert!(l.can_cancel_recovery(&acc("mia.near"), s(MONTH - 1 + YEAR)));
}

// ── Storage and views ────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn state_survives_borsh_and_json() {
    let (mut l, now) = ready();
    l.on_owner_activity(now);
    l.start_claim(&acc("leo.near"), now + s(YEAR)).unwrap();
    let bytes = borsh::to_vec(&l).unwrap();
    assert_eq!(borsh::from_slice::<LegacyState>(&bytes).unwrap(), l);
    let json = near_sdk::serde_json::to_string(&l.status(now + s(YEAR))).unwrap();
    assert!(json.contains(r#""stage":"ClaimWaiting""#), "{json}");
    assert!(json.contains(r#""quiet_seconds":"31536000""#), "times are strings in JSON: {json}");
    assert!(json.contains(r#""by":"Activity""#), "{json}");
}

#[test]
fn config_reads_from_the_setup_call_json() {
    let cfg: LegacyConfig = near_sdk::serde_json::from_str(r#"{"heirs":[{"account_id":"mia.near","share_pct":50},{"account_id":"leo.near","share_pct":50}],"quiet_seconds":"31536000","claim_delay_seconds":"2592000","tokens":["nep141:wrap.near"]}"#).unwrap();
    let l = setup(&me(), cfg, 0).unwrap();
    assert_eq!(l.heirs.len(), 2);
    assert_eq!(l.quiet_ns, U64(s(YEAR)));
}
