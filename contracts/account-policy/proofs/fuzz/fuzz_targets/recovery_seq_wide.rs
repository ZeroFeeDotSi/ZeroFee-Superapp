#![no_main]
//! Release 8 (30 Oct), widened for release 9 (1 Nov): the WIDE recovery / approval / spending / upgrade state machine
//! (`fuzz_api::drive_recovery_wide`): three config bytes (delay, second devices and their ages, an unsealed phone list,
//! bands / setup window / backup words / a listed release), then up to 64 operations of four bytes (kind, signer,
//! argument, extra), among them the finish's callback and the FB-3 callback delivered at any later moment. An oracle
//! violation or a non-refusal panic aborts: a finding.
use account_policy_proofs::contract::fuzz_api::drive_recovery_wide;
use libfuzzer_sys::fuzz_target;

fn silent_hook() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| std::panic::set_hook(Box::new(|_| {})));
}

fuzz_target!(|data: &[u8]| {
    silent_hook();
    if data.len() < 3 {
        return;
    }
    let cfg = [data[0], data[1], data[2]];
    let ops: Vec<(u8, u8, u8, u8)> = data[3..].chunks_exact(4).map(|c| (c[0], c[1], c[2], c[3])).collect();
    if let Err(msg) = drive_recovery_wide(cfg, &ops) {
        let _ = std::panic::take_hook();
        panic!("R9 wide state machine: {msg}");
    }
});
