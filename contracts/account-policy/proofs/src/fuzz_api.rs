//! Thin pass-throughs so the fuzz targets (proofs/fuzz) reach the contract's private functions and cell types.
use super::*;

pub fn check_steps_pub(steps: &[Step]) {
    check_steps(steps)
}
pub fn moves_pub(receiver: &str, steps: &[Step]) -> Option<Vec<(String, u128)>> {
    moves(receiver, steps)
}
pub fn share_ppm_pub(total: u128, limit: u128) -> Option<u128> {
    share_ppm(total, limit)
}
/// Decode every stored cell's type from arbitrary bytes: borsh must answer Ok or Err, never panic.
pub fn decode_cells(bytes: &[u8]) -> [bool; 7] {
    [
        borsh::from_slice::<Devices>(bytes).is_ok(),
        borsh::from_slice::<u64>(bytes).is_ok(),
        borsh::from_slice::<Vec<(Vec<u8>, u64)>>(bytes).is_ok(),
        borsh::from_slice::<Vec<(u64, Vec<u8>)>>(bytes).is_ok(),
        borsh::from_slice::<AccountPolicy>(bytes).is_ok(),
        borsh::from_slice::<Vec<Pending>>(bytes).is_ok(),
        borsh::from_slice::<Change>(bytes).is_ok(),
    ]
}
/// A decoded `AccountPolicy` (from arbitrary bytes) must re-encode, and its views must not panic on any content.
pub fn roundtrip_policy(bytes: &[u8]) -> bool {
    match borsh::from_slice::<AccountPolicy>(bytes) {
        Ok(p) => {
            let again = borsh::to_vec(&p).expect("re-encode");
            let _ = p.bands.len() + p.pending.len() + p.spent.len() + p.second_devices.len();
            again.len() <= bytes.len()
        }
        Err(_) => true,
    }
}

// ── Release 7 paths (round 3): the second device's recovery calls, recovery_status, and the 6 → 7 migration ──────
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{MockedBlockchain, PublicKey};
use std::collections::HashMap;

fn fkey(fill: u8) -> Vec<u8> {
    let mut k = vec![ML_DSA_65_TAG];
    k.extend(std::iter::repeat(fill).take(ML_DSA_65_PUBLIC_KEY_LEN));
    k
}
fn env_as(signer: u8, now: u64, storage: HashMap<Vec<u8>, Vec<u8>>) {
    let me: AccountId = "me.near".parse().unwrap();
    let ctx = VMContextBuilder::new().current_account_id(me.clone()).predecessor_account_id(me.clone()).signer_account_id(me).signer_account_pk(PublicKey::try_from(fkey(signer)).unwrap()).block_timestamp(now).account_balance(NearToken::from_near(1_000)).build();
    // The VM and fee configs are built once per process (building them per call was most of the fuzzer's time).
    let (vm, fees) = (cached(near_sdk::test_vm_config), cached(near_sdk::RuntimeFeesConfig::test));
    env::set_blockchain_interface(MockedBlockchain::new(ctx, vm, fees, vec![], storage, Default::default(), None));
}

/// A policy with one aged second device (key 9), the words (key 4), a waiting recovery to key 5 started at `start`,
/// and the given cells. Returns what the fuzzer drives: approve_recovery / refuse_recovery / recovery_status with
/// arbitrary arguments and signers; every refusal is a NEAR panic (caught by the caller); any other panic is a crash.
/// The outcome is checked: a yes is recorded only for the exact (key, time) of the waiting recovery.
pub fn drive_recovery_calls(which: u8, signer: u8, now: u64, start: u64, key_bytes: &[u8], ready_at: u64, confirm: Option<bool>, with_stop: bool) -> Result<bool, String> {
    let delay = 2 * DAY_NS;
    let start = start % (1u64 << 50);
    let now = start.saturating_add(now % (40 * DAY_NS));
    let mut p = AccountPolicy { recovery_delay_ns: delay, recovery: Some(PendingRecovery { new_key: Base64VecU8(fkey(5)), ready_at_ns: U64(start + delay) }), recovery_key: Some(fkey(4)), second_devices: vec![fkey(9)], bands: vec![Band { up_to: None, level: Level::FaceId }], pending: vec![], spent: vec![], next_id: 1 };
    if with_stop {
        p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(start + DAY_NS), needs_device: false, approved: false });
        p.next_id = 2;
    }
    let mut storage = HashMap::new();
    storage.insert(DEVICES_KEY.to_vec(), borsh::to_vec(&Devices { keys: vec![fkey(1)], sealed: true, created_at_ns: Some(0) }).unwrap());
    storage.insert(FALLBACK_KEY.to_vec(), borsh::to_vec(&default_fallback_ns(delay)).unwrap());
    env_as(signer, now, storage);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match which % 3 {
        0 => {
            p.approve_recovery(Base64VecU8(key_bytes.to_vec()), U64(ready_at));
            // Only the exact recovery, only the aged second device.
            assert!(signer == 9 && key_bytes == fkey(5).as_slice() && ready_at == start + delay, "a yes was recorded for the wrong recovery or by the wrong key");
            assert!(p.recovery_approved(p.recovery.as_ref().unwrap()), "the yes does not count afterwards");
            true
        }
        1 => {
            p.refuse_recovery(confirm);
            assert!(signer == 9, "a refusal by a key that is no second device");
            assert!(p.recovery.is_none(), "a refusal left the recovery waiting");
            if confirm == Some(true) {
                assert!(with_stop, "a confirmed stop with no stop waiting");
                assert!(p.frozen_until().is_none(), "a confirmed stop froze spending");
            } else {
                assert!(p.frozen_until().is_some(), "an unconfirmed refusal did not freeze spending");
            }
            true
        }
        _ => {
            let s = p.recovery_status().expect("a recovery waits");
            assert!(s.needs_device && !s.approved && s.ready_at_ns.0 == start + delay && s.fallback_at_ns.0 == start + default_fallback_ns(delay));
            let _ = p.fallback_seconds();
            true
        }
    }));
    match r {
        Ok(v) => Ok(v),
        Err(e) => Err(e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()),
    }
}

/// The 6 → 7 migration: a release-6 account (no fallback cell, second devices present) goes through `upgrade_check(6)`;
/// every cell is read, the fallback cell is written at this release's default, and nothing panics. Cells are built from
/// the fuzzer's bytes with the release-6 shapes; `extra` bytes are stored under a module key to check the refusal.
pub fn drive_upgrade_migration(delay_days: u8, devices: u8, ages: &[u64], approvers: &[u64], freeze: Option<u64>, module_key: bool, pending_module: bool) -> Result<(), String> {
    let delay = DAY_NS * (1 + u64::from(delay_days % 30));
    let devices = usize::from(devices % 5);
    let mut p = AccountPolicy { recovery_delay_ns: delay, recovery: None, recovery_key: Some(fkey(4)), second_devices: (0..devices).map(|i| fkey(10 + i as u8)).collect(), bands: vec![Band { up_to: None, level: Level::FaceId }], pending: vec![], spent: vec![], next_id: 1 };
    if pending_module {
        p.pending.push(Pending { id: U64(1), change: Change::LegacyOff, ready_at_ns: U64(0), needs_device: false, approved: false });
    }
    let mut storage = HashMap::new();
    storage.insert(DEVICES_KEY.to_vec(), borsh::to_vec(&Devices { keys: vec![fkey(1)], sealed: true, created_at_ns: Some(0) }).unwrap());
    let age_rows: Vec<(Vec<u8>, u64)> = p.second_devices.iter().zip(ages.iter().chain(std::iter::repeat(&0))).map(|(k, at)| (env_sha(k), *at)).collect();
    storage.insert(DEVICE_AGES_KEY.to_vec(), borsh::to_vec(&age_rows).unwrap());
    let by: Vec<(u64, Vec<u8>)> = approvers.iter().map(|i| (*i, vec![])).collect();
    storage.insert(APPROVERS_KEY.to_vec(), borsh::to_vec(&by).unwrap());
    if let Some(f) = freeze {
        storage.insert(FREEZE_KEY.to_vec(), borsh::to_vec(&f).unwrap());
    }
    if module_key {
        storage.insert(b"legacy".to_vec(), vec![1, 2, 3]);
    }
    env_as(1, DAY_NS, storage);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        p.upgrade_check(6, None);
        assert!(!module_key && !pending_module, "an account with module state passed upgrade_check");
        let written: u64 = load_key(FALLBACK_KEY).expect("the fallback cell is written by the migration");
        assert_eq!(written, default_fallback_ns(delay));
        assert_eq!(p.fallback_ns(), default_fallback_ns(delay));
        read_all_state();
        let _ = p.second_device_ages();
        let _ = p.frozen_until();
    }));
    match r {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
            if (module_key || pending_module) && (msg.contains("Agent, Legacy or Kids") || msg.contains("not in this release")) {
                Ok(())
            } else {
                Err(msg)
            }
        }
    }
}
fn env_sha(k: &[u8]) -> Vec<u8> {
    env::sha256(k)
}

// ── Release 7 completion (30 Oct): the recovery and approval state machine, as a SEQUENCE ─────────────────────────────
//
// One account (phone key 1, words key 4, one second device of age, key 9), a fuzzer-chosen delay among the app's four
// and the extremes, and up to 64 operations, each from a fuzzer-chosen signer at a fuzzer-chosen moment: start_recovery,
// approve_recovery (right or wrong key / finish time), refuse_recovery (None / false / true), cancel_recovery,
// finish_recovery, approve / decline / run of the waiting stop, remove_key of the second device and run of it, and
// time steps. A call that panics is a refusal: the account and its cells are restored (NEAR reverts a failed call). A
// Rust panic that is not a refusal (overflow, unwrap, index) is a crash. After every call an independent oracle checks
// the rules R7 promises; a violation is returned as Err and the fuzz target panics on it.

// Release 9: and the finishing marker and the release list (both drivers keep them between calls).
const SEQ_KEYS: [&[u8]; 9] = [DEVICES_KEY, FREEZE_KEY, DEVICE_AGES_KEY, APPROVERS_KEY, FALLBACK_KEY, RECOVERY_YES_KEY, STOP_ASKED_KEY, FINISHING_KEY, RELEASES_KEY];

fn seq_cells() -> HashMap<Vec<u8>, Vec<u8>> {
    SEQ_KEYS.iter().filter_map(|k| env::storage_read(k).map(|v| (k.to_vec(), v))).collect()
}

