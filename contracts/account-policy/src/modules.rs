//! Legacy (inheritance) and Agent (spending limits), merged from contracts/account-policy/modules/{legacy,agent}.
//!
//! The modules are pure: they decide, but build no promises, touch no storage and check no callers. This file adds those.
//! - Each module keeps its state under its own storage key (b"legacy", b"agent"), never as a field of `AccountPolicy`,
//!   whose layout is frozen.
//! - Proof of life: any Face ID action by the owner (`owner_active`, called by every device and second-device method)
//!   stops a waiting inheritance claim. Agent payments and `run_order` don't count: an agent can't keep a dead owner
//!   "alive".
//! - Setting up or switching off Legacy, and every loosening of Agent, take the strictest protection level. Tightening
//!   (pause, remove an order, revoke) and refilling the agent key's fee allowance happen at once.
//! - Heirs call from their own accounts: they can claim, pay out, and cancel a recovery, only as the module allows.
//! - Agent payments skip the bands (their budget was approved at the strictest level) but count in `spent`.
use super::*;
use agent_limits::{payment_plan, Agent, AgentView, Budget, OrderPlan, Payment, Payout, AGENT_KEY_ALLOWANCE, AGENT_METHODS};
use kids::{KidsRules, KidsState, KidsStatus};
use legacy::{LegacyConfig, LegacyState, LegacyStatus};
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};

const LEGACY_KEY: &[u8] = b"legacy";
const AGENT_KEY: &[u8] = b"agent";
const KIDS_KEY: &[u8] = b"kids";
/// Standing orders' failed tries (audit F8), per date (re-audit R6), under their own key.
const ORDER_TRIES_KEY: &[u8] = b"order_tries";
const ORDER_MAX_TRIES: u32 = 3;
const ORDER_RETRY_NS: u64 = 3_600 * 1_000_000_000;

#[derive(BorshSerialize, BorshDeserialize, Default)]
#[borsh(crate = "near_sdk::borsh")]
struct OrderTries {
    order: u64,
    due_ns: u64,
    /// When this date's grace ends: its tries are forgotten then.
    until_ns: u64,
    failed: u32,
    last_ns: u64,
}

/// Every module's state this release reads, decoded (re-audit R8).
pub(crate) fn read_all_module_state() {
    let _: Option<LegacyState> = load(LEGACY_KEY);
    let _: Option<Agent> = load(AGENT_KEY);
    let _: Option<KidsState> = load(KIDS_KEY);
    let _: Option<Vec<(u64, String)>> = load(KIDS_WHY_KEY);
    let _: Option<Vec<OrderTries>> = load(ORDER_TRIES_KEY);
}
/** Why each held request needs the parent, for the parent's sheet and the child's waiting screen. */
const KIDS_WHY_KEY: &[u8] = b"kids_why";
/// NEAR kept on the account when heirs are paid out, for its own transactions afterwards.
const LEGACY_RESERVE: u128 = 100_000_000_000_000_000_000_000;
const INTENTS_ACCOUNT: &str = "intents.near";
const AGENT_SETTLE_GAS: u64 = 15_000_000_000_000;

fn load<T: BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).map(|bytes| T::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("stored module state is unreadable")))
}

fn store<T: BorshSerialize>(key: &[u8], value: &T) {
    env::storage_write(key, &borsh::to_vec(value).unwrap_or_else(|_| env::panic_str("module state can't be stored")));
}

fn load_legacy() -> LegacyState {
    load(LEGACY_KEY).unwrap_or_else(|| env::panic_str("no legacy is set up"))
}

/// Is `key` Agent's key? (A key never takes a second role, audit F15.)
pub(crate) fn agent_key_is(key: &[u8]) -> bool {
    load::<Agent>(AGENT_KEY).is_some_and(|a| a.key() == key)
}

fn load_agent() -> Agent {
    load(AGENT_KEY).unwrap_or_else(|| env::panic_str("no agent is set up"))
}

