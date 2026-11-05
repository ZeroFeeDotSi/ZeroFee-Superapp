#![no_main]
//! One libFuzzer target multiplexing three sub-targets on the first byte (one prover process at a time):
//! 0: `moves` on arbitrary receiver, method names, JSON args, deposits and gas;
//! 1: `check_steps` on arbitrary steps;
//! 2: borsh decode of every stored cell type from arbitrary bytes, and AccountPolicy round-trip.
//! A panic anywhere is a crash (a finding). `moves`/`check_steps` call no host function.
//! Release 8: RS-2 in 0 (also on steps shaped into well-formed standard coin calls), and 5: `execute` (RS-1, 250 Tgas).
use account_policy_proofs::contract::fuzz_api::*;
use account_policy_proofs::contract::Step;
use arbitrary::{Arbitrary, Unstructured};
use libfuzzer_sys::fuzz_target;
use near_sdk::json_types::{Base64VecU8, U128, U64};

#[derive(Arbitrary, Debug)]
struct FStep {
    call: bool,
    method: String,
    args: Vec<u8>,
    deposit: u128,
    gas: u64,
}

#[derive(Arbitrary, Debug)]
struct Input {
    receiver_kind: u8,
    receiver: String,
    steps: Vec<FStep>,
}

fn steps_of(v: &[FStep]) -> Vec<Step> {
    v.iter()
        .map(|s| if s.call { Step::FunctionCall { method_name: s.method.clone(), args: Base64VecU8(s.args.clone()), deposit: U128(s.deposit), gas: U64(s.gas) } } else { Step::Transfer { deposit: U128(s.deposit) } })
        .collect()
}

/// libfuzzer-sys aborts the process from its panic hook; a refusal by `check_steps` is a NEAR panic through the mock,
/// so those are caught here under a silent hook. An uncaught panic still ends in libfuzzer-sys's own catch_unwind and
/// aborts: a crash, a finding.
fn silent_hook() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| std::panic::set_hook(Box::new(|_| {})));
}

