//! Release 10, the 4 Nov internal proofing (round 2): one regression test per item QA's round 2 asked fixed
//! (contract-rounds/TRACKER.md "Round 2"), named after its ID. Each failed on round 1's build (7ae9643fa) and passes on
//! the fix. Release-like: `cargo test --no-default-features --features agent,short-waits --test r10_round2`.
#![cfg(all(feature = "agent", not(feature = "modules")))]
#![allow(unused_imports, dead_code)]
mod common;
use account_policy::{AccountPolicy, Band, Change, Group, Level, Outcome, Step};
use agent_limits::{Budget, CoinLimit};
use common::finish_ok;
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{env, testing_env, AccountId, NearToken, PromiseResult};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1_000;
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const NEW_WORDS: u8 = 0xEF;
const THIEF_WORDS: u8 = 0xE0;
const LAPTOP: u8 = 0x09;
const LAPTOP2: u8 = 0x0B;
const THIEF_LAPTOP: u8 = 0x7A;
const NEW_PHONE: u8 = 0x11;
const AGENT: u8 = 0xA6;
/// A day's delay: the floor is 2 days, the fallback 7.
const FLOOR: u64 = 2 * DAY;
const FALLBACK: u64 = 7 * DAY;
/// After the account's first 24 hours (its set-up window).
const ASK: u64 = DAY + 100;
/// The one-shot install marker's storage key (K1, G3).
const INSTALLED: &[u8] = b"installed";

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
    near_sdk::borsh::from_slice(&near_sdk::borsh::to_vec(p).unwrap()).unwrap()
}
fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}
fn actions() -> Vec<MockAction> {
    get_created_receipts().into_iter().flat_map(|r| r.actions).collect()
}
fn send(yocto: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(yocto) }]
}
fn call(method: &str, args: &str, deposit: u128, gas: u64) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(gas) }
}
fn near_today(p: &AccountPolicy) -> u128 {
    p.spent_today().into_iter().find(|(c, _)| c == "near").map_or(0, |(_, a)| a.0)
}
fn ready_of(p: &AccountPolicy, id: U64) -> u64 {
    p.waiting_requests().into_iter().find(|w| w.id == id).unwrap().ready_at_ns.0 / SECOND
}
/// The callback after a key add NEAR refused (`f` is the static callback), and the state it left.
fn refused_add(p: &AccountPolicy, f: impl FnOnce()) -> AccountPolicy {
    env::state_write(p);
    testing_env!(common::same_context(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![PromiseResult::Failed]);
    f();
    env::state_read().unwrap()
}

/// A `delay`-second account whose last band waits `last_wait`: the phone named (sealed), the words set, Face ID up to
/// 1 NEAR a day.
fn account_with(delay: u64, last_wait: u64) -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(last_wait) } }];
    let mut p = AccountPolicy::new(U64(delay), bands, Some(key(PHONE)), None);
    as_key(PHONE, 1);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}
fn account() -> AccountPolicy {
    account_with(DAY, DAY)
}
/// ...and the owner's laptop, added at `at` in the set-up window (at once): of age from `at` + the floor, on for the
/// fallback from `at` + the fallback.
fn account_with_laptop(at: u64) -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, at);
    assert!(p.add_second_device(key(LAPTOP)).done, "the first second device in the set-up window goes at once");
    p
}
/// The owner's laptop at 2, then the last band set to need it (so every change needs its yes).
fn account_needing_laptop() -> AccountPolicy {
    let mut p = account_with_laptop(2);
    as_key(PHONE, 3);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
    let out = p.set_protection(bands);
    if !out.done {
        as_key(PHONE, DAY + 3);
        assert!(p.run(out.id.unwrap()).done);
    }
    p
}
fn budget(per_day: u128) -> Budget {
    Budget { coins: vec![CoinLimit { coin: "near".into(), per_day: U128(per_day), per_month: U128(30 * per_day), convert_per_day: U128(per_day) }], recipients: vec![], ends_at_ns: U64(400 * DAY * SECOND), max_spends_per_day: 12 }
}
/// Agent set up at `ask` (after the set-up window) and run a floor later; returns that moment.
fn with_agent(p: &mut AccountPolicy, k: u8, per_day: u128, ask: u64) -> u64 {
    as_key(PHONE, ask);
    let out = p.agent_set(key(k), budget(per_day), None);
    assert!(!out.done);
    let at = ask + FLOOR;
    as_key(PHONE, at);
    assert!(p.run(out.id.unwrap()).done);
    at
}

// ── G2 (Medium): only a device on the account for the fallback says yes to the phone's stop of a recovery ───────────

/// The round's PoC: a thief with the unlocked phone adds his own laptop (the strictest band waits; nothing needs the
/// owner's laptop), lets it come of age (a floor) and has it say yes to the phone's stop of every recovery the owner's
/// words start: each ended at once, with no freeze, and the thief kept spending at Face ID. Now a yes to a stop (by
/// `approve`, or `refuse_recovery(confirm_stop: true)`) needs a device on the account for the words-only fallback, as
/// a yes to a recovery does (F1). A plain refusal stays a device of age's: it ends the recovery, but freezes spending.
/// The scene: the owner's laptop (on since 10 s), the thief's laptop of age (not on for the fallback), the owner's words'
/// recovery with the owner's laptop's yes, and the thief's phone's stop. Returns the account, the start, the stop.
fn g2_scene() -> (AccountPolicy, u64, U64) {
    let mut p = account_with_laptop(10);
    let t_add = 8 * DAY;
    as_key(PHONE, t_add);
    let add = p.add_second_device(key(THIEF_LAPTOP));
    assert!(!add.done && !add.needs_device);
    let t_run = t_add + FLOOR;
    as_key(PHONE, t_run);
    assert!(p.run(add.id.unwrap()).done);
    let t = t_run + FLOOR + 1;
    as_key(PHONE, t);
    assert_eq!(p.second_devices_of_age(), 2, "the thief's laptop is of age, not on for the fallback");
    // The owner's words start a recovery, and the owner's laptop (on since 10 s) says yes to it.
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    let r = p.pending().unwrap();
    as_key(LAPTOP, t + 1);
    p.approve_recovery(r.new_key.clone(), r.ready_at_ns);
    // The thief's phone asks its stop; the thief's laptop can't say yes to it, either way.
    as_key(PHONE, t + 2);
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    (p, t, stop.id.unwrap())
}

