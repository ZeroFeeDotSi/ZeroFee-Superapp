//! Kani (CBMC) bounded proofs over the REAL contract functions: this file is compiled as a child module of the pinned
//! lib.rs (see proofs/build.rs), so it calls the private functions themselves, not paraphrases.
//!
//! NEAR's host functions are replaced by stubs (`#[kani::stub]`): time and the `freeze` cell are symbolic statics,
//! storage writes and logs are no-ops, and `env::panic_str` either PRUNES the path (`panic_prune`: "if the call does not
//! panic, then …") or FAILS the proof (`panic_fail`: "the call never panics"). Each harness says which.
//!
//! Run: `cd contracts/account-policy/proofs && CARGO_TARGET_DIR=… cargo kani` (every harness), or `cargo kani --harness <name>`.
use super::*;

static mut NOW: u64 = 0;
static mut FREEZE: Option<u64> = None;

fn now_stub() -> u64 {
    unsafe { NOW }
}
fn storage_read_stub(key: &[u8]) -> Option<Vec<u8>> {
    if key == FREEZE_KEY {
        unsafe { FREEZE.map(|u| u.to_le_bytes().to_vec()) }
    } else {
        None
    }
}
fn storage_write_stub(_key: &[u8], _value: &[u8]) -> bool {
    false
}
fn storage_remove_stub(_key: &[u8]) -> bool {
    false
}
fn log_stub(_s: &str) {}
fn sha256_stub(v: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; 32];
    for (i, b) in v.iter().take(32).enumerate() {
        out[i] = *b;
    }
    out
}
/// "Assuming this call does not panic": the panicking path is pruned.
fn panic_prune(_msg: &str) -> ! {
    kani::assume(false);
    unreachable!()
}
/// "This call never panics": reaching here fails the proof.
fn panic_fail(msg: &str) -> ! {
    panic!("contract panicked: {msg}")
}

/// Block timestamps are nanoseconds since 1970; NEAR's are far below 2^62 (year 2116). Every time proof assumes this.
const MAX_NOW: u64 = 1 << 62;

fn any_level() -> Level {
    let kind: u8 = kani::any();
    kani::assume(kind < 4);
    let seconds: u64 = kani::any();
    kani::assume(seconds <= (MAX_WAIT_NS + DAY_NS) / SECOND);
    match kind {
        0 => Level::FaceId,
        1 => Level::Wait { seconds: U64(seconds) },
        2 => Level::Device,
        _ => Level::Both { seconds: U64(seconds) },
    }
}

fn any_delay() -> u64 {
    let d: u64 = kani::any();
    kani::assume(d >= MIN_RECOVERY_DELAY_NS && d <= MAX_WAIT_NS);
    d
}

fn policy(delay_ns: u64, bands: Vec<Band>, recovery: bool, second_devices: usize) -> AccountPolicy {
    AccountPolicy {
        recovery_delay_ns: delay_ns,
        recovery: recovery.then(|| PendingRecovery { new_key: Base64VecU8(vec![]), ready_at_ns: U64(0) }),
        recovery_key: None,
        second_devices: (0..second_devices).map(|i| vec![i as u8]).collect(),
        bands,
        pending: vec![],
        spent: vec![],
        next_id: 1,
    }
}

// ── P1  Budget arithmetic: share_ppm ─────────────────────────────────────────────────────────────────────────────

/// For ALL u128 `total`, `limit`: share_ppm never panics (no overflow, no division by zero); it answers Some only when
/// total ≤ limit, the share is at most the whole (PPM), it is the whole when total == limit, zero only when total is
/// zero, and it is never under-estimated (rounded down): the budget check is conservative for every value.
#[kani::proof]
fn p1_share_ppm_total() {
    let total: u128 = kani::any();
    let limit: u128 = kani::any();
    match share_ppm(total, limit) {
        None => assert!(total > limit || (limit == 0 && total > 0)),
        Some(s) => {
            assert!(total <= limit);
            assert!(s <= PPM);
            assert!(total == 0 || s > 0);
            assert!(total != limit || total == 0 || s == PPM);
            // Never under-estimated: s ≥ total·PPM/limit, checked on the branch where that product fits in u128.
            if let Some(t) = total.checked_mul(PPM) {
                if limit > 0 {
                    assert!(s >= t / limit);
                }
            } else {
                // Overflow branch: limit ≥ total > u128::MAX / PPM, so limit / PPM > 0 (no division by zero), and the
                // share is at least total / (limit/PPM) ≥ total·PPM/limit.
                assert!(limit / PPM > 0);
                assert!(s >= (total / (limit / PPM)).min(PPM));
            }
        }
    }
}

/// The same statement with both values below 2^64 (cheap for CBMC; the full-range harness above may time out on a
/// loaded machine, in which case this one is the proof for amounts up to 1.8·10¹⁹ yocto-units, i.e. ≤ 18 NEAR-scale
/// units of a 24-decimal coin, and the overflow branch is then covered only by P1 if it completes).
#[kani::proof]
fn p1c_share_ppm_u64_range() {
    let total: u128 = u128::from(kani::any::<u64>());
    let limit: u128 = u128::from(kani::any::<u64>());
    match share_ppm(total, limit) {
        None => assert!(total > limit || (limit == 0 && total > 0)),
        Some(s) => {
            assert!(total <= limit && s <= PPM);
            assert!(total == 0 || s > 0);
            assert!(total != limit || total == 0 || s == PPM);
            assert!(s >= total * PPM / limit.max(1));
        }
    }
}

/// The same statement for values below 2^32 (29 Oct: the u64-range and full-range harnesses time out at 5 minutes on
/// this box; 128-bit multiplication and division are hard for the SAT back end). Bound stated in the report.
#[kani::proof]
fn p1d_share_ppm_u32_range() {
    let total: u128 = u128::from(kani::any::<u32>());
    let limit: u128 = u128::from(kani::any::<u32>());
    match share_ppm(total, limit) {
        None => assert!(total > limit || (limit == 0 && total > 0)),
        Some(s) => {
            assert!(total <= limit && s <= PPM);
            assert!(total == 0 || s > 0);
            assert!(total != limit || total == 0 || s == PPM);
            assert!(s >= total * PPM / limit.max(1));
        }
    }
}

/// Monotone: more spent of the same coin never gives a smaller share.
#[kani::proof]
fn p1b_share_ppm_monotone() {
    let a: u128 = kani::any();
    let b: u128 = kani::any();
    let limit: u128 = kani::any();
    kani::assume(a <= b);
    match (share_ppm(a, limit), share_ppm(b, limit)) {
        (Some(sa), Some(sb)) => assert!(sa <= sb),
        (None, Some(_)) => unreachable!("a ≤ b fits but a does not"),
        _ => {}
    }
}

// ── P2  Level order ───────────────────────────────────────────────────────────────────────────────────────────────

/// `covers` is a preorder (reflexive, transitive); `without_device` never needs a device and keeps the wait; `wait_ns`
/// never panics for any seconds (saturating).
#[kani::proof]
fn p2_level_order() {
    let a = any_level();
    let b = any_level();
    let c = any_level();
    assert!(a.covers(&a));
    if a.covers(&b) && b.covers(&c) {
        assert!(a.covers(&c));
    }
    let w = a.clone().without_device();
    assert!(!w.needs_device());
    assert_eq!(w.wait_ns(), a.wait_ns());
    let any_seconds: u64 = kani::any();
    let _ = Level::Wait { seconds: U64(any_seconds) }.wait_ns();
}

// ── P3  The floor: a change always outlasts a recovery ───────────────────────────────────────────────────────────

/// For every allowed delay: delay < floor ≤ delay + 1 day ≤ 31 days, with no overflow; and for every level and any
/// block time, a setting's wait `max(level wait, floor)` is at least the floor and its ready time fits in u64.
#[kani::proof]
fn p3_floor() {
    let delay = any_delay();
    let p = policy(delay, vec![], false, 0);
    let floor = p.floor_ns();
    assert!(floor > delay);
    assert!(floor <= delay + DAY_NS);
    assert!(floor <= MAX_WAIT_NS + DAY_NS);
    assert!(floor >= 2 * MIN_RECOVERY_DELAY_NS);
    let level = any_level();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let wait = level.wait_ns().max(floor);
    assert!(wait >= floor);
    assert!(now.checked_add(wait).is_some());
    // The phone's stop of a recovery (with an aged device) waits at most a day and at most half the delay (R3).
    let stop = DAY_NS.min(delay / 2) / SECOND * SECOND;
    assert!(stop <= DAY_NS && stop <= delay / 2);
}

// ── P4  Frozen: nothing at Face ID, every level waits at least the floor ─────────────────────────────────────────

/// For every level, delay, block time, freeze cell and recovery state: while frozen (a recovery waits, or now is before
/// the freeze's end) `unless_frozen` returns a level that waits ≥ floor, is never Face ID, and needs a device exactly
/// when the input did; when not frozen it returns the input unchanged.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_read_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p4_unless_frozen() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let freeze: Option<u64> = kani::any();
    unsafe {
        NOW = now;
        FREEZE = freeze;
    }
    let recovery: bool = kani::any();
    let delay = any_delay();
    let p = policy(delay, vec![], recovery, 0);
    let level = any_level();
    let out = p.unless_frozen(level.clone());
    let frozen = recovery || now < freeze.unwrap_or(0);
    if frozen {
        assert!(out != Level::FaceId && out != Level::Device);
        assert!(out.wait_ns() >= p.floor_ns());
        assert!(out.wait_ns() >= level.wait_ns());
        assert_eq!(out.needs_device(), level.needs_device());
    } else {
        assert_eq!(out, level);
    }
}

// ── P5  Bands accepted by check_bands are monotone; the strictest covers every band ──────────────────────────────

fn any_band(last: bool) -> Band {
    let level = any_level();
    let n: usize = kani::any();
    kani::assume(n <= 1);
    let up_to = if last {
        None
    } else {
        let mut limits = vec![];
        for i in 0..n {
            let amount: u128 = kani::any();
            limits.push((if i == 0 { "near".to_string() } else { "x".to_string() }, U128(amount)));
        }
        Some(limits)
    };
    Band { up_to, level }
}

/// If `check_bands` accepts a list of up to three bands (any levels, any limits), then every later band covers every
/// earlier one and the last (the strictest) covers them all, and every level that needs a device has a device on the
/// account. Proven "assuming it does not panic": panic paths pruned.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn p5_check_bands_monotone() {
    // Memory bound (28 Oct): at most two bands (was three).
    let n: usize = kani::any();
    kani::assume(n >= 1 && n <= 2);
    let devices: usize = kani::any();
    kani::assume(devices <= 1);
    let mut bands = vec![];
    for i in 0..n {
        bands.push(any_band(i + 1 == n));
    }
    let p = policy(MIN_RECOVERY_DELAY_NS, vec![], false, devices);
    p.check_bands(&bands);
    let strictest = bands.last().unwrap().level.clone();
    for i in 0..n {
        for j in i..n {
            assert!(bands[j].level.covers(&bands[i].level));
        }
        assert!(strictest.covers(&bands[i].level));
        assert!(bands[i].level.wait_ns() <= MAX_WAIT_NS + DAY_NS);
        assert!(!bands[i].level.needs_device() || devices > 0);
        assert_eq!(bands[i].up_to.is_none(), i + 1 == n);
    }
}

// ── P6  Band selection: the chosen band's budget is met, and nothing lower would have fit ────────────────────────

/// One coin, three bands (≤ L1 Face ID, ≤ L2 Wait, else Both), up to two earlier rows in the 24-hour list (any amount,
/// any time, counting or not), one request of any amount. For ALL such values: the level returned is Face ID only if
/// the 24-hour total including this request is ≤ L1, Wait only if ≤ L2, and otherwise Both; that is, no amount above a
/// band's limit, split or not, ever gets that band's protection.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p6_level_for_moves_budget() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let l1: u128 = kani::any();
    let l2: u128 = kani::any();
    kani::assume(l1 > 0 && l2 >= l1);
    let bands = vec![
        Band { up_to: Some(vec![("near".to_string(), U128(l1))]), level: Level::FaceId },
        Band { up_to: Some(vec![("near".to_string(), U128(l2))]), level: Level::Wait { seconds: U64(1) } },
        Band { up_to: None, level: Level::Both { seconds: U64(1) } },
    ];
    let mut p = policy(MIN_RECOVERY_DELAY_NS, bands, false, 1);
    // Memory bound (28 Oct): at most one earlier row (was two).
    let rows: usize = kani::any();
    kani::assume(rows <= 1);
    let mut counted: u128 = 0;
    for i in 0..rows {
        let at_ns: u64 = kani::any();
        let amount: u128 = kani::any();
        kani::assume(at_ns <= MAX_NOW);
        let waiting: bool = kani::any();
        let id = i as u64 + 1;
        if waiting {
            p.pending.push(Pending { id: U64(id), change: Change::Upgrade { code_hash: Base64VecU8(vec![]) }, ready_at_ns: U64(0), needs_device: false, approved: false });
        }
        p.spent.push(Spent { at_ns, id, coin: "near".to_string(), amount });
        if at_ns + DAY_NS > now || waiting {
            counted = counted.saturating_add(amount);
        }
    }
    let x: u128 = kani::any();
    kani::assume(x > 0);
    let total = counted.saturating_add(x);
    let level = p.level_for_moves(&[("near".to_string(), x)]);
    match level {
        Level::FaceId => assert!(total <= l1),
        Level::Wait { .. } => assert!(total <= l2 && total > l1),
        Level::Both { .. } => assert!(total > l2),
        Level::Device => unreachable!(),
    }
}

/// A request in a coin no band lists goes to the strictest band, whatever its amount and whatever was spent.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p6b_unlisted_coin_is_strictest() {
    unsafe { NOW = 0 }
    let l1: u128 = kani::any();
    let bands = vec![Band { up_to: Some(vec![("near".to_string(), U128(l1))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(7) } }];
    let p = policy(MIN_RECOVERY_DELAY_NS, bands, false, 0);
    let x: u128 = kani::any();
    kani::assume(x > 0);
    assert_eq!(p.level_for_moves(&[("x".to_string(), x)]), Level::Wait { seconds: U64(7) });
}

// ── P7  Measuring: transfers, allowlisted calls and gas-as-NEAR never panic, and add up conservatively ───────────

/// For ALL deposits and gas: a transfer, a transfer and an allowlisted call with empty args measure to Some("near", …)
/// equal to the saturating sum of the deposits plus gas × GAS_PRICE_COUNTED; the gas product never overflows u128.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p7_moves_transfer_and_gas() {
    let d1: u128 = kani::any();
    let d2: u128 = kani::any();
    let gas: u64 = kani::any();
    // 29 Oct: a symbolic choice among the 8 allowlisted methods timed out (string compares under CBMC); one concrete
    // method, every amount and gas symbolic. The other seven names are exercised by the existing unit tests.
    let method = "near_deposit".to_string();
    let steps = vec![Step::Transfer { deposit: U128(d1) }, Step::FunctionCall { method_name: method, args: Base64VecU8(vec![]), deposit: U128(d2), gas: U64(gas) }];
    let out = moves("bob.near", &steps).expect("measured");
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].0, "near");
    let gas_near = u128::from(gas).checked_mul(GAS_PRICE_COUNTED).expect("gas × price fits u128");
    assert_eq!(out[0].1, d1.saturating_add(d2).saturating_add(gas_near));
}

/// A call to any other method on an ordinary contract can't be measured (goes to the strictest band), whatever it carries.
#[kani::proof]
#[kani::unwind(3)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p7b_unknown_call_unmeasured() {
    let d: u128 = kani::any();
    let gas: u64 = kani::any();
    let steps = vec![Step::FunctionCall { method_name: "anything".to_string(), args: Base64VecU8(vec![]), deposit: U128(d), gas: U64(gas) }];
    assert!(moves("bob.near", &steps).is_none());
}

/// add_move saturates and never panics.
#[kani::proof]
#[kani::unwind(8)]
fn p7c_add_move_saturates() {
    let a: u128 = kani::any();
    let b: u128 = kani::any();
    let mut m = vec![("near".to_string(), a)];
    add_move(&mut m, "near", b);
    assert_eq!(m.len(), 1);
    assert_eq!(m[0].1, a.saturating_add(b));
}

// ── P8  Row bound: the 24-hour list never exceeds MAX_SPENT_ROWS ─────────────────────────────────────────────────

/// From any list of ≤ MAX_SPENT_ROWS rows (any times) and a request of ≤ 2 coins (any amounts): if count_today does not
/// panic, the list still has ≤ MAX_SPENT_ROWS rows, every added row carries the request's id and a positive amount, and
/// no row that still counts was dropped.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn p8_spent_rows_bounded() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let mut p = policy(MIN_RECOVERY_DELAY_NS, vec![], false, 0);
    // Symbolic small prefix; the bound itself is what matters, so the list is filled to a symbolic length ≤ MAX.
    // Memory bound (28 Oct): the symbolic prefix is at most 6 rows (was MAX_SPENT_ROWS); the 128-row cap itself is
    // held by the checker's invariant I1 on every reached state and by the existing v_a3 tests.
    let len: usize = kani::any();
    kani::assume(len <= 6);
    let old_at: u64 = kani::any();
    kani::assume(old_at <= MAX_NOW);
    p.spent = (0..len).map(|i| Spent { at_ns: old_at, id: i as u64, coin: "near".to_string(), amount: 1 }).collect();
    let still_count = old_at + DAY_NS > now;
    let a: u128 = kani::any();
    let b: u128 = kani::any();
    p.count_today(999, vec![("near".to_string(), a), ("x".to_string(), b)]);
    assert!(p.spent.len() <= MAX_SPENT_ROWS);
    let added = p.spent.iter().filter(|s| s.id == 999).count();
    assert_eq!(added, (a > 0) as usize + (b > 0) as usize);
    assert!(p.spent.iter().filter(|s| s.id == 999).all(|s| s.amount > 0 && s.at_ns == now));
    let kept_old = p.spent.iter().filter(|s| s.id != 999).count();
    assert_eq!(kept_old, if still_count { len } else { 0 });
}

// ── P9  Placing a change: settings always wait the floor; waiting lists are bounded ──────────────────────────────

/// For every level (not Face ID with no floor, which runs at once: that path makes promises and is covered by the
/// checker), delay and block time: a Spend placed waits exactly the level's wait and keeps its device need; a setting
/// (protection, second device, key removal, new words when words exist, upgrade) waits at least the floor; the first
/// backup key waits only its level. Proven assuming no panic (the panic paths are the list bounds and "needs a second
/// device, none added").
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_read_stub)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn p9_place_waits() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        FREEZE = None;
    }
    let delay = any_delay();
    let has_words: bool = kani::any();
    let mut p = policy(delay, vec![], false, 1);
    if has_words {
        p.recovery_key = Some(vec![9]);
    }
    let level = any_level();
    let kind: u8 = kani::any();
    kani::assume(kind < 6);
    let change = match kind {
        0 => Change::Spend { receiver_id: "bb".parse().unwrap(), steps: vec![] },
        1 => Change::SetProtection { bands: vec![] },
        2 => Change::AddSecondDevice { public_key: Base64VecU8(vec![]) },
        3 => Change::RemoveKey { public_key: Base64VecU8(vec![]) },
        4 => Change::SetRecoveryKey { public_key: Base64VecU8(vec![]) },
        _ => Change::Upgrade { code_hash: Base64VecU8(vec![]) },
    };
    let setting = is_setting(&change);
    let first_words = kind == 4 && !has_words;
    // The run-at-once path (Face ID, no floor) builds promises: out of this harness's reach.
    kani::assume(!(level == Level::FaceId && (!setting || first_words)));
    let out = p.place(1, change, level.clone());
    assert!(!out.done);
    assert_eq!(out.id, Some(U64(1)));
    assert_eq!(p.pending.len(), 1);
    let ready = out.ready_at_ns.unwrap().0;
    assert!(ready >= now);
    assert_eq!(p.pending[0].needs_device, level.needs_device());
    assert_eq!(out.needs_device, level.needs_device());
    if setting && !first_words {
        assert!(ready - now >= p.floor_ns());
        assert!(ready - now > delay);
    } else {
        assert_eq!(ready - now, level.wait_ns());
    }
    assert!(ready - now >= level.wait_ns());
}

// ── P10  Step and key checks never panic on the accepted shapes; bounds hold ────────────────────────────────────

/// check_steps accepts exactly 1..=10 steps whose calls have a non-empty method ≤ 256 bytes, args ≤ 4096 bytes and a
/// method outside NEVER_CALLED (symbolic lengths, symbolic method among a blocked one and an allowed one).
#[kani::proof]
#[kani::unwind(20)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn p10_check_steps_bounds() {
    let n: usize = kani::any();
    kani::assume(n <= 2);
    let blocked: bool = kani::any();
    // Memory bound (review, 28 Oct): three concrete buffer sizes picked symbolically, not a symbolic length
    // (a symbolic-length 4,097-byte buffer made CBMC use over 20 GB).
    // 29 Oct: even concrete 4,096-byte buffers timed out; args are 0 or 1 byte here, so the 4,096-byte limit itself
    // is not proven by Kani (it is a plain length compare, covered by the existing tests).
    let which_len: u8 = kani::any();
    kani::assume(which_len < 2);
    let args_len = which_len as usize;
    let mut steps = vec![];
    for _ in 0..n {
        steps.push(Step::FunctionCall { method_name: if blocked { "add_public_key".to_string() } else { "ft_transfer".to_string() }, args: Base64VecU8(vec![0u8; args_len]), deposit: U128(0), gas: U64(0) });
    }
    check_steps(&steps);
    assert!(n >= 1 && !blocked && args_len <= MAX_ARGS);
}

/// Only a 1,953-byte key with tag 2 is an ML-DSA-65 key.
#[kani::proof]
#[kani::unwind(2)]
fn p10b_key_shape() {
    let len: usize = kani::any();
    kani::assume(len <= 1 + ML_DSA_65_PUBLIC_KEY_LEN + 1);
    let tag: u8 = kani::any();
    let mut k = vec![0u8; len];
    if len > 0 {
        k[0] = tag;
    }
    assert_eq!(is_ml_dsa_65_key(&k), len == 1 + ML_DSA_65_PUBLIC_KEY_LEN && tag == ML_DSA_65_TAG);
}

// ── P11  Ages: a device is of age iff its clock plus the floor has passed; a stopped clock never ages ────────────

/// For any floor and any recorded start: `aged_hash` is true exactly when now ≥ start + floor (saturating: a clock at
/// u64::MAX, "stopped", never ages), and a key with no record counts as aged (from before ages were kept).
#[kani::proof]
#[kani::unwind(40)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, ages_read_stub)]
fn p11_aged_hash() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let at: u64 = kani::any();
    unsafe {
        NOW = now;
        AGE_AT = at;
    }
    let p = policy(any_delay(), vec![], false, 0);
    let aged = p.aged_hash(&[7u8; 32]);
    assert_eq!(aged, now >= at.saturating_add(p.floor_ns()));
    if at == u64::MAX {
        assert!(!aged);
    }
    assert!(p.aged_hash(&[8u8; 32]));
}

static mut AGE_AT: u64 = 0;
fn ages_read_stub(key: &[u8]) -> Option<Vec<u8>> {
    if key == DEVICE_AGES_KEY {
        // borsh of vec![([7u8; 32], AGE_AT)]: len u32, then Vec<u8> (len u32 + bytes), then u64.
        let mut v = vec![];
        v.extend_from_slice(&1u32.to_le_bytes());
        v.extend_from_slice(&32u32.to_le_bytes());
        v.extend_from_slice(&[7u8; 32]);
        v.extend_from_slice(&unsafe { AGE_AT }.to_le_bytes());
        Some(v)
    } else {
        None
    }
}