fuzz_target!(|data: &[u8]| {
    silent_hook();
    if data.is_empty() {
        return;
    }
    let (sel, rest) = data.split_first().unwrap();
    match sel % 6 {
        5 => {
            // Release 8 (RS-1): `execute` with arbitrary steps is accepted exactly when check_steps' rules hold AND the
            // steps' gas, added saturating, is at most 250 Tgas (literals, not the contract's constants).
            let mut u = Unstructured::new(rest);
            if let Ok((pick, v)) = <(u8, Vec<FStep>)>::arbitrary(&mut u) {
                let steps = steps_of(&v);
                let rules = !steps.is_empty() && steps.len() <= 10 && steps.iter().all(|s| match s { Step::FunctionCall { method_name, args, gas, .. } => !method_name.is_empty() && method_name.len() <= 256 && args.0.len() <= 4096 && !["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"].contains(&method_name.as_str()) && gas.0 <= 300_000_000_000_000, _ => true });
                let total = steps.iter().map(|s| match s { Step::FunctionCall { gas, .. } => gas.0, _ => 0 }).fold(0u64, u64::saturating_add);
                // A request moving more than 128 coins' rows can't be counted: never reached with at most 10 steps.
                let want = rules && total <= 250_000_000_000_000;
                match drive_execute(pick, steps) {
                    Ok(got) => {
                        if got != want {
                            // The silent hook would swallow the message: restore the default one first.
                            let _ = std::panic::take_hook();
                            panic!("RS-1: execute verdict differs from the rules: accepted {got}, total gas {total}");
                        }
                    }
                    Err(msg) => panic!("execute crashed: {msg}"),
                }
            }
        }
        0 => {
            let mut u = Unstructured::new(rest);
            if let Ok(inp) = Input::arbitrary(&mut u) {
                let receiver = match inp.receiver_kind % 3 {
                    0 => "intents.near".to_string(),
                    1 => "bob.near".to_string(),
                    _ => inp.receiver.clone(),
                };
                // Release 8: the raw steps, and the same steps made MEASURABLE (the first args byte odd: a standard coin
                // method with well-formed JSON, the deposit as its amount), so the RS-2 check below meets coin calls
                // (random bytes almost never spell `ft_transfer` with a JSON amount; smoke/control finding H-r8-2).
                let raw = steps_of(&inp.steps);
                let shaped: Vec<Step> = inp.steps.iter().zip(raw.iter()).map(|(s, r)| match (s.call, s.args.first()) {
                    (true, Some(b)) if b & 1 == 1 => {
                        const STD: [&str; 9] = ["ft_transfer", "ft_transfer_call", "mt_transfer", "mt_transfer_call", "mt_batch_transfer", "mt_batch_transfer_call", "nft_transfer", "nft_transfer_call", "ft_withdraw"];
                        let a = s.deposit % 1_000_000_000_000_000_000_000_000_000;
                        let args = format!(r#"{{"receiver_id":"x.near","amount":"{a}","token_id":"t{b}","token_ids":["t{b}"],"amounts":["{a}"],"token":"usdc.near","msg":""}}"#);
                        Step::FunctionCall { method_name: STD[usize::from(b / 2) % 9].to_string(), args: Base64VecU8(args.into_bytes()), deposit: U128(s.deposit), gas: U64(s.gas) }
                    }
                    _ => r.clone(),
                }).collect();
                for steps in [raw, shaped] {
                let out = moves_pub(&receiver, &steps);
                // Measured amounts are a saturating sum of what the steps carry: a transfer's deposit is always counted.
                if let Some(m) = &out {
                    let near: u128 = m.iter().filter(|(c, _)| c == "near").map(|(_, a)| *a).sum();
                    let deposits: u128 = steps.iter().map(|s| match s { Step::Transfer { deposit } => deposit.0, Step::FunctionCall { deposit, .. } => deposit.0 }).fold(0u128, |a, b| a.saturating_add(b));
                    assert!(near >= deposits || near == u128::MAX, "measured NEAR below the deposits carried");
                    // Release 8 (RS-2): every call's gas counts as NEAR at 1e9 yocto a gas (a literal; release 9, 2e8 before), standard coin
                    // methods included: "near" >= Σ deposits + Σ gas × 1e9, saturating.
                    let gas_near: u128 = steps.iter().map(|s| match s { Step::FunctionCall { gas, .. } => u128::from(gas.0) * 1_000_000_000, _ => 0 }).fold(0u128, |a, b| a.saturating_add(b));
                    if !(near >= deposits.saturating_add(gas_near) || near == u128::MAX) {
                        let _ = std::panic::take_hook();
                        panic!("RS-2: measured NEAR {near} below the deposits plus the gas carried {}", deposits.saturating_add(gas_near));
                    }
                    assert!(m.iter().all(|(c, _)| !c.is_empty()), "an empty coin name");
                }
                }
            }
        }
        1 => {
            let mut u = Unstructured::new(rest);
            if let Ok(v) = Vec::<FStep>::arbitrary(&mut u) {
                let steps = steps_of(&v);
                let r = std::panic::catch_unwind(|| check_steps_pub(&steps));
                // Release 7 (P-1 closed): at most 300 Tgas a step (a literal, not the contract's constant).
                // Accepted only when every rule holds; refused (a NEAR panic through the mock) otherwise.
                let ok = !steps.is_empty() && steps.len() <= 10 && steps.iter().all(|s| match s { Step::FunctionCall { method_name, args, gas, .. } => !method_name.is_empty() && method_name.len() <= 256 && args.0.len() <= 4096 && !["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"].contains(&method_name.as_str()) && gas.0 <= 300_000_000_000_000, _ => true });
                assert_eq!(r.is_ok(), ok, "check_steps verdict differs from the rules");
            }
        }
        3 => {
            // Release 7: the second device's recovery calls and recovery_status with arbitrary arguments and signers.
            let mut u = Unstructured::new(rest);
            if let Ok((which, signer_pick, now, start, key_bytes, ready_at, confirm, with_stop)) = <(u8, u8, u64, u64, Vec<u8>, u64, Option<bool>, bool)>::arbitrary(&mut u) {
                let signer = [9u8, 1, 4, 5, 9][usize::from(signer_pick % 5)];
                if let Err(msg) = drive_recovery_calls(which, signer, now, start, &key_bytes, ready_at, confirm, with_stop) {
                    // A refusal is a NEAR panic with a plain-words message; a Rust panic from an assert or an unwrap is a crash.
                    assert!(!msg.contains("a yes was recorded") && !msg.contains("does not count") && !msg.contains("refusal by a key") && !msg.contains("left the recovery") && !msg.contains("froze spending") && !msg.contains("did not freeze") && !msg.contains("no stop waiting") && !msg.contains("unwrap") && !msg.contains("overflow") && !msg.contains("index out of"), "{msg}");
                }
            }
        }
        4 => {
            // Release 7: a release-6 account through upgrade_check(6).
            let mut u = Unstructured::new(rest);
            if let Ok((delay_days, devices, ages, approvers, freeze, module_key, pending_module)) = <(u8, u8, Vec<u64>, Vec<u64>, Option<u64>, bool, bool)>::arbitrary(&mut u) {
                if let Err(msg) = drive_upgrade_migration(delay_days, devices, &ages, &approvers, freeze, module_key, pending_module) {
                    panic!("upgrade_check(6) failed on a release-6 account: {msg}");
                }
            }
        }
        _ => {
            let _ = decode_cells(rest);
            assert!(roundtrip_policy(rest));
            if rest.len() >= 32 {
                let total = u128::from_le_bytes(rest[0..16].try_into().unwrap());
                let limit = u128::from_le_bytes(rest[16..32].try_into().unwrap());
                if let Some(s) = share_ppm_pub(total, limit) {
                    assert!(s <= 1_000_000 && total <= limit);
                }
            }
        }
    }
});
