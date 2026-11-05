//! Release 10: Agent's own key, with a daily limit. The rules are the agent module's (modules/agent: a budget per coin,
//! rolling 24 hours and 30 days, at most 12 payments in 24 hours, an end date), plus this contract's own:
//!
//! - **Agent pays only what the phone's Face ID alone could pay at that moment.** Each payment is measured by this
//!   contract's own `moves` (the same measure `execute` uses: the coin, any attached NEAR, and the call's gas as NEAR)
//!   and must get the Face ID level from the bands, counting everything the phone and Agent paid in the last 24 hours.
//!   While a recovery waits or spending is frozen nothing gets that level, so Agent pays nothing.
//! - **"A key above the limit is refused":** a budget whose day limits, all coins together, don't fit the Face ID band
//!   (a new one, or a looser one; one that only tightens never is: round 2, G4).
//! - **A new Agent key, or a looser budget, waits a change's wait (the floor)** like any setting, so the backup words can
//!   stop it (the design review's H1: a thief with an unlocked phone must not leave with a key of his own). A budget that
//!   only tightens runs at once, and so does one Agent set up with a new account in its first 24 hours whose budget ends with them
//!   (once per account: the diff review's M-1). The kill switch (`agent_revoke`) deletes the key at once; a finished recovery deletes it
//!   and anything for Agent still waiting.
//! - NEAR restricts Agent's key to one method, `agent_pay`, with a 0.25 NEAR fee allowance (the words' key's), which
//!   counts as NEAR in the 24-hour totals when it is given and at each refill (`agent_renew_key`). Agent's key is refused
//!   by every phone method (`not_agent_key`, in `owner_active`); if NEAR refuses its add, Agent is forgotten.
//! - A listed recipient counts against the coin's day and month limits; anyone else also against its "any address" cap
//!   (the module's convert cap, which the app sets to the whole day limit).
//! - A payment counts in full even if it fails (the design review's M2: its gas burned, and a coin may have moved before
//!   a failing callback), in the 24-hour totals and in Agent's own.
//! - Only on an account whose phone keys are sealed (named at set-up, or after a recovery), so every phone key got this
//!   release's methods at the upgrade (M3).
//! - No standing orders, pause or convert in this release: `agent_set` takes none.
use super::*;
use agent_limits::{payment_plan, Agent, AgentView, Budget, OrderPlan, Payout};

/// Agent's state, under its own storage key (never a field of `AccountPolicy`, whose layout is frozen).
const AGENT_STATE: &[u8] = b"agent";
/// The only method NEAR lets Agent's key call on this account. Never empty: NEAR reads an empty list as every method.
pub const AGENT_KEY_METHODS: &str = "agent_pay";
/// Agent's key's fee allowance: 0.25 NEAR, as the words' key (the design review's L1). From NEAR protocol 85 an allowance
/// is charged at max(gas price, 1,000,000,000) a gas, so this key can attach at most about 240 Tgas to one call.
pub const AGENT_KEY_ALLOWANCE: u128 = 250_000_000_000_000_000_000_000;
/// Gas kept for `on_agent_settled` and `on_agent_key`. Release 10 (round 2): 20 Tgas, up from 10: a callback's own fee
/// is about 14 Tgas (measured), with the state to load and save on top. Round 4c (the audit's ruling): 40 Tgas, as
/// DEVICE_KEY_CHECK_GAS: a failure branch at the largest state (about 209 KB) needs about 23.
pub(crate) const AGENT_CALLBACK_GAS: u64 = 40_000_000_000_000;

fn load_agent() -> Option<Agent> {
    env::storage_read(AGENT_STATE).map(|b| borsh::from_slice::<Agent>(&b).unwrap_or_else(|_| env::panic_str("Agent's rules are unreadable")))
}

fn store_agent(a: &Agent) {
    env::storage_write(AGENT_STATE, &borsh::to_vec(a).unwrap_or_else(|_| env::panic_str("Agent's rules can't be stored")));
}