fn refuse(r: agent_limits::Refusal) -> ! {
    env::panic_str(&r.message())
}

/// Kids: a request outside the child's rules (someone not on the allowed list, or past a weekly limit) also needs the
/// second device, the parent. No rules set: the level stays as the bands gave it.
pub(crate) fn kids_level(level: Level, parties: Option<&[AccountId]>, moves: Option<&[(String, u128)]>) -> Level {
    match load::<KidsState>(KIDS_KEY) {
        Some(k) if k.bump(parties, moves, env::block_timestamp()) => level.with_device(),
        _ => level,
    }
}

/// A child's account (its rules are on): the parent, its second device, decides about its own removal (audit F3).
pub(crate) fn kids_on() -> bool {
    env::storage_has_key(KIDS_KEY)
}

/// Which of the child's rules a request breaks, in the order `bump` checks them: "not-allowed:<account>",
/// "over-week:<coin>:<limit>", "unmeasured" or "log-full". None when none does (or there are no rules).
pub(crate) fn kids_reason(parties: Option<&[AccountId]>, moves: Option<&[(String, u128)]>) -> Option<String> {
    let k = load::<KidsState>(KIDS_KEY)?;
    let now = env::block_timestamp();
    if !k.bump(parties, moves, now) {
        return None;
    }
    let (Some(parties), Some(moves)) = (parties, moves) else { return Some("unmeasured".into()) };
    if let Some(p) = parties.iter().find(|p| !k.rules.allowed.is_empty() && !k.rules.allowed.contains(p)) {
        return Some(format!("not-allowed:{p}"));
    }
    if k.log.len() >= kids::MAX_LOG {
        return Some("log-full".into());
    }
    for (coin, amount) in moves.iter().filter(|(_, a)| *a > 0) {
        if let Some((_, limit)) = k.rules.week.iter().find(|(c, _)| c == coin) {
            if k.used(coin, now).checked_add(*amount).is_none_or(|t| t > limit.0) {
                return Some(format!("over-week:{coin}:{}", limit.0));
            }
        }
    }
    Some("unmeasured".into())
}

/// A request's level with the child's rules (the parent added where they hold it), and why, before it counts.
pub(crate) fn kids_hold(level: Level, parties: Option<&[AccountId]>, moves: Option<&[(String, u128)]>) -> (Level, Option<String>) {
    (kids_level(level, parties, moves), kids_reason(parties, moves))
}

/// It was placed: its coins count toward the week, and a held one keeps why.
pub(crate) fn kids_held(id: u64, ran_at_once: bool, why: Option<String>, moves: Option<&[(String, u128)]>) {
    kids_record(id, moves);
    if !ran_at_once {
        kids_why_set(id, why);
    }
}

/// It ended: run (it counts for 7 days from now) or dropped (it stops counting). Its reason goes either way.
pub(crate) fn kids_ended(id: u64, ran: bool) {
    if ran {
        kids_ran(id);
    } else {
        kids_forget(id);
    }
    kids_why_set(id, None);
}

/// Everyone a chain calls or pays, so far: None once a group's can't be told.
pub(crate) fn join_parties(so_far: Option<Vec<AccountId>>, next: Option<Vec<AccountId>>) -> Option<Vec<AccountId>> {
    match (so_far, next) {
        (Some(mut all), Some(p)) => {
            all.extend(p);
            Some(all)
        }
        _ => None,
    }
}

/// Keep the reason for a held request (the account can hold at most MAX_PENDING), or drop it when it ends.
pub(crate) fn kids_why_set(id: u64, why: Option<String>) {
    let mut all: Vec<(u64, String)> = load(KIDS_WHY_KEY).unwrap_or_default();
    all.retain(|(i, _)| *i != id);
    if let Some(w) = why {
        all.push((id, w));
    }
    if all.is_empty() {
        env::storage_remove(KIDS_WHY_KEY);
    } else {
        store(KIDS_WHY_KEY, &all);
    }
}

