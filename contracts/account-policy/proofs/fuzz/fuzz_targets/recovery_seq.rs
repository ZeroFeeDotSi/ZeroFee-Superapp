#![no_main]
//! Release 7 completion (30 Oct): the recovery and approval state machine as a sequence of up to 64 calls from
//! arbitrary signers at arbitrary moments (`fuzz_api::drive_recovery_sequence`). An oracle violation or a non-refusal
//! panic aborts: a finding.
use account_policy_proofs::contract::fuzz_api::drive_recovery_sequence;
use libfuzzer_sys::fuzz_target;

fn silent_hook() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| std::panic::set_hook(Box::new(|_| {})));
}

fuzz_target!(|data: &[u8]| {
    silent_hook();
    let Some((&delay, rest)) = data.split_first() else { return };
    let ops: Vec<(u8, u8, u8)> = rest.chunks_exact(3).map(|c| (c[0], c[1], c[2])).collect();
    if let Err(msg) = drive_recovery_sequence(delay, &ops) {
        let _ = std::panic::take_hook();
        panic!("R7 state machine: {msg}");
    }
});
