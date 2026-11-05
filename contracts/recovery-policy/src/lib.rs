//! Recovery policy: the rules that make 24 backup words safe to own.
//!
//! The contract runs on the user's own NEAR account. The account holds two kinds of key:
//! - the **device key** (ML-DSA-65, inside the phone's secure chip): a full-access key that can do anything, including
//!   cancelling a recovery;
//! - the **recovery key** (ML-DSA-65, rebuilt from the 24 words): a function-call key that NEAR itself restricts to
//!   `start_recovery` and `finish_recovery` on this account. It can't send money, add keys or cancel.
//!
//! Recovering means: `start_recovery(new phone's key)`, wait `delay`, then `finish_recovery()`, which adds the new
//! phone's key as a full-access key. During the wait the current phone sees the pending recovery and can call
//! `cancel_recovery()`. So stolen words alone can never take the account: the real owner has the whole delay to cancel.
//!
//! Only post-quantum (ML-DSA-65) keys can be added this way, so recovery never brings a classical key back.
use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near, require, PanicOnDefault};

/// NEAR's borsh tag for ML-DSA-65 public keys, followed by 1,952 key bytes.
const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBLIC_KEY_LEN: usize = 1952;
/// The shortest delay the contract accepts at setup (60 s exists for testnet demos; the app uses 7 days).
const MIN_DELAY_NS: u64 = 60 * 1_000_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RecoveryPolicy {
    delay_ns: u64,
    pending: Option<PendingRecovery>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingRecovery {
    /// The new phone's key: borsh-encoded NEAR public key (tag 2 + 1,952 bytes).
    pub new_key: Base64VecU8,
    /// Block time (ns) from which `finish_recovery` may run.
    pub ready_at_ns: U64,
}

#[near]
impl RecoveryPolicy {
    /// Set up the policy. Only the account itself (its device key) can do this.
    #[init]
    pub fn new(delay_seconds: U64) -> Self {
        only_this_account();
        let delay_ns = delay_seconds.0.checked_mul(1_000_000_000).expect("delay too large");
        require!(delay_ns >= MIN_DELAY_NS, "the recovery delay must be at least 60 seconds");
        Self { delay_ns, pending: None }
    }

    /// Start adding a new phone. The new key becomes usable only after the delay, and the current phone can cancel.
    pub fn start_recovery(&mut self, new_key: Base64VecU8) {
        only_this_account();
        require!(self.pending.is_none(), "a recovery is already waiting; cancel it from your phone or finish it");
        require!(is_ml_dsa_65_key(&new_key.0), "the new key must be a post-quantum (ML-DSA-65) public key");
        let ready_at_ns = env::block_timestamp().checked_add(self.delay_ns).expect("time overflow");
        self.pending = Some(PendingRecovery { new_key, ready_at_ns: U64(ready_at_ns) });
        event("recovery_started", ready_at_ns);
    }

    /// After the delay, add the new phone's key as a full-access key.
    pub fn finish_recovery(&mut self) {
        only_this_account();
        let pending = self.pending.take().unwrap_or_else(|| env::panic_str("no recovery is waiting"));
        let now = env::block_timestamp();
        if now < pending.ready_at_ns.0 {
            let left_s = (pending.ready_at_ns.0 - now) / 1_000_000_000;
            env::panic_str(&format!("the recovery can finish in {left_s} seconds"));
        }
        add_full_access_key(&pending.new_key.0);
        event("recovery_finished", now);
    }

    /// Stop a waiting recovery. The recovery key's permissions don't include this method, so only the device can call it.
    pub fn cancel_recovery(&mut self) {
        only_this_account();
        require!(self.pending.take().is_some(), "no recovery is waiting");
        event("recovery_cancelled", env::block_timestamp());
    }

    /// What the phone shows: is a recovery waiting, for which key, and when can it finish?
    pub fn pending(&self) -> Option<PendingRecovery> {
        self.pending.clone()
    }

    pub fn delay_seconds(&self) -> U64 {
        U64(self.delay_ns / 1_000_000_000)
    }
}

/// Every change must come from this account itself, i.e. from one of its own keys. Calls from other accounts are refused.
fn only_this_account() {
    require!(env::predecessor_account_id() == env::current_account_id(), "only this account's own keys can do this");
}

fn is_ml_dsa_65_key(bytes: &[u8]) -> bool {
    bytes.len() == 1 + ML_DSA_65_PUBLIC_KEY_LEN && bytes[0] == ML_DSA_65_TAG
}

/// Add a full-access key to this account. near-sdk's PublicKey type predates ML-DSA-65, so the borsh bytes go straight
/// to the runtime, which validates them.
fn add_full_access_key(borsh_key: &[u8]) {
    let account = env::current_account_id();
    unsafe {
        let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_add_key_with_full_access(promise, borsh_key.len() as u64, borsh_key.as_ptr() as u64, 0);
    }
}

fn event(name: &str, at_ns: u64) {
    env::log_str(&format!(r#"EVENT_JSON:{{"standard":"zerofee_recovery","version":"1.0.0","event":"{name}","data":{{"at_ns":"{at_ns}"}}}}"#));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId};

    const SECOND: u64 = 1_000_000_000;

    fn as_account(caller: &str, now_ns: u64) {
        let me: AccountId = "me.testnet".parse().unwrap();
        let caller: AccountId = caller.parse().unwrap();
        testing_env!(VMContextBuilder::new().current_account_id(me).predecessor_account_id(caller).block_timestamp(now_ns).build());
    }

    fn ml_dsa_key(fill: u8) -> Base64VecU8 {
        let mut k = vec![ML_DSA_65_TAG];
        k.extend(std::iter::repeat(fill).take(ML_DSA_65_PUBLIC_KEY_LEN));
        Base64VecU8(k)
    }

    #[test]
    fn full_flow_waits_then_finishes() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        p.start_recovery(ml_dsa_key(7));
        assert_eq!(p.pending().unwrap().ready_at_ns, U64(60 * SECOND));
        as_account("me.testnet", 60 * SECOND);
        p.finish_recovery();
        assert!(p.pending().is_none());
    }

    #[test]
    #[should_panic(expected = "can finish in")]
    fn finishing_early_is_refused() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        p.start_recovery(ml_dsa_key(7));
        as_account("me.testnet", 59 * SECOND);
        p.finish_recovery();
    }

    #[test]
    fn cancel_clears_the_wait() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        p.start_recovery(ml_dsa_key(7));
        p.cancel_recovery();
        assert!(p.pending().is_none());
    }

    #[test]
    #[should_panic(expected = "only this account's own keys")]
    fn other_accounts_are_refused() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        as_account("attacker.testnet", 0);
        p.start_recovery(ml_dsa_key(7));
    }

    #[test]
    #[should_panic(expected = "post-quantum")]
    fn classical_keys_are_refused() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        let mut ed25519 = vec![0u8];
        ed25519.extend([1u8; 32]);
        p.start_recovery(Base64VecU8(ed25519));
    }

    #[test]
    #[should_panic(expected = "already waiting")]
    fn a_second_start_cannot_reset_the_clock() {
        as_account("me.testnet", 0);
        let mut p = RecoveryPolicy::new(U64(60));
        p.start_recovery(ml_dsa_key(7));
        p.start_recovery(ml_dsa_key(8));
    }

    #[test]
    #[should_panic(expected = "at least 60 seconds")]
    fn tiny_delays_are_refused() {
        as_account("me.testnet", 0);
        RecoveryPolicy::new(U64(5));
    }
}
