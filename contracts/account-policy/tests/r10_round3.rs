//! Release 10, the 4 Nov internal proofing (round 3): one regression test per MUST QA's round 3 sent, named
//! after its ID, each with its control. Each failed on round 2's target (360b8075c) and passes on its fix.
//! Release-like: `cargo test --no-default-features --features agent,short-waits --test r10_round3`.
#![cfg(all(feature = "agent", not(feature = "modules")))]
#![allow(unused_imports, dead_code)]
mod common;
use account_policy::{AccountPolicy, Band, Change, Group, Level, Outcome, Pending, PendingRecovery, Step};
use agent_limits::{Budget, CoinLimit};
use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{env, testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const THIEF_WORDS: u8 = 0xE0;
const LAPTOP: u8 = 0x09;
const THIEF_LAPTOP: u8 = 0x7A;
const NEW_PHONE: u8 = 0x11;
const AGENT: u8 = 0xA6;
/// A day's delay: the floor is 2 days, the fallback 7.
const FLOOR: u64 = 2 * DAY;
const FALLBACK: u64 = 7 * DAY;
/// After the account's first 24 hours (its set-up window).
const ASK: u64 = DAY + 100;
/// The laptop (added at 2 in the set-up window) is of age from 2 + FLOOR: a moment it is.
const VT: u64 = 3 * DAY;
const INSTALLED: &[u8] = b"installed";
const SAID_NO: &str = "Your laptop said no";
const PAUSED: &str = "paused spending";

fn me() -> AccountId {
    "me.near".parse().unwrap()
}
fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn key(fill: u8) -> Base64VecU8 {
    let mut k = vec![2u8];
    k.extend(std::iter::repeat(fill).take(1952));
    Base64VecU8(k)
}
fn as_key(fill: u8, now_s: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(fill).0).unwrap())
        .block_timestamp(now_s * SECOND)
        .account_balance(NearToken::from_near(1_000_000))
        .build());
}
fn refused_with<R>(f: impl FnOnce() -> R) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(_) => String::new(),
        Err(e) => e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_else(|| "refused".into()),
    }
}
/// A copy of the state (a refused call in the mock leaves the struct half changed; NEAR would roll it back).
fn copy_of(p: &AccountPolicy) -> AccountPolicy {
    borsh::from_slice(&borsh::to_vec(p).unwrap()).unwrap()
}
fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}
fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}
fn call(method: &str, args: &str, deposit: u128, gas: u64) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(gas) }
}
fn ready_of(p: &AccountPolicy, id: U64) -> u64 {
    p.waiting_requests().into_iter().find(|w| w.id == id).unwrap().ready_at_ns.0 / SECOND
}
fn one_band() -> Vec<Band> {
    vec![Band { up_to: None, level: Level::FaceId }]
}
fn bands(last: Level) -> Vec<Band> {
    vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: last }]
}
fn budget(per_day: u128) -> Budget {
    Budget { coins: vec![CoinLimit { coin: "near".into(), per_day: U128(per_day), per_month: U128(30 * per_day), convert_per_day: U128(per_day) }], recipients: vec![], ends_at_ns: U64(400 * DAY * SECOND), max_spends_per_day: 12 }
}

/// A `delay`-second account: the phone named, the words set at 1, the owner's laptop at 2 and the bands `then` at 3
/// (all in the set-up window, at once): the laptop is of age from 2 + its floor.
fn account_of(delay: u64, then: Vec<Band>) -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(delay), bands(Level::FaceId), Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 2);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 3);
    assert!(p.set_protection(then).done, "a set-up step in the set-up window");
    p
}
/// The app's default bands on a 1-day account: Face ID up to 1 NEAR a day, a day's wait above.
fn account() -> AccountPolicy {
    account_of(DAY, bands(Level::Wait { seconds: U64(DAY) }))
}
/// The phone asks a change alone at `t` and the laptop of age says no at `t + 1`: a dispute until `t + 1 + FLOOR`.
fn open_dispute(p: &mut AccountPolicy, t: u64) {
    as_key(PHONE, t);
    let asked = p.set_protection(one_band());
    assert!(!asked.done);
    as_key(LAPTOP, t + 1);
    p.decline(asked.id.unwrap());
    assert!(p.dispute_until().is_some());
}

