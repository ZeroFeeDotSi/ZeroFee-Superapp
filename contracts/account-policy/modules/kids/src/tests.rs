use super::*;
use near_sdk::borsh;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_CONTRACT: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DOLLAR: u128 = 1_000_000;
const HOUR: u64 = 3_600 * SECOND;

fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn near(n: u128) -> (String, u128) {
    ("near".into(), n * NEAR)
}

fn usdc(n: u128) -> (String, u128) {
    (USDC.into(), n * DOLLAR)
}

/// Ava may pay Mum, Dad and the school, up to 50 USDC and 2 NEAR a week.
fn ava() -> KidsState {
    KidsState::new(
        setup(KidsRules {
            allowed: vec![acc("mum.near"), acc("dad.near"), acc("school.near")],
            week: vec![(USDC.into(), U128(50 * DOLLAR)), ("near".into(), U128(2 * NEAR))],
        })
        .unwrap(),
    )
}

/// A request placed now that runs at once (the bands didn't hold it): record, then ran.
fn spend(k: &mut KidsState, id: u64, moves: &[(String, u128)], now: u64) {
    k.record(id, moves, now);
    k.ran(id, now);
}

fn to(names: &[&str]) -> Vec<AccountId> {
    names.iter().map(|n| acc(n)).collect()
}

// ── The rules ──────────────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_allowed_payee_within_the_week_needs_no_parent() {
    let k = ava();
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(20)]), 0));
    assert!(!k.bump(Some(&to(&["school.near"])), Some(&[usdc(50)]), 0), "exactly the limit fits");
}

#[test]
fn an_unlisted_payee_needs_the_parent_even_for_a_cent() {
    let k = ava();
    assert!(k.bump(Some(&to(&["stranger.near"])), Some(&[usdc(0)]), 0));
    assert!(k.bump(Some(&to(&["mum.near", "stranger.near"])), Some(&[usdc(1)]), 0), "one unlisted party is enough");
}

#[test]
fn allowing_a_token_contract_never_allows_paying_anyone_in_that_token() {
    // The parent allows the USDC contract (say, for an app). A USDC transfer is called on that contract but pays a
    // stranger: the contract passes both parties, and the stranger isn't allowed.
    let mut rules = ava().rules;
    rules.allowed.push(acc(USDC_CONTRACT));
    let k = KidsState::new(setup(rules).unwrap());
    assert!(k.bump(Some(&to(&[USDC_CONTRACT, "stranger.near"])), Some(&[usdc(1)]), 0));
    assert!(!k.bump(Some(&to(&[USDC_CONTRACT, "mum.near"])), Some(&[usdc(1)]), 0));
}

#[test]
fn an_empty_list_means_anyone_but_the_week_still_holds() {
    let mut k = KidsState::new(setup(KidsRules { allowed: vec![], week: vec![(USDC.into(), U128(50 * DOLLAR))] }).unwrap());
    assert!(!k.bump(Some(&to(&["anyone.near"])), Some(&[usdc(30)]), 0));
    spend(&mut k, 1, &[usdc(30)], 0);
    assert!(k.bump(Some(&to(&["anyone.near"])), Some(&[usdc(21)]), HOUR));
}

#[test]
fn the_week_is_exceeded_across_several_requests() {
    let mut k = ava();
    spend(&mut k, 1, &[usdc(20)], 0);
    spend(&mut k, 2, &[usdc(20)], DAY_NS);
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(10)]), 2 * DAY_NS), "40 + 10 = 50 fits");
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[usdc(11)]), 2 * DAY_NS), "40 + 11 doesn't");
    assert_eq!(k.used(USDC, 2 * DAY_NS), 40 * DOLLAR);
}

#[test]
fn any_coin_over_its_limit_is_enough() {
    let mut k = ava();
    spend(&mut k, 1, &[near(2)], 0);
    assert!(k.bump(Some(&to(&["dad.near"])), Some(&[usdc(1), near(1)]), HOUR), "USDC fits but NEAR doesn't");
}

#[test]
fn a_coin_with_no_weekly_limit_isnt_capped_here() {
    let k = ava();
    let wnear = ("nep141:wrap.near".to_string(), 1_000 * NEAR);
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[wnear]), 0));
}

#[test]
fn a_zero_limit_means_the_parent_says_yes_to_every_move_of_that_coin() {
    let k = KidsState::new(setup(KidsRules { allowed: vec![], week: vec![("near".into(), U128(0))] }).unwrap());
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[("near".into(), 1)]), 0));
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(5)]), 0), "a call that moves no NEAR is fine");
}

