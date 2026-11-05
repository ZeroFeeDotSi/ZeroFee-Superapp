//! Every test assumes the agent is hijacked: a prompt injection controls everything its key sends. The limits must
//! hold anyway.
use super::*;

const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const DOLLAR: u128 = 1_000_000; // USDC has 6 decimals
const T0: u64 = 1_800_000_000 * SECOND; // a fixed start time (2027)

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn key(fill: u8) -> Vec<u8> {
    let mut k = vec![ML_DSA_65_TAG];
    k.extend(std::iter::repeat_n(fill, ML_DSA_65_PUBLIC_KEY_LEN));
    k
}
fn agent_key() -> Vec<u8> {
    key(0xA6)
}
fn device_key() -> Vec<u8> {
    key(0xD1)
}
fn usdc() -> Payout {
    Payout::Ledger { token_id: USDC.into() }
}

/// 300 USDC a day, 1,200 a month, 200 of it for converts; 20 NEAR a day, 60 a month; pays only landlord.near and
/// savings.near; ends in a year; at most 12 spends in 24 hours.
fn budget() -> Budget {
    Budget {
        coins: vec![
            CoinLimit { coin: USDC.into(), per_day: U128(300 * DOLLAR), per_month: U128(1_200 * DOLLAR), convert_per_day: U128(200 * DOLLAR) },
            CoinLimit { coin: "near".into(), per_day: U128(20 * NEAR), per_month: U128(60 * NEAR), convert_per_day: U128(0) },
        ],
        recipients: vec![acct("landlord.near"), acct("savings.near")],
        ends_at_ns: U64(T0 + 365 * DAY),
        max_spends_per_day: 12,
    }
}

fn rent() -> OrderPlan {
    OrderPlan { payout: usdc(), to: acct("landlord.near"), amount: U128(800 * DOLLAR), dates_ns: (1..=12).map(|m| U64(T0 + m * MONTH)).collect(), grace_seconds: U64(7 * 86_400) }
}

fn agent() -> Agent {
    Agent::new(&device_key(), agent_key(), budget(), vec![], T0, &me()).unwrap()
}

fn pay(a: &mut Agent, to: &str, amount: u128, now: u64) -> Result<Payment, Refusal> {
    a.pay(&agent_key(), usdc(), acct(to), amount, now, &me())
}

// ── The named attacks ──────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn pays_a_listed_recipient_within_budget() {
    let mut a = agent();
    let p = pay(&mut a, "landlord.near", 120 * DOLLAR, T0).unwrap();
    assert_eq!((p.to, p.amount, p.payout), (acct("landlord.near"), U128(120 * DOLLAR), usdc()));
}

#[test]
fn refuses_an_unlisted_recipient() {
    let mut a = agent();
    assert_eq!(pay(&mut a, "attacker.near", DOLLAR, T0), Err(Refusal::RecipientNotListed));
}

#[test]
fn refuses_a_coin_outside_the_budget() {
    let mut a = agent();
    let wbtc = Payout::Ledger { token_id: "nep141:wbtc.omft.near".into() };
    assert_eq!(a.pay(&agent_key(), wbtc, acct("landlord.near"), 1, T0, &me()), Err(Refusal::CoinNotInBudget));
    let other_ft = Payout::Ft { token: acct("fake-usdc.near") };
    assert_eq!(a.pay(&agent_key(), other_ft, acct("landlord.near"), 1, T0, &me()), Err(Refusal::CoinNotInBudget));
}

#[test]
fn only_the_agent_key_spends_the_budget() {
    let mut a = agent();
    assert_eq!(a.pay(&device_key(), usdc(), acct("landlord.near"), DOLLAR, T0, &me()), Err(Refusal::NotAgentKey));
    assert_eq!(a.pay(&key(0x01), usdc(), acct("landlord.near"), DOLLAR, T0, &me()), Err(Refusal::NotAgentKey));
    assert_eq!(a.pay(&[], usdc(), acct("landlord.near"), DOLLAR, T0, &me()), Err(Refusal::NotAgentKey));
}

