//! Agent limits: what ZeroFee's Agent may do with the account's money, enforced on-chain by the account contract.
//!
//! Agent is an AI assistant, and an AI can be tricked: a prompt injection in a token's name, a pasted message, a web
//! page. So nothing here trusts it. Agent gets its own key, and two things bound that key:
//! - **NEAR itself** restricts the agent key to `AGENT_METHODS` on this account. It can't send money directly, add or
//!   delete keys, change any setting, or attach a deposit (NEAR refuses deposits from function-call keys).
//! - **This module** checks every spend the agent key asks for:
//!   - only coins in the budget, and only to listed recipients (a convert may pay any address, within its own cap);
//!   - at most `per_day` of a coin in any 24 hours and `per_month` in any 30 days, rolling, so nothing resets at
//!     midnight and splitting a payment doesn't help;
//!   - at most `max_spends_per_day` spends in any 24 hours, which also bounds the storage it can make the account pay;
//!   - nothing while paused, nothing after the end date, and nothing after revoke (the rules are gone and the key is
//!     deleted).
//!
//! **Standing orders** (e.g. rent) are exact: one recipient, one coin, one amount, and the dates the person approved.
//! Each date pays once, within its grace window. Anyone may trigger a due date, so a payment on the 1st doesn't depend
//! on the phone being awake, and the trigger can't change what is paid, to whom, or when. Orders don't draw on the
//! budget: each one is its own exact limit.
//!
//! The logic is pure: time, the signing key and the account's name are parameters, so tests can attack it freely. It
//! builds no promises. The account contract (S1) calls it, turns each `Payment`'s `payment_plan` into promises in its
//! own audited place, and reports the result back with `settle`. `harness` (feature "harness") is a small contract
//! around it for proving it on testnet.
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::{near, AccountId};

pub const SECOND: u64 = 1_000_000_000;
pub const HOUR: u64 = 3_600 * SECOND;
pub const DAY: u64 = 86_400 * SECOND;
pub const MONTH: u64 = 30 * DAY;
/// The longest a budget or a standing order can run.
pub const MAX_TERM: u64 = 730 * DAY;
pub const MAX_SPENDS_PER_DAY: u32 = 12;
const MAX_COINS: usize = 8;
const MAX_RECIPIENTS: usize = 16;
const MAX_ORDERS: usize = 8;
const MAX_DATES: usize = 24;
const MIN_GRACE: u64 = HOUR;
const MAX_GRACE: u64 = 31 * DAY;
const MAX_COIN_LEN: usize = 128;
const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBLIC_KEY_LEN: usize = 1952;
pub const INTENTS: &str = "intents.near";

/// The only methods NEAR lets the agent key call on this account.
pub const AGENT_METHODS: &str = "agent_pay,agent_convert,run_order";
/// The most the agent key can burn on network fees before the phone renews it (0.5 NEAR, about 360 calls at 100 Tgas,
/// measured on testnet). It can't send money any other way. From NEAR protocol 85 an allowance is charged at max(gas
/// price, 1,000,000,000) a gas (0.1 NEAR for each 100 Tgas attached), so fewer calls fit than measured then.
pub const AGENT_KEY_ALLOWANCE: u128 = 500_000_000_000_000_000_000_000;
/// The phone offers `renew_key` when the agent key's allowance falls below this (0.1 NEAR).
pub const AGENT_KEY_RENEW_BELOW: u128 = 100_000_000_000_000_000_000_000;
const FT_GAS: u64 = 15_000_000_000_000;
const MT_GAS: u64 = 20_000_000_000_000;

/// Where a payment comes from, and so how it moves.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Payout {
    /// NEAR held by the account itself.
    Near,
    /// A NEP-141 coin held by the account itself (coins sent from a NEAR wallet, or a testnet coin).
    Ft { token: AccountId },
    /// A coin in the account's NEAR Intents balance, moved to the recipient's NEAR Intents balance.
    Ledger { token_id: String },
}