#[test]
fn r10_round2_g2_a_stop_is_said_yes_to_only_by_a_device_on_for_the_fallback() {
    let (mut p, t, stop) = g2_scene();
    as_key(THIEF_LAPTOP, t + 3);
    let why = refused_with(|| copy_of(&p).approve(stop));
    assert!(why.contains("fallback"), "G2: a laptop of age only said yes to the stop: {why:?}");
    let why = refused_with(|| copy_of(&p).refuse_recovery(Some(true)));
    assert!(why.contains("fallback"), "G2: a laptop of age only confirmed the stop: {why:?}");
    // The stop alone, after its half day, can't end a recovery the owner's laptop said yes to.
    as_key(PHONE, t + 2 + DAY / 2);
    assert!(refused_with(|| copy_of(&p).run(stop)).contains("said yes"));
    // The owner's words finish after the delay: the thief's phone is out.
    as_key(WORDS, t + DAY);
    let _ = finish_ok(&mut p);
    assert!(p.pending().is_none());
    as_key(PHONE, t + DAY + 1);
    assert!(refused_with(|| copy_of(&p).execute(acct("bob.near"), send(1), None)).contains("isn't one of this account's phone keys"));
    // Control: the owner's laptop, on for the fallback, says yes to the owner's stop: it ends at once, no freeze.
    let mut o = account_with_laptop(10);
    let t = 10 + FALLBACK;
    as_key(WORDS, t);
    o.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let stop = o.cancel_recovery();
    as_key(LAPTOP, t + 2);
    assert!(o.approve(stop.id.unwrap()).done);
    assert!(o.pending().is_none() && o.frozen_until().is_none());
    // The thief's laptop's plain refusal still ends the recovery, but spending stays frozen for the floor.
    let (mut q, t, _) = g2_scene();
    as_key(THIEF_LAPTOP, t + 3);
    q.refuse_recovery(None);
    assert!(q.pending().is_none() && q.frozen_until().is_some(), "a refusal freezes");
}

// ── X3 / Y2 (Medium): after a refused words add, new words wait like any change ───────────────────────────────────

/// The round's PoC: new words whose add NEAR refused (W1's callback forgets them, and the old words were deleted when
/// they ran) left `recovery_key` empty, and `set_recovery_key` then took the next words as the account's first: Face
/// ID, no floor, no laptop. Whoever held the phone set words of their own at once. Now the account remembers words
/// were set once: past the set-up window, new words take the strictest band and the floor.
#[test]
fn r10_round2_x3_after_a_refused_words_add_new_words_wait_like_any_change() {
    let mut p = account();
    as_key(PHONE, ASK);
    let out = p.set_recovery_key(key(NEW_WORDS));
    assert!(!out.done);
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(out.id.unwrap()).done);
    let mut p = refused_add(&p, || AccountPolicy::on_recovery_words_key(key(NEW_WORDS)));
    let at = ASK + FLOOR + 1;
    as_key(PHONE, at);
    let w = p.set_recovery_key(key(THIEF_WORDS));
    assert!(!w.done, "X3: the phone set new words at once after a refused add");
    assert_eq!(w.ready_at_ns.unwrap().0, (at + FLOOR) * SECOND, "the floor, as any new words");
    // Where every change needs the laptop, so do these (Y2).
    let p = account_needing_laptop();
    let mut p = copy_of(&p);
    as_key(PHONE, 3 * DAY);
    let ask = p.set_recovery_key(key(NEW_WORDS));
    as_key(LAPTOP, 3 * DAY + 1);
    let _ = p.approve(ask.id.unwrap());
    as_key(PHONE, ask.ready_at_ns.unwrap().0 / SECOND);
    assert!(p.run(ask.id.unwrap()).done);
    let mut p = refused_add(&p, || AccountPolicy::on_recovery_words_key(key(NEW_WORDS)));
    as_key(PHONE, 6 * DAY);
    let w = p.set_recovery_key(key(THIEF_WORDS));
    assert!(!w.done && w.needs_device, "Y2: the phone alone set words on an account whose changes need the laptop");
    // In the set-up window, words NEAR refused are asked again at Face ID, as the first words are.
    let p = account();
    let mut p = refused_add(&p, || AccountPolicy::on_recovery_words_key(key(WORDS)));
    as_key(PHONE, 3);
    assert!(p.set_recovery_key(key(NEW_WORDS)).done);
}

// ── T1 / Y3 / X1 / L1: every waiting request says when it can really run, and a yes before then is kept ───────────

/// The round's PoCs: V2 gave `runs_at` an arm for AllowRelease only. An Upgrade asked behind its listing (X1, Y3) and a
/// removal of a key that became a second device after it was asked (T1, Y3b, L1b) said "ready" a floor after asking,
/// while `run` refused until the fallback; and the laptop's yes after that "ready" time reverted whole (a lost yes).
#[test]
fn r10_round2_t1_x1_an_upgrade_behind_its_listing_says_when_it_can_run() {
    let mut p = account_with_laptop(10);
    let ask = 1000;
    let h = Base64VecU8(vec![9; 32]);
    as_key(PHONE, ask);
    let allow = p.upgrade(h.clone());
    assert_eq!(allow.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND);
    as_key(PHONE, ask + 1);
    let up = p.upgrade(h.clone());
    assert_eq!(up.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND, "X1: the switch runs with its listing, not a floor after it was asked");
    assert_eq!(ready_of(&p, up.id.unwrap()), ask + FALLBACK, "waiting_requests too");
    // The laptop (of age, not on for the fallback) says yes after the floor: kept, not reverted.
    as_key(LAPTOP, ask + 1 + FLOOR);
    let yes = p.approve(up.id.unwrap());
    assert!(!yes.done, "it waits for its listing");
    assert_eq!(yes.ready_at_ns.unwrap().0, (ask + FALLBACK) * SECOND);
    as_key(PHONE, ask + FALLBACK);
    assert!(p.run(allow.id.unwrap()).done);
    assert!(p.run(up.id.unwrap()).done);
}

