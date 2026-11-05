//! A small contract around the agent limits, to prove them on testnet before S1 merges them into the account contract.
//! The account it runs on keeps a full-access device key; the agent key it adds is restricted by NEAR to
//! `AGENT_METHODS`. As in the merge, the agent's state lives under its own storage key, and promises are built here,
//! from the module's `payment_plan`. Build: `cargo near build non-reproducible-wasm --features harness`.
use crate::*;
use near_sdk::borsh::BorshDeserialize;
use near_sdk::{env, require, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// The agent's own storage key, apart from the contract's state.
const AGENT_STATE: &[u8] = b"agent";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Harness {}

#[near]
impl Harness {
    #[init]
    pub fn new() -> Self {
        only_this_account();
        Self {}
    }

    // ── The agent key (NEAR restricts it to these three) ───────────────────────────────────────────────────────────

    pub fn agent_pay(&mut self, payout: Payout, to: AccountId, amount: U128) -> U64 {
        only_this_account();
        let (now, me) = (env::block_timestamp(), env::current_account_id());
        send(with_agent(|a| a.pay(&signer_key(), payout, to, amount.0, now, &me)))
    }

    pub fn agent_convert(&mut self, payout: Payout, to: AccountId, amount: U128) -> U64 {
        only_this_account();
        let (now, me) = (env::block_timestamp(), env::current_account_id());
        send(with_agent(|a| a.convert(&signer_key(), payout, to, amount.0, now, &me)))
    }

    /// Anyone may call this: it pays only a standing order's approved, due date.
    pub fn run_order(&mut self, id: U64) -> U64 {
        send(with_agent(|a| a.run_order(id.0, env::block_timestamp())))
    }

    #[private]
    pub fn on_agent_paid(&mut self, id: U64) {
        // Only a failed payment counts as failed; a long return value still means it happened.
        let ok = !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed));
        if let Some(mut agent) = load() {
            agent.settle(id.0, ok);
            save(Some(&agent));
        }
        env::log_str(&format!(r#"EVENT_JSON:{{"standard":"zerofee_agent","version":"1.0.0","event":"agent_paid","data":{{"id":"{}","ok":{ok}}}}}"#, id.0));
    }

    // ── The device ─────────────────────────────────────────────────────────────────────────────────────────────

    pub fn agent_set(&mut self, public_key: Base64VecU8, budget: Budget, orders: Vec<OrderPlan>) {
        only_this_account();
        require!(load().is_none(), "agent.rules.invalid: revoke the current agent first");
        let agent = refuse(Agent::new(&signer_key(), public_key.0, budget, orders, env::block_timestamp(), &env::current_account_id()));
        add_function_call_key(agent.key(), AGENT_METHODS, AGENT_KEY_ALLOWANCE);
        save(Some(&agent));
    }

    pub fn agent_set_budget(&mut self, budget: Budget) {
        only_this_account();
        let (now, me) = (env::block_timestamp(), env::current_account_id());
        with_agent(|a| a.set_budget(&signer_key(), budget, now, &me));
    }

    pub fn agent_add_order(&mut self, plan: OrderPlan) -> U64 {
        only_this_account();
        let (now, me) = (env::block_timestamp(), env::current_account_id());
        U64(with_agent(|a| a.add_order(&signer_key(), plan, now, &me)))
    }

    pub fn agent_remove_order(&mut self, id: U64) {
        only_this_account();
        with_agent(|a| a.remove_order(id.0));
    }

    pub fn agent_pause(&mut self) {
        only_this_account();
        with_agent(|a| {
            a.pause();
            Ok(())
        });
    }

    pub fn agent_resume(&mut self) {
        only_this_account();
        with_agent(|a| a.resume(&signer_key()));
    }

    /// Re-add the same agent key, with the same methods, and a fresh fee allowance. Nothing else changes.
    pub fn agent_renew_key(&mut self) {
        only_this_account();
        let agent = load().unwrap_or_else(|| env::panic_str("agent.rules.invalid: there's no agent"));
        let key = refuse(agent.renew_key(&signer_key())).to_vec();
        let account = env::current_account_id();
        let allowance = AGENT_KEY_ALLOWANCE.to_le_bytes();
        // One batch: delete, then add the same key back (adding a key that exists is refused).
        unsafe {
            let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
            near_sys::promise_batch_action_delete_key(promise, key.len() as u64, key.as_ptr() as u64);
            near_sys::promise_batch_action_add_key_with_function_call(
                promise,
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
    }

    /// Delete the agent key and forget every rule. NEAR then refuses anything the old key signs.
    pub fn agent_revoke(&mut self) {
        only_this_account();
        let agent = load().unwrap_or_else(|| env::panic_str("agent.rules.invalid: there's no agent"));
        require!(signer_key() != agent.key(), "agent.key.cannot-change-rules: Agent's key can't change Agent's rules");
        delete_key(agent.key());
        save(None);
    }

    pub fn agent(&self) -> Option<AgentView> {
        load().map(|a| a.view(env::block_timestamp()))
    }
}

fn load() -> Option<Agent> {
    env::storage_read(AGENT_STATE).map(|bytes| Agent::try_from_slice(&bytes).unwrap_or_else(|_| env::panic_str("agent state unreadable")))
}

fn save(agent: Option<&Agent>) {
    match agent {
        Some(a) => {
            env::storage_write(AGENT_STATE, &near_sdk::borsh::to_vec(a).unwrap());
        }
        None => {
            env::storage_remove(AGENT_STATE);
        }
    }
}

/// Load the agent, apply a change, and save it only if the change was allowed (a refusal panics, so nothing is kept).
fn with_agent<T>(f: impl FnOnce(&mut Agent) -> Result<T, Refusal>) -> T {
    let mut agent = load().unwrap_or_else(|| env::panic_str("agent.rules.invalid: there's no agent"));
    let out = refuse(f(&mut agent));
    save(Some(&agent));
    out
}

fn refuse<T>(r: Result<T, Refusal>) -> T {
    r.unwrap_or_else(|why| env::panic_str(&why.message()))
}

/// Make the payment from its plan (as the account contract's `finish` does), then report back to `on_agent_paid`.
fn send(p: Payment) -> U64 {
    let plan = payment_plan(&p);
    let mut promise = Promise::new(plan.receiver_id);
    for step in plan.steps {
        promise = match step {
            Step::Transfer { deposit } => promise.transfer(NearToken::from_yoctonear(deposit.0)),
            Step::FunctionCall { method_name, args, deposit, gas } => promise.function_call(method_name, args.0, NearToken::from_yoctonear(deposit.0), Gas::from_gas(gas.0)),
        };
    }
    let callback = Promise::new(env::current_account_id()).function_call("on_agent_paid", json!({ "id": p.id }).to_string().into_bytes(), NearToken::from_yoctonear(0), CALLBACK_GAS);
    let _ = promise.then(callback);
    p.id
}

fn only_this_account() {
    require!(env::predecessor_account_id() == env::current_account_id(), "only this account's own keys can do this");
}

/// The borsh bytes of the key that signed this transaction (near-sdk's PublicKey type predates ML-DSA-65).
fn signer_key() -> Vec<u8> {
    const REGISTER: u64 = u64::MAX - 1;
    unsafe {
        near_sys::signer_account_pk(REGISTER);
        let len = near_sys::register_len(REGISTER) as usize;
        let mut bytes = vec![0u8; len];
        near_sys::read_register(REGISTER, bytes.as_mut_ptr() as u64);
        bytes
    }
}

/// Add a key that NEAR restricts to `methods` on this account, with a fee allowance.
fn add_function_call_key(borsh_key: &[u8], methods: &str, allowance: u128) {
    let account = env::current_account_id();
    let allowance = allowance.to_le_bytes();
    unsafe {
        let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_add_key_with_function_call(
            promise,
            borsh_key.len() as u64,
            borsh_key.as_ptr() as u64,
            0,
            allowance.as_ptr() as u64,
            account.as_bytes().len() as u64,
            account.as_bytes().as_ptr() as u64,
            methods.len() as u64,
            methods.as_ptr() as u64,
        );
    }
}

fn delete_key(borsh_key: &[u8]) {
    let account = env::current_account_id();
    unsafe {
        let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_delete_key(promise, borsh_key.len() as u64, borsh_key.as_ptr() as u64);
    }
}
