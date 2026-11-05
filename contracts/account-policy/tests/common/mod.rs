//! Release 9 (R8-RS1): a recovery finishes in two receipts, `finish_recovery`'s add of the new phone's key and then
//! `on_recovery_key`, the callback that sees the add's result. `finish_ok` runs both, as NEAR does when the add succeeds,
//! at the same moment and with the same signer as the test's own context, so a test written for one call reads the same.
#![allow(dead_code)]
use account_policy::AccountPolicy;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::json_types::U64;
use near_sdk::{env, testing_env, PromiseResult};

/// The test's current context, rebuilt (testing_env! replaces it, so this keeps its account, signer, time and balance).
pub fn same_context() -> near_sdk::VMContext {
    let mut b = VMContextBuilder::new();
    b.current_account_id(env::current_account_id())
        .predecessor_account_id(env::predecessor_account_id())
        .signer_account_id(env::signer_account_id())
        .signer_account_pk(env::signer_account_pk())
        .block_timestamp(env::block_timestamp())
        .account_balance(env::account_balance());
    b.build()
}

/// `finish_recovery`, then its callback with `result` (the add's), and the state the callback left.
/// Returns the receipts `finish_recovery` itself made (the add and its callback); the callback's are the context's after.
pub fn finish_with(p: &mut AccountPolicy, result: PromiseResult) -> Vec<near_sdk::mock::Receipt> {
    let r = p.pending().expect("no recovery is waiting");
    let at = env::block_timestamp();
    p.finish_recovery();
    let made = near_sdk::test_utils::get_created_receipts();
    let ctx = same_context();
    env::state_write(&*p);
    testing_env!(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![result]);
    AccountPolicy::on_recovery_key(r.new_key, r.ready_at_ns, U64(at));
    *p = env::state_read().expect("the callback leaves the state");
    made
}

/// A finish whose add succeeded (what NEAR does with enough balance for the new key).
pub fn finish_ok(p: &mut AccountPolicy) -> Vec<near_sdk::mock::Receipt> {
    finish_with(p, PromiseResult::Successful(vec![]))
}