impl Payout {
    /// The coin's name in the account's rules, as in the account contract: "near", or a NEAR Intents token id
    /// ("nep141:<contract>", "nep245:<contract>:<id>"). The same coin held directly or in NEAR Intents shares one limit.
    pub fn coin(&self) -> String {
        match self {
            Payout::Near => "near".into(),
            Payout::Ft { token } => format!("nep141:{token}"),
            Payout::Ledger { token_id } => token_id.clone(),
        }
    }

    fn valid(&self) -> bool {
        match self {
            Payout::Ledger { token_id } => token_id.len() <= MAX_COIN_LEN && (token_id.starts_with("nep141:") || token_id.starts_with("nep245:")),
            _ => true,
        }
    }
}

/// How much of one coin Agent may move. Amounts are in the coin's smallest units.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct CoinLimit {
    pub coin: String,
    /// The most in any 24 hours, payments and converts together.
    pub per_day: U128,
    /// The most in any 30 days.
    pub per_month: U128,
    /// The part of `per_day` that may go to converts, which can pay any address. 0: no converts.
    pub convert_per_day: U128,
}

/// What Agent may spend on its own judgement, beyond standing orders.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Budget {
    pub coins: Vec<CoinLimit>,
    /// The only accounts a payment (not a convert) may go to.
    pub recipients: Vec<AccountId>,
    /// Block time (ns) from which nothing is allowed.
    pub ends_at_ns: U64,
    pub max_spends_per_day: u32,
}

/// A standing order as the person approves it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct OrderPlan {
    pub payout: Payout,
    pub to: AccountId,
    pub amount: U128,
    /// Block times (ns) of each payment, earliest first. The phone works them out from the calendar.
    pub dates_ns: Vec<U64>,
    /// How long after each date it may still run.
    pub grace_seconds: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum SlotState {
    Waiting,
    /// Sent, waiting for the result.
    Paying { id: U64 },
    Paid,
    /// Sent, and its result never came back: taken as paid an hour later, so it's never sent again, but the chain never
    /// confirmed it. The app says so and shows where to check. (Appended: older state reads the same.)
    PaidUnconfirmed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Slot {
    pub due_ns: U64,
    pub state: SlotState,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    pub id: U64,
    pub payout: Payout,
    pub to: AccountId,
    pub amount: U128,
    pub slots: Vec<Slot>,
    pub grace_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SpendKind {
    Pay,
    Convert,
}

/// A budget spend, kept for 30 days so the rolling limits can count it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Spend {
    pub id: U64,
    pub at_ns: U64,
    pub coin: String,
    pub amount: U128,
    pub kind: SpendKind,
}

/// One payment the account contract should now make (see `payment_plan`), then `settle`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub id: U64,
    pub payout: Payout,
    pub to: AccountId,
    pub amount: U128,
}