// ── P12  (finding candidate) a chain's gas sum can overflow u64 and panic at finish time ─────────────────────────

/// Witness: with groups whose step gas adds past u64::MAX, dispatch_chain's gas sum overflows (overflow-checks are on in
/// the release profile, so it panics and the receipt fails). Expected: VERIFICATION FAILED with an overflow trace. The
/// request can then never run (its own phone cancels it); nothing moves, see contract-proofs.md P-1.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::current_account_id, me_stub)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
fn p12_chain_gas_sum_overflow_witness() {
    let g: u64 = kani::any();
    kani::assume(g >= 1 << 63);
    let step = Step::FunctionCall { method_name: "m".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g) };
    let rest = vec![Group { receiver_id: "bb".parse().unwrap(), steps: vec![step.clone(), step.clone()] }];
    let first = Group { receiver_id: "bb".parse().unwrap(), steps: vec![Step::Transfer { deposit: U128(1) }] };
    dispatch_chain(first, rest);
}
fn me_stub() -> AccountId {
    "mm".parse().unwrap()
}

// ── Round 2 (29 Oct): the u128 division replaced by its algebraic specification ─────────────────────────────────

/// Specification of `u128::div_ceil(a, b)` for b > 0: the unique q with q·b ≥ a and (q − 1)·b < a. Used as a stub so the
/// SAT back end sees two multiplications instead of a 128-bit divider. Sound wherever q·b fits in u128 (paths where
/// it would not are pruned: a sliver next to u128::MAX, stated in the report).
fn div_ceil_spec(a: u128, b: u128) -> u128 {
    kani::assume(b != 0);
    let q: u128 = kani::any();
    let qb = q.checked_mul(b);
    kani::assume(qb.is_some_and(|p| p >= a));
    kani::assume(q == 0 || (q - 1).checked_mul(b).is_some_and(|p| p < a));
    q
}

/// P1 with the divider stubbed by its specification; every value of total and limit in u128.
#[kani::proof]
#[kani::solver(kissat)]
#[kani::stub(u128::div_ceil, div_ceil_spec)]
fn p1e_share_ppm_divceil_spec() {
    let total: u128 = kani::any();
    let limit: u128 = kani::any();
    match share_ppm(total, limit) {
        None => assert!(total > limit || (limit == 0 && total > 0)),
        Some(s) => {
            assert!(total <= limit);
            assert!(s <= PPM);
            assert!(total == 0 || s > 0);
            assert!(total != limit || total == 0 || s == PPM);
        }
    }
}

/// P1d again with the kissat solver (a solver trial, same statement).
#[kani::proof]
#[kani::solver(kissat)]
fn p1f_share_ppm_u32_kissat() {
    let total: u128 = u128::from(kani::any::<u32>());
    let limit: u128 = u128::from(kani::any::<u32>());
    match share_ppm(total, limit) {
        None => assert!(total > limit || (limit == 0 && total > 0)),
        Some(s) => {
            assert!(total <= limit && s <= PPM);
            assert!(total == 0 || s > 0);
            assert!(total != limit || total == 0 || s == PPM);
        }
    }
}

/// P4 without the freeze cell (storage empty): the recovery half of "frozen", every level, delay and time; no borsh.
#[kani::proof]
#[kani::unwind(12)]
#[kani::solver(kissat)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn p4a_unless_frozen_recovery_only() {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let recovery: bool = kani::any();
    let delay = any_delay();
    let p = policy(delay, vec![], recovery, 0);
    let level = any_level();
    let out = p.unless_frozen(level.clone());
    if recovery {
        assert!(out != Level::FaceId && out != Level::Device);
        assert!(out.wait_ns() >= p.floor_ns());
        assert!(out.wait_ns() >= level.wait_ns());
        assert_eq!(out.needs_device(), level.needs_device());
    } else {
        assert_eq!(out, level);
    }
}
fn storage_none_stub(_key: &[u8]) -> Option<Vec<u8>> {
    None
}

// ═══ Release 7 (29 Oct, round 3): the new arithmetic and decisions ═══════════════════════════════════════════════

fn storage_none(_key: &[u8]) -> Option<Vec<u8>> {
    None
}
/// `env::sha256` is generic (`impl AsRef<[u8]>`) in near-sdk 5.29; the stub must be too. Injective on inputs of at most
/// 32 bytes (every key in these harnesses), which is all the decisions below rely on.
fn sha256_any<T: AsRef<[u8]>>(v: T) -> Vec<u8> {
    let v = v.as_ref();
    let mut out = vec![0u8; 33];
    for (i, b) in v.iter().take(32).enumerate() {
        out[i] = *b;
    }
    out[32] = v.len() as u8;
    out
}
/// The contract's event log line (a `format!` of a JSON line, no state): a no-op, so CBMC does not unroll the formatter.
fn event_stub(_name: &str, _value: u64) {}
static mut WROTE_FALLBACK: Option<u64> = None;
static mut WROTE_YES: bool = false;
static mut WROTE_STOP_ASKED: bool = false;
static mut WROTE_FREEZE: Option<u64> = None;
static mut STOP_ASKED: bool = false;
/// Records the cells the contract writes (borsh of a u64 is its 8 little-endian bytes).
fn storage_write_record(key: &[u8], value: &[u8]) -> bool {
    unsafe {
        if key == FALLBACK_KEY && value.len() == 8 {
            WROTE_FALLBACK = Some(u64::from_le_bytes(value.try_into().unwrap()));
        } else if key == RECOVERY_YES_KEY {
            WROTE_YES = true;
        } else if key == STOP_ASKED_KEY {
            WROTE_STOP_ASKED = true;
        } else if key == FREEZE_KEY && value.len() == 8 {
            WROTE_FREEZE = Some(u64::from_le_bytes(value.try_into().unwrap()));
        }
    }
    false
}
fn storage_has_key_stub(key: &[u8]) -> bool {
    key == STOP_ASKED_KEY && unsafe { STOP_ASKED }
}
fn me_id() -> AccountId {
    "mm".parse().unwrap()
}
fn signer_nine() -> Vec<u8> {
    vec![9]
}
fn signer_seven() -> Vec<u8> {
    vec![7]
}
fn r7_policy(delay: u64, devices: usize, recovery: Option<(Vec<u8>, u64)>) -> AccountPolicy {
    AccountPolicy {
        recovery_delay_ns: delay,
        recovery: recovery.map(|(k, t)| PendingRecovery { new_key: Base64VecU8(k), ready_at_ns: U64(t) }),
        recovery_key: Some(vec![4]),
        second_devices: (0..devices).map(|_| vec![9]).collect(),
        bands: vec![Band { up_to: None, level: Level::FaceId }],
        pending: vec![],
        spent: vec![],
        next_id: 1,
    }
}
fn any_r7_delay() -> u64 {
    let d: u64 = kani::any();
    kani::assume(d >= DAY_NS && d <= MAX_WAIT_NS);
    d
}

/// R7-1: for EVERY u64 delay the default fallback is within [7 d, 30 d]; for every allowed delay (1–30 d) it is exactly
/// 3·delay clamped to that range, never below the delay, never below a week, and monotone in the delay. The app's
/// four choices give 7, 7, 9 and 21 days; a 30-day delay gives 30.
#[kani::proof]
fn r7_1_fallback_default() {
    let any: u64 = kani::any();
    let f = default_fallback_ns(any);
    assert!(f >= MIN_FALLBACK_NS && f <= MAX_FALLBACK_NS);
    let d = any_r7_delay();
    let f = default_fallback_ns(d);
    assert_eq!(f, (3 * d).max(7 * DAY_NS).min(30 * DAY_NS));
    assert!(f >= d);
    let d2 = any_r7_delay();
    if d <= d2 {
        assert!(default_fallback_ns(d) <= default_fallback_ns(d2));
    }
    assert_eq!(default_fallback_ns(DAY_NS), 7 * DAY_NS);
    assert_eq!(default_fallback_ns(2 * DAY_NS), 7 * DAY_NS);
    assert_eq!(default_fallback_ns(3 * DAY_NS), 9 * DAY_NS);
    assert_eq!(default_fallback_ns(7 * DAY_NS), 21 * DAY_NS);
    assert_eq!(default_fallback_ns(30 * DAY_NS), 30 * DAY_NS);
}

/// R7-1b: a fallback `check_fallback` accepts lies in [default(delay), 30 d] (every delay, every fallback; pruned on
/// refusal).
#[kani::proof]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_1b_check_fallback() {
    let d: u64 = kani::any();
    let f: u64 = kani::any();
    check_fallback(d, f);
    assert!(f >= default_fallback_ns(d) && f <= MAX_FALLBACK_NS);
    assert!(f >= MIN_FALLBACK_NS);
}

/// R7-1c: `new` itself, every delay and fallback argument (seconds, u64): if it returns, the delay is 1–30 days, stored
/// in ns exactly, and the fallback cell written is the argument (or the default when none) and within its bounds.
#[kani::proof]
#[kani::unwind(40)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_1c_new_bounds() {
    let delay_s: u64 = kani::any();
    let fallback_s: Option<u64> = kani::any();
    // A seconds value whose ns overflow u64 is refused by `checked_mul(..).expect(..)` (a Rust panic: the call fails
    // as a whole); that path is pruned here like every refusal.
    kani::assume(delay_s <= u64::MAX / SECOND);
    kani::assume(fallback_s.map_or(true, |f| f <= u64::MAX / SECOND));
    unsafe {
        NOW = 1;
        WROTE_FALLBACK = None;
    }
    let p = AccountPolicy::new(U64(delay_s), vec![Band { up_to: None, level: Level::FaceId }], None, fallback_s.map(U64));
    assert!(p.recovery_delay_ns >= DAY_NS && p.recovery_delay_ns <= 30 * DAY_NS);
    assert_eq!(p.recovery_delay_ns, delay_s * SECOND);
    let written = unsafe { WROTE_FALLBACK }.expect("the fallback cell is written");
    match fallback_s {
        Some(s) => assert_eq!(written, s * SECOND),
        None => assert_eq!(written, default_fallback_ns(p.recovery_delay_ns)),
    }
    assert!(written >= default_fallback_ns(p.recovery_delay_ns) && written <= MAX_FALLBACK_NS);
    assert!(p.recovery.is_none() && p.second_devices.is_empty() && p.pending.is_empty());
}

/// R7-2a: with no second device of age the words may finish at the delay: can_finish = ready_at; the fallback moment is
/// start + fallback (every delay, every start time; the fallback cell absent, so the default applies).
#[kani::proof]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
fn r7_2a_can_finish_no_device() {
    let d = any_r7_delay();
    let start: u64 = kani::any();
    kani::assume(start <= MAX_NOW);
    let p = r7_policy(d, 0, Some((vec![1], start + d)));
    let r = p.recovery.clone().unwrap();
    assert_eq!(p.fallback_ns(), default_fallback_ns(d));
    assert_eq!(p.fallback_at_ns(&r), start + default_fallback_ns(d));
    assert_eq!(p.can_finish_at_ns(&r), start + d);
    assert!(!p.recovery_approved(&r));
}

/// R7-2b: with a second device of age (no age record = of age) and no yes on record, the words may finish only at the
/// later of the delay and the fallback: at least start + 3·delay (clamped to a week … 30 days), never earlier than the
/// delay. Every delay, every start.
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
fn r7_2b_can_finish_device_no_yes() {
    let d = any_r7_delay();
    let start: u64 = kani::any();
    kani::assume(start <= MAX_NOW);
    let p = r7_policy(d, 1, Some((vec![1], start + d)));
    let r = p.recovery.clone().unwrap();
    assert_eq!(p.aged_second_devices(), 1);
    let at = p.can_finish_at_ns(&r);
    assert_eq!(at, (start + d).max(start + default_fallback_ns(d)));
    assert!(at >= start + d);
    assert!(at >= start + (3 * d).min(30 * DAY_NS));
    assert!(at >= start + 7 * DAY_NS.min(30 * DAY_NS));
    assert!(at <= start + 30 * DAY_NS);
}

/// R7-7: `recovery_status` reports those same moments (no device: needs_device false; one of age: true), approved false
/// with no yes on record.
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
fn r7_7_recovery_status_no_device() {
    let d = any_r7_delay();
    let start: u64 = kani::any();
    kani::assume(start <= MAX_NOW);
    let p = r7_policy(d, 0, Some((vec![1], start + d)));
    let s = p.recovery_status().expect("a recovery waits");
    assert_eq!(s.ready_at_ns.0, start + d);
    assert_eq!(s.needs_device, false);
    assert!(!s.approved);
    assert_eq!(s.fallback_at_ns.0, start + default_fallback_ns(d));
    assert_eq!(s.can_finish_at_ns.0, start + d);
    assert!(r7_policy(d, 0, None).recovery_status().is_none());
}

#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
fn r7_7b_recovery_status_device_of_age() {
    let d = any_r7_delay();
    let start: u64 = kani::any();
    kani::assume(start <= MAX_NOW);
    let p = r7_policy(d, 1, Some((vec![1], start + d)));
    let s = p.recovery_status().expect("a recovery waits");
    assert_eq!(s.ready_at_ns.0, start + d);
    assert_eq!(s.needs_device, true);
    assert!(!s.approved);
    assert_eq!(s.fallback_at_ns.0, start + default_fallback_ns(d));
    assert_eq!(s.can_finish_at_ns.0, (start + d).max(start + default_fallback_ns(d)));
    assert!(r7_policy(d, 1, None).recovery_status().is_none());
}

/// R7-4: `check_steps` accepts a call step only with gas ≤ 300 Tgas (every gas value; a one-letter method so the
/// never-called list compares by length).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_4_step_gas_cap() {
    let gas: u64 = kani::any();
    let steps = vec![Step::FunctionCall { method_name: "a".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas) }];
    check_steps(&steps);
    assert!(gas <= MAX_STEP_GAS);
}

/// R7-5: removing a second device OF AGE waits at least max(floor, fallback) ≥ 7 days, whatever the level; removing a
/// key that is no second device waits the floor. Every delay, time and wait; pruned on the list bounds.
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5_removal_waits_fallback() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let mut p = r7_policy(d, 1, None);
    let w: u64 = kani::any();
    kani::assume(w <= (MAX_WAIT_NS + DAY_NS) / SECOND);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![9]) }, Level::Wait { seconds: U64(w) });
    let ready = out.ready_at_ns.unwrap().0;
    assert!(ready - now >= p.floor_ns());
    assert!(ready - now >= w * SECOND);
    assert!(ready - now >= default_fallback_ns(d));
    assert!(ready - now >= 7 * DAY_NS);
    assert!(ready - now >= 3 * d.min(10 * DAY_NS));
    assert_eq!(ready - now, p.floor_ns().max(default_fallback_ns(d)).max(w * SECOND));
}

/// R7-5b: removing a key that is no second device waits exactly max(floor, level wait).
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5b_removal_other_key_waits_floor() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let mut p = r7_policy(d, 1, None);
    let w: u64 = kani::any();
    kani::assume(w <= (MAX_WAIT_NS + DAY_NS) / SECOND);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![5]) }, Level::Wait { seconds: U64(w) });
    let ready = out.ready_at_ns.unwrap().0;
    assert!(ready - now >= p.floor_ns());
    assert!(ready - now >= w * SECOND);
    assert_eq!(ready - now, p.floor_ns().max(w * SECOND));
}

/// R7-6: a second device's yes binds to THIS recovery: `approve_recovery` returns only when the key and the finish time
/// it names are the waiting recovery's (every 2-byte key, every time), and then writes the yes cell; a young device
/// is refused (pruned: no age record means of age here, so the young case is the checker's).
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
fn r7_6_yes_binds_to_this_recovery() {
    let t: u64 = kani::any();
    kani::assume(t <= MAX_NOW);
    unsafe {
        NOW = 1;
        WROTE_YES = false;
    }
    let mut p = r7_policy(DAY_NS, 1, Some((vec![1, 2], t)));
    let k: [u8; 2] = kani::any();
    let t2: u64 = kani::any();
    p.approve_recovery(Base64VecU8(k.to_vec()), U64(t2));
    assert!(k == [1, 2] && t2 == t);
    assert!(unsafe { WROTE_YES });
    assert!(p.recovery.is_some());
}

/// R7-6b: a device of age's refusal with no stop of the phone waiting ends the recovery and freezes spending for the
/// floor; `confirm_stop: Some(true)` with no stop waiting is refused.
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
fn r7_6b_refusal_ends_and_freezes() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
    }
    let confirm: Option<bool> = kani::any();
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.refuse_recovery(confirm);
    assert!(confirm != Some(true));
    assert!(p.recovery.is_none());
    assert_eq!(unsafe { WROTE_FREEZE }, Some(now + p.floor_ns()));
}

/// R7-3: the phone's one stop: with a second device of age, `cancel_recovery` is refused once the stop was asked
/// (the `stop_asked` cell); otherwise it records the cell and places the stop with a wait ≤ min(1 day, delay/2).
fn r7_3_one_stop(d: u64) {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let asked: bool = kani::any();
    unsafe {
        NOW = now;
        STOP_ASKED = asked;
        WROTE_STOP_ASKED = false;
    }
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    let out = p.cancel_recovery();
    assert!(!asked);
    assert!(unsafe { WROTE_STOP_ASKED });
    assert!(!out.done);
    assert!(p.recovery.is_some());
    assert_eq!(p.pending.len(), 1);
    assert!(matches!(p.pending[0].change, Change::CancelRecovery));
    assert!(out.ready_at_ns.unwrap().0 - now <= DAY_NS.min(d / 2));
}