fn panic_text(e: Box<dyn std::any::Any + Send>) -> String {
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

/// A Rust panic that no contract refusal produces. A refusal is `env::panic_str` (the mock reports it as a
/// `GuestPanic` host error) or, in this debug-assertions build, `require!`'s plain message.
fn is_crash(msg: &str) -> bool {
    !msg.contains("GuestPanic") && ["overflow", "unwrap()", "index out of bounds", "attempt to", "called `Option", "called `Result", "divide by zero", "slice"].iter().any(|s| msg.contains(s))
}

#[derive(Clone, Debug, PartialEq)]
struct Shadow {
    phone: u8,
    laptop: bool,
    recovery: Option<(u8, u64, u64)>, // (new key fill, start, ready_at)
    yes: Option<(u8, u64)>,           // the second device's yes: (new key fill, ready_at)
    stop_asked: bool,
    removals: Vec<(u64, u64, u64)>, // removals of key 9: (id, placed at, the least wait it was owed)
}

pub fn drive_recovery_sequence(delay_pick: u8, ops: &[(u8, u8, u8)]) -> Result<usize, String> {
    let delay = [DAY_NS, 2 * DAY_NS, 3 * DAY_NS, 7 * DAY_NS, 30 * DAY_NS][usize::from(delay_pick % 5)];
    let fallback = default_fallback_ns(delay);
    let floor = delay + delay.min(DAY_NS);
    let mut p = AccountPolicy { recovery_delay_ns: delay, recovery: None, recovery_key: Some(fkey(4)), second_devices: vec![fkey(9)], bands: vec![Band { up_to: None, level: Level::FaceId }], pending: vec![], spent: vec![], next_id: 1 };
    let mut cells: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    cells.insert(DEVICES_KEY.to_vec(), borsh::to_vec(&Devices { keys: vec![fkey(1)], sealed: true, created_at_ns: Some(0) }).unwrap());
    cells.insert(FALLBACK_KEY.to_vec(), borsh::to_vec(&fallback).unwrap());
    let mut sh = Shadow { phone: 1, laptop: true, recovery: None, yes: None, stop_asked: false, removals: vec![] };
    let mut now: u64 = 10 * DAY_NS;
    let mut done = 0usize;
    let steps = [SECOND, 3_600 * SECOND, DAY_NS / 2, DAY_NS, 2 * DAY_NS, 7 * DAY_NS, 30 * DAY_NS, delay, fallback, floor];
    for &(op, who, arg) in ops.iter().take(64) {
        if op % 12 == 11 {
            now += steps[usize::from(arg) % steps.len()] + u64::from(who % 3) * SECOND;
            continue;
        }
        // Signers: the phone (as it stands), the words, the second device, a stranger, the old phone after a move.
        let signer = [sh.phone, 4, 9, 7, 1][usize::from(who % 5)];
        let stop = p.pending.iter().find(|q| matches!(q.change, Change::CancelRecovery)).cloned();
        let removal_id = p.pending.iter().find(|q| matches!(&q.change, Change::RemoveKey { public_key } if public_key.0 == fkey(9))).map(|q| q.id);
        let rec = p.recovery.clone();
        let backup = borsh::to_vec(&p).unwrap();
        let freeze_before: Option<u64> = cells.get(FREEZE_KEY).map(|b| borsh::from_slice(b).unwrap());
        env_as(signer, now, cells.clone());
        let kind = op % 12;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Option<Outcome> {
            match kind {
                0 => {
                    p.start_recovery(Base64VecU8(fkey([5, 6, 1, 9][usize::from(arg % 4)])));
                    None
                }
                1 | 2 => {
                    let (k, t) = match &rec {
                        Some(r) => (r.new_key.0.clone(), r.ready_at_ns.0),
                        None => (fkey(5), now + delay),
                    };
                    let k = if arg & 1 == 1 { if k == fkey(6) { fkey(5) } else { fkey(6) } } else { k };
                    let t = if arg & 2 == 2 { t.wrapping_add(1) } else { t };
                    p.approve_recovery(Base64VecU8(k), U64(t));
                    None
                }
                3 => {
                    p.refuse_recovery([None, Some(false), Some(true)][usize::from(arg % 3)]);
                    None
                }
                4 => Some(p.cancel_recovery()),
                5 => {
                    p.finish_recovery();
                    // Release 9: the finish completes in its callback; this release-7 target delivers it at once with
                    // the add succeeded (its world: one finish, one step). The wide target varies when and how.
                    deliver_finish_now(&mut p, now);
                    None
                }
                6 => Some(p.approve(stop.as_ref().map_or(U64(99), |s| s.id))),
                7 => {
                    p.decline(stop.as_ref().map_or(U64(99), |s| s.id));
                    None
                }
                8 => Some(p.run(stop.as_ref().map_or(U64(99), |s| s.id))),
                9 => Some(p.remove_key(Base64VecU8(fkey(9)))),
                _ => Some(p.run(removal_id.unwrap_or(U64(99)))),
            }
        }));
        let out = match r {
            Err(e) => {
                let msg = panic_text(e);
                if is_crash(&msg) {
                    return Err(format!("crash on op {kind} by key {signer}: {msg}"));
                }
                p = borsh::from_slice(&backup).unwrap();
                // Liveness: the words finish a recovery that is due (after the delay, and with the device of age its
                // yes to THIS recovery or the fallback).
                if kind == 5 && signer == 4 {
                    if let Some((_, start, ready)) = sh.recovery {
                        let yes_ok = sh.yes == sh.recovery.map(|(k, _, t)| (k, t));
                        if now >= ready && (!sh.laptop || yes_ok || now >= start + fallback) {
                            return Err(format!("the words could not finish a due recovery: {msg}"));
                        }
                    }
                }
                // Liveness: the second device of age says yes to the waiting recovery's exact key and time.
                if kind == 1 && signer == 9 && sh.laptop && arg & 3 == 0 && rec.is_some() {
                    return Err(format!("the second device could not say yes to the waiting recovery: {msg}"));
                }
                continue;
            }
            Ok(o) => o,
        };
        done += 1;
        cells = seq_cells();
        let freeze_after: Option<u64> = cells.get(FREEZE_KEY).map(|b| borsh::from_slice(b).unwrap());
        let cancels = p.pending.iter().filter(|q| matches!(q.change, Change::CancelRecovery)).count();
        if cancels > 1 {
            return Err("two stops of one recovery wait".into());
        }
        match kind {
            0 => {
                if signer != 4 || sh.recovery.is_some() {
                    return Err(format!("start_recovery by key {signer} with recovery {:?}", sh.recovery));
                }
                let k = [5, 6, 1, 9][usize::from(arg % 4)];
                if k == sh.phone || k == 9 && sh.laptop {
                    return Err("a recovery to a key already on the account".into());
                }
                sh.recovery = Some((k, now, now + delay));
                sh.yes = None;
                sh.stop_asked = false;
                if p.recovery_status().map(|s| s.approved) != Some(false) {
                    return Err("a new recovery reads as approved".into());
                }
                if cells.contains_key(STOP_ASKED_KEY) || cells.contains_key(RECOVERY_YES_KEY) {
                    return Err("a new recovery inherits a yes or a stop".into());
                }
            }
            1 | 2 => {
                let (k, _, t) = sh.recovery.ok_or("a yes with no recovery waiting")?;
                if signer != 9 || !sh.laptop || arg & 3 != 0 {
                    return Err(format!("approve_recovery accepted: key {signer}, wrong key/time bits {}", arg & 3));
                }
                sh.yes = Some((k, t));
                if p.recovery_status().map(|s| s.approved) != Some(true) {
                    return Err("the yes does not count".into());
                }
            }
            3 => {
                if signer != 9 || !sh.laptop || sh.recovery.is_none() {
                    return Err(format!("refuse_recovery accepted from key {signer}"));
                }
                if p.recovery.is_some() {
                    return Err("a refusal left the recovery waiting".into());
                }
                let confirm = [None, Some(false), Some(true)][usize::from(arg % 3)];
                if confirm == Some(true) {
                    if stop.is_none() {
                        return Err("a confirmed stop with no stop waiting".into());
                    }
                    if freeze_after != freeze_before {
                        return Err("a confirmed stop wrote a freeze".into());
                    }
                } else if freeze_after != Some(now + floor) {
                    return Err(format!("a plain refusal did not freeze for the floor: {freeze_after:?}"));
                }
                sh.recovery = None;
                sh.yes = None;
                sh.stop_asked = false;
            }
            4 => {
                let o = out.unwrap();
                if signer != sh.phone || sh.recovery.is_none() {
                    return Err(format!("cancel_recovery accepted from key {signer}"));
                }
                if sh.laptop {
                    if sh.stop_asked {
                        return Err("a second stop of one recovery".into());
                    }
                    let want = now + DAY_NS.min(delay / 2) / SECOND * SECOND;
                    if o.done || o.ready_at_ns.map(|t| t.0) != Some(want) || p.recovery.is_none() || cancels != 1 {
                        return Err(format!("the phone's stop with a device of age: {o:?}"));
                    }
                    sh.stop_asked = true;
                } else {
                    if !o.done || p.recovery.is_some() || freeze_after != Some(now + floor) {
                        return Err("the phone's stop with no device did not end and freeze".into());
                    }
                    sh.recovery = None;
                    sh.yes = None;
                }
            }
            5 => {
                let (k, start, ready) = sh.recovery.ok_or("finished with no recovery")?;
                if signer != 4 {
                    return Err(format!("finish_recovery from key {signer}"));
                }
                if now < ready {
                    return Err("finished before the delay".into());
                }
                if sh.laptop && sh.yes != Some((k, ready)) && now < start + fallback {
                    return Err("finished before the fallback with no yes from the device of age".into());
                }
                let devices: Devices = borsh::from_slice(cells.get(DEVICES_KEY).unwrap()).unwrap();
                if devices.keys != vec![fkey(k)] || !devices.sealed {
                    return Err("after the finish the new key is not the only phone".into());
                }
                sh.phone = k;
                sh.recovery = None;
                sh.yes = None;
                sh.stop_asked = false;
            }
            6 => {
                let s = stop.ok_or("approved a stop that isn't there")?;
                if signer != 9 || !sh.laptop {
                    return Err(format!("the stop approved by key {signer}"));
                }
                let _ = s;
                if p.recovery.is_some() {
                    return Err("the device's yes to the stop left the recovery".into());
                }
                sh.recovery = None;
                sh.yes = None;
                sh.stop_asked = false;
            }
            7 => {
                if signer != 9 || !sh.laptop || stop.is_none() {
                    return Err(format!("the stop declined by key {signer}"));
                }
                if p.recovery.is_none() || cancels != 0 {
                    return Err("declining the stop ended the recovery or kept the stop".into());
                }
            }
            8 => {
                let s = stop.ok_or("ran a stop that isn't there")?;
                if signer != sh.phone || now < s.ready_at_ns.0 {
                    return Err(format!("the stop ran early or from key {signer}"));
                }
                let co = s.approved;
                if !co {
                    if let (Some((k, _, t)), Some(y)) = (sh.recovery, sh.yes) {
                        if y == (k, t) {
                            return Err("an unanswered stop ended a recovery the device said yes to".into());
                        }
                    }
                    if freeze_after != Some(now + floor) {
                        return Err("an unanswered stop did not freeze".into());
                    }
                }
                if p.recovery.is_some() {
                    return Err("the stop ran and the recovery stayed".into());
                }
                sh.recovery = None;
                sh.yes = None;
                sh.stop_asked = false;
            }
            9 => {
                let o = out.unwrap();
                if signer != sh.phone {
                    return Err(format!("remove_key from key {signer}"));
                }
                // Key 9 while it is a second device of age: max(floor, fallback); once it is gone, any key: the floor.
                let owed = if sh.laptop { floor.max(fallback) } else { floor };
                let wait = o.ready_at_ns.map(|t| t.0 - now).ok_or("a key's removal ran at once")?;
                if wait < owed {
                    return Err(format!("a removal waits {wait} < {owed} (device of age: {})", sh.laptop));
                }
                sh.removals.push((o.id.unwrap().0, now, owed));
            }
            _ => {
                let id = removal_id.ok_or("ran a removal that isn't there")?.0;
                let (_, placed, owed) = *sh.removals.iter().find(|(i, _, _)| *i == id).ok_or("ran a removal that was never placed")?;
                if signer != sh.phone || now < placed + owed {
                    return Err("a removal ran early".into());
                }
                if sh.recovery.is_some() {
                    return Err("the device's removal ran while a recovery waits".into());
                }
                sh.laptop = false;
                if !p.second_devices.is_empty() {
                    return Err("the removal ran and the device stayed".into());
                }
            }
        }
        // A recovery's end drops what the phone asked alone (the removal included).
        sh.removals.retain(|(i, _, _)| p.pending.iter().any(|q| q.id.0 == *i));
        if sh.recovery.is_none() && p.recovery.is_some() {
            return Err("the contract keeps a recovery the oracle ended".into());
        }
    }
    Ok(done)
}