#[test]
fn the_agent_key_cannot_loosen_its_own_rules() {
    let mut a = agent();
    let mut bigger = budget();
    bigger.coins[0].per_day = U128(1_000_000 * DOLLAR);
    bigger.coins[0].per_month = U128(1_000_000 * DOLLAR);
    bigger.recipients.push(acct("attacker.near"));
    assert_eq!(a.set_budget(&agent_key(), bigger, T0, &me()), Err(Refusal::AgentKeyCannotChangeRules));
    let mut theft = rent();
    theft.to = acct("attacker.near");
    assert_eq!(a.add_order(&agent_key(), theft, T0, &me()), Err(Refusal::AgentKeyCannotChangeRules));
    a.pause();
    assert_eq!(a.resume(&agent_key()), Err(Refusal::AgentKeyCannotChangeRules));
    assert!(a.paused());
    assert_eq!(Agent::new(&agent_key(), agent_key(), budget(), vec![], T0, &me()).err(), Some(Refusal::AgentKeyCannotChangeRules));
}

#[test]
fn renewing_the_key_changes_nothing_but_the_allowance() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    pay(&mut a, "landlord.near", 100 * DOLLAR, T0).unwrap();
    let before = a.view(T0);
    assert_eq!(a.renew_key(&agent_key()), Err(Refusal::AgentKeyCannotChangeRules));
    assert_eq!(a.renew_key(&device_key()).unwrap(), agent_key().as_slice());
    assert_eq!(a.view(T0), before);
}

#[test]
fn splitting_a_payment_cannot_dodge_the_day_limit() {
    let mut a = agent();
    for i in 0..3 {
        pay(&mut a, "landlord.near", 100 * DOLLAR, T0 + i * HOUR).unwrap();
    }
    assert_eq!(pay(&mut a, "landlord.near", 1, T0 + 3 * HOUR), Err(Refusal::OverDay));
    assert_eq!(pay(&mut a, "savings.near", 1, T0 + 3 * HOUR), Err(Refusal::OverDay));
}

#[test]
fn the_day_limit_rolls_and_does_not_reset_at_midnight() {
    let mut a = agent();
    let before_midnight = T0 + 23 * HOUR + 59 * 60 * SECOND;
    pay(&mut a, "landlord.near", 300 * DOLLAR, before_midnight).unwrap();
    assert_eq!(pay(&mut a, "landlord.near", 1, before_midnight + 2 * 60 * SECOND), Err(Refusal::OverDay));
    assert_eq!(pay(&mut a, "landlord.near", 1, before_midnight + DAY - 1), Err(Refusal::OverDay));
    pay(&mut a, "landlord.near", 300 * DOLLAR, before_midnight + DAY).unwrap();
}

#[test]
fn the_month_limit_holds_across_days() {
    let mut a = agent();
    for d in 0..4 {
        pay(&mut a, "landlord.near", 300 * DOLLAR, T0 + d * DAY).unwrap();
    }
    assert_eq!(pay(&mut a, "landlord.near", 1, T0 + 4 * DAY), Err(Refusal::OverMonth));
    assert_eq!(pay(&mut a, "landlord.near", 1, T0 + MONTH - 1), Err(Refusal::OverMonth));
    pay(&mut a, "landlord.near", 300 * DOLLAR, T0 + MONTH).unwrap();
}

#[test]
fn converts_go_anywhere_but_only_within_their_own_cap() {
    let mut a = agent();
    let deposit = acct(&"9e".repeat(32)); // a 1Click deposit address: an implicit account, 64 hex characters
    a.convert(&agent_key(), usdc(), deposit.clone(), 150 * DOLLAR, T0, &me()).unwrap();
    assert_eq!(a.convert(&agent_key(), usdc(), acct("attacker.near"), 51 * DOLLAR, T0, &me()), Err(Refusal::OverConvert));
    a.convert(&agent_key(), usdc(), acct("attacker.near"), 50 * DOLLAR, T0, &me()).unwrap();
    // NEAR has no convert allowance at all.
    assert_eq!(a.convert(&agent_key(), Payout::Near, deposit, 1, T0, &me()), Err(Refusal::OverConvert));
}