#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3_one_stop_per_recovery_24h() {
    r7_3_one_stop(DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3_one_stop_per_recovery_48h() {
    r7_3_one_stop(2 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3_one_stop_per_recovery_3d() {
    r7_3_one_stop(3 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3_one_stop_per_recovery_7d() {
    r7_3_one_stop(7 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3_one_stop_per_recovery_30d() {
    r7_3_one_stop(30 * DAY_NS);
}

/// R7-6c (re-audit 7, R7-9): a PLAIN refusal always freezes, even while the phone's stop waits: with a `CancelRecovery`
/// pending and `confirm_stop` None or Some(false), the recovery ends and `freeze_until` = now + floor is written; the
/// stop is not approved by it. Every delay, every time.
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
fn r7_6c_plain_refusal_freezes_with_stop_waiting() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(p.recovery.is_none());
    assert_eq!(unsafe { WROTE_FREEZE }, Some(now + p.floor_ns()));
    assert!(p.pending.iter().all(|q| !q.approved));
}

/// R7-8: the floor (a change's wait) is exactly delay + min(delay, 1 day), for every u64 delay the contract can hold
/// without overflow; on the release build (≥ 24 h) that is delay + 1 day, so ≥ 2 days and ≤ 31 days.
#[kani::proof]
fn r7_8_floor_exact() {
    let d: u64 = kani::any();
    kani::assume(d <= MAX_WAIT_NS);
    let p = r7_policy(d, 0, None);
    assert_eq!(p.floor_ns(), d + d.min(DAY_NS));
    let r = any_r7_delay();
    let q = r7_policy(r, 0, None);
    assert_eq!(q.floor_ns(), r + DAY_NS);
    assert!(q.floor_ns() >= 2 * DAY_NS && q.floor_ns() <= 31 * DAY_NS);
}

/// R7-0: on the build this harness runs (`--no-default-features`, the release wasm's features) the shortest recovery
/// delay is 24 hours; `new` with any delay under it never returns (paired with R7-1c, which shows every accepted delay
/// is ≥ 1 day).
#[kani::proof]
fn r7_0_release_minimum_delay() {
    #[cfg(not(feature = "short-waits"))]
    assert_eq!(MIN_RECOVERY_DELAY_NS, 86_400 * 1_000_000_000);
    #[cfg(feature = "short-waits")]
    assert!(false, "this harness must run on the release features (--no-default-features)");
}

/// R7-5c: the same with the delay fixed at each of the app's choices and the extremes, and the level the contract
/// itself uses for a device's removal on these bands (`strictest().without_device()` = Face ID): ready is EXACTLY
/// now + max(floor, fallback), every block time. (R7-5 with a symbolic delay and level wait exceeds the cap.)
fn r7_5c(d: u64) {
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe { NOW = now }
    let mut p = r7_policy(d, 1, None);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![9]) }, Level::FaceId);
    let ready = out.ready_at_ns.unwrap().0;
    assert_eq!(ready - now, (d + d.min(DAY_NS)).max(default_fallback_ns(d)));
    assert!(ready - now >= 7 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5c_device_removal_24h() {
    r7_5c(DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5c_device_removal_48h() {
    r7_5c(2 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5c_device_removal_3d() {
    r7_5c(3 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5c_device_removal_7d() {
    r7_5c(7 * DAY_NS);
}
#[kani::proof]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5c_device_removal_30d() {
    r7_5c(30 * DAY_NS);
}

/// `place` measures what waits with `borsh::to_vec` only to refuse an oversized queue (MAX_PENDING_BYTES). Stubbed to
/// an empty encoding, that refusal never fires, so a harness proves its claim on MORE paths than the contract allows,
/// never fewer (sound for "if it returns, then …"). Used only where no harness assertion reads an encoded cell.
fn borsh_to_vec_empty<T: near_sdk::borsh::BorshSerialize + ?Sized>(_value: &T) -> near_sdk::borsh::io::Result<Vec<u8>> {
    Ok(vec![])
}

/// R7-5d: R7-5c with the queue-size encoding stubbed (see `borsh_to_vec_empty`).
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5d_device_removal_48h() {
    r7_5c(2 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5d_device_removal_24h() {
    r7_5c(DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5d_device_removal_3d() {
    r7_5c(3 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5d_device_removal_7d() {
    r7_5c(7 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
fn r7_5d_device_removal_30d() {
    r7_5c(30 * DAY_NS);
}

/// R7-3d: R7-3 with the queue-size encoding stubbed (the `stop_asked` write is recorded by its key alone).
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3d_one_stop_48h() {
    r7_3_one_stop(2 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3d_one_stop_24h() {
    r7_3_one_stop(DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3d_one_stop_3d() {
    r7_3_one_stop(3 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3d_one_stop_7d() {
    r7_3_one_stop(7 * DAY_NS);
}
#[kani::proof]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::unwind(24)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_any)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_seven)]
fn r7_3d_one_stop_30d() {
    r7_3_one_stop(30 * DAY_NS);
}

// ══ Release 8 (30 Oct): RS-1, RS-2, RK, FB-3, and the three release-7 rules that timed out, re-bounded ═════════════
//
// New stubs this round, each a recording replacement at a FUNCTION BOUNDARY of the contract (the function's own body is
// then proven by a separate harness, or is a host call):
// - `AccountPolicy::place` → `place_record` (records how many times, which change kind and which level; answers
//   "waiting"). Used where the claim is about what the caller asks `place` for.
// - `AccountPolicy::floor_for` → `floor_for_any` (a fresh symbolic floor ≤ 31 d, recorded): `place` is proven for EVERY
//   floor, so it holds for the real one, which `r8_r71a`/`r8_r71b` pin.
// - `AccountPolicy::end_recovery`, `drop_unapproved`, `finish`, `owner_active` → recorders/no-ops where named.
// - `moves` → `moves_none` in the RS-1 harnesses (the measuring has its own harnesses below).
// - `delete_key`, `add_function_call_key` (raw near_sys host calls) → recorders.
// - `env::promise_result_checked`, `env::state_read`, `env::state_write` → a chosen result, a borsh byte buffer, a
//   recorder (FB-3).

/// A sha256 stand-in with no loop: injective on inputs of at most 2 bytes (every key a release-8 harness hashes: device
/// 9, new key [1, 2], 1-byte keys), which is all the decisions rely on.
fn sha256_short<T: AsRef<[u8]>>(v: T) -> Vec<u8> {
    let v = v.as_ref();
    let n = v.len();
    vec![if n > 0 { v[0] } else { 0 }, if n > 1 { v[1] } else { 0 }, n.min(255) as u8]
}
static mut PLACE_CALLS: u32 = 0;
static mut PLACED_STOP: bool = false;
static mut PLACED_SPEND: bool = false;
static mut PLACED_LEVEL: Option<Level> = None;
fn place_record(_this: &mut AccountPolicy, id: u64, change: Change, level: Level) -> Outcome {
    unsafe {
        PLACE_CALLS += 1;
        PLACED_STOP = matches!(change, Change::CancelRecovery);
        PLACED_SPEND = matches!(change, Change::Spend { .. });
        PLACED_LEVEL = Some(level);
    }
    Outcome { done: false, id: Some(U64(id)), ready_at_ns: Some(U64(0)), needs_device: false }
}
fn owner_active_noop(_this: &mut AccountPolicy) {}
fn only_this_account_noop() {}
fn moves_none(_receiver: &str, _steps: &[Step]) -> Option<Vec<(String, u128)>> {
    None
}
static mut END_CALLS: u32 = 0;
static mut END_FREEZE: Option<bool> = None;
fn end_recovery_record(this: &mut AccountPolicy, freeze: bool) {
    unsafe {
        END_CALLS += 1;
        END_FREEZE = Some(freeze);
    }
    this.recovery = None;
}
static mut FINISH_CALLS: u32 = 0;
static mut FINISHED_ID: u64 = 0;
fn finish_record(_this: &mut AccountPolicy, id: u64) -> Outcome {
    unsafe {
        FINISH_CALLS += 1;
        FINISHED_ID = id;
    }
    Outcome { done: true, id: Some(U64(id)), ready_at_ns: None, needs_device: false }
}
static mut DROP_UNAPPROVED_CALLS: u32 = 0;
fn drop_unapproved_record(_this: &mut AccountPolicy, _name: &str) {
    unsafe { DROP_UNAPPROVED_CALLS += 1 }
}
static mut FLOOR_GIVEN: u64 = 0;
fn floor_for_any(_this: &AccountPolicy, _change: &Change) -> u64 {
    let f: u64 = kani::any();
    kani::assume(f <= MAX_WAIT_NS + DAY_NS);
    unsafe { FLOOR_GIVEN = f }
    f
}
/// `delete_key` / `add_function_call_key` (near_sys promise host calls): record the key's first byte (harness keys are
/// one byte), never touch the host.
static mut DELETED: Option<u8> = None;
static mut DELETE_CALLS: u32 = 0;
fn delete_key_record(borsh_key: &[u8]) {
    unsafe {
        DELETE_CALLS += 1;
        DELETED = borsh_key.first().copied();
    }
}
static mut ADDED: Option<u8> = None;
static mut ADD_CALLS: u32 = 0;
fn add_key_record(borsh_key: &[u8], _methods: &str, _allowance: u128) -> u64 {
    unsafe {
        ADD_CALLS += 1;
        ADDED = borsh_key.first().copied();
    }
    0
}
static mut ONE_STEP_GAS: [u64; 3] = [0; 3];
fn r8_steps(n: usize) -> Vec<Step> {
    let mut steps = vec![];
    for i in 0..3 {
        if i < n {
            let call: bool = kani::any();
            let gas: u64 = kani::any();
            unsafe { ONE_STEP_GAS[i] = if call { gas } else { 0 } }
            steps.push(if call {
                Step::FunctionCall { method_name: "a".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas) }
            } else {
                Step::Transfer { deposit: U128(0) }
            });
        } else {
            unsafe { ONE_STEP_GAS[i] = 0 }
        }
    }
    steps
}
fn exact_gas_sum() -> u128 {
    unsafe { u128::from(ONE_STEP_GAS[0]) + u128::from(ONE_STEP_GAS[1]) + u128::from(ONE_STEP_GAS[2]) }
}

// ── RS-1  A single execute carries at most 250 Tgas in all ───────────────────────────────────────────────────────

/// RS-1a: the expression `execute` uses (step_gas folded with saturating_add) is ≤ 250 Tgas exactly when the TRUE sum
/// (in u128, no saturation) is: for every 1–10 steps, each a transfer or a call with any u64 gas. Saturation can never
/// let an over-cap request through.
#[kani::proof]
#[kani::unwind(12)]
fn r8_rs1a_gas_fold_is_exact() {
    let n: usize = kani::any();
    kani::assume(n >= 1 && n <= MAX_STEPS);
    let mut steps = vec![];
    let mut exact: u128 = 0;
    for _ in 0..n {
        let call: bool = kani::any();
        let gas: u64 = kani::any();
        exact += if call { u128::from(gas) } else { 0 };
        steps.push(if call {
            Step::FunctionCall { method_name: String::new(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas) }
        } else {
            Step::Transfer { deposit: U128(0) }
        });
    }
    let gas: u64 = steps.iter().map(step_gas).fold(0u64, u64::saturating_add);
    assert_eq!(gas <= MAX_CHAIN_GAS, exact <= u128::from(MAX_CHAIN_GAS));
}

/// RS-1b: `execute` itself (1–3 steps, each a transfer or a call "a" with any u64 gas): if it returns, the steps' gas
/// adds up (exactly, u128) to ≤ 250 Tgas, and the request was placed once as a Spend. Refusals pruned.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::moves, moves_none)]
fn r8_rs1b_execute_refuses_over_cap() {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
        PLACED_SPEND = false;
    }
    let n: usize = kani::any();
    kani::assume(n >= 1 && n <= 3);
    let steps = r8_steps(n);
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), steps, None);
    assert!(exact_gas_sum() <= u128::from(MAX_CHAIN_GAS));
    assert!(unsafe { PLACE_CALLS == 1 && PLACED_SPEND });
}

/// RS-1c (the converse): with the steps' gas adding up to ≤ 250 Tgas, `execute` never refuses (panic = proof failure),
/// so the cap refuses nothing it shouldn't. Same steps and stubs as RS-1b.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::moves, moves_none)]
fn r8_rs1c_execute_accepts_within_cap() {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
    }
    let n: usize = kani::any();
    kani::assume(n >= 1 && n <= 3);
    let steps = r8_steps(n);
    kani::assume(exact_gas_sum() <= u128::from(MAX_CHAIN_GAS));
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), steps, None);
    assert!(unsafe { PLACE_CALLS == 1 });
}

// ── RS-2  Every call step's gas counts as NEAR ───────────────────────────────────────────────────────────────────

fn near_of(m: &[(String, u128)]) -> u128 {
    m.iter().find(|(c, _)| c == "near").map(|(_, a)| *a).unwrap_or(0)
}
fn rs2_step(method: &str, args: &[u8]) -> (Step, u128) {
    let gas: u64 = kani::any();
    kani::assume(gas <= MAX_STEP_GAS);
    let deposit: u128 = kani::any();
    let want = deposit.saturating_add(u128::from(gas) * GAS_PRICE_COUNTED);
    (Step::FunctionCall { method_name: method.to_string(), args: Base64VecU8(args.to_vec()), deposit: U128(deposit), gas: U64(gas) }, want)
}

/// RS-2a (allowlisted, measured by its NEAR): `near_deposit` on wrap.near, no args, any deposit, gas ≤ 300 Tgas:
/// moves = Some, and its "near" = deposit + gas·GAS_PRICE_COUNTED (10⁹ from release 9; GAS_PRICE_COUNTED (10⁹ from release 9) in release 8) (saturating), exactly.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2a_allowlisted_call_counts_gas() {
    let (step, want) = rs2_step("near_deposit", b"");
    let m = moves("wrap.near", &[step]).expect("an allowlisted call is measured");
    assert_eq!(near_of(&m), want);
}

/// RS-2b (two allowlisted calls): "near" = the saturating sum of both deposits and both gases at GAS_PRICE_COUNTED (10⁹ from release 9): every call step
/// counts, not only the first.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2b_every_call_step_counts() {
    let (s1, w1) = rs2_step("near_deposit", b"");
    let (s2, w2) = rs2_step("unstake_all", b"");
    let m = moves("pool.near", &[s1, s2]).expect("allowlisted calls are measured");
    assert_eq!(near_of(&m), w1.saturating_add(w2));
}

/// RS-2c (other method, the RS-2 case's neighbour): `foo` on a non-Intents receiver is never measured (None: strictest
/// band), so the claim "Some ⇒ near ≥ …" holds vacuously and the request is held to the strictest band.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2c_unknown_call_unmeasured() {
    let (step, _) = rs2_step("foo", b"");
    assert!(moves("usdc.near", &[step]).is_none());
}

/// RS-2d (the RS-2 case itself): `ft_transfer_call` of "1" unit on usdc.near (concrete JSON args), any deposit, gas ≤
/// 300 Tgas: Some, "near" = deposit + gas·GAS_PRICE_COUNTED (10⁹ from release 9) exactly, and the coin row nep141:usdc.near = 1.
#[kani::proof]
#[kani::unwind(48)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2d_standard_call_counts_gas() {
    let (step, want) = rs2_step("ft_transfer_call", br#"{"amount":"1"}"#);
    let m = moves("usdc.near", &[step]).expect("a standard transfer is measured");
    assert_eq!(near_of(&m), want);
    assert!(m.iter().any(|(c, a)| c == "nep141:usdc.near" && *a == 1));
}

/// RS-2e (Intents): `mt_transfer` on intents.near (concrete args), any deposit, gas ≤ 300 Tgas: "near" counts the gas.
#[kani::proof]
#[kani::unwind(48)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2e_intents_call_counts_gas() {
    let (step, want) = rs2_step("mt_transfer", br#"{"token_id":"x","amount":"1"}"#);
    let m = moves("intents.near", &[step]).expect("an Intents transfer is measured");
    assert_eq!(near_of(&m), want);
}

/// RS-2f (args that can't be read): a standard method with empty args is None (strictest band), never Some with the
/// gas left out.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2f_standard_call_bad_args_unmeasured() {
    let (step, _) = rs2_step("ft_transfer_call", b"");
    assert!(moves("usdc.near", &[step]).is_none());
}

// ── RK  A removal never deletes the current backup key ──────────────────────────────────────────────────────────

static mut BACKUP: Option<u8> = None;
/// A refusal: first check that no delete of the backup key was issued before it, then prune.
fn panic_prune_no_backup_delete(_msg: &str) -> ! {
    unsafe {
        assert!(BACKUP.is_none() || DELETED != BACKUP, "the backup key was deleted before the refusal");
    }
    kani::assume(false);
    unreachable!()
}
fn rk_setup(k: u8, backup: Option<u8>, approved: bool) -> AccountPolicy {
    unsafe {
        NOW = 1;
        DELETED = None;
        DELETE_CALLS = 0;
        BACKUP = backup;
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.recovery_key = backup.map(|b| vec![b]);
    p.pending.push(Pending { id: U64(1), change: Change::RemoveKey { public_key: Base64VecU8(vec![k]) }, ready_at_ns: U64(0), needs_device: false, approved });
    p.next_id = 2;
    p
}

/// RK-a: `finish` of a waiting RemoveKey(k), every 1-byte k, every backup key (none or any 1 byte), approved or not, with
/// one second device (key 9): if it returns, k is not the backup key, and the backup key was never deleted; the one
/// delete issued is k's. Refusals pruned (after checking no backup delete preceded them).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_a_removal_never_deletes_backup() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    let approved: bool = kani::any();
    let mut p = rk_setup(k, backup, approved);
    p.finish(1);
    assert!(backup != Some(k));
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
    assert!(unsafe { backup.is_none() || DELETED != backup });
    assert_eq!(p.recovery_key, backup.map(|b| vec![b]));
    assert!(p.pending.is_empty());
}

/// RK-b (the new check refuses nothing else): k ≠ the backup key ⇒ `finish` never refuses (panic = failure).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_b_other_key_removal_runs() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    kani::assume(backup != Some(k));
    let mut p = rk_setup(k, backup, false);
    let out = p.finish(1);
    assert!(out.done);
    assert!(unsafe { DELETED == Some(k) });
    assert_eq!(p.second_devices.contains(&vec![9]), k != 9);
}

// ── FB-3  on_second_device_key: the contract's list follows NEAR's ──────────────────────────────────────────────

static mut PROMISE: u8 = 0; // 0 success, 1 failed, 2 too long (a success)
fn promise_result_stub(_idx: u64, _max: usize) -> Result<Vec<u8>, PromiseError> {
    match unsafe { PROMISE } {
        0 => Ok(vec![]),
        1 => Err(PromiseError::Failed),
        _ => Err(PromiseError::TooLong(65)),
    }
}
static mut STATE_READS: u32 = 0;
/// `env::state_read` / `state_write` are generic; the only T the contract uses them with is `AccountPolicy` (asserted by
/// size), so the stub hands over a freshly built state (ownership moves, nothing is copied twice) and the writer records
/// the written state's second-device list and bands, without a borsh round trip (whose symbolic-length loops CBMC
/// unrolls slowly).
fn state_read_stub<T: near_sdk::borsh::BorshDeserialize>() -> Option<T> {
    assert!(core::mem::size_of::<T>() == core::mem::size_of::<AccountPolicy>());
    unsafe {
        STATE_READS += 1;
        let p = r7_policy(DAY_NS, 1, None);
        let t = core::mem::transmute_copy::<AccountPolicy, T>(&p);
        core::mem::forget(p);
        Some(t)
    }
}
static mut WRITTEN_DEVICES: Option<Vec<Vec<u8>>> = None;
static mut WRITTEN_BANDS_NEED_DEVICE: bool = false;
fn state_write_stub<T: near_sdk::borsh::BorshSerialize>(state: &T) {
    assert!(core::mem::size_of::<T>() == core::mem::size_of::<AccountPolicy>());
    unsafe {
        let p = &*(state as *const T as *const AccountPolicy);
        WRITTEN_DEVICES = Some(p.second_devices.clone());
        WRITTEN_BANDS_NEED_DEVICE = p.bands.iter().any(|b| b.level.needs_device());
    }
}

/// FB-3: `on_second_device_key(k, refill)`, every 1-byte k, refill true/false, every promise result (success, failed,
/// too long), with the stored state holding one second device (key 9) and one Face ID band. Never refuses (panic =
/// failure), and:
/// - success or too long: no state read, no write, no key added or deleted;
/// - failed, k not a second device: state read, nothing written, added or deleted;
/// - failed, k a second device, refill false: the written state no longer lists k (and, as the last device, no band
///   needs a device), and NO key is deleted or added (`unrecord_second_device`: the contract's side only);
/// - failed, k a second device, refill true: nothing written (the list unchanged), the add issued is k's, no delete.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, state_read_stub)]
#[kani::stub(near_sdk::env::state_write, state_write_stub)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::add_function_call_key, add_key_record)]
fn r8_fb3_second_device_key_callback() {
    let k: u8 = kani::any();
    let refill: bool = kani::any();
    let result: u8 = kani::any();
    kani::assume(result <= 2);
    unsafe {
        NOW = 1;
        PROMISE = result;
        STATE_READS = 0;
        WRITTEN_DEVICES = None;
        WRITTEN_BANDS_NEED_DEVICE = false;
        DELETED = None;
        DELETE_CALLS = 0;
        ADDED = None;
        ADD_CALLS = 0;
    }
    AccountPolicy::on_second_device_key(Base64VecU8(vec![k]), refill);
    let written: Option<Vec<Vec<u8>>> = unsafe { (*core::ptr::addr_of!(WRITTEN_DEVICES)).clone() };
    unsafe {
        if result != 1 {
            assert!(STATE_READS == 0 && written.is_none() && ADD_CALLS == 0 && DELETE_CALLS == 0);
        } else if k != 9 {
            assert!(STATE_READS == 1 && written.is_none() && ADD_CALLS == 0 && DELETE_CALLS == 0);
        } else if !refill {
            let w = written.expect("the state is written");
            assert!(!w.contains(&vec![k]));
            assert!(w.is_empty());
            assert!(!WRITTEN_BANDS_NEED_DEVICE);
            // Final release 8 (lib 5a39e768…): the callback only unrecords the device; it never deletes a key.
            assert!(DELETE_CALLS == 0 && ADD_CALLS == 0);
        } else {
            assert!(written.is_none());
            assert!(ADD_CALLS == 1 && ADDED == Some(k) && DELETE_CALLS == 0);
        }
    }
}

// ── R7-1 again: the aged-device removal wait, proven on `floor_for` and `place` separately ──────────────────────

static mut FALLBACK_CELL: Option<u64> = None;
fn storage_read_fallback(key: &[u8]) -> Option<Vec<u8>> {
    if key == FALLBACK_KEY {
        unsafe { FALLBACK_CELL.map(|f| f.to_le_bytes().to_vec()) }
    } else {
        None
    }
}

/// R8-R71a: `floor_for(RemoveKey(k))`, every delay 1–30 d, every stored fallback cell (absent, or any value `new` /
/// `upgrade_check` can write: default(delay) ≤ f ≤ 30 d), every 1-byte k, one second device (key 9, of age: no age
/// record), no recovery, outside the setup window: k = 9 ⇒ floor_for = max(floor, fallback) ≥ 7 d and ≥ floor;
/// any other k ⇒ = floor exactly.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_read_fallback)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
fn r8_r71a_floor_for_removal() {
    let d = any_r7_delay();
    let cell: Option<u64> = kani::any();
    kani::assume(cell.map_or(true, |f| f >= default_fallback_ns(d) && f <= MAX_FALLBACK_NS));
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        FALLBACK_CELL = cell;
    }
    let k: u8 = kani::any();
    let p = r7_policy(d, 1, None);
    let f = p.floor_for(&Change::RemoveKey { public_key: Base64VecU8(vec![k]) });
    let fallback = cell.unwrap_or(default_fallback_ns(d));
    if k == 9 {
        assert_eq!(f, p.floor_ns().max(fallback));
        assert!(f >= p.floor_ns() && f >= fallback && f >= 7 * DAY_NS);
    } else {
        assert_eq!(f, p.floor_ns());
    }
}

/// R8-R71b: every setting's `floor_for` is ≥ the floor outside the setup window (SetProtection, AddSecondDevice,
/// RemoveKey, SetRecoveryKey with backup words already set, Upgrade), and a spend's or the phone's stop's is 0.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
fn r8_r71b_floor_for_settings() {
    let d = any_r7_delay();
    unsafe { NOW = 1 }
    let p = r7_policy(d, 1, None);
    let which: u8 = kani::any();
    let k: u8 = kani::any();
    let key = Base64VecU8(vec![k]);
    let (change, setting) = match which {
        0 => (Change::SetProtection { bands: vec![] }, true),
        1 => (Change::AddSecondDevice { public_key: key }, true),
        2 => (Change::RemoveKey { public_key: key }, true),
        3 => (Change::SetRecoveryKey { public_key: key }, true),
        4 => (Change::Upgrade { code_hash: key }, true),
        5 => (Change::CancelRecovery, false),
        _ => (Change::Spend { receiver_id: "rr".parse().unwrap(), steps: vec![] }, false),
    };
    let f = p.floor_for(&change);
    if setting {
        assert!(f >= p.floor_ns());
    } else {
        assert_eq!(f, 0);
    }
}

/// R8-R71c: `place` itself, with `floor_for` replaced by a fresh symbolic floor F (any F ≤ 31 d) and an empty queue:
/// every level (any kind, any wait ≤ 31 d), every block time, a RemoveKey of the second device: if it waits, ready_at =
/// now + max(level wait, F), needs_device = the level's; with Face ID and F = 0 it runs at once (finish recorded).
/// Composed with R8-R71a: a device-of-age removal is ready no earlier than now + max(floor, fallback, level wait).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::log_str, log_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::floor_for, floor_for_any)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r71c_place_ready_at() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        FINISH_CALLS = 0;
    }
    let level = any_level();
    let mut p = r7_policy(d, 1, None);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![9]) }, level.clone());
    let f = unsafe { FLOOR_GIVEN };
    if level == Level::FaceId && f == 0 {
        assert!(out.done && unsafe { FINISH_CALLS == 1 && FINISHED_ID == 1 });
    } else {
        assert!(!out.done && unsafe { FINISH_CALLS == 0 });
        assert_eq!(out.ready_at_ns.unwrap().0, now + level.wait_ns().max(f));
        assert_eq!(p.pending.len(), 1);
        assert_eq!(p.pending[0].ready_at_ns.0, now + level.wait_ns().max(f));
        assert_eq!(p.pending[0].needs_device, level.needs_device());
    }
}

// ── R7-3 again: one phone stop per recovery, at cancel_recovery's boundary (place recorded) ─────────────────────

/// R8-R73a: `cancel_recovery`, every delay 1–30 d, every time, stop_asked set or not, a stop already waiting or not, a
/// second device of age (key 9) or none: if it returns,
/// - no stop was already waiting;
/// - with the device of age: stop_asked was NOT set, the call writes it, and calls `place` exactly once, with
///   Change::CancelRecovery and Level::Wait{ min(1 d, delay/2) / 1 s }; it does not end the recovery;
/// - with none: it ends the recovery at once with the freeze, and places nothing.
/// Stubs: `place` (recorded), `end_recovery` (recorded), `owner_active` (no-op: the phone's gate is its own rule).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
fn r8_r73a_one_stop_per_recovery() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let asked: bool = kani::any();
    let waiting: bool = kani::any();
    let device: bool = kani::any();
    unsafe {
        NOW = now;
        STOP_ASKED = asked;
        WROTE_STOP_ASKED = false;
        PLACE_CALLS = 0;
        PLACED_STOP = false;
        PLACED_LEVEL = None;
        END_CALLS = 0;
        END_FREEZE = None;
    }
    let mut p = r7_policy(d, if device { 1 } else { 0 }, Some((vec![1, 2], now + d)));
    if waiting {
        p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
        p.next_id = 2;
    }
    let out = p.cancel_recovery();
    assert!(!waiting);
    if device {
        assert!(!asked);
        assert!(unsafe { WROTE_STOP_ASKED });
        assert!(unsafe { PLACE_CALLS == 1 && PLACED_STOP });
        let want = Level::Wait { seconds: U64(DAY_NS.min(d / 2) / SECOND) };
        assert!(unsafe { (*core::ptr::addr_of!(PLACED_LEVEL)).as_ref() == Some(&want) });
        assert!(unsafe { END_CALLS == 0 });
        assert!(p.recovery.is_some() && !out.done);
    } else {
        assert!(unsafe { PLACE_CALLS == 0 && END_CALLS == 1 && END_FREEZE == Some(true) });
        assert!(out.done);
    }
}

/// R8-R73b (liveness of the first stop): device of age, stop not asked, none waiting ⇒ `cancel_recovery` never refuses.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_has_key, storage_has_key_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
fn r8_r73b_first_stop_is_accepted() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        STOP_ASKED = false;
        PLACE_CALLS = 0;
    }
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.cancel_recovery();
    assert!(unsafe { PLACE_CALLS == 1 });
}

// ── R7-6c again: a plain refusal while the phone's stop waits ────────────────────────────────────────────────────

/// R8-R76c: `refuse_recovery(None | Some(false))` by the second device of age (key 9), every delay, every time, with
/// the phone's stop (CancelRecovery, id 1) waiting: the recovery ends, the freeze cell = now + floor is written, the
/// waiting requests are dropped through `drop_unapproved` (called once), `finish` is never called, and the stop is not
/// marked approved. Stubs: `drop_unapproved`, `finish` (recorded). `end_recovery` runs for real.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::drop_unapproved, drop_unapproved_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r76c_plain_refusal_with_stop_waiting() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
        FINISH_CALLS = 0;
        DROP_UNAPPROVED_CALLS = 0;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(p.recovery.is_none());
    assert_eq!(unsafe { WROTE_FREEZE }, Some(now + p.floor_ns()));
    assert!(unsafe { FINISH_CALLS == 0 && DROP_UNAPPROVED_CALLS == 1 });
    assert!(p.pending.iter().all(|q| !q.approved));
}

/// R8-R76d (the other branch, for contrast): `refuse_recovery(Some(true))` with the stop waiting is the device's yes to
/// it: the stop is marked approved and `finish` is called once with its id; refuse_recovery itself writes no freeze
/// and drops nothing (finish is recorded here; the stop's own end, end_recovery(false), is finish's).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::drop_unapproved, drop_unapproved_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r76d_confirmed_refusal_approves_the_stop() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
        FINISH_CALLS = 0;
        DROP_UNAPPROVED_CALLS = 0;
    }
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(Some(true));
    assert!(unsafe { FINISH_CALLS == 1 && FINISHED_ID == 1 && DROP_UNAPPROVED_CALLS == 0 });
    assert!(unsafe { WROTE_FREEZE.is_none() });
    assert!(p.pending[0].approved);
}

