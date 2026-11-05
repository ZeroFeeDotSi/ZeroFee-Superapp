//! Explicit-state checking of the REAL contract (this module is a child of the pinned lib.rs, see proofs/build.rs):
//! every reachable state up to a depth is visited by breadth-first search over every actor's every action and every
//! time step, with the independent model (model.rs) run in lockstep and compared after each action (conformance), and
//! the security properties checked as invariants of every state and as conditions on every transition. Then long
//! random walks over the same actions. Any violation prints the full action sequence from the start (a counterexample).
//!
//! Run: `cd contracts/account-policy/proofs && cargo test --release checker -- --nocapture --test-threads 1`
//! Depth: `PROOFS_DEPTH=5` (default 4); random walks: `PROOFS_WALKS=5000` (default 2000).
use super::model::{MBand, MKind, MLevel, MOut, Model};
use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{MockedBlockchain, PublicKey};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};
use std::panic::{catch_unwind, AssertUnwindSafe};

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// Keys, by the byte each ML-DSA-65 key is filled with.
const SETUP: u8 = 0;
const P: u8 = 1; // the phone named at `new`
const D1: u8 = 2; // the second device added at set-up
const D2: u8 = 3; // a second device added later
const W: u8 = 4; // the words
const N: u8 = 5; // a recovery's new phone
const W2: u8 = 6; // new words
const N2: u8 = 8; // a second recovery's new phone
const DELAY_S: u64 = 3_600; // one hour: floor = 2 h, a band's wait = 1 day
/// Release 7: the words-only fallback, the least `new` allows (a week on a one-hour delay); the +7 d time step passes it.
const FALLBACK_S: u64 = 7 * 86_400;
const L1: u128 = 10 * NEAR;
const L2: u128 = 100 * NEAR;

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![ML_DSA_65_TAG];
    k.extend(std::iter::repeat(fill).take(ML_DSA_65_PUBLIC_KEY_LEN));
    Base64VecU8(k)
}
fn fill_of(k: &[u8]) -> u8 {
    k[1]
}
fn bob() -> AccountId {
    "bob.near".parse().unwrap()
}

type Storage = HashMap<Vec<u8>, Vec<u8>>;

fn set_env(pred: &str, signer: u8, now: u64, storage: Storage) {
    set_env_results(pred, signer, now, storage, vec![]);
}
/// The same, for a callback: `results` are the results of the receipts it waited on.
fn set_env_results(pred: &str, signer: u8, now: u64, storage: Storage, results: Vec<near_sdk::PromiseResult>) {
    let ctx = VMContextBuilder::new().current_account_id(me()).predecessor_account_id(pred.parse().unwrap()).signer_account_id(me()).signer_account_pk(PublicKey::try_from(key(signer).0).unwrap()).block_timestamp(now).account_balance(NearToken::from_near(1_000_000)).build();
    near_sdk::env::set_blockchain_interface(MockedBlockchain::new(ctx, near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), results, storage, Default::default(), None));
}
fn take_storage() -> Storage {
    near_sdk::mock::with_mocked_blockchain(|b| b.take_storage())
}

// ── Bands used by the checker ────────────────────────────────────────────────────────────────────────────────────

fn band(limit: Option<u128>, level: Level) -> Band {
    Band { up_to: limit.map(|l| vec![("near".to_string(), U128(l))]), level }
}
fn mband(limit: Option<u128>, level: MLevel) -> MBand {
    MBand { up_to: limit, level }
}
/// The protection under test: ≤ 10 NEAR Face ID; ≤ 100 NEAR a day's wait; above, a day and the second device.
fn bands_default() -> (Vec<Band>, Vec<MBand>) {
    (vec![band(Some(L1), Level::FaceId), band(Some(L2), Level::Wait { seconds: U64(86_400) }), band(None, Level::Both { seconds: U64(86_400) })], vec![mband(Some(L1), MLevel::FaceId), mband(Some(L2), MLevel::Wait(86_400)), mband(None, MLevel::Both(86_400))])
}
/// Looser: everything at Face ID (what a thief would set first).
fn bands_loose() -> (Vec<Band>, Vec<MBand>) {
    (vec![band(None, Level::FaceId)], vec![mband(None, MLevel::FaceId)])
}
/// Stricter: everything needs the second device.
fn bands_strict() -> (Vec<Band>, Vec<MBand>) {
    (vec![band(None, Level::Device)], vec![mband(None, MLevel::Device)])
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Act {
    Time(u64),
    /// amount in NEAR (None: an unmeasurable call)
    Exec(u8, Option<u128>),
    Run(u8, u64),
    Cancel(u8, u64),
    SetProt(u8, u8),
    AddDev(u8, u8),
    RemoveKey(u8, u8),
    SetWords(u8, u8),
    Upgrade(u8),
    CancelRec(u8),
    Approve(u8, u64),
    Decline(u8, u64),
    Start(u8, u8),
    Finish(u8),
    Stranger,
    /// Release 7: a second device's yes to the waiting recovery (bound to it), its refusal, and a yes that names another
    /// recovery (a stale finish time), which must be refused.
    ApproveRec(u8),
    RefuseRec(u8),
    ApproveRecStale(u8),
    /// R7-9: the device confirms the phone's waiting stop (no freeze); refused when no stop waits.
    ConfirmStop(u8),
    /// Release 9 (R8-RS1): NEAR runs the add of the new key that the i-th finish still on its way asked for, then its
    /// callback `on_recovery_key` with the add's result: `true` the add succeeded (only possible when the key is not on
    /// NEAR already), `false` NEAR refused it (a balance at the storage edge). Any other action may come in between.
    Callback(usize, bool),
    /// Re-freeze 2 (the red team's RT3): NEAR runs the i-th waiting finish's delete and add of the new key (the add
    /// succeeding if it can), but its callback never runs (it failed as a whole): the contract keeps its FINISHING mark.
    CallbackLost(usize),
    /// Release 9 (I-2): a second device refills the words' fee allowance.
    RefillWords(u8),
}

/// The contract state copied through its own borsh layout (it is not Clone).
fn copy(c: &AccountPolicy) -> AccountPolicy {
    borsh::from_slice(&borsh::to_vec(c).unwrap()).unwrap()
}

/// What the last accepted call asked NEAR to do with keys and code (from the mock's receipt log).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum Emitted {
    AddFn { fill: u8, methods: Vec<String>, allowance: Option<u128>, receiver: String },
    AddFull { fill: u8 },
    Delete { fill: u8 },
    UseGlobal { idx: String },
    Call { idx: String, method: String, args: Vec<u8> },
}

fn emitted() -> Vec<Emitted> {
    emitted_receipts().into_iter().flatten().collect()
}

/// The same, receipt by receipt (NEAR applies a receipt's actions together or not at all).
fn emitted_receipts() -> Vec<Vec<Emitted>> {
    let mut all = vec![];
    for r in near_sdk::mock::with_mocked_blockchain(|b| b.created_receipts()) {
        let mut out = vec![];
        for a in r.actions {
            out.push(match a {
                near_sdk::mock::MockAction::AddKeyWithFunctionCall { public_key, allowance, receiver_id, method_names, .. } => Emitted::AddFn { fill: public_key.key_data()[0], methods: method_names, allowance: allowance.map(|a| a.as_yoctonear()), receiver: receiver_id.to_string() },
                near_sdk::mock::MockAction::AddKeyWithFullAccess { public_key, .. } => Emitted::AddFull { fill: public_key.key_data()[0] },
                near_sdk::mock::MockAction::DeleteKey { public_key, .. } => Emitted::Delete { fill: public_key.key_data()[0] },
                near_sdk::mock::MockAction::UseGlobalContract { receipt_index, .. } => Emitted::UseGlobal { idx: format!("{receipt_index:?}") },
                near_sdk::mock::MockAction::FunctionCallWeight { receipt_index, method_name, args, .. } => Emitted::Call { idx: format!("{receipt_index:?}"), method: String::from_utf8_lossy(&method_name).to_string(), args },
                _ => continue,
            });
        }
        all.push(out);
    }
    all
}

/// The method list a key NEAR holds was added with: 0 the phone's, 1 a second device's, 2 the words', 3 any other.
const K_PHONE: u8 = 0;
const K_SECOND: u8 = 1;
const K_WORDS: u8 = 2;
fn method_code(methods: &[String]) -> u8 {
    let join = methods.join(",");
    if join == DEVICE_METHODS {
        K_PHONE
    } else if join == SECOND_DEVICE_METHODS {
        K_SECOND
    } else if join == RECOVERY_METHODS {
        K_WORDS
    } else {
        3
    }
}

/// Replay one receipt's key actions on the checker's copy of NEAR's access keys: all or nothing, as NEAR does (a delete
/// of a key that isn't there, or an add of one that is, fails the whole receipt). Returns whether it applied.
fn replay(near: &mut BTreeMap<u8, u8>, receipt: &[Emitted]) -> bool {
    let mut tmp = near.clone();
    for a in receipt {
        match a {
            Emitted::AddFn { fill, methods, .. } => {
                if tmp.contains_key(fill) {
                    return false;
                }
                tmp.insert(*fill, method_code(methods));
            }
            Emitted::AddFull { fill } => {
                if tmp.contains_key(fill) {
                    return false;
                }
                tmp.insert(*fill, 9);
            }
            Emitted::Delete { fill } => {
                if tmp.remove(fill).is_none() {
                    return false;
                }
            }
            _ => {}
        }
    }
    *near = tmp;
    true
}

/// The whole world: the real contract and its raw storage, the model, the clock, and the checker's own ledger.
struct World {
    c: AccountPolicy,
    storage: Storage,
    m: Model,
    now: u64,
    /// Who the checker treats as the owner's phone (P, then the recovery's new key after a finish).
    phone: u8,
    /// Payments that left, by the checker's own account: (time, amount, class 0 = at once, 1 = after a wait only,
    /// 2 = with a second device's yes). Pruned past 24 h.
    left: Vec<(u64, u128, u8)>,
    /// What the checker knows about each waiting request: (id, amount if a payment, asked at, class so far).
    asked: Vec<(u64, Option<u128>, u64, bool)>,
    /// When the waiting recovery started.
    started: Option<u64>,
    /// Key and code actions the last accepted call emitted (not part of the state).
    last_emitted: Vec<Emitted>,
    /// Release 9: NEAR's access keys on the account (fill → method list), replayed from every emitted receipt.
    near: BTreeMap<u8, u8>,
    /// Release 9 (R8-RS1): finishes on their way: the new key and ready time their callback was sent (read from the
    /// callback's own arguments), and the finish's key receipts that run before it (re-freeze 2: the new key's delete,
    /// then its add), until the explorer runs them and the callback (`Act::Callback`, `Act::CallbackLost`).
    inflight: Vec<(u8, u64, Vec<Vec<Emitted>>, u64)>,
}

impl Clone for World {
    fn clone(&self) -> World {
        World { c: copy(&self.c), storage: self.storage.clone(), m: self.m.clone(), now: self.now, phone: self.phone, left: self.left.clone(), asked: self.asked.clone(), started: self.started, last_emitted: vec![], near: self.near.clone(), inflight: self.inflight.clone() }
    }
}

fn fingerprint(w: &World) -> (u64, u64) {
    let mut h1 = std::collections::hash_map::DefaultHasher::new();
    let state = borsh::to_vec(&w.c).unwrap();
    state.hash(&mut h1);
    let mut keys: Vec<_> = w.storage.iter().collect();
    keys.sort();
    keys.hash(&mut h1);
    w.now.hash(&mut h1);
    w.phone.hash(&mut h1);
    w.left.hash(&mut h1);
    w.asked.hash(&mut h1);
    w.started.hash(&mut h1);
    w.near.hash(&mut h1);
    w.inflight.hash(&mut h1);
    let a = h1.finish();
    let mut h2 = std::collections::hash_map::DefaultHasher::new();
    (a, &state, &keys, w.now, &w.near, &w.inflight).hash(&mut h2);
    (a, h2.finish())
}