/// The contract's state as borsh lays it out (`AccountPolicy`'s fields in order), so a test can set a waiting request
/// as an earlier release placed it.
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Spent {
    at_ns: u64,
    id: u64,
    coin: String,
    amount: u128,
}
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct Layout {
    recovery_delay_ns: u64,
    recovery: Option<PendingRecovery>,
    recovery_key: Option<Vec<u8>>,
    second_devices: Vec<Vec<u8>>,
    bands: Vec<Band>,
    pending: Vec<Pending>,
    spent: Vec<Spent>,
    next_id: u64,
}
/// The same account with waiting request `id` ready at `ready_s` (as release 9 placed it).
fn with_ready(p: &AccountPolicy, id: U64, ready_s: u64) -> AccountPolicy {
    let mut l: Layout = borsh::from_slice(&borsh::to_vec(p).unwrap()).unwrap();
    l.pending.iter_mut().find(|q| q.id == id).unwrap().ready_at_ns = U64(ready_s * SECOND);
    let p: AccountPolicy = borsh::from_slice(&borsh::to_vec(&l).unwrap()).unwrap();
    env::state_write(&p);
    p
}
/// As on release 9: no record of when a removal or a request that needs the laptop was asked, no install marker.
fn as_on_release_9() {
    env::storage_remove(b"removal_asked");
    env::storage_remove(b"device_asked");
    env::storage_remove(INSTALLED);
}
fn device_asked() -> Vec<(u64, u64)> {
    env::storage_read(b"device_asked").map(|b| borsh::from_slice(&b).unwrap()).unwrap_or_default()
}

// ── FB3-1: during a dispute, the first words are the phone's ask alone like any other ───────────────────────────────

/// The round's finding: `first_words()` gave the account's first words Face ID and no floor even during a dispute, so
/// whoever held the phone set words of their own at once while the laptop's no held every other ask. Now, during a
/// dispute, they are not the first words: refused like any change the phone asks alone. Control: outside a dispute,
/// they still go at once.
#[test]
fn r10_round3_fb3_1_first_words_wait_out_a_dispute() {
    let no_words = || {
        reset();
        as_key(SETUP, 0);
        let mut p = AccountPolicy::new(U64(DAY), bands(Level::FaceId), Some(key(PHONE)), None);
        as_key(PHONE, 2);
        assert!(p.add_second_device(key(LAPTOP)).done);
        as_key(PHONE, 3);
        assert!(p.set_protection(bands(Level::Wait { seconds: U64(DAY) })).done);
        p
    };
    let mut p = no_words();
    open_dispute(&mut p, VT);
    as_key(PHONE, VT + 2);
    let why = refused_with(|| copy_of(&p).set_recovery_key(key(THIEF_WORDS)));
    assert!(why.contains(SAID_NO), "FB3-1: the phone alone set the first words during a dispute: {why:?}");
    // At the dispute's end, the first words go at once again.
    as_key(PHONE, VT + 1 + FLOOR);
    assert!(p.dispute_until().is_none());
    assert!(p.set_recovery_key(key(WORDS)).done);
    // Control: outside a dispute, the first words go at once.
    let mut q = no_words();
    as_key(PHONE, VT);
    assert!(q.set_recovery_key(key(WORDS)).done, "control: first words, no dispute");
}

// ── FB3-2 / X3-3: Agent's key is not refilled during a dispute ────────────────────────────────────────────────────

/// The round's finding: `agent_renew_key` checked the Face ID band and the freeze but not the laptop's pause, so the
/// phone kept refilling Agent's key (0.25 NEAR it may burn) while every other Face ID payment was paused. Control: not
/// paused, it renews.
#[test]
fn r10_round3_fb3_2_agents_key_is_not_renewed_while_paused() {
    let mut p = account();
    as_key(PHONE, ASK);
    let set = p.agent_set(key(AGENT), budget(MILLI), None);
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(set.id.unwrap()).done);
    let t = ASK + FLOOR + 10;
    as_key(PHONE, t);
    let mut control = copy_of(&p);
    control.agent_renew_key();
    open_dispute(&mut p, t);
    as_key(PHONE, t + 2);
    let why = refused_with(|| copy_of(&p).agent_renew_key());
    assert!(why.contains(PAUSED), "FB3-2: Agent's key renewed during a dispute: {why:?}");
    as_key(PHONE, t + 1 + FLOOR);
    p.agent_renew_key();
}

// ── X3-1: new words asked with the laptop's removal wait a floor after it ─────────────────────────────────────────

/// The round's finding (an E1 regression): E1 re-levelled every request that waited for the laptop's yes to its ask plus
/// a floor, so new words asked together with the laptop's removal ran WITH the removal, 7 days on the app's 48-hour
/// account, while the header says a thief needs at least 10. The ruling: when the last device goes, a setting waits
/// max(ready, now + floor); a payment keeps max(ready, ask + floor). Control: the payment asked with them runs with the
/// removal.
#[test]
fn r10_round3_x3_1_words_asked_with_the_laptops_removal_wait_a_floor_after_it() {
    let delay = 2 * DAY;
    let floor = 3 * DAY;
    let mut p = account_of(delay, bands(Level::Device));
    let t0 = 10 * DAY;
    as_key(PHONE, t0);
    let words = p.set_recovery_key(key(THIEF_WORDS));
    assert!(!words.done && words.needs_device);
    let pay = p.execute(acct("bob.near"), send(10 * NEAR), None);
    assert!(!pay.done && pay.needs_device);
    let rm = p.remove_key(key(LAPTOP));
    let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
    assert_eq!(removal_at, t0 + 7 * DAY, "the laptop goes at 7 days");
    as_key(PHONE, removal_at);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(ready_of(&p, words.id.unwrap()), t0 + 10 * DAY, "X3-1: new words ran with the laptop's removal, not a floor after it");
    assert!(!refused_with(|| copy_of(&p).run(words.id.unwrap())).is_empty());
    as_key(PHONE, removal_at + floor - 1);
    assert!(!refused_with(|| copy_of(&p).run(words.id.unwrap())).is_empty());
    // Control: the payment keeps a floor from its ask, and runs with the removal.
    as_key(PHONE, removal_at);
    assert_eq!(ready_of(&p, pay.id.unwrap()), t0 + floor);
    assert!(p.run(pay.id.unwrap()).done);
    as_key(PHONE, t0 + 10 * DAY);
    assert!(p.run(words.id.unwrap()).done);
}