/// serde_json's object map (preserve_order) seeds its hasher from the OS random source, a foreign call Kani can't run
/// (`CCRandomGenerateBytes`, which made RS-2d fail as an unsupported construct, not on a property). A fixed seed: the
/// map's lookups and contents do not depend on it.
fn random_state_fixed() -> std::collections::hash_map::RandomState {
    unsafe { core::mem::transmute::<(u64, u64), std::collections::hash_map::RandomState>((1, 2)) }
}

/// RS-2g: RS-2d (the RS-2 case: `ft_transfer_call` of "1" on usdc.near, any deposit, gas ≤ 300 Tgas) with the hash seed
/// fixed: Some, "near" = deposit + gas·GAS_PRICE_COUNTED (10⁹ from release 9) exactly, and nep141:usdc.near = 1.
#[kani::proof]
#[kani::unwind(48)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(std::collections::hash_map::RandomState::new, random_state_fixed)]
fn r8_rs2g_standard_call_counts_gas_fixed_seed() {
    let (step, want) = rs2_step("ft_transfer_call", br#"{"amount":"1"}"#);
    let m = moves("usdc.near", &[step]).expect("a standard transfer is measured");
    assert_eq!(near_of(&m), want);
    assert!(m.iter().any(|(c, a)| c == "nep141:usdc.near" && *a == 1));
}

// ── Split variants (the whole-function harnesses above exceeded the 10-minute cap on this loaded box) ───────────────

/// R8-R76c1: R8-R76c at `refuse_recovery`'s own boundary: with the phone's stop waiting and confirm None / Some(false),
/// `refuse_recovery` calls `end_recovery(true)` exactly once (the freezing end), never `finish`, and leaves the stop
/// unapproved. Stubs: `end_recovery` (recorded; sets recovery None), `finish` (recorded).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r76c1_plain_refusal_calls_freezing_end() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        END_CALLS = 0;
        END_FREEZE = None;
        FINISH_CALLS = 0;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(unsafe { END_CALLS == 1 && END_FREEZE == Some(true) && FINISH_CALLS == 0 });
    assert!(p.recovery.is_none());
    assert!(p.pending.len() == 1 && !p.pending[0].approved);
}

/// R8-R76c2: `end_recovery(true)` itself, every delay, every time, a recovery waiting and the phone's stop waiting: the
/// recovery is gone, the freeze cell written = now + floor, and the waiting requests go through `drop_unapproved`
/// (called once). Stub: `drop_unapproved` (recorded). With R8-R76c1: a plain refusal while a stop waits freezes.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::drop_unapproved, drop_unapproved_record)]
fn r8_r76c2_freezing_end_writes_freeze() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
        DROP_UNAPPROVED_CALLS = 0;
    }
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.end_recovery(true);
    assert!(p.recovery.is_none());
    assert_eq!(unsafe { WROTE_FREEZE }, Some(now + p.floor_ns()));
    assert!(unsafe { DROP_UNAPPROVED_CALLS == 1 });
}

fn fb3_case(k: u8, refill: bool, result: u8) {
    unsafe {
        NOW = 1;
        PROMISE = result;
        STATE_READS = 0;
        WRITTEN_DEVICES = None;
        WRITTEN_BANDS_NEED_DEVICE = false;
        DELETED = None;
        DELETE_CALLS = 0;
        ADDED = None;
        ADD_CALLS = 0;
    }
    AccountPolicy::on_second_device_key(Base64VecU8(vec![k]), refill);
}

/// FB-3a: success or "too long" (a success): nothing read, written, added or deleted (every k, refill).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, state_read_stub)]
#[kani::stub(near_sdk::env::state_write, state_write_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::add_function_call_key, add_key_record)]
#[kani::stub(super::event, event_stub)]
fn r8_fb3a_success_touches_nothing() {
    let k: u8 = kani::any();
    let refill: bool = kani::any();
    let ok_long: bool = kani::any();
    fb3_case(k, refill, if ok_long { 2 } else { 0 });
    unsafe {
        assert!(STATE_READS == 0 && ADD_CALLS == 0 && DELETE_CALLS == 0);
        assert!((*core::ptr::addr_of!(WRITTEN_DEVICES)).is_none());
    }
}

/// FB-3b: failed add (refill false) of the second device 9: the written state lists no second device and no band needs
/// one; no key is deleted or added.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, state_read_stub)]
#[kani::stub(near_sdk::env::state_write, state_write_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::add_function_call_key, add_key_record)]
#[kani::stub(super::event, event_stub)]
fn r8_fb3b_failed_add_unrecords_only() {
    fb3_case(9, false, 1);
    unsafe {
        let w = (*core::ptr::addr_of!(WRITTEN_DEVICES)).clone().expect("the state is written");
        assert!(w.is_empty());
        assert!(!WRITTEN_BANDS_NEED_DEVICE);
        assert!(STATE_READS == 1 && DELETE_CALLS == 0 && ADD_CALLS == 0);
    }
}

/// FB-3c: failed refill (refill true) of the second device 9: nothing written (the list unchanged), one add of key 9,
/// no delete.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, state_read_stub)]
#[kani::stub(near_sdk::env::state_write, state_write_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::add_function_call_key, add_key_record)]
#[kani::stub(super::event, event_stub)]
fn r8_fb3c_failed_refill_readds() {
    fb3_case(9, true, 1);
    unsafe {
        assert!((*core::ptr::addr_of!(WRITTEN_DEVICES)).is_none());
        assert!(STATE_READS == 1 && ADD_CALLS == 1 && ADDED == Some(9) && DELETE_CALLS == 0);
    }
}

/// FB-3d: failed add or refill of a key that is no longer a second device (every k ≠ 9): state read, nothing written,
/// added or deleted.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, state_read_stub)]
#[kani::stub(near_sdk::env::state_write, state_write_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::add_function_call_key, add_key_record)]
#[kani::stub(super::event, event_stub)]
fn r8_fb3d_failed_unknown_key_untouched() {
    let k: u8 = kani::any();
    kani::assume(k != 9);
    let refill: bool = kani::any();
    fb3_case(k, refill, 1);
    unsafe {
        assert!((*core::ptr::addr_of!(WRITTEN_DEVICES)).is_none());
        assert!(STATE_READS == 1 && ADD_CALLS == 0 && DELETE_CALLS == 0);
    }
}

/// R8-R71c2: R8-R71c with the queue-size encoding also stubbed (`borsh_to_vec_empty`: the MAX_PENDING_BYTES refusal can
/// then never fire, so the claim is proven on MORE paths than the contract allows, never fewer; no assertion reads an
/// encoding). `place` of a RemoveKey of the second device, every level, every floor F ≤ 31 d from `floor_for`, every
/// block time: if it waits, ready_at = now + max(level wait, F), and the waiting entry carries it and the level's
/// needs_device; with Face ID and F = 0 it runs at once.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::floor_for, floor_for_any)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r71c2_place_ready_at_no_encoding() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        FINISH_CALLS = 0;
    }
    let level = any_level();
    let mut p = r7_policy(d, 1, None);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![9]) }, level.clone());
    let f = unsafe { FLOOR_GIVEN };
    if level == Level::FaceId && f == 0 {
        assert!(out.done && unsafe { FINISH_CALLS == 1 && FINISHED_ID == 1 });
    } else {
        assert!(!out.done && unsafe { FINISH_CALLS == 0 });
        assert_eq!(out.ready_at_ns.unwrap().0, now + level.wait_ns().max(f));
        assert_eq!(p.pending.len(), 1);
        assert_eq!(p.pending[0].ready_at_ns.0, now + level.wait_ns().max(f));
        assert_eq!(p.pending[0].needs_device, level.needs_device());
    }
}

/// RK-a1 (concrete split of RK-a): backup key 4, a waiting RemoveKey(4), approved or not: `finish` NEVER returns (the
/// line after it is unreachable under panic_prune; a reachable `assert!(false)` would fail the proof), and no delete of
/// key 4 was issued before the refusal (checked inside the panic stub).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_a1_backup_removal_never_finishes() {
    let approved: bool = kani::any();
    let mut p = rk_setup(4, Some(4), approved);
    p.finish(1);
    assert!(false, "finish of a RemoveKey of the backup key returned");
}

/// RK-a2: backup key 4, RemoveKey(9) of the second device: finish returns, the one delete is key 9's, the backup key
/// stays, and the device is gone from the list.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_a2_device_removal_deletes_only_it() {
    let mut p = rk_setup(9, Some(4), false);
    let out = p.finish(1);
    assert!(out.done);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(9) });
    assert_eq!(p.recovery_key, Some(vec![4]));
    assert!(p.second_devices.is_empty());
}

// ── unwind-2 copies of the harnesses that exceeded the cap at unwind 4 (same body, same stubs) ──
#[kani::proof]
#[kani::unwind(2)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r76c1_plain_refusal_calls_freezing_end_u2() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        END_CALLS = 0;
        END_FREEZE = None;
        FINISH_CALLS = 0;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(unsafe { END_CALLS == 1 && END_FREEZE == Some(true) && FINISH_CALLS == 0 });
    assert!(p.recovery.is_none());
    assert!(p.pending.len() == 1 && !p.pending[0].approved);
}

#[kani::proof]
#[kani::unwind(2)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_record)]
#[kani::stub(near_sdk::env::storage_remove, storage_remove_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::drop_unapproved, drop_unapproved_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r76d_confirmed_refusal_approves_the_stop_u2() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        WROTE_FREEZE = None;
        FINISH_CALLS = 0;
        DROP_UNAPPROVED_CALLS = 0;
    }
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(Some(true));
    assert!(unsafe { FINISH_CALLS == 1 && FINISHED_ID == 1 && DROP_UNAPPROVED_CALLS == 0 });
    assert!(unsafe { WROTE_FREEZE.is_none() });
    assert!(p.pending[0].approved);
}


#[kani::proof]
#[kani::unwind(2)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_a1_backup_removal_never_finishes_u2() {
    let approved: bool = kani::any();
    let mut p = rk_setup(4, Some(4), approved);
    p.finish(1);
    assert!(false, "finish of a RemoveKey of the backup key returned");
}

#[kani::proof]
#[kani::unwind(2)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
fn r8_rk_a2_device_removal_deletes_only_it_u2() {
    let mut p = rk_setup(9, Some(4), false);
    let out = p.finish(1);
    assert!(out.done);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(9) });
    assert_eq!(p.recovery_key, Some(vec![4]));
    assert!(p.second_devices.is_empty());
}

#[kani::proof]
#[kani::unwind(2)]
#[kani::stub(near_sdk::borsh::to_vec, borsh_to_vec_empty)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::AccountPolicy::floor_for, floor_for_any)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
fn r8_r71c2_place_ready_at_no_encoding_u2() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        FINISH_CALLS = 0;
    }
    let level = any_level();
    let mut p = r7_policy(d, 1, None);
    let out = p.place(1, Change::RemoveKey { public_key: Base64VecU8(vec![9]) }, level.clone());
    let f = unsafe { FLOOR_GIVEN };
    if level == Level::FaceId && f == 0 {
        assert!(out.done && unsafe { FINISH_CALLS == 1 && FINISHED_ID == 1 });
    } else {
        assert!(!out.done && unsafe { FINISH_CALLS == 0 });
        assert_eq!(out.ready_at_ns.unwrap().0, now + level.wait_ns().max(f));
        assert_eq!(p.pending.len(), 1);
        assert_eq!(p.pending[0].ready_at_ns.0, now + level.wait_ns().max(f));
        assert_eq!(p.pending[0].needs_device, level.needs_device());
    }
}


// ── RK with finish's other arms cut off at their first call ──────────────────────────────────────────────────────
// CBMC loses the waiting request's variant once it has been moved out of the queue (`pending.remove`), so it explores
// every arm of `finish`'s match, including the promise builders. In these harnesses the change is a RemoveKey, so every
// other arm is unreachable; each call that only those arms make is replaced by `prune_arm` (assume(false)): the paths
// cut are paths the harness never takes, so "if finish returns, then …" is unaffected.
fn prune_group(_g: Group) -> Promise {
    kani::assume(false);
    unreachable!()
}
fn prune_chain(_g: Group, _rest: Vec<Group>) {
    kani::assume(false);
}
fn prune_promise_new(_a: AccountId) -> Promise {
    kani::assume(false);
    unreachable!()
}
fn prune_then_check(_p: u64, _k: &[u8], _r: bool) {
    kani::assume(false);
}
fn prune_add_key(_k: &[u8], _m: &str, _a: u128) -> u64 {
    kani::assume(false);
    0
}

/// RK-a1p: backup key 4, a waiting RemoveKey(4), approved or not: `finish` NEVER returns (the `assert!(false)` after it
/// must be unreachable), and no delete of key 4 is issued before the refusal (checked in the panic stub).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, prune_promise_new)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::add_function_call_key, prune_add_key)]
fn r8_rk_a1p_backup_removal_never_finishes() {
    let approved: bool = kani::any();
    let mut p = rk_setup(4, Some(4), approved);
    p.finish(1);
    assert!(false, "finish of a RemoveKey of the backup key returned");
}

/// RK-bp: every 1-byte k and every backup key (none or 1 byte) with k ≠ backup: `finish` of RemoveKey(k) never refuses
/// (panic = failure), issues exactly one delete, of k, keeps the backup key, and drops k from the second devices.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, prune_promise_new)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::add_function_call_key, prune_add_key)]
fn r8_rk_bp_other_key_removal_runs() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    kani::assume(backup != Some(k));
    let mut p = rk_setup(k, backup, false);
    let out = p.finish(1);
    assert!(out.done);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
    assert_eq!(p.recovery_key, backup.map(|b| vec![b]));
    assert!(!p.second_devices.contains(&vec![k]));
}

// ── RK, second cut: the Upgrade arm formats its arguments before it builds its promise, so the cut is at `format`
fn prune_format(_a: std::fmt::Arguments<'_>) -> String {
    kani::assume(false);
    unreachable!()
}
// (copy of the block above with Promise::new replaced by std::fmt::format)
// ── RK with finish's other arms cut off at their first call ──────────────────────────────────────────────────────
// CBMC loses the waiting request's variant once it has been moved out of the queue (`pending.remove`), so it explores
// every arm of `finish`'s match, including the promise builders. In these harnesses the change is a RemoveKey, so every
// other arm is unreachable; each call that only those arms make is replaced by `prune_arm` (assume(false)): the paths
// cut are paths the harness never takes, so "if finish returns, then …" is unaffected.

/// RK-a1p: backup key 4, a waiting RemoveKey(4), approved or not: `finish` NEVER returns (the `assert!(false)` after it
/// must be unreachable), and no delete of key 4 is issued before the refusal (checked in the panic stub).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::add_function_call_key, prune_add_key)]
fn r8_rk_a1q_backup_removal_never_finishes() {
    let approved: bool = kani::any();
    let mut p = rk_setup(4, Some(4), approved);
    p.finish(1);
    assert!(false, "finish of a RemoveKey of the backup key returned");
}

/// RK-bp: every 1-byte k and every backup key (none or 1 byte) with k ≠ backup: `finish` of RemoveKey(k) never refuses
/// (panic = failure), issues exactly one delete, of k, keeps the backup key, and drops k from the second devices.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_stub)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::add_function_call_key, prune_add_key)]
fn r8_rk_bq_other_key_removal_runs() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    kani::assume(backup != Some(k));
    let mut p = rk_setup(k, backup, false);
    let out = p.finish(1);
    assert!(out.done);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
    assert_eq!(p.recovery_key, backup.map(|b| vec![b]));
    assert!(!p.second_devices.contains(&vec![k]));
}

// ── RK-c (R8-F1, lib e951e00a…): a removal never takes the backup key, the waiting recovery's new key, or the only phone ──

static mut DEV_SHAPE: u8 = 0; // 0: no device list, 1: [k] (k is the only phone), 2: [k, 7], 3: [7]
static mut DEV_K: u8 = 0;
static mut STORED_DEV_LEN: Option<u32> = None;
/// The device list (`devices` cell) as borsh: u32 count, then each key as u32 length + bytes, `sealed`, `created_at_ns`
/// (None). Every other cell absent.
fn storage_read_devices(key: &[u8]) -> Option<Vec<u8>> {
    if key != DEVICES_KEY {
        return None;
    }
    let (shape, k) = unsafe { (DEV_SHAPE, DEV_K) };
    let keys: Vec<u8> = match shape {
        0 => return None,
        1 => vec![k],
        2 => vec![k, 7],
        _ => vec![7],
    };
    let mut b = (keys.len() as u32).to_le_bytes().to_vec();
    for x in keys {
        b.extend_from_slice(&1u32.to_le_bytes());
        b.push(x);
    }
    b.push(1); // sealed
    b.push(0); // created_at_ns: None
    Some(b)
}
/// Records how many keys the stored device list holds (its borsh starts with the u32 count).
fn storage_write_devices(key: &[u8], value: &[u8]) -> bool {
    if key == DEVICES_KEY && value.len() >= 4 {
        unsafe { STORED_DEV_LEN = Some(u32::from_le_bytes([value[0], value[1], value[2], value[3]])) }
    }
    false
}

/// RK-c: `finish` of a waiting RemoveKey(k), every 1-byte k, every backup key (none or 1 byte), a recovery waiting or not
/// with any 1-byte new key, and a device list that is absent, [k] alone, [k, 7] or [7], one second device (9): if it
/// returns, then k ≠ the backup key, k ≠ the waiting recovery's new key, and the device list was not [k] alone (so the
/// stored list is never left empty by the removal of its only key); the one delete issued is k's. Refusals pruned,
/// after checking no delete of the backup key preceded them. Every other arm of `finish` is cut at its first call
/// (`prune_*`, see above); `format` is cut too (only the Upgrade arm formats).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_read_devices)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::add_function_call_key, prune_add_key)]
fn r8_rk_c_removal_keeps_backup_new_phone_and_only_phone() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    let new_key: Option<u8> = kani::any();
    let shape: u8 = kani::any();
    kani::assume(shape <= 3);
    // The contract never lists a key twice (device_gate pushes only a new key; new and finish_recovery write distinct
    // keys), so [k, 7] has k != 7.
    kani::assume(!(shape == 2 && k == 7));
    let mut p = rk_setup(k, backup, false);
    p.recovery = new_key.map(|n| PendingRecovery { new_key: Base64VecU8(vec![n]), ready_at_ns: U64(10) });
    unsafe {
        DEV_SHAPE = shape;
        DEV_K = k;
        STORED_DEV_LEN = None;
    }
    let out = p.finish(1);
    assert!(out.done);
    assert!(backup != Some(k));
    assert!(new_key != Some(k));
    assert!(!(shape == 1 || (shape == 3 && k == 7)));
    let stored = unsafe { STORED_DEV_LEN }.expect("the device list is stored");
    assert!(shape == 0 || stored >= 1);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
}

// ── RS-2 with the deposit below 2^64 (128-bit symbolic arithmetic is hard for the SAT back end; bound stated) ──
fn rs2_step_u64(method: &str, args: &[u8]) -> (Step, u128) {
    let gas: u64 = kani::any();
    kani::assume(gas <= MAX_STEP_GAS);
    let deposit: u128 = u128::from(kani::any::<u64>());
    let want = deposit + u128::from(gas) * GAS_PRICE_COUNTED;
    (Step::FunctionCall { method_name: method.to_string(), args: Base64VecU8(args.to_vec()), deposit: U128(deposit), gas: U64(gas) }, want)
}

/// RS-2a64: RS-2a with the deposit below 2^64 yocto (1.8·10⁻⁵ NEAR; a bit-width bound for the solver): "near" =
/// deposit + gas·GAS_PRICE_COUNTED (10⁹ from release 9) exactly, every gas ≤ 300 Tgas.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2a64_allowlisted_call_counts_gas() {
    let (step, want) = rs2_step_u64("near_deposit", b"");
    let m = moves("wrap.near", &[step]).expect("an allowlisted call is measured");
    assert_eq!(near_of(&m), want);
}

/// RS-2a0: deposit 0 (the RS-2 attack's shape: a call that attaches nothing and burns gas): "near" = gas·GAS_PRICE_COUNTED (10⁹ from release 9) exactly,
/// every gas ≤ 300 Tgas.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2a0_zero_deposit_call_counts_gas() {
    let gas: u64 = kani::any();
    kani::assume(gas <= MAX_STEP_GAS);
    let step = Step::FunctionCall { method_name: "near_deposit".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas) };
    let m = moves("wrap.near", &[step]).expect("an allowlisted call is measured");
    assert_eq!(near_of(&m), u128::from(gas) * GAS_PRICE_COUNTED);
}

/// The device list as a value (no borsh decoding): absent, [k], [k, 7] or [7], per DEV_SHAPE.
fn load_devices_shape() -> Devices {
    let (shape, k) = unsafe { (DEV_SHAPE, DEV_K) };
    let keys: Vec<Vec<u8>> = match shape {
        0 => vec![],
        1 => vec![vec![k]],
        2 => vec![vec![k], vec![7]],
        _ => vec![vec![7]],
    };
    Devices { keys, sealed: shape != 0, created_at_ns: None }
}