/// The world at set-up: the phone named at `new`, the first words, the first second device (at once in the first
/// 24 hours) and the protection (at once: the account starts at Face ID). Made at t0 (ns).
fn initial(t0: u64) -> World {
    set_env("me.near", SETUP, t0, Storage::new());
    let mut c = AccountPolicy::new(U64(DELAY_S), bands_loose().0, Some(key(P)), Some(U64(FALLBACK_S)));
    let mut m = Model::new(t0, DELAY_S, FALLBACK_S, P);
    m.phones.push(SETUP);
    let storage = take_storage();
    // NEAR's keys after the setup batch: the phone's (added by that batch, with the phone's methods); the batch deleted
    // its own one-time key.
    let mut near = BTreeMap::new();
    near.insert(P, K_PHONE);
    set_env("me.near", P, t0, storage);
    assert!(c.set_recovery_key(key(W)).done);
    assert!(m.set_recovery_key(P, W).unwrap().done);
    assert!(c.add_second_device(key(D1)).done);
    assert!(m.add_second_device(P, D1).unwrap().done);
    assert!(c.set_protection(bands_default().0).done);
    assert!(m.set_protection(P, bands_default().1).unwrap().done);
    for r in emitted_receipts() {
        assert!(replay(&mut near, &r), "a set-up receipt failed on NEAR");
    }
    let storage = take_storage();
    let w = World { c, storage, m, now: t0, phone: P, left: vec![], asked: vec![], started: None, last_emitted: vec![], near, inflight: vec![] };
    let mut errs = vec![];
    conform(&w, &mut errs);
    assert!(errs.is_empty(), "{errs:?}");
    w
}

#[derive(Debug, Clone, PartialEq)]
enum Verdict {
    Ok(Outcome),
    Panic(String),
}

/// Apply one action to the real contract (state restored on a panic, as NEAR reverts a failed receipt) and to the
/// model; return both verdicts. The model is applied even where the contract panicked, on a copy, so the two verdicts
/// are comparable; only the agreed-on state survives.
fn apply(w: &mut World, act: &Act) -> (Verdict, Result<MOut, &'static str>) {
    if let Act::Time(by) = act {
        w.now += by;
        w.m.advance(*by);
        let now = w.now;
        w.left.retain(|(t, _, _)| *t + DAY_NS > now);
        return (Verdict::Ok(Outcome { done: true, id: None, ready_at_ns: None, needs_device: false }), Ok(MOut { done: true, ready_at: None, needs_device: false }));
    }
    if let Act::Callback(i, ok) = act {
        return apply_callback(w, *i, *ok, false);
    }
    if let Act::CallbackLost(i) = act {
        return apply_callback(w, *i, true, true);
    }
    let (pred, signer) = match act {
        Act::Stranger => ("x.near", P),
        Act::Exec(s, _) | Act::Run(s, _) | Act::Cancel(s, _) | Act::SetProt(s, _) | Act::AddDev(s, _) | Act::RemoveKey(s, _) | Act::SetWords(s, _) | Act::Upgrade(s) | Act::CancelRec(s) | Act::Approve(s, _) | Act::Decline(s, _) | Act::Start(s, _) | Act::Finish(s) | Act::ApproveRec(s) | Act::RefuseRec(s) | Act::ApproveRecStale(s) | Act::ConfirmStop(s) | Act::RefillWords(s) => ("me.near", *s),
        Act::Time(_) | Act::Callback(..) | Act::CallbackLost(_) => unreachable!(),
    };
    set_env(pred, signer, w.now, w.storage.clone());
    let mut c = copy(&w.c);
    let steps_of = |amount: Option<u128>| match amount {
        Some(a) => vec![Step::Transfer { deposit: U128(a) }],
        None => vec![Step::FunctionCall { method_name: "do_something".into(), args: Base64VecU8(b"{}".to_vec()), deposit: U128(1), gas: U64(30_000_000_000_000) }],
    };
    let done = Outcome { done: true, id: None, ready_at_ns: None, needs_device: false };
    QUIET.with(|q| q.set(true));
    let r = catch_unwind(AssertUnwindSafe(|| match act {
        Act::Exec(_, amount) => c.execute(bob(), steps_of(*amount), None),
        Act::Stranger => c.execute(bob(), steps_of(Some(NEAR)), None),
        Act::Run(_, id) => c.run(U64(*id)),
        Act::Cancel(_, id) => {
            c.cancel(U64(*id));
            done.clone()
        }
        Act::SetProt(_, which) => c.set_protection(match which {
            0 => bands_default().0,
            1 => bands_loose().0,
            _ => bands_strict().0,
        }),
        Act::AddDev(_, k) => c.add_second_device(key(*k)),
        Act::RemoveKey(_, k) => c.remove_key(key(*k)),
        Act::SetWords(_, k) => c.set_recovery_key(key(*k)),
        Act::Upgrade(_) => c.upgrade(Base64VecU8(vec![7u8; 32])),
        Act::CancelRec(_) => c.cancel_recovery(),
        Act::Approve(_, id) => c.approve(U64(*id)),
        Act::Decline(_, id) => {
            c.decline(U64(*id));
            done.clone()
        }
        Act::Start(_, k) => {
            c.start_recovery(key(*k));
            done.clone()
        }
        Act::Finish(_) => {
            c.finish_recovery();
            done.clone()
        }
        Act::ApproveRec(_) | Act::ApproveRecStale(_) => {
            let (new_key, ready) = w.c.recovery.as_ref().map_or((key(N), U64(0)), |r| (r.new_key.clone(), r.ready_at_ns));
            let ready = if matches!(act, Act::ApproveRecStale(_)) { U64(ready.0.wrapping_sub(SECOND)) } else { ready };
            c.approve_recovery(new_key, ready);
            done.clone()
        }
        Act::RefuseRec(_) => {
            c.refuse_recovery(None);
            done.clone()
        }
        Act::ConfirmStop(_) => {
            c.refuse_recovery(Some(true));
            done.clone()
        }
        Act::RefillWords(_) => {
            c.refill_recovery_key();
            done.clone()
        }
        Act::Time(_) | Act::Callback(..) | Act::CallbackLost(_) => unreachable!(),
    }));
    QUIET.with(|q| q.set(false));
    let verdict = match r {
        Ok(out) => Verdict::Ok(out),
        Err(e) => Verdict::Panic(e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()),
    };
    let mut m = w.m.clone();
    let mr = match act {
        Act::Stranger => Err("only this account's own keys can do this"),
        Act::Exec(s, amount) => m.execute(*s, *amount),
        Act::Run(s, id) => m.run(*s, *id),
        Act::Cancel(s, id) => m.cancel(*s, *id),
        Act::SetProt(s, which) => m.set_protection(
            *s,
            match which {
                0 => bands_default().1,
                1 => bands_loose().1,
                _ => bands_strict().1,
            },
        ),
        Act::AddDev(s, k) => m.add_second_device(*s, *k),
        Act::RemoveKey(s, k) => m.remove_key(*s, *k),
        Act::SetWords(s, k) => m.set_recovery_key(*s, *k),
        Act::Upgrade(s) => m.upgrade(*s),
        Act::CancelRec(s) => m.cancel_recovery(*s),
        Act::Approve(s, id) => m.approve(*s, *id),
        Act::Decline(s, id) => m.decline(*s, *id),
        Act::Start(s, k) => m.start_recovery(*s, *k),
        Act::Finish(s) => m.finish_recovery(*s),
        Act::ApproveRec(s) => m.approve_recovery(*s, false),
        Act::ApproveRecStale(s) => m.approve_recovery(*s, true),
        Act::RefuseRec(s) => m.refuse_recovery(*s, false),
        Act::ConfirmStop(s) => m.refuse_recovery(*s, true),
        Act::RefillWords(s) => m.refill_recovery_key(*s),
        Act::Time(_) | Act::Callback(..) | Act::CallbackLost(_) => unreachable!(),
    };
    w.last_emitted.clear();
    if let Verdict::Ok(_) = verdict {
        let finishing_key = if matches!(act, Act::Finish(_)) { w.c.recovery.as_ref().map(|r| fill_of(&r.new_key.0)) } else { None };
        w.c = c;
        w.last_emitted = emitted();
        let mut stash: Vec<Vec<Emitted>> = vec![];
        for r in emitted_receipts() {
            // The finish's receipts for the new key (its delete, then its add) run on NEAR just before its callback: the
            // explorer decides when, and whether the add succeeds (`Act::Callback`). Every other receipt is replayed now.
            if finishing_key.is_some() && r.iter().any(|x| matches!(x, Emitted::AddFn { fill, .. } | Emitted::Delete { fill } if Some(*fill) == finishing_key)) {
                stash.push(r);
                continue;
            }
            if r.iter().any(|x| matches!(x, Emitted::Call { method, .. } if method == "on_recovery_key")) {
                for x in &r {
                    if let Emitted::Call { method, args, .. } = x {
                        if method == "on_recovery_key" {
                            let v: serde_json::Value = serde_json::from_slice(args).expect("the callback's arguments are JSON");
                            let k: Base64VecU8 = serde_json::from_value(v["new_key"].clone()).expect("new_key");
                            let ready: U64 = serde_json::from_value(v["ready_at_ns"].clone()).expect("ready_at_ns");
                            let asked: U64 = serde_json::from_value(v["asked_at_ns"].clone()).expect("asked_at_ns");
                            w.inflight.push((fill_of(&k.0), ready.0, std::mem::take(&mut stash), asked.0));
                        }
                    }
                }
                continue;
            }
            replay(&mut w.near, &r);
        }
        w.storage = take_storage();
        if mr.is_ok() {
            w.m = m;
        }
    }
    (verdict, mr)
}

/// Release 9 (R8-RS1): NEAR runs the i-th waiting finish's add of the new key (succeeding only if `ok` and the key isn't
/// on NEAR already), then its callback `on_recovery_key`, on the state as it is now, with the add's result. The callback
/// is consumed whatever happens; a callback that panics is reported by `transition`.
fn apply_callback(w: &mut World, i: usize, ok: bool, lost: bool) -> (Verdict, Result<MOut, &'static str>) {
    let (fill, ready, receipts, asked) = w.inflight.remove(i);
    let added = run_finish_receipts(&mut w.near, fill, &receipts, ok);
    w.last_emitted.clear();
    if lost {
        // The callback receipt failed as a whole: nothing in the contract changes (its FINISHING mark stays).
        return (Verdict::Ok(Outcome { done: true, id: None, ready_at_ns: None, needs_device: false }), Ok(MOut { done: true, ready_at: None, needs_device: false }));
    }
    let result = if added { near_sdk::PromiseResult::Successful(vec![]) } else { near_sdk::PromiseResult::Failed };
    let words = w.c.recovery_key.as_deref().map_or(W, fill_of);
    set_env_results("me.near", words, w.now, w.storage.clone(), vec![result]);
    env::state_write(&w.c);
    QUIET.with(|q| q.set(true));
    let r = catch_unwind(AssertUnwindSafe(|| AccountPolicy::on_recovery_key(key(fill), U64(ready), U64(asked))));
    QUIET.with(|q| q.set(false));
    let verdict = match r {
        Ok(()) => Verdict::Ok(Outcome { done: true, id: None, ready_at_ns: None, needs_device: false }),
        Err(e) => Verdict::Panic(e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()),
    };
    let mut m = w.m.clone();
    let mr = m.on_recovery_key(fill, ready, asked, added);
    w.last_emitted.clear();
    if let Verdict::Ok(_) = verdict {
        w.c = env::state_read().expect("the callback leaves the state");
        w.last_emitted = emitted();
        for r in emitted_receipts() {
            replay(&mut w.near, &r);
        }
        let mut storage = take_storage();
        storage.remove(b"STATE".as_slice());
        w.storage = storage;
        if mr.is_ok() {
            w.m = m;
        }
    }
    (verdict, mr)
}