/// Why a request was refused. Each has a stable code (for the app's Problem screens) and plain words.
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    NotAgentKey,
    AgentKeyCannotChangeRules,
    Paused,
    Ended,
    ZeroAmount,
    CoinNotInBudget,
    RecipientNotListed,
    RecipientNeverAllowed,
    TooManyToday,
    OverDay,
    OverMonth,
    OverConvert,
    NoSuchOrder,
    NothingDue,
    Invalid(&'static str),
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::NotAgentKey => "agent.key.not-agent",
            Refusal::AgentKeyCannotChangeRules => "agent.key.cannot-change-rules",
            Refusal::Paused => "agent.paused",
            Refusal::Ended => "agent.ended",
            Refusal::ZeroAmount => "agent.amount.zero",
            Refusal::CoinNotInBudget => "agent.coin.not-allowed",
            Refusal::RecipientNotListed => "agent.recipient.not-listed",
            Refusal::RecipientNeverAllowed => "agent.recipient.never",
            Refusal::TooManyToday => "agent.limit.count",
            Refusal::OverDay => "agent.limit.day",
            Refusal::OverMonth => "agent.limit.month",
            Refusal::OverConvert => "agent.limit.convert",
            Refusal::NoSuchOrder => "agent.order.none",
            Refusal::NothingDue => "agent.order.not-due",
            Refusal::Invalid(_) => "agent.rules.invalid",
        }
    }

    pub fn words(&self) -> &'static str {
        match self {
            Refusal::NotAgentKey => "only Agent's own key can spend Agent's budget",
            Refusal::AgentKeyCannotChangeRules => "Agent's key can't change Agent's rules",
            Refusal::Paused => "Agent is paused",
            Refusal::Ended => "Agent's budget has ended",
            Refusal::ZeroAmount => "the amount must be more than zero",
            Refusal::CoinNotInBudget => "this coin isn't in Agent's budget",
            Refusal::RecipientNotListed => "Agent may not pay this account",
            Refusal::RecipientNeverAllowed => "Agent never pays this account itself or the NEAR Intents contract",
            Refusal::TooManyToday => "Agent made as many payments as it may in 24 hours",
            Refusal::OverDay => "this is over Agent's limit for this coin in 24 hours",
            Refusal::OverMonth => "this is over Agent's limit for this coin in 30 days",
            Refusal::OverConvert => "this is over Agent's convert limit for this coin in 24 hours",
            Refusal::NoSuchOrder => "there's no such standing order",
            Refusal::NothingDue => "nothing in this standing order is due now",
            Refusal::Invalid(why) => why,
        }
    }

    /// The panic message: the stable code first, so the app can map it to a Problem.
    pub fn message(&self) -> String {
        format!("{}: {}", self.code(), self.words())
    }
}

/// What a callback learned about a payment.
#[derive(Clone, Debug, PartialEq)]
pub enum Settled {
    BudgetSpend { ok: bool },
    OrderPayment { order: u64, due_ns: u64, ok: bool },
    Unknown,
}

/// Everything about the agent on one account. `None` in the account contract means no agent.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    key: Vec<u8>,
    budget: Budget,
    orders: Vec<Order>,
    log: Vec<Spend>,
    paused: bool,
    next_id: u64,
}

/// What the app shows.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct AgentView {
    pub paused: bool,
    pub budget: Budget,
    pub orders: Vec<Order>,
    /// Per coin in the budget: spent in the last 24 hours and the last 30 days.
    pub spent: Vec<(String, U128, U128)>,
    pub spends_today: u32,
}

impl Agent {
    /// Set up Agent with its key, budget and standing orders. The account contract places this at its strictest
    /// level: a new spender loosens the rules.
    pub fn new(signer: &[u8], key: Vec<u8>, budget: Budget, plans: Vec<OrderPlan>, now: u64, account: &AccountId) -> Result<Agent, Refusal> {
        if !is_ml_dsa_65_key(&key) {
            return Err(Refusal::Invalid("Agent's key must be post-quantum (ML-DSA-65)"));
        }
        if signer == key.as_slice() {
            return Err(Refusal::AgentKeyCannotChangeRules);
        }
        check_budget(&budget, now, account)?;
        let mut agent = Agent { key, budget, orders: vec![], log: vec![], paused: false, next_id: 1 };
        for plan in plans {
            agent.add_order(signer, plan, now, account)?;
        }
        Ok(agent)
    }

    /// The agent key's borsh bytes, for the account contract to delete it on revoke.
    pub fn key(&self) -> &[u8] {
        &self.key
    }

    pub fn paused(&self) -> bool {
        self.paused
    }

    // ── What the agent key may ask ──────────────────────────────────────────────────────────────────────────────

    /// Pay a listed recipient from the budget.
    pub fn pay(&mut self, signer: &[u8], payout: Payout, to: AccountId, amount: u128, now: u64, account: &AccountId) -> Result<Payment, Refusal> {
        self.spend(signer, payout, to, amount, SpendKind::Pay, now, account)
    }