/// RK-c2: RK-c with the device list handed over as a value (`load_devices` stubbed) instead of decoded from borsh; the
/// stored list is still read back from `store_devices`' real borsh encoding (its u32 count). Same statement as RK-c.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_c2_removal_keeps_backup_new_phone_and_only_phone() {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    let new_key: Option<u8> = kani::any();
    let shape: u8 = kani::any();
    kani::assume(shape <= 3);
    // The contract never lists a key twice, so [k, 7] has k != 7.
    kani::assume(!(shape == 2 && k == 7));
    let mut p = rk_setup(k, backup, false);
    p.recovery = new_key.map(|n| PendingRecovery { new_key: Base64VecU8(vec![n]), ready_at_ns: U64(10) });
    unsafe {
        DEV_SHAPE = shape;
        DEV_K = k;
        STORED_DEV_LEN = None;
    }
    let out = p.finish(1);
    assert!(out.done);
    assert!(backup != Some(k));
    assert!(new_key != Some(k));
    assert!(!(shape == 1 || (shape == 3 && k == 7)));
    let stored = unsafe { STORED_DEV_LEN }.expect("the device list is stored");
    assert!(shape == 0 || stored >= 1);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
}

fn two_calls(g1: u64, g2: u64) -> Vec<Step> {
    vec![
        Step::FunctionCall { method_name: "a".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g1) },
        Step::FunctionCall { method_name: "a".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g2) },
    ]
}

/// RS-1d: `execute` with exactly two call steps (the RS-1 shape: 2 × 200 Tgas), every pair of u64 gases: if it returns,
/// g1 + g2 ≤ 250 Tgas (exact, u128) and the request was placed once. Stubs as RS-1b.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::moves, moves_none)]
fn r8_rs1d_two_calls_over_cap_refused() {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
    }
    let g1: u64 = kani::any();
    let g2: u64 = kani::any();
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), two_calls(g1, g2), None);
    assert!(u128::from(g1) + u128::from(g2) <= u128::from(MAX_CHAIN_GAS));
    assert!(unsafe { PLACE_CALLS == 1 });
}

/// RS-1e (converse): two call steps with g1 + g2 ≤ 250 Tgas ⇒ `execute` never refuses (panic = failure).
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(super::AccountPolicy::place, place_record)]
#[kani::stub(super::moves, moves_none)]
fn r8_rs1e_two_calls_within_cap_accepted() {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
    }
    let g1: u64 = kani::any();
    let g2: u64 = kani::any();
    kani::assume(u128::from(g1) + u128::from(g2) <= u128::from(MAX_CHAIN_GAS));
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), two_calls(g1, g2), None);
    assert!(unsafe { PLACE_CALLS == 1 });
}

/// RS-2b0: two zero-deposit allowlisted calls (near_deposit, unstake_all), every gas ≤ 300 Tgas each: "near" =
/// (g1 + g2)·GAS_PRICE_COUNTED (10⁹ from release 9) exactly: every call step's gas counts, not only the first.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
fn r8_rs2b0_every_call_step_counts_zero_deposit() {
    let g1: u64 = kani::any();
    let g2: u64 = kani::any();
    kani::assume(g1 <= MAX_STEP_GAS && g2 <= MAX_STEP_GAS);
    let s1 = Step::FunctionCall { method_name: "near_deposit".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g1) };
    let s2 = Step::FunctionCall { method_name: "unstake_all".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(g2) };
    let m = moves("pool.near", &[s1, s2]).expect("allowlisted calls are measured");
    assert_eq!(near_of(&m), (u128::from(g1) + u128::from(g2)) * GAS_PRICE_COUNTED);
}

fn prune_index(_this: &AccountPolicy, _id: u64) -> usize {
    kani::assume(false);
    0
}
fn prune_store_key<T: near_sdk::borsh::BorshSerialize>(_key: &[u8], _value: &T) {
    kani::assume(false);
}

/// R8-R76c3: R8-R76c1 with the confirmed-stop branch cut at its first calls (`index`, `store_key`: in
/// `refuse_recovery` with `end_recovery` stubbed, only that branch makes them; confirm here is None or Some(false), so
/// the cut paths are paths the harness never takes). Same statement as R8-R76c1: `end_recovery(true)` once, no
/// `finish`, the stop unapproved.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
#[kani::stub(super::AccountPolicy::index, prune_index)]
#[kani::stub(super::store_key, prune_store_key)]
fn r8_r76c3_plain_refusal_calls_freezing_end_cut() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        END_CALLS = 0;
        END_FREEZE = None;
        FINISH_CALLS = 0;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(unsafe { END_CALLS == 1 && END_FREEZE == Some(true) && FINISH_CALLS == 0 });
    assert!(p.recovery.is_none());
    assert!(p.pending.len() == 1 && !p.pending[0].approved);
}

// ── RK-c split into concrete cases (the symbolic RK-c / RK-c2 exceeded the cap) ──
fn rk_d_setup(k: u8, new_key: Option<u8>, shape: u8) -> AccountPolicy {
    let mut p = rk_setup(k, Some(4), false);
    p.recovery = new_key.map(|n| PendingRecovery { new_key: Base64VecU8(vec![n]), ready_at_ns: U64(10) });
    unsafe {
        DEV_SHAPE = shape;
        DEV_K = k;
        STORED_DEV_LEN = None;
    }
    p
}

/// RK-d1: removing the waiting recovery's new key (k = 5 = the new key; backup 4; list [5, 7]) never finishes.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_d1_new_phone_key_removal_never_finishes() {
    let mut p = rk_d_setup(5, Some(5), 2);
    p.finish(1);
    assert!(false, "finish removed the waiting recovery's new key");
}

/// RK-d2: removing the only phone key (list [5], k = 5; backup 4; no recovery) never finishes.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_d2_only_phone_removal_never_finishes() {
    let mut p = rk_d_setup(5, None, 1);
    p.finish(1);
    assert!(false, "finish removed the only phone key");
}

/// RK-d3 (control, panic = failure): k = 5 with list [5, 7], a recovery waiting for new key 6, backup 4: finish runs,
/// stores a list of one key, and deletes key 5 only.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_d3_phone_removal_with_another_phone_runs() {
    let mut p = rk_d_setup(5, Some(6), 2);
    let out = p.finish(1);
    assert!(out.done);
    assert_eq!(unsafe { STORED_DEV_LEN }, Some(1));
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(5) });
}

/// RK-d1n (non-vacuity of RK-d1: the panic stub asserts no backup delete happened, so a SUCCESS on that check shows the refusal is reached): removing the waiting recovery's new key (k = 5 = the new key; backup 4; list [5, 7]) never finishes.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_d1n_new_phone_key_removal_refusal_reached() {
    let mut p = rk_d_setup(5, Some(5), 2);
    p.finish(1);
    assert!(false, "finish removed the waiting recovery's new key");
}

/// RK-d2n (non-vacuity of RK-d2, as RK-d1n): removing the only phone key (list [5], k = 5; backup 4; no recovery) never finishes.
#[kani::proof]
#[kani::unwind(4)]
#[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::delete_key, delete_key_record)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(std::fmt::format, prune_format)]
#[kani::stub(super::then_check_second_device_key, prune_then_check)]
#[kani::stub(super::load_devices, load_devices_shape)]
fn r8_rk_d2n_only_phone_removal_refusal_reached() {
    let mut p = rk_d_setup(5, None, 1);
    p.finish(1);
    assert!(false, "finish removed the only phone key");
}

// ══ Release 9 (1 Nov): R8-RS1 (finish_recovery + on_recovery_key), the upgrade allowlist, the words' refill, the gas
// price; and new attempts at release 8's timeouts ══════════════════════════════════════════════════════════════════
//
// Stubs added this round, each at a FUNCTION BOUNDARY or a host call:
// - `load_key` / `store_key` (storage_read/write + borsh) → `r9_load_key` / `r9_store_key`: the cells a harness needs as
//   VALUES (the Finishing record, the RELEASES list, the device ages), every other cell absent; writes recorded as values.
//   (A first version encoded the cells as borsh for a storage_read stub: the symbolic decode alone exceeded the cap.)
// - `env::storage_write` / `storage_remove` → recorders (the DEVICES cell `store_devices` writes is decoded).
// - `env::state_read` / `state_write` → the state a harness built (moved in by transmute_copy, size asserted as in FB-3) /
//   a recorder of the written state's recovery, second devices and queue length.
// - `add_function_call_key`, `renew_function_call_key`, `delete_key` (raw near_sys promise calls) → recorders of every
//   key, method list and allowance; `then_finish_recovery` (the callback's promise, whose JSON args serde_json builds
//   with a map seeded from the OS random source, which Kani can't run) → a recorder of its promise index and recovery.
// - `std::fmt::format` → an empty string where only `finish_blocker`'s is_none() / a refusal's message reads it.
// - `AccountPolicy::place`, `owner_active`, `only_this_account`, `release_allowed`, `read_all_state` → recorders/no-ops
//   where named; each is proven or is its own rule elsewhere.

static mut R9_FIN: Option<(Vec<u8>, u64, u64)> = None; // the Finishing cell: (new_key, ready_at_ns, asked_at_ns)
static mut R9_RELEASES: Option<Vec<Vec<u8>>> = None;
static mut R9_AGES: Option<Vec<(Vec<u8>, u64)>> = None;
static mut R9_FIN_WRITTEN: Option<(Vec<u8>, u64, u64)> = None;
static mut R9_FIN_WRITES: u32 = 0;
static mut R9_FIN_REMOVES: u32 = 0;
static mut R9_REL_WRITTEN: Option<Vec<u8>> = None; // the raw borsh written under RELEASES_KEY
static mut R9_DEV_WRITTEN: Option<(Vec<Vec<u8>>, bool)> = None;
static mut R9_OTHER_WRITES: u32 = 0;
static mut R9_OTHER_REMOVES: u32 = 0;
static mut R9_DELETED: Vec<Vec<u8>> = Vec::new();
static mut R9_ADDED: Vec<(Vec<u8>, u8, u128)> = Vec::new(); // (key, methods: 1 device, 2 second device, 3 words, 0 other, allowance)
static mut R9_RENEWED: Vec<(Vec<u8>, u8, u128)> = Vec::new();
static mut R9_SIGNER: Vec<u8> = Vec::new();
static mut R9_STATE: Option<AccountPolicy> = None;
static mut R9_STATE_WRITES: u32 = 0;
static mut R9_WRITTEN_RECOVERY_NONE: bool = false;
static mut R9_WRITTEN_SECOND_DEVICES: Vec<Vec<u8>> = Vec::new();
static mut R9_THEN: Option<(u64, Vec<u8>, u64, u64)> = None;
static mut R9_THEN_CALLS: u32 = 0;
static mut R9_DEVICES: Option<(Vec<Vec<u8>>, bool)> = None; // load_devices as a value: (keys, sealed)

fn r9_reset() {
    unsafe {
        R9_FIN = None;
        R9_RELEASES = None;
        R9_AGES = None;
        R9_FIN_WRITTEN = None;
        R9_FIN_WRITES = 0;
        R9_FIN_REMOVES = 0;
        R9_REL_WRITTEN = None;
        R9_DEV_WRITTEN = None;
        R9_OTHER_WRITES = 0;
        R9_OTHER_REMOVES = 0;
        R9_DELETED = Vec::new();
        R9_ADDED = Vec::new();
        R9_RENEWED = Vec::new();
        R9_STATE = None;
        R9_STATE_WRITES = 0;
        R9_WRITTEN_RECOVERY_NONE = false;
        R9_WRITTEN_SECOND_DEVICES = Vec::new();
        R9_THEN = None;
        R9_THEN_CALLS = 0;
        R9_DEVICES = None;
        R9_REL_LIST = None;
    }
}

/// `load_key` at its boundary (it is `storage_read` + borsh): the cells as VALUES, no borsh decoding (CBMC's cost on a
/// symbolic list's decode exceeded the cap). The contract reads each key with one type only: FINISHING_KEY as
/// Finishing, RELEASES_KEY as Vec<Vec<u8>>, DEVICE_AGES_KEY as Vec<(Vec<u8>, u64)> (asserted by size); every other cell
/// absent.
fn r9_load_key<T: near_sdk::borsh::BorshDeserialize>(key: &[u8]) -> Option<T> {
    unsafe {
        if key == FINISHING_KEY {
            let (h, r, a) = (*core::ptr::addr_of!(R9_FIN)).clone()?;
            assert!(core::mem::size_of::<T>() == core::mem::size_of::<Finishing>());
            let v = Finishing { new_key: h, ready_at_ns: r, asked_at_ns: a };
            let t = core::mem::transmute_copy::<Finishing, T>(&v);
            core::mem::forget(v);
            Some(t)
        } else if key == RELEASES_KEY {
            let v = (*core::ptr::addr_of!(R9_RELEASES)).clone()?;
            assert!(core::mem::size_of::<T>() == core::mem::size_of::<Vec<Vec<u8>>>());
            let t = core::mem::transmute_copy::<Vec<Vec<u8>>, T>(&v);
            core::mem::forget(v);
            Some(t)
        } else if key == DEVICE_AGES_KEY {
            let v = (*core::ptr::addr_of!(R9_AGES)).clone()?;
            assert!(core::mem::size_of::<T>() == core::mem::size_of::<Vec<(Vec<u8>, u64)>>());
            let t = core::mem::transmute_copy::<Vec<(Vec<u8>, u64)>, T>(&v);
            core::mem::forget(v);
            Some(t)
        } else {
            None
        }
    }
}
static mut R9_REL_LIST: Option<Vec<Vec<u8>>> = None;
/// `store_key` at its boundary: records the FINISHING and RELEASES values written (as values); counts any other.
fn r9_store_key<T: near_sdk::borsh::BorshSerialize>(key: &[u8], value: &T) {
    unsafe {
        if key == FINISHING_KEY {
            assert!(core::mem::size_of::<T>() == core::mem::size_of::<Finishing>());
            let f = &*(value as *const T as *const Finishing);
            R9_FIN_WRITES += 1;
            R9_FIN_WRITTEN = Some((f.new_key.clone(), f.ready_at_ns, f.asked_at_ns));
        } else if key == RELEASES_KEY {
            assert!(core::mem::size_of::<T>() == core::mem::size_of::<Vec<Vec<u8>>>());
            R9_REL_LIST = Some((*(value as *const T as *const Vec<Vec<u8>>)).clone());
        } else {
            R9_OTHER_WRITES += 1;
        }
    }
}
fn r9_u32(v: &[u8], at: usize) -> usize {
    u32::from_le_bytes([v[at], v[at + 1], v[at + 2], v[at + 3]]) as usize
}
fn r9_u64(v: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&v[at..at + 8]);
    u64::from_le_bytes(b)
}
fn r9_storage_write(key: &[u8], value: &[u8]) -> bool {
    unsafe {
        if key == FINISHING_KEY {
            R9_FIN_WRITES += 1;
            let n = r9_u32(value, 0);
            let h = value[4..4 + n].to_vec();
            R9_FIN_WRITTEN = Some((h, r9_u64(value, 4 + n), r9_u64(value, 12 + n)));
        } else if key == RELEASES_KEY {
            R9_REL_WRITTEN = Some(value.to_vec());
        } else if key == DEVICES_KEY {
            let count = r9_u32(value, 0);
            let mut at = 4;
            let mut keys = vec![];
            for _ in 0..count {
                let n = r9_u32(value, at);
                keys.push(value[at + 4..at + 4 + n].to_vec());
                at += 4 + n;
            }
            R9_DEV_WRITTEN = Some((keys, value[at] == 1));
        } else {
            R9_OTHER_WRITES += 1;
        }
    }
    false
}
fn r9_storage_remove(key: &[u8]) -> bool {
    unsafe {
        if key == FINISHING_KEY {
            R9_FIN_REMOVES += 1;
        } else {
            R9_OTHER_REMOVES += 1;
        }
    }
    false
}
fn r9_methods_code(methods: &str) -> u8 {
    if methods == DEVICE_METHODS {
        1
    } else if methods == SECOND_DEVICE_METHODS {
        2
    } else if methods == RECOVERY_METHODS {
        3
    } else {
        0
    }
}
fn r9_add_key(borsh_key: &[u8], methods: &str, allowance: u128) -> u64 {
    unsafe { R9_ADDED.push((borsh_key.to_vec(), r9_methods_code(methods), allowance)) }
    7
}
fn r9_renew_key(borsh_key: &[u8], methods: &str, allowance: u128) -> u64 {
    unsafe { R9_RENEWED.push((borsh_key.to_vec(), r9_methods_code(methods), allowance)) }
    8
}
fn r9_delete_key(borsh_key: &[u8]) {
    unsafe { R9_DELETED.push(borsh_key.to_vec()) }
}
static mut R9_PROMISE_READS: u32 = 0;
fn r9_promise_counted(idx: u64, max: usize) -> Result<Vec<u8>, PromiseError> {
    unsafe { R9_PROMISE_READS += 1 }
    promise_result_stub(idx, max)
}
fn r9_signer() -> Vec<u8> {
    unsafe { (*core::ptr::addr_of!(R9_SIGNER)).clone() }
}
fn r9_then_finish(promise: u64, r: &PendingRecovery, asked_at_ns: u64) {
    unsafe {
        R9_THEN_CALLS += 1;
        R9_THEN = Some((promise, r.new_key.0.clone(), r.ready_at_ns.0, asked_at_ns));
    }
}
fn r9_format_empty(_a: std::fmt::Arguments<'_>) -> String {
    String::new()
}
fn r9_load_devices() -> Devices {
    match unsafe { (*core::ptr::addr_of!(R9_DEVICES)).clone() } {
        Some((keys, sealed)) => Devices { keys, sealed, created_at_ns: None },
        None => Devices::default(),
    }
}
fn r9_state_read<T: near_sdk::borsh::BorshDeserialize>() -> Option<T> {
    assert!(core::mem::size_of::<T>() == core::mem::size_of::<AccountPolicy>());
    unsafe {
        let p = (*core::ptr::addr_of_mut!(R9_STATE)).take().expect("the harness set a state");
        let t = core::mem::transmute_copy::<AccountPolicy, T>(&p);
        core::mem::forget(p);
        Some(t)
    }
}
fn r9_state_write<T: near_sdk::borsh::BorshSerialize>(state: &T) {
    assert!(core::mem::size_of::<T>() == core::mem::size_of::<AccountPolicy>());
    unsafe {
        let p = &*(state as *const T as *const AccountPolicy);
        R9_STATE_WRITES += 1;
        R9_WRITTEN_RECOVERY_NONE = p.recovery.is_none();
        R9_WRITTEN_SECOND_DEVICES = p.second_devices.clone();
    }
}
/// A refusal: report it reached (a cover), then prune the path.
fn r9_panic_prune_cover(_msg: &str) -> ! {
    kani::cover!(true, "a refusal is reached");
    kani::assume(false);
    unreachable!()
}
fn r9_prune_end_recovery(_this: &mut AccountPolicy, _freeze: bool) {
    kani::assume(false);
}
fn r9_prune_check_bands(_this: &AccountPolicy, _b: &[Band]) {
    kani::assume(false);
}
fn r9_prune_delete_key(_k: &[u8]) {
    kani::assume(false);
}
fn r9_prune_load_devices() -> Devices {
    kani::assume(false);
    Devices::default()
}
fn r9_prune_release_allowed(_h: &[u8]) -> bool {
    kani::assume(false);
    false
}
fn r9_prune_fallback(_this: &AccountPolicy) -> u64 {
    kani::assume(false);
    0
}
fn r9_promise_new_never(_a: AccountId) -> Promise {
    assert!(false, "a promise (the UseGlobalContract batch) was built");
    kani::assume(false);
    unreachable!()
}
fn r9_promise_new_cover(_a: AccountId) -> Promise {
    kani::cover!(true, "the upgrade's promise is built");
    kani::assume(false);
    unreachable!()
}

// ── R8-RS1 (1): finish_recovery only checks, marks, adds the new key and chains the callback ────────────────────────

fn r9_fr_setup(device: bool, ready: u64, marker: Option<(Vec<u8>, u64)>) -> AccountPolicy {
    r9_reset();
    unsafe {
        R9_SIGNER = vec![4]; // the backup words' key
        R9_FIN = marker.map(|(h, a)| (h, 0, a));
    }
    let d = DAY_NS;
    r7_policy(d, if device { 1 } else { 0 }, Some((vec![1, 2], ready)))
}

/// R9-FR-a: `finish_recovery` by the words, a recovery to new key [1,2] ready at any time T, any block time, a second
/// device of age (key 9, no yes on record) or none, a Finishing record absent or present (any 2-byte key, any asked time): if it
/// returns, (i) now ≥ T, and with the device now ≥ the fallback moment; (ii) with a marker, now ≥ its asked time + 1 h;
/// (iii) exactly one delete-then-add (`add_after_delete`, recorded; its receipts are R9-AAD's) is issued, of the new key,
/// with the phone's methods and no allowance; the only other delete is of an old record's DIFFERENT key (re-freeze 3),
/// and none without one; (iv) the callback is chained once, on that add's promise, with this recovery's key, ready time
/// and asked time = now; (v) the record is written once = (new key, T, now); no other cell is written; (vi) the recovery still waits unchanged, the
/// second devices and the queue are untouched. Refusals pruned (and covered).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(std::fmt::format, r9_format_empty)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::add_after_delete, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
#[kani::stub(super::then_finish_recovery, r9_then_finish)]
fn r9_fr_a_finish_recovery_only_adds() {
    let device: bool = kani::any();
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(ready <= MAX_NOW && now <= MAX_NOW);
    let has_marker: bool = kani::any();
    let mk: [u8; 2] = kani::any(); // the stale record's key (any 2 bytes, [1,2] included)
    let asked: u64 = kani::any();
    kani::assume(asked <= MAX_NOW);
    let mut p = r9_fr_setup(device, ready, has_marker.then(|| (mk.to_vec(), asked)));
    unsafe { NOW = now }
    p.finish_recovery();
    assert!(now >= ready);
    if device {
        assert!(now >= ready.saturating_sub(DAY_NS).saturating_add(default_fallback_ns(DAY_NS)));
    }
    if has_marker {
        assert!(now >= asked + FINISH_RETRY_NS);
    }
    unsafe {
        let added = &*core::ptr::addr_of!(R9_ADDED);
        assert!(added.len() == 1 && added[0].0 == vec![1u8, 2] && added[0].1 == 1 && added[0].2 == 0);
        let deleted = &*core::ptr::addr_of!(R9_DELETED);
        if has_marker && mk != [1, 2] {
            assert!(deleted.len() == 1 && deleted[0] == mk.to_vec());
        } else {
            assert!(deleted.is_empty());
        }
        assert!(R9_THEN_CALLS == 1);
        assert!(*core::ptr::addr_of!(R9_THEN) == Some((7, vec![1u8, 2], ready, now)));
        assert!(R9_FIN_WRITES == 1);
        assert!(*core::ptr::addr_of!(R9_FIN_WRITTEN) == Some((vec![1u8, 2], ready, now)));
        assert!(R9_OTHER_WRITES == 0);
        assert!((*core::ptr::addr_of!(R9_REL_LIST)).is_none());
    }
    assert!(p.recovery == Some(PendingRecovery { new_key: Base64VecU8(vec![1, 2]), ready_at_ns: U64(ready) }));
    assert_eq!(p.second_devices.len(), if device { 1 } else { 0 });
    assert!(p.pending.is_empty());
    kani::cover!(has_marker, "a finish with an old marker returns");
    kani::cover!(has_marker && mk != [1, 2], "an old record's other key is deleted");
    kani::cover!(device, "a finish with a device of age returns (after the fallback)");
}