/// A finish's key receipts on NEAR, in order (the new key's delete, which may fail, then its add, which succeeds only if
/// `ok` and NEAR can add it): returns whether the add succeeded.
fn run_finish_receipts(near: &mut BTreeMap<u8, u8>, fill: u8, receipts: &[Vec<Emitted>], ok: bool) -> bool {
    let mut added = false;
    for r in receipts {
        if r.iter().any(|x| matches!(x, Emitted::AddFn { fill: f, .. } if *f == fill)) {
            if ok {
                added = replay(near, r);
            }
        } else {
            replay(near, r);
        }
    }
    added
}

fn callback_added(w: &World, i: usize, ok: bool) -> bool {
    let mut near = w.near.clone();
    run_finish_receipts(&mut near, w.inflight[i].0, &w.inflight[i].2, ok)
}

/// The signer of an action that only the phone may take (None: not a phone method).
fn phone_signer(act: &Act) -> Option<u8> {
    match act {
        Act::Exec(s, _) | Act::Run(s, _) | Act::Cancel(s, _) | Act::SetProt(s, _) | Act::AddDev(s, _) | Act::RemoveKey(s, _) | Act::SetWords(s, _) | Act::Upgrade(s) | Act::CancelRec(s) => Some(*s),
        _ => None,
    }
}

/// The contract's FINISHING record: (new key, ready time, asked at).
fn load_finishing() -> Option<(Vec<u8>, u64, u64)> {
    load_key::<Finishing>(FINISHING_KEY).map(|f| (f.new_key, f.ready_at_ns, f.asked_at_ns))
}

fn load_releases() -> Vec<Vec<u8>> {
    load_key::<Vec<Vec<u8>>>(RELEASES_KEY).unwrap_or_default()
}

// ── Conformance: the real state against the model's, field by field ──────────────────────────────────────────────

fn conform(w: &World, errs: &mut Vec<String>) {
    set_env("me.near", P, w.now, w.storage.clone());
    let c = &w.c;
    let m = &w.m;
    let mut e = |cond: bool, what: &str| {
        if !cond {
            errs.push(format!("conformance: {what}"));
        }
    };
    e(c.recovery.as_ref().map(|r| (fill_of(&r.new_key.0), r.ready_at_ns.0)) == m.recovery, "recovery");
    e(c.frozen_until().map(|u| u.0) == m.frozen_until(), &format!("frozen_until {:?} vs {:?}", c.frozen_until(), m.frozen_until()));
    let rs = c.recovery_status();
    e(rs.as_ref().map(|r| r.approved) == m.recovery.map(|_| m.recovery_approved()), &format!("recovery approved {:?} vs {:?}", rs.as_ref().map(|r| r.approved), m.recovery.map(|_| m.recovery_approved())));
    e(rs.as_ref().map(|r| r.can_finish_at_ns.0) == m.recovery.map(|_| m.can_finish_at()), &format!("recovery can finish at {:?} vs {:?}", rs.as_ref().map(|r| r.can_finish_at_ns.0), m.recovery.map(|_| m.can_finish_at())));
    e(rs.as_ref().map(|r| r.needs_device) == m.recovery.map(|_| m.aged_count() > 0), "recovery needs_device");
    e(rs.as_ref().map(|r| r.stop_asked) == m.recovery.map(|_| m.stop_asked), "recovery stop_asked");
    e(rs.as_ref().map(|r| r.fallback_at_ns.0) == m.recovery.map(|_| m.fallback_at()), "recovery fallback time");
    e(c.recovery_key.as_deref().map(fill_of) == m.recovery_key, "recovery key");
    e(c.next_id == m.next_id, "next_id");
    let devices = load_devices();
    e(devices.keys.iter().map(|k| fill_of(k)).collect::<Vec<_>>() == m.phones, &format!("phones {:?} vs {:?}", devices.keys.iter().map(|k| fill_of(k)).collect::<Vec<_>>(), m.phones));
    e(devices.sealed == m.sealed, "sealed");
    e(c.second_devices.iter().map(|k| fill_of(k)).collect::<Vec<_>>() == m.second.iter().map(|(k, _)| *k).collect::<Vec<_>>(), "second devices");
    let ages: Vec<(u8, u64)> = c.second_device_ages().into_iter().map(|(k, at)| (fill_of(&k.0), at.0)).collect();
    let mages: Vec<(u8, u64)> = m.second.iter().map(|(k, at)| (*k, if m.aged(*k) { 0 } else { at.saturating_add(m.floor()) })).collect();
    e(ages == mages, &format!("ages {ages:?} vs {mages:?}"));
    let cb: Vec<MBand> = c
        .bands
        .iter()
        .map(|b| MBand {
            up_to: b.up_to.as_ref().map(|l| l[0].1 .0),
            level: match &b.level {
                Level::FaceId => MLevel::FaceId,
                Level::Wait { seconds } => MLevel::Wait(seconds.0),
                Level::Device => MLevel::Device,
                Level::Both { seconds } => MLevel::Both(seconds.0),
            },
        })
        .collect();
    e(cb == m.bands, &format!("bands {cb:?} vs {:?}", m.bands));
    let by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
    let cp: Vec<(u64, u64, bool, bool, Option<u8>)> = c
        .pending
        .iter()
        .map(|p| {
            let record = by.iter().find(|(i, _)| *i == p.id.0).map(|(_, k)| k.clone());
            let approver = record.and_then(|k| c.second_devices.iter().find(|d| env::sha256(d) == k).map(|d| fill_of(d)));
            (p.id.0, p.ready_at_ns.0, p.needs_device, p.approved, approver)
        })
        .collect();
    // The model keeps the approver's key; the contract keeps its hash, which no longer names a device once that device
    // is removed. Both then count the request as not co-signed; compare on that footing.
    let mp: Vec<(u64, u64, bool, bool, Option<u8>)> = m.pending.iter().map(|p| (p.id, p.ready_at, p.needs_device, p.approved, p.approver.filter(|a| m.second.iter().any(|(k, _)| k == a)))).collect();
    e(cp == mp, &format!("pending {cp:?} vs {mp:?}"));
    for (p, q) in c.pending.iter().zip(m.pending.iter()) {
        let same = match (&p.change, &q.kind) {
            (Change::Spend { steps, .. }, MKind::Spend(a)) => matches!(steps[0], Step::Transfer { deposit } if deposit.0 == *a),
            (Change::Spend { steps, .. }, MKind::Unmeasured) => matches!(steps[0], Step::FunctionCall { .. }),
            (Change::SetProtection { .. }, MKind::SetProtection(_)) | (Change::CancelRecovery, MKind::CancelRecovery) => true,
            (Change::Upgrade { code_hash }, MKind::Upgrade) => code_hash.0 == vec![super::model::UPGRADE_HASH; 32],
            (Change::AllowRelease { code_hash, asked_at_ns }, MKind::AllowRelease(h, asked)) => code_hash.0 == vec![*h; 32] && asked_at_ns.0 == *asked,
            (Change::AddSecondDevice { public_key }, MKind::AddSecondDevice(k)) | (Change::RemoveKey { public_key }, MKind::RemoveKey(k)) | (Change::SetRecoveryKey { public_key }, MKind::SetRecoveryKey(k)) => fill_of(&public_key.0) == *k,
            _ => false,
        };
        e(same, &format!("pending kind {:?} vs {:?}", p.change, q.kind));
    }
    let mut cs: Vec<(u64, u64, u128)> = c.spent.iter().map(|s| (s.at_ns, s.id, s.amount)).collect();
    let mut ms = m.spent.clone();
    cs.sort();
    ms.sort();
    e(cs == ms, &format!("spent {cs:?} vs {ms:?}"));
    // Release 9: the finish on its way, and the account's list of releases.
    let mf = m.finishing.map(|(k, ready, asked)| (key(k).0, ready, asked));
    e(load_finishing() == mf, &format!("finishing {:?} vs {:?}", load_finishing().map(|f| (f.1, f.2)), m.finishing));
    let rel: Vec<u8> = load_releases().iter().map(|h| if h.iter().all(|b| *b == h[0]) { h[0] } else { 255 }).collect();
    e(rel == m.releases, &format!("releases {rel:?} vs {:?}", m.releases));
    // Every key the contract knows is a 1,953-byte ML-DSA-65 key.
    e(c.second_devices.iter().chain(c.recovery_key.iter()).chain(devices.keys.iter()).all(|k| is_ml_dsa_65_key(k)), "a non-ML-DSA key is on the account");
}

// ── Invariants of every reachable state ──────────────────────────────────────────────────────────────────────────

fn invariants(w: &World, errs: &mut Vec<String>) {
    let c = &w.c;
    let mut e = |cond: bool, what: &str| {
        if !cond {
            errs.push(format!("invariant: {what}"));
        }
    };
    // I1 bounds
    e(c.pending.len() <= MAX_PENDING, "pending > 20");
    e(c.spent.len() <= MAX_SPENT_ROWS, "spent > 128");
    e(c.second_devices.len() <= 4, "second devices > 4");
    e(!c.bands.is_empty() && c.bands.len() <= MAX_BANDS, "bands count");
    // I2 bands monotone, last unlimited, and no level needs a device that isn't there
    for i in 1..c.bands.len() {
        e(c.bands[i].level.covers(&c.bands[i - 1].level), "bands not monotone");
    }
    e(c.bands.last().unwrap().up_to.is_none(), "last band has a limit");
    e(c.bands.iter().all(|b| b.up_to.is_some() || std::ptr::eq(b, c.bands.last().unwrap())), "a band before the last has no limit");
    e(!c.bands.iter().any(|b| b.level.needs_device()) || !c.second_devices.is_empty(), "a band needs a device, none on the account");
    // I3 ids unique and below next_id
    let ids: HashSet<u64> = c.pending.iter().map(|p| p.id.0).collect();
    e(ids.len() == c.pending.len(), "duplicate ids");
    e(c.pending.iter().all(|p| p.id.0 < c.next_id), "id ≥ next_id");
    // I4 a key has one role: phones, second devices, the words and a waiting recovery's new key are pairwise disjoint
    set_env("me.near", P, w.now, w.storage.clone());
    let phones = load_devices().keys;
    let mut roles: Vec<&[u8]> = vec![];
    roles.extend(phones.iter().map(|k| k.as_slice()));
    roles.extend(c.second_devices.iter().map(|k| k.as_slice()));
    roles.extend(c.recovery_key.iter().map(|k| k.as_slice()));
    roles.extend(c.recovery.iter().map(|r| r.new_key.0.as_slice()));
    let distinct: HashSet<&[u8]> = roles.iter().copied().collect();
    e(distinct.len() == roles.len(), "a key holds two roles");
    // Release 9: and a finishing recovery's new key holds no other role either.
    let fin = load_finishing();
    if let Some((h, ..)) = &fin {
        e(!phones.iter().chain(c.second_devices.iter()).chain(c.recovery_key.iter()).any(|k| k == h), "a finishing recovery's new key holds another role");
    }
    e(phones.len() <= MAX_DEVICE_KEYS, "phone keys > 8");
    // I8 (release 9, R8-RS1): the account always has a phone key on NEAR: a key on the contract's phone list that NEAR
    //    holds with the phone's methods (NEAR's keys replayed from every emitted receipt, adds and deletes all or nothing
    //    per receipt, the finish's add succeeding or failing as the explorer chose).
    e(phones.iter().any(|k| w.near.get(&fill_of(k)) == Some(&K_PHONE)), &format!("no phone key on NEAR (phones {:?}, NEAR {:?})", phones.iter().map(|k| fill_of(k)).collect::<Vec<_>>(), w.near));
    // I9: the words' key is on NEAR with the words' methods, and every second device's with a second device's.
    e(c.recovery_key.as_ref().map_or(true, |k| w.near.get(&fill_of(k)) == Some(&K_WORDS)), "the words' key is not on NEAR with the words' methods");
    e(c.second_devices.iter().all(|k| w.near.get(&fill_of(k)) == Some(&K_SECOND)), "a second device's key is not on NEAR with its methods");
    // I10: NEAR never holds a full-access key, and no key on NEAR with the phone's methods acts unless it's on the list.
    e(!w.near.values().any(|v| *v == 9), "a full-access key is on NEAR");
    // I5 while a recovery waits, every waiting request the phone asked alone is ready no earlier than the floor after
    //    it was asked (so the finish, which drops it, always comes first if the words act within the delay)
    if c.recovery.is_some() {
        for p in &c.pending {
            if !matches!(p.change, Change::CancelRecovery) && !c.co_signed(p) {
                if let Some((_, _, asked_at, _)) = w.asked.iter().find(|(id, ..)| *id == p.id.0) {
                    e(p.ready_at_ns.0 >= asked_at + c.floor_ns(), &format!("request {} asked alone during a recovery is ready before the floor", p.id.0));
                }
            }
        }
    }
    // I6 the words are always there: an account always has a recovery key, and the recovery's new key is ML-DSA
    e(c.recovery_key.is_some(), "no recovery key");
    // I7 (S2) is checked where money leaves (`check_left`): against the bands in force at that moment. Checking it here
    // against the bands of a later state misjudged a payment made under looser bands the person since tightened (a
    // checker artefact seen in release 7's random walks, never a contract fault).
}