    /// Pay any address (a convert's deposit address), within the coin's convert cap and its day and month limits.
    pub fn convert(&mut self, signer: &[u8], payout: Payout, to: AccountId, amount: u128, now: u64, account: &AccountId) -> Result<Payment, Refusal> {
        self.spend(signer, payout, to, amount, SpendKind::Convert, now, account)
    }

    /// Pay a standing order's due date (the earliest one, if several are inside their grace). Anyone may ask; only the
    /// approved payment can happen.
    pub fn run_order(&mut self, order_id: u64, now: u64) -> Result<Payment, Refusal> {
        let due = self.due(order_id, now).first().map(|(d, _)| *d);
        self.run_order_at(order_id, due.unwrap_or(u64::MAX), now)
    }

    /// Pay this one due date of a standing order.
    pub fn run_order_at(&mut self, order_id: u64, due_ns: u64, now: u64) -> Result<Payment, Refusal> {
        if self.paused {
            return Err(Refusal::Paused);
        }
        let id = self.next_id;
        let order = self.orders.iter_mut().find(|o| o.id.0 == order_id).ok_or(Refusal::NoSuchOrder)?;
        let grace = order.grace_ns.0;
        let slot = order
            .slots
            .iter_mut()
            .find(|s| s.state == SlotState::Waiting && s.due_ns.0 == due_ns && s.due_ns.0 <= now && now <= s.due_ns.0.saturating_add(grace))
            .ok_or(Refusal::NothingDue)?;
        slot.state = SlotState::Paying { id: U64(id) };
        let payment = Payment { id: U64(id), payout: order.payout.clone(), to: order.to.clone(), amount: order.amount };
        self.next_id += 1;
        Ok(payment)
    }

    /// The dates of a standing order that can be paid now, earliest first, each with when its grace ends (ns).
    pub fn due(&self, order_id: u64, now: u64) -> Vec<(u64, u64)> {
        let Some(order) = self.orders.iter().find(|o| o.id.0 == order_id) else { return vec![] };
        let grace = order.grace_ns.0;
        order.slots.iter().filter(|s| s.state == SlotState::Waiting && s.due_ns.0 <= now && now <= s.due_ns.0.saturating_add(grace)).map(|s| (s.due_ns.0, s.due_ns.0.saturating_add(grace))).collect()
    }

    /// The payment an order is waiting to hear about, if one of its dates is "paying", and that date.
    pub fn paying(&self, order_id: u64) -> Option<(u64, u64)> {
        let order = self.orders.iter().find(|o| o.id.0 == order_id)?;
        order.slots.iter().find_map(|s| match s.state {
            SlotState::Paying { id } => Some((id.0, s.due_ns.0)),
            _ => None,
        })
    }

    /// A payment whose result never came back, an hour on: its date is taken as paid, never to be sent again, and marked
    /// as not confirmed by the chain (audit F12).
    pub fn settle_unconfirmed(&mut self, id: u64) {
        for order in self.orders.iter_mut() {
            if let Some(slot) = order.slots.iter_mut().find(|s| s.state == (SlotState::Paying { id: U64(id) })) {
                slot.state = SlotState::PaidUnconfirmed;
                return;
            }
        }
    }

    /// The result of a payment's promise. A failed payment moved nothing, so it gives its budget back, or its order
    /// date can run again (within its grace).
    pub fn settle(&mut self, id: u64, ok: bool) -> Settled {
        if let Some(i) = self.log.iter().position(|s| s.id.0 == id) {
            // A failed spend moved nothing, so it leaves the totals, but it still counts as one of the day's spends
            // (audit F8: otherwise failing spends could be repeated without limit).
            if !ok {
                self.log[i].amount = U128(0);
            }
            return Settled::BudgetSpend { ok };
        }
        for order in self.orders.iter_mut() {
            if let Some(slot) = order.slots.iter_mut().find(|s| s.state == (SlotState::Paying { id: U64(id) })) {
                slot.state = if ok { SlotState::Paid } else { SlotState::Waiting };
                return Settled::OrderPayment { order: order.id.0, due_ns: slot.due_ns.0, ok };
            }
        }
        Settled::Unknown
    }