/// Release 9: deliver `finish_recovery`'s callback (`on_recovery_key`) at once with the add Successful (the release-7
/// target's world, where a finish completes in one step).
fn deliver_finish_now(p: &mut AccountPolicy, now: u64) {
    let mut found = None;
    for r in near_sdk::test_utils::get_created_receipts() {
        for a in &r.actions {
            if let MockAction::FunctionCallWeight { method_name, args, .. } = a {
                if method_name.as_slice() == b"on_recovery_key" {
                    found = Some(args.clone());
                }
            }
        }
    }
    let v: Value = serde_json::from_slice(&found.expect("finish_recovery scheduled no callback")).unwrap();
    let k: Base64VecU8 = serde_json::from_value(v["new_key"].clone()).unwrap();
    let t: U64 = serde_json::from_value(v["ready_at_ns"].clone()).unwrap();
    let a: U64 = serde_json::from_value(v["asked_at_ns"].clone()).unwrap();
    let mut storage = seq_cells();
    storage.insert(b"STATE".to_vec(), borsh::to_vec(&*p).unwrap());
    env_as_with(1, now, storage, vec![PromiseResult::Successful(vec![])]);
    AccountPolicy::on_recovery_key(k, t, a);
    *p = borsh::from_slice(&env::storage_read(b"STATE").unwrap()).unwrap();
}

// ── Release 8 (30 Oct) + release 9 (1 Nov): the WIDE recovery / approval / spending state machine (`recovery_seq_wide`) ──
//
// The blind re-score's deduction 3: the release-7 sequence had one second device, always of age, Face ID-only bands, no
// spends, no add_second_device, no set_recovery_key, no upgrade. This driver keeps that one (above, unchanged) and adds
// a wider one: up to three second devices at the start (keys 9, 10, 11; 12 and 13 may be added; four at most), aged or
// young, and added later at any moment (also during a recovery and a freeze); add_second_device (new and refill) and its
// run; remove_key of devices, the backup key, the phone, fresh keys; set_recovery_key (renewal, new words, a key with a
// waiting removal: the RK sequence); five band presets with Face ID / Wait / Device / Both levels, set at the start or by
// set_protection; eleven spend presets through `execute` (transfers, coin calls, unmeasurable calls, RS-1 gas sums);
// approve / decline / run / cancel of any waiting request by any signer, young or aged; the FB-3 callback with Successful
// / Failed results; upgrade placement and run; upgrade_check at any moment. An independent shadow (literals only, not
// the contract's helpers) predicts every state change, and after every accepted call the contract must agree with it.
//
// Release 9 adds: the finish of a recovery in two steps (finish_recovery's add of the new key, then its callback
// on_recovery_key, delivered as a separate operation at any later moment, after any other calls); the add's outcome
// (refused at the storage edge, or the key already on NEAR); the upgrade allowlist (upgrade of listed / unlisted
// releases, AllowRelease's run / co-sign / cancel, Upgrade's run, upgrade_check(6/7/8/9, with or without a hash));
// refill_recovery_key from any signer; an older account whose phone list is not sealed (keys learned as phones); and a
// model of NEAR's access keys (each receipt applied in order, all or nothing; an add of a key that exists fails), against
// which the account must always keep a phone key, the words' key, its devices' keys, and no key without a role.

use near_sdk::mock::MockAction;
use near_sdk::PromiseResult;
use std::collections::BTreeMap;

fn env_as_with(signer: u8, now: u64, storage: HashMap<Vec<u8>, Vec<u8>>, results: Vec<PromiseResult>) {
    let me: AccountId = "me.near".parse().unwrap();
    let ctx = VMContextBuilder::new().current_account_id(me.clone()).predecessor_account_id(me.clone()).signer_account_id(me).signer_account_pk(PublicKey::try_from(fkey(signer)).unwrap()).block_timestamp(now).account_balance(NearToken::from_near(1_000)).build();
    let (vm, fees) = (cached(near_sdk::test_vm_config), cached(near_sdk::RuntimeFeesConfig::test));
    env::set_blockchain_interface(MockedBlockchain::new(ctx, vm, fees, results, storage, Default::default(), None));
}

const W_SMALL_NEAR: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR
const W_SMALL_USDC: u128 = 1_000;
const W_TGAS: u64 = 1_000_000_000_000;
const W_GAS_PRICE: u128 = 1_000_000_000; // yocto per gas, as a literal (RS-2; release 9: ten times NEAR's floor)
const W_HOUR: u64 = 3_600 * 1_000_000_000;

fn w_small() -> Option<Vec<(String, U128)>> {
    Some(vec![("near".to_string(), U128(W_SMALL_NEAR)), ("nep141:usdc.near".to_string(), U128(W_SMALL_USDC))])
}

/// The five band presets: 0 Face ID; 1 small Face ID, rest Wait 2 h; 2 small Face ID, rest Device; 3 small Wait 1 h, rest
/// Both 2 h; 4 small Device, rest Both 1 h. 2-4 need a second device.
fn w_bands(preset: u8) -> Vec<Band> {
    let w = |s: u64| U64(s);
    match preset % 5 {
        0 => vec![Band { up_to: None, level: Level::FaceId }],
        1 => vec![Band { up_to: w_small(), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: w(7_200) } }],
        2 => vec![Band { up_to: w_small(), level: Level::FaceId }, Band { up_to: None, level: Level::Device }],
        3 => vec![Band { up_to: w_small(), level: Level::Wait { seconds: w(3_600) } }, Band { up_to: None, level: Level::Both { seconds: w(7_200) } }],
        _ => vec![Band { up_to: w_small(), level: Level::Device }, Band { up_to: None, level: Level::Both { seconds: w(3_600) } }],
    }
}