/// S2 at the moment a payment leaves: what left at Face ID in the last 24 hours (this one included) fits the Face ID
/// band in force now, and what left without a second device fits the no-device band, unless the bands in force allow
/// it (everything Face ID; an unlimited band without a device).
fn check_left(w: &World, errs: &mut Vec<String>) {
    let c = &w.c;
    let mut e = |cond: bool, what: &str| {
        if !cond {
            errs.push(format!("invariant: {what}"));
        }
    };
    let at_once: u128 = w.left.iter().filter(|(t, _, cl)| *cl == 0 && *t + DAY_NS > w.now).map(|(_, a, _)| *a).sum();
    let no_device: u128 = w.left.iter().filter(|(t, _, cl)| *cl <= 1 && *t + DAY_NS > w.now).map(|(_, a, _)| *a).sum();
    let strictest_face = c.bands.iter().all(|b| b.level == Level::FaceId);
    if !strictest_face {
        e(at_once <= L1, &format!("{} NEAR left at Face ID within 24 h (band {})", at_once / NEAR, L1 / NEAR));
        if !c.bands.iter().any(|b| b.up_to.is_none() && !b.level.needs_device()) {
            e(no_device <= L2, &format!("{} NEAR left without a second device within 24 h (band {})", no_device / NEAR, L2 / NEAR));
        }
    }
}

/// Role separation that only NEAR's per-key method lists enforce (assumption A1): where the contract itself accepted a
/// call from a key NEAR would not let call that method, the (method, role) pair is recorded here and reported, not
/// failed. Which pairs appear is part of the trusted-base statement in contract-proofs.md.
static GAPS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

fn role_of(w: &World, s: u8) -> &'static str {
    let k = key(s).0;
    if w.c.second_devices.contains(&k) {
        "second device"
    } else if w.c.recovery_key == Some(k.clone()) {
        "words"
    } else if s == w.phone {
        "phone"
    } else {
        "unknown key"
    }
}

fn gap(w: &World, method: &str, s: u8, allowed: &[&str]) {
    let role = role_of(w, s);
    if !allowed.contains(&role) {
        let line = format!("{method} accepted at contract level from the {role} (NEAR's method list refuses it)");
        let mut g = GAPS.lock().unwrap();
        if !g.contains(&line) {
            g.push(line);
        }
    }
}