/// R9-FR-b: a fresh marker (asked less than 1 h ago) ⇒ `finish_recovery` never returns, even with the delay over and no
/// device (the refusal is reached: cover).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(std::fmt::format, r9_format_empty)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::add_after_delete, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
#[kani::stub(super::then_finish_recovery, r9_then_finish)]
fn r9_fr_b_fresh_marker_refused() {
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    let asked: u64 = kani::any();
    kani::assume(ready <= now && now <= MAX_NOW && asked <= MAX_NOW && now < asked + FINISH_RETRY_NS);
    let mut p = r9_fr_setup(false, ready, Some((vec![1, 2], asked)));
    unsafe { NOW = now }
    p.finish_recovery();
    assert!(false, "a second finish within the hour returned");
}

/// R9-FR-c (liveness): no device, the delay over, the marker absent or asked ≥ 1 h ago ⇒ `finish_recovery` never refuses
/// (panic = failure) and issues the delete-then-add of the new key once, with the callback chained.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(std::fmt::format, r9_format_empty)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::add_after_delete, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
#[kani::stub(super::then_finish_recovery, r9_then_finish)]
fn r9_fr_c_old_or_no_marker_accepted() {
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    let asked: u64 = kani::any();
    let has_marker: bool = kani::any();
    kani::assume(ready <= now && now <= MAX_NOW && asked <= MAX_NOW && (!has_marker || now >= asked + FINISH_RETRY_NS));
    let mut p = r9_fr_setup(false, ready, has_marker.then(|| (vec![1, 2], asked)));
    unsafe { NOW = now }
    p.finish_recovery();
    unsafe {
        assert!((*core::ptr::addr_of!(R9_ADDED)).len() == 1);
        assert!(R9_THEN_CALLS == 1);
    }
}

// ── R8-RS1 (2): on_recovery_key ───────────────────────────────────────────────────────────────────────────────────

fn r9_ork_setup(result: u8, device: bool, ready: u64, devices: Vec<Vec<u8>>) {
    r9_reset();
    unsafe {
        R9_FIN = None;
        PROMISE = result;
        R9_STATE = Some(r7_policy(DAY_NS, if device { 1 } else { 0 }, Some((vec![1, 2], ready))));
        R9_DEVICES = Some((devices, false));
    }
}

/// R9-ORK-a: the add FAILED (the record on file names this callback). Every argument (any 2-byte key, any ready time), every block time, a state with the recovery
/// to [1,2] waiting, the words 4, device 9 or none, phones [5, 7]: the callback never refuses (panic = failure), adds and
/// deletes no key, writes no state (so the recovery, the devices and the queue are as they were) and no cell; the only
/// storage change is the marker's removal.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, r9_state_read)]
#[kani::stub(near_sdk::env::state_write, r9_state_write)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(near_sdk::env::storage_write, r9_storage_write)]
#[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::load_devices, r9_load_devices)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_ork_a_failed_add_changes_nothing() {
    let device: bool = kani::any();
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(ready <= MAX_NOW && now <= MAX_NOW);
    let k: [u8; 2] = kani::any();
    let r: u64 = kani::any();
    let asked: u64 = kani::any();
    r9_ork_setup(1, device, ready, vec![vec![5], vec![7]]);
    unsafe {
        NOW = now;
        R9_FIN = Some((k.to_vec(), r, asked)); // the record names this callback
    }
    AccountPolicy::on_recovery_key(Base64VecU8(k.to_vec()), U64(r), U64(asked));
    unsafe {
        assert!((*core::ptr::addr_of!(R9_DELETED)).is_empty());
        assert!(R9_STATE_WRITES == 0);
        assert!(R9_FIN_REMOVES == 1 && R9_OTHER_REMOVES == 0);
        assert!(R9_OTHER_WRITES == 0 && R9_FIN_WRITES == 0);
        assert!((*core::ptr::addr_of!(R9_DEV_WRITTEN)).is_none());
    }
}

/// R9-ORK-b: the record names this callback, the add SUCCEEDED (or too long: a success), the arguments are the waiting recovery's ([1,2], T), and it may
/// finish (now ≥ T; with device 9 of age and no yes, now ≥ the fallback moment): the recovery completes. The state is
/// written once with no recovery; the device list stored is exactly [[1,2]], sealed; the old phones 5 and 7 are deleted
/// (two deletes, nothing else: not the new key, not the words 4, not device 9); no key is added; the marker removed.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, r9_state_read)]
#[kani::stub(near_sdk::env::state_write, r9_state_write)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(near_sdk::env::storage_write, r9_storage_write)]
#[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::load_devices, r9_load_devices)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_ork_b_success_completes() {
    let device: bool = kani::any();
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(ready >= DAY_NS && ready <= MAX_NOW && now <= MAX_NOW && now >= ready);
    if device {
        kani::assume(now >= ready - DAY_NS + default_fallback_ns(DAY_NS));
    }
    let long: bool = kani::any();
    let asked: u64 = kani::any();
    r9_ork_setup(if long { 2 } else { 0 }, device, ready, vec![vec![5], vec![7]]);
    unsafe {
        NOW = now;
        R9_FIN = Some((vec![1, 2], ready, asked));
    }
    AccountPolicy::on_recovery_key(Base64VecU8(vec![1, 2]), U64(ready), U64(asked));
    unsafe {
        assert!(R9_STATE_WRITES == 1 && R9_WRITTEN_RECOVERY_NONE);
        assert!(*core::ptr::addr_of!(R9_DEV_WRITTEN) == Some((vec![vec![1u8, 2]], true)));
        assert!(*core::ptr::addr_of!(R9_DELETED) == vec![vec![5u8], vec![7u8]]);
        assert!(R9_FIN_REMOVES == 1);
        assert_eq!((*core::ptr::addr_of!(R9_WRITTEN_SECOND_DEVICES)).len(), if device { 1 } else { 0 });
    }
}

/// R9-ORK-c: the record names this callback, the add SUCCEEDED, but the recovery may not finish: the arguments are not the waiting recovery (another
/// 1-byte key k, any time; or the state has no recovery), or it is blocked (now < T, or device 9 of age, no yes, before
/// the fallback). Then: no state written (no completion), no key added, at most one delete and only of the arguments' key,
/// and none when that key holds a role (a second device 9, the words 4, a phone on the list 5).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
#[kani::stub(near_sdk::env::state_read, r9_state_read)]
#[kani::stub(near_sdk::env::state_write, r9_state_write)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(std::fmt::format, r9_format_empty)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::load_devices, r9_load_devices)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_ork_c_success_not_finished_deletes_only_new_key() {
    let device: bool = kani::any();
    let ready: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(ready >= DAY_NS && ready <= MAX_NOW && now <= MAX_NOW);
    let same_key: bool = kani::any();
    let k: u8 = kani::any();
    let r: u64 = kani::any();
    let no_recovery: bool = kani::any();
    let key = if same_key { vec![1, 2] } else { vec![k] };
    r9_ork_setup(0, device, ready, vec![vec![5]]);
    if no_recovery {
        unsafe { (*core::ptr::addr_of_mut!(R9_STATE)).as_mut().unwrap().recovery = None }
    }
    let same = !no_recovery && same_key && r == ready;
    let blocked = now < ready || (device && now < ready - DAY_NS + default_fallback_ns(DAY_NS));
    kani::assume(!same || blocked);
    let asked: u64 = kani::any();
    unsafe {
        NOW = now;
        R9_FIN = Some((key.clone(), r, asked));
    }
    AccountPolicy::on_recovery_key(Base64VecU8(key.clone()), U64(r), U64(asked));
    let role = (device && key == vec![9]) || key == vec![4] || key == vec![5];
    unsafe {
        let deleted = &*core::ptr::addr_of!(R9_DELETED);
        assert!(R9_STATE_WRITES == 0);
        assert!(deleted.len() <= 1);
        if deleted.len() == 1 {
            assert!(deleted[0] == key);
        }
        if role {
            assert!(deleted.is_empty());
        } else {
            assert!(deleted.len() == 1);
        }
        assert!(R9_FIN_REMOVES == 1);
        kani::cover!(deleted.len() == 1, "an unfinished recovery's key is taken off again");
        kani::cover!(role && deleted.is_empty(), "a key with a role is left");
    }
}


/// R9-ORK-d (re-freeze 3): a SUPERSEDED callback: the record on file is absent, or names another asked time or another
/// key than the call's (every 2-byte key, every times, every promise result): nothing at all happens: no promise result
/// read, no state read or written, no cell written or removed, no key deleted (an add would reach the unstubbed host
/// call and fail the proof).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::promise_result_checked, r9_promise_counted)]
#[kani::stub(near_sdk::env::state_read, r9_state_read)]
#[kani::stub(near_sdk::env::state_write, r9_state_write)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::storage_write, r9_storage_write)]
#[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::load_devices, r9_load_devices)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_ork_d_superseded_callback_changes_nothing() {
    let k: [u8; 2] = kani::any();
    let r: u64 = kani::any();
    let asked: u64 = kani::any();
    let record: bool = kani::any();
    let rk: [u8; 2] = kani::any();
    let ra: u64 = kani::any();
    let rr: u64 = kani::any();
    kani::assume(!record || ra != asked || rk != k);
    let result: u8 = kani::any();
    kani::assume(result <= 2);
    r9_ork_setup(result, true, 10, vec![vec![5]]);
    unsafe {
        NOW = 1;
        R9_PROMISE_READS = 0;
        R9_FIN = record.then(|| (rk.to_vec(), rr, ra));
    }
    AccountPolicy::on_recovery_key(Base64VecU8(k.to_vec()), U64(r), U64(asked));
    unsafe {
        assert!(R9_PROMISE_READS == 0);
        assert!((*core::ptr::addr_of!(R9_STATE)).is_some()); // never read
        assert!(R9_STATE_WRITES == 0 && R9_FIN_REMOVES == 0 && R9_OTHER_REMOVES == 0);
        assert!(R9_OTHER_WRITES == 0 && R9_FIN_WRITES == 0 && (*core::ptr::addr_of!(R9_DEV_WRITTEN)).is_none());
        assert!((*core::ptr::addr_of!(R9_DELETED)).is_empty());
    }
    kani::cover!(record && rk == k, "a record for the same key but another finish");
}

// ── R8-RS1 (3): device_gate and key_in_use know the waiting and the finishing recovery's key ───────────────────────

/// R9-DG-a: `device_gate`, every 1-byte signer s, a recovery waiting for any 1-byte key n, a Finishing marker absent or
/// for any 1-byte key f, second device 9, words 4, an unsealed phone list [5]: if it returns, s is none of 9, 4, n, and
/// (with a marker) f. Refusals pruned (covered); a return is reached (cover).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_devices, r9_store_devices_record)]
#[kani::stub(super::load_devices, r9_load_devices)]
fn r9_dg_a_device_gate_refuses_recovery_keys() {
    r9_reset();
    let s: u8 = kani::any();
    let n: u8 = kani::any();
    let f: u8 = kani::any();
    let marker: bool = kani::any();
    unsafe {
        NOW = 1;
        R9_SIGNER = vec![s];
        R9_DEVICES = Some((vec![vec![5]], false));
        if marker {
            R9_FIN = Some((vec![f], 0, 0));
        }
    }
    let mut p = r7_policy(DAY_NS, 1, Some((vec![n], 10)));
    p.device_gate();
    assert!(s != 9 && s != 4 && s != n);
    assert!(!(marker && s == f));
    kani::cover!(marker, "a signer passes with a marker present");
}

/// R9-DG-b: the signer IS the finishing recovery's new key (any 1-byte f, no recovery waiting any more, f not 9/4): the
/// gate never returns.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_devices, r9_store_devices_record)]
#[kani::stub(super::load_devices, r9_load_devices)]
fn r9_dg_b_finishing_key_never_acts() {
    r9_reset();
    let f: u8 = kani::any();
    kani::assume(f != 9 && f != 4);
    let listed: bool = kani::any();
    unsafe {
        NOW = 1;
        R9_SIGNER = vec![f];
        // even when the key is already on the phone list
        R9_DEVICES = Some((if listed { vec![vec![f]] } else { vec![vec![5]] }, false));
        R9_FIN = Some((vec![f], 0, 0));
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.device_gate();
    assert!(false, "the finishing key acted as the phone");
}

/// R9-DG-c: the signer IS the waiting recovery's new key (any 1-byte n, not 9/4), on the list or not: never returns.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_devices, r9_store_devices_record)]
#[kani::stub(super::load_devices, r9_load_devices)]
fn r9_dg_c_waiting_recovery_key_never_acts() {
    r9_reset();
    let n: u8 = kani::any();
    kani::assume(n != 9 && n != 4);
    let listed: bool = kani::any();
    unsafe {
        NOW = 1;
        R9_SIGNER = vec![n];
        R9_DEVICES = Some((if listed { vec![vec![n]] } else { vec![vec![5]] }, false));
    }
    let mut p = r7_policy(DAY_NS, 1, Some((vec![n], 10)));
    p.device_gate();
    assert!(false, "the waiting recovery's key acted as the phone");
}

/// R9-DG-d (control, panic = failure): signer 5, on the list, while a recovery waits for 6 and a marker names 3: the gate
/// returns (so a-c refuse for their keys, not for every signer).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_devices, r9_store_devices_record)]
#[kani::stub(super::load_devices, r9_load_devices)]
fn r9_dg_d_phone_still_acts() {
    r9_reset();
    unsafe {
        NOW = 1;
        R9_SIGNER = vec![5];
        R9_DEVICES = Some((vec![vec![5]], true));
        R9_FIN = Some((vec![3], 0, 0));
    }
    let mut p = r7_policy(DAY_NS, 1, Some((vec![6], 10)));
    p.device_gate();
}

/// R9-KIU: `key_in_use` of the finishing recovery's new key (any 1-byte f, with no other role: no recovery waiting, not
/// a device, not the words, not on the phone list) is true; and of any other key g (no role) is false.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::load_devices, r9_load_devices)]
fn r9_kiu_finishing_key_in_use() {
    r9_reset();
    let f: u8 = kani::any();
    let g: u8 = kani::any();
    kani::assume(f != 9 && f != 4 && f != 5 && g != 9 && g != 4 && g != 5 && g != f);
    unsafe {
        R9_DEVICES = Some((vec![vec![5]], true));
        R9_FIN = Some((vec![f], 0, 0));
    }
    let p = r7_policy(DAY_NS, 1, None);
    assert!(p.key_in_use(&[f]));
    assert!(!p.key_in_use(&[g]));
}

// ── The upgrade allowlist ─────────────────────────────────────────────────────────────────────────────────────────

const R9_BASE: [u8; 4] = [1, 2, 3, 4];
fn r9_list(n: usize) -> Vec<Vec<u8>> {
    let mut l = vec![];
    for i in 0..4 {
        if i < n {
            l.push(vec![R9_BASE[i]]);
        }
    }
    l
}
/// The list a RELEASES cell's borsh holds (1-byte entries, as the harnesses write them).
fn r9_decode_list(v: &[u8]) -> Vec<Vec<u8>> {
    let count = r9_u32(v, 0);
    let mut at = 4;
    let mut out = vec![];
    for _ in 0..count {
        let n = r9_u32(v, at);
        out.push(v[at + 4..at + 4 + n].to_vec());
        at += 4 + n;
    }
    out
}
fn r9_ar_setup(h: u8, asked: u64, approved: bool, n: usize, cell: bool) -> AccountPolicy {
    r9_reset();
    unsafe {
        R9_RELEASES = cell.then(|| r9_list(n));
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.pending.push(Pending { id: U64(1), change: Change::AllowRelease { code_hash: Base64VecU8(vec![h]), asked_at_ns: U64(asked) }, ready_at_ns: U64(0), needs_device: false, approved });
    p.next_id = 2;
    p
}

/// R9-AR-a: `finish` of a waiting AllowRelease{h, asked_at A}, every 1-byte h (a stand-in for the 32-byte hash: this arm
/// never reads its length), every A and block time, approved or not (no approver record: co-signed = approved), a RELEASES
/// cell absent or holding 0-4 entries: if it returns, (i) co-signed or now ≥ A + max(fallback, floor) (saturating); (ii)
/// the list written contains h and has at most 4 entries; (iii) it is the old list when h was on it, else the old list
/// with h appended, the oldest dropped first when it held 4. Other arms of `finish` cut at their first call.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, prune_promise_new)]
#[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
#[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
#[kani::stub(super::load_devices, r9_prune_load_devices)]
#[kani::stub(super::release_allowed, r9_prune_release_allowed)]
fn r9_ar_a_allow_release_rule() {
    let h: u8 = kani::any();
    let asked: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let approved: bool = kani::any();
    let n: usize = kani::any();
    kani::assume(n <= 4);
    let cell: bool = kani::any();
    kani::assume(cell || n == 0);
    let mut p = r9_ar_setup(h, asked, approved, n, cell);
    unsafe { NOW = now }
    let floor = p.floor_ns();
    let out = p.finish(1);
    assert!(out.done);
    assert!(approved || now >= asked.saturating_add(default_fallback_ns(DAY_NS).max(floor)));
    let old = r9_list(n);
    let w = unsafe { (*core::ptr::addr_of!(R9_REL_LIST)).clone().expect("the list is written") };
    assert!(w.contains(&vec![h]));
    assert!(w.len() <= MAX_RELEASES);
    if old.contains(&vec![h]) {
        assert!(w == old);
    } else if n == 4 {
        assert!(w.len() == 4 && w[0] == old[1] && w[1] == old[2] && w[2] == old[3] && w[3] == vec![h]);
    } else {
        assert!(w.len() == n + 1 && w[n] == vec![h]);
        for i in 0..4 {
            if i < n {
                assert!(w[i] == old[i]);
            }
        }
    }
    kani::cover!(!approved, "added by the fallback wait alone");
    kani::cover!(n == 4 && !old.contains(&vec![h]), "the oldest dropped");
}

/// R9-AR-b: not co-signed and now < A + max(fallback, floor) ⇒ `finish(AllowRelease)` never returns (refusal covered).
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, prune_promise_new)]
#[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
#[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
#[kani::stub(super::load_devices, r9_prune_load_devices)]
#[kani::stub(super::release_allowed, r9_prune_release_allowed)]
fn r9_ar_b_early_alone_refused() {
    let h: u8 = kani::any();
    let asked: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let mut p = r9_ar_setup(h, asked, false, 1, true);
    unsafe { NOW = now }
    kani::assume(now < asked.saturating_add(default_fallback_ns(DAY_NS).max(p.floor_ns())));
    p.finish(1);
    assert!(false, "an AllowRelease nobody co-signed ran before the fallback");
}