#[test]
fn converts_also_count_toward_the_day_limit() {
    let mut a = agent();
    a.convert(&agent_key(), usdc(), acct("deposit.near"), 200 * DOLLAR, T0, &me()).unwrap();
    pay(&mut a, "landlord.near", 100 * DOLLAR, T0).unwrap();
    assert_eq!(pay(&mut a, "landlord.near", 1, T0), Err(Refusal::OverDay));
}

#[test]
fn huge_amounts_cannot_overflow_the_totals() {
    let mut a = agent();
    pay(&mut a, "landlord.near", 300 * DOLLAR, T0).unwrap();
    assert_eq!(pay(&mut a, "landlord.near", u128::MAX, T0), Err(Refusal::OverDay));
    assert_eq!(pay(&mut a, "landlord.near", u128::MAX - 300 * DOLLAR + 1, T0), Err(Refusal::OverDay));
    let mut b = agent();
    assert_eq!(pay(&mut b, "landlord.near", u128::MAX, T0), Err(Refusal::OverDay));
}

#[test]
fn zero_amount_spends_are_refused() {
    let mut a = agent();
    assert_eq!(pay(&mut a, "landlord.near", 0, T0), Err(Refusal::ZeroAmount));
}

#[test]
fn too_many_small_spends_are_refused() {
    let mut a = agent();
    for i in 0..12 {
        pay(&mut a, "landlord.near", 1, T0 + i).unwrap();
    }
    assert_eq!(pay(&mut a, "landlord.near", 1, T0 + 12), Err(Refusal::TooManyToday));
    pay(&mut a, "landlord.near", 1, T0 + DAY).unwrap();
}

#[test]
fn nothing_runs_while_paused() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    a.pause();
    assert_eq!(pay(&mut a, "landlord.near", DOLLAR, T0), Err(Refusal::Paused));
    assert_eq!(a.convert(&agent_key(), usdc(), acct("deposit.near"), DOLLAR, T0, &me()), Err(Refusal::Paused));
    assert_eq!(a.run_order(1, T0 + MONTH), Err(Refusal::Paused));
    a.resume(&device_key()).unwrap();
    pay(&mut a, "landlord.near", DOLLAR, T0).unwrap();
}

#[test]
fn nothing_runs_after_the_end_date() {
    let mut a = agent();
    assert_eq!(pay(&mut a, "landlord.near", DOLLAR, T0 + 365 * DAY), Err(Refusal::Ended));
}

#[test]
fn never_pays_the_account_itself_or_the_intents_contract() {
    let mut a = agent();
    assert_eq!(a.convert(&agent_key(), usdc(), me(), DOLLAR, T0, &me()), Err(Refusal::RecipientNeverAllowed));
    assert_eq!(a.convert(&agent_key(), usdc(), acct(INTENTS), DOLLAR, T0, &me()), Err(Refusal::RecipientNeverAllowed));
    let mut b = budget();
    b.recipients.push(me());
    assert_eq!(a.set_budget(&device_key(), b, T0, &me()), Err(Refusal::RecipientNeverAllowed));
}

#[test]
fn a_failed_payment_gives_its_budget_back() {
    let mut a = agent();
    let p = pay(&mut a, "landlord.near", 300 * DOLLAR, T0).unwrap();
    assert_eq!(pay(&mut a, "landlord.near", 1, T0), Err(Refusal::OverDay));
    assert_eq!(a.settle(p.id.0, false), Settled::BudgetSpend { ok: false });
    pay(&mut a, "landlord.near", 300 * DOLLAR, T0).unwrap();
}