fn refuse(r: agent_limits::Refusal) -> ! {
    env::panic_str(&r.message())
}

/// Is `key` Agent's key? (A key never takes a second role, audit F15.)
pub(crate) fn agent_key_is(key: &[u8]) -> bool {
    load_agent().is_some_and(|a| a.key() == key)
}

/// Every phone method refuses Agent's key, even if NEAR's method list were ever wrong.
pub(crate) fn not_agent_key() {
    if let Some(a) = load_agent() {
        require!(signer_key() != a.key(), "Agent's key can't do this");
    }
}

/// For `read_all_state`: Agent's state decodes, and holds no standing orders (an older release's; this one can't run
/// them, so an account with any stays on the release it has).
pub(crate) fn read_agent_state() {
    if let Some(a) = load_agent() {
        require!(a.view(env::block_timestamp()).orders.is_empty(), "this account has Agent's standing orders, which this release doesn't have");
    }
    let _: Option<Vec<u64>> = load_key(AGENT_BUDGET_STRICT);
}

/// A new budget that loosens nothing: every coin already in the current budget with no higher limits, every recipient
/// already listed, no later end, no more payments a day. Such a change runs at once.
pub(crate) fn tightens(new: &Budget) -> bool {
    let Some(a) = load_agent() else { return false };
    let old = a.view(env::block_timestamp()).budget;
    new.coins.iter().all(|c| old.coins.iter().any(|o| o.coin == c.coin && c.per_day.0 <= o.per_day.0 && c.per_month.0 <= o.per_month.0 && c.convert_per_day.0 <= o.convert_per_day.0))
        && new.recipients.iter().all(|r| old.recipients.contains(r))
        && new.ends_at_ns.0 <= old.ends_at_ns.0
        && new.max_spends_per_day <= old.max_spends_per_day
}

fn convert_step(s: agent_limits::Step) -> Step {
    match s {
        agent_limits::Step::Transfer { deposit } => Step::Transfer { deposit },
        agent_limits::Step::FunctionCall { method_name, args, deposit, gas } => Step::FunctionCall { method_name, args, deposit, gas },
    }
}

/// Release 10 (the 4 Nov proofing, A2): the waiting budget changes asked at the strictest band (by id). Any other one
/// (not co-signed) runs only if it still tightens when it runs. At most one per waiting request (MAX_PENDING).
const AGENT_BUDGET_STRICT: &[u8] = b"agent_budget_strict";

/// Was budget change `id` asked at the strictest band? Its record goes either way.
fn take_strict(id: u64) -> bool {
    let mut ids: Vec<u64> = load_key(AGENT_BUDGET_STRICT).unwrap_or_default();
    let before = ids.len();
    ids.retain(|i| *i != id);
    if ids.len() == before {
        return false;
    }
    store_key(AGENT_BUDGET_STRICT, &ids);
    true
}

/// A budget change dropped (cancelled, declined, stopped): its record goes.
pub(crate) fn forget_strict(id: u64) {
    let _ = take_strict(id);
}

/// Set once any Agent has been set up on this account: the first-day Agent that skips the floor is one per account.
const AGENT_ONCE: &[u8] = b"agent_once";
/// The most gas one Agent payment carries (the module's NEAR Intents transfer), counted as NEAR like any call's.
const AGENT_STEP_GAS: u128 = 20_000_000_000_000;

/// The one Agent a new account may set up at once (the diff review's M-1): no Agent ever set up here before, and a
/// budget that ends with the account's first 24 hours. Anything else waits the floor.
pub(crate) fn first_day_trial(budget: &Budget, created_at_ns: Option<u64>) -> bool {
    let Some(created) = created_at_ns else { return false };
    !env::storage_has_key(AGENT_ONCE) && budget.ends_at_ns.0 <= created.saturating_add(DAY_NS)
}