/// Conditions on one transition, given the world before, the action and the verdict.
fn transition(before: &World, act: &Act, verdict: &Verdict, after: &mut World, errs: &mut Vec<String>) {
    let mut extra: Vec<String> = vec![];
    let mut e = |cond: bool, what: &str| {
        if !cond {
            errs.push(format!("transition: {what}"));
        }
    };
    let c0 = &before.c;
    // Every judgement about the state before is made in the environment before (storage and clock).
    set_env("me.near", P, before.now, before.storage.clone());
    let co_signed_before: Vec<(u64, bool)> = c0.pending.iter().map(|p| (p.id.0, c0.co_signed(p))).collect();
    let was_co_signed = |id: u64| co_signed_before.iter().find(|(i, _)| *i == id).map_or(false, |(_, c)| *c);
    let frozen = c0.recovery.is_some() || before.now < load_freeze(before);
    let floor = c0.floor_ns();
    let is_phone = |s: u8| s == before.phone;
    let _ = is_phone;
    match (act, verdict) {
        (Act::Stranger, v) => e(matches!(v, Verdict::Panic(_)), "a stranger's call went through"),
        (Act::Exec(s, amount), Verdict::Ok(out)) => {
            gap(before, "execute", *s, &["phone"]);
            // T2 frozen: nothing runs at Face ID; every payment waits at least the floor
            if frozen {
                e(!out.done, "a payment ran at once while frozen");
                e(out.ready_at_ns.map_or(false, |r| r.0 >= before.now + floor), "a payment placed while frozen waits less than the floor");
            }
            if out.done {
                // An unmeasurable call runs at once only when the person chose Face ID for everything.
                e(amount.is_some() || c0.strictest() == Level::FaceId, "an unmeasurable call ran at Face ID");
                if let Some(a) = amount {
                    after.left.push((after.now, *a, 0));
                    check_left(after, &mut extra);
                }
            } else {
                after.asked.push((out.id.unwrap().0, *amount, before.now, false));
                // T1 band: a measured payment waits exactly its band's wait when not frozen
                if !frozen {
                    if let Some(a) = amount {
                        let total: u128 = before.m.spent.iter().filter(|r| r.0 + DAY_NS > before.now || before.m.pending.iter().any(|p| p.id == r.1)).map(|r| r.2).sum::<u128>() + a;
                        // The band the amount falls in, by the checker's own count: the first whose limit holds it.
                        let band = c0.bands.iter().find(|b| b.up_to.as_ref().map_or(true, |l| total <= l[0].1 .0)).unwrap();
                        e(out.ready_at_ns.unwrap().0 == before.now + band.level.wait_ns(), "a payment's wait is not its band's");
                        e(out.needs_device == band.level.needs_device(), "a payment's device need is not its band's");
                    } else {
                        e(out.needs_device == c0.strictest().needs_device(), "an unmeasurable call did not get the strictest level");
                    }
                }
            }
        }
        (Act::Exec(s, _), Verdict::Panic(_)) => {
            if is_phone(*s) && !c0.pending.len().ge(&MAX_PENDING) && c0.spent.len() < MAX_SPENT_ROWS {
                // The owner's phone can always ask (bounds aside); it may be told to wait, never refused.
                e(false, "the phone's own payment request was refused");
            }
        }
        (Act::Run(s, id), Verdict::Ok(out)) => {
            gap(before, "run", *s, &["phone"]);
            let p = c0.pending.iter().find(|p| p.id.0 == *id).unwrap();
            e(before.now >= p.ready_at_ns.0, "ran before its time");
            e(!p.needs_device || p.approved, "ran needing a device without its yes");
            if c0.recovery.is_some() {
                e(matches!(p.change, Change::CancelRecovery) || was_co_signed(*id), "ran during a recovery without an aged co-sign");
                // R7-2: an unanswered stop never ends a recovery the device said yes to.
                if matches!(p.change, Change::CancelRecovery) && !was_co_signed(*id) {
                    e(!before.m.recovery_approved(), "an unanswered stop ended an approved recovery");
                }
            }
            if out.done {
                record_left(before, after, *id, p, &mut extra);
            }
        }
        (Act::Approve(s, id), Verdict::Ok(out)) => {
            gap(before, "approve", *s, &["second device"]);
            let p = c0.pending.iter().find(|p| p.id.0 == *id).unwrap();
            e(p.needs_device || is_setting(&p.change) || matches!(p.change, Change::CancelRecovery), "a yes to a wait-only payment");
            if out.done {
                e(matches!(p.change, Change::CancelRecovery) || before.now >= p.ready_at_ns.0, "a yes ran a request before its time");
                if c0.recovery.is_some() && !matches!(p.change, Change::CancelRecovery) {
                    e(before.m.aged(*s) || was_co_signed(*id), "a young device's yes ran a request during a recovery");
                }
                record_left(before, after, *id, p, &mut extra);
            }
        }
        (Act::Decline(s, id), Verdict::Ok(_)) => {
            gap(before, "decline", *s, &["second device"]);
            let p = c0.pending.iter().find(|p| p.id.0 == *id).unwrap();
            let removes_device = matches!(&p.change, Change::RemoveKey { public_key } if c0.second_devices.contains(&public_key.0));
            e(!removes_device, "a second device refused a second device's removal");
            e(p.needs_device || c0.recovery.is_some() || matches!(p.change, Change::CancelRecovery), "a second device refused a wait-only request with no recovery waiting");
            if !p.needs_device && !matches!(p.change, Change::CancelRecovery) {
                e(before.m.aged(*s), "a young device refused during a dispute");
            }
        }
        (Act::SetProt(s, _) | Act::AddDev(s, _) | Act::RemoveKey(s, _) | Act::SetWords(s, _) | Act::Upgrade(s), Verdict::Ok(out)) => {
            gap(before, "a settings method", *s, &["phone"]);
            let setup_window = before.now < before.m.created_at + DAY_NS;
            let setup_step = matches!(act, Act::SetProt(..) | Act::AddDev(..));
            let renew = matches!(act, Act::AddDev(_, k) if c0.second_devices.contains(&key(*k).0)) || matches!(act, Act::SetWords(_, k) if c0.recovery_key == Some(key(*k).0));
            if !renew && !(setup_window && setup_step) {
                // T5 every change to the rules or keys waits at least the floor: the words can always stop it first
                e(!out.done, "a change to the rules or keys ran at once outside the set-up window");
                e(out.ready_at_ns.map_or(false, |r| r.0 >= before.now + floor), "a change waits less than the floor");
                e(out.ready_at_ns.map_or(false, |r| r.0 > before.now + c0.recovery_delay_ns), "a change can run before a recovery started now could finish");
            }
            if let Act::Upgrade(_) = act {
                e(!out.done && out.needs_device == c0.strictest().needs_device(), "an upgrade did not go through the strictest level");
            }
            // R7-1: removing a second device of age waits at least the fallback.
            if let Act::RemoveKey(_, k) = act {
                if c0.second_devices.contains(&key(*k).0) && before.m.aged(*k) {
                    e(out.ready_at_ns.map_or(false, |r| r.0 >= before.now + before.m.fallback), "a device of age's removal waits less than the fallback");
                }
            }
            if !out.done {
                after.asked.push((out.id.unwrap().0, None, before.now, false));
            }
        }
        (Act::Start(s, k), Verdict::Ok(_)) => {
            gap(before, "start_recovery", *s, &["words"]);
            e(c0.recovery_key == Some(key(*s).0), "a key other than the words started a recovery");
            e(c0.recovery.is_none(), "a second recovery started over a waiting one");
            after.started = Some(before.now);
            // T3 a start drops exactly what no aged device co-signed
            for p in &c0.pending {
                let kept = after.c.pending.iter().any(|q| q.id == p.id);
                e(kept == was_co_signed(p.id.0), &format!("start kept/dropped request {} wrongly (co-signed: {})", p.id.0, was_co_signed(p.id.0)));
            }
            e(after.c.recovery.as_ref().map(|r| r.ready_at_ns.0) == Some(before.now + c0.recovery_delay_ns), "a recovery's ready time is not start + delay");
            e(after.c.recovery.as_ref().map(|r| r.new_key.0.clone()) == Some(key(*k).0), "the recovery holds another key");
        }
        (Act::Finish(s), Verdict::Ok(_)) => {
            // Release 9: the finish's first half. It checks what release 8's finish checked, then only marks the recovery
            // as finishing and asks NEAR to add the new key, with its callback after it.
            gap(before, "finish_recovery", *s, &["words"]);
            let r = c0.recovery.as_ref().unwrap();
            e(before.now >= r.ready_at_ns.0, "a recovery finished before its delay");
            // R7: with a second device of age, only with its yes to this recovery, or after the fallback.
            let aged_before = before.m.aged_count() > 0;
            e(!aged_before || before.m.recovery_approved() || before.now >= before.m.fallback_at(), "a recovery finished without the second device's yes before the fallback");
            e(c0.recovery_key == Some(key(*s).0), "a key other than the words finished a recovery");
            e(before.m.finishing.map_or(true, |(_, _, asked)| before.now >= asked + 3_600 * SECOND), "a second finish within the hour was taken");
            set_env("me.near", P, after.now, after.storage.clone());
            e(after.c.recovery == c0.recovery, "the finish's first half changed the recovery");
            e(after.c.pending.len() == c0.pending.len() && after.c.second_devices == c0.second_devices, "the finish's first half changed the waiting requests or the devices");
            e(load_devices().keys == { set_env("me.near", P, before.now, before.storage.clone()); load_devices().keys }, "the finish's first half changed the phone list");
            set_env("me.near", P, after.now, after.storage.clone());
            e(load_finishing() == Some((r.new_key.0.clone(), r.ready_at_ns.0, before.now)), "the finish did not mark the recovery as finishing");
            // Re-freeze 2: it deletes only the new key itself (a copy an earlier finish left), before its add, and (RT3-b)
            // the key of another recovery's finish still on record.
            let prior = before.m.finishing.map(|f| f.0).filter(|k| *k != fill_of(&r.new_key.0));
            e(!after.last_emitted.iter().any(|x| matches!(x, Emitted::Delete { fill } if *fill != fill_of(&r.new_key.0) && Some(*fill) != prior)), "the finish's first half deleted a key other than the new one (or a superseded finish's) before the add was seen");
            if let Some(k) = prior {
                e(after.last_emitted.iter().any(|x| matches!(x, Emitted::Delete { fill } if *fill == k)), "a finish that replaced another recovery's finish record left that key on NEAR");
                e(!after.near.contains_key(&k), "a superseded finish's key is still on NEAR");
            }
            e(after.inflight.len() == before.inflight.len() + 1 && after.inflight.last().map(|f| (f.0, f.1)) == Some((fill_of(&r.new_key.0), r.ready_at_ns.0)), "the finish's callback does not name this recovery");
            let order: Vec<&Emitted> = after.inflight.last().unwrap().2.iter().flatten().collect();
            e(matches!(order.as_slice(), [Emitted::Delete { fill: a }, Emitted::AddFn { fill: b, .. }] if *a == fill_of(&r.new_key.0) && *b == *a), "the finish's key receipts are not: delete the new key, then add it");
            // The new key can't act while its add is on its way (checked in the core runs too, where it isn't an actor).
            probe_new_key(fill_of(&r.new_key.0), after, &mut extra);
        }
        (Act::Finish(s), Verdict::Panic(_)) => {
            if let Some(r) = &c0.recovery {
                let blocked = before.m.aged_count() > 0 && !before.m.recovery_approved() && before.now < before.m.fallback_at();
                let finishing = before.m.finishing.map_or(false, |(_, _, asked)| before.now < asked + 3_600 * SECOND);
                e(before.now < r.ready_at_ns.0 || c0.recovery_key != Some(key(*s).0) || blocked || finishing, "the words could not finish a ready recovery");
            }
        }
        (Act::CallbackLost(i), _) => {
            // Nothing in the contract changes: its state and every cell stay (a FINISHING record stays, so a retry waits
            // its hour; one a later finish replaced stays replaced).
            e(after.c.recovery == c0.recovery && after.storage == before.storage, "a lost callback changed the contract");
            let _ = i;
        }
        (Act::Callback(i, _), Verdict::Ok(_)) if !before.m.finishing.map_or(false, |f| f.0 == before.inflight[*i].0 && f.2 == before.inflight[*i].3) => {
            // Re-freeze 2: a callback whose finish is no longer on record (a retry replaced it, or it already ran) does
            // nothing at all in the contract: no finish, no delete, the record of the finish now on its way kept.
            set_env("me.near", P, after.now, after.storage.clone());
            e(after.c.recovery == c0.recovery && after.c.pending.len() == c0.pending.len() && after.c.second_devices == c0.second_devices, "a superseded callback changed the account");
            let fin_after = load_finishing();
            set_env("me.near", P, before.now, before.storage.clone());
            e(fin_after == load_finishing(), "a superseded callback changed the finish record");
            e(!after.last_emitted.iter().any(|x| matches!(x, Emitted::Delete { .. } | Emitted::AddFn { .. })), "a superseded callback changed a key");
        }
        (Act::Callback(i, ok), Verdict::Ok(_)) => {
            let (fill, ready) = (before.inflight[*i].0, before.inflight[*i].1);
            let added = callback_added(before, *i, *ok);
            let pending = PendingRecovery { new_key: key(fill), ready_at_ns: U64(ready) };
            let same = c0.recovery.as_ref() == Some(&pending);
            let blocked = before.m.finish_blocked_pub();
            set_env("me.near", P, before.now, before.storage.clone());
            let old_phones = load_devices().keys;
            set_env("me.near", P, after.now, after.storage.clone());
            e(load_finishing().is_none(), "the finish's marker outlived its callback");
            if added && same && !blocked {
                // The finish completes, as release 8's finish did.
                let devices = load_devices();
                e(devices.keys == vec![key(fill).0] && devices.sealed, "after a finish the new phone is not the only, sealed phone");
                e(after.c.recovery.is_none(), "recovery still waiting after its finish");
                e(load_freeze(after) <= after.now, "freeze outlives a finish");
                for p in &c0.pending {
                    let kept = after.c.pending.iter().any(|q| q.id == p.id);
                    let removes_new = matches!(&p.change, Change::RemoveKey { public_key } if public_key.0 == key(fill).0);
                    e(kept == (was_co_signed(p.id.0) && !removes_new), &format!("finish kept/dropped request {} wrongly", p.id.0));
                }
                e(after.c.second_devices.iter().all(|k| c0.second_devices.contains(k) && before.m.aged(fill_of(k))), "a young second device survived a finish");
                for old in old_phones.iter().filter(|k| fill_of(k) != fill) {
                    let f = fill_of(old);
                    e(after.last_emitted.iter().any(|x| matches!(x, Emitted::Delete { fill } if *fill == f)), &format!("the old phone key {f} was not deleted by the finish"));
                }
                e(after.near.get(&fill) == Some(&K_PHONE), "the new phone's key is not on NEAR after the finish");
                after.phone = fill;
                after.started = None;
            } else {
                // Nothing finishes: the recovery, the phones, the devices and the waiting requests stay as they were.
                e(after.c.recovery == c0.recovery, "a callback that didn't finish changed the recovery");
                e(load_devices().keys == old_phones, "a callback that didn't finish changed the phone list");
                e(after.c.pending.len() == c0.pending.len() && after.c.second_devices == c0.second_devices, "a callback that didn't finish changed the waiting requests or the devices");
                let deleted: Vec<u8> = after.last_emitted.iter().filter_map(|x| if let Emitted::Delete { fill } = x { Some(*fill) } else { None }).collect();
                let holds_role = c0.second_devices.contains(&key(fill).0) || c0.recovery_key == Some(key(fill).0) || old_phones.contains(&key(fill).0);
                if added && !holds_role {
                    e(deleted == vec![fill], "an added key of a recovery that didn't finish was not taken off NEAR (or more was deleted)");
                } else {
                    e(deleted.is_empty(), "a callback that didn't finish deleted a key");
                }
            }
        }
        (Act::Callback(..), Verdict::Panic(m)) => e(false, &format!("the finish's callback panicked: {m}")),
        (Act::RefillWords(s), Verdict::Ok(_)) => {
            gap(before, "refill_recovery_key", *s, &["second device"]);
            e(before.m.aged(*s), "a young device refilled the words");
            let w = c0.recovery_key.as_deref().map(fill_of);
            e(w.is_some() && after.last_emitted.iter().filter(|x| matches!(x, Emitted::Delete { fill } if Some(*fill) == w)).count() == 1 && after.last_emitted.iter().filter(|x| matches!(x, Emitted::AddFn { fill, .. } if Some(*fill) == w)).count() == 1 && after.last_emitted.len() == 2, "the refill did more than renew the words' key");
            e(after.c.recovery == c0.recovery && after.c.pending.len() == c0.pending.len(), "the refill changed the account");
        }
        (Act::RefillWords(s), Verdict::Panic(_)) => {
            if c0.second_devices.contains(&key(*s).0) && before.m.aged(*s) {
                e(false, "an aged second device's refill of the words was refused");
            }
        }
        (Act::ApproveRec(s), Verdict::Ok(_)) => {
            gap(before, "approve_recovery", *s, &["second device"]);
            e(c0.recovery.is_some(), "a yes to no recovery");
            e(before.m.aged(*s), "a young device's yes to a recovery was taken");
            set_env("me.near", P, after.now, after.storage.clone());
            e(after.c.recovery_status().map_or(false, |r| r.approved), "the recovery isn't approved after the device's yes");
            e(after.c.recovery == c0.recovery, "a yes changed the recovery");
        }
        (Act::ApproveRec(s), Verdict::Panic(_)) => {
            if c0.recovery.is_some() && c0.second_devices.contains(&key(*s).0) && before.m.aged(*s) {
                e(false, "an aged second device's yes to a waiting recovery was refused");
            }
        }
        (Act::ApproveRecStale(_), v) => e(matches!(v, Verdict::Panic(_)), "a yes naming another recovery was taken"),
        (Act::RefuseRec(s), Verdict::Ok(_)) => {
            gap(before, "refuse_recovery", *s, &["second device"]);
            e(c0.recovery.is_some(), "a refusal of no recovery");
            e(before.m.aged(*s), "a young device's refusal was taken");
            e(after.c.recovery.is_none(), "the recovery survived the device's refusal");
            // R7-9: a plain refusal always freezes, stop waiting or not.
            e(load_freeze(after) >= before.now + floor, "a device's refusal did not freeze spending for the floor");
            for p in &c0.pending {
                let kept = after.c.pending.iter().any(|q| q.id == p.id);
                e(kept == was_co_signed(p.id.0), &format!("refusal kept/dropped request {} wrongly", p.id.0));
            }
            after.started = None;
        }
        (Act::RefuseRec(s), Verdict::Panic(_)) => {
            if c0.recovery.is_some() && c0.second_devices.contains(&key(*s).0) && before.m.aged(*s) {
                e(false, "an aged second device's refusal of a waiting recovery was refused");
            }
        }
        (Act::ConfirmStop(s), Verdict::Ok(_)) => {
            gap(before, "refuse_recovery", *s, &["second device"]);
            e(before.m.aged(*s), "a young device confirmed a stop");
            e(c0.pending.iter().any(|p| matches!(p.change, Change::CancelRecovery)), "a confirmation with no stop waiting");
            e(after.c.recovery.is_none(), "the recovery survived the confirmed stop");
            // R7-4: the phone's stop and the device's confirmation together: no freeze added.
            e(load_freeze(after) <= load_freeze(before).max(before.now), "a confirmed stop froze spending");
            for p in &c0.pending {
                let kept = after.c.pending.iter().any(|q| q.id == p.id);
                e(kept == (was_co_signed(p.id.0) && !matches!(p.change, Change::CancelRecovery)), &format!("confirmation kept/dropped request {} wrongly", p.id.0));
            }
            after.started = None;
        }
        (Act::ConfirmStop(_), Verdict::Panic(_)) => {
            // Refused whenever no stop waits, the device is young, or no recovery waits: nothing more to require.
        }
        (Act::CancelRec(s), Verdict::Ok(out)) => {
            gap(before, "cancel_recovery", *s, &["phone"]);
            if before.m.aged_count() == 0 {
                e(out.done && after.c.recovery.is_none(), "a stop with no aged device did not end the recovery at once");
                e(load_freeze(after) >= before.now + floor, "a phone-only stop did not freeze spending for the floor");
                after.started = None;
            } else {
                e(!out.done && out.ready_at_ns.unwrap().0 - before.now <= DAY_NS.min(c0.recovery_delay_ns / 2), "a stop with an aged device waits more than a day or half the delay");
                e(after.c.recovery.is_some(), "a stop with an aged device ended the recovery at once");
                e(!before.m.stop_asked, "a second stop of the same recovery was placed (R7-2)");
            }
        }
        (Act::Cancel(s, id), Verdict::Ok(_)) => {
            gap(before, "cancel", *s, &["phone"]);
            e(!after.c.pending.iter().any(|p| p.id.0 == *id), "cancelled request still waiting");
        }
        _ => {}
    }
    // T8 keys NEAR is asked to add: never full access; always this account; always one of the three method lists with
    //    the role's allowance, and for a key the contract then holds in that role. T9 an upgrade is one batch: the switch
    //    to the global code and the call to its upgrade_check(from_version: 6) share a receipt.
    if let Verdict::Ok(_) = verdict {
        let device: Vec<String> = DEVICE_METHODS.split(',').map(str::to_string).collect();
        let second: Vec<String> = SECOND_DEVICE_METHODS.split(',').map(str::to_string).collect();
        let words: Vec<String> = RECOVERY_METHODS.split(',').map(str::to_string).collect();
        for em in &after.last_emitted {
            match em {
                Emitted::AddFull { fill } => e(false, &format!("a FULL-ACCESS key was added (key {fill})")),
                Emitted::AddFn { fill, methods, allowance, receiver } => {
                    e(receiver == "me.near", "a key was added for another account");
                    let k = key(*fill).0;
                    let finishing_new = matches!(act, Act::Finish(_)) && after.c.recovery.as_ref().map_or(false, |r| r.new_key.0 == k);
                    if (*fill == after.phone && after.c.recovery.is_none()) || finishing_new {
                        e(*methods == device && *allowance == None, &format!("the phone's key has methods {methods:?} allowance {allowance:?}"));
                    } else if after.c.second_devices.contains(&k) {
                        e(*methods == second && *allowance == Some(SECOND_DEVICE_ALLOWANCE), &format!("a second device's key has methods {methods:?} allowance {allowance:?}"));
                    } else if after.c.recovery_key == Some(k) {
                        e(*methods == words && *allowance == Some(RECOVERY_KEY_ALLOWANCE), &format!("the words' key has methods {methods:?} allowance {allowance:?}"));
                    } else {
                        e(false, &format!("a key ({fill}) was added that holds no role afterwards"));
                    }
                }
                Emitted::UseGlobal { idx } => {
                    // Release 9: the check is told this release and the hash being installed (which becomes the list).
                    let want = serde_json::json!({ "from_version": RELEASE_VERSION, "code_hash": Base64VecU8(vec![super::model::UPGRADE_HASH; 32]) });
                    let check = after.last_emitted.iter().any(|x| matches!(x, Emitted::Call { idx: i, method, args } if i == idx && method == "upgrade_check" && serde_json::from_slice::<serde_json::Value>(args).ok() == Some(want.clone())));
                    e(check, "a code switch without upgrade_check(from_version: this release, code_hash: the release) in the same receipt");
                }
                _ => {}
            }
        }
        if let Act::Finish(_) = act {
            let r = c0.recovery.as_ref().unwrap();
            e(after.last_emitted.iter().filter(|x| matches!(x, Emitted::AddFn { fill, .. } if *fill == fill_of(&r.new_key.0))).count() == 1, "the finish did not add the new phone's key");
            e(after.last_emitted.iter().any(|x| matches!(x, Emitted::Call { method, .. } if method == "on_recovery_key")), "the finish's add has no callback");
        }
        // Release 9 (R8-RS1): a phone key is deleted only by a finish's callback that saw the new key added (and then the
        // new key is on NEAR), or by a removal the phone asked that runs.
        set_env("me.near", P, before.now, before.storage.clone());
        let phones_before: Vec<u8> = load_devices().keys.iter().map(|k| fill_of(k)).collect();
        for x in &after.last_emitted {
            if let Emitted::Delete { fill } = x {
                if phones_before.contains(fill) {
                    let by_finish = matches!(act, Act::Callback(i, ok) if callback_added(before, *i, *ok) && after.near.get(&before.inflight[*i].0) == Some(&K_PHONE));
                    let by_removal = matches!(act, Act::Run(..) | Act::Approve(..)) && matches!(act, Act::Run(_, id) | Act::Approve(_, id) if c0.pending.iter().any(|p| p.id.0 == *id && matches!(&p.change, Change::RemoveKey { public_key } if fill_of(&public_key.0) == *fill)));
                    e(by_finish || by_removal, &format!("the phone key {fill} was deleted other than by a finish that saw the new key added"));
                }
            }
        }
        if let (Act::Run(_, id) | Act::Approve(_, id), Verdict::Ok(out)) = (act, verdict) {
            if out.done {
                set_env("me.near", P, before.now, before.storage.clone());
                let listed_before = load_releases();
                match c0.pending.iter().find(|p| p.id.0 == *id).map(|p| &p.change) {
                    Some(Change::Upgrade { code_hash }) => {
                        e(after.last_emitted.iter().any(|x| matches!(x, Emitted::UseGlobal { .. })), "an upgrade ran without switching the code");
                        // Release 9 (re-score item 2): only to a release on the list.
                        e(listed_before.contains(&code_hash.0), "an upgrade ran to a release not on the account's list");
                    }
                    Some(Change::AllowRelease { asked_at_ns, .. }) => {
                        // Co-signed by a second device of age, or after the fallback (and the floor) since it was asked.
                        let alone = before.now >= asked_at_ns.0 + (before.m.fallback.max(c0.floor_ns()));
                        // An approve co-signs it itself when the approving device is of age (its yes is recorded first).
                        let yes_now = matches!(act, Act::Approve(d, _) if before.m.aged(*d));
                        e(was_co_signed(*id) || yes_now || alone, "a release was added to the list by the phone alone before the fallback");
                    }
                    _ => {}
                }
            }
        }
    }
    // Release 9 (R8-RS1): the new key never acts while its recovery waits or is finishing.
    if let (Some(s), Verdict::Ok(_)) = (phone_signer(act), verdict) {
        let new_waiting = c0.recovery.as_ref().map_or(false, |r| fill_of(&r.new_key.0) == s);
        let new_finishing = before.m.finishing.map_or(false, |f| f.0 == s);
        e(!new_waiting && !new_finishing, &format!("the new key {s} acted before its recovery finished ({act:?})"));
    }
    errs.extend(extra);
    // After any finish of a recovery, the previous phone can do nothing (checked once per finish in `probe_old_key`).
    if let Verdict::Ok(_) = verdict {
        if after.phone != before.phone {
            probe_old_key(before.phone, after, errs);
        }
    }
    // The ledger forgets what no longer waits.
    let waiting: HashSet<u64> = after.c.pending.iter().map(|p| p.id.0).collect();
    after.asked.retain(|(id, ..)| waiting.contains(id));
    if after.c.recovery.is_none() {
        after.started = None;
    }
}