#[test]
fn what_the_contract_cant_measure_needs_the_parent() {
    let k = ava();
    assert!(k.bump(None, Some(&[usdc(1)]), 0), "parties unknown");
    assert!(k.bump(Some(&to(&["mum.near"])), None, 0), "coins unknown");
}

#[test]
fn amounts_that_would_overflow_need_the_parent() {
    let mut k = KidsState::new(setup(KidsRules { allowed: vec![], week: vec![("near".into(), U128(u128::MAX))] }).unwrap());
    spend(&mut k, 1, &[("near".into(), u128::MAX - 1)], 0);
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[("near".into(), 2)]), HOUR));
}

// ── Counting, like the 24-hour window ──────────────────────────────────────────────────────────────────────────────

#[test]
fn cancel_or_decline_gives_the_room_back() {
    let mut k = ava();
    k.record(7, &[usdc(45)], 0); // held for the parent
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[usdc(10)]), HOUR), "a waiting request counts");
    k.forget(7); // the parent declined (or the child cancelled)
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(10)]), HOUR));
    assert_eq!(k.used(USDC, HOUR), 0);
}

#[test]
fn day_8_forgets_day_1() {
    let mut k = ava();
    spend(&mut k, 1, &[usdc(50)], 0);
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[usdc(1)]), 6 * DAY_NS + 23 * HOUR));
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(50)]), WEEK_NS), "exactly 7 days later it's gone");
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(50)]), 8 * DAY_NS));
}

#[test]
fn a_waiting_request_counts_until_it_ends_however_long_and_then_7_days_from_when_it_ran() {
    let mut k = ava();
    k.record(3, &[usdc(30)], 0);
    assert_eq!(k.used(USDC, 20 * DAY_NS), 30 * DOLLAR, "still waiting after 20 days: still counts");
    k.ran(3, 20 * DAY_NS); // the parent said yes on day 20
    assert_eq!(k.used(USDC, 26 * DAY_NS), 30 * DOLLAR);
    assert_eq!(k.used(USDC, 27 * DAY_NS), 0);
}

#[test]
fn old_moves_are_pruned_when_a_new_one_is_recorded() {
    let mut k = ava();
    spend(&mut k, 1, &[usdc(5)], 0);
    k.record(2, &[usdc(5)], 0); // waiting: kept however old
    spend(&mut k, 3, &[usdc(5)], 10 * DAY_NS);
    let ids: Vec<u64> = k.log.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![2, 3]);
}

#[test]
fn a_full_log_asks_the_parent_until_old_moves_age_out() {
    let mut k = KidsState::new(setup(KidsRules { allowed: vec![], week: vec![] }).unwrap());
    for id in 0..MAX_LOG as u64 {
        spend(&mut k, id, &[near(0), ("near".into(), 1)], 0);
    }
    assert!(k.bump(Some(&to(&["mum.near"])), Some(&[usdc(1)]), HOUR));
    k.record(9_999, &[], WEEK_NS); // anything recorded prunes
    assert!(!k.bump(Some(&to(&["mum.near"])), Some(&[usdc(1)]), WEEK_NS));
}

#[test]
fn the_view_shows_each_limit_and_what_the_week_used() {
    let mut k = ava();
    spend(&mut k, 1, &[usdc(12)], 0);
    let s = k.status(HOUR);
    assert_eq!(s.allowed, to(&["mum.near", "dad.near", "school.near"]));
    assert_eq!(s.week[0], WeekLine { coin: USDC.into(), limit: U128(50 * DOLLAR), used: U128(12 * DOLLAR) });
    assert_eq!(s.week[1].used, U128(0));
}

#[test]
fn state_round_trips_through_borsh() {
    let mut k = ava();
    k.record(1, &[usdc(3)], 5);
    let bytes = borsh::to_vec(&k).unwrap();
    assert_eq!(borsh::from_slice::<KidsState>(&bytes).unwrap(), k);
}

// ── Setting the rules ──────────────────────────────────────────────────────────────────────────────────────────────