#[test]
fn a_failed_spend_still_counts_toward_the_days_number_of_spends() {
    // Audit F8: a failed spend gives its money back to the budget but stays one of the day's spends, so failing spends
    // can't be repeated without limit.
    let mut a = agent();
    for _ in 0..12 {
        let p = pay(&mut a, "landlord.near", 1, T0).unwrap();
        a.settle(p.id.0, false);
    }
    assert_eq!(pay(&mut a, "landlord.near", 1, T0), Err(Refusal::TooManyToday));
}

#[test]
fn a_new_budget_cannot_reset_what_was_already_spent() {
    let mut a = agent();
    pay(&mut a, "landlord.near", 300 * DOLLAR, T0).unwrap();
    a.set_budget(&device_key(), budget(), T0, &me()).unwrap();
    assert_eq!(pay(&mut a, "landlord.near", 1, T0), Err(Refusal::OverDay));
}

// ── Standing orders ────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn a_standing_order_pays_exactly_once_per_date_and_never_early() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    let id = a.view(T0).orders[0].id.0;
    assert_eq!(a.run_order(id, T0 + MONTH - 1), Err(Refusal::NothingDue));
    let p = a.run_order(id, T0 + MONTH).unwrap();
    assert_eq!((p.to, p.amount, p.payout.clone()), (acct("landlord.near"), U128(800 * DOLLAR), usdc()));
    assert_eq!(a.run_order(id, T0 + MONTH + HOUR), Err(Refusal::NothingDue)); // already sent
    a.settle(p.id.0, true);
    assert_eq!(a.run_order(id, T0 + MONTH + 2 * HOUR), Err(Refusal::NothingDue)); // already paid
    a.run_order(id, T0 + 2 * MONTH).unwrap();
}

#[test]
fn standing_orders_do_not_draw_on_the_budget() {
    // Rent is 800 USDC; the budget allows 300 a day. The order is its own exact limit.
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    a.run_order(1, T0 + MONTH).unwrap();
    pay(&mut a, "landlord.near", 300 * DOLLAR, T0 + MONTH).unwrap();
}

#[test]
fn a_missed_date_expires_after_its_grace() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    assert_eq!(a.run_order(1, T0 + MONTH + 7 * DAY + 1), Err(Refusal::NothingDue));
    // Paused for three months, then resumed: only the date still inside its grace can pay, once.
    a.pause();
    a.resume(&device_key()).unwrap();
    a.run_order(1, T0 + 4 * MONTH + DAY).unwrap();
    assert_eq!(a.run_order(1, T0 + 4 * MONTH + DAY), Err(Refusal::NothingDue));
}

#[test]
fn a_failed_order_payment_can_run_again_within_its_grace() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    let p = a.run_order(1, T0 + MONTH).unwrap();
    assert_eq!(a.settle(p.id.0, false), Settled::OrderPayment { order: 1, due_ns: T0 + MONTH, ok: false });
    a.run_order(1, T0 + MONTH + DAY).unwrap();
}

#[test]
fn removing_an_order_stops_it() {
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    a.remove_order(1).unwrap();
    assert_eq!(a.run_order(1, T0 + MONTH), Err(Refusal::NoSuchOrder));
}