// ── X3-2: a request asked on release 9 waits a floor from its ask when the laptop goes ─────────────────────────────

/// The round's finding: a request that needed the laptop's yes, asked on release 9 (or round 1's build), has no record
/// of its ask, so E1 took now (the removal) as its ask: a floor after the removal, 62 days on a 30-day account. Now
/// `upgrade_check` (from a build before 10_002) records an ask for each: ready - floor for a setting, min(the upgrade,
/// ready) for a payment, each no earlier than the true ask. Control: the same account on this build from the start.
#[test]
fn r10_round3_x3_2_a_request_asked_on_release_9_waits_a_floor_from_its_ask() {
    let month = 30 * DAY;
    let floor = month + DAY;
    for on_release_9 in [true, false] {
        let mut p = account_of(month, bands(Level::Both { seconds: U64(floor) }));
        let t0 = 60 * DAY;
        as_key(PHONE, t0);
        let pay = p.execute(acct("bob.near"), send(10 * NEAR), None);
        assert!(!pay.done && pay.needs_device);
        let set = p.set_protection(bands(Level::Both { seconds: U64(floor) }));
        assert!(set.needs_device);
        let rm = p.remove_key(key(LAPTOP));
        let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
        assert_eq!(removal_at, t0 + floor);
        let upgraded = t0 + 1;
        if on_release_9 {
            as_on_release_9();
            as_key(PHONE, upgraded);
            p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
            let asked = device_asked();
            let at = |id: U64| asked.iter().find(|(i, _)| *i == id.0).map(|(_, a)| *a / SECOND);
            assert_eq!(at(pay.id.unwrap()), Some(upgraded), "X3-2: a payment: min(the upgrade, ready)");
            assert_eq!(at(set.id.unwrap()), Some(t0), "X3-2: a setting: ready - floor");
        }
        as_key(PHONE, removal_at);
        assert!(p.run(rm.id.unwrap()).done);
        let runs = ready_of(&p, pay.id.unwrap());
        let ask = if on_release_9 { upgraded } else { t0 };
        assert_eq!(runs, ask + floor, "X3-2 (release 9: {on_release_9}): the payment waits {} d from its ask", (runs - t0) / DAY);
        as_key(PHONE, runs);
        assert!(p.run(pay.id.unwrap()).done);
    }
}

// ── B3-1: a young device's removal asked on release 9 runs when V1 says, not later ─────────────────────────────────

/// The round's finding (T2 incomplete): release 9 placed a young device's removal at max(band's wait, floor); T2
/// recorded its ask as ready - floor, so with a band's wait over the floor it ran up to 13 days late (28 days, not 21,
/// on a 7-day account). Now: ready - max(floor, the strictest band's wait). Control: a band's wait under the floor
/// records the same as before, and V1 still holds the removal the fallback from its ask.
#[test]
fn r10_round3_b3_1_a_young_devices_removal_from_release_9_runs_on_time() {
    let week = 7 * DAY;
    let (floor, fallback) = (8 * DAY, 21 * DAY);
    for wait in [15 * DAY, DAY] {
        let mut p = account_of(week, bands(Level::Wait { seconds: U64(wait) }));
        let ask = 20;
        as_key(PHONE, ask);
        assert_eq!(p.second_devices_of_age(), 0, "the laptop is young");
        let rm = p.remove_key(key(LAPTOP));
        let id = rm.id.unwrap();
        // As release 9 placed it: max(band's wait, floor) from its ask, no fallback for a young device.
        let mut p = with_ready(&p, id, ask + wait.max(floor));
        as_on_release_9();
        as_key(PHONE, ask + 1);
        p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
        assert_eq!(ready_of(&p, id), ask + fallback, "B3-1 ({} d band): V1's fallback from its ask, no later", wait / DAY);
        as_key(PHONE, ask + fallback - 1);
        assert!(!refused_with(|| copy_of(&p).run(id)).is_empty(), "never sooner than the fallback from its ask");
        as_key(PHONE, ask + fallback);
        assert!(p.run(id).done);
        assert_eq!(p.second_device_count(), 0);
    }
}