fn load_freeze(w: &World) -> u64 {
    w.storage.get(FREEZE_KEY).map(|b| borsh::from_slice::<u64>(b).unwrap()).unwrap_or(0)
}

fn record_left(before: &World, after: &mut World, id: u64, p: &Pending, errs: &mut Vec<String>) {
    if let Change::Spend { steps, .. } = &p.change {
        if let Step::Transfer { deposit } = &steps[0] {
            let class = if p.needs_device || p.approved { 2 } else { 1 };
            let _ = before;
            after.left.push((after.now, deposit.0, class));
            check_left(after, errs);
        }
    }
    let _ = id;
}

/// T7 no old key acts after a finish: every device method signed by the previous phone is refused.
fn probe_old_key(old: u8, w: &World, errs: &mut Vec<String>) {
    let probes = [Act::Exec(old, Some(NEAR)), Act::CancelRec(old), Act::SetProt(old, 1), Act::Upgrade(old), Act::SetWords(old, W2), Act::AddDev(old, D2), Act::RemoveKey(old, D1), Act::ApproveRec(old), Act::RefuseRec(old), Act::Start(old, N2), Act::Finish(old)];
    for a in probes {
        let mut copy = w.clone();
        let (v, _) = apply(&mut copy, &a);
        if let Verdict::Ok(_) = v {
            errs.push(format!("old-key: after a finish the old phone's {a:?} went through"));
        }
    }
}

/// Release 9 (R8-RS1): while a finish is on its way, its new key can do nothing as the phone.
fn probe_new_key(new: u8, w: &World, errs: &mut Vec<String>) {
    let probes = [Act::Exec(new, Some(NEAR)), Act::Exec(new, None), Act::CancelRec(new), Act::SetProt(new, 1), Act::Upgrade(new), Act::SetWords(new, W2), Act::AddDev(new, D2), Act::RemoveKey(new, D1), Act::RemoveKey(new, P)];
    for a in probes {
        let mut copy = w.clone();
        let (v, _) = apply(&mut copy, &a);
        if let Verdict::Ok(_) = v {
            errs.push(format!("new-key: while its finish was on its way the new key's {a:?} went through"));
        }
    }
}