#[test]
fn r10_round2_t1_a_removal_of_a_key_that_became_a_second_device_says_the_fallback() {
    let mut p = account();
    as_key(PHONE, 2);
    let rm = p.remove_key(key(LAPTOP));
    let id = rm.id.unwrap();
    as_key(PHONE, 3);
    assert!(p.add_second_device(key(LAPTOP)).done);
    assert_eq!(ready_of(&p, id), 2 + FALLBACK, "T1: it runs the fallback after it was asked, and says so");
    // The laptop's yes after the floor is kept, not reverted.
    as_key(LAPTOP, 3 + FLOOR);
    let yes = p.approve(id);
    assert!(!yes.done);
    assert_eq!(yes.ready_at_ns.unwrap().0, (2 + FALLBACK) * SECOND);
    as_key(PHONE, 2 + FALLBACK);
    assert!(p.run(id).done);
    assert_eq!(p.second_device_count(), 0);
}

// ── T2: a removal asked on release 9 runs when it said, never past the longest wait ─────────────────────────────────

/// The round's PoC: release 9 kept no record of when a removal was asked; release 10 read it as its ready time less the
/// floor and added the fallback, so a removal of a laptop of age that had already waited the fallback on release 9 ran
/// (fallback - floor) later than it said: 34 to 44 days after it was asked on 7-day accounts. Now the upgrade from
/// release 9 records it: its ready time less max(floor, fallback) for a device of age then, else less the floor.
#[test]
fn r10_round2_t2_a_removal_asked_on_release_9_runs_when_it_said() {
    for (delay, last_wait) in [(DAY, DAY), (2 * DAY, DAY), (7 * DAY, DAY), (7 * DAY, 31 * DAY)] {
        let mut p = account_with(delay, last_wait);
        as_key(PHONE, 10);
        assert!(p.add_second_device(key(LAPTOP)).done);
        let floor = delay + delay.min(DAY);
        let ask = 10 + floor;
        as_key(PHONE, ask);
        assert_eq!(p.second_devices_of_age(), 1);
        let rm = p.remove_key(key(LAPTOP));
        let id = rm.id.unwrap();
        let ready = rm.ready_at_ns.unwrap().0 / SECOND;
        // As on release 9: no record of the ask, no install marker; then the upgrade's check.
        env::storage_remove(b"removal_asked");
        env::storage_remove(INSTALLED);
        as_key(PHONE, ask + 1);
        p.upgrade_check(9, Some(Base64VecU8(vec![7; 32])));
        assert_eq!(ready_of(&p, id), ready, "the view keeps release 9's ready time");
        as_key(PHONE, ready);
        let why = refused_with(|| copy_of(&p).run(id));
        assert!(why.is_empty(), "T2 ({delay} s delay, {last_wait} s band): runs later than it said: {why:?}");
        assert!(ready - ask <= 31 * DAY, "never past the longest wait");
    }
}

// ── X2 / Y4 (view): when each second device's yes to a recovery counts ──────────────────────────────────────────────

/// The round's finding: after F1, a laptop of age can't say yes to a recovery until it has been on the account for the
/// fallback, but no view said when: `second_device_ages` read 0 ("counts fully") and `recovery_status` said its yes was
/// needed. `second_device_yes_from` gives that moment per device (0 once it counts).
#[test]
fn r10_round2_x2_a_view_says_when_each_devices_yes_to_a_recovery_counts() {
    let mut p = account_with_laptop(2);
    let t = 2 + FLOOR + 100;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    let s = p.recovery_status().unwrap();
    assert_eq!(p.second_device_ages()[0].1 .0, 0, "of age");
    let from = p.second_device_yes_from();
    assert_eq!(from[0].0 .0, key(LAPTOP).0);
    assert_eq!(from[0].1 .0, (2 + FALLBACK) * SECOND, "X2: its yes counts from its fallback");
    as_key(LAPTOP, t + 1);
    assert!(refused_with(|| copy_of(&p).approve_recovery(key(NEW_PHONE), s.ready_at_ns)).contains("fallback"));
    as_key(LAPTOP, 2 + FALLBACK);
    assert_eq!(p.second_device_yes_from()[0].1 .0, 0, "and 0 once it does");
    p.approve_recovery(key(NEW_PHONE), s.ready_at_ns);
    assert!(p.recovery_status().unwrap().approved);
}

// ── L2 / A-I1: the first-day Agent goes at once only if its key's allowance fits the Face ID band now ────────────────

/// The round's PoC: the phone paid its whole Face ID band, then set up the first-day Agent, which ran at once and
/// counted its key's 0.25 NEAR allowance on top: the 24-hour NEAR past the band, all at Face ID. Now the first-day Agent
/// keeps Face ID (and no floor) only if Face ID alone could pay that allowance now; else it waits as any Agent does.
#[test]
fn r10_round2_l2_the_first_day_agent_fits_the_face_id_band() {
    let first_day = Budget { ends_at_ns: U64(DAY * SECOND), ..budget(100 * MILLI) };
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.execute(acct("bob.near"), send(NEAR), None).done, "the whole Face ID band, paid by the phone");
    as_key(PHONE, 20);
    let out = p.agent_set(key(AGENT), first_day.clone(), None);
    assert!(!out.done, "L2: the first-day Agent ran at once past the Face ID band");
    assert_eq!(out.ready_at_ns.unwrap().0, (20 + FLOOR) * SECOND, "it waits as any Agent");
    assert!(near_today(&p) <= NEAR + 1, "nothing past the band counted at Face ID");
    // Control: with room in the band, the first-day Agent still goes at once.
    let mut q = account();
    as_key(PHONE, 20);
    assert!(q.agent_set(key(AGENT), first_day, None).done);
}