    // ── What only the person's own device may do (the account contract also restricts these by key) ─────────────

    /// Tightening, so allowed at once to any of the account's keys.
    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self, signer: &[u8]) -> Result<(), Refusal> {
        self.not_agent(signer)?;
        self.paused = false;
        Ok(())
    }

    /// Replace the budget. The spends of the last 30 days still count, so a new budget can't reset the totals.
    pub fn set_budget(&mut self, signer: &[u8], budget: Budget, now: u64, account: &AccountId) -> Result<(), Refusal> {
        self.not_agent(signer)?;
        check_budget(&budget, now, account)?;
        self.budget = budget;
        Ok(())
    }

    pub fn add_order(&mut self, signer: &[u8], plan: OrderPlan, now: u64, account: &AccountId) -> Result<u64, Refusal> {
        self.not_agent(signer)?;
        self.prune(now);
        if self.orders.len() >= MAX_ORDERS {
            return Err(Refusal::Invalid("at most eight standing orders"));
        }
        check_order(&plan, now, account)?;
        let id = self.take_id();
        let slots = plan.dates_ns.iter().map(|d| Slot { due_ns: *d, state: SlotState::Waiting }).collect();
        self.orders.push(Order { id: U64(id), payout: plan.payout, to: plan.to, amount: plan.amount, slots, grace_ns: U64(plan.grace_seconds.0 * SECOND) });
        Ok(id)
    }

    /// The agent key to re-add, unchanged, with a fresh fee allowance. It loosens nothing (same key, same methods, same
    /// budget and orders), so it needs only Face ID. Not the agent key itself.
    pub fn renew_key(&self, signer: &[u8]) -> Result<&[u8], Refusal> {
        self.not_agent(signer)?;
        Ok(&self.key)
    }

    /// Tightening, so allowed at once. A payment already sent still reports back through `settle`.
    pub fn remove_order(&mut self, order_id: u64) -> Result<(), Refusal> {
        let i = self.orders.iter().position(|o| o.id.0 == order_id).ok_or(Refusal::NoSuchOrder)?;
        self.orders.remove(i);
        Ok(())
    }

    pub fn view(&self, now: u64) -> AgentView {
        let spent = self
            .budget
            .coins
            .iter()
            .map(|c| {
                let t = self.totals(&c.coin, now);
                (c.coin.clone(), U128(t.day), U128(t.month))
            })
            .collect();
        AgentView { paused: self.paused, budget: self.budget.clone(), orders: self.orders.clone(), spent, spends_today: self.spends_today(now) }
    }

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn spend(&mut self, signer: &[u8], payout: Payout, to: AccountId, amount: u128, kind: SpendKind, now: u64, account: &AccountId) -> Result<Payment, Refusal> {
        if signer != self.key.as_slice() {
            return Err(Refusal::NotAgentKey);
        }
        if self.paused {
            return Err(Refusal::Paused);
        }
        if now >= self.budget.ends_at_ns.0 {
            return Err(Refusal::Ended);
        }
        if amount == 0 {
            return Err(Refusal::ZeroAmount);
        }
        if !payout.valid() {
            return Err(Refusal::Invalid("this coin's name isn't valid"));
        }
        let coin = payout.coin();
        let limit = self.budget.coins.iter().find(|c| c.coin == coin).cloned().ok_or(Refusal::CoinNotInBudget)?;
        if never_recipient(&to, account) {
            return Err(Refusal::RecipientNeverAllowed);
        }
        if kind == SpendKind::Pay && !self.budget.recipients.contains(&to) {
            return Err(Refusal::RecipientNotListed);
        }
        self.prune(now);
        if self.spends_today(now) >= self.budget.max_spends_per_day {
            return Err(Refusal::TooManyToday);
        }
        let t = self.totals(&coin, now);
        if t.day.checked_add(amount).is_none_or(|x| x > limit.per_day.0) {
            return Err(Refusal::OverDay);
        }
        if t.month.checked_add(amount).is_none_or(|x| x > limit.per_month.0) {
            return Err(Refusal::OverMonth);
        }
        if kind == SpendKind::Convert && t.convert_day.checked_add(amount).is_none_or(|x| x > limit.convert_per_day.0) {
            return Err(Refusal::OverConvert);
        }
        let id = self.take_id();
        self.log.push(Spend { id: U64(id), at_ns: U64(now), coin, amount: U128(amount), kind });
        Ok(Payment { id: U64(id), payout, to, amount: U128(amount) })
    }

    fn not_agent(&self, signer: &[u8]) -> Result<(), Refusal> {
        if signer == self.key.as_slice() {
            return Err(Refusal::AgentKeyCannotChangeRules);
        }
        Ok(())
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// Forget spends older than 30 days, and orders with nothing left to pay.
    fn prune(&mut self, now: u64) {
        self.log.retain(|s| s.at_ns.0.saturating_add(MONTH) > now);
        self.orders.retain(|o| {
            o.slots.iter().any(|s| match s.state {
                SlotState::Paying { .. } => true,
                SlotState::Waiting => now <= s.due_ns.0.saturating_add(o.grace_ns.0),
                SlotState::Paid | SlotState::PaidUnconfirmed => false,
            })
        });
    }

    /// A spend counts for 24 hours (and 30 days) from the moment it was made.
    fn totals(&self, coin: &str, now: u64) -> Totals {
        let mut t = Totals::default();
        for s in self.log.iter().filter(|s| s.coin == coin) {
            let age = now.saturating_sub(s.at_ns.0);
            if age < MONTH {
                t.month = t.month.saturating_add(s.amount.0);
            }
            if age < DAY {
                t.day = t.day.saturating_add(s.amount.0);
                if s.kind == SpendKind::Convert {
                    t.convert_day = t.convert_day.saturating_add(s.amount.0);
                }
            }
        }
        t
    }

    fn spends_today(&self, now: u64) -> u32 {
        self.log.iter().filter(|s| now.saturating_sub(s.at_ns.0) < DAY).count() as u32
    }
}