/// T6 liveness: from this state, the owner holding the phone and every second device (and no words) reaches a finished
/// payment; and a waiting recovery can always be finished by the words (if nobody stops it) and always stopped by the
/// phone. Run on a copy.
fn liveness(w: &World, errs: &mut Vec<String>) {
    let floor = w.c.floor_ns();
    // (a) the owner's phone and devices: end any recovery, wait out any freeze, pay 1 NEAR.
    let mut x = w.clone();
    let mut script: Vec<Act> = vec![];
    // R7-2: with a device of age, the phone has one stop per recovery; if it was already refused, the owner's device
    // itself ends the recovery (refuse_recovery), which is the escape then.
    let aged_now: Vec<u8> = x.c.second_devices.iter().map(|k| fill_of(k)).filter(|k| x.m.aged(*k)).collect();
    if x.c.recovery.is_some() && !x.c.pending.iter().any(|p| matches!(p.change, Change::CancelRecovery)) {
        if x.m.stop_asked && !aged_now.is_empty() {
            script.push(Act::RefuseRec(aged_now[0]));
        } else {
            script.push(Act::CancelRec(x.phone));
        }
    }
    let mut ok = true;
    for a in &script {
        let (v, _) = apply(&mut x, a);
        if let Verdict::Panic(m) = v {
            errs.push(format!("liveness: the owner's stop was refused: {m} (state: recovery {:?}, pending {:?})", x.c.recovery.is_some(), x.c.pending.len()));
            ok = false;
        }
    }
    if ok {
        if let Some(p) = x.c.pending.iter().find(|p| matches!(p.change, Change::CancelRecovery)).cloned() {
            // An aged device says yes: the stop runs at once, with no freeze after it.
            let aged: Vec<u8> = x.c.second_devices.iter().map(|k| fill_of(k)).filter(|k| x.m.aged(*k)).collect();
            let a = if let Some(d) = aged.first() { Act::Approve(*d, p.id.0) } else { Act::Time(DAY_NS + 1) };
            let (v, _) = apply(&mut x, &a);
            if let Verdict::Panic(m) = v {
                errs.push(format!("liveness: the aged device's yes to the stop was refused: {m}"));
                ok = false;
            }
            if matches!(a, Act::Time(_)) {
                let ph = x.phone;
                let (v, _) = apply(&mut x, &Act::Run(ph, p.id.0));
                if let Verdict::Panic(m) = v {
                    errs.push(format!("liveness: the stop could not run after its day: {m}"));
                    ok = false;
                }
            }
        }
    }
    if ok {
        if x.c.recovery.is_some() {
            errs.push("liveness: the owner could not end the recovery".into());
            ok = false;
        }
    }
    if ok {
        apply(&mut x, &Act::Time(floor + DAY_NS + 1));
        // The band's budget may be full: wait another day so the 24-hour list is empty.
        apply(&mut x, &Act::Time(DAY_NS));
        let ph = x.phone;
        let (v, _) = apply(&mut x, &Act::Exec(ph, Some(NEAR)));
        match v {
            Verdict::Ok(out) if out.done => {}
            Verdict::Ok(out) => {
                apply(&mut x, &Act::Time(31 * DAY_NS + 1));
                let id = out.id.unwrap().0;
                let aged: Vec<u8> = x.c.second_devices.iter().map(|k| fill_of(k)).collect();
                if out.needs_device {
                    if let Some(d) = aged.first() {
                        apply(&mut x, &Act::Approve(*d, id));
                    }
                }
                if x.c.pending.iter().any(|p| p.id.0 == id) {
                    let (v, _) = apply(&mut x, &Act::Run(ph, id));
                    if let Verdict::Panic(m) = v {
                        errs.push(format!("liveness: the owner's payment never ran: {m}"));
                    }
                }
            }
            Verdict::Panic(m) => errs.push(format!("liveness: the owner's payment was refused: {m}")),
        }
    }
    // (b) a waiting recovery: the words can finish it once the delay passes, if nobody stops it: with a second device
    //     of age, after its yes (R7); and with no device at all (lost), after the fallback. And the words that started it
    //     are the only key that can.
    // Release 9: finishes already on their way get their callbacks first (with the add as NEAR would run it).
    // Each through `step`, so every transition condition and invariant is checked on them too.
    let mut w = w.clone();
    while !w.inflight.is_empty() {
        let (after, e2) = step(&w, &Act::Callback(0, true));
        errs.extend(e2.into_iter().map(|e| format!("liveness (callback before it): {e}")));
        w = after;
    }
    let w = &w;
    if w.c.recovery.is_some() {
        let words = fill_of(w.c.recovery_key.as_ref().unwrap());
        // A finish whose callback was lost (RT3) holds its mark: the words may finish again an hour after it.
        let ready = w.c.recovery.as_ref().unwrap().ready_at_ns.0.max(w.m.finishing.map_or(0, |f| f.2 + 3_600 * SECOND));
        let aged: Vec<u8> = w.c.second_devices.iter().map(|k| fill_of(k)).filter(|k| w.m.aged(*k)).collect();
        if let Some(d) = aged.first() {
            let mut y = w.clone();
            let (v, _) = apply(&mut y, &Act::ApproveRec(*d));
            if let Verdict::Panic(m) = v {
                errs.push(format!("liveness: the aged device's yes to the recovery was refused: {m}"));
            }
            if y.now < ready {
                let by = ready - y.now;
                apply(&mut y, &Act::Time(by));
            }
            let (v, _) = apply(&mut y, &Act::Finish(words));
            if let Verdict::Panic(m) = v {
                errs.push(format!("liveness: the words could not finish a ready, approved recovery: {m}"));
            } else {
                let i = y.inflight.len() - 1;
                apply(&mut y, &Act::Callback(i, true));
                if y.c.recovery.is_some() {
                    errs.push("liveness: a ready, approved recovery did not finish once its new key was added".into());
                }
            }
        }
        let mut y = w.clone();
        let at = ready.max(y.m.fallback_at());
        if y.now < at {
            let by = at - y.now;
            apply(&mut y, &Act::Time(by));
        }
        let (v, _) = apply(&mut y, &Act::Finish(words));
        if let Verdict::Panic(m) = v {
            errs.push(format!("liveness: the words could not finish a recovery after the fallback: {m}"));
        } else {
            // R8-RS1: an add NEAR refuses changes nothing, and the words finish again once it can be added.
            let mut z = y.clone();
            let i = z.inflight.len() - 1;
            apply(&mut z, &Act::Callback(i, false));
            if z.c.recovery.is_none() || !z.c.pending.iter().map(|p| p.id).eq(y.c.pending.iter().map(|p| p.id)) {
                errs.push("liveness: a finish whose add NEAR refused changed the recovery or the waiting requests".into());
            }
            let (v, _) = apply(&mut z, &Act::Finish(words));
            if let Verdict::Panic(m) = v {
                errs.push(format!("liveness: after a refused add the words could not finish again: {m}"));
            } else {
                let i = z.inflight.len() - 1;
                apply(&mut z, &Act::Callback(i, true));
                if z.c.recovery.is_some() {
                    errs.push("liveness: after a refused add the second finish did not finish".into());
                }
            }
            let i = y.inflight.len() - 1;
            apply(&mut y, &Act::Callback(i, true));
            if y.c.recovery.is_some() {
                errs.push("liveness: a recovery past the fallback did not finish once its new key was added".into());
            }
        }
    }
}

// ── Enumeration ──────────────────────────────────────────────────────────────────────────────────────────────────

fn actions(w: &World, full: bool) -> Vec<Act> {
    // Re-freeze 2: a callback may also come late (any time step may pass while one is on its way), or never (lost).
    let mut acts = vec![Act::Time(SECOND), Act::Time(DELAY_S * SECOND), Act::Time(2 * DELAY_S * SECOND), Act::Time(DAY_NS), Act::Time(DAY_NS + 2 * DELAY_S * SECOND + SECOND), Act::Time(7 * DAY_NS)];
    let ids: Vec<u64> = w.c.pending.iter().map(|p| p.id.0).collect();
    let phones: &[u8] = if full { &[P, N] } else { &[w.phone] };
    let devices: &[u8] = if full { &[D1, D2] } else { &[D1] };
    let words: &[u8] = if full { &[W, W2] } else { &[W] };
    for &s in phones {
        acts.push(Act::Exec(s, Some(5 * NEAR)));
        acts.push(Act::Exec(s, Some(50 * NEAR)));
        acts.push(Act::Exec(s, Some(500 * NEAR)));
        if full {
            acts.push(Act::Exec(s, None));
        }
        for &id in &ids {
            acts.push(Act::Run(s, id));
            acts.push(Act::Cancel(s, id));
        }
        acts.push(Act::SetProt(s, 1));
        if full {
            acts.push(Act::SetProt(s, 2));
        }
        acts.push(Act::AddDev(s, D2));
        acts.push(Act::RemoveKey(s, D1));
        if full {
            acts.push(Act::RemoveKey(s, D2));
        }
        acts.push(Act::SetWords(s, W2));
        acts.push(Act::Upgrade(s));
        acts.push(Act::CancelRec(s));
    }
    for &s in devices {
        for &id in &ids {
            acts.push(Act::Approve(s, id));
            acts.push(Act::Decline(s, id));
        }
        if w.c.recovery.is_some() {
            acts.push(Act::ApproveRec(s));
            acts.push(Act::RefuseRec(s));
            if w.c.pending.iter().any(|p| matches!(p.change, Change::CancelRecovery)) {
                acts.push(Act::ConfirmStop(s));
            }
            if full {
                acts.push(Act::ApproveRecStale(s));
            }
        }
        acts.push(Act::RefillWords(s));
    }
    // Release 9: NEAR runs a waiting finish's add and its callback, the add succeeding (when the key isn't on NEAR) or not.
    // NEAR runs one account's receipts in the order they were made (local receipts at once, delayed ones first in, first
    // out), so the oldest finish on its way runs its receipts and callback first.
    if !w.inflight.is_empty() {
        acts.push(Act::Callback(0, true));
        acts.push(Act::Callback(0, false));
        acts.push(Act::CallbackLost(0));
    }
    for &s in words {
        acts.push(Act::Start(s, if w.phone == N { N2 } else { N }));
        acts.push(Act::Finish(s));
    }
    if full {
        acts.push(Act::Stranger);
        acts.push(Act::Exec(D1, Some(5 * NEAR)));
        // R7 role checks at contract level: the words paying, the phone starting a recovery, the phone saying yes.
        acts.push(Act::Exec(W, Some(5 * NEAR)));
        acts.push(Act::Start(P, N2));
        acts.push(Act::RefillWords(P));
        if w.c.recovery.is_some() {
            acts.push(Act::ApproveRec(P));
            acts.push(Act::RefuseRec(W));
        }
    }
    acts
}

struct Node {
    world: World,
    parent: Option<usize>,
    act: Option<Act>,
}

fn path(nodes: &[Node], mut i: usize) -> Vec<Act> {
    let mut out = vec![];
    while let Some(p) = nodes[i].parent {
        out.push(nodes[i].act.clone().unwrap());
        i = p;
    }
    out.reverse();
    out
}

fn step(before: &World, act: &Act) -> (World, Vec<String>) {
    let mut after = before.clone();
    let (v, mr) = apply(&mut after, act);
    let mut errs = vec![];
    // Conformance of verdicts
    match (&v, &mr) {
        (Verdict::Ok(out), Ok(mo)) => {
            if out.done != mo.done || out.ready_at_ns.map(|r| r.0) != mo.ready_at || out.needs_device != mo.needs_device {
                errs.push(format!("conformance: outcome {out:?} vs model {mo:?}"));
            }
        }
        (Verdict::Ok(_), Err(why)) => errs.push(format!("conformance: contract accepted, model refused ({why})")),
        (Verdict::Panic(msg), Ok(_)) => errs.push(format!("conformance: contract refused ({msg}), model accepted")),
        (Verdict::Panic(_), Err(_)) => {}
    }
    if let Verdict::Ok(_) = v {
        conform(&after, &mut errs);
        transition(before, act, &v, &mut after, &mut errs);
        invariants(&after, &mut errs);
    } else {
        transition(before, act, &v, &mut after, &mut errs);
    }
    (after, errs)
}

fn report(name: &str, trace: &[Act], errs: &[String]) -> String {
    let mut s = format!("\n=== {name}: {} violation(s) ===\n", errs.len());
    for e in errs {
        s.push_str(&format!("  {e}\n"));
    }
    s.push_str("  trace from set-up:\n");
    for (i, a) in trace.iter().enumerate() {
        s.push_str(&format!("    {:>2}. {a:?}\n", i + 1));
    }
    s
}

thread_local! { static QUIET: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

/// The contract's refusals (caught panics) stay silent; the checker's own panics are printed.
fn silence_panics() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            if !QUIET.with(|q| q.get()) {
                eprintln!("checker panic: {info}");
            }
        }))
    });
}

/// Breadth-first over every action from `start`, to `depth`, de-duplicated by the full state.
fn explore(name: &str, start: World, depth: usize, full: bool, liveness_every: usize) -> (usize, usize, Vec<String>) {
    let t0 = std::time::Instant::now();
    let mut per_depth = vec![0usize; depth + 1];
    let mut last_report = std::time::Instant::now();
    let mut nodes = vec![Node { world: start, parent: None, act: None }];
    let mut seen: HashSet<(u64, u64)> = HashSet::new();
    seen.insert(fingerprint(&nodes[0].world));
    let mut queue: VecDeque<(usize, usize)> = VecDeque::new();
    queue.push_back((0, 0));
    let mut failures = vec![];
    let mut transitions = 0usize;
    let mut checked_live = 0usize;
    while let Some((i, d)) = queue.pop_front() {
        per_depth[d] += 1;
        if last_report.elapsed().as_secs() >= 600 {
            eprintln!("{name}: progress {:.0} s: {} states, {transitions} transitions, at depth {d}, queue {}", t0.elapsed().as_secs_f64(), nodes.len(), queue.len());
            last_report = std::time::Instant::now();
        }
        if d % 1 == 0 && (nodes.len() % liveness_every == 0 || d <= 2) {
            let mut errs = vec![];
            liveness(&nodes[i].world, &mut errs);
            checked_live += 1;
            if !errs.is_empty() {
                failures.push(report(name, &path(&nodes, i), &errs));
            }
        }
        if d == depth {
            continue;
        }
        for act in actions(&nodes[i].world, full) {
            transitions += 1;
            let (after, errs) = step(&nodes[i].world, &act);
            if !errs.is_empty() {
                let mut t = path(&nodes, i);
                t.push(act.clone());
                failures.push(report(name, &t, &errs));
                if failures.len() > 20 {
                    return (nodes.len(), transitions, failures);
                }
            }
            let fp = fingerprint(&after);
            if seen.insert(fp) {
                nodes.push(Node { world: after, parent: Some(i), act: Some(act) });
                queue.push_back((nodes.len() - 1, d + 1));
            }
        }
    }
    eprintln!("{name}: {} states, {transitions} transitions, liveness checked on {checked_live} states, depth {depth}, states by depth {per_depth:?}, {} counterexample(s), {:.1} s", nodes.len(), failures.len(), t0.elapsed().as_secs_f64());
    (nodes.len(), transitions, failures)
}