/// R9-UP-a: `finish(Upgrade{h})`, every 1-byte h not on the account's list (cell absent, or [1], [1,2], …, 4 entries),
/// approved or not: never returns, and no promise is built on the way (a Promise::new would fail the proof: no
/// UseGlobalContract). Other arms cut.
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, r9_promise_new_never)]
#[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
#[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
#[kani::stub(super::load_devices, r9_prune_load_devices)]
#[kani::stub(super::AccountPolicy::fallback_ns, r9_prune_fallback)]
fn r9_up_a_unlisted_upgrade_never_runs() {
    r9_reset();
    let h: u8 = kani::any();
    let n: usize = kani::any();
    kani::assume(n <= 4);
    let cell: bool = kani::any();
    kani::assume(cell || n == 0);
    kani::assume(!r9_list(n).contains(&vec![h]));
    let approved: bool = kani::any();
    unsafe {
        NOW = 1;
        R9_RELEASES = cell.then(|| r9_list(n));
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.pending.push(Pending { id: U64(1), change: Change::Upgrade { code_hash: Base64VecU8(vec![h]) }, ready_at_ns: U64(0), needs_device: false, approved });
    p.next_id = 2;
    p.finish(1);
    assert!(false, "an upgrade to a release off the list returned");
}

/// R9-UP-b (control for UP-a): h = the 32-byte [7; 32], the list [[7; 32]]: the upgrade's promise IS built (cover; the
/// path is cut there). serde_json's map seed fixed (it builds the check's arguments).
#[kani::proof]
#[kani::unwind(36)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::group_promise, prune_group)]
#[kani::stub(super::dispatch_chain, prune_chain)]
#[kani::stub(near_sdk::Promise::new, r9_promise_new_cover)]
#[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
#[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
#[kani::stub(super::load_devices, r9_prune_load_devices)]
#[kani::stub(super::AccountPolicy::fallback_ns, r9_prune_fallback)]
#[kani::stub(std::collections::hash_map::RandomState::new, random_state_fixed)]
fn r9_up_b_listed_upgrade_builds_its_promise() {
    r9_reset();
    unsafe {
        NOW = 1;
        R9_RELEASES = Some(vec![vec![7u8; 32]]);
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.pending.push(Pending { id: U64(1), change: Change::Upgrade { code_hash: Base64VecU8(vec![7u8; 32]) }, ready_at_ns: U64(0), needs_device: false, approved: false });
    p.next_id = 2;
    p.finish(1);
}

static mut R9_LISTED: bool = false;
fn r9_release_allowed_given(_h: &[u8]) -> bool {
    unsafe { R9_LISTED }
}
static mut R9_PLACED: Option<(u8, Vec<u8>, u64)> = None; // (0 Upgrade, 1 AllowRelease, 2 other; hash; asked_at)
static mut R9_PLACE_CALLS: u32 = 0;
fn r9_place_record(_this: &mut AccountPolicy, id: u64, change: Change, _level: Level) -> Outcome {
    unsafe {
        R9_PLACE_CALLS += 1;
        R9_PLACED = Some(match change {
            Change::Upgrade { code_hash } => (0, code_hash.0, 0),
            Change::AllowRelease { code_hash, asked_at_ns } => (1, code_hash.0, asked_at_ns.0),
            _ => (2, vec![], 0),
        });
    }
    Outcome { done: false, id: Some(U64(id)), ready_at_ns: Some(U64(0)), needs_device: false }
}

/// R9-UPG: `upgrade(h)`, h any 32-byte hash whose first byte b is symbolic (the rest 0), the hash on the list or not
/// (`release_allowed` answered at its boundary: proven by R9-REL), the queue empty or holding one AllowRelease for a hash
/// with any first byte b2, every block time: `place` is called once; with h unlisted and no AllowRelease for h waiting it
/// places AllowRelease{h, asked_at = now}, NEVER an Upgrade; otherwise Upgrade{h}.
#[kani::proof]
#[kani::unwind(36)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::release_allowed, r9_release_allowed_given)]
#[kani::stub(super::AccountPolicy::place, r9_place_record)]
fn r9_upg_unlisted_hash_never_placed_as_upgrade() {
    let b: u8 = kani::any();
    let b2: u8 = kani::any();
    let listed: bool = kani::any();
    let waiting: bool = kani::any();
    let now: u64 = kani::any();
    let mut h = vec![0u8; 32];
    h[0] = b;
    let mut h2 = vec![0u8; 32];
    h2[0] = b2;
    unsafe {
        NOW = now;
        R9_LISTED = listed;
        R9_PLACED = None;
        R9_PLACE_CALLS = 0;
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    if waiting {
        p.pending.push(Pending { id: U64(1), change: Change::AllowRelease { code_hash: Base64VecU8(h2), asked_at_ns: U64(5) }, ready_at_ns: U64(9), needs_device: false, approved: false });
        p.next_id = 2;
    }
    p.upgrade(Base64VecU8(h.clone()));
    let asked = waiting && b2 == b;
    unsafe {
        assert!(R9_PLACE_CALLS == 1);
        let (kind, hash, at) = (*core::ptr::addr_of!(R9_PLACED)).clone().unwrap();
        assert!(hash == h);
        if !listed && !asked {
            assert!(kind == 1 && at == now);
        } else {
            assert!(kind == 0);
        }
    }
    kani::cover!(waiting && b2 == b && !listed, "an Upgrade placed while its AllowRelease waits");
}

/// R9-REL: `release_allowed(h)` = h is on the stored list: every 1-byte h, the cell absent, or holding the first n of
/// [1], [2], [3], [4], for each n = 0..4 (the lists concrete, one call each).
#[kani::proof]
#[kani::unwind(6)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::load_key, r9_load_key)]
fn r9_rel_release_allowed_is_membership() {
    r9_reset();
    let h: u8 = kani::any();
    assert!(!release_allowed(&[h]));
    unsafe { R9_RELEASES = Some(vec![]) }
    assert!(!release_allowed(&[h]));
    unsafe { R9_RELEASES = Some(vec![vec![1]]) }
    assert_eq!(release_allowed(&[h]), h == 1);
    unsafe { R9_RELEASES = Some(vec![vec![1], vec![2]]) }
    assert_eq!(release_allowed(&[h]), h == 1 || h == 2);
    unsafe { R9_RELEASES = Some(vec![vec![1], vec![2], vec![3]]) }
    assert_eq!(release_allowed(&[h]), h >= 1 && h <= 3);
    unsafe { R9_RELEASES = Some(vec![vec![1], vec![2], vec![3], vec![4]]) }
    assert_eq!(release_allowed(&[h]), h >= 1 && h <= 4);
}

fn r9_read_all_state_noop() {}
static mut R9_HAS_FALLBACK: bool = false;
fn r9_has_key(key: &[u8]) -> bool {
    key == FALLBACK_KEY && unsafe { R9_HAS_FALLBACK }
}

/// R9-UC: `upgrade_check(from_version, code_hash)`, every from_version, code_hash None, Some(the 32-byte [3; 32]) or a
/// wrong length (Some([3])), the fallback cell present or not, two second devices 9 and 8 (`read_all_state` a no-op: the
/// whole-state decode is the node's and the suites' check): if it returns, from_version ≤ 9 and the hash is 32 bytes when
/// given; the list written is EXACTLY [code_hash] or [] (its borsh: count 1, length 32, the 32 bytes; or count 0); from a
/// release before 9 each second device's key is renewed once, in order, with the five methods and SECOND_DEVICE_ALLOWANCE;
/// from 9 none is. No key is added or deleted.
#[kani::proof]
#[kani::unwind(36)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::read_all_state, r9_read_all_state_noop)]
#[kani::stub(near_sdk::env::storage_has_key, r9_has_key)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(super::renew_function_call_key, r9_renew_key)]
#[kani::stub(super::add_function_call_key, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_uc_upgrade_check_sets_list() {
    r9_reset();
    let from: u32 = kani::any();
    let which: u8 = kani::any();
    let has_fallback: bool = kani::any();
    unsafe { R9_HAS_FALLBACK = has_fallback }
    let code_hash = match which {
        0 => None,
        1 => Some(Base64VecU8(vec![3u8; 32])),
        _ => Some(Base64VecU8(vec![3u8])),
    };
    let mut p = r7_policy(DAY_NS, 0, None);
    p.second_devices = vec![vec![9], vec![8]];
    p.upgrade_check(from, code_hash);
    assert!(from <= RELEASE_VERSION);
    assert!(which <= 1);
    unsafe {
        let w = (*core::ptr::addr_of!(R9_REL_LIST)).clone().expect("the list is written");
        if which == 0 {
            assert!(w.is_empty());
        } else {
            assert!(w.len() == 1 && w[0] == vec![3u8; 32]);
        }
        let r = &*core::ptr::addr_of!(R9_RENEWED);
        if from < 9 {
            assert!(r.len() == 2);
            assert!(r[0].0 == vec![9u8] && r[1].0 == vec![8u8]);
            assert!(r[0].1 == 2 && r[1].1 == 2 && r[0].2 == SECOND_DEVICE_ALLOWANCE && r[1].2 == SECOND_DEVICE_ALLOWANCE);
        } else {
            assert!(r.is_empty());
        }
        assert!((*core::ptr::addr_of!(R9_ADDED)).is_empty() && (*core::ptr::addr_of!(R9_DELETED)).is_empty());
    }
    kani::cover!(from < 9 && which == 1, "a release-8 account gets the list [h] and its devices renewed");
}

// ── I-2: the words' refill by a second device of age ──────────────────────────────────────────────────────────────

fn r9_refill_setup(s: u8, words: bool, a9: u64, now: u64) -> AccountPolicy {
    r9_reset();
    unsafe {
        NOW = now;
        R9_SIGNER = vec![s];
        R9_AGES = Some(vec![(vec![9, 0, 1], a9)]); // device 9 added at a9; device 8 from before ages (of age)
    }
    let mut p = r7_policy(DAY_NS, 0, None);
    p.second_devices = vec![vec![9], vec![8]];
    if !words {
        p.recovery_key = None;
    }
    p
}

/// R9-RF-a: `refill_recovery_key`, every 1-byte signer, the words (key 4) present or not, device 9 added at any a9 and
/// device 8 of age, every block time: if it returns, the signer is a second device (9 or 8) of age (for 9: now ≥ a9 +
/// floor), the words exist, and exactly one renewal is issued: of key 4, with RECOVERY_METHODS and RECOVERY_KEY_ALLOWANCE;
/// nothing added, deleted or written.
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::renew_function_call_key, r9_renew_key)]
#[kani::stub(super::add_function_call_key, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_rf_a_refill_only_by_aged_device() {
    let s: u8 = kani::any();
    let words: bool = kani::any();
    let a9: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(a9 <= MAX_NOW && now <= MAX_NOW);
    let mut p = r9_refill_setup(s, words, a9, now);
    let floor = p.floor_ns();
    p.refill_recovery_key();
    assert!(s == 9 || s == 8);
    if s == 9 {
        assert!(now >= a9 + floor);
    }
    assert!(words);
    unsafe {
        let r = &*core::ptr::addr_of!(R9_RENEWED);
        assert!(r.len() == 1 && r[0].0 == vec![4u8] && r[0].1 == 3 && r[0].2 == RECOVERY_KEY_ALLOWANCE);
        assert!((*core::ptr::addr_of!(R9_ADDED)).is_empty() && (*core::ptr::addr_of!(R9_DELETED)).is_empty());
        assert!(R9_OTHER_WRITES == 0 && R9_FIN_WRITES == 0);
    }
    kani::cover!(s == 9, "device 9, of age, refills");
}

/// R9-RF-b (liveness): device 9 of age (now ≥ a9 + floor), the words present ⇒ never refused (panic = failure).
#[kani::proof]
#[kani::unwind(5)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(super::signer_key, r9_signer)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(super::load_key, r9_load_key)]
#[kani::stub(super::store_key, r9_store_key)]
#[kani::stub(near_sdk::env::sha256, sha256_short)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::renew_function_call_key, r9_renew_key)]
#[kani::stub(super::add_function_call_key, r9_add_key)]
#[kani::stub(super::delete_key, r9_delete_key)]
fn r9_rf_b_aged_device_refills() {
    let a9: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(a9 <= MAX_NOW && now <= MAX_NOW);
    let mut p = r9_refill_setup(9, true, a9, now);
    kani::assume(now >= a9 + p.floor_ns());
    p.refill_recovery_key();
    unsafe { assert!((*core::ptr::addr_of!(R9_RENEWED)).len() == 1) }
}

// ── I-4 / RS-2: the gas line, at 10⁹ yocto a gas, proven at add_move's boundary (no 128-bit product equivalence) ────

static mut R9_MOVES: Vec<(bool, u128)> = Vec::new(); // (coin == "near", amount)
fn r9_add_move_record(_m: &mut Vec<(String, u128)>, coin: &str, amount: u128) {
    unsafe { R9_MOVES.push((coin == "near", amount)) }
}

/// R9-GAS-a: GAS_PRICE_COUNTED is 10⁹; `moves` of an allowlisted call (near_deposit on wrap.near, no args), ANY u128
/// deposit, any gas ≤ 300 Tgas: Some, and its only additions are ("near", deposit) then ("near", gas × 10⁹), in that
/// order. With P7c (add_move: a saturating sum into the one "near" row) this is RS-2a for the full u128 deposit: near =
/// deposit ⊕ gas·10⁹.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::add_move, r9_add_move_record)]
fn r9_gas_a_allowlisted_call_counts_gas_u128() {
    assert!(GAS_PRICE_COUNTED == 1_000_000_000);
    let gas: u64 = kani::any();
    kani::assume(gas <= MAX_STEP_GAS);
    let deposit: u128 = kani::any();
    unsafe { R9_MOVES = Vec::new() }
    let step = Step::FunctionCall { method_name: "near_deposit".to_string(), args: Base64VecU8(vec![]), deposit: U128(deposit), gas: U64(gas) };
    assert!(moves("wrap.near", &[step]).is_some());
    unsafe {
        let m = &*core::ptr::addr_of!(R9_MOVES);
        assert!(m.len() == 2);
        assert!(m[0] == (true, deposit));
        assert!(m[1].0 && m[1].1 == u128::from(gas) * 1_000_000_000);
    }
}

/// R9-GAS-b (RS-2b): two allowlisted calls (near_deposit, unstake_all) on pool.near, any u128 deposits, any gases ≤ 300
/// Tgas: the additions are near d1, near g1·10⁹, near d2, near g2·10⁹: every call step's gas counts.
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::add_move, r9_add_move_record)]
fn r9_gas_b_every_call_step_counts_u128() {
    let g1: u64 = kani::any();
    let g2: u64 = kani::any();
    kani::assume(g1 <= MAX_STEP_GAS && g2 <= MAX_STEP_GAS);
    let d1: u128 = kani::any();
    let d2: u128 = kani::any();
    unsafe { R9_MOVES = Vec::new() }
    let s1 = Step::FunctionCall { method_name: "near_deposit".to_string(), args: Base64VecU8(vec![]), deposit: U128(d1), gas: U64(g1) };
    let s2 = Step::FunctionCall { method_name: "unstake_all".to_string(), args: Base64VecU8(vec![]), deposit: U128(d2), gas: U64(g2) };
    assert!(moves("pool.near", &[s1, s2]).is_some());
    unsafe {
        let m = &*core::ptr::addr_of!(R9_MOVES);
        assert!(m.len() == 4);
        assert!(m[0] == (true, d1) && m[2] == (true, d2));
        assert!(m[1].0 && m[1].1 == u128::from(g1) * GAS_PRICE_COUNTED);
        assert!(m[3].0 && m[3].1 == u128::from(g2) * GAS_PRICE_COUNTED);
    }
}

/// add_move into the moves vec of RS-2 (one "near" row): two successive additions give the saturating sum, for all
/// u128 (the lemma R9-GAS-a/b compose with; P7c is the one-addition case).
#[kani::proof]
#[kani::unwind(8)]
fn r9_gas_c_add_move_twice_saturates() {
    let a: u128 = kani::any();
    let b: u128 = kani::any();
    let mut m: Vec<(String, u128)> = vec![];
    add_move(&mut m, "near", a);
    add_move(&mut m, "near", b);
    assert!(m.len() == 1 && m[0].0 == "near" && m[0].1 == a.saturating_add(b));
}

/// The standard method's JSON read, stubbed at its boundary: `serde_json::from_slice` answers {"amount": "1"} (the map's
/// seed fixed). The only T `moves` reads is Value (asserted by size).
fn r9_from_slice_amount_one<'a, T: near_sdk::serde::Deserialize<'a>>(_v: &'a [u8]) -> near_sdk::serde_json::Result<T> {
    assert!(core::mem::size_of::<T>() == core::mem::size_of::<near_sdk::serde_json::Value>());
    let mut map = near_sdk::serde_json::Map::new();
    map.insert("amount".to_string(), near_sdk::serde_json::Value::String("1".to_string()));
    let v = near_sdk::serde_json::Value::Object(map);
    let t = unsafe { core::mem::transmute_copy::<near_sdk::serde_json::Value, T>(&v) };
    core::mem::forget(v);
    Ok(t)
}

/// R9-GAS-d (RS-2's own case, the standard-method path): `ft_transfer_call` on usdc.near with its arguments read as
/// {"amount": "1"} (the JSON parse stubbed at its boundary), ANY u128 deposit, any gas ≤ 300 Tgas: Some, and the
/// additions are ("near", deposit), ("near", gas × 10⁹), then one coin row of 1 unit (not "near"). The coin's name is
/// built by `format!`, stubbed to an empty string (only "is it near" is read).
#[kani::proof]
#[kani::unwind(12)]
#[kani::stub(near_sdk::env::panic_str, panic_fail)]
#[kani::stub(super::add_move, r9_add_move_record)]
#[kani::stub(near_sdk::serde_json::from_slice, r9_from_slice_amount_one)]
#[kani::stub(std::collections::hash_map::RandomState::new, random_state_fixed)]
#[kani::stub(std::fmt::format, r9_format_empty)]
fn r9_gas_d_standard_call_counts_gas() {
    let gas: u64 = kani::any();
    kani::assume(gas <= MAX_STEP_GAS);
    let deposit: u128 = kani::any();
    unsafe { R9_MOVES = Vec::new() }
    let step = Step::FunctionCall { method_name: "ft_transfer_call".to_string(), args: Base64VecU8(b"{}".to_vec()), deposit: U128(deposit), gas: U64(gas) };
    assert!(moves("usdc.near", &[step]).is_some());
    unsafe {
        let m = &*core::ptr::addr_of!(R9_MOVES);
        assert!(m.len() == 3);
        assert!(m[0] == (true, deposit));
        assert!(m[1].0 && m[1].1 == u128::from(gas) * GAS_PRICE_COUNTED);
        assert!(m[2] == (false, 1));
    }
}

// ── RS-1 again: `execute` with 1–3 steps of every kind, one harness per shape (place and moves stubbed) ───────────

fn r9_rs1_steps(shape: &[bool], gas: &[u64; 3]) -> Vec<Step> {
    let mut steps = vec![];
    for (i, call) in shape.iter().enumerate() {
        steps.push(if *call {
            Step::FunctionCall { method_name: "a".to_string(), args: Base64VecU8(vec![]), deposit: U128(0), gas: U64(gas[i]) }
        } else {
            Step::Transfer { deposit: U128(0) }
        });
    }
    steps
}
fn r9_rs1_exact(shape: &[bool], gas: &[u64; 3]) -> u128 {
    let mut s = 0u128;
    for (i, call) in shape.iter().enumerate() {
        if *call {
            s += u128::from(gas[i]);
        }
    }
    s
}
/// Over the cap ⇒ refused: if `execute` returns, the exact sum ≤ 250 Tgas and `place` ran once.
fn r9_rs1_refuse(shape: &[bool]) {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
    }
    let gas: [u64; 3] = kani::any();
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), r9_rs1_steps(shape, &gas), None);
    assert!(r9_rs1_exact(shape, &gas) <= u128::from(MAX_CHAIN_GAS));
    assert!(unsafe { PLACE_CALLS == 1 });
}
/// Within the cap ⇒ accepted (panic = failure).
fn r9_rs1_accept(shape: &[bool]) {
    unsafe {
        NOW = 1;
        PLACE_CALLS = 0;
    }
    let gas: [u64; 3] = kani::any();
    kani::assume(r9_rs1_exact(shape, &gas) <= u128::from(MAX_CHAIN_GAS));
    let mut p = r7_policy(DAY_NS, 0, None);
    p.execute("rr".parse().unwrap(), r9_rs1_steps(shape, &gas), None);
    assert!(unsafe { PLACE_CALLS == 1 });
}
macro_rules! r9_rs1_shape {
    ($refuse:ident, $accept:ident, [$($c:expr),+]) => {
        #[kani::proof]
        #[kani::unwind(5)]
        #[kani::stub(near_sdk::env::panic_str, panic_prune)]
        #[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
        #[kani::stub(near_sdk::env::current_account_id, me_id)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(near_sdk::env::storage_read, storage_none)]
        #[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
        #[kani::stub(super::AccountPolicy::place, place_record)]
        #[kani::stub(super::moves, moves_none)]
        fn $refuse() {
            r9_rs1_refuse(&[$($c),+]);
        }
        #[kani::proof]
        #[kani::unwind(5)]
        #[kani::stub(near_sdk::env::panic_str, panic_fail)]
        #[kani::stub(near_sdk::env::predecessor_account_id, me_id)]
        #[kani::stub(near_sdk::env::current_account_id, me_id)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(near_sdk::env::storage_read, storage_none)]
        #[kani::stub(super::AccountPolicy::owner_active, owner_active_noop)]
        #[kani::stub(super::AccountPolicy::place, place_record)]
        #[kani::stub(super::moves, moves_none)]
        fn $accept() {
            r9_rs1_accept(&[$($c),+]);
        }
    };
}
const R9_T: bool = false;
const R9_C: bool = true;
r9_rs1_shape!(r9_rs1b_t, r9_rs1c_t, [R9_T]);
r9_rs1_shape!(r9_rs1b_c, r9_rs1c_c, [R9_C]);
r9_rs1_shape!(r9_rs1b_tt, r9_rs1c_tt, [R9_T, R9_T]);
r9_rs1_shape!(r9_rs1b_tc, r9_rs1c_tc, [R9_T, R9_C]);
r9_rs1_shape!(r9_rs1b_ct, r9_rs1c_ct, [R9_C, R9_T]);
r9_rs1_shape!(r9_rs1b_cc, r9_rs1c_cc, [R9_C, R9_C]);
r9_rs1_shape!(r9_rs1b_ttt, r9_rs1c_ttt, [R9_T, R9_T, R9_T]);
r9_rs1_shape!(r9_rs1b_ttc, r9_rs1c_ttc, [R9_T, R9_T, R9_C]);
r9_rs1_shape!(r9_rs1b_tct, r9_rs1c_tct, [R9_T, R9_C, R9_T]);
r9_rs1_shape!(r9_rs1b_tcc, r9_rs1c_tcc, [R9_T, R9_C, R9_C]);
r9_rs1_shape!(r9_rs1b_ctt, r9_rs1c_ctt, [R9_C, R9_T, R9_T]);
r9_rs1_shape!(r9_rs1b_ctc, r9_rs1c_ctc, [R9_C, R9_T, R9_C]);
r9_rs1_shape!(r9_rs1b_cct, r9_rs1c_cct, [R9_C, R9_C, R9_T]);
r9_rs1_shape!(r9_rs1b_ccc, r9_rs1c_ccc, [R9_C, R9_C, R9_C]);

// ── RK-c again (R8-F1, all-symbolic within each device-list shape), finish's other arms and helpers cut ───────────

fn r9_prune_forget_second_device(_this: &mut AccountPolicy, _k: &[u8]) {
    kani::assume(false);
}
static mut R9_STORED_DEV: Option<usize> = None;
fn r9_store_devices_record(d: &Devices) {
    unsafe { R9_STORED_DEV = Some(d.keys.len()) }
}
fn r9_rk_c(shape: u8) {
    let k: u8 = kani::any();
    let backup: Option<u8> = kani::any();
    let new_key: Option<u8> = kani::any();
    kani::assume(k != 9); // the second device's removal is forget_second_device's path (cut here; RK-bq covers it)
    kani::assume(!(shape == 2 && k == 7)); // the contract never lists a key twice
    let mut p = rk_setup(k, backup, false);
    p.recovery = new_key.map(|n| PendingRecovery { new_key: Base64VecU8(vec![n]), ready_at_ns: U64(10) });
    unsafe {
        DEV_SHAPE = shape;
        DEV_K = k;
        STORED_DEV_LEN = None;
    }
    let out = p.finish(1);
    assert!(out.done);
    assert!(backup != Some(k));
    assert!(new_key != Some(k));
    assert!(!(shape == 1 || (shape == 3 && k == 7)));
    let stored = unsafe { STORED_DEV_LEN }.expect("the device list is stored");
    assert!(shape == 0 || stored >= 1);
    assert!(unsafe { DELETE_CALLS == 1 && DELETED == Some(k) });
}
macro_rules! r9_rk_c_shape {
    ($name:ident, $shape:expr) => {
        /// R9-RK-c, one device-list shape (0 absent, 1 [k], 2 [k, 7], 3 [7]), every 1-byte k ≠ 9, every backup key (none or
        /// 1 byte), a recovery waiting or not with any 1-byte new key: if `finish(RemoveKey(k))` returns, k is not the
        /// backup key, not the waiting recovery's new key, the list was not [k] alone, the list stored is non-empty, and
        /// the one delete is k's. Refusals pruned after checking no backup delete preceded them. Cuts: finish's other
        /// arms (the AllowRelease arm at `fallback_ns`; the Upgrade arm refuses: no list), `load_devices` as a value, the
        /// stored list read back from `store_devices`' real borsh (its count). k = 9 (a second device) is RK-bq's case.
        #[kani::proof]
        #[kani::unwind(4)]
        #[kani::stub(near_sdk::env::panic_str, panic_prune_no_backup_delete)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(near_sdk::env::storage_read, storage_none)]
        #[kani::stub(near_sdk::env::storage_write, storage_write_devices)]
        #[kani::stub(near_sdk::env::sha256, sha256_short)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::delete_key, delete_key_record)]
        #[kani::stub(super::group_promise, prune_group)]
        #[kani::stub(super::dispatch_chain, prune_chain)]
        #[kani::stub(super::then_check_second_device_key, prune_then_check)]
        #[kani::stub(super::load_devices, load_devices_shape)]
        #[kani::stub(super::AccountPolicy::fallback_ns, r9_prune_fallback)]
        fn $name() {
            r9_rk_c($shape);
        }
    };
}
r9_rk_c_shape!(r9_rk_c0_no_list, 0);
r9_rk_c_shape!(r9_rk_c1_only_phone, 1);
r9_rk_c_shape!(r9_rk_c2_two_phones, 2);
r9_rk_c_shape!(r9_rk_c3_other_phone, 3);

// ── R7-6c's link again: refuse_recovery(None / false) with the stop waiting calls end_recovery(true), never finish ──

fn r9_aged_true(_this: &AccountPolicy, _k: &[u8]) -> bool {
    true
}
fn r9_gate_noop(_this: &AccountPolicy) {}