#[derive(Default)]
struct Totals {
    day: u128,
    month: u128,
    convert_day: u128,
}

fn never_recipient(to: &AccountId, account: &AccountId) -> bool {
    to == account || to.as_str() == INTENTS
}

fn valid_coin(coin: &str) -> bool {
    coin == "near" || (coin.len() <= MAX_COIN_LEN && (coin.starts_with("nep141:") || coin.starts_with("nep245:")))
}

fn check_budget(b: &Budget, now: u64, account: &AccountId) -> Result<(), Refusal> {
    if b.coins.len() > MAX_COINS {
        return Err(Refusal::Invalid("at most eight coins in Agent's budget"));
    }
    for (i, c) in b.coins.iter().enumerate() {
        if !valid_coin(&c.coin) {
            return Err(Refusal::Invalid("a coin's name in Agent's budget isn't valid"));
        }
        if b.coins[..i].iter().any(|d| d.coin == c.coin) {
            return Err(Refusal::Invalid("a coin is in Agent's budget twice"));
        }
        if c.per_day.0 == 0 || c.per_month.0 < c.per_day.0 || c.convert_per_day.0 > c.per_day.0 {
            return Err(Refusal::Invalid("each coin needs a day limit above zero, a month limit at least as big, and a convert limit no bigger than the day limit"));
        }
    }
    if b.recipients.len() > MAX_RECIPIENTS {
        return Err(Refusal::Invalid("at most sixteen recipients for Agent"));
    }
    for (i, r) in b.recipients.iter().enumerate() {
        if never_recipient(r, account) {
            return Err(Refusal::RecipientNeverAllowed);
        }
        if b.recipients[..i].contains(r) {
            return Err(Refusal::Invalid("a recipient is listed twice"));
        }
    }
    if b.ends_at_ns.0 <= now || b.ends_at_ns.0 > now.saturating_add(MAX_TERM) {
        return Err(Refusal::Invalid("Agent's budget must end in the future, within two years"));
    }
    if b.max_spends_per_day == 0 || b.max_spends_per_day > MAX_SPENDS_PER_DAY {
        return Err(Refusal::Invalid("Agent may make between 1 and 12 spends in 24 hours"));
    }
    Ok(())
}