/// A small deterministic generator (xorshift), so a failing walk is reproducible by its seed.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn pick<T: Clone>(&mut self, v: &[T]) -> T {
        v[(self.next() % v.len() as u64) as usize].clone()
    }
}

fn walk(name: &str, start: &World, seed: u64, steps: usize) -> Option<String> {
    let mut rng = Rng(seed | 1);
    let mut w = start.clone();
    let mut trace = vec![];
    for _ in 0..steps {
        let acts = actions(&w, true);
        let act = rng.pick(&acts);
        trace.push(act.clone());
        let (after, errs) = step(&w, &act);
        if std::env::var("PROOFS_TRACE").is_ok() {
            set_env("me.near", P, w.now, w.storage.clone());
            let (v, _) = apply(&mut w.clone(), &act);
            let by: Vec<(u64, Vec<u8>)> = { set_env("me.near", P, after.now, after.storage.clone()); load_key(APPROVERS_KEY).unwrap_or_default() };
            eprintln!("{:>3}. {act:?} -> {v:?} | pending {:?} | approvers {:?} | devices {:?}", trace.len(), after.c.pending.iter().map(|p| (p.id.0, p.approved)).collect::<Vec<_>>(), by.iter().map(|(i, k)| (*i, k.len())).collect::<Vec<_>>(), after.c.second_devices.iter().map(|k| fill_of(k)).collect::<Vec<_>>());
        }
        if !errs.is_empty() {
            return Some(report(&format!("{name} seed {seed}"), &trace, &errs));
        }
        w = after;
    }
    let mut errs = vec![];
    liveness(&w, &mut errs);
    if !errs.is_empty() {
        return Some(report(&format!("{name} seed {seed} (end)"), &trace, &errs));
    }
    None
}

fn env_num(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// Exhaustive: every interleaving of every actor's every action to the depth, from set-up (first 24 hours, young
/// second device) and from a day later (aged second device), with the full action set.
#[test]
fn checker_exhaustive() {
    silence_panics();
    let depth = env_num("PROOFS_DEPTH", 4);
    let mut failures = vec![];
    for (name, t0, pre) in [("from set-up", DAY_NS, 0u64), ("aged device, window over", DAY_NS, DAY_NS + 1)] {
        let mut start = initial(t0);
        if pre > 0 {
            apply(&mut start, &Act::Time(pre));
        }
        let (_, _, f) = explore(name, start, depth, true, 7);
        failures.extend(f);
    }
    print_gaps();
    if !failures.is_empty() {
        eprintln!("{}", failures.join("\n"));
        panic!("{} counterexample(s)", failures.len());
    }
    // Release 7 (A1 narrowed): every role check holds at contract level, so there is no pair left to NEAR's method lists.
    let gaps = GAPS.lock().unwrap().clone();
    assert!(gaps.is_empty(), "role separation gaps at contract level: {gaps:?}");
}

fn print_gaps() {
    let g = GAPS.lock().unwrap();
    eprintln!("role separation left to NEAR's method lists (assumption A1), {} pair(s):", g.len());
    for line in g.iter() {
        eprintln!("  - {line}");
    }
}

/// Deeper, with the owner's keys only (one phone, one device, one words): the recovery and dispute paths interleaved
/// with time to a greater depth.
#[test]
fn checker_exhaustive_deep_core() {
    silence_panics();
    let depth = env_num("PROOFS_DEPTH_CORE", 6);
    let mut start = initial(DAY_NS);
    apply(&mut start, &Act::Time(DAY_NS + 1));
    let (_, _, failures) = explore("core, aged device", start, depth, false, 23);
    if !failures.is_empty() {
        eprintln!("{}", failures.join("\n"));
        panic!("{} counterexample(s)", failures.len());
    }
}

/// Release 9 (R8-RS1): every interleaving, to `PROOFS_DEPTH_FINISH` (default 3) actions with the full action set, from
/// a state where a finish is on its way (its add and callback not yet run): the callback at once, with the add refused,
/// after the phone's stop, the device's refusal or yes, a second finish, time, every other actor. Three such states:
/// no device of age (set-up), a device of age that said yes, and a silent device of age after the fallback.
#[test]
fn checker_finish_interleavings() {
    silence_panics();
    let depth = env_num("PROOFS_DEPTH_FINISH", 3);
    let mut failures = vec![];
    let starts: [(&str, u64, Vec<Act>); 6] = [
        ("finishing, no device of age", 0, vec![Act::Start(W, N), Act::Time(DELAY_S * SECOND), Act::Finish(W)]),
        ("finishing, the device of age said yes", DAY_NS + 1, vec![Act::Start(W, N), Act::ApproveRec(D1), Act::Time(DELAY_S * SECOND), Act::Finish(W)]),
        ("finishing, a silent device of age, after the fallback", DAY_NS + 1, vec![Act::Start(W, N), Act::Time(7 * DAY_NS), Act::Finish(W)]),
        // RT3: the add succeeded, the callback was lost; an hour later the words finish again (delete, add, callback).
        ("a lost callback after a successful add, then the retry an hour later", 0, vec![Act::Start(W, N), Act::Time(DELAY_S * SECOND), Act::Finish(W), Act::CallbackLost(0), Act::Time(DELAY_S * SECOND), Act::Finish(W)]),
        // Re-freeze 2: the first finish's callback is late (still on its way an hour later) when the words retry; both
        // callbacks are then on their way, in either order (the late one must do nothing).
        ("a late callback after the retry an hour later", 0, vec![Act::Start(W, N), Act::Time(DELAY_S * SECOND), Act::Finish(W), Act::Time(DELAY_S * SECOND), Act::Finish(W)]),
        // RT3-b: a lost finish of a recovery that was then stopped; a new recovery to another key finishes (the old key goes).
        ("a lost finish, a stop, a new recovery to another key finishing", 0, vec![Act::Start(W, N), Act::Time(DELAY_S * SECOND), Act::Finish(W), Act::CallbackLost(0), Act::CancelRec(P), Act::Time(DELAY_S * SECOND), Act::Start(W, N2), Act::Time(DELAY_S * SECOND), Act::Finish(W)]),
    ];
    for (name, pre, prefix) in starts {
        let mut w = initial(DAY_NS);
        if pre > 0 {
            let _ = apply(&mut w, &Act::Time(pre));
        }
        for a in &prefix {
            let (after, errs) = step(&w, a);
            assert!(errs.is_empty(), "{name}: the prefix failed at {a:?}: {errs:?}");
            w = after;
        }
        assert!(!w.inflight.is_empty() && w.c.recovery.is_some(), "{name}: the prefix did not reach a finish on its way");
        // The callbacks on their way, in order, each add succeeding: an older (late) one does nothing, the latest finish
        // completes the recovery, and the new phone's key is on NEAR.
        let new = fill_of(&w.c.recovery.as_ref().unwrap().new_key.0);
        let mut done = w.clone();
        while !done.inflight.is_empty() {
            let (after, errs) = step(&done, &Act::Callback(0, true));
            assert!(errs.is_empty(), "{name}: a callback failed a check: {errs:?}");
            assert!(after.inflight.is_empty() || after.c.recovery.is_some(), "{name}: a late callback finished the recovery");
            done = after;
        }
        assert!(done.c.recovery.is_none() && done.phone == new && done.near.get(&new) == Some(&K_PHONE) && !done.near.contains_key(&P), "{name}: the finish did not complete");
        assert!(done.near.keys().all(|k| [new, W, D1].contains(k)), "{name}: a key other than the phone, words and device is left on NEAR: {:?}", done.near);
        let (_, _, f) = explore(name, w, depth, true, 7);
        failures.extend(f);
    }
    if !failures.is_empty() {
        eprintln!("{}", failures.join("\n"));
        panic!("{} counterexample(s)", failures.len());
    }
}

/// Long random walks over the full action set, every actor including the thief's keys, with the model in lockstep.
#[test]
fn checker_random_walks() {
    silence_panics();
    let walks = env_num("PROOFS_WALKS", 2000);
    let steps = env_num("PROOFS_STEPS", 120);
    let start = initial(DAY_NS);
    let mut failures = vec![];
    for seed in 1..=walks as u64 {
        if let Some(f) = walk("walk", &start, seed * 2_654_435_761, steps) {
            failures.push(f);
            if failures.len() >= 5 {
                break;
            }
        }
    }
    eprintln!("random walks: {walks} × {steps} steps ({} transitions), {} counterexample(s)", walks * steps, failures.len());
    print_gaps();
    if !failures.is_empty() {
        eprintln!("{}", failures.join("\n"));
        panic!("{} counterexample(s)", failures.len());
    }
}

/// P-1, fixed in release 7: a step with more gas than NEAR gives a transaction is refused at `execute_many` (and
/// `execute`) itself, so a chain whose gas would add past u64::MAX is never placed; nothing waits, nothing moves.
#[test]
fn p1_chain_gas_overflow_refused_at_the_door() {
    silence_panics();
    let w = initial(DAY_NS);
    set_env("me.near", P, w.now, w.storage.clone());
    let mut c = copy(&w.c);
    let step = Step::FunctionCall { method_name: "near_deposit".into(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(u64::MAX) };
    let groups = vec![Group { receiver_id: bob(), steps: vec![Step::Transfer { deposit: U128(NEAR) }] }, Group { receiver_id: bob(), steps: vec![step.clone(), step.clone()] }];
    QUIET.with(|q| q.set(true));
    let r = catch_unwind(AssertUnwindSafe(|| c.execute_many(groups)));
    let r2 = catch_unwind(AssertUnwindSafe(|| c.execute(bob(), vec![step], None)));
    QUIET.with(|q| q.set(false));
    for r in [r, r2] {
        let msg = match r {
            Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default(),
            Ok(_) => panic!("expected the refusal"),
        };
        assert!(msg.contains("300 Tgas") || msg.contains("250 Tgas in all"), "{msg}");
    }
    assert!(c.pending.is_empty(), "nothing was placed");
    // Release 8 (RS-1): a single execute carries at most 250 Tgas in all, so exactly 250 Tgas is accepted.
    set_env("me.near", P, w.now, w.storage.clone());
    let mut c = copy(&w.c);
    let ok = Step::FunctionCall { method_name: "near_deposit".into(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(250_000_000_000_000) };
    let out = c.execute(bob(), vec![ok], None);
    assert!(out.done || out.id.is_some());
}

/// Replays one action list from set-up, printing both sides after every step (debugging aid for a counterexample).
#[test]
#[ignore]
fn replay_trace() {
    silence_panics();
    let trace = vec![
        Act::Time(3600000000000), Act::Exec(1, Some(5 * NEAR)), Act::RemoveKey(5, 3), Act::Exec(5, Some(500 * NEAR)), Act::RemoveKey(1, 2), Act::Approve(3, 5), Act::RemoveKey(5, 2), Act::Decline(2, 5), Act::Exec(1, None), Act::Stranger, Act::SetProt(1, 1), Act::SetProt(5, 2), Act::Approve(2, 6), Act::Time(93601000000000), Act::SetProt(1, 1), Act::SetProt(1, 2), Act::Approve(2, 9), Act::Decline(3, 7), Act::SetProt(1, 1), Act::Decline(2, 7), Act::Run(5, 5), Act::Decline(3, 5),
    ];
    let mut w = initial(DAY_NS);
    for (i, act) in trace.iter().enumerate() {
        let (after, errs) = step(&w, act);
        set_env("me.near", P, after.now, after.storage.clone());
        let by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
        eprintln!("{:>3}. {act:?} | c.pending {:?} | approvers {:?} | m.pending {:?} | errs {errs:?}", i + 1, after.c.pending.iter().map(|p| (p.id.0, p.approved)).collect::<Vec<_>>(), by.iter().map(|(i, k)| (*i, k.len())).collect::<Vec<_>>(), after.m.pending.iter().map(|p| (p.id, p.approved, p.approver)).collect::<Vec<_>>());
        w = after;
    }
}