// ── G4: a tightening of Agent's budget always runs ──────────────────────────────────────────────────────────────────

/// The round's PoC: once the owner tightened the Face ID band under Agent's fixed overhead (its key's allowance and its
/// payments' gas), every `agent_set_budget` was refused, a tightening to 1 yocto a day too: only the kill switch was
/// left. A budget that only tightens is now never held to the band (a looser one still is).
#[test]
fn r10_round2_g4_a_tightening_of_agents_budget_runs_after_the_band_shrank() {
    let mut p = account();
    let at = with_agent(&mut p, AGENT, 500 * MILLI, ASK);
    let t = at + DAY + 10;
    as_key(PHONE, t);
    let out = p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(260 * MILLI))]), level: Level::FaceId }, Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } }]);
    let t = out.ready_at_ns.unwrap().0 / SECOND;
    as_key(PHONE, t);
    assert!(p.run(out.id.unwrap()).done);
    as_key(PHONE, t + 10);
    let mut tight = budget(100 * MILLI);
    tight.max_spends_per_day = 1;
    let why = refused_with(|| copy_of(&p).agent_set_budget(tight.clone()));
    assert!(why.is_empty(), "G4: a tightening was refused: {why:?}");
    assert!(p.agent_set_budget(tight).done, "a tightening, nothing frozen: at once");
    let a = p.agent().unwrap();
    assert_eq!((a.budget.coins[0].per_day.0, a.budget.max_spends_per_day), (100 * MILLI, 1));
    // A looser budget is still held to the band.
    as_key(PHONE, t + 20);
    assert!(refused_with(|| copy_of(&p).agent_set_budget(budget(500 * MILLI))).contains("agent.limit.bands"));
}

// ── G1: in the set-up window only the first second device skips the floor ───────────────────────────────────────────

/// The round's PoC: `floor_for` gave every second device added in the set-up window no floor, so with Face ID-only bands
/// the second, third and fourth went at once, and with the app's bands they waited the last band's day, not a change's
/// wait. The first one goes at once (pairing at set-up); every other waits the floor.
#[test]
fn r10_round2_g1_only_the_first_second_device_skips_the_floor() {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done, "the first: at once");
    as_key(PHONE, 20);
    let out = p.add_second_device(key(LAPTOP2));
    assert!(!out.done, "G1: the second went at once");
    assert_eq!(out.ready_at_ns.unwrap().0, (20 + FLOOR) * SECOND);
    let mut p = account_with_laptop(10);
    as_key(PHONE, 20);
    let out = p.add_second_device(key(LAPTOP2));
    assert_eq!(out.ready_at_ns.unwrap().0, (20 + FLOOR) * SECOND, "G1: the band's day only, not the floor");
}

// ── G3: a rebuilt release 10 installs over an earlier build of it ────────────────────────────────────────────────────

/// The round's PoC: K1's marker stored the release number (10), and the check ran only for a newer number, so an
/// account on round 1's build (or made by its `new`) could never take a rebuilt release 10: its check refused and the
/// switch was undone. The marker now holds a build number (release x 1000 + its re-spin), raised at every re-spin;
/// `release_version` stays 10. Still once per build.
#[test]
fn r10_round2_g3_an_account_on_round_1s_build_takes_this_build_once() {
    let p = account();
    as_key(PHONE, 100);
    assert!(refused_with(|| p.upgrade_check(10, Some(Base64VecU8(vec![7; 32])))).contains("installed already"), "made by this build");
    // An account on round 1's build: its marker is 10.
    env::storage_write(INSTALLED, &near_sdk::borsh::to_vec(&10u32).unwrap());
    let why = refused_with(|| p.upgrade_check(10, Some(Base64VecU8(vec![7; 32]))));
    assert!(why.is_empty(), "G3: round 1's build can't take this one: {why:?}");
    assert_eq!(p.allowed_releases(), vec![Base64VecU8(vec![7; 32])]);
    assert!(refused_with(|| p.upgrade_check(10, Some(Base64VecU8(vec![8; 32])))).contains("installed already"), "once");
    assert_eq!(p.release_version(), 10);
}

// ── L3 / V-L1: a second device refills the words' allowance at most once a day ──────────────────────────────────────

/// The round's PoC: a laptop of age refilled the backup words' 0.25 NEAR fee allowance any number of times, counted
/// nowhere: a stolen laptop that also has the words could burn NEAR in fees. Now at most once in 24 hours.
#[test]
fn r10_round2_l3_a_laptop_refills_the_words_at_most_once_a_day() {
    let mut p = account_with_laptop(2);
    let t = 2 + FLOOR;
    as_key(LAPTOP, t);
    p.refill_recovery_key();
    let why = refused_with(|| copy_of(&p).refill_recovery_key());
    assert!(why.contains("once a day"), "L3: a second refill the same day: {why:?}");
    as_key(LAPTOP, t + DAY - 1);
    assert!(refused_with(|| copy_of(&p).refill_recovery_key()).contains("once a day"));
    as_key(LAPTOP, t + DAY);
    p.refill_recovery_key();
}

// ── G-L1: a finish waits while its new key is still being deleted ──────────────────────────────────────────────────

/// The round's lead: a finish that didn't finish (its recovery still waiting) sends the new key's delete in a receipt of
/// its own; a second finish right after could have its add land before that delete, which then took the new phone's
/// key off. `finish_recovery` now refuses while that key's delete is on its way.
#[test]
fn r10_round2_g_l1_a_finish_waits_for_its_keys_delete() {
    let mut p = account();
    as_key(WORDS, ASK);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, ASK + DAY);
    // As a not-finished finish of this same recovery leaves it (R2's mark, `recovery_deleting`).
    env::storage_write(b"recovery_deleting", &near_sdk::borsh::to_vec(&vec![key(NEW_PHONE).0]).unwrap());
    let why = refused_with(|| copy_of(&p).finish_recovery());
    assert!(why.contains("being taken off"), "G-L1: a finish went while its key's delete was on its way: {why:?}");
    AccountPolicy::on_recovery_key_deleted(key(NEW_PHONE));
    let _ = finish_ok(&mut p);
    assert!(p.pending().is_none());
}