fn check_order(p: &OrderPlan, now: u64, account: &AccountId) -> Result<(), Refusal> {
    if p.amount.0 == 0 {
        return Err(Refusal::ZeroAmount);
    }
    if !p.payout.valid() {
        return Err(Refusal::Invalid("this coin's name isn't valid"));
    }
    if never_recipient(&p.to, account) {
        return Err(Refusal::RecipientNeverAllowed);
    }
    if p.dates_ns.is_empty() || p.dates_ns.len() > MAX_DATES {
        return Err(Refusal::Invalid("a standing order has between 1 and 24 dates"));
    }
    if p.dates_ns[0].0 < now || p.dates_ns.windows(2).any(|w| w[1].0 <= w[0].0) || p.dates_ns[p.dates_ns.len() - 1].0 > now.saturating_add(MAX_TERM) {
        return Err(Refusal::Invalid("a standing order's dates must be in the future, in order, within two years"));
    }
    let grace = p.grace_seconds.0.saturating_mul(SECOND);
    if !(MIN_GRACE..=MAX_GRACE).contains(&grace) {
        return Err(Refusal::Invalid("a standing order's grace is between one hour and 31 days"));
    }
    Ok(())
}

pub fn is_ml_dsa_65_key(bytes: &[u8]) -> bool {
    bytes.len() == 1 + ML_DSA_65_PUBLIC_KEY_LEN && bytes[0] == ML_DSA_65_TAG
}

/// One step of a payment, in the account contract's own shape: only transfers and calls.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    Transfer { deposit: U128 },
    FunctionCall { method_name: String, args: Base64VecU8, deposit: U128, gas: U64 },
}

/// What the account contract should do to make a payment, and what it moves out, per coin (as the account contract's
/// `moves()` would measure the same steps: the attached yoctoNEAR counts as "near").
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentPlan {
    pub receiver_id: AccountId,
    pub steps: Vec<Step>,
    pub moves: Vec<(String, U128)>,
}

/// The plan for a payment. The account contract builds the promises (and its callback, which calls `settle`).
pub fn payment_plan(p: &Payment) -> PaymentPlan {
    let call = |method: &str, args: near_sdk::serde_json::Value, gas: u64| Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.to_string().into_bytes()), deposit: U128(1), gas: U64(gas) };
    match &p.payout {
        Payout::Near => PaymentPlan { receiver_id: p.to.clone(), steps: vec![Step::Transfer { deposit: p.amount }], moves: vec![("near".into(), p.amount)] },
        Payout::Ft { token } => PaymentPlan {
            receiver_id: token.clone(),
            steps: vec![call("ft_transfer", json!({ "receiver_id": p.to, "amount": p.amount }), FT_GAS)],
            moves: vec![("near".into(), U128(1)), (p.payout.coin(), p.amount)],
        },
        Payout::Ledger { token_id } => PaymentPlan {
            receiver_id: INTENTS.parse().unwrap(),
            steps: vec![call("mt_transfer", json!({ "receiver_id": p.to, "token_id": token_id, "amount": p.amount }), MT_GAS)],
            moves: vec![("near".into(), U128(1)), (p.payout.coin(), p.amount)],
        },
    }
}

#[cfg(feature = "harness")]
pub mod harness;

#[cfg(test)]
mod tests;