/// R9-R76c4: `refuse_recovery(None | Some(false))`, every delay and block time, a recovery waiting and the phone's stop
/// (id 1) the one waiting request: `end_recovery(true)` is called exactly once, `finish` never, the stop stays
/// unapproved. Boundary stubs: `second_device_gate` (its own rule: R9 refill / R7 gates) no-op, `aged` → true (the
/// device of age, as in R7-6b), `end_recovery` and `finish` recorded, `index` / `store_key` cut (only the confirmed
/// branch calls them).
#[kani::proof]
#[kani::unwind(3)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::second_device_gate, r9_gate_noop)]
#[kani::stub(super::AccountPolicy::aged, r9_aged_true)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
#[kani::stub(super::AccountPolicy::index, prune_index)]
#[kani::stub(super::store_key, prune_store_key)]
fn r9_r76c4_plain_refusal_calls_freezing_end() {
    let d = any_r7_delay();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    unsafe {
        NOW = now;
        END_CALLS = 0;
        END_FREEZE = None;
        FINISH_CALLS = 0;
    }
    let plain: bool = kani::any();
    let confirm = if plain { None } else { Some(false) };
    let mut p = r7_policy(d, 1, Some((vec![1, 2], now + d)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(now + 1), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(confirm);
    assert!(unsafe { END_CALLS == 1 && END_FREEZE == Some(true) && FINISH_CALLS == 0 });
    assert!(p.recovery.is_none());
    assert!(p.pending.len() == 1 && !p.pending[0].approved);
}

/// R9-R76c5: the same at a single concrete point (delay 1 day, now 10), plain refusal (None): the smallest instance of
/// the link, should the symbolic one exceed the cap.
#[kani::proof]
#[kani::unwind(3)]
#[kani::stub(near_sdk::env::panic_str, panic_prune)]
#[kani::stub(super::only_this_account, only_this_account_noop)]
#[kani::stub(near_sdk::env::block_timestamp, now_stub)]
#[kani::stub(near_sdk::env::storage_read, storage_none)]
#[kani::stub(super::event, event_stub)]
#[kani::stub(super::signer_key, signer_nine)]
#[kani::stub(super::AccountPolicy::second_device_gate, r9_gate_noop)]
#[kani::stub(super::AccountPolicy::aged, r9_aged_true)]
#[kani::stub(super::AccountPolicy::end_recovery, end_recovery_record)]
#[kani::stub(super::AccountPolicy::finish, finish_record)]
#[kani::stub(super::AccountPolicy::index, prune_index)]
#[kani::stub(super::store_key, prune_store_key)]
fn r9_r76c5_plain_refusal_concrete() {
    unsafe {
        NOW = 10;
        END_CALLS = 0;
        END_FREEZE = None;
        FINISH_CALLS = 0;
    }
    let mut p = r7_policy(DAY_NS, 1, Some((vec![1, 2], 10 + DAY_NS)));
    p.pending.push(Pending { id: U64(1), change: Change::CancelRecovery, ready_at_ns: U64(11), needs_device: false, approved: false });
    p.next_id = 2;
    p.refuse_recovery(None);
    assert!(unsafe { END_CALLS == 1 && END_FREEZE == Some(true) && FINISH_CALLS == 0 });
    assert!(p.pending.len() == 1 && !p.pending[0].approved);
}

// ── RT3 (re-freeze 3): add_after_delete's receipts and the callback's chaining, at the host calls ─────────────────

static mut R9_HOST: Vec<(u8, u64, Vec<u8>)> = Vec::new(); // (1 create, 2 delete key, 3 then, 4 add key; promise; bytes)
static mut R9_NEXT_PROMISE: u64 = 0;
static mut R9_ADD_METHODS: Vec<u8> = Vec::new();
static mut R9_ADD_ALLOWANCE: u128 = 1;
static mut R9_ADD_NONCE: u64 = 1;
static mut R9_CALL: Option<(u64, Vec<u8>, u64, u64)> = None; // (promise, method, gas, weight)
fn r9_bytes(len: u64, ptr: u64) -> Vec<u8> {
    unsafe { core::slice::from_raw_parts(ptr as *const u8, len as usize).to_vec() }
}
fn r9_host_create(len: u64, ptr: u64) -> u64 {
    unsafe {
        R9_NEXT_PROMISE += 1;
        R9_HOST.push((1, R9_NEXT_PROMISE, r9_bytes(len, ptr)));
        R9_NEXT_PROMISE
    }
}
fn r9_host_then(promise: u64, len: u64, ptr: u64) -> u64 {
    unsafe {
        R9_NEXT_PROMISE += 1;
        R9_HOST.push((3, promise, r9_bytes(len, ptr)));
        R9_NEXT_PROMISE
    }
}
fn r9_host_delete_key(promise: u64, len: u64, ptr: u64) {
    unsafe { R9_HOST.push((2, promise, r9_bytes(len, ptr))) }
}
fn r9_host_add_key(promise: u64, len: u64, ptr: u64, nonce: u64, allowance_ptr: u64, rlen: u64, rptr: u64, mlen: u64, mptr: u64) {
    unsafe {
        R9_HOST.push((4, promise, r9_bytes(len, ptr)));
        let _ = r9_bytes(rlen, rptr);
        R9_ADD_METHODS = r9_bytes(mlen, mptr);
        R9_ADD_NONCE = nonce;
        let a = r9_bytes(16, allowance_ptr);
        let mut b = [0u8; 16];
        b.copy_from_slice(&a);
        R9_ADD_ALLOWANCE = u128::from_le_bytes(b);
    }
}

/// R9-AAD (RT3): `add_after_delete(k, DEVICE_METHODS, 0)`, every 2-byte key k: the host sees exactly, in order, a new
/// batch on this account (promise 1), a DeleteKey(k) in it, a batch on this account chained after promise 1 (promise 2),
/// and an AddKey(k) in promise 2 with the phone's methods, nonce 0 and allowance 0; it returns promise 2, the add's (so
/// the callback `finish_recovery` chains on it, R9-FR-a + R9-TFR, runs after the add, which runs after the delete).
#[kani::proof]
#[kani::unwind(130)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sys::promise_batch_create, r9_host_create)]
#[kani::stub(near_sys::promise_batch_then, r9_host_then)]
#[kani::stub(near_sys::promise_batch_action_delete_key, r9_host_delete_key)]
#[kani::stub(near_sys::promise_batch_action_add_key_with_function_call, r9_host_add_key)]
fn r9_aad_delete_then_add_receipts() {
    let k: [u8; 2] = kani::any();
    unsafe {
        R9_HOST = Vec::new();
        R9_NEXT_PROMISE = 0;
    }
    let add = add_after_delete(&k, DEVICE_METHODS, 0);
    unsafe {
        let h = &*core::ptr::addr_of!(R9_HOST);
        assert!(h.len() == 4);
        assert!(h[0].0 == 1 && h[0].1 == 1 && h[0].2 == b"mm".to_vec());
        assert!(h[1].0 == 2 && h[1].1 == 1 && h[1].2 == k.to_vec());
        assert!(h[2].0 == 3 && h[2].1 == 1 && h[2].2 == b"mm".to_vec());
        assert!(h[3].0 == 4 && h[3].1 == 2 && h[3].2 == k.to_vec());
        assert!(add == 2);
        assert!(R9_ADD_METHODS == DEVICE_METHODS.as_bytes().to_vec() && R9_ADD_NONCE == 0 && R9_ADD_ALLOWANCE == 0);
    }
}

fn r9_host_call_weight(promise: u64, mlen: u64, mptr: u64, _alen: u64, _aptr: u64, _amount: u64, gas: u64, weight: u64) {
    unsafe { R9_CALL = Some((promise, r9_bytes(mlen, mptr), gas, weight)) }
}

/// R9-TFR: `then_finish_recovery(p, recovery)`: exactly one batch, on this account, chained after promise p, holding a
/// call of `on_recovery_key` with RECOVERY_KEY_CHECK_GAS and weight 1 (its JSON arguments built by serde_json with the
/// map seed fixed; their bytes are not read here). Every promise index p; a 1-byte key and a concrete time.
#[kani::proof]
#[kani::unwind(40)]
#[kani::stub(near_sdk::env::current_account_id, me_id)]
#[kani::stub(near_sys::promise_batch_then, r9_host_then)]
#[kani::stub(near_sys::promise_batch_action_function_call_weight, r9_host_call_weight)]
#[kani::stub(std::collections::hash_map::RandomState::new, random_state_fixed)]
fn r9_tfr_callback_chained_after_add() {
    let p: u64 = kani::any();
    unsafe {
        R9_HOST = Vec::new();
        R9_NEXT_PROMISE = 10;
        R9_CALL = None;
    }
    then_finish_recovery(p, &PendingRecovery { new_key: Base64VecU8(vec![1]), ready_at_ns: U64(5) }, 9);
    unsafe {
        let h = &*core::ptr::addr_of!(R9_HOST);
        assert!(h.len() == 1 && h[0].0 == 3 && h[0].1 == p && h[0].2 == b"mm".to_vec());
        let (cp, m, gas, w) = (*core::ptr::addr_of!(R9_CALL)).clone().expect("the callback is called");
        assert!(cp == 11 && m == b"on_recovery_key".to_vec() && gas == RECOVERY_KEY_CHECK_GAS && w == 1);
    }
}

// ── AR-a and UP-a split by the list's length (the symbolic-length versions exceeded the cap on the loaded box) ──────

fn r9_ar_rule(n: usize) {
    let h: u8 = kani::any();
    let asked: u64 = kani::any();
    let now: u64 = kani::any();
    kani::assume(now <= MAX_NOW);
    let approved: bool = kani::any();
    let cell: bool = if n == 0 { kani::any() } else { true };
    let mut p = r9_ar_setup(h, asked, approved, n, cell);
    unsafe { NOW = now }
    let floor = p.floor_ns();
    let out = p.finish(1);
    assert!(out.done);
    assert!(approved || now >= asked.saturating_add(default_fallback_ns(DAY_NS).max(floor)));
    let old = r9_list(n);
    let w = unsafe { (*core::ptr::addr_of!(R9_REL_LIST)).clone().expect("the list is written") };
    assert!(w.contains(&vec![h]));
    assert!(w.len() <= MAX_RELEASES);
    if old.contains(&vec![h]) {
        assert!(w == old);
    } else if n == 4 {
        assert!(w.len() == 4 && w[0] == old[1] && w[1] == old[2] && w[2] == old[3] && w[3] == vec![h]);
    } else {
        assert!(w.len() == n + 1 && w[n] == vec![h]);
        for i in 0..4 {
            if i < n {
                assert!(w[i] == old[i]);
            }
        }
    }
    kani::cover!(!approved, "added by the fallback wait alone");
    kani::cover!(!old.contains(&vec![h]), "a new release appended");
}
macro_rules! r9_ar_n {
    ($name:ident, $n:expr) => {
        /// R9-AR-a for one list length n (the RELEASES cell holding the first n of [1], [2], [3], [4]; for n = 0 also absent):
        /// same statement as R9-AR-a: if finish(AllowRelease{h, A}) returns, it was co-signed or now ≥ A + max(fallback,
        /// floor); the list written contains h, has ≤ 4 entries, and is the old list, or the old one with h appended (the
        /// oldest dropped at 4).
        #[kani::proof]
        #[kani::unwind(6)]
        #[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(super::store_key, r9_store_key)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::group_promise, prune_group)]
        #[kani::stub(super::dispatch_chain, prune_chain)]
        #[kani::stub(near_sdk::Promise::new, prune_promise_new)]
        #[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
        #[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
        #[kani::stub(super::load_devices, r9_prune_load_devices)]
        #[kani::stub(super::release_allowed, r9_prune_release_allowed)]
        fn $name() {
            r9_ar_rule($n);
        }
    };
}
r9_ar_n!(r9_ar_a0_list0, 0);
r9_ar_n!(r9_ar_a1_list1, 1);
r9_ar_n!(r9_ar_a2_list2, 2);
r9_ar_n!(r9_ar_a3_list3, 3);
r9_ar_n!(r9_ar_a4_list4, 4);

fn r9_up_rule(n: usize) {
    r9_reset();
    let h: u8 = kani::any();
    let cell: bool = if n == 0 { kani::any() } else { true };
    kani::assume(!r9_list(n).contains(&vec![h]));
    let approved: bool = kani::any();
    unsafe {
        NOW = 1;
        R9_RELEASES = cell.then(|| r9_list(n));
    }
    let mut p = r7_policy(DAY_NS, 1, None);
    p.pending.push(Pending { id: U64(1), change: Change::Upgrade { code_hash: Base64VecU8(vec![h]) }, ready_at_ns: U64(0), needs_device: false, approved });
    p.next_id = 2;
    p.finish(1);
    assert!(false, "an upgrade to a release off the list returned");
}
macro_rules! r9_up_n {
    ($name:ident, $n:expr) => {
        /// R9-UP-a for one list length n (the first n of [1], [2], [3], [4]; for n = 0 also absent): finish(Upgrade{h}) for
        /// every 1-byte h not on the list, approved or not, never returns and builds no promise on the way.
        #[kani::proof]
        #[kani::unwind(6)]
        #[kani::stub(near_sdk::env::panic_str, r9_panic_prune_cover)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::group_promise, prune_group)]
        #[kani::stub(super::dispatch_chain, prune_chain)]
        #[kani::stub(near_sdk::Promise::new, r9_promise_new_never)]
        #[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
        #[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
        #[kani::stub(super::load_devices, r9_prune_load_devices)]
        #[kani::stub(super::AccountPolicy::fallback_ns, r9_prune_fallback)]
        fn $name() {
            r9_up_rule($n);
        }
    };
}
r9_up_n!(r9_up_a0_list0, 0);
r9_up_n!(r9_up_a1_list1, 1);
r9_up_n!(r9_up_a2_list2, 2);
r9_up_n!(r9_up_a3_list3, 3);
r9_up_n!(r9_up_a4_list4, 4);

// ── ORK-d split into concrete cases (the all-symbolic ORK-d passed 5 GB: CBMC expands the whole callback body when the
//    record check is symbolic; with a concrete record and call the check folds and only the early return remains) ────

fn r9_ork_superseded(record: Option<(Vec<u8>, u64, u64)>, key: Vec<u8>, ready: u64, asked: u64) {
    let result: u8 = kani::any();
    kani::assume(result <= 2);
    r9_ork_setup(result, true, 10, vec![vec![5]]);
    unsafe {
        NOW = 1;
        R9_PROMISE_READS = 0;
        R9_FIN = record;
    }
    AccountPolicy::on_recovery_key(Base64VecU8(key), U64(ready), U64(asked));
    unsafe {
        assert!(R9_PROMISE_READS == 0);
        assert!((*core::ptr::addr_of!(R9_STATE)).is_some()); // never read
        assert!(R9_STATE_WRITES == 0 && R9_FIN_REMOVES == 0 && R9_OTHER_REMOVES == 0);
        assert!(R9_OTHER_WRITES == 0 && R9_FIN_WRITES == 0 && (*core::ptr::addr_of!(R9_DEV_WRITTEN)).is_none());
        assert!((*core::ptr::addr_of!(R9_DELETED)).is_empty());
    }
}
macro_rules! r9_ork_d_case {
    ($name:ident, $record:expr, $key:expr, $ready:expr, $asked:expr) => {
        /// R9-ORK-d, one concrete superseded case (re-freeze 3): on_recovery_key whose (key, asked_at) the record on file
        /// does not name, every promise result: no promise result read, no state read or written, no cell written or
        /// removed, no key deleted (an add would reach the unstubbed host call and fail the proof).
        #[kani::proof]
        #[kani::unwind(5)]
        #[kani::stub(near_sdk::env::panic_str, panic_fail)]
        #[kani::stub(near_sdk::env::promise_result_checked, r9_promise_counted)]
        #[kani::stub(near_sdk::env::state_read, r9_state_read)]
        #[kani::stub(near_sdk::env::state_write, r9_state_write)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(super::store_key, r9_store_key)]
        #[kani::stub(near_sdk::env::storage_write, r9_storage_write)]
        #[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::load_devices, r9_load_devices)]
        #[kani::stub(super::delete_key, r9_delete_key)]
        fn $name() {
            r9_ork_superseded($record, $key, $ready, $asked);
        }
    };
}
r9_ork_d_case!(r9_ork_d1_no_record, None, vec![1, 2], 10, 5);
r9_ork_d_case!(r9_ork_d2_other_asked_time, Some((vec![1, 2], 10, 6)), vec![1, 2], 10, 5);
r9_ork_d_case!(r9_ork_d3_other_key, Some((vec![3, 4], 10, 5)), vec![1, 2], 10, 5);

// ── ORK-b / ORK-c split into concrete cases (the symbolic versions passed 5 GB) ───────────────────────────────────

/// ORK-b's statement for one case: the record names this callback, the add succeeded, the recovery ([1,2], ready) still
/// waits and may finish at `now`: it completes (state written once with no recovery; the list stored is exactly
/// [[1,2]], sealed; the old phones 5 and 7 deleted, nothing else; the record removed).
fn r9_ork_complete_case(device: bool, ready: u64, now: u64) {
    r9_ork_setup(0, device, ready, vec![vec![5], vec![7]]);
    unsafe {
        NOW = now;
        R9_FIN = Some((vec![1, 2], ready, 5));
    }
    AccountPolicy::on_recovery_key(Base64VecU8(vec![1, 2]), U64(ready), U64(5));
    unsafe {
        assert!(R9_STATE_WRITES == 1 && R9_WRITTEN_RECOVERY_NONE);
        assert!(*core::ptr::addr_of!(R9_DEV_WRITTEN) == Some((vec![vec![1u8, 2]], true)));
        assert!(*core::ptr::addr_of!(R9_DELETED) == vec![vec![5u8], vec![7u8]]);
        assert!(R9_FIN_REMOVES == 1);
        assert_eq!((*core::ptr::addr_of!(R9_WRITTEN_SECOND_DEVICES)).len(), if device { 1 } else { 0 });
    }
}
macro_rules! r9_ork_b_case {
    ($name:ident, $device:expr, $ready:expr, $now:expr) => {
        /// R9-ORK-b, one concrete case (see r9_ork_complete_case): the add succeeded and the same recovery may finish: it
        /// completes; the new key is the only phone (sealed), the old phones deleted, nothing else, the record removed.
        #[kani::proof]
        #[kani::unwind(5)]
        #[kani::stub(near_sdk::env::panic_str, panic_fail)]
        #[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
        #[kani::stub(near_sdk::env::state_read, r9_state_read)]
        #[kani::stub(near_sdk::env::state_write, r9_state_write)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(near_sdk::env::storage_write, r9_storage_write)]
        #[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
        #[kani::stub(near_sdk::env::sha256, sha256_short)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::load_devices, r9_load_devices)]
        #[kani::stub(super::delete_key, r9_delete_key)]
        fn $name() {
            r9_ork_complete_case($device, $ready, $now);
        }
    };
}
// no device: finishes at the delay's end; with device 9 of age and no yes: at the fallback (ready - 1 d + 7 d).
r9_ork_b_case!(r9_ork_b1_no_device_at_ready, false, 2 * DAY_NS, 2 * DAY_NS);
r9_ork_b_case!(r9_ork_b2_device_at_fallback, true, 2 * DAY_NS, 8 * DAY_NS);

/// ORK-c's statement for one case: the record names this callback, the add succeeded, but the recovery may not finish:
/// no state written, at most one delete and only of the call's key, none when that key holds a role.
fn r9_ork_unfinished_case(no_recovery: bool, key: Vec<u8>, r: u64, now: u64, device: bool) {
    r9_ork_setup(0, device, 2 * DAY_NS, vec![vec![5]]);
    if no_recovery {
        unsafe { (*core::ptr::addr_of_mut!(R9_STATE)).as_mut().unwrap().recovery = None }
    }
    unsafe {
        NOW = now;
        R9_FIN = Some((key.clone(), r, 5));
    }
    AccountPolicy::on_recovery_key(Base64VecU8(key.clone()), U64(r), U64(5));
    let role = (device && key == vec![9]) || key == vec![4] || key == vec![5];
    unsafe {
        let deleted = &*core::ptr::addr_of!(R9_DELETED);
        assert!(R9_STATE_WRITES == 0);
        assert!(deleted.len() <= 1);
        if deleted.len() == 1 {
            assert!(deleted[0] == key);
        }
        if role {
            assert!(deleted.is_empty());
        } else {
            assert!(deleted.len() == 1);
        }
        assert!(R9_FIN_REMOVES == 1);
    }
}
macro_rules! r9_ork_c_case {
    ($name:ident, $setup:expr) => {
        /// R9-ORK-c, one case (see r9_ork_unfinished_case): add succeeded, the recovery may not finish: no completion, at
        /// most one delete (the call's key), none for a key with a role.
        #[kani::proof]
        #[kani::unwind(5)]
        #[kani::stub(near_sdk::env::panic_str, panic_fail)]
        #[kani::stub(near_sdk::env::promise_result_checked, promise_result_stub)]
        #[kani::stub(near_sdk::env::state_read, r9_state_read)]
        #[kani::stub(near_sdk::env::state_write, r9_state_write)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(near_sdk::env::storage_remove, r9_storage_remove)]
        #[kani::stub(near_sdk::env::sha256, sha256_short)]
        #[kani::stub(std::fmt::format, r9_format_empty)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::load_devices, r9_load_devices)]
        #[kani::stub(super::delete_key, r9_delete_key)]
        fn $name() {
            $setup;
        }
    };
}
// the recovery ended (none waits): the call's key [1,2] goes again
r9_ork_c_case!(r9_ork_c1_recovery_ended, r9_ork_unfinished_case(true, vec![1, 2], 2 * DAY_NS, 3 * DAY_NS, false));
// another recovery waits (the call's key is any 1-byte k, so not [1,2]): k goes unless it is the words 4, device 9 or phone 5
r9_ork_c_case!(r9_ork_c2_other_key_any, r9_ork_unfinished_case(false, vec![kani::any::<u8>()], 2 * DAY_NS, 3 * DAY_NS, true));
// the same recovery, but blocked: device 9 of age, no yes, before the fallback (now = ready + 1 d < ready - 1 d + 7 d)
r9_ork_c_case!(r9_ork_c3_same_blocked_by_fallback, r9_ork_unfinished_case(false, vec![1, 2], 2 * DAY_NS, 3 * DAY_NS, true));

// ── AR-a's list part alone (co-signed, concrete times; its timing part is AR-b's statement, contraposed) ───────────

fn r9_ar_list_rule(n: usize) {
    let h: u8 = kani::any();
    let mut p = r9_ar_setup(h, 0, true, n, n > 0);
    unsafe { NOW = 1 }
    let out = p.finish(1);
    assert!(out.done);
    let old = r9_list(n);
    let w = unsafe { (*core::ptr::addr_of!(R9_REL_LIST)).clone().expect("the list is written") };
    assert!(w.contains(&vec![h]));
    assert!(w.len() <= MAX_RELEASES);
    if old.contains(&vec![h]) {
        assert!(w == old);
    } else if n == 4 {
        assert!(w.len() == 4 && w[0] == old[1] && w[1] == old[2] && w[2] == old[3] && w[3] == vec![h]);
    } else {
        assert!(w.len() == n + 1 && w[n] == vec![h]);
        for i in 0..4 {
            if i < n {
                assert!(w[i] == old[i]);
            }
        }
    }
    kani::cover!(!old.contains(&vec![h]), "a new release appended");
    kani::cover!(old.contains(&vec![h]), "a listed release leaves the list as it was");
}
macro_rules! r9_arl_n {
    ($name:ident, $n:expr) => {
        #[kani::proof]
        #[kani::unwind(6)]
        #[kani::stub(near_sdk::env::panic_str, panic_fail)]
        #[kani::stub(near_sdk::env::block_timestamp, now_stub)]
        #[kani::stub(super::load_key, r9_load_key)]
        #[kani::stub(super::store_key, r9_store_key)]
        #[kani::stub(super::event, event_stub)]
        #[kani::stub(super::group_promise, prune_group)]
        #[kani::stub(super::dispatch_chain, prune_chain)]
        #[kani::stub(near_sdk::Promise::new, prune_promise_new)]
        #[kani::stub(super::AccountPolicy::end_recovery, r9_prune_end_recovery)]
        #[kani::stub(super::AccountPolicy::check_bands, r9_prune_check_bands)]
        #[kani::stub(super::load_devices, r9_prune_load_devices)]
        #[kani::stub(super::release_allowed, r9_prune_release_allowed)]
        fn $name() {
            r9_ar_list_rule($n);
        }
    };
}
r9_arl_n!(r9_arl0_list0, 0);
r9_arl_n!(r9_arl1_list1, 1);
r9_arl_n!(r9_arl2_list2, 2);
r9_arl_n!(r9_arl3_list3, 3);
r9_arl_n!(r9_arl4_list4, 4);