// ── B3-2: the previews refuse a full queue as `place` does ─────────────────────────────────────────────────────────

/// The round's finding (what was left of M-I1): `level_for` and `level_for_many` answered a waiting level for a payment
/// `place` refuses (20 waiting, or 64 KB waiting). Now they refuse it in the same words when the level isn't Face ID.
/// Control: one place short, they answer; a Face ID payment still previews with the queue full.
#[test]
fn r10_round3_b3_2_the_previews_refuse_a_full_queue() {
    let mut p = account();
    as_key(PHONE, ASK);
    // A call the contract can't measure waits in the strictest band; its gas counts 0.01 NEAR, so Face ID stays open.
    let small = vec![call("do_it", "{}", 0, 10_000_000_000_000)];
    let many = |s: Vec<Step>| vec![Group { receiver_id: acct("app.near"), steps: s }];
    for _ in 0..19 {
        assert!(!p.execute(acct("app.near"), small.clone(), None).done);
    }
    assert_eq!(p.level_for(acct("app.near"), small.clone(), None), Level::Wait { seconds: U64(DAY) }, "control: one place left");
    assert_eq!(p.level_for_many(many(small.clone())), Level::Wait { seconds: U64(DAY) });
    assert!(!p.execute(acct("app.near"), small.clone(), None).done);
    let by_execute = refused_with(|| copy_of(&p).execute(acct("app.near"), small.clone(), None));
    assert!(by_execute.contains("too many requests"));
    assert_eq!(refused_with(|| p.level_for(acct("app.near"), small.clone(), None)), by_execute, "B3-2: level_for answered for a 21st");
    assert_eq!(refused_with(|| p.level_for_many(many(small.clone()))), refused_with(|| copy_of(&p).execute_many(many(small.clone()))), "B3-2: level_for_many answered for a 21st");
    // Control: Face ID runs at once, so a full queue doesn't hold it.
    assert_eq!(p.level_for(acct("bob.near"), send(MILLI), None), Level::FaceId);
    assert_eq!(p.level_for_many(vec![Group { receiver_id: acct("bob.near"), steps: send(MILLI) }]), Level::FaceId);
    assert!(copy_of(&p).execute(acct("bob.near"), send(MILLI), None).done);
    // 64 KB waiting.
    let mut p = account();
    as_key(PHONE, ASK);
    let heavy = vec![call("do_it", &format!("{{\"x\":\"{}\"}}", "a".repeat(4000)), 0, 10_000_000_000_000)];
    let mut placed = 0;
    while refused_with(|| copy_of(&p).execute(acct("app.near"), heavy.clone(), None)).is_empty() {
        assert!(!p.execute(acct("app.near"), heavy.clone(), None).done);
        placed += 1;
    }
    assert!(placed < 20, "the bytes, not the count");
    let by_execute = refused_with(|| copy_of(&p).execute(acct("app.near"), heavy.clone(), None));
    assert!(by_execute.contains("too much is waiting"));
    assert_eq!(refused_with(|| p.level_for(acct("app.near"), heavy.clone(), None)), by_execute, "B3-2: level_for answered past 64 KB");
    let g = vec![Group { receiver_id: acct("app.near"), steps: heavy.clone() }];
    assert_eq!(refused_with(|| p.level_for_many(g.clone())), refused_with(|| copy_of(&p).execute_many(g.clone())), "B3-2: level_for_many answered past 64 KB");
}

// ── V3-2 (the twin of G2): new words that end a recovery freeze unless a device on for the fallback co-signed ─────