// ── C-L1: a yes from a device on for the fallback is never replaced by a younger one ───────────────────────────────

/// The round's PoC: the owner's laptop (on for the fallback) said yes to listing a release, so it could run after the
/// floor; then a second laptop, of age but not on for the fallback, said yes too and replaced that yes: the listing went
/// back to waiting the fallback.
#[test]
fn r10_round2_c_l1_a_younger_yes_never_replaces_a_longer_ones() {
    let mut p = account_with_laptop(10);
    let t = 10 + FALLBACK;
    as_key(PHONE, t);
    let add = p.add_second_device(key(LAPTOP2));
    as_key(LAPTOP, t + 1);
    let _ = p.approve(add.id.unwrap());
    as_key(PHONE, t + FLOOR);
    assert!(p.run(add.id.unwrap()).done);
    let ask = t + 2 * FLOOR;
    as_key(PHONE, ask);
    assert_eq!(p.second_devices_of_age(), 2);
    let out = p.upgrade(Base64VecU8(vec![9; 32]));
    let id = out.id.unwrap();
    as_key(LAPTOP, ask + 1);
    assert_eq!(p.approve(id).ready_at_ns.unwrap().0, (ask + FLOOR) * SECOND);
    as_key(LAPTOP2, ask + 2);
    let yes2 = p.approve(id);
    assert_eq!(yes2.ready_at_ns.unwrap().0, (ask + FLOOR) * SECOND, "C-L1: the younger yes pushed it to the fallback");
    as_key(PHONE, ask + FLOOR);
    assert!(p.run(id).done);
    assert_eq!(p.allowed_releases().len(), 1);
}

// ── M-I1 / F3: the previews refuse what execute refuses ──────────────────────────────────────────────────────────────

/// The round's PoC: `level_for` and `level_for_many` answered Face ID for requests `execute` refuses (over 250 Tgas, 11
/// steps, 5 groups, this account itself, the 129th row in 24 hours), so the sheet showed a payment that could never be
/// placed. They now refuse the same, with the same words.
#[test]
fn r10_round2_m_i1_f3_the_previews_refuse_what_execute_refuses() {
    let mut p = account();
    as_key(PHONE, ASK);
    let heavy = vec![call("storage_deposit", "{}", 0, 126_000_000_000_000), call("storage_deposit", "{}", 0, 126_000_000_000_000)];
    let eleven: Vec<Step> = (0..11).map(|_| Step::Transfer { deposit: U128(1) }).collect();
    for (receiver, steps) in [(acct("usdc.near"), heavy), (acct("bob.near"), eleven), (me(), send(1))] {
        let by_execute = refused_with(|| copy_of(&p).execute(receiver.clone(), steps.clone(), None));
        assert!(!by_execute.is_empty());
        assert_eq!(refused_with(|| p.level_for(receiver.clone(), steps.clone(), None)), by_execute, "M-I1: level_for answered");
        let one = vec![Group { receiver_id: receiver.clone(), steps: steps.clone() }];
        assert_eq!(refused_with(|| p.level_for_many(one.clone())), refused_with(|| copy_of(&p).execute_many(one.clone())), "M-I1: level_for_many answered");
    }
    let five: Vec<Group> = (0..5).map(|_| Group { receiver_id: acct("bob.near"), steps: send(1) }).collect();
    assert_eq!(refused_with(|| p.level_for_many(five.clone())), refused_with(|| copy_of(&p).execute_many(five.clone())));
    let heavy_chain: Vec<Group> = (0..2).map(|_| Group { receiver_id: acct("usdc.near"), steps: vec![call("storage_deposit", "{}", 0, 120_000_000_000_000)] }).collect();
    assert!(!refused_with(|| p.level_for_many(heavy_chain.clone())).is_empty(), "a chain over 250 Tgas with its links");
    // F3: the 24-hour list holds 128 rows.
    for i in 0..128 {
        if i % 40 == 0 {
            as_key(PHONE, ASK);
        }
        assert!(p.execute(acct("bob.near"), send(1), None).done);
    }
    let by_execute = refused_with(|| copy_of(&p).execute(acct("bob.near"), send(1), None));
    assert!(by_execute.contains("too many payments"));
    assert_eq!(refused_with(|| p.level_for(acct("bob.near"), send(1), None)), by_execute, "F3: level_for answered for a 129th row");
    assert_eq!(refused_with(|| p.level_for_many(vec![Group { receiver_id: acct("bob.near"), steps: send(1) }])), by_execute);
    // A request that adds no row still previews.
    assert_eq!(p.level_for(acct("bob.near"), send(0), None), Level::FaceId);
}

// ── T-Info (view): the account's own record of its backup words' key ───────────────────────────────────────────────