// ── Setup checks ───────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn bad_rules_are_refused_at_setup() {
    let bad = |f: &dyn Fn(&mut Budget)| {
        let mut b = budget();
        f(&mut b);
        Agent::new(&device_key(), agent_key(), b, vec![], T0, &me()).err()
    };
    assert!(bad(&|b| b.coins[0].per_month = U128(1)).is_some());
    assert!(bad(&|b| b.coins[0].per_day = U128(0)).is_some());
    assert!(bad(&|b| b.coins[0].convert_per_day = U128(301 * DOLLAR)).is_some());
    assert!(bad(&|b| b.coins.push(b.coins[0].clone())).is_some());
    assert!(bad(&|b| b.coins[0].coin = "usdc".into()).is_some());
    assert!(bad(&|b| b.ends_at_ns = U64(T0)).is_some());
    assert!(bad(&|b| b.ends_at_ns = U64(T0 + MAX_TERM + 1)).is_some());
    assert!(bad(&|b| b.max_spends_per_day = 0).is_some());
    assert!(bad(&|b| b.max_spends_per_day = 13).is_some());
    assert!(bad(&|b| b.recipients.push(acct("landlord.near"))).is_some());
    assert!(bad(&|b| b.recipients.push(acct(INTENTS))).is_some());
    assert!(Agent::new(&device_key(), vec![0; 33], budget(), vec![], T0, &me()).is_err()); // a classical key
    let bad_order = |f: &dyn Fn(&mut OrderPlan)| {
        let mut p = rent();
        f(&mut p);
        Agent::new(&device_key(), agent_key(), budget(), vec![p], T0, &me()).err()
    };
    assert!(bad_order(&|p| p.amount = U128(0)).is_some());
    assert!(bad_order(&|p| p.dates_ns.reverse()).is_some());
    assert!(bad_order(&|p| p.dates_ns[0] = U64(T0 - 1)).is_some());
    assert!(bad_order(&|p| p.dates_ns = vec![]).is_some());
    assert!(bad_order(&|p| p.dates_ns = (1..=25).map(|d| U64(T0 + d * DAY)).collect()).is_some());
    assert!(bad_order(&|p| p.grace_seconds = U64(60)).is_some());
    assert!(bad_order(&|p| p.to = me()).is_some());
}

#[test]
fn payment_plans_move_exactly_the_payment() {
    let pay = |payout: Payout| payment_plan(&Payment { id: U64(1), payout, to: acct("landlord.near"), amount: U128(800 * DOLLAR) });
    let args = |plan: &PaymentPlan| match &plan.steps[..] {
        [Step::FunctionCall { method_name, args, deposit, gas }] => {
            assert_eq!((deposit.0, gas.0 <= 100_000_000_000_000), (1, true));
            (method_name.clone(), near_sdk::serde_json::from_slice::<near_sdk::serde_json::Value>(&args.0).unwrap())
        }
        other => panic!("expected one call, got {other:?}"),
    };
    let near = pay(Payout::Near);
    assert_eq!((near.receiver_id.as_str(), near.steps.clone(), near.moves.clone()), ("landlord.near", vec![Step::Transfer { deposit: U128(800 * DOLLAR) }], vec![("near".into(), U128(800 * DOLLAR))]));
    let ledger = pay(usdc());
    let (method, v) = args(&ledger);
    assert_eq!((ledger.receiver_id.as_str(), method.as_str()), (INTENTS, "mt_transfer"));
    assert_eq!((v["receiver_id"].as_str(), v["token_id"].as_str(), v["amount"].as_str()), (Some("landlord.near"), Some(USDC), Some("800000000")));
    assert_eq!(ledger.moves, vec![("near".into(), U128(1)), (USDC.into(), U128(800 * DOLLAR))]);
    let ft = pay(Payout::Ft { token: acct("usdc.fakes.testnet") });
    let (method, v) = args(&ft);
    assert_eq!((ft.receiver_id.as_str(), method.as_str(), v["receiver_id"].as_str(), v["amount"].as_str()), ("usdc.fakes.testnet", "ft_transfer", Some("landlord.near"), Some("800000000")));
    assert_eq!(ft.moves[1], ("nep141:usdc.fakes.testnet".into(), U128(800 * DOLLAR)));
}

#[test]
fn refusals_carry_a_stable_code() {
    assert_eq!(Refusal::OverDay.message(), "agent.limit.day: this is over Agent's limit for this coin in 24 hours");
    assert!(Refusal::Invalid("x").message().starts_with("agent.rules.invalid: "));
}

// ── The random attack ──────────────────────────────────────────────────────────────────────────────────────────