/// A request was placed: its coins count toward the week from now (a request it can't measure counts nothing, and
/// always needs the parent).
pub(crate) fn kids_record(id: u64, moves: Option<&[(String, u128)]>) {
    if let (Some(mut k), Some(m)) = (load::<KidsState>(KIDS_KEY), moves) {
        k.record(id, m, env::block_timestamp());
        store(KIDS_KEY, &k);
    }
}

/// It ran: it counts for 7 days from now.
pub(crate) fn kids_ran(id: u64) {
    if let Some(mut k) = load::<KidsState>(KIDS_KEY) {
        k.ran(id, env::block_timestamp());
        store(KIDS_KEY, &k);
    }
}

/// Cancelled or declined: it stops counting.
pub(crate) fn kids_forget(id: u64) {
    if let Some(mut k) = load::<KidsState>(KIDS_KEY) {
        k.forget(id);
        store(KIDS_KEY, &k);
    }
}

/// While an inheritance claim is waiting, the account can't be moved to a new phone (see the legacy module).
pub(crate) fn legacy_blocks_recovery() -> bool {
    load::<LegacyState>(LEGACY_KEY).map(|l| l.blocks_recovery(env::block_timestamp())).unwrap_or(false)
}

/// Carry out a held Legacy or Agent change once its protection level allows it.
pub(crate) fn finish_module_change(change: Change) {
    let now = env::block_timestamp();
    let me = env::current_account_id();
    match change {
        Change::LegacySetup { config_json } => {
            let config: LegacyConfig = near_sdk::serde_json::from_str(&config_json).unwrap_or_else(|_| env::panic_str("legacy rules are unreadable"));
            let state = legacy::setup(&me, config, now).unwrap_or_else(|e| env::panic_str(&e));
            store(LEGACY_KEY, &state);
            event("legacy_set", 0);
        }
        Change::LegacyOff => {
            env::storage_remove(LEGACY_KEY);
            event("legacy_off", 0);
        }
        Change::AgentSet { public_key, budget, orders } => {
            // Checked again when it runs (audit F9, F15): two may have waited together.
            require!(load::<Agent>(AGENT_KEY).is_none(), "revoke the current agent first");
            let a = Agent::new(&signer_key(), public_key.0.clone(), budget, orders, now, &me).unwrap_or_else(|r| refuse(r));
            add_function_call_key(&public_key.0, AGENT_METHODS, AGENT_KEY_ALLOWANCE);
            store(AGENT_KEY, &a);
            event("agent_set", 0);
        }
        Change::AgentSetBudget { budget } => {
            let mut a = load_agent();
            a.set_budget(&signer_key(), budget, now, &me).unwrap_or_else(|r| refuse(r));
            store(AGENT_KEY, &a);
        }
        Change::AgentAddOrder { plan } => {
            let mut a = load_agent();
            a.add_order(&signer_key(), plan, now, &me).unwrap_or_else(|r| refuse(r));
            store(AGENT_KEY, &a);
        }
        Change::AgentResume => {
            let mut a = load_agent();
            a.resume(&signer_key()).unwrap_or_else(|r| refuse(r));
            store(AGENT_KEY, &a);
        }
        Change::KidsSet { rules } => {
            let rules = kids::setup(rules).unwrap_or_else(|e| env::panic_str(&e));
            // New rules keep the week's log, so changing them can't reset what was already used.
            let k = match load::<KidsState>(KIDS_KEY) {
                Some(mut k) => {
                    k.rules = rules;
                    k
                }
                None => KidsState::new(rules),
            };
            store(KIDS_KEY, &k);
            event("kids_set", 0);
        }
        Change::KidsOff => {
            env::storage_remove(KIDS_KEY);
            event("kids_off", 0);
        }
        _ => env::panic_str("not a module change"),
    }
}