/// The round's T-Info: no view said whether the account has backup words, so after W1 the app inferred it from NEAR's
/// key list. `backup_key` reads the contract's own record: None when it names none (never set, or forgotten by W1).
#[test]
fn r10_round2_t_info_a_view_reads_the_backup_key() {
    let p = account();
    assert_eq!(p.backup_key(), Some(key(WORDS)));
    let p = refused_add(&p, || AccountPolicy::on_recovery_words_key(key(WORDS)));
    assert_eq!(p.backup_key(), None, "forgotten after NEAR refused its add");
    reset();
    as_key(SETUP, 0);
    let p = AccountPolicy::new(U64(DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    assert_eq!(p.backup_key(), None, "none set yet");
}

// ── E1: with the last second device gone, what waited for its yes waits the floor from when it was asked ─────────────

/// The round's PoC (the audit's r3-E): a lost laptop held every request above Face ID for its removal (max(fallback, floor))
/// and then C1's re-level gave each a further floor from the removal: 29 days on a 7-day account, 62 on a 30-day one,
/// past the header's "at most 31 days". C1 now re-levels to max(ready time, asked + floor): a request waits a change's
/// wait from when it was asked, as one asked at that level would have, and here runs by the time the removal does.
#[test]
fn r10_round2_e1_a_lost_laptop_holds_a_payment_no_longer_than_its_removal() {
    for delay in [7 * DAY, 30 * DAY] {
        reset();
        as_key(SETUP, 0);
        let open = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::FaceId }];
        let mut p = AccountPolicy::new(U64(delay), open, Some(key(PHONE)), None);
        as_key(PHONE, 1);
        assert!(p.set_recovery_key(key(WORDS)).done);
        as_key(PHONE, 2);
        assert!(p.add_second_device(key(LAPTOP)).done);
        as_key(PHONE, 3);
        let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
        assert!(p.set_protection(bands).done);
        let t0 = 60 * DAY;
        as_key(PHONE, t0);
        let pay = p.execute(acct("bob.near"), send(10 * NEAR), None);
        assert!(!pay.done && pay.needs_device);
        let rm = p.remove_key(key(LAPTOP));
        let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
        assert!(removal_at - t0 <= 31 * DAY);
        as_key(PHONE, removal_at);
        assert!(p.run(rm.id.unwrap()).done);
        let runs = ready_of(&p, pay.id.unwrap());
        assert!(runs <= removal_at, "E1 ({} d delay): the payment waits {} d from its ask, past the removal", delay / DAY, (runs - t0) / DAY);
        assert_eq!(runs, t0 + delay + delay.min(DAY), "a floor from its ask");
        assert!(runs - t0 <= 31 * DAY, "never past the longest wait");
        assert!(p.run(pay.id.unwrap()).done);
    }
    // A request asked just before the last device goes still waits the floor from its ask.
    let mut p = account_with_laptop(2);
    as_key(PHONE, 3);
    let bands = vec![Band { up_to: Some(vec![("near".into(), U128(NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }];
    let set = p.set_protection(bands);
    if !set.done {
        as_key(PHONE, DAY + 3);
        assert!(p.run(set.id.unwrap()).done);
    }
    let ask = 20 * DAY;
    as_key(PHONE, ask);
    let rm = p.remove_key(key(LAPTOP));
    let removal_at = rm.ready_at_ns.unwrap().0 / SECOND;
    as_key(PHONE, removal_at - 1);
    let pay = p.execute(acct("bob.near"), send(10 * NEAR), None);
    as_key(PHONE, removal_at);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(ready_of(&p, pay.id.unwrap()), removal_at - 1 + FLOOR, "a floor from its ask");
}

// ── The laptop veto (decision A, VETO-SPEC.md): a second device of age says no to anything the phone asked alone ─────

/// The laptop of age (added at 2 in the set-up window, of age from 2 + FLOOR) and the moment it is: `VT`.
const VT: u64 = 3 * DAY;
fn veto_account() -> AccountPolicy {
    let p = account_with_laptop(2);
    as_key(PHONE, VT);
    p
}
fn waiting_ids(p: &AccountPolicy) -> Vec<U64> {
    p.waiting_requests().into_iter().map(|w| w.id).collect()
}
const SAID_NO: &str = "Your laptop said no";
const PAUSED: &str = "paused spending";

/// T1: new words the phone asked alone, turned down by the laptop of age: dropped, and the words are the same after
/// the floor. Control: not turned down, they run.
#[test]
fn r10_round2_veto_t1_the_laptop_turns_down_new_words() {
    for decline in [true, false] {
        let mut p = veto_account();
        let words = p.set_recovery_key(key(THIEF_WORDS));
        assert!(!words.done);
        if decline {
            as_key(LAPTOP, VT + 1);
            p.decline(words.id.unwrap());
            assert!(waiting_ids(&p).is_empty());
            as_key(PHONE, VT + FLOOR + 1);
            assert!(refused_with(|| copy_of(&p).run(words.id.unwrap())) != "");
            assert_eq!(p.backup_key(), Some(key(WORDS)));
        } else {
            as_key(PHONE, VT + FLOOR);
            assert!(p.run(words.id.unwrap()).done, "control: not turned down, the new words run");
        }
    }
}

/// T2: the same for each kind of request the phone asks alone: its protection, a further second device, a key's
/// removal (not a second device's), a release's listing, Agent, and a payment in a waiting band.
#[test]
fn r10_round2_veto_t2_every_phone_alone_request_can_be_turned_down() {
    let asks: Vec<(&str, fn(&mut AccountPolicy) -> Outcome)> = vec![
        ("protection", |p| p.set_protection(vec![Band { up_to: None, level: Level::FaceId }])),
        ("a further second device", |p| p.add_second_device(key(THIEF_LAPTOP))),
        ("a key's removal", |p| p.remove_key(key(NEW_PHONE))),
        ("a release's listing", |p| p.upgrade(Base64VecU8(vec![9; 32]))),
        ("Agent", |p| p.agent_set(key(AGENT), budget(MILLI), None)),
        ("a payment in the waiting band", |p| p.execute(acct("bob.near"), send(5 * NEAR), None)),
    ];
    for (what, ask) in asks {
        let mut p = veto_account();
        let out = ask(&mut p);
        assert!(!out.done && !out.needs_device, "{what}: waits, the phone's alone");
        as_key(LAPTOP, VT + 1);
        p.decline(out.id.unwrap());
        assert!(waiting_ids(&p).is_empty(), "{what}: turned down");
        assert!(p.dispute_until().is_some(), "{what}: a dispute is open");
    }
}

/// T3: a second device not yet of age turns down only what needs its yes. Control: once of age, it can.
#[test]
fn r10_round2_veto_t3_a_young_device_cannot_veto() {
    let mut p = account_with_laptop(2);
    as_key(PHONE, ASK);
    let set = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, ASK + 1);
    assert!(refused_with(|| copy_of(&p).decline(set.id.unwrap())).contains("doesn't need your second device"));
    as_key(LAPTOP, 2 + FLOOR);
    p.decline(set.id.unwrap());
    assert!(waiting_ids(&p).is_empty(), "control: of age, it turns it down");
}

/// T4: a second device never turns down its own removal, nor another second device's; the removal runs on time.
#[test]
fn r10_round2_veto_t4_never_a_second_devices_removal() {
    let mut p = veto_account();
    let rm = p.remove_key(key(LAPTOP));
    as_key(LAPTOP, VT + 1);
    assert!(refused_with(|| copy_of(&p).decline(rm.id.unwrap())).contains("can't stop a second device's removal"));
    let at = rm.ready_at_ns.unwrap().0 / SECOND;
    assert_eq!(at, VT + FALLBACK, "max(fallback, floor) from its ask");
    as_key(PHONE, at);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
}

/// T5: what the phone and the laptop of age asked together can't be turned down, by it or another second device.
#[test]
fn r10_round2_veto_t5_a_co_signed_request_cannot_be_turned_down() {
    let mut p = veto_account();
    let set = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 1);
    let _ = p.approve(set.id.unwrap());
    assert!(refused_with(|| copy_of(&p).decline(set.id.unwrap())).contains("asked this together"));
    assert_eq!(waiting_ids(&p), vec![set.id.unwrap()]);
    assert!(p.dispute_until().is_none());
}

/// T6 and T11: for a change's wait (block time only) the phone alone asks nothing that waits. It may still ask what
/// needs the laptop's yes, cancel, stop a recovery, and remove a second device; a co-signed request still runs. From
/// the window's end it asks again.
#[test]
fn r10_round2_veto_t6_the_window_holds_the_phones_asks_for_a_floor() {
    let mut p = veto_account();
    // Kept: co-signed before the no.
    let kept = p.add_second_device(key(LAPTOP2));
    as_key(LAPTOP, VT + 1);
    let _ = p.approve(kept.id.unwrap());
    as_key(PHONE, VT + 2);
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let t = VT + 3;
    as_key(LAPTOP, t);
    p.decline(asked.id.unwrap());
    assert_eq!(p.dispute_until(), Some(U64((t + FLOOR) * SECOND)));
    assert_eq!(waiting_ids(&p), vec![kept.id.unwrap()], "the co-signed request stays");
    as_key(PHONE, t + 1);
    assert!(refused_with(|| copy_of(&p).set_protection(vec![Band { up_to: None, level: Level::FaceId }])).contains(SAID_NO));
    assert!(refused_with(|| copy_of(&p).set_recovery_key(key(THIEF_WORDS))).contains(SAID_NO));
    // Allowed: a second device's removal, which no second device turns down.
    let rm = copy_of(&p).remove_key(key(LAPTOP));
    assert!(!rm.done);
    // Allowed: the co-signed request runs on time.
    as_key(PHONE, VT + 1 + FLOOR);
    assert!(p.run(kept.id.unwrap()).done);
    // T11: the window is block time: one second before its end still closed, at its end open.
    as_key(PHONE, t + FLOOR - 1);
    assert!(refused_with(|| copy_of(&p).set_protection(vec![Band { up_to: None, level: Level::FaceId }])).contains(SAID_NO));
    as_key(PHONE, t + FLOOR);
    assert!(p.dispute_until().is_none());
    let again = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    assert!(!again.done && again.id.is_some(), "from the window's end the phone asks again");
    // Cancel is never held.
    p.cancel(again.id.unwrap());
}

/// T6 (b): during the window the phone may ask what needs the laptop's yes (asking with the laptop), and stop a recovery.
#[test]
fn r10_round2_veto_t6b_asks_with_the_laptop_and_a_stop_go_on() {
    let mut p = account_needing_laptop();
    let t = 4 * DAY;
    as_key(PHONE, t);
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    assert!(asked.needs_device);
    let pay = p.execute(acct("bob.near"), send(5 * NEAR), None);
    assert!(pay.needs_device);
    as_key(LAPTOP, t + 1);
    p.decline(pay.id.unwrap());
    assert!(waiting_ids(&p).is_empty(), "both were the phone's alone");
    as_key(PHONE, t + 2);
    let with_laptop = p.execute(acct("bob.near"), send(5 * NEAR), None);
    assert!(!with_laptop.done && with_laptop.needs_device, "needs the laptop's yes: asked with the laptop");
    as_key(LAPTOP, t + 3);
    assert!(p.approve(with_laptop.id.unwrap()).done, "the laptop's yes runs it");
    as_key(WORDS, t + 4);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 5);
    let stop = p.cancel_recovery();
    assert!(stop.id.is_some() || stop.done, "the phone's stop of a recovery is never held");
}

/// T7: one no with twenty waiting drops every one the phone asked alone and keeps the co-signed ones; its gas (the mock's
/// count) is far inside the laptop's 1 NEAR allowance.
#[test]
fn r10_round2_veto_t7_one_no_drops_them_all() {
    let mut p = veto_account();
    let mut ids = vec![];
    for i in 0..20u64 {
        as_key(PHONE, VT + i);
        ids.push(p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]).id.unwrap());
    }
    for id in &ids[..5] {
        as_key(LAPTOP, VT + 30);
        let _ = p.approve(*id);
    }
    as_key(LAPTOP, VT + 31);
    let before = env::used_gas();
    p.decline(ids[10]);
    let used = env::used_gas().as_gas() - before.as_gas();
    println!("T7: one no over 20 waiting (15 dropped) used {} Tgas in the mock", used / 1_000_000_000_000);
    assert_eq!(waiting_ids(&p), ids[..5].to_vec());
    assert!(used < 300_000_000_000_000, "within one call's gas: {used}");
}