/// The round's finding: a laptop the thief added (with the phone; on a phone-only account nobody vetoes the add), of
/// age but not on the account for the fallback, co-signs the thief's new words. They survive the owner's later recovery
/// start (co-signed), run during it, and end it with no freeze (end_recovery(false)): the thief holds the words and
/// keeps spending. Now, as for the phone's stop (G2), no freeze follows only when the yes came from a device on the
/// account for the fallback. Control: the owner's laptop, on for the fallback, co-signs: the recovery ends cleanly.
#[test]
fn r10_round3_v3_2_words_co_signed_by_a_young_laptop_end_a_recovery_with_a_freeze() {
    // A phone-only account: the phone named, the words set, the app's bands.
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(DAY), bands(Level::Wait { seconds: U64(DAY) }), Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    let t1 = ASK;
    as_key(PHONE, t1);
    let add = p.add_second_device(key(THIEF_LAPTOP));
    assert!(!add.done);
    as_key(PHONE, t1 + FLOOR);
    assert!(p.run(add.id.unwrap()).done);
    let t2 = t1 + 2 * FLOOR + 1;
    as_key(PHONE, t2);
    assert_eq!(p.second_devices_of_age(), 1, "of age, not on for the fallback");
    let words = p.set_recovery_key(key(THIEF_WORDS));
    as_key(THIEF_LAPTOP, t2 + 1);
    assert!(!p.approve(words.id.unwrap()).done);
    as_key(WORDS, t2 + 2);
    p.start_recovery(key(NEW_PHONE));
    assert_eq!(p.waiting_requests().len(), 1, "the co-signed words survive the start");
    as_key(PHONE, t2 + FLOOR);
    assert!(p.run(words.id.unwrap()).done);
    assert!(p.pending().is_none(), "the new words end the recovery");
    assert!(p.frozen_until().is_some(), "V3-2: a laptop only of age co-signed the words that ended the recovery, and no freeze followed");
    assert!(!copy_of(&p).execute(acct("bob.near"), send(MILLI), None).done, "Face ID spending waits: frozen");
    // Control: the owner's laptop, on for the fallback, co-signs: the recovery ends with no freeze.
    let mut o = account();
    let t = 3 + FALLBACK;
    as_key(PHONE, t);
    let words = o.set_recovery_key(key(THIEF_WORDS));
    as_key(LAPTOP, t + 1);
    assert!(!o.approve(words.id.unwrap()).done);
    as_key(WORDS, t + 2);
    o.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + FLOOR);
    assert!(o.run(words.id.unwrap()).done);
    assert!(o.pending().is_none() && o.frozen_until().is_none(), "control: two of three, no freeze");
}

// ── Copy (a): during a dispute, a payment in a waiting band is helped only by the words or the window's end ────────

/// The round's copy item: the dispute's line said "Ask with your laptop", but `approve` refuses a payment that doesn't
/// need the laptop, and a change the phone asks alone is refused before anything waits for a yes. The line names only
/// what helps: the backup words, or the window's end; also once the laptop that said no is gone. Control: a payment that
/// needs the laptop is still asked.
#[test]
fn r10_round3_copy_a_the_dispute_line_names_only_what_helps() {
    let mut p = account();
    open_dispute(&mut p, VT);
    as_key(PHONE, VT + 2);
    for why in [
        refused_with(|| copy_of(&p).execute(acct("bob.near"), send(5 * NEAR), None)),
        refused_with(|| p.level_for(acct("bob.near"), send(5 * NEAR), None)),
        refused_with(|| copy_of(&p).set_protection(one_band())),
    ] {
        assert!(why.starts_with(SAID_NO) && why.contains("backup words"), "{why:?}");
        assert!(!why.contains("Ask with your laptop"), "copy (a): the laptop can't help: {why:?}");
    }
    // The laptop that said no has since been removed: the line still names only the words or the window's end.
    let mut r = account();
    let t0 = VT;
    as_key(PHONE, t0);
    let rm = r.remove_key(key(LAPTOP));
    open_dispute(&mut r, t0 + FALLBACK - 2);
    as_key(PHONE, t0 + FALLBACK);
    assert!(r.run(rm.id.unwrap()).done);
    assert_eq!(r.second_device_count(), 0);
    let why = refused_with(|| copy_of(&r).execute(acct("bob.near"), send(5 * NEAR), None));
    assert!(why.starts_with(SAID_NO) && why.contains("backup words") && !why.contains("Ask with your laptop"), "copy: the laptop is gone: {why:?}");
    // Control: where the laptop's yes is needed, the phone still asks.
    let mut q = account_of(DAY, bands(Level::Device));
    open_dispute(&mut q, VT);
    as_key(PHONE, VT + 2);
    let pay = q.execute(acct("bob.near"), send(5 * NEAR), None);
    assert!(!pay.done && pay.needs_device);
}

// ── A3-I1: the phone's own cancel of its stop gives the stop back ───────────────────────────────────────────────

/// The round's finding: the phone cancelling its own stop of a recovery (`cancel`) left the stop marker, so it had no
/// second stop and was told "your second device already refused a stop", which it hadn't. Now the phone's cancel of
/// its stop clears the marker. Control: a stop the laptop turned down still leaves the phone no second one (R7-2).
#[test]
/// Round 4 (C4-1) reversed A3-I1's clear: the phone's cancel of its own stop keeps the marker (one stop per recovery),
/// and round 4b's words fit both: "You already asked one stop for this recovery."
fn r10_round3_a3_i1_the_phones_cancel_of_its_stop_gives_it_back() {
    let scene = || {
        let mut p = account();
        let t = VT;
        as_key(WORDS, t);
        p.start_recovery(key(NEW_PHONE));
        as_key(PHONE, t + 1);
        let stop = p.cancel_recovery();
        assert!(!stop.done && stop.id.is_some());
        (p, stop.id.unwrap())
    };
    let (mut p, stop) = scene();
    as_key(PHONE, VT + 2);
    p.cancel(stop);
    assert!(p.recovery_status().unwrap().stop_asked, "C4-1: the stop stays asked after the phone cancels it");
    assert!(!refused_with(|| copy_of(&p).cancel_recovery()).is_empty(), "C4-1: no second stop after the phone cancelled its own");
    // Control: the laptop turned the stop down: no second stop.
    let (mut q, stop) = scene();
    as_key(LAPTOP, VT + 2);
    q.decline(stop);
    as_key(PHONE, VT + 3);
    assert!(refused_with(|| copy_of(&q).cancel_recovery()).contains("already asked one stop"));
}