impl AccountPolicy {
    /// The owner acted with Face ID (or the second device did): proof of life, which stops a waiting inheritance claim.
    /// Every owner method calls this, so it also refuses Agent's key outright: NEAR's method lists already keep that key
    /// out, and this holds even if a list were ever wrong (an agent must never count as the owner being alive).
    pub(crate) fn owner_active(&mut self) {
        if let Some(a) = load::<Agent>(AGENT_KEY) {
            require!(signer_key() != a.key(), "Agent's key can't do this");
        }
        self.device_gate();
        if let Some(mut l) = load::<LegacyState>(LEGACY_KEY) {
            if l.on_owner_activity(env::block_timestamp()).is_some() {
                event("legacy_claim_stopped", 0);
            }
            store(LEGACY_KEY, &l);
        }
    }

    /// An agent payment: record it toward the 24-hour totals, send it, and settle it when the result is known.
    fn agent_dispatch(&mut self, mut a: Agent, payment: Payment) {
        let plan = payment_plan(&payment);
        let id = self.take_id();
        for (coin, amount) in &plan.moves {
            self.spent.push(Spent { at_ns: env::block_timestamp(), id, coin: coin.clone(), amount: amount.0 });
        }
        store(AGENT_KEY, &a);
        let steps = plan.steps.into_iter().map(convert_step).collect();
        let _ = group_promise(Group { receiver_id: plan.receiver_id, steps })
            .then(AccountPolicy::ext(env::current_account_id()).with_static_gas(Gas::from_gas(AGENT_SETTLE_GAS)).with_unused_gas_weight(1).on_agent_settled(payment.id, Some(U64(id))));
        let _ = &mut a;
    }
}

fn convert_step(s: agent_limits::Step) -> Step {
    match s {
        agent_limits::Step::Transfer { deposit } => Step::Transfer { deposit },
        agent_limits::Step::FunctionCall { method_name, args, deposit, gas } => Step::FunctionCall { method_name, args, deposit, gas },
    }
}

#[near]
impl AccountPolicy {
    // ── Legacy: the owner ────────────────────────────────────────────────────────────────────────────────────────

    /// Choose who gets the money after a long silence. Checked now, applied through the strictest level.
    pub fn legacy_setup(&mut self, config: LegacyConfig) -> Outcome {
        only_this_account();
        self.owner_active();
        legacy::setup(&env::current_account_id(), config.clone(), env::block_timestamp()).unwrap_or_else(|e| env::panic_str(&e));
        let id = self.take_id();
        let level = self.strictest();
        let config_json = near_sdk::serde_json::to_string(&config).unwrap_or_else(|_| env::panic_str("legacy rules can't be written"));
        self.place(id, Change::LegacySetup { config_json }, level)
    }