/// T8: an account with no second device: nobody can turn anything down, and nothing changes.
#[test]
fn r10_round2_veto_t8_a_phone_only_account_is_as_before() {
    let mut p = account();
    as_key(PHONE, ASK);
    let set = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    for k in [LAPTOP, WORDS, NEW_PHONE] {
        as_key(k, ASK + 1);
        assert!(refused_with(|| copy_of(&p).decline(set.id.unwrap())).contains("only a second device"));
    }
    as_key(PHONE, ASK + FLOOR);
    assert!(p.run(set.id.unwrap()).done);
    assert!(p.dispute_until().is_none());
}

/// T9: a hostile laptop of age. The owner's words end its dispute at once and the phone goes on; the phone's removal of
/// it, asked during the dispute, runs on time.
#[test]
fn r10_round2_veto_t9_a_hostile_laptop_is_removed_on_time() {
    let mut p = veto_account();
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 1);
    p.decline(asked.id.unwrap());
    as_key(PHONE, VT + 2);
    let rm = p.remove_key(key(LAPTOP));
    assert_eq!(rm.ready_at_ns.unwrap().0 / SECOND, VT + 2 + FALLBACK);
    as_key(WORDS, VT + 3);
    p.end_dispute();
    as_key(PHONE, VT + 4);
    let again = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    // The laptop says no again: the removal stays (never a second device's), the rest goes.
    as_key(LAPTOP, VT + 5);
    p.decline(again.id.unwrap());
    assert_eq!(waiting_ids(&p), vec![rm.id.unwrap()]);
    as_key(PHONE, VT + 2 + FALLBACK);
    assert!(p.run(rm.id.unwrap()).done);
    assert_eq!(p.second_device_count(), 0);
}

