//! intents.near's reads as mainnet answers them for an account that holds nothing there: no coins (mt_tokens_for_owner,
//! mt_batch_balance_of: empty lists), a zero balance (mt_balance_of), no salt (current_salt: null). For the local
//! sandbox's release-4 rehearsal only (tools/mainnet/v4-rehearse.sh); never deployed anywhere else.
use near_sys as sys;

fn answer(json: &str) {
    unsafe { sys::value_return(json.len() as u64, json.as_ptr() as u64) }
}

#[no_mangle]
pub extern "C" fn mt_tokens_for_owner() {
    answer("[]")
}

#[no_mangle]
pub extern "C" fn mt_batch_balance_of() {
    answer("[]")
}

#[no_mangle]
pub extern "C" fn mt_balance_of() {
    answer("\"0\"")
}

#[no_mangle]
pub extern "C" fn current_salt() {
    answer("null")
}