    pub fn legacy_off(&mut self) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(load::<LegacyState>(LEGACY_KEY).is_some(), "no legacy is set up");
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::LegacyOff, level)
    }

    /// "I'm here": restarts the silence clock (any Face ID action does the same).
    pub fn legacy_check_in(&mut self) {
        only_this_account();
        self.owner_active();
        event("legacy_check_in", 0);
    }

    /// Stop a waiting claim from the alert screen. (Not owner_active as well: the module wants one or the other.)
    pub fn legacy_cancel_claim(&mut self) {
        only_this_account();
        // Only a phone this account still knows (re-audit R5): a key replaced by a recovery can't stop the heirs.
        self.device_gate();
        let mut l = load_legacy();
        l.cancel_claim(env::block_timestamp()).unwrap_or_else(|e| env::panic_str(&e));
        store(LEGACY_KEY, &l);
        event("legacy_claim_stopped", 1);
    }

    // ── Legacy: heirs, from their own accounts ───────────────────────────────────────────────────────────────

    pub fn legacy_start_claim(&mut self) {
        let caller = env::predecessor_account_id();
        require!(caller != env::current_account_id(), "the owner doesn't claim their own legacy");
        let mut l = load_legacy();
        l.start_claim(&caller, env::block_timestamp()).unwrap_or_else(|e| env::panic_str(&e));
        store(LEGACY_KEY, &l);
        event("legacy_claim_started", 0);
    }

    /// After the claim delay, any heir pays everyone out by shares: spendable NEAR, and the approved coins in NEAR
    /// Intents. `balances` are the Intents balances to split; a token not approved at setup is refused, and amounts
    /// above what's really there simply fail to move.
    pub fn legacy_distribute(&mut self, balances: Vec<(String, U128)>) {
        let caller = env::predecessor_account_id();
        let l = load_legacy();
        require!(l.is_heir(&caller), "only someone named in this legacy can pay it out");
        let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        let spendable = env::account_balance().as_yoctonear().saturating_sub(storage).saturating_sub(LEGACY_RESERVE);
        let balances: Vec<(String, u128)> = balances.into_iter().map(|(t, a)| (t, a.0)).collect();
        let plan = l.payout_plan(env::block_timestamp(), spendable, &balances).unwrap_or_else(|e| env::panic_str(&e));
        for payout in plan {
            if payout.near > 0 {
                let _ = Promise::new(payout.receiver_id.clone()).transfer(NearToken::from_yoctonear(payout.near));
            }
            if !payout.tokens.is_empty() {
                let (ids, amounts): (Vec<String>, Vec<String>) = payout.tokens.iter().map(|(t, a)| (t.clone(), a.to_string())).unzip();
                let args = near_sdk::serde_json::json!({ "receiver_id": payout.receiver_id, "token_ids": ids, "amounts": amounts, "approvals": null });
                let _ = Promise::new(INTENTS_ACCOUNT.parse::<AccountId>().unwrap()).function_call("mt_batch_transfer", args.to_string().into_bytes(), NearToken::from_yoctonear(1), Gas::from_tgas(30));
            }
        }
        event("legacy_paid_out", 0);
    }

    /// A named heir may stop a recovery once the owner has been silent long enough (see the legacy module).
    pub fn legacy_cancel_recovery(&mut self) {
        let caller = env::predecessor_account_id();
        require!(load_legacy().can_cancel_recovery(&caller, env::block_timestamp()), "you can't stop this recovery");
        require!(self.recovery.take().is_some(), "no recovery is waiting");
        self.restart_young_ages(env::block_timestamp());
        event("recovery_cancelled", env::block_timestamp());
    }

    pub fn legacy_status(&self) -> Option<LegacyStatus> {
        load::<LegacyState>(LEGACY_KEY).map(|l| l.status(env::block_timestamp()))
    }

    // ── Agent: the owner ─────────────────────────────────────────────────────────────────────────────────────

    /// Give Agent a key and a budget. A new spender loosens the rules: strictest level.
    pub fn agent_set(&mut self, public_key: Base64VecU8, budget: Budget, orders: Vec<OrderPlan>) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(load::<Agent>(AGENT_KEY).is_none(), "revoke the current agent first");
        require!(!self.key_in_use(&public_key.0), "that key is already on this account");
        Agent::new(&signer_key(), public_key.0.clone(), budget.clone(), orders.clone(), env::block_timestamp(), &env::current_account_id()).unwrap_or_else(|r| refuse(r));
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::AgentSet { public_key, budget, orders }, level)
    }

    pub fn agent_set_budget(&mut self, budget: Budget) -> Outcome {
        only_this_account();
        self.owner_active();
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::AgentSetBudget { budget }, level)
    }

    pub fn agent_add_order(&mut self, plan: OrderPlan) -> Outcome {
        only_this_account();
        self.owner_active();
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::AgentAddOrder { plan }, level)
    }

    pub fn agent_resume(&mut self) -> Outcome {
        only_this_account();
        self.owner_active();
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::AgentResume, level)
    }

    /// Tightening, so at once.
    pub fn agent_pause(&mut self) {
        only_this_account();
        self.owner_active();
        let mut a = load_agent();
        a.pause();
        store(AGENT_KEY, &a);
    }

    pub fn agent_remove_order(&mut self, id: U64) {
        only_this_account();
        self.owner_active();
        let mut a = load_agent();
        a.remove_order(id.0).unwrap_or_else(|r| refuse(r));
        store(AGENT_KEY, &a);
    }

    /// Take Agent's key away and forget the agent. At once.
    pub fn agent_revoke(&mut self) {
        only_this_account();
        self.owner_active();
        let a = load_agent();
        delete_key(a.key());
        env::storage_remove(AGENT_KEY);
        // Anything for Agent still waiting goes with it, so nothing brings an agent back unasked (audit F9).
        let waiting: Vec<u64> = self
            .pending
            .iter()
            .filter(|p| matches!(p.change, Change::AgentSet { .. } | Change::AgentSetBudget { .. } | Change::AgentAddOrder { .. } | Change::AgentResume))
            .map(|p| p.id.0)
            .collect();
        for id in waiting {
            self.drop_waiting(id, "request_cancelled");
        }
        event("agent_revoked", 0);
    }

    /// Refill the agent key's fee allowance: the same key, the same methods, nothing else changes. At once.
    pub fn agent_renew_key(&mut self) {
        only_this_account();
        self.owner_active();
        let a = load_agent();
        let key = a.renew_key(&signer_key()).unwrap_or_else(|r| refuse(r)).to_vec();
        // Adding a key that exists is refused, so delete and add in ONE batch.
        let account = env::current_account_id();
        let allowance = AGENT_KEY_ALLOWANCE.to_le_bytes();
        unsafe {
            let p = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
            near_sys::promise_batch_action_delete_key(p, key.len() as u64, key.as_ptr() as u64);
            near_sys::promise_batch_action_add_key_with_function_call(
                p,
                key.len() as u64,
                key.as_ptr() as u64,
                0,
                allowance.as_ptr() as u64,
                account.as_bytes().len() as u64,
                account.as_bytes().as_ptr() as u64,
                AGENT_METHODS.len() as u64,
                AGENT_METHODS.as_ptr() as u64,
            );
        }
        event("agent_key_renewed", 0);
    }

    // ── Agent: its own key, and anyone for a dated order ─────────────────────────────────────────────────────

    pub fn agent_pay(&mut self, payout: Payout, to: AccountId, amount: U128) {
        only_this_account();
        let mut a = load_agent();
        let payment = a.pay(&signer_key(), payout, to, amount.0, env::block_timestamp(), &env::current_account_id()).unwrap_or_else(|r| refuse(r));
        self.agent_dispatch(a, payment);
    }

    pub fn agent_convert(&mut self, payout: Payout, to: AccountId, amount: U128) {
        only_this_account();
        let mut a = load_agent();
        let payment = a.convert(&signer_key(), payout, to, amount.0, env::block_timestamp(), &env::current_account_id()).unwrap_or_else(|r| refuse(r));
        self.agent_dispatch(a, payment);
    }

    /// Anyone may run a dated order: it can only pay that order's recipient, coin and amount, once, in its window. A
    /// date whose payment failed may be tried again at most twice more, an hour apart (audit F8); each date has its
    /// own tries, forgotten when its grace ends (re-audit R6).
    pub fn run_order(&mut self, id: U64) {
        let now = env::block_timestamp();
        let mut tries: Vec<OrderTries> = load(ORDER_TRIES_KEY).unwrap_or_default();
        tries.retain(|t| now <= t.until_ns);
        let mut a = load_agent();
        // A payment whose settle never came back (audit F12) is taken as paid an hour after it was sent: it may well have
        // gone through, so it's never sent again (no double payment), and the order isn't stuck in "paying" for good.
        if let Some((stuck, due)) = a.paying(id.0) {
            let sent = tries.iter().find(|t| t.order == id.0 && t.due_ns == due).map_or(0, |t| t.last_ns);
            if now >= sent.saturating_add(ORDER_RETRY_NS) {
                a.settle_unconfirmed(stuck);
                tries.retain(|t| !(t.order == id.0 && t.due_ns == due));
                store(ORDER_TRIES_KEY, &tries);
                store(AGENT_KEY, &a);
                event("agent_payment_unconfirmed", stuck);
                return;
            }
        }
        // The earliest date that still has tries left: one that failed three times doesn't hold up the next.
        let failed_out = |due: u64| tries.iter().any(|t| t.order == id.0 && t.due_ns == due && t.failed >= ORDER_MAX_TRIES);
        let dates = a.due(id.0, now);
        require!(dates.is_empty() || dates.iter().any(|(d, _)| !failed_out(*d)), "this payment failed three times; pay it from the app");
        let (due, until) = dates.into_iter().find(|(d, _)| !failed_out(*d)).unwrap_or((u64::MAX, 0));
        if let Some(t) = tries.iter().find(|t| t.order == id.0 && t.due_ns == due) {
            require!(now >= t.last_ns.saturating_add(ORDER_RETRY_NS), "this payment was tried less than an hour ago");
        }
        let payment = a.run_order_at(id.0, due, now).unwrap_or_else(|r| refuse(r));
        match tries.iter_mut().find(|t| t.order == id.0 && t.due_ns == due) {
            Some(t) => t.last_ns = now,
            None => tries.push(OrderTries { order: id.0, due_ns: due, until_ns: until, failed: 0, last_ns: now }),
        }
        store(ORDER_TRIES_KEY, &tries);
        self.agent_dispatch(a, payment);
    }

    /// `spent`: the account's id for this payment's rows in the 24-hour totals; a failed payment's rows go (audit F8).
    /// None from a payment sent by an older release.
    #[private]
    pub fn on_agent_settled(&mut self, id: U64, spent: Option<U64>) {
        let ok = !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed));
        if !ok {
            if let Some(s) = spent {
                self.spent.retain(|row| row.id != s.0);
            }
        }
        if let Some(mut a) = load::<Agent>(AGENT_KEY) {
            if let agent_limits::Settled::OrderPayment { order, due_ns, ok } = a.settle(id.0, ok) {
                let mut tries: Vec<OrderTries> = load(ORDER_TRIES_KEY).unwrap_or_default();
                if ok {
                    tries.retain(|t| !(t.order == order && t.due_ns == due_ns));
                } else if let Some(t) = tries.iter_mut().find(|t| t.order == order && t.due_ns == due_ns) {
                    t.failed += 1;
                }
                store(ORDER_TRIES_KEY, &tries);
            }
            store(AGENT_KEY, &a);
        }
    }

    pub fn agent(&self) -> Option<AgentView> {
        load::<Agent>(AGENT_KEY).map(|a| a.view(env::block_timestamp()))
    }

    // ── Kids: a child's account, its rules set by the parent ─────────────────────────────────────────────────

    /// Who the child may pay alone, and how much a week. Checked now, applied through the strictest level, which on a
    /// child's account is the second device: the parent.
    pub fn kids_set(&mut self, rules: KidsRules) -> Outcome {
        only_this_account();
        self.owner_active();
        let rules = kids::setup(rules).unwrap_or_else(|e| env::panic_str(&e));
        // A child's rules mean something only if the strictest level is the parent's device (audit F13: on a Face ID
        // account the child could switch them off alone).
        require!(self.strictest().needs_device() && !self.second_devices.is_empty(), "pair the parent's device and put it at the top first");
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::KidsSet { rules }, level)
    }

    pub fn kids_off(&mut self) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(load::<KidsState>(KIDS_KEY).is_some(), "no kids rules are set");
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::KidsOff, level)
    }

    pub fn kids(&self) -> Option<KidsStatus> {
        load::<KidsState>(KIDS_KEY).map(|k| k.status(env::block_timestamp()))
    }

    /// Why held requests need the parent: (request id, reason), for the requests the child's rules held.
    pub fn kids_why(&self) -> Vec<(U64, String)> {
        load::<Vec<(u64, String)>>(KIDS_WHY_KEY).unwrap_or_default().into_iter().map(|(i, w)| (U64(i), w)).collect()
    }
}