fn w_call(method: &str, args: &str, deposit: u128, gas: u64) -> Step {
    Step::FunctionCall { method_name: method.to_string(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(gas) }
}

/// The spend presets: (receiver, steps, what they move as the oracle counts it from literals: Σ deposits + Σ gas × 1e9 as
/// "near", the coin amounts, or None when unmeasurable).
fn w_spend(preset: u8, x: u8) -> (&'static str, Vec<Step>, Option<Vec<(String, u128)>>) {
    let x64 = u64::from(x);
    let gas_near = |g: u64| u128::from(g) * W_GAS_PRICE;
    match preset % 11 {
        0 => ("bob.near", vec![Step::Transfer { deposit: U128(1_000_000_000_000_000_000_000) }], Some(vec![("near".into(), 1_000_000_000_000_000_000_000)])),
        1 => ("bob.near", vec![Step::Transfer { deposit: U128(5_000_000_000_000_000_000_000_000) }], Some(vec![("near".into(), 5_000_000_000_000_000_000_000_000)])),
        2 => ("usdc.near", vec![w_call("ft_transfer_call", r#"{"receiver_id":"x.near","amount":"1","msg":""}"#, 1, 200 * W_TGAS)], Some(vec![("near".into(), 1 + gas_near(200 * W_TGAS)), ("nep141:usdc.near".into(), 1)])),
        3 => ("usdc.near", vec![w_call("ft_transfer", r#"{"receiver_id":"x.near","amount":"500"}"#, 1, 10 * W_TGAS)], Some(vec![("near".into(), 1 + gas_near(10 * W_TGAS)), ("nep141:usdc.near".into(), 500)])),
        4 => ("bob.near", vec![w_call("storage_deposit", "{}", 0, 200 * W_TGAS), w_call("storage_deposit", "{}", 0, 200 * W_TGAS)], Some(vec![("near".into(), gas_near(400 * W_TGAS))])),
        5 => ("bob.near", vec![w_call("do_it", "{}", 0, 30 * W_TGAS)], None),
        6 => ("bob.near", vec![w_call("storage_deposit", "{}", 0, x64 * 2 * W_TGAS)], Some(vec![("near".into(), gas_near(x64 * 2 * W_TGAS))])),
        7 => {
            let g = x64 * 1_250_000_000_000;
            ("bob.near", vec![w_call("near_deposit", "", 0, g), w_call("near_deposit", "", 0, g)], Some(vec![("near".into(), gas_near(2 * g))]))
        }
        8 => ("usdc.near", vec![w_call("ft_transfer_call", r#"{"receiver_id":"x.near","amount":"2000","msg":""}"#, 1, 5 * W_TGAS)], Some(vec![("near".into(), 1 + gas_near(5 * W_TGAS)), ("nep141:usdc.near".into(), 2_000)])),
        9 => ("intents.near", vec![w_call("mt_transfer", r#"{"receiver_id":"x.near","token_id":"nep141:usdc.near","amount":"10"}"#, 1, 20 * W_TGAS)], Some(vec![("near".into(), 1 + gas_near(20 * W_TGAS)), ("nep141:usdc.near".into(), 10)])),
        _ => {
            let n = 1 + usize::from(x % 10);
            ("bob.near", vec![w_call("withdraw_all", "", 0, 30 * W_TGAS); n], Some(vec![("near".into(), gas_near(30 * W_TGAS * n as u64))]))
        }
    }
}

fn w_wait_ns(l: &Level) -> u64 {
    match l {
        Level::Wait { seconds } | Level::Both { seconds } => seconds.0.saturating_mul(SECOND),
        _ => 0,
    }
}
fn w_needs(l: &Level) -> bool {
    matches!(l, Level::Device | Level::Both { .. })
}

/// The oracle's own band choice for a request ALONE (no 24-hour history): a lower bound on the contract's level, since
/// earlier spending only adds to the totals.
fn w_level_alone(bands: &[Band], moves: &Option<Vec<(String, u128)>>) -> Level {
    let strictest = bands.last().map(|b| b.level.clone()).unwrap_or(Level::FaceId);
    let Some(m) = moves else { return strictest };
    for b in bands {
        let fits = match &b.up_to {
            None => true,
            Some(limits) => {
                let listed = m.iter().filter(|(_, a)| *a > 0).all(|(c, _)| limits.iter().any(|(l, _)| l == c));
                let mut used: u128 = 0;
                let mut ok = listed;
                for (c, lim) in limits {
                    let a = m.iter().filter(|(mc, _)| mc == c).map(|(_, a)| *a).fold(0u128, u128::saturating_add);
                    if a == 0 {
                        continue;
                    }
                    if lim.0 == 0 || a > lim.0 {
                        ok = false;
                        break;
                    }
                    // ceil(a * 1e6 / lim); only small literals here, so no overflow.
                    used += (a * 1_000_000 + lim.0 - 1) / lim.0;
                }
                ok && used <= 1_000_000
            }
        };
        if fits {
            return b.level.clone();
        }
    }
    strictest
}

/// The three releases the driver names (sha256-sized, by a fill byte), as the oracle's index 0-2.
fn w_release(i: u8) -> Vec<u8> {
    vec![0xA0 + i % 3; 32]
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum WKind {
    Spend,
    Protection(u8),
    AddDevice(u8),
    RemoveKey(u8),
    SetWords(u8),
    Upgrade(u8),
    AllowRelease(u8, u64),
    Stop,
}
impl WKind {
    fn setting(&self) -> bool {
        !matches!(self, WKind::Spend | WKind::Stop)
    }
}

#[derive(Clone, Debug)]
struct WMeta {
    id: u64,
    kind: WKind,
    ready: u64,
    needs_device: bool,
    approved: bool,
    /// The device whose co-sign is on record (an aged device's yes); None for none or a young device's yes.
    cosigner: Option<u8>,
}

/// What an access key on NEAR may call, as the oracle reads its method list (literal method names).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Meth {
    Phone,
    Dev,
    Words,
    Other,
}
fn meth_of(methods: &[String]) -> Meth {
    let has = |m: &str| methods.iter().any(|x| x.split(',').any(|y| y == m));
    if has("execute") {
        Meth::Phone
    } else if has("approve_recovery") {
        Meth::Dev
    } else if has("finish_recovery") {
        Meth::Words
    } else {
        Meth::Other
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum KeyAct {
    Del(u8),
    Add(u8, Meth),
}

/// A callback the contract scheduled: FB-3's (device key, refill) or release 9's finish (new key, ready_at, asked at).
#[derive(Clone, Copy, Debug, PartialEq)]
enum Cb {
    Dev(u8, bool),
    Rec(u8, u64, u64),
}

/// One receipt the last call made: what it depends on, its key actions, the callback it is (if one), the code switch it
/// makes (the identifier's Debug text) and the upgrade_check arguments sent with it.
#[derive(Clone, Debug)]
struct WRec {
    deps: Vec<usize>,
    acts: Vec<KeyAct>,
    cb: Option<Cb>,
    switch: Option<String>,
    check_args: Option<Value>,
}

/// NEAR's side: a receipt's key actions all apply or none do (a delete of a missing key or an add of a present one fails).
fn w_apply(near: &mut BTreeMap<u8, Meth>, acts: &[KeyAct]) -> bool {
    let mut n = near.clone();
    for a in acts {
        match *a {
            KeyAct::Del(k) => {
                if n.remove(&k).is_none() {
                    return false;
                }
            }
            KeyAct::Add(k, m) => {
                if n.contains_key(&k) {
                    return false;
                }
                n.insert(k, m);
            }
        }
    }
    *near = n;
    true
}

#[derive(Clone, Debug)]
struct W {
    floor: u64,
    fallback: u64,
    created: u64,
    phones: Vec<u8>,
    sealed: bool,
    backup: Option<u8>,
    devices: Vec<(u8, u64)>, // (key fill, age counted from)
    recovery: Option<(u8, u64, u64)>,
    yes: Option<(u8, u64, u8)>, // (new key, ready_at, device)
    stop_asked: bool,
    freeze: Option<u64>,
    bands: Vec<Band>,
    pending: Vec<WMeta>,
    /// Release 9: the finish on its way (new key, ready_at, asked at).
    finishing: Option<(u8, u64, u64)>,
    /// Release 9: the release list (indices of w_release).
    releases: Vec<u8>,
    /// NEAR's access keys of the account.
    near: BTreeMap<u8, Meth>,
    /// Scheduled callbacks not yet delivered, each with the outcome its receipt had (true: the receipt succeeded).
    callbacks: Vec<(Cb, bool)>,
    /// Set by `finish` when an Upgrade ran in this call.
    ran_upgrade: Option<u8>,
    /// A device recorded by release 7 whose key is missing on NEAR (FB-3's repair case), until its key is back.
    missing: Option<u8>,
    /// Every key that has been on NEAR in this run (smoke fault H-r9-1: on an unsealed list, a key learned as a phone
    /// must be one of the account's keys on NEAR; one that was there and is gone can sign nothing).
    ever: std::collections::BTreeSet<u8>,
    /// New keys of finishes whose callback was lost (it ran out of its reserved gas: nothing it would do happened).
    lost: std::collections::BTreeSet<u8>,
}

impl W {
    fn has_device(&self, k: u8) -> bool {
        self.devices.iter().any(|(d, _)| *d == k)
    }
    fn aged(&self, k: u8, now: u64) -> bool {
        self.devices.iter().find(|(d, _)| *d == k).is_some_and(|(_, at)| now >= at.saturating_add(self.floor))
    }
    fn n_aged(&self, now: u64) -> usize {
        self.devices.iter().filter(|(d, _)| self.aged(*d, now)).count()
    }
    fn cosigned(&self, m: &WMeta, now: u64) -> bool {
        m.approved && m.cosigner.is_some_and(|d| self.aged(d, now))
    }
    fn yes_valid(&self, now: u64) -> bool {
        match (self.yes, self.recovery) {
            (Some((k, t, d)), Some((rk, _, rt))) => k == rk && t == rt && self.aged(d, now),
            _ => false,
        }
    }
    fn frozen(&self, now: u64) -> bool {
        self.recovery.is_some() || now < self.freeze.unwrap_or(0)
    }
    fn in_use(&self, k: u8) -> bool {
        self.phones.contains(&k) || self.has_device(k) || self.backup == Some(k) || self.recovery.is_some_and(|r| r.0 == k) || self.finishing.is_some_and(|f| f.0 == k)
    }
    /// The recovery's new key, waiting or finishing: it never acts as the phone (release 9).
    fn becoming(&self, k: u8) -> bool {
        self.recovery.is_some_and(|r| r.0 == k) || self.finishing.is_some_and(|f| f.0 == k)
    }
    /// May key k act as the phone (the contract's device gate, from the shadow's own records)?
    fn may_act(&self, k: u8) -> bool {
        !self.has_device(k) && self.backup != Some(k) && !self.becoming(k) && (self.phones.contains(&k) || (!self.sealed && self.phones.len() < 8))
    }
    /// Can the recovery that waits finish now (the words' rule; release 9: checked at the finish and at its callback)?
    fn may_finish(&self, now: u64) -> bool {
        match self.recovery {
            Some((_, start, ready)) => now >= ready && (self.n_aged(now) == 0 || self.yes_valid(now) || now >= start + self.fallback),
            None => false,
        }
    }
    fn drop_alone(&mut self, now: u64) {
        let keep: Vec<bool> = self.pending.iter().map(|m| self.cosigned(m, now)).collect();
        let mut i = 0;
        self.pending.retain(|_| {
            i += 1;
            keep[i - 1]
        });
    }
    fn restart_young(&mut self, from: u64, now: u64) {
        let floor = self.floor;
        for (_, at) in self.devices.iter_mut().filter(|(_, at)| now < at.saturating_add(floor)) {
            *at = from;
        }
    }
    fn unrecord_device(&mut self, k: u8) {
        self.devices.retain(|(d, _)| *d != k);
        if self.devices.is_empty() {
            let floor_s = self.floor / SECOND;
            for b in self.bands.iter_mut().filter(|b| w_needs(&b.level)) {
                let s = w_wait_ns(&b.level).div_ceil(SECOND).max(floor_s);
                b.level = Level::Wait { seconds: U64(s) };
            }
        }
    }
    fn end_recovery(&mut self, freeze: bool, now: u64) {
        self.recovery = None;
        self.yes = None;
        self.stop_asked = false;
        if freeze {
            let until = now + self.floor;
            self.freeze = Some(until);
            self.restart_young(until, now);
        } else {
            let from = now.max(self.freeze.unwrap_or(0));
            self.restart_young(from, now);
        }
        self.drop_alone(now);
    }
    /// The recovery's end by its finish (release 9: in the callback, after the add succeeded).
    fn complete(&mut self, k: u8, now: u64) {
        self.phones = vec![k];
        self.sealed = true;
        self.recovery = None;
        self.yes = None;
        self.stop_asked = false;
        self.drop_alone(now);
        // R8-F1 fix: a waiting removal of the new phone's key goes too, co-signed or not.
        self.pending.retain(|m| m.kind != WKind::RemoveKey(k));
        self.freeze = None;
        let young: Vec<u8> = self.devices.iter().filter(|(d, _)| !self.aged(*d, now)).map(|(d, _)| *d).collect();
        for d in young {
            self.unrecord_device(d);
        }
    }
    /// What a request does when it runs (it has already left `pending`).
    fn finish(&mut self, m: &WMeta, co: bool, now: u64) -> Result<(), String> {
        match m.kind {
            WKind::Spend => {}
            WKind::Upgrade(h) => {
                if !self.releases.contains(&h) {
                    return Err(format!("an upgrade to release {h}, which is not on the list {:?}, ran", self.releases));
                }
                self.ran_upgrade = Some(h);
            }
            WKind::AllowRelease(h, asked) => {
                // Literals: co-signed by a device of age, or after max(fallback, floor) from when it was asked.
                if !co && now < asked + self.fallback.max(self.floor) {
                    return Err(format!("the release list grew by {h} with no co-sign, {} s after it was asked (owed {} s)", (now - asked) / SECOND, self.fallback.max(self.floor) / SECOND));
                }
                if !self.releases.contains(&h) {
                    if self.releases.len() >= 4 {
                        self.releases.remove(0);
                    }
                    self.releases.push(h);
                }
            }
            WKind::Protection(b) => self.bands = w_bands(b),
            WKind::AddDevice(k) => {
                if self.in_use(k) || self.devices.len() >= 4 {
                    return Err(format!("a second device {k} was added though the key is in use or four are there"));
                }
                let from = if self.recovery.is_some() { u64::MAX } else { now.max(self.freeze.unwrap_or(0)) };
                self.devices.push((k, from));
            }
            WKind::RemoveKey(k) => {
                if self.backup == Some(k) {
                    return Err(format!("RK: the removal of key {k} ran while it is the backup key"));
                }
                // R8-F1: the account always keeps a phone.
                if self.phones == [k] {
                    return Err(format!("a removal deleted the key of the only phone ({k})"));
                }
                if self.recovery.is_some_and(|r| r.0 == k) {
                    return Err(format!("a removal of the waiting recovery's new key ({k}) ran"));
                }
                self.phones.retain(|p| *p != k);
                if self.has_device(k) {
                    self.unrecord_device(k);
                }
            }
            WKind::SetWords(k) => {
                if self.in_use(k) && self.backup != Some(k) {
                    return Err(format!("new backup words to key {k}, which is in use, ran"));
                }
                if self.backup.is_some() && self.recovery.is_some() {
                    self.end_recovery(false, now);
                }
                self.backup = Some(k);
            }
            WKind::Stop => {
                if !co && self.yes_valid(now) {
                    return Err("an unanswered stop ended a recovery a device of age said yes to".into());
                }
                self.end_recovery(!co, now);
            }
        }
        Ok(())
    }
}

fn fill_of(data: &[u8]) -> u8 {
    data.first().copied().unwrap_or(0)
}

/// The receipts the last call made, in the order made (a receipt's index is its place in this list).
fn w_receipts() -> Vec<WRec> {
    let mut out = vec![];
    for r in near_sdk::test_utils::get_created_receipts() {
        let mut w = WRec { deps: r.receipt_indices.iter().map(|i| *i as usize).collect(), acts: vec![], cb: None, switch: None, check_args: None };
        for a in &r.actions {
            match a {
                MockAction::DeleteKey { public_key, .. } => w.acts.push(KeyAct::Del(fill_of(public_key.key_data()))),
                MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } => w.acts.push(KeyAct::Add(fill_of(public_key.key_data()), meth_of(method_names))),
                MockAction::UseGlobalContract { contract_id, .. } => w.switch = Some(format!("{contract_id:?}")),
                MockAction::FunctionCallWeight { method_name, args, .. } => {
                    let v: Value = serde_json::from_slice(args).unwrap_or(Value::Null);
                    match method_name.as_slice() {
                        b"on_second_device_key" => {
                            let k: Base64VecU8 = serde_json::from_value(v["public_key"].clone()).unwrap();
                            w.cb = Some(Cb::Dev(fill_of(&k.0[1..]), v["refill"].as_bool().unwrap()));
                        }
                        b"on_recovery_key" => {
                            let k: Base64VecU8 = serde_json::from_value(v["new_key"].clone()).unwrap();
                            let t: U64 = serde_json::from_value(v["ready_at_ns"].clone()).unwrap();
                            let a: U64 = serde_json::from_value(v["asked_at_ns"].clone()).unwrap();
                            w.cb = Some(Cb::Rec(fill_of(&k.0[1..]), t.0, a.0));
                        }
                        b"upgrade_check" => w.check_args = Some(v),
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        out.push(w);
    }
    out
}

fn w_cells() -> HashMap<Vec<u8>, Vec<u8>> {
    SEQ_KEYS.iter().filter_map(|k| env::storage_read(k).map(|v| (k.to_vec(), v))).collect()
}

/// Does the contract's device gate let `signer` act as the phone on this state? (A probe on a copy; nothing is kept.)
fn w_gate(p: &AccountPolicy, signer: u8, now: u64, cells: &HashMap<Vec<u8>, Vec<u8>>) -> bool {
    env_as(signer, now, cells.clone());
    let mut q: AccountPolicy = borsh::from_slice(&borsh::to_vec(p).unwrap()).unwrap();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| q.device_gate())).is_ok()
}

/// W_TRACE=1 prints every call of the wide driver (for replaying a seed or a finding by hand; off while fuzzing).
fn w_trace() -> bool {
    static T: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *T.get_or_init(|| std::env::var_os("W_TRACE").is_some())
}

/// The contract's own gate for a key's methods (phone: device_gate; second device: second_device_gate; words: words_gate),
/// probed on a copy: does it let `signer` act?
fn w_gate_for(p: &AccountPolicy, signer: u8, m: Meth, now: u64, cells: &HashMap<Vec<u8>, Vec<u8>>) -> bool {
    env_as(signer, now, cells.clone());
    let mut q: AccountPolicy = borsh::from_slice(&borsh::to_vec(p).unwrap()).unwrap();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match m {
        Meth::Phone => q.device_gate(),
        Meth::Dev => q.second_device_gate(),
        Meth::Words => q.words_gate(),
        Meth::Other => {}
    }))
    .is_ok()
        && m != Meth::Other
}

fn has_renew(recs: &[WRec], k: u8, m: Meth) -> bool {
    recs.iter().any(|r| r.acts.contains(&KeyAct::Del(k)) && r.acts.contains(&KeyAct::Add(k, m)))
}

/// `cfg`: [delay pick, devices (count bits 0-1, aged bits 2-4, unsealed phone list bit 5, device 9's key missing on
/// NEAR bit 7), bands preset / setup window
/// bit 3 / backup words bits 4-5 / release 0 listed bit 6]; each op is (kind, signer, argument, extra). Returns the
/// number of accepted calls, or the first violation / crash.
pub fn drive_recovery_wide(cfg: [u8; 3], ops: &[(u8, u8, u8, u8)]) -> Result<usize, String> {
    let delay = [DAY_NS, 2 * DAY_NS, 3 * DAY_NS, 7 * DAY_NS, 30 * DAY_NS][usize::from(cfg[0] % 5)];
    // Literals, not the contract's helpers: 3 × delay within [7 d, 30 d]; floor = delay + min(delay, 1 d).
    let fallback = (3 * delay).clamp(7 * DAY_NS, 30 * DAY_NS);
    let floor = delay + delay.min(DAY_NS);
    let mut now: u64 = 10 * DAY_NS;
    let ndev = usize::from(cfg[1] % 4);
    let devices: Vec<(u8, u64)> = (0..ndev).map(|i| (9 + i as u8, if (cfg[1] >> (2 + i)) & 1 == 1 { 0 } else { now })).collect();
    let sealed = (cfg[1] >> 5) & 1 == 0;
    let mut preset = cfg[2] % 5;
    if ndev == 0 && preset >= 2 {
        preset = 1;
    }
    let created = if (cfg[2] >> 3) & 1 == 1 { now } else { 0 };
    let backup = if (cfg[2] >> 4) & 3 == 0 { None } else { Some(4u8) };
    let releases: Vec<u8> = if (cfg[2] >> 6) & 1 == 1 { vec![0] } else { vec![] };
    let mut p = AccountPolicy { recovery_delay_ns: delay, recovery: None, recovery_key: backup.map(fkey), second_devices: devices.iter().map(|(k, _)| fkey(*k)).collect(), bands: w_bands(preset), pending: vec![], spent: vec![], next_id: 1 };
    let mut cells: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    cells.insert(DEVICES_KEY.to_vec(), borsh::to_vec(&Devices { keys: vec![fkey(1)], sealed, created_at_ns: Some(created) }).unwrap());
    cells.insert(FALLBACK_KEY.to_vec(), borsh::to_vec(&fallback).unwrap());
    if !releases.is_empty() {
        cells.insert(RELEASES_KEY.to_vec(), borsh::to_vec(&vec![w_release(0)]).unwrap());
    }
    // Age rows hashed with the mock's sha256 (an env must exist first).
    env_as(1, now, HashMap::new());
    let rows: Vec<(Vec<u8>, u64)> = devices.iter().map(|(k, at)| (env::sha256(&fkey(*k)), *at)).collect();
    cells.insert(DEVICE_AGES_KEY.to_vec(), borsh::to_vec(&rows).unwrap());
    let mut near: BTreeMap<u8, Meth> = BTreeMap::new();
    near.insert(1, Meth::Phone);
    if let Some(b) = backup {
        near.insert(b, Meth::Words);
    }
    // cfg[1] bit 7: the first device's key is missing on NEAR (an account from release 7, FB-3's repair case).
    let missing = if ndev > 0 && cfg[1] >> 7 == 1 { Some(9u8) } else { None };
    for (k, _) in &devices {
        if Some(*k) != missing {
            near.insert(*k, Meth::Dev);
        }
    }
    let mut sh = W { floor, fallback, created, phones: vec![1], sealed, backup, devices, recovery: None, yes: None, stop_asked: false, freeze: None, bands: w_bands(preset), pending: vec![], finishing: None, releases, near, callbacks: vec![], ran_upgrade: None, missing, ever: Default::default(), lost: Default::default() };
    sh.ever = sh.near.keys().copied().collect();
    let steps = [SECOND, 3_600 * SECOND, DAY_NS / 2, DAY_NS, 2 * DAY_NS, 7 * DAY_NS, 30 * DAY_NS, delay, fallback, floor, DAY_NS.min(delay / 2)];
    let mut accepted = 0usize;
    let trace = w_trace();
    for (n, &(op, who, arg, x)) in ops.iter().take(64).enumerate() {
        let kind = op % 18;
        if kind == 16 {
            now += steps[usize::from(arg) % steps.len()] + u64::from(x % 4) * SECOND;
            continue;
        }
        sh.ran_upgrade = None;
        let phone = sh.phones.first().copied().unwrap_or(1);
        let becoming = sh.recovery.map(|r| r.0).or(sh.finishing.map(|f| f.0)).unwrap_or(5);
        let signer = [phone, sh.backup.unwrap_or(4), 9, 10, 11, 7, 1, 12, 13, becoming][usize::from(who % 10)];
        // H-r9-1: on an unsealed list the contract learns any signer as a phone; NEAR lets only its keys sign, and a key
        // deleted from it signs nothing. (A key never seen on NEAR stands for an older phone key the contract hasn't
        // learned yet; it is put on NEAR when learned. On a sealed list no unknown key passes the gate, so nothing skips.)
        if !sh.sealed && kind != 14 && !sh.near.contains_key(&signer) && sh.ever.contains(&signer) {
            continue;
        }
        let pick = if p.pending.is_empty() { 99 } else { p.pending[usize::from(arg) % p.pending.len()].id.0 };
        let backup_p = borsh::to_vec(&p).unwrap();
        let mut storage = cells.clone();
        // The callbacks (FB-3's and the finish's): static methods that read and write the state themselves, delivered
        // with the outcome their receipt had when it ran (right after the call that made it).
        // Any callback may come next, but the callbacks of one key come in the order they were made (a key's receipts
        // run in order on NEAR; the fuzzer otherwise picks any interleaving with other calls and other keys' callbacks).
        let cb_key = |c: &Cb| match c {
            Cb::Dev(k, _) | Cb::Rec(k, _, _) => *k,
        };
        let cb_i = if kind == 14 && !sh.callbacks.is_empty() {
            let k = cb_key(&sh.callbacks[usize::from(arg) % sh.callbacks.len()].0);
            sh.callbacks.iter().position(|(c, _)| cb_key(c) == k)
        } else {
            None
        };
        let cb = cb_i.map(|i| sh.callbacks[i]);
        // A finish's callback may be lost instead (x bit 6): it ran out of its reserved gas, so nothing it does happens
        // (the finishing marker stays; the words may finish again an hour after they asked).
        if kind == 14 && x & 0x40 != 0 {
            if let (Some(i), Some((Cb::Rec(k, _, _), _))) = (cb_i, cb) {
                sh.callbacks.remove(i);
                sh.lost.insert(k);
                if trace {
                    eprintln!("[{n}] t={}s the finish callback for key {k} is lost", now / SECOND);
                }
                continue;
            }
        }
        if kind == 14 {
            storage.insert(b"STATE".to_vec(), backup_p.clone());
            let ok = cb.is_none_or(|c| c.1);
            env_as_with(phone, now, storage, vec![if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed }]);
        } else {
            env_as(signer, now, storage);
        }
        let spend = w_spend(arg, x);
        let set_key = [4u8, 12, 13, 5, 9][usize::from(arg % 5)];
        let rm_key = [9u8, 10, 11, 12, 13, 4, 1, 5][usize::from(arg % 8)];
        let add_key = [9u8, 10, 11, 12, 13][usize::from(arg % 5)];
        let start_key = [5u8, 6, 12, 9, 1, 13][usize::from(arg % 6)];
        let up_h = x % 3;
        let from_v = [6u32, 7, 8, 9][usize::from((x >> 2) % 4)];
        let rec = p.recovery.clone();
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Option<Outcome> {
            match kind {
                0 => {
                    p.start_recovery(Base64VecU8(fkey(start_key)));
                    None
                }
                1 => {
                    let (k, t) = match &rec {
                        Some(r) => (r.new_key.0.clone(), r.ready_at_ns.0),
                        None => (fkey(5), now + delay),
                    };
                    let k = if x & 1 == 1 { if k == fkey(6) { fkey(5) } else { fkey(6) } } else { k };
                    let t = if x & 2 == 2 { t.wrapping_add(1) } else { t };
                    p.approve_recovery(Base64VecU8(k), U64(t));
                    None
                }
                2 => {
                    p.refuse_recovery([None, Some(false), Some(true)][usize::from(arg % 3)]);
                    None
                }
                3 => Some(p.cancel_recovery()),
                4 => {
                    p.finish_recovery();
                    None
                }
                5 => Some(p.approve(U64(pick))),
                6 => {
                    p.decline(U64(pick));
                    None
                }
                7 => Some(p.run(U64(pick))),
                8 => {
                    p.cancel(U64(pick));
                    None
                }
                9 => Some(p.remove_key(Base64VecU8(fkey(rm_key)))),
                10 => Some(p.add_second_device(Base64VecU8(fkey(add_key)))),
                11 => Some(p.set_recovery_key(Base64VecU8(fkey(set_key)))),
                12 => Some(p.set_protection(w_bands(arg))),
                13 => Some(p.execute(spend.0.parse().unwrap(), spend.1.clone(), None)),
                14 => {
                    match cb {
                        Some((Cb::Dev(k, refill), _)) => AccountPolicy::on_second_device_key(Base64VecU8(fkey(k)), refill),
                        Some((Cb::Rec(k, t, a), _)) => AccountPolicy::on_recovery_key(Base64VecU8(fkey(k)), U64(t), U64(a)),
                        None => {}
                    }
                    if cb.is_some() {
                        if let Some(s) = env::storage_read(b"STATE") {
                            p = borsh::from_slice(&s).unwrap();
                        }
                    }
                    None
                }
                15 => {
                    if arg % 4 < 2 {
                        Some(p.upgrade(Base64VecU8(w_release(up_h))))
                    } else {
                        p.upgrade_check(from_v, if arg % 4 == 2 { Some(Base64VecU8(w_release(up_h))) } else { None });
                        None
                    }
                }
                _ => {
                    p.refill_recovery_key();
                    None
                }
            }
        }));
        let out = match r {
            Err(e) => {
                let msg = panic_text(e);
                if is_crash(&msg) {
                    return Err(format!("crash on op {kind} by key {signer}: {msg}"));
                }
                p = borsh::from_slice(&backup_p).unwrap();
                if trace {
                    eprintln!("[{n}] t={}s op {kind} by {signer} arg {arg} x {x}: refused: {msg}", now / SECOND);
                }
                // Liveness: the words finish a due recovery (unless a finish is on its way, asked less than an hour
                // ago); a device of age says yes to the exact waiting recovery; an aged device refills the words.
                if kind == 4 && Some(signer) == sh.backup && sh.may_finish(now) && sh.finishing.is_none_or(|f| now >= f.2 + W_HOUR) {
                    return Err(format!("the words could not finish a due recovery: {msg}"));
                }
                if kind == 1 && x & 3 == 0 && sh.recovery.is_some() && sh.aged(signer, now) {
                    return Err(format!("a second device of age could not say yes to the waiting recovery: {msg}"));
                }
                if kind == 14 && cb.is_some() {
                    return Err(format!("the callback {cb:?} was refused: {msg}"));
                }
                if kind == 15 && arg % 4 >= 2 {
                    return Err(format!("upgrade_check({from_v}) was refused: {msg}"));
                }
                if kind == 17 && sh.aged(signer, now) && sh.backup.is_some() {
                    return Err(format!("a second device of age could not refill the words: {msg}"));
                }
                continue;
            }
            Ok(o) => o,
        };
        accepted += 1;
        let recs = w_receipts();
        if trace {
            eprintln!("[{n}] t={}s op {kind} by {signer} arg {arg} x {x}: accepted {out:?}; receipts {:?}", now / SECOND, recs.iter().map(|r| (r.deps.clone(), r.acts.clone(), r.cb, r.switch.is_some())).collect::<Vec<_>>());
        }
        cells = w_cells();
        // NEAR runs the call's receipts (in the order made) right after it: a callback's own receipt is the one it
        // depends on. A plain add fails when the key exists, or when the op's top bit says the balance was at the
        // storage edge; its callback is then delivered (op 14) with that outcome, at a moment the fuzzer picks.
        // H-r9-1 (second form): a key the call teaches the contract as a phone was on NEAR BEFORE its receipts ran
        // (a run by a learned key may delete that very key).
        let owner_kind = matches!(kind, 3 | 7 | 8 | 9 | 10 | 11 | 12 | 13) || (kind == 15 && arg % 4 < 2);
        if owner_kind && !sh.sealed && sh.may_act(signer) && !sh.phones.contains(&signer) {
            sh.near.entry(signer).or_insert(Meth::Phone);
            sh.ever.insert(signer);
        }
        // A callback's own receipt is the one made just before it (the contract makes each callback right after the
        // receipt it waits on; the mock's dependency numbers are promise indices, not places in this list: smoke fault
        // H-r9-2, they were one off once the finish chained its add after a delete).
        let deferred: Vec<usize> = recs.iter().enumerate().filter(|(_, r)| r.cb.is_some()).map(|(i, _)| i.saturating_sub(1)).collect();
        let mut new_cbs: Vec<(Cb, bool)> = vec![];
        for (i, r) in recs.iter().enumerate() {
            if let Some(c) = r.cb {
                if i == 0 || r.deps.len() != 1 {
                    return Err(format!("a callback with no receipt before it: {:?}", r.deps));
                }
                let dep = i - 1;
                let acts = recs.get(dep).map(|d| d.acts.clone()).unwrap_or_default();
                let plain_add = acts.iter().all(|a| matches!(a, KeyAct::Add(..)));
                let edge = plain_add && x & 0x80 != 0;
                let ok = if edge { false } else { w_apply(&mut sh.near, &acts) };
                // Release 9 (the red team's RT3): a finish's add fails only at the storage edge, never because its key is
                // already on NEAR from an earlier finish whose callback never ran: else the recovery can never complete.
                if let Cb::Rec(k, _, _) = c {
                    if !edge && !ok {
                        return Err(format!("RT3: the finish's add of key {k} fails (the key is already on NEAR: {:?}), so this recovery can never complete", sh.near.get(&k)));
                    }
                }
                new_cbs.push((c, ok));
            } else if !deferred.contains(&i) {
                let _ = w_apply(&mut sh.near, &r.acts);
            }
        }
        // ── the shadow's prediction for this accepted call ──
        let can_act = sh.may_act(signer);
        let owner = |sh: &mut W| -> Result<(), String> {
            if !can_act {
                if sh.becoming(signer) {
                    return Err(format!("the new key {signer} acted as the phone (op {kind}) before its recovery completed"));
                }
                return Err(format!("an owner method (op {kind}) accepted from key {signer} (phones {:?}, sealed {})", sh.phones, sh.sealed));
            }
            if !sh.phones.contains(&signer) {
                // (H-r9-1: put on NEAR before the receipts ran, above.)
                sh.phones.push(signer);
            }
            Ok(())
        };
        // Placement of a waiting request (or its run at once).
        let placed = |sh: &mut W, o: Outcome, k: WKind, level: Level, owed: u64| -> Result<(), String> {
            if o.done {
                if level != Level::FaceId || owed != 0 {
                    return Err(format!("{k:?} ran at once at level {level:?}, owed {owed}"));
                }
                let m = WMeta { id: o.id.map_or(0, |i| i.0), kind: k, ready: now, needs_device: false, approved: false, cosigner: None };
                return sh.finish(&m, false, now);
            }
            let ready = o.ready_at_ns.ok_or("waiting with no time")?.0;
            let wait = ready.checked_sub(now).ok_or("ready before now")?;
            if wait < owed.max(w_wait_ns(&level)) {
                return Err(format!("{k:?} waits {wait} < {} (level {level:?}, owed {owed})", owed.max(w_wait_ns(&level))));
            }
            if w_needs(&level) && !o.needs_device {
                return Err(format!("{k:?} at {level:?} placed without the second device"));
            }
            sh.pending.push(WMeta { id: o.id.ok_or("no id")?.0, kind: k, ready, needs_device: o.needs_device, approved: false, cosigner: None });
            Ok(())
        };
        let strictest = sh.bands.last().map(|b| b.level.clone()).unwrap_or(Level::FaceId);
        let setup = now < sh.created.saturating_add(DAY_NS);
        let unchanged = || borsh::to_vec(&p).unwrap() == backup_p;
        match kind {
            0 => {
                if Some(signer) != sh.backup || sh.recovery.is_some() {
                    return Err(format!("start_recovery by key {signer} (backup {:?}) with recovery {:?}", sh.backup, sh.recovery));
                }
                if sh.in_use(start_key) {
                    return Err(format!("a recovery to key {start_key}, already on the account (or finishing)"));
                }
                sh.recovery = Some((start_key, now, now + delay));
                sh.yes = None;
                sh.stop_asked = false;
                sh.drop_alone(now);
                sh.restart_young(u64::MAX, now);
            }
            1 => {
                let (k, _, t) = sh.recovery.ok_or("a yes with no recovery waiting")?;
                if !sh.aged(signer, now) || x & 3 != 0 {
                    return Err(format!("approve_recovery accepted: key {signer} (aged {}), wrong key/time bits {}", sh.aged(signer, now), x & 3));
                }
                sh.yes = Some((k, t, signer));
            }
            2 => {
                if !sh.aged(signer, now) || sh.recovery.is_none() {
                    return Err(format!("refuse_recovery accepted from key {signer}"));
                }
                if arg % 3 == 2 {
                    let i = sh.pending.iter().position(|m| m.kind == WKind::Stop).ok_or("a confirmed stop with no stop waiting")?;
                    let m = sh.pending.remove(i);
                    let before = sh.freeze;
                    sh.finish(&m, true, now)?;
                    if sh.freeze != before {
                        return Err("a confirmed stop wrote a freeze".into());
                    }
                } else {
                    sh.end_recovery(true, now);
                }
            }
            3 => {
                let o = out.unwrap();
                owner(&mut sh)?;
                if sh.recovery.is_none() || sh.pending.iter().any(|m| m.kind == WKind::Stop) {
                    return Err("cancel_recovery with no recovery or with a stop waiting".into());
                }
                if sh.n_aged(now) == 0 {
                    if !o.done {
                        return Err("the phone's stop with no device of age did not end at once".into());
                    }
                    sh.end_recovery(true, now);
                } else {
                    if sh.stop_asked {
                        return Err("a second stop of one recovery".into());
                    }
                    let want = now + DAY_NS.min(delay / 2) / SECOND * SECOND;
                    if o.done || o.ready_at_ns.map(|t| t.0) != Some(want) || o.needs_device {
                        return Err(format!("the phone's stop with a device of age: {o:?}"));
                    }
                    sh.stop_asked = true;
                    sh.pending.push(WMeta { id: o.id.ok_or("no id")?.0, kind: WKind::Stop, ready: want, needs_device: false, approved: false, cosigner: None });
                }
            }
            4 => {
                let (k, _, ready) = sh.recovery.ok_or("finished with no recovery")?;
                if Some(signer) != sh.backup {
                    return Err(format!("finish_recovery from key {signer}"));
                }
                if now < ready {
                    return Err("finished before the delay".into());
                }
                if !sh.may_finish(now) {
                    return Err("finished before the fallback with no yes from a device of age".into());
                }
                if let Some((_, _, asked)) = sh.finishing {
                    if now < asked + W_HOUR {
                        return Err(format!("a second finish {} s after the first, under the hour", (now - asked) / SECOND));
                    }
                }
                // Release 9 (R8-RS1): the finish only adds the new key and schedules its callback; nothing is deleted,
                // nothing else changes yet.
                // (r9-frozen-3, RT3's fix: it deletes its own new key first, in a receipt of its own, then adds it in a
                // receipt chained after the delete; RT3-b's fix: a stale finish's key, if another one, is deleted too.)
                let stale = sh.finishing.map(|f| f.0).filter(|s| *s != k);
                if recs.iter().any(|r| r.acts.iter().any(|a| matches!(a, KeyAct::Del(d) if *d != k && Some(*d) != stale))) {
                    return Err("finish_recovery deleted a key other than its new one (or a stale finish's) before its add was seen".into());
                }
                if let Some(old) = stale {
                    if !recs.iter().any(|r| r.acts == vec![KeyAct::Del(old)]) {
                        return Err(format!("RT3-b: a finish over a stale one (key {old}) did not delete the stale key"));
                    }
                }
                if new_cbs.len() != 1 || new_cbs[0].0 != Cb::Rec(k, ready, now) || !recs.iter().any(|r| r.acts == vec![KeyAct::Add(k, Meth::Phone)]) {
                    return Err(format!("finish_recovery did not add key {k} with its callback: {new_cbs:?}"));
                }
                if !unchanged() {
                    return Err("finish_recovery changed the state before its callback".into());
                }
                sh.finishing = Some((k, ready, now));
            }
            5 => {
                let o = out.unwrap();
                if !sh.has_device(signer) {
                    return Err(format!("approve accepted from key {signer}, no second device"));
                }
                let i = sh.pending.iter().position(|m| m.id == pick).ok_or("approved a request the oracle doesn't know")?;
                let m = sh.pending[i].clone();
                if !(m.needs_device || m.kind.setting() || m.kind == WKind::Stop) {
                    return Err(format!("approve of {:?}, which doesn't need a device", m.kind));
                }
                if !m.needs_device && !sh.aged(signer, now) {
                    return Err(format!("a young device ({signer}) co-signed {:?}", m.kind));
                }
                let co_before = sh.cosigned(&m, now);
                let mut m2 = m.clone();
                m2.approved = true;
                if sh.aged(signer, now) {
                    m2.cosigner = Some(signer);
                } else if !co_before {
                    m2.cosigner = None;
                }
                let may_run = m.kind == WKind::Stop || ((sh.recovery.is_none() || sh.cosigned(&m2, now)) && now >= m.ready);
                if o.done != may_run {
                    return Err(format!("approve of {:?} by {signer}: ran {} but the oracle says {may_run}", m.kind, o.done));
                }
                if o.done {
                    sh.pending.remove(i);
                    let co = sh.cosigned(&m2, now);
                    sh.finish(&m2, co, now)?;
                } else {
                    sh.pending[i] = m2;
                }
            }
            6 => {
                if !sh.has_device(signer) {
                    return Err(format!("decline accepted from key {signer}"));
                }
                let i = sh.pending.iter().position(|m| m.id == pick).ok_or("declined a request the oracle doesn't know")?;
                let m = sh.pending[i].clone();
                if m.kind == WKind::Stop {
                    if !sh.aged(signer, now) {
                        return Err("a young device refused the phone's stop".into());
                    }
                } else {
                    if matches!(m.kind, WKind::RemoveKey(k) if sh.has_device(k)) {
                        return Err("a second device stopped a second device's removal".into());
                    }
                    let disputed = sh.recovery.is_some() && sh.aged(signer, now) && !sh.cosigned(&m, now);
                    if !m.needs_device && !disputed {
                        return Err(format!("decline of {:?}, which needs no device, outside a dispute", m.kind));
                    }
                }
                sh.pending.remove(i);
            }
            7 => {
                owner(&mut sh)?;
                let i = sh.pending.iter().position(|m| m.id == pick).ok_or("ran a request the oracle doesn't know")?;
                let m = sh.pending[i].clone();
                if now < m.ready || (m.needs_device && !m.approved) {
                    return Err(format!("{:?} ran early or without its device", m.kind));
                }
                let co = sh.cosigned(&m, now);
                if sh.recovery.is_some() && m.kind != WKind::Stop && !co {
                    return Err(format!("{:?}, asked by the phone alone, ran while a recovery waits", m.kind));
                }
                sh.pending.remove(i);
                sh.finish(&m, co, now)?;
            }
            8 => {
                owner(&mut sh)?;
                let i = sh.pending.iter().position(|m| m.id == pick).ok_or("cancelled a request the oracle doesn't know")?;
                sh.pending.remove(i);
            }
            9 => {
                owner(&mut sh)?;
                if sh.backup == Some(rm_key) || signer == rm_key {
                    return Err(format!("remove_key of the backup key or the phone's own key ({rm_key}) accepted"));
                }
                let is_dev = sh.has_device(rm_key);
                let level = if is_dev {
                    match strictest.clone() {
                        Level::FaceId | Level::Device => Level::FaceId,
                        Level::Wait { seconds } | Level::Both { seconds } => Level::Wait { seconds },
                    }
                } else {
                    strictest.clone()
                };
                let owed = if is_dev && sh.aged(rm_key, now) { floor.max(fallback) } else { floor };
                placed(&mut sh, out.unwrap(), WKind::RemoveKey(rm_key), level, owed)?;
            }
            10 => {
                owner(&mut sh)?;
                let o = out.unwrap();
                if sh.has_device(add_key) {
                    // The refill (FB-3): at once, never removes the device, the key renewed, and a callback with refill.
                    if !o.done || o.id.is_some() {
                        return Err("a refill did not go at once".into());
                    }
                    if !has_renew(&recs, add_key, Meth::Dev) || !new_cbs.iter().any(|c| c.0 == Cb::Dev(add_key, true)) {
                        return Err("a refill made no delete-and-add or no callback".into());
                    }
                } else {
                    if sh.in_use(add_key) || sh.devices.len() >= 4 {
                        return Err(format!("add_second_device({add_key}) accepted: in use or four devices"));
                    }
                    let (level, owed) = if setup { (if sh.devices.is_empty() { Level::FaceId } else { strictest.clone() }, 0) } else { (strictest.clone(), floor) };
                    placed(&mut sh, o, WKind::AddDevice(add_key), level, owed)?;
                }
            }
            11 => {
                owner(&mut sh)?;
                let o = out.unwrap();
                if sh.backup == Some(set_key) {
                    if !o.done || !has_renew(&recs, set_key, Meth::Words) {
                        return Err("the backup key's renewal did not go at once".into());
                    }
                } else {
                    if sh.in_use(set_key) {
                        return Err(format!("set_recovery_key({set_key}) accepted for a key in use"));
                    }
                    if sh.recovery.is_some() {
                        return Err("new backup words asked while a recovery waits".into());
                    }
                    let (level, owed) = if sh.backup.is_none() { (Level::FaceId, 0) } else { (strictest.clone(), floor) };
                    placed(&mut sh, o, WKind::SetWords(set_key), level, owed)?;
                }
            }
            12 => {
                owner(&mut sh)?;
                if w_bands(arg).iter().any(|b| w_needs(&b.level)) && sh.devices.is_empty() {
                    return Err("bands needing a device accepted with none".into());
                }
                placed(&mut sh, out.unwrap(), WKind::Protection(arg % 5), strictest.clone(), if setup { 0 } else { floor })?;
            }
            13 => {
                owner(&mut sh)?;
                // RS-1: each step at most 300 Tgas, all of them at most 250 Tgas (saturating), as literals.
                let gases: Vec<u64> = spend.1.iter().map(|s| if let Step::FunctionCall { gas, .. } = s { gas.0 } else { 0 }).collect();
                if gases.iter().any(|g| *g > 300 * W_TGAS) || gases.iter().fold(0u64, |a, g| a.saturating_add(*g)) > 250 * W_TGAS {
                    return Err(format!("RS-1: execute accepted steps with gas {gases:?}"));
                }
                // RS-2 and the bands: the level is at least the band of what this request alone moves (gas as NEAR).
                let alone = w_level_alone(&sh.bands, &spend.2);
                let level = if sh.frozen(now) {
                    let f = U64(floor / SECOND);
                    match alone {
                        Level::FaceId => Level::Wait { seconds: f },
                        Level::Device => Level::Both { seconds: f },
                        Level::Wait { seconds } => Level::Wait { seconds: U64(seconds.0.max(f.0)) },
                        Level::Both { seconds } => Level::Both { seconds: U64(seconds.0.max(f.0)) },
                    }
                } else {
                    alone
                };
                let o = out.unwrap();
                if o.done && sh.frozen(now) {
                    return Err("a spend ran at Face ID while the account is frozen".into());
                }
                if o.done && level != Level::FaceId {
                    return Err(format!("a spend ran at once below its band: {level:?} ({:?})", spend.2));
                }
                if !o.done {
                    placed(&mut sh, o, WKind::Spend, level, 0)?;
                }
            }
            14 => {
                if let (Some(i), Some((c, ok))) = (cb_i, cb) {
                    sh.callbacks.remove(i);
                    let failed = !ok;
                    let dels: Vec<u8> = recs.iter().flat_map(|r| r.acts.iter()).filter_map(|a| if let KeyAct::Del(k) = a { Some(*k) } else { None }).collect();
                    match c {
                        Cb::Dev(k, refill) => {
                            let recorded = p.second_devices.iter().any(|d| *d == fkey(k));
                            // FB-3: the callback never deletes a key (a failed add only unrecords the device).
                            if !dels.is_empty() {
                                return Err(format!("FB-3: the callback (failed {failed}, refill {refill}) deleted a key"));
                            }
                            if failed && sh.has_device(k) {
                                if refill {
                                    if !recorded {
                                        return Err(format!("FB-3: a failed refill removed device {k}"));
                                    }
                                    if !recs.iter().any(|r| r.acts.contains(&KeyAct::Add(k, Meth::Dev))) {
                                        return Err(format!("FB-3: a failed refill did not add key {k} again"));
                                    }
                                } else {
                                    if recorded {
                                        return Err(format!("FB-3: device {k} is still recorded after its add failed"));
                                    }
                                    sh.unrecord_device(k);
                                }
                            } else if !unchanged() {
                                return Err(format!("FB-3: a callback (failed {failed}, refill {refill}, recorded {}) changed the state", sh.has_device(k)));
                            }
                        }
                        Cb::Rec(k, _, a) if sh.finishing.is_none_or(|f| f.0 != k || f.2 != a) => {
                            // r9-frozen-3: a callback whose finish was superseded (a retry, or another finish) does
                            // nothing at all: no state, no key, no marker.
                            if !unchanged() || !recs.is_empty() {
                                return Err(format!("a superseded finish callback (key {k}, asked {}) acted: {recs:?}", a / SECOND));
                            }
                        }
                        Cb::Rec(k, t, _) => {
                            // Release 9 (R8-RS1): the finish completes only if its add succeeded, the same recovery
                            // still waits, and it may still finish (the oracle's own rule, as at the finish).
                            let same = sh.recovery.is_some_and(|r| r.0 == k && r.2 == t);
                            let go = ok && same && sh.may_finish(now);
                            sh.finishing = None;
                            if go {
                                sh.complete(k, now);
                            } else {
                                if !unchanged() {
                                    return Err(format!("the finish's callback (add ok {ok}, same {same}) changed the state with no finish"));
                                }
                                if failed {
                                    if !recs.is_empty() {
                                        return Err(format!("after a failed add of key {k}, the callback made receipts (deleted {dels:?})"));
                                    }
                                } else {
                                    let role = sh.phones.contains(&k) || sh.has_device(k) || sh.backup == Some(k);
                                    if dels != if role { vec![] } else { vec![k] } {
                                        return Err(format!("the finish's callback for an unfinished recovery deleted {dels:?} (key {k}, role {role})"));
                                    }
                                }
                            }
                        }
                    }
                }
            }
            15 => {
                if arg % 4 < 2 {
                    owner(&mut sh)?;
                    // Release 9: a listed release, or one whose addition waits, is a switch; any other, its addition.
                    let asked = sh.pending.iter().any(|m| matches!(m.kind, WKind::AllowRelease(h, _) if h == up_h));
                    let k = if sh.releases.contains(&up_h) || asked { WKind::Upgrade(up_h) } else { WKind::AllowRelease(up_h, now) };
                    placed(&mut sh, out.unwrap(), k, strictest.clone(), floor)?;
                    if let WKind::AllowRelease(..) = k {
                        let q = p.pending.last().ok_or("no request placed")?;
                        if !matches!(&q.change, Change::AllowRelease { code_hash, asked_at_ns } if code_hash.0 == w_release(up_h) && asked_at_ns.0 == now) {
                            return Err(format!("upgrade of an unlisted release placed {:?}", q.change));
                        }
                    }
                } else {
                    if !unchanged() {
                        return Err("upgrade_check changed the state".into());
                    }
                    sh.releases = if arg % 4 == 2 { vec![up_h] } else { vec![] };
                    // Release 9 adds a method to the second device's key: from release 8 or earlier, each is renewed.
                    for (d, _) in sh.devices.clone() {
                        if (from_v < 9) != has_renew(&recs, d, Meth::Dev) {
                            return Err(format!("upgrade_check({from_v}) renewal of device {d}: {}", has_renew(&recs, d, Meth::Dev)));
                        }
                    }
                    if from_v == 9 && !recs.is_empty() {
                        return Err("upgrade_check(9) made receipts".into());
                    }
                }
            }
            _ => {
                // Release 9 (I-2): only a second device of age refills the words, and only their allowance.
                if !sh.aged(signer, now) || sh.backup.is_none() {
                    return Err(format!("refill_recovery_key accepted from key {signer} (device {}, aged {})", sh.has_device(signer), sh.aged(signer, now)));
                }
                let b = sh.backup.unwrap();
                if recs.len() != 1 || !has_renew(&recs, b, Meth::Words) || recs[0].acts.len() != 2 || !unchanged() {
                    return Err(format!("refill_recovery_key did more than renew the words' key: {recs:?}"));
                }
            }
        }
        sh.callbacks.extend(new_cbs.iter().copied());
        // ── the switch (UseGlobalContract) only to a listed release, with release 9's upgrade_check arguments ──
        let switches: Vec<&WRec> = recs.iter().filter(|r| r.switch.is_some()).collect();
        match (sh.ran_upgrade, switches.as_slice()) {
            (None, []) => {}
            (Some(h), [r]) => {
                let want = near_sdk::bs58::encode(w_release(h)).into_string();
                if !r.switch.as_ref().unwrap().contains(&want) || !sh.releases.contains(&h) {
                    return Err(format!("the switch went to {:?}, not listed release {h} ({want})", r.switch));
                }
                let a = r.check_args.as_ref().ok_or("the switch with no upgrade_check call")?;
                let hash_b64: Option<Base64VecU8> = serde_json::from_value(a["code_hash"].clone()).ok();
                if a["from_version"].as_u64() != Some(9) || hash_b64.map(|b| b.0) != Some(w_release(h)) {
                    return Err(format!("the switch's upgrade_check arguments are {a}"));
                }
            }
            (r, s) => return Err(format!("upgrade ran {r:?} with {} switches", s.len())),
        }
        // ── the contract must agree with the shadow ──
        // RK, and NEAR's keys follow the records: after the call's receipts (in the order they were made: a local
        // receipt to this account runs in that order), the backup key, the phone's and every recorded second device's
        // key must not be left deleted. A delete then an add of the same key (a renewal in one batch, or a second waiting
        // set_recovery_key to the current words, which deletes and re-adds it in two receipts) leaves it present.
        // (Smoke fault H-r8-1: the first version demanded the re-add in the SAME receipt.)
        let mut last: Vec<(u8, bool)> = vec![]; // (key, present after the call's receipts)
        for r in &recs {
            for a in &r.acts {
                let (k, present) = match a {
                    KeyAct::Del(k) => (*k, false),
                    KeyAct::Add(k, _) => (*k, true),
                };
                last.retain(|(y, _)| *y != k);
                last.push((k, present));
            }
        }
        for (k, _) in last.iter().filter(|(_, present)| !present) {
            if sh.backup == Some(*k) {
                return Err(format!("RK: the backup key {k}'s access key was deleted while it is the backup"));
            }
            if sh.phones.contains(k) {
                return Err(format!("the phone's key {k} was deleted while it is the phone"));
            }
            if sh.has_device(*k) {
                return Err(format!("second device {k}'s key was deleted while it is recorded"));
            }
        }
        // Release 9: NEAR's keys (receipts replayed, adds' outcomes as the fuzzer chose). The account always keeps a
        // phone's key on NEAR, the words' key while it has words, every recorded device's key (but one whose add's
        // callback is still on its way), and no key without a role (but one with a callback on its way).
        let seen: Vec<u8> = sh.near.keys().copied().collect();
        sh.ever.extend(seen);
        let in_flight = |k: u8| sh.callbacks.iter().any(|(c, _)| matches!(c, Cb::Dev(d, _) | Cb::Rec(d, _, _) if *d == k));
        if !sh.phones.iter().any(|k| sh.near.get(k) == Some(&Meth::Phone)) {
            return Err(format!("no phone key on NEAR: phones {:?}, NEAR {:?}", sh.phones, sh.near));
        }
        if let Some(b) = sh.backup {
            if sh.near.get(&b) != Some(&Meth::Words) {
                return Err(format!("the words' key {b} is not on NEAR with the words' methods: {:?}", sh.near));
            }
        }
        if sh.missing.is_some_and(|m| sh.near.contains_key(&m) || !sh.has_device(m)) {
            sh.missing = None;
        }
        for (d, _) in &sh.devices {
            if !in_flight(*d) && sh.missing != Some(*d) && sh.near.get(d) != Some(&Meth::Dev) {
                return Err(format!("second device {d} is recorded but its key is not on NEAR as a device: {:?}", sh.near));
            }
        }
        for (k, m) in &sh.near {
            let want = if sh.has_device(*k) {
                Some(Meth::Dev)
            } else if sh.backup == Some(*k) {
                Some(Meth::Words)
            } else if sh.phones.contains(k) {
                Some(Meth::Phone)
            } else {
                None
            };
            // A key with no role may stay on NEAR (a lost finish's key; an FB-3 interleaving's device key, O-r9-2): it is
            // checked below, by the contract's own gate for its methods, which must refuse it. A role's key with another
            // role's methods is a violation.
            let excused = want.is_none();
            if want != Some(*m) && !in_flight(*k) && !excused {
                return Err(format!("key {k} is on NEAR as {m:?} with no such role (role {want:?})"));
            }
        }
        let ids: Vec<u64> = p.pending.iter().map(|q| q.id.0).collect();
        let want: Vec<u64> = sh.pending.iter().map(|m| m.id).collect();
        if ids != want {
            return Err(format!("waiting requests differ after op {kind}: contract {ids:?}, oracle {want:?} ({:?})", sh.pending.iter().map(|m| m.kind).collect::<Vec<_>>()));
        }
        let mut cd: Vec<Vec<u8>> = p.second_devices.clone();
        let mut sd: Vec<Vec<u8>> = sh.devices.iter().map(|(k, _)| fkey(*k)).collect();
        cd.sort();
        sd.sort();
        if cd != sd {
            return Err(format!("second devices differ after op {kind}: oracle {:?}", sh.devices));
        }
        if p.recovery_key != sh.backup.map(fkey) {
            return Err(format!("backup key differs after op {kind}: oracle {:?}", sh.backup));
        }
        if p.recovery.as_ref().map(|r| (r.new_key.0.clone(), r.ready_at_ns.0)) != sh.recovery.map(|(k, _, t)| (fkey(k), t)) {
            return Err(format!("recovery differs after op {kind}: oracle {:?}", sh.recovery));
        }
        let freeze: Option<u64> = cells.get(FREEZE_KEY).map(|b| borsh::from_slice(b).unwrap());
        if freeze != sh.freeze {
            return Err(format!("freeze differs after op {kind}: contract {freeze:?}, oracle {:?}", sh.freeze));
        }
        if p.bands != sh.bands {
            return Err(format!("bands differ after op {kind}"));
        }
        if cells.contains_key(STOP_ASKED_KEY) != sh.stop_asked {
            return Err(format!("stop_asked differs after op {kind}: oracle {}", sh.stop_asked));
        }
        let devs: Devices = borsh::from_slice(cells.get(DEVICES_KEY).unwrap()).unwrap();
        if devs.keys != sh.phones.iter().map(|k| fkey(*k)).collect::<Vec<_>>() || devs.sealed != sh.sealed {
            return Err(format!("the phones differ after op {kind}: oracle {:?} sealed {}", sh.phones, sh.sealed));
        }
        let list: Vec<Vec<u8>> = cells.get(RELEASES_KEY).map(|b| borsh::from_slice(b).unwrap()).unwrap_or_default();
        if list != sh.releases.iter().map(|h| w_release(*h)).collect::<Vec<_>>() {
            return Err(format!("the release list differs after op {kind}: contract {:?}, oracle {:?}", list.iter().map(|h| h[0]).collect::<Vec<_>>(), sh.releases));
        }
        if cells.contains_key(FINISHING_KEY) != sh.finishing.is_some() {
            return Err(format!("the finishing marker differs after op {kind}: oracle {:?}", sh.finishing));
        }
        if p.second_devices_of_age() as usize != sh.n_aged(now) {
            return Err(format!("devices of age differ after op {kind}: contract {}, oracle {} ({:?})", p.second_devices_of_age(), sh.n_aged(now), sh.devices));
        }
        if let Some(s) = p.recovery_status() {
            if s.approved != sh.yes_valid(now) || s.needs_device != (sh.n_aged(now) > 0) {
                return Err(format!("recovery_status differs after op {kind}: {s:?}, oracle yes {}", sh.yes_valid(now)));
            }
        }
        // Release 9 probes of the device gate (on a copy): the phone acts (after a failed add too, while finishing
        // too); the recovery's new key, waiting or finishing, never does.
        let cur = sh.phones[0];
        if sh.may_act(cur) && !w_gate(&p, cur, now, &cells) {
            return Err(format!("the phone {cur} can no longer act (finishing {:?}, recovery {:?})", sh.finishing, sh.recovery));
        }
        for k in [sh.recovery.map(|r| r.0), sh.finishing.map(|f| f.0)].into_iter().flatten() {
            if w_gate(&p, k, now, &cells) {
                return Err(format!("the new key {k} passes the device gate before its recovery completed"));
            }
        }
        // A key on NEAR that no role holds must never pass the contract's gate for its methods: nobody granted it that role
        // (a lost finish's phone-method key: RT3-b; an unrecorded device's key: O-r9-2).
        let orphans: Vec<(u8, Meth)> = sh.near.iter().filter(|(k, _)| !sh.phones.contains(k) && !sh.has_device(**k) && sh.backup != Some(**k) && !sh.becoming(**k)).map(|(k, m)| (*k, *m)).collect();
        for (k, m) in orphans {
            if w_gate_for(&p, k, m, now, &cells) {
                return Err(format!("key {k}, on NEAR with {m:?} methods and no role, passes the contract's gate for them"));
            }
        }
    }
    Ok(accepted)
}


/// Release 8 (RS-1): `execute` on an account whose only band waits (nothing runs at once, so no promise is made), with
/// arbitrary steps. Ok(true) accepted, Ok(false) refused by a NEAR panic, Err a crash.
pub fn drive_execute(receiver_pick: u8, steps: Vec<Step>) -> Result<bool, String> {
    let mut p = AccountPolicy { recovery_delay_ns: 2 * DAY_NS, recovery: None, recovery_key: Some(fkey(4)), second_devices: vec![], bands: vec![Band { up_to: None, level: Level::Wait { seconds: U64(3_600) } }], pending: vec![], spent: vec![], next_id: 1 };
    let mut storage = HashMap::new();
    storage.insert(DEVICES_KEY.to_vec(), borsh::to_vec(&Devices { keys: vec![fkey(1)], sealed: true, created_at_ns: Some(0) }).unwrap());
    env_as(1, 10 * DAY_NS, storage);
    let receiver: AccountId = ["bob.near", "usdc.near", "intents.near"][usize::from(receiver_pick % 3)].parse().unwrap();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.execute(receiver, steps, None))) {
        Ok(o) => {
            if o.done {
                return Err("a spend ran at once on a Wait-only account".into());
            }
            Ok(true)
        }
        Err(e) => {
            let msg = panic_text(e);
            if is_crash(&msg) {
                Err(msg)
            } else {
                Ok(false)
            }
        }
    }
}

/// One value per type per thread, built once (the near-sdk config types are not re-exported, so they are not named).
fn cached<T: Clone + 'static>(make: fn() -> T) -> T {
    thread_local! {
        static CACHE: std::cell::RefCell<HashMap<std::any::TypeId, Box<dyn std::any::Any>>> = std::cell::RefCell::new(HashMap::new());
    }
    CACHE.with(|c| c.borrow_mut().entry(std::any::TypeId::of::<T>()).or_insert_with(|| Box::new(make())).downcast_ref::<T>().unwrap().clone())
}
