//! Kids: a child's own account, with the parent saying yes to anything outside its rules.
//!
//! A module of the account contract (contracts/account-policy). It is **pure**: no promises, no `env`, no access
//! checks, and it never spends. The account contract stores `KidsState` under its own storage key (`b"kids"`), passes
//! in the block time, and asks one question before it places a request: does this request need the parent?
//!
//! Most of a child's account is the account contract as it is:
//! - The parent's phone holds the child's account's second-device key, and a protection band at level Device means
//!   "above this, the parent says yes" (approve / decline, as the laptop does today).
//! - The 24-hour totals already exist, and any change to the rules takes the strictest level: the parent.
//!
//! This module adds the two rules the bands don't have, and only ever makes a request **stricter**:
//! - **Allowed people:** when the list isn't empty, every account a request calls or pays must be on it. A token
//!   transfer is called on the token's contract but pays someone else, so the contract passes both (`parties`), and
//!   allowing a token contract never allows paying anyone in that token.
//! - **A weekly limit per coin:** this request plus everything in the last 7 days, rolling, so nothing resets at
//!   midnight on Sunday. A coin with no weekly limit isn't capped here (the bands still are).
//!
//! Anything the contract can't measure (its parties or its coins) needs the parent, the same rule as the bands'
//! "can't measure → strictest". So does a request when the week's log is full.
//!
//! Counting follows the 24-hour window exactly: a request counts from when it's placed, a waiting one counts until it
//! runs or ends, one that runs counts for 7 days from when it ran, and a cancelled or declined one stops counting.
use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

pub const SECOND: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * SECOND;
pub const WEEK_NS: u64 = 7 * DAY_NS;
pub const MAX_ALLOWED: usize = 32;
pub const MAX_COINS: usize = 32;
/// Moves kept for the weekly totals. Past this, every request needs the parent until older ones age out.
pub const MAX_LOG: usize = 512;

/// What the parent chooses (the arguments of `kids_set`). Coins are named as in the account contract's rules:
/// "near", or a NEAR Intents token id ("nep141:<contract>", "nep245:<contract>:<id>").
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct KidsRules {
    /// The only accounts the child may call or pay alone. Empty: anyone (the weekly limits still hold).
    pub allowed: Vec<AccountId>,
    /// At most this much of a coin in any 7 days, in its smallest units. Zero: the parent says yes to every move of it.
    pub week: Vec<(String, U128)>,
}

/// One coin of one request, for the weekly totals.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Move {
    /// The account contract's request id.
    pub id: u64,
    pub at_ns: u64,
    pub coin: String,
    pub amount: u128,
    /// Waiting for its wait or the parent's yes: it counts until it runs or ends, however long that takes.
    pub waiting: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct KidsState {
    pub rules: KidsRules,
    pub log: Vec<Move>,
}

/// One coin's weekly limit and what the last 7 days used (the contract's `kids` view).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct WeekLine {
    pub coin: String,
    pub limit: U128,
    pub used: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct KidsStatus {
    pub allowed: Vec<AccountId>,
    pub week: Vec<WeekLine>,
}

/// Checks the parent's rules. The contract applies them at the strictest level (the parent).
pub fn setup(rules: KidsRules) -> Result<KidsRules, String> {
    if rules.allowed.len() > MAX_ALLOWED {
        return Err(format!("at most {MAX_ALLOWED} allowed people"));
    }
    for (i, a) in rules.allowed.iter().enumerate() {
        if rules.allowed[..i].contains(a) {
            return Err(format!("{a} is listed twice"));
        }
    }
    if rules.week.len() > MAX_COINS {
        return Err(format!("at most {MAX_COINS} coins"));
    }
    for (i, (coin, _)) in rules.week.iter().enumerate() {
        if !is_coin(coin) {
            return Err(format!("{coin} isn't a coin the rules can count"));
        }
        if rules.week[..i].iter().any(|(c, _)| c == coin) {
            return Err(format!("{coin} is listed twice"));
        }
    }
    Ok(rules)
}

impl KidsState {
    pub fn new(rules: KidsRules) -> Self {
        Self { rules, log: vec![] }
    }

    /// Does this request need the parent? `parties`: every account it calls or pays; `moves`: what it moves out, per
    /// coin. None for either means the contract couldn't tell, and then the parent is asked.
    pub fn bump(&self, parties: Option<&[AccountId]>, moves: Option<&[(String, u128)]>, now_ns: u64) -> bool {
        let (Some(parties), Some(moves)) = (parties, moves) else {
            return true;
        };
        if !self.rules.allowed.is_empty() && parties.iter().any(|p| !self.rules.allowed.contains(p)) {
            return true;
        }
        if self.log.len() >= MAX_LOG {
            return true;
        }
        moves.iter().filter(|(_, amount)| *amount > 0).any(|(coin, amount)| match self.limit(coin) {
            None => false,
            Some(limit) => self.used(coin, now_ns).checked_add(*amount).is_none_or(|total| total > limit),
        })
    }

    /// The contract placed a request (at once or waiting): its coins start counting now.
    pub fn record(&mut self, id: u64, moves: &[(String, u128)], now_ns: u64) {
        self.prune(now_ns);
        for (coin, amount) in moves.iter().filter(|(_, a)| *a > 0) {
            self.log.push(Move { id, at_ns: now_ns, coin: coin.clone(), amount: *amount, waiting: true });
        }
    }

    /// The request ran: it counts for 7 days from now.
    pub fn ran(&mut self, id: u64, now_ns: u64) {
        for m in self.log.iter_mut().filter(|m| m.id == id) {
            m.at_ns = now_ns;
            m.waiting = false;
        }
    }

    /// The request was cancelled or declined: it stops counting.
    pub fn forget(&mut self, id: u64) {
        self.log.retain(|m| m.id != id);
    }

    /// What the last 7 days used of a coin: waiting requests, and anything that ran less than 7 days ago.
    pub fn used(&self, coin: &str, now_ns: u64) -> u128 {
        self.log.iter().filter(|m| m.coin == coin && counts(m, now_ns)).fold(0u128, |sum, m| sum.saturating_add(m.amount))
    }

    pub fn status(&self, now_ns: u64) -> KidsStatus {
        KidsStatus {
            allowed: self.rules.allowed.clone(),
            week: self.rules.week.iter().map(|(coin, limit)| WeekLine { coin: coin.clone(), limit: *limit, used: U128(self.used(coin, now_ns)) }).collect(),
        }
    }

    fn limit(&self, coin: &str) -> Option<u128> {
        self.rules.week.iter().find(|(c, _)| c == coin).map(|(_, l)| l.0)
    }

    fn prune(&mut self, now_ns: u64) {
        self.log.retain(|m| counts(m, now_ns));
    }
}

fn counts(m: &Move, now_ns: u64) -> bool {
    m.waiting || m.at_ns.saturating_add(WEEK_NS) > now_ns
}

/// "near", or a fungible NEAR Intents token id: "nep141:<account>" or "nep245:<account>:<id>".
fn is_coin(coin: &str) -> bool {
    if coin == "near" {
        return true;
    }
    if coin.len() > 128 {
        return false;
    }
    if let Some(contract) = coin.strip_prefix("nep141:") {
        return contract.parse::<AccountId>().is_ok();
    }
    if let Some((contract, id)) = coin.strip_prefix("nep245:").and_then(|rest| rest.split_once(':')) {
        return contract.parse::<AccountId>().is_ok() && !id.is_empty();
    }
    false
}

#[cfg(test)]
mod tests;