/// A budget's day limits, all its coins together, as one 24 hours of payments, with the NEAR that day really takes:
/// the key's fee allowance and each payment's gas at the price the bands count it (the diff review's L-2).
fn day_moves(budget: &Budget) -> Vec<(String, u128)> {
    let mut out = vec![];
    for c in &budget.coins {
        add_move(&mut out, &c.coin, c.per_day.0);
    }
    let gas = u128::from(budget.max_spends_per_day).saturating_mul(AGENT_STEP_GAS).saturating_mul(GAS_PRICE_COUNTED);
    add_move(&mut out, "near", AGENT_KEY_ALLOWANCE.saturating_add(gas));
    out
}

/// After Agent's key's add: `on_agent_key` with its result.
fn then_check_agent_key(promise: u64, borsh_key: &[u8]) {
    let account = env::current_account_id();
    let args = serde_json::to_vec(&serde_json::json!({ "public_key": Base64VecU8(borsh_key.to_vec()) })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
    let method = "on_agent_key";
    let zero = 0u128.to_le_bytes();
    unsafe {
        let cb = near_sys::promise_batch_then(promise, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_function_call_weight(cb, method.len() as u64, method.as_ptr() as u64, args.len() as u64, args.as_ptr() as u64, zero.as_ptr() as u64, AGENT_CALLBACK_GAS, 1);
    }
}

impl AccountPolicy {
    /// The one first-day Agent (`first_day_trial`, in the set-up window) that goes at Face ID with no floor. Release 10
    /// (the 4 Nov proofing, round 2, L2/A-I1): only if Face ID alone could pay its key's fee allowance now, counted with
    /// everything of the last 24 hours. Its allowance counts at once, and the phone could have paid the whole band first.
    pub(crate) fn first_day_agent(&self, budget: &Budget) -> bool {
        self.in_setup_window() && first_day_trial(budget, load_devices().created_at_ns) && self.level_for_moves(&[("near".to_string(), AGENT_KEY_ALLOWANCE)]) == Level::FaceId
    }

    /// "A key above the limit is refused": the budget's day limits, all coins together, must get the Face ID level from
    /// the bands on their own (nothing else spent), as one payment would. Checked when asked and again when it runs.
    fn check_agent_budget(&self, budget: &Budget) {
        let moves = day_moves(budget);
        let fits = self.bands.iter().find(|b| match &b.up_to {
            None => true,
            Some(limits) => {
                moves.iter().filter(|(_, a)| *a > 0).all(|(coin, _)| limits.iter().any(|(c, _)| c == coin))
                    && limits
                        .iter()
                        .try_fold(0u128, |used, (c, limit)| {
                            let total = moves.iter().find(|(m, _)| m == c).map_or(0, |(_, a)| *a);
                            share_ppm(total, limit.0).and_then(|s| used.checked_add(s))
                        })
                        .is_some_and(|used| used <= PPM)
            }
        });
        require!(fits.is_some_and(|b| b.level == Level::FaceId), "agent.limit.bands: Agent's day limit must fit what your Face ID alone allows in a day");
    }

    /// The fee allowance Agent's key gets counts as NEAR in the 24-hour totals (the design review's L1).
    fn count_allowance(&mut self) {
        let id = self.take_id();
        self.count_today(id, vec![("near".to_string(), AGENT_KEY_ALLOWANCE)]);
    }

    /// Spending is frozen: a recovery waits, or a stop of one froze it (`unless_frozen`).
    fn spending_frozen(&self) -> bool {
        self.recovery.is_some() || env::block_timestamp() < load_key::<u64>(FREEZE_KEY).unwrap_or(0)
    }

    /// Carry out an Agent change once it may run. `co_signed`: asked by the phone and a second device of age together.
    pub(crate) fn finish_agent_change(&mut self, change: Change, id: u64, co_signed: bool) {
        let now = env::block_timestamp();
        let me = env::current_account_id();
        match change {
            Change::AgentSet { public_key, budget, orders } => {
                // Checked again when it runs (audit F9, F15): two may have waited together, or the bands changed.
                require!(load_agent().is_none(), "remove the current Agent first");
                require!(orders.is_empty(), "this release has no standing orders");
                require!(!self.key_in_use(&public_key.0), "that key is already on this account");
                require!(load_devices().sealed, "Agent needs an account whose phone keys are sealed");
                self.check_agent_budget(&budget);
                let a = Agent::new(&signer_key(), public_key.0.clone(), budget, vec![], now, &me).unwrap_or_else(|r| refuse(r));
                let p = add_function_call_key(&public_key.0, AGENT_KEY_METHODS, AGENT_KEY_ALLOWANCE);
                then_check_agent_key(p, &public_key.0);
                store_agent(&a);
                env::storage_write(AGENT_ONCE, &[1]);
                self.count_allowance();
                event("agent_set", 0);
            }
            Change::AgentSetBudget { budget } => {
                let mut a = load_agent().unwrap_or_else(|| env::panic_str("no Agent is set up"));
                // Release 10 (A2): one not asked at the strictest band and not co-signed was a tightening when asked; it
                // runs only if it still is one (a tighter budget may have been set meanwhile).
                let strict = take_strict(id);
                let tight = tightens(&budget);
                require!(co_signed || strict || tight, "agent.budget.loosens: this change now loosens Agent's budget, so it must be asked again");
                // Round 2 (G4): a tightening, as it stands now, is never held to the bands; anything looser is.
                if !tight {
                    self.check_agent_budget(&budget);
                }
                a.set_budget(&signer_key(), budget, now, &me).unwrap_or_else(|r| refuse(r));
                store_agent(&a);
                event("agent_budget_set", 0);
            }
            _ => env::panic_str("not an Agent change"),
        }
    }

    /// A finished recovery: Agent's key goes with the old phone, its rules with it, and anything for Agent still waiting.
    pub(crate) fn agent_revoke_on_recovery(&mut self) {
        if let Some(a) = load_agent() {
            delete_key(a.key());
            env::storage_remove(AGENT_STATE);
            event("agent_revoked_by_recovery", 0);
        }
        let waiting: Vec<u64> = self.pending.iter().filter(|p| matches!(p.change, Change::AgentSet { .. } | Change::AgentSetBudget { .. })).map(|p| p.id.0).collect();
        for id in waiting {
            self.drop_pending(id, "request_stopped_by_recovery");
        }
    }
}

#[near]
impl AccountPolicy {
    // ── Agent: the phone ─────────────────────────────────────────────────────────────────────────────────────────

    /// Give Agent its own key and a budget: a key change, so at the strictest band (a second device's yes where the last
    /// band needs one) and after a change's wait (the floor), and frozen spending waits out too. Only a new account's one
    /// first-day Agent (`first_day_agent`: round 2, L2, only while Face ID alone could pay its key's allowance) keeps the
    /// Face ID level. `orders` is kept for the app's older calls and must be empty.
    pub fn agent_set(&mut self, public_key: Base64VecU8, budget: Budget, orders: Option<Vec<OrderPlan>>) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(load_agent().is_none(), "remove the current Agent first");
        require!(orders.as_ref().is_none_or(|o| o.is_empty()), "this release has no standing orders");
        require!(!self.key_in_use(&public_key.0), "that key is already on this account");
        require!(load_devices().sealed, "Agent needs an account whose phone keys are sealed");
        self.check_agent_budget(&budget);
        Agent::new(&signer_key(), public_key.0.clone(), budget.clone(), vec![], env::block_timestamp(), &env::current_account_id()).unwrap_or_else(|r| refuse(r));
        let id = self.take_id();
        // The 4 Nov audit (finding 6): at Face ID, an account whose key changes need the laptop got an Agent key (paying
        // anyone up to the Face ID band each day, for up to two years) without it.
        let level = if self.first_day_agent(&budget) { Level::FaceId } else { self.strictest() };
        let level = self.unless_frozen(level);
        self.place(id, Change::AgentSet { public_key, budget, orders: vec![] }, level)
    }

    /// A new budget for Agent (its spends of the last 30 days still count): at once if it only tightens and nothing is
    /// frozen, else as `agent_set`, at the strictest band (the 4 Nov audit, finding 6: a looser budget is as much as a new
    /// key; the 4 Nov proofing, A2: a tightening asked while frozen too).
    pub fn agent_set_budget(&mut self, budget: Budget) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(load_agent().is_some(), "no Agent is set up");
        // Release 10 (the 4 Nov proofing, round 2, G4): a budget that only tightens is never held to the bands. Once the
        // owner had shrunk the Face ID band under Agent's fixed NEAR (its key's allowance and its payments' gas), every
        // change was refused, a tightening to 1 yocto a day too, and only the kill switch was left. Each payment is still
        // held to the Face ID level when it is paid (`agent_pay`).
        let tight = tightens(&budget);
        if !tight {
            self.check_agent_budget(&budget);
        }
        let id = self.take_id();
        // Release 10 (the 4 Nov proofing, A2): a tightening runs at once, so only when nothing is frozen. Frozen, it would
        // wait the floor phone-only and could run later as a loosening of a tighter budget set meanwhile: asked then at
        // the strictest band, as a loosening is.
        let level = if tight && !self.spending_frozen() { Level::FaceId } else { self.strictest() };
        let level = self.unless_frozen(level);
        let strict = level.covers(&self.strictest());
        let out = self.place(id, Change::AgentSetBudget { budget }, level);
        if !out.done && strict {
            let mut ids: Vec<u64> = load_key(AGENT_BUDGET_STRICT).unwrap_or_default();
            ids.push(id);
            store_key(AGENT_BUDGET_STRICT, &ids);
        }
        out
    }

    /// The kill switch: Agent's key is deleted and its rules forgotten, at once. Anything for Agent still waiting goes
    /// with it, so nothing brings Agent back unasked (audit F9). A payment already sent still reports back.
    pub fn agent_revoke(&mut self) {
        only_this_account();
        self.owner_active();
        let a = load_agent();
        let waiting: Vec<u64> = self.pending.iter().filter(|p| matches!(p.change, Change::AgentSet { .. } | Change::AgentSetBudget { .. })).map(|p| p.id.0).collect();
        require!(a.is_some() || !waiting.is_empty(), "no Agent is set up");
        if let Some(a) = a {
            delete_key(a.key());
            env::storage_remove(AGENT_STATE);
        }
        for id in waiting {
            self.drop_pending(id, "request_cancelled");
        }
        event("agent_revoked", 0);
    }

    /// Refill Agent's key's fee allowance: the same key, the same one method, nothing else changes. At once, and only when
    /// the phone's Face ID alone could pay that NEAR now: the allowance can be burned, so it is a payment (the 4 Nov audit,
    /// finding 16: renewals ran while a recovery waited and past the Face ID band, and could fill the 24-hour list). It
    /// counts as NEAR in the 24-hour totals. Release 10 (round 3, FB3-2/X3-3): never while a laptop's no pauses the Face ID
    /// band (`not_paused`, first): the refill is a Face ID payment like any other.
    pub fn agent_renew_key(&mut self) {
        only_this_account();
        self.owner_active();
        self.not_paused();
        let level = self.unless_frozen(self.level_for_moves(&[("near".to_string(), AGENT_KEY_ALLOWANCE)]));
        require!(level == Level::FaceId, "agent.renew.level: Agent's key is renewed only when your Face ID alone could pay its fee allowance now, never while a move to a new phone waits or spending is frozen");
        let a = load_agent().unwrap_or_else(|| env::panic_str("no Agent is set up"));
        let key = a.renew_key(&signer_key()).unwrap_or_else(|r| refuse(r)).to_vec();
        self.count_allowance();
        renew_function_call_key(&key, AGENT_KEY_METHODS, AGENT_KEY_ALLOWANCE);
        event("agent_key_renewed", 0);
    }

    /// NEAR refused Agent's key (a low balance, or a key already on the account in another role on NEAR's side): Agent
    /// is forgotten, so it never holds a phone key's place (the design review's M4). Nothing to do when the add ran.
    /// Release 10 (the 4 Nov proofing, A3): anything for Agent still waiting goes with it, as at the kill switch: a budget
    /// asked for this Agent would otherwise run on the next one (another key, set up with its own budget).
    #[private]
    pub fn on_agent_key(public_key: Base64VecU8) {
        if !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed)) {
            return;
        }
        if load_agent().is_some_and(|a| a.key() == public_key.0.as_slice()) {
            env::storage_remove(AGENT_STATE);
            let mut this: AccountPolicy = env::state_read().unwrap_or_else(|| env::panic_str("account state is missing"));
            let waiting: Vec<u64> = this.pending.iter().filter(|p| matches!(p.change, Change::AgentSet { .. } | Change::AgentSetBudget { .. })).map(|p| p.id.0).collect();
            for id in &waiting {
                this.drop_pending(*id, "request_cancelled");
            }
            if !waiting.is_empty() {
                env::state_write(&this);
            }
            event("agent_key_not_added", 0);
        }
    }

    // ── Agent: its own key ───────────────────────────────────────────────────────────────────────────────────────

    /// Pay from Agent's budget: a listed recipient within the coin's day and month limits, anyone else within its
    /// "any address" cap too; and only if the phone's Face ID alone could pay the same now.
    pub fn agent_pay(&mut self, payout: Payout, to: AccountId, amount: U128) {
        only_this_account();
        // Release 10 (round 2, the laptop veto): a second device's no pauses the Face ID band, Agent's payments too.
        self.not_paused();
        let mut a = load_agent().unwrap_or_else(|| env::panic_str("no Agent is set up"));
        let (now, me, signer) = (env::block_timestamp(), env::current_account_id(), signer_key());
        let listed = a.view(now).budget.recipients.contains(&to);
        let payment = if listed { a.pay(&signer, payout, to, amount.0, now, &me) } else { a.convert(&signer, payout, to, amount.0, now, &me) }.unwrap_or_else(|r| refuse(r));
        let plan = payment_plan(&payment);
        require!(plan.receiver_id != me, "this account's own rules change only through their own methods");
        let steps: Vec<Step> = plan.steps.into_iter().map(convert_step).collect();
        check_steps(&steps);
        // Measured as the phone's own payment would be, and held to the Face ID level with everything of the last 24 h.
        let moves = moves(plan.receiver_id.as_str(), &steps).unwrap_or_else(|| env::panic_str("agent.limit.bands: this payment can't be measured"));
        require!(self.unless_frozen(self.level_for_moves(&moves)) == Level::FaceId, "agent.limit.bands: this is more than your Face ID alone allows right now");
        // Its own id from this account's sequence for its rows in the 24-hour totals (the design review's M1).
        let id = self.take_id();
        self.count_today(id, moves);
        store_agent(&a);
        let _ = group_promise(Group { receiver_id: plan.receiver_id, steps })
            .then(AccountPolicy::ext(me).with_static_gas(Gas::from_gas(AGENT_CALLBACK_GAS)).with_unused_gas_weight(1).on_agent_settled(U64(id)));
        event("agent_paid", id);
    }

    /// A payment's result, for the app's Activity: it still counts either way (the design review's M2).
    #[private]
    pub fn on_agent_settled(id: U64) {
        if matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed)) {
            event("agent_payment_failed", id.0);
        }
    }

    /// Agent's rules and what it spent (per coin, the last 24 hours and 30 days), or None.
    pub fn agent(&self) -> Option<AgentView> {
        load_agent().map(|a| a.view(env::block_timestamp()))
    }
}