// ── Round 4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/// C4-L1: a no to a request already gone, while the phone has another waiting alone, is a no: every phone-alone request
/// goes and the dispute opens. Controls: nothing waiting alone, or a laptop not of age: refused, nothing paused.
#[test]
fn r10_round4_c4_l1_a_no_to_a_gone_request_is_still_a_no() {
    let scene = || {
        let mut p = account();
        as_key(PHONE, VT);
        let gone = p.set_protection(one_band());
        let other = p.set_protection(bands(Level::Wait { seconds: U64(2 * DAY) }));
        assert!(!gone.done && !other.done);
        as_key(PHONE, VT + 1);
        p.cancel(gone.id.unwrap());
        (p, gone.id.unwrap())
    };
    let (mut p, gone) = scene();
    as_key(LAPTOP, VT + 2);
    p.decline(gone);
    assert!(p.waiting_requests().is_empty(), "C4-L1: the other phone-alone request goes too");
    assert!(p.dispute_until().is_some(), "C4-L1: the dispute opens");
    // Control: nothing else waiting alone: refused, no dispute (a laptop can't pause the account on its own).
    let mut q = account();
    as_key(PHONE, VT);
    let only = q.set_protection(one_band());
    as_key(PHONE, VT + 1);
    q.cancel(only.id.unwrap());
    as_key(LAPTOP, VT + 2);
    assert!(refused_with(|| copy_of(&q).decline(only.id.unwrap())).contains("no such waiting request"));
    assert!(q.dispute_until().is_none());
    // Control: a laptop not yet of age can't turn down what is gone.
    let (mut r, gone) = scene();
    as_key(PHONE, VT + 1);
    let young = key(0x0C);
    as_key(PHONE, VT + 1);
    let _ = r.add_second_device(young);
    as_key(0x0C, VT + 2);
    assert!(!refused_with(|| copy_of(&r).decline(gone)).is_empty(), "a young device or an unknown key is refused");
}

/// A 7-day account with the laptop of age, its removal asked; then the state as main's release-10 build (530846…) left
/// it: no removal record, no install marker (K1 came later).
fn d4_removal(delay: u64) -> (AccountPolicy, U64, u64, u64) {
    let mut p = account_of(delay, bands(Level::Wait { seconds: U64(DAY) }));
    let floor = delay + delay.min(DAY);
    let ask = 2 + floor;
    as_key(PHONE, ask);
    let rm = p.remove_key(key(LAPTOP));
    let ready = rm.ready_at_ns.unwrap().0 / SECOND;
    env::storage_remove(b"removal_asked");
    env::storage_remove(INSTALLED);
    (p, rm.id.unwrap(), ask, ready)
}

/// D4-1a: upgrade_check(from_version 10, no marker) stamps the removal, so it runs at its ask + max(fallback, floor):
/// 21 days on the 7-day account. Control: from_version 9 (as before).
#[test]
fn r10_round4_d4_1a_main_s_release_10_build_gets_its_removals_stamped() {
    for from in [10u32, 9] {
        let (p, id, ask, ready) = d4_removal(7 * DAY);
        assert_eq!(ready - ask, 21 * DAY, "the fallback, 3 x 7 days");
        as_key(PHONE, ask + 1);
        p.upgrade_check(from, None);
        as_key(PHONE, ready);
        let why = refused_with(|| copy_of(&p).run(id));
        assert!(why.is_empty(), "from {from}: runs at ask + 21 days, as it said: {why:?}");
    }
}

/// D4-1b: the same upgrade renews the words' key with end_dispute. Controls: marker 10 (round 1's) renews too; marker
/// 10_002 (round 2's, whose words already had it) doesn't.
#[test]
fn r10_round4_d4_1b_main_s_release_10_build_gets_end_dispute_on_its_words() {
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    let words_renewed = |marker: Option<u32>| {
        let p = account();
        env::storage_remove(INSTALLED);
        if let Some(m) = marker {
            env::storage_write(INSTALLED, &borsh::to_vec(&m).unwrap());
        }
        let _ = get_created_receipts();
        as_key(PHONE, VT);
        p.upgrade_check(10, None);
        get_created_receipts().into_iter().flat_map(|r| r.actions).any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } if borsh::to_vec(&public_key).unwrap() == key(WORDS).0 && method_names.iter().any(|m| m == "end_dispute")))
    };
    assert!(words_renewed(None), "D4-1b: main's build (no marker) renews the words with end_dispute");
    assert!(words_renewed(Some(10)), "control: round 1's marker 10");
    // Round 4c (S1-1): every install renews the words, whatever the marker (it says which build ran last, not which
    // repairs the account has had).
    assert!(words_renewed(Some(10_002)), "S1-1: round 2's marker too");
    assert!(words_renewed(Some(10_003)), "S1-1: round 4's marker too");
}

