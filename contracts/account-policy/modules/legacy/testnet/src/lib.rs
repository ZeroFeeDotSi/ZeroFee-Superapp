//! TEST ONLY: a stand-in for the account contract, so the legacy module can be proven on testnet before Security merges
//! it into contracts/account-policy. Deploy it only to throwaway testnet accounts, never to a user's account.
//!
//! It wires the module the way the account contract will: every guard and every transfer is here, every rule is in
//! the module. `send` stands in for `execute` (the owner spending), and the recovery methods carry only the rules the
//! legacy adds; they don't change any keys.
use legacy::{LegacyConfig, LegacyState, LegacyStatus};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// NEAR kept back from a payout for the account's future fees.
const RESERVE_YOCTO: u128 = 500_000_000_000_000_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Host {
    legacy: Option<LegacyState>,
    recovery_waiting: bool,
}

#[near]
impl Host {
    #[init]
    pub fn new() -> Self {
        only_this_account();
        Self { legacy: None, recovery_waiting: false }
    }

    // ── The owner's own keys (on the real account: device methods, behind Face ID) ───────────────────────────

    pub fn legacy_setup(&mut self, config: LegacyConfig) {
        only_this_account();
        self.legacy = Some(legacy::setup(&env::current_account_id(), config, now()).unwrap_or_else(|e| env::panic_str(&e)));
        event("legacy_set_up", "");
    }

    pub fn check_in(&mut self) {
        only_this_account();
        self.owner_activity();
    }

    /// Stands in for `execute`: the owner spending is a sign of life too.
    pub fn send(&mut self, receiver_id: AccountId, yocto: U128) -> Promise {
        only_this_account();
        self.owner_activity();
        Promise::new(receiver_id).transfer(NearToken::from_yoctonear(yocto.0))
    }

    pub fn cancel_claim(&mut self) {
        only_this_account();
        let claim = self.legacy_mut().cancel_claim(now()).unwrap_or_else(|e| env::panic_str(&e));
        event("claim_stopped", claim.by.as_str());
    }

    pub fn legacy_off(&mut self) {
        only_this_account();
        require!(self.legacy.take().is_some(), "no legacy is set up");
        event("legacy_off", "");
    }

    // ── Recovery: only the rules the legacy adds ─────────────────────────────────────────────────────────────

    pub fn start_recovery(&mut self) {
        only_this_account();
        require!(!self.legacy.as_ref().is_some_and(|l| l.blocks_recovery(now())), "a claim is waiting, so a recovery can't start");
        require!(!self.recovery_waiting, "a recovery is already waiting");
        self.recovery_waiting = true;
        event("recovery_started", "");
    }

    /// The owner, or a named heir once the owner has been silent long enough.
    pub fn cancel_recovery(&mut self) {
        let caller = env::predecessor_account_id();
        if caller == env::current_account_id() {
            self.owner_activity();
        } else {
            require!(self.legacy.as_ref().is_some_and(|l| l.can_cancel_recovery(&caller, now())), "only this account, or an heir after the owner has been silent, can cancel a recovery");
        }
        require!(self.recovery_waiting, "no recovery is waiting");
        self.recovery_waiting = false;
        event("recovery_cancelled", caller.as_str());
    }

    // ── Heirs, from their own accounts ───────────────────────────────────────────────────────────────────────

    pub fn start_claim(&mut self) {
        let caller = env::predecessor_account_id();
        self.legacy_mut().start_claim(&caller, now()).unwrap_or_else(|e| env::panic_str(&e));
        event("claim_started", caller.as_str());
    }

    /// Any heir, after the claim delay: split the spendable NEAR by shares. Returns who got what.
    pub fn distribute(&mut self) -> Vec<(AccountId, U128)> {
        let caller = env::predecessor_account_id();
        let legacy = self.legacy.as_ref().unwrap_or_else(|| env::panic_str("no legacy is set up"));
        require!(legacy.is_heir(&caller), "only someone named in this legacy can pay it out");
        let storage = u128::from(env::storage_usage()) * env::storage_byte_cost().as_yoctonear();
        let spendable = env::account_balance().as_yoctonear().saturating_sub(storage).saturating_sub(RESERVE_YOCTO);
        let plan = legacy.payout_plan(now(), spendable, &[]).unwrap_or_else(|e| env::panic_str(&e));
        let mut paid = vec![];
        for payout in plan {
            Promise::new(payout.receiver_id.clone()).transfer(NearToken::from_yoctonear(payout.near));
            paid.push((payout.receiver_id, U128(payout.near)));
        }
        event("paid_out", caller.as_str());
        paid
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────────────────

    pub fn legacy_status(&self) -> Option<LegacyStatus> {
        self.legacy.as_ref().map(|l| l.status(now()))
    }

    pub fn recovery_waiting(&self) -> bool {
        self.recovery_waiting
    }
}

impl Host {
    fn legacy_mut(&mut self) -> &mut LegacyState {
        self.legacy.as_mut().unwrap_or_else(|| env::panic_str("no legacy is set up"))
    }

    fn owner_activity(&mut self) {
        if let Some(stopped) = self.legacy.as_mut().and_then(|l| l.on_owner_activity(now())) {
            event("claim_stopped", stopped.by.as_str());
        }
    }
}

fn now() -> u64 {
    env::block_timestamp()
}

fn only_this_account() {
    require!(env::predecessor_account_id() == env::current_account_id(), "only this account's own keys can do this");
}

fn event(name: &str, by: &str) {
    env::log_str(&format!(r#"EVENT_JSON:{{"standard":"zerofee_legacy","version":"1.0.0","event":"{name}","data":{{"by":"{by}"}}}}"#));
}