/// T10: during a recovery the laptop's no touches no recovery: the words start one while a dispute is open, the laptop
/// turns down the phone's next ask meanwhile (re-audit 3 A-1 still holds), and the words finish it on time (the
/// fallback: this laptop has not been on for it, so its yes wouldn't count). A finished recovery ends the dispute.
#[test]
fn r10_round2_veto_t10_no_veto_over_the_words_recovery() {
    let mut p = veto_account();
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 1);
    p.decline(asked.id.unwrap());
    let start = VT + 2;
    as_key(WORDS, start);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, start + 1);
    let stop = p.cancel_recovery();
    as_key(LAPTOP, start + 2);
    p.decline(stop.id.unwrap());
    assert!(p.recovery_status().is_some(), "the no left the recovery alone");
    as_key(WORDS, start + FALLBACK);
    let _ = finish_ok(&mut p);
    assert!(p.recovery_status().is_none() && p.dispute_until().is_none(), "finished; the dispute was with the old phone");
}

/// T13: a no pauses the Face ID band (the phone's payments); it pays again at the window's end.
#[test]
fn r10_round2_veto_t13_a_no_pauses_face_id_spending() {
    let mut p = veto_account();
    assert!(copy_of(&p).execute(acct("bob.near"), send(MILLI), None).done, "control: Face ID pays before");
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let t = VT + 1;
    as_key(LAPTOP, t);
    p.decline(asked.id.unwrap());
    as_key(PHONE, t + 1);
    assert!(refused_with(|| copy_of(&p).execute(acct("bob.near"), send(MILLI), None)).contains(PAUSED));
    // M-I1: the preview says so too, in the same words; a payment in the waiting band is the phone's ask alone.
    assert!(refused_with(|| p.level_for(acct("bob.near"), send(MILLI), None)).contains(PAUSED));
    assert!(refused_with(|| p.level_for(acct("bob.near"), send(5 * NEAR), None)).contains(SAID_NO));
    assert!(refused_with(|| copy_of(&p).execute(acct("bob.near"), send(5 * NEAR), None)).contains(SAID_NO));
    as_key(PHONE, t + FLOOR - 1);
    assert!(refused_with(|| copy_of(&p).execute(acct("bob.near"), send(MILLI), None)).contains(PAUSED));
    as_key(PHONE, t + FLOOR);
    assert!(p.execute(acct("bob.near"), send(MILLI), None).done, "pays again at the window's end");
}

/// T14: the backup words end the dispute at once: Face ID pays and the phone asks again. Nobody else can end it.
#[test]
fn r10_round2_veto_t14_the_words_end_the_dispute() {
    let mut p = veto_account();
    let asked = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 1);
    p.decline(asked.id.unwrap());
    for k in [PHONE, LAPTOP] {
        as_key(k, VT + 2);
        assert!(refused_with(|| copy_of(&p).end_dispute()).contains("only the backup words"));
    }
    as_key(WORDS, VT + 2);
    p.end_dispute();
    assert!(p.dispute_until().is_none());
    as_key(PHONE, VT + 3);
    assert!(p.execute(acct("bob.near"), send(MILLI), None).done);
    assert!(p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]).id.is_some());
    as_key(WORDS, VT + 4);
    assert!(refused_with(|| copy_of(&p).end_dispute()).contains("nothing is paused"));
}

/// T15: a laptop with nothing to turn down can't pause anything: no such request, or only a co-signed one. Control: a
/// phone-alone request, and it can.
#[test]
fn r10_round2_veto_t15_no_request_no_pause() {
    let mut p = veto_account();
    as_key(LAPTOP, VT + 1);
    assert!(refused_with(|| copy_of(&p).decline(U64(999))) != "");
    as_key(PHONE, VT + 2);
    let set = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 3);
    let _ = p.approve(set.id.unwrap());
    assert!(refused_with(|| copy_of(&p).decline(set.id.unwrap())) != "");
    assert!(p.dispute_until().is_none());
    as_key(PHONE, VT + 4);
    assert!(p.execute(acct("bob.near"), send(MILLI), None).done, "nothing paused");
    let alone = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(LAPTOP, VT + 5);
    p.decline(alone.id.unwrap());
    assert!(p.dispute_until().is_some(), "control: a phone-alone request, and its no pauses");
}

/// The words' key carries the third method; the upgrade gives it to an earlier build's words.
#[test]
fn r10_round2_veto_the_words_key_gets_end_dispute() {
    assert_eq!(account_policy::RECOVERY_METHODS, "start_recovery,finish_recovery,end_dispute");
    let p = veto_account();
    near_sdk::env::storage_write(INSTALLED, &near_sdk::borsh::to_vec(&10u32).unwrap());
    let _ = get_created_receipts();
    p.upgrade_check(10, None);
    assert!(actions().iter().any(|a| matches!(a, MockAction::AddKeyWithFunctionCall { public_key, method_names, .. } if near_sdk::borsh::to_vec(public_key).unwrap() == key(WORDS).0 && method_names.iter().any(|m| m == "end_dispute"))));
}