// ── Round 4b ────────────────────────────────────────────────────────────────────────────────────────────────────────

/// R2-1: upgrade_check(10) from main's unmarked release-10 build renews the laptop's key with this release's methods
/// (approve_recovery, refuse_recovery, refill_recovery_key), as from release 9. Round 4c (S1-1): from round 4's build
/// (marker 10_003) too, as on every install.
#[test]
fn r10_round4b_r2_1_main_s_release_10_build_renews_the_laptop() {
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    let renewed = |marker: Option<u32>| {
        let p = account();
        env::storage_remove(INSTALLED);
        if let Some(m) = marker {
            env::storage_write(INSTALLED, &borsh::to_vec(&m).unwrap());
        }
        let _ = get_created_receipts();
        as_key(PHONE, VT);
        p.upgrade_check(10, None);
        get_created_receipts().into_iter().flat_map(|r| r.actions).collect::<Vec<_>>()
    };
    let laptop = |acts: &[MockAction]| {
        acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } if borsh::to_vec(public_key).unwrap() == key(LAPTOP).0 && ["approve_recovery", "refuse_recovery", "refill_recovery_key"].iter().all(|m| method_names.iter().any(|n| n == m))))
    };
    assert!(laptop(&renewed(None)), "R2-1: main's build (no marker) renews the laptop");
    assert!(laptop(&renewed(Some(10_003))), "S1-1: round 4's marker renews the laptop too");
}

// ── Round 4c ────────────────────────────────────────────────────────────────────────────────────────────────────────

/// S1-1: an account that passed through builds 10, 10_002 or 10_003 on its way, with release 9's unstamped requests
/// (no removal ask, no device ask on record), gets every repair on its install of this build (from_version 10): the
/// removal runs at ask + the fallback (21 days on a 7-day account, not 34), the payment that needed the laptop waits a
/// floor from its ask (not from the removal: 62 days on a 30-day account), and the words and the laptop are renewed.
#[test]
fn r10_round4c_s1_1_every_intermediate_build_gets_every_repair() {
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    for marker in [10u32, 10_002, 10_003] {
        // The removal stamp (T2/B3-1) and the renewals.
        let (p, id, ask, ready) = d4_removal(7 * DAY);
        env::storage_write(INSTALLED, &borsh::to_vec(&marker).unwrap());
        let _ = get_created_receipts();
        as_key(PHONE, ask + 1);
        p.upgrade_check(10, None);
        let acts: Vec<MockAction> = get_created_receipts().into_iter().flat_map(|r| r.actions).collect();
        let renewed = |who: u8, method: &str| acts.iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } if borsh::to_vec(public_key).unwrap() == key(who).0 && method_names.iter().any(|m| m == method)));
        assert!(renewed(WORDS, "end_dispute"), "marker {marker}: the words get end_dispute");
        assert!(renewed(LAPTOP, "approve_recovery") && renewed(LAPTOP, "refuse_recovery") && renewed(LAPTOP, "refill_recovery_key"), "marker {marker}: the laptop is renewed");
        as_key(PHONE, ready);
        let why = refused_with(|| copy_of(&p).run(id));
        assert!(why.is_empty(), "marker {marker}: the removal runs at ask + 21 days, as it said: {why:?}");

        // The device-ask stamp (X3-2).
        let month = 30 * DAY;
        let floor = month + DAY;
        let mut q = account_of(month, bands(Level::Both { seconds: U64(floor) }));
        let t0 = 60 * DAY;
        as_key(PHONE, t0);
        let pay = q.execute(acct("bob.near"), send(10 * NEAR), None);
        assert!(!pay.done && pay.needs_device);
        let rm = q.remove_key(key(LAPTOP));
        let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
        as_on_release_9();
        env::storage_write(INSTALLED, &borsh::to_vec(&marker).unwrap());
        let upgraded = t0 + 1;
        as_key(PHONE, upgraded);
        q.upgrade_check(10, None);
        assert!(device_asked().iter().any(|(i, at)| *i == pay.id.unwrap().0 && *at / SECOND == upgraded), "marker {marker}: the payment's ask is stamped");
        as_key(PHONE, removal_at);
        assert!(q.run(rm.id.unwrap()).done);
        assert_eq!(ready_of(&q, pay.id.unwrap()), upgraded + floor, "marker {marker}: the payment waits a floor from its ask, not from the removal");
    }
}