#[test]
fn setup_refuses_rules_it_cant_hold() {
    let many: Vec<AccountId> = (0..=MAX_ALLOWED).map(|i| acc(&format!("p{i}.near"))).collect();
    assert_eq!(setup(KidsRules { allowed: many, week: vec![] }).unwrap_err(), "at most 32 allowed people");
    assert_eq!(setup(KidsRules { allowed: to(&["mum.near", "mum.near"]), week: vec![] }).unwrap_err(), "mum.near is listed twice");
    let coins: Vec<(String, U128)> = (0..=MAX_COINS).map(|i| (format!("nep141:t{i}.near"), U128(1))).collect();
    assert_eq!(setup(KidsRules { allowed: vec![], week: coins }).unwrap_err(), "at most 32 coins");
    for bad in ["NEAR", "usdc", "nep171:nft.near", "nep245:multi.near", "nep141:Not An Account", ""] {
        assert!(setup(KidsRules { allowed: vec![], week: vec![(bad.into(), U128(1))] }).is_err(), "{bad} accepted");
    }
    assert_eq!(setup(KidsRules { allowed: vec![], week: vec![(USDC.into(), U128(1)), (USDC.into(), U128(2))] }).unwrap_err(), format!("{USDC} is listed twice"));
    for good in ["near", USDC, "nep245:intents.near:nep141:wrap.near"] {
        assert!(setup(KidsRules { allowed: vec![], week: vec![(good.into(), U128(1))] }).is_ok(), "{good} refused");
    }
}

// ── The random sequence ────────────────────────────────────────────────────────────────────────────────────────────

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
}

/// A child sending at random for 60 days, to friends and strangers, in USDC, NEAR and an unlimited coin; the parent
/// says yes or no to what's held, at random and late; the child cancels some held ones. Whatever the order, what the
/// child sent alone (never asking the parent) never paid an unlisted account, and never exceeded a weekly limit in any
/// 7 days.
#[test]
fn a_child_alone_never_pays_a_stranger_or_passes_a_weekly_limit_under_random_sequences() {
    for seed in 1..=60u64 {
        run_sequence(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15));
    }
}

fn run_sequence(seed: u64) {
    let mut rng = Rng(seed | 1);
    let mut k = ava();
    let people = ["mum.near", "dad.near", "school.near", "friend.near", "stranger.near"];
    let coins = [USDC, "near", "nep141:wrap.near"];
    let mut held: Vec<u64> = vec![];
    // (ran at, coin, amount) of everything the child sent without the parent.
    let mut alone: Vec<(u64, String, u128)> = vec![];
    let (mut asked, mut sent) = (0, 0);
    let mut now = 0u64;
    for id in 1..=900u64 {
        now += rng.below(4 * HOUR) + 1;
        match rng.below(10) {
            0..=6 => {
                let party = acc(people[rng.below(people.len() as u64) as usize]);
                let coin = coins[rng.below(3) as usize];
                let amount = match coin {
                    "near" => (rng.below(80) as u128 + 1) * NEAR / 100,
                    _ => (rng.below(25) as u128 + 1) * DOLLAR,
                };
                let moves = vec![(coin.to_string(), amount)];
                if k.bump(Some(std::slice::from_ref(&party)), Some(&moves), now) {
                    k.record(id, &moves, now); // held for the parent
                    held.push(id);
                    asked += 1;
                } else {
                    assert!(k.rules.allowed.contains(&party), "seed {seed}: paid {party} without the parent");
                    spend(&mut k, id, &moves, now);
                    alone.push((now, coin.to_string(), amount));
                    sent += 1;
                }
            }
            7 | 8 if !held.is_empty() => {
                // The parent answers one held request, maybe days later: yes runs it now, no forgets it.
                let h = held.remove(rng.below(held.len() as u64) as usize);
                if rng.below(2) == 0 { k.ran(h, now) } else { k.forget(h) }
            }
            _ if !held.is_empty() => {
                let h = held.remove(rng.below(held.len() as u64) as usize);
                k.forget(h); // the child cancels it
            }
            _ => {}
        }
    }
    assert!(sent >= 100 && asked >= 100, "seed {seed}: too one-sided ({sent} sent alone, {asked} asked)");
    // Every 7-day window that starts at a send: the child's own sends in it stay within each limit.
    for (start, _, _) in &alone {
        for (coin, limit) in &k.rules.week {
            let total: u128 = alone.iter().filter(|(at, c, _)| c == coin && *at >= *start && *at < start + WEEK_NS).map(|(_, _, a)| a).sum();
            assert!(total <= limit.0, "seed {seed}: {total} of {coin} alone in 7 days, limit {}", limit.0);
        }
    }
}