/// xorshift64*: deterministic, so a failure always reproduces.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<T: Clone>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len() as u64) as usize].clone()
    }
}

/// What actually left the account, recorded by the test itself (not read back from the contract).
struct Sent {
    id: u64,
    at: u64,
    coin: String,
    amount: u128,
    convert: bool,
    to: AccountId,
    order: bool,
    /// Whether Agent was paused when this was accepted.
    paused: bool,
}

/// A hijacked agent key, a stranger triggering orders, and the owner pausing and resuming, all at random for 150
/// simulated days. Then an independent checker confirms every limit held over everything that was paid.
#[test]
fn a_hijacked_agent_cannot_exceed_its_limits_under_random_attack() {
    for seed in 1..=40u64 {
        run_attack(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    }
}

fn run_attack(seed: u64) {
    let mut rng = Rng(seed | 1);
    let mut a = Agent::new(&device_key(), agent_key(), budget(), vec![rent()], T0, &me()).unwrap();
    let b = budget();
    let plan = rent();
    let recipients = ["landlord.near", "savings.near", "attacker.near", "me.near", INTENTS, "x.near"];
    let payouts = [usdc(), Payout::Near, Payout::Ft { token: acct("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1") }, Payout::Ledger { token_id: "nep141:wbtc.omft.near".into() }, Payout::Ft { token: acct("evil.near") }];
    let signers = [agent_key(), agent_key(), agent_key(), agent_key(), device_key(), key(7)];
    let amounts = |rng: &mut Rng| -> u128 {
        match rng.below(8) {
            0 => 0,
            1 => u128::MAX,
            2 => u128::MAX - rng.below(1_000) as u128,
            3 => (rng.below(400) as u128) * DOLLAR,
            4 => (rng.below(30) as u128) * NEAR,
            5 => 1 + rng.below(1_000) as u128,
            6 => 300 * DOLLAR,
            _ => (rng.below(1 << 40) as u128) << rng.below(80),
        }
    };

    let mut now = T0;
    let mut sent: Vec<Sent> = vec![];
    let mut in_flight: Vec<u64> = vec![];
    for _ in 0..6_000 {
        now += match rng.below(20) {
            0 => rng.below(2) * DAY,
            1..=3 => rng.below(3 * HOUR),
            _ => rng.below(20 * 60 * SECOND),
        };
        if now > T0 + 150 * DAY {
            break;
        }
        let paused = a.paused();
        match rng.below(60) {
            0..=24 => {
                let (payout, to, amount, signer): (Payout, &str, u128, Vec<u8>) = (rng.pick(&payouts), rng.pick(&recipients), amounts(&mut rng), rng.pick(&signers));
                let to = acct(to);
                if let Ok(p) = a.pay(&signer, payout.clone(), to.clone(), amount, now, &me()) {
                    sent.push(Sent { id: p.id.0, at: now, coin: payout.coin(), amount, convert: false, to, order: false, paused });
                    in_flight.push(p.id.0);
                }
            }
            25..=39 => {
                let (payout, to, amount, signer): (Payout, &str, u128, Vec<u8>) = (rng.pick(&payouts), rng.pick(&recipients), amounts(&mut rng), rng.pick(&signers));
                let to = acct(to);
                if let Ok(p) = a.convert(&signer, payout.clone(), to.clone(), amount, now, &me()) {
                    sent.push(Sent { id: p.id.0, at: now, coin: payout.coin(), amount, convert: true, to, order: false, paused });
                    in_flight.push(p.id.0);
                }
            }
            40..=45 => {
                if let Ok(p) = a.run_order(rng.below(3), now) {
                    sent.push(Sent { id: p.id.0, at: now, coin: p.payout.coin(), amount: p.amount.0, convert: false, to: p.to, order: true, paused });
                    in_flight.push(p.id.0);
                }
            }
            46..=53 => {
                if !in_flight.is_empty() {
                    let i = rng.below(in_flight.len() as u64) as usize;
                    let id = in_flight.swap_remove(i);
                    if rng.below(4) == 0 {
                        a.settle(id, false);
                        sent.retain(|s| s.id != id); // a failed payment moved nothing
                    } else {
                        a.settle(id, true);
                    }
                }
            }
            54 => a.pause(),
            55..=57 => {
                // The owner resumes, or the hijacked key tries to.
                let signer = if rng.below(2) == 0 { device_key() } else { rng.pick(&signers) };
                let _ = a.resume(&signer);
            }
            _ => {
                // The hijacked key also tries to loosen the rules; it must never manage to.
                let mut loose = budget();
                loose.coins[0].per_day = U128(u128::MAX);
                loose.coins[0].per_month = U128(u128::MAX);
                assert_eq!(a.set_budget(&agent_key(), loose, now, &me()), Err(Refusal::AgentKeyCannotChangeRules));
            }
        }
    }

    // The attack must have got real payments through, or the check below would prove nothing.
    let spends = sent.iter().filter(|s| !s.order).count();
    let converts = sent.iter().filter(|s| s.convert).count();
    let orders = sent.iter().filter(|s| s.order).count();
    assert!(spends >= 30 && converts >= 5 && orders >= 1, "seed {seed}: too few payments got through ({spends} spends, {converts} converts, {orders} orders)");
    check_limits(&sent, &b, &plan, seed);
}

/// The checker: written separately from the contract, as plainly as possible.
fn check_limits(sent: &[Sent], b: &Budget, plan: &OrderPlan, seed: u64) {
    for s in sent {
        assert!(!s.paused, "seed {seed}: something was paid while paused");
        assert!(s.to != me() && s.to.as_str() != INTENTS, "seed {seed}: paid a forbidden account");
        if s.order {
            assert_eq!((s.to.clone(), s.amount, s.coin.clone()), (plan.to.clone(), plan.amount.0, plan.payout.coin()), "seed {seed}: an order paid something else");
            assert!(plan.dates_ns.iter().any(|d| d.0 <= s.at && s.at <= d.0 + plan.grace_seconds.0 * SECOND), "seed {seed}: an order paid outside its dates");
            continue;
        }
        assert!(s.at < b.ends_at_ns.0, "seed {seed}: paid after the end date");
        let limit = b.coins.iter().find(|c| c.coin == s.coin).unwrap_or_else(|| panic!("seed {seed}: paid a coin outside the budget"));
        assert!(s.convert || b.recipients.contains(&s.to), "seed {seed}: paid an unlisted recipient");
        // Every window ending at a payment: the busiest window always ends at one.
        let window = |len: u64, f: &dyn Fn(&Sent) -> bool| -> u128 { sent.iter().filter(|x| !x.order && x.at <= s.at && s.at - x.at < len && f(x)).map(|x| x.amount).sum() };
        assert!(window(DAY, &|x| x.coin == s.coin) <= limit.per_day.0, "seed {seed}: over the day limit");
        assert!(window(MONTH, &|x| x.coin == s.coin) <= limit.per_month.0, "seed {seed}: over the month limit");
        assert!(window(DAY, &|x| x.coin == s.coin && x.convert) <= limit.convert_per_day.0, "seed {seed}: over the convert limit");
        let count = sent.iter().filter(|x| !x.order && x.at <= s.at && s.at - x.at < DAY).count() as u32;
        assert!(count <= b.max_spends_per_day, "seed {seed}: too many spends in a day");
    }
    let orders_paid = sent.iter().filter(|s| s.order).count();
    assert!(orders_paid <= plan.dates_ns.len(), "seed {seed}: an order paid more than its dates");
    let mut slots: Vec<u64> = sent.iter().filter(|s| s.order).map(|s| plan.dates_ns.iter().rev().find(|d| d.0 <= s.at).unwrap().0).collect();
    slots.sort();
    slots.dedup();
    assert_eq!(slots.len(), orders_paid, "seed {seed}: one order date paid twice");
}