/// The device list as `new` stores it (`Devices`, under "devices").
#[derive(BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
struct DevicesLayout {
    keys: Vec<Vec<u8>>,
    sealed: bool,
    created_at_ns: Option<u64>,
}

/// Round 4c (the audit's ruling): every install renews every role key. At the most keys an account can hold (8 phones, 4
/// second devices, the words: 13 delete-and-add batches), from the build before (10_004, from_version 10), every one is
/// renewed and the check fits its UPGRADE_CHECK_GAS (50 Tgas), the gas `approve(Upgrade)` attaches to it inside the app's
/// 80 Tgas yes. The mock counts NEAR's fees for each batch (receipt, delete, add with its method names) and the host
/// calls, not the wasm's own instructions: 10 Tgas are left for those (round 2 measured the check at 5.1 Tgas on the
/// pinned near-sandbox 2.13.4).
#[test]
fn r10_round4c_upgrade_check_renews_13_keys_inside_its_gas() {
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::get_created_receipts;
    let p = account();
    let mut l: Layout = borsh::from_slice(&borsh::to_vec(&p).unwrap()).unwrap();
    l.second_devices = [LAPTOP, 0x0A, 0x0B, 0x0C].iter().map(|f| key(*f).0).collect();
    let p: AccountPolicy = borsh::from_slice(&borsh::to_vec(&l).unwrap()).unwrap();
    env::state_write(&p);
    let mut devices: DevicesLayout = borsh::from_slice(&env::storage_read(b"devices").unwrap()).unwrap();
    let more = 8 - devices.keys.len() as u8;
    devices.keys.extend((0x61..0x61 + more).map(|f| key(f).0));
    assert_eq!(devices.keys.len(), 8, "the most phone keys (MAX_DEVICE_KEYS)");
    env::storage_write(b"devices", &borsh::to_vec(&devices).unwrap());
    env::storage_write(INSTALLED, &borsh::to_vec(&10_004u32).unwrap());
    let _ = get_created_receipts();
    let check_gas = near_sdk::Gas::from_tgas(50);
    testing_env!(VMContextBuilder::new()
        .current_account_id(me())
        .predecessor_account_id(me())
        .signer_account_id(me())
        .signer_account_pk(near_sdk::PublicKey::try_from(key(LAPTOP).0).unwrap())
        .block_timestamp(VT * SECOND)
        .prepaid_gas(check_gas)
        .account_balance(NearToken::from_near(1_000_000))
        .build());
    let before = env::used_gas().as_gas();
    p.upgrade_check(10, None);
    let used = env::used_gas().as_gas() - before;
    let adds = get_created_receipts().into_iter().flat_map(|r| r.actions).filter(|a| matches!(a, MockAction::AddKeyWithFunctionCall { .. })).count();
    assert_eq!(adds, 13, "8 phones, 4 second devices and the words, each renewed");
    println!("round 4c: upgrade_check renewing 13 keys used {:.3} Tgas in the mock (of {} attached)", used as f64 / 1e12, check_gas.as_tgas());
    assert!(used + near_sdk::Gas::from_tgas(10).as_gas() <= check_gas.as_gas(), "13 renewals and 10 Tgas for the wasm fit 50 Tgas: {used}");
}

/// S1-1's control: an account on the current build (every ask on record, as this build's `place` and `remove_key`
/// write them) sees no change to its waits or its records when the next build installs.
#[test]
fn r10_round4c_s1_1_control_an_account_on_this_build_keeps_its_waits() {
    let month = 30 * DAY;
    let floor = month + DAY;
    let mut p = account_of(month, bands(Level::Both { seconds: U64(floor) }));
    let t0 = 60 * DAY;
    as_key(PHONE, t0);
    let pay = p.execute(acct("bob.near"), send(10 * NEAR), None);
    let set = p.set_protection(bands(Level::Both { seconds: U64(floor) }));
    assert!(pay.needs_device && set.needs_device);
    let rm = p.remove_key(key(LAPTOP));
    let read = |k: &[u8]| env::storage_read(k);
    let before = (read(b"removal_asked"), read(b"device_asked"), p.waiting_requests().iter().map(|w| (w.id.0, w.ready_at_ns.0)).collect::<Vec<_>>());
    assert!(before.0.is_some() && before.1.is_some(), "this build records both asks");
    env::storage_write(INSTALLED, &borsh::to_vec(&10_004u32).unwrap());
    as_key(PHONE, t0 + 1);
    p.upgrade_check(10, None);
    let after = (read(b"removal_asked"), read(b"device_asked"), p.waiting_requests().iter().map(|w| (w.id.0, w.ready_at_ns.0)).collect::<Vec<_>>());
    assert_eq!(before, after, "no change to the waits or the asks");
    // And the removal and the payment still run when they said they would.
    let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
    as_key(PHONE, removal_at);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(ready_of(&p, pay.id.unwrap()), t0 + floor, "the payment waits a floor from its own ask");
}
