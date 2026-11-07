//! Independent audit, team A, re-check 1: the fix commit 1fc64f3 (release 6, re-pinned 7QRGbHW). Report:
//! an internal review.
//!
//! As before (METHOD.md 5): `r*` tests are new findings' proofs of concept; they assert the guarantee, so they FAIL at
//! 1fc64f3 and pass once fixed. `v*` tests are variants of A-1..A-5 and the leads, and must pass.
mod common;
use common::finish_ok;
use account_policy::{AccountPolicy, Band, Group, Level, Step};
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId, NearToken};

const SECOND: u64 = 1_000_000_000;
const DAY: u64 = 86_400;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const USDC: &str = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDT: &str = "nep141:usdt.tether-token.near";
const SETUP: u8 = 0x50;
const PHONE: u8 = 0x33;
const WORDS: u8 = 0xEE;
const LAPTOP: u8 = 0x09;
const NEW_PHONE: u8 = 0x11;

fn me() -> AccountId {
    "me.near".parse().unwrap()
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

fn send(near: u128) -> Vec<Step> {
    vec![Step::Transfer { deposit: U128(near) }]
}

fn call(method: &str, args: &str, deposit: u128) -> Step {
    Step::FunctionCall { method_name: method.into(), args: Base64VecU8(args.as_bytes().to_vec()), deposit: U128(deposit), gas: U64(30_000_000_000_000) }
}

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn reset() {
    let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
}

/// The app's DEFAULT_PROTECTION at $2.50 a NEAR: Face ID up to $500 a day, then a 24-hour wait.
fn default_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } },
    ]
}

/// What "Ask my laptop above $5,000" (demo-core secondDeviceLimit) makes of the default bands.
fn laptop_above_5000() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: Some(vec![("near".into(), U128(2_000 * NEAR)), (USDC.into(), U128(5_000_000_000)), (USDT.into(), U128(5_000_000_000))]), level: Level::Wait { seconds: U64(DAY) } },
        Band { up_to: None, level: Level::Both { seconds: U64(DAY) } },
    ]
}

/// A mainnet account as the app makes it (demo-core setUp): phone named at `new`, first words in the setup batch, a
/// 7-day recovery, the default bands, no second device.
fn account() -> AccountPolicy {
    reset();
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

/// The same account with the laptop the app offers at set-up (paired in hour 1, at once), now of age (day 10).
fn account_with_aged_laptop() -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(PHONE, 10 * DAY);
    assert_eq!(p.second_devices_of_age(), 1);
    p
}

// ═══ A-1 (Critical): with a second device of age, a recovery start doesn't freeze, and neither the words nor the

fn usdt_pay(units: u128) -> Vec<Step> {
    vec![call("ft_transfer", &format!(r#"{{"receiver_id":"bob.near","amount":"{units}"}}"#), 1)]
}

fn thief_young_laptop_with_device_band() -> AccountPolicy {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done, "hour 1, no level");
    let b = p.set_protection(vec![Band { up_to: Some(vec![("near".into(), U128(200 * NEAR))]), level: Level::FaceId }, Band { up_to: None, level: Level::Device }]);
    as_key(PHONE, 3_600 + DAY);
    assert!(p.run(b.id.unwrap()).done, "a set-up step: the band's day, not the floor");
    p
}

// ═══ New findings (fail at 1fc64f3) ════════════════════════════════════════════════════════════════════════════

/// R-1 (Low): `run` refuses, while a recovery waits, anything not co-signed; `approve` doesn't. A second device NOT of age
/// may still approve what needs a second device, and `approve` runs it at once when its wait is over. So a payment the
/// phone asked during the recovery (Both{floor}) runs through a young device's yes if the owner finishes more than a
/// day after the recovery is ready: A-2b through the other door. Property: while a recovery waits, nothing not
/// co-signed (approved while of age) runs, by any method.
#[test]
fn r1_young_device_approve_runs_a_phone_request_while_the_recovery_waits() {
    let mut p = thief_young_laptop_with_device_band();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    assert!(!all.done && all.needs_device);
    as_key(PHONE, t + 8 * DAY + 1);
    assert!(p.pending().is_some(), "ready since day 7, not finished yet");
    assert!(fails(|| p.run(all.id.unwrap())), "run refuses it (the A-2 fix)");
    as_key(0x77, t + 8 * DAY + 1);
    assert_eq!(p.second_devices_of_age(), 0, "the laptop is young (its clock stopped at the start)");
    let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.approve(all.id.unwrap()))).map(|o| o.done).unwrap_or(false);
    assert!(!ran, "R-1: a young device's yes ran the whole balance while the owner's recovery waited");
}

/// R-2 (Medium): R1 again for an account whose second device of age is LOST. The phone's stop waits a day, nobody
/// refuses it, and when it runs no freeze follows (the freeze is set only by the at-once stop of an account with no
/// device of age). In the same transaction the phone spends the Face ID band. The owner restarts, the thief stops again:
/// the owner can never finish, and the Face ID band leaves every day. Property: a stop the second device didn't say yes
/// to leaves spending frozen for a change's wait, as a phone-only stop does.
#[test]
fn r2_lost_laptop_the_thiefs_stop_runs_daily_and_face_id_bleeds_between() {
    let mut p = account_with_aged_laptop();
    let mut t = 10 * DAY;
    let mut taken = 0u128;
    for _ in 0..10 {
        as_key(WORDS, t);
        p.start_recovery(key(NEW_PHONE));
        as_key(PHONE, t + 1);
        let stop = p.cancel_recovery();
        assert!(!stop.done, "waits a day: the laptop could refuse, but it's lost");
        as_key(PHONE, t + 1 + DAY);
        assert!(p.run(stop.id.unwrap()).done);
        // Same transaction (one receipt): the owner can't restart in between.
        if p.execute(acct("thief.near"), send(199 * NEAR), None).done {
            taken += 199;
        }
        t += DAY + 2;
    }
    assert!(p.pending().is_none(), "ten recoveries, none finished");
    assert_eq!(taken, 0, "R-2: {taken} NEAR (~${}) left at Face ID in 10 days, and the owner never gets the phone out", taken * 5 / 2);
}

/// R-3 (Medium): the A-2 fix drops what the phone asked alone when a stop ends the recovery, but not when NEW WORDS end
/// it. The owner's co-signed new words (asked with the laptop before the theft) survive the owner's start and, run by the
/// thief at their ready time, cancel the owner's recovery without the drop and without a freeze. What the thief queued
/// right after the start (Wait{floor}) runs a day later; the laptop can no longer refuse it (no dispute).
#[test]
fn r3_co_signed_new_words_end_the_recovery_but_keep_what_the_thief_queued() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let words = p.set_recovery_key(key(0x46));
    as_key(LAPTOP, 10 * DAY + 1);
    assert!(!p.approve(words.id.unwrap()).done, "co-signed, waits the floor (ready day 18)");
    // Day 11: the phone is stolen; the owner starts a recovery with the words still on the account (ready day 18).
    let t = 11 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    assert_eq!(p.waiting_requests().len(), 1, "the co-signed new words survive, as designed");
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    // Day 18, just before the owner's finish: the thief runs the owner's new words.
    as_key(PHONE, 18 * DAY);
    assert!(p.run(words.id.unwrap()).done);
    assert!(p.pending().is_none(), "the owner's recovery is gone");
    as_key(LAPTOP, 18 * DAY + 1);
    assert!(fails(|| p.decline(all.id.unwrap())), "no dispute now: the laptop can't refuse a wait-only payment");
    as_key(PHONE, 19 * DAY + 1);
    assert!(fails(|| p.run(all.id.unwrap())), "R-3: the whole balance left a day after the words ended the owner's recovery");
}

// ═══ Variants of A-1..A-5 and the leads (must pass) ═══════════════════════════════════════════════════════════════

/// A-1: with a laptop of age, everything the phone asks during a recovery waits the floor (execute, execute_many,
/// level_for agrees), can't run while the recovery waits even once ready, and goes at the finish.
#[test]
fn v_a1_frozen_with_a_laptop_of_age_every_way_in() {
    let mut p = account_with_aged_laptop();
    let t = 22 * DAY; // release 10 (F1): its laptop on the account for the fallback
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    assert!(p.frozen_until().is_some());
    as_key(PHONE, t + 1);
    assert_eq!(p.level_for(acct("a.near"), send(1), None), Level::Wait { seconds: U64(8 * DAY) });
    let a = p.execute(acct("a.near"), send(1), None);
    let b = p.execute_many(vec![Group { receiver_id: acct("a.near"), steps: send(1) }]);
    let c = p.execute(acct("a.near"), send(999 * NEAR), None);
    assert!(!a.done && !b.done && !c.done);
    as_key(PHONE, t + 8 * DAY + 1);
    for o in [&a, &b, &c] {
        assert!(fails(|| p.run(o.id.unwrap())), "ready, but the recovery still waits");
    }
    // Release 7: the laptop of age says yes to this recovery first.
    as_key(LAPTOP, t + 8 * DAY + 1);
    p.approve_recovery(key(NEW_PHONE), U64((t + 7 * DAY) * SECOND));
    as_key(WORDS, t + 8 * DAY + 2);
    finish_ok(&mut p);
    assert!(p.waiting_requests().is_empty());
}

/// A-1: the laptop of age refuses what the phone asked alone during a dispute (a setting too), not a co-signed request,
/// not its own removal; a young laptop can't; outside a dispute it again refuses only what needs it.
#[test]
fn v_a1_dispute_decline_rules() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let signed = p.set_protection(laptop_above_5000());
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(signed.id.unwrap());
    as_key(WORDS, 11 * DAY);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 11 * DAY + 1);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let removal = p.remove_key(key(LAPTOP));
    as_key(LAPTOP, 11 * DAY + 2);
    assert!(fails(|| p.decline(signed.id.unwrap())), "co-signed: not refusable");
    assert!(fails(|| p.decline(removal.id.unwrap())), "never its own removal");
    p.decline(loosen.id.unwrap());
    // A young second device can't refuse in a dispute.
    let mut q = account();
    as_key(PHONE, 60);
    q.add_second_device(key(0x77));
    as_key(WORDS, 2 * DAY);
    q.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 2 * DAY + 1);
    let pay = q.execute(acct("a.near"), send(NEAR), None);
    as_key(0x77, 2 * DAY + 2);
    assert!(fails(|| q.decline(pay.id.unwrap())));
    // No recovery waiting: release 10 (round 2, the laptop veto, decision A) lets the laptop of age turn down what the
    // phone asked alone at any time too (before: only what needed it), and its no opens a dispute.
    let mut r = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let w = r.execute(acct("a.near"), send(999 * NEAR), None);
    assert!(!w.needs_device);
    as_key(LAPTOP, 10 * DAY + 1);
    r.decline(w.id.unwrap());
    assert!(r.waiting_requests().is_empty() && r.dispute_until().is_some());
}

/// A-1: a request co-signed by the laptop of age before the start still runs during the recovery (two of three). A
/// wait-only payment can't be co-signed at all (approve refuses it), so only device-level ones can be protected.
#[test]
fn v_a1_co_signed_before_the_start_still_runs() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let limits = p.set_protection(laptop_above_5000());
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(limits.id.unwrap());
    as_key(PHONE, 18 * DAY);
    p.run(limits.id.unwrap());
    as_key(PHONE, 20 * DAY);
    let mid = p.execute(acct("a.near"), send(500 * NEAR), None);
    let big = p.execute(acct("a.near"), send(3_000 * NEAR), None);
    assert!(big.needs_device && !mid.needs_device);
    as_key(LAPTOP, 20 * DAY + 1);
    p.approve(big.id.unwrap());
    assert!(fails(|| p.approve(mid.id.unwrap())), "a wait-only payment can't be co-signed");
    as_key(WORDS, 20 * DAY + 2);
    p.start_recovery(key(NEW_PHONE));
    let left: Vec<u64> = p.waiting_requests().iter().map(|w| w.id.0).collect();
    assert_eq!(left, vec![big.id.unwrap().0]);
    as_key(PHONE, 21 * DAY + 1);
    assert!(p.run(big.id.unwrap()).done, "co-signed: runs while the recovery waits");
}

/// A-2: every way a stop happens drops what the phone asked alone during the recovery: at once (no device of age), after
/// the day (device lost), co-signed; and a late phone-only stop keeps the freeze for the floor.
#[test]
fn v_a2_every_stop_drops() {
    // No device of age, late stop, payment and upgrade queued.
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let all = p.execute(acct("thief.near"), send(999_000 * NEAR), None);
    let code = p.upgrade(Base64VecU8(vec![0xAB; 32]));
    as_key(PHONE, t + 7 * DAY - 1);
    assert!(p.cancel_recovery().done);
    assert!(p.waiting_requests().is_empty());
    as_key(PHONE, t + 8 * DAY + 1);
    assert!(fails(|| p.run(all.id.unwrap())) && fails(|| p.run(code.id.unwrap())));
    assert!(!p.execute(acct("thief.near"), send(NEAR), None).done, "still frozen");
    // Device lost: the stop waits out its day.
    let mut q = account_with_aged_laptop();
    as_key(WORDS, 10 * DAY);
    q.start_recovery(key(NEW_PHONE));
    as_key(PHONE, 10 * DAY + 1);
    let pay = q.execute(acct("thief.near"), send(999 * NEAR), None);
    let stop = q.cancel_recovery();
    as_key(PHONE, 11 * DAY + 1);
    q.run(stop.id.unwrap());
    assert!(!q.waiting_requests().iter().any(|w| Some(w.id) == pay.id));
}

/// A-3: zero amounts add no row; 64 token payments (2 rows each: the 1 yocto and the coin) fill the 128; the next
/// measured payment is refused, an unmeasurable one still waits, and a day later payments go again.
#[test]
fn v_a3_rows_cap() {
    let mut p = account();
    as_key(PHONE, DAY);
    // A call moving no NEAR still counts its gas (the Fable review, FB-1): 128 of them fill the day, the 129th is refused.
    for i in 0..128u64 {
        as_key(PHONE, DAY + i);
        assert!(p.execute(acct("wrap.near"), vec![call("near_deposit", "", 0)], None).done);
    }
    as_key(PHONE, DAY + 200);
    assert!(fails(|| p.execute(acct("wrap.near"), vec![call("near_deposit", "", 0)], None)), "the 129th in 24 h");
    assert!(near_sdk::borsh::to_vec(&p).unwrap().len() < 16 * 1024, "128 rows stay small");
    // A day after those (their rows gone), 64 token payments fill the 128 rows (each also counts its 1 yocto).
    for i in 0..64u64 {
        as_key(PHONE, 3 * DAY + i);
        assert!(p.execute(acct("usdt.tether-token.near"), usdt_pay(1), None).done);
    }
    as_key(PHONE, 3 * DAY + 100);
    assert!(fails(|| p.execute(acct("usdt.tether-token.near"), usdt_pay(1), None)), "the 65th token payment in 24 h");
    assert!(fails(|| p.execute(acct("bob.near"), send(1), None)), "and any NEAR payment");
    // Release 10 (M1/F2): an unmeasurable one counts its NEAR (its gas) too, so it is refused like any other.
    assert!(fails(|| p.execute(acct("x.near"), vec![call("anything", "{}", 0)], None)), "an unmeasurable one too");
    as_key(PHONE, 4 * DAY + 64);
    assert!(p.execute(acct("bob.near"), send(1), None).done, "a day later");
}

/// A-3 (Info, documents): the 128 rows are shared by the old and the new phone: rows the thief's phone filled before the
/// owner's start outlive the finish, so the new phone can't make a measured payment until they are a day old.
#[test]
fn v_a3_info_rows_outlive_a_finish() {
    let mut p = account();
    as_key(PHONE, DAY);
    for i in 0..64u64 {
        as_key(PHONE, DAY + i);
        p.execute(acct("usdt.tether-token.near"), usdt_pay(1), None);
    }
    as_key(WORDS, DAY + 100);
    p.start_recovery(key(NEW_PHONE));
    as_key(WORDS, DAY + 100 + 7 * DAY);
    finish_ok(&mut p);
    // Rows ran at day 1 are a day old by day 2, so they're gone by the finish on day 8: the blockage is at most a day.
    as_key(NEW_PHONE, DAY + 101 + 7 * DAY);
    assert!(p.execute(acct("bob.near"), send(1), None).done);
}

/// A-4: a second device young at the finish leaves (one added in the window, one added during the recovery); one of age
/// stays; the last one gone turns device levels into floor waits.
#[test]
fn v_a4_young_devices_leave_at_finish() {
    let mut p = account_with_aged_laptop();
    as_key(WORDS, 22 * DAY); // release 10 (F1): its laptop on the account for the fallback
    p.start_recovery(key(NEW_PHONE));
    as_key(LAPTOP, 28 * DAY);
    p.approve_recovery(key(NEW_PHONE), U64(29 * DAY * SECOND));
    as_key(WORDS, 29 * DAY);
    finish_ok(&mut p);
    assert_eq!(p.second_device_count(), 1, "the laptop of age stays");
    // Young only: it leaves and the device band becomes a floor wait.
    let mut q = thief_young_laptop_with_device_band();
    as_key(WORDS, 2 * DAY);
    q.start_recovery(key(NEW_PHONE));
    as_key(WORDS, 9 * DAY);
    finish_ok(&mut q);
    assert_eq!(q.second_device_count(), 0);
    assert!(q.protection().iter().all(|b| !matches!(b.level, Level::Device | Level::Both { .. })));
}

/// Leads: a waiting recovery's new key can't become a second device, even through a co-signed add asked before the
/// start; an approval by a since-removed device doesn't protect from a start.
#[test]
fn v_leads_new_key_and_removed_approver() {
    let mut p = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let add = p.add_second_device(key(0x42));
    as_key(LAPTOP, 10 * DAY + 1);
    p.approve(add.id.unwrap());
    as_key(WORDS, 11 * DAY);
    p.start_recovery(key(0x42));
    as_key(PHONE, 18 * DAY);
    assert!(fails(|| p.run(add.id.unwrap())), "the recovery's new key can't be added as a second device");
    assert!(fails(|| p.add_second_device(key(0x42))));
    // Removed approver: a setting co-signed by a laptop that is removed before a start is dropped by it.
    let mut q = account_with_aged_laptop();
    as_key(PHONE, 10 * DAY);
    let x = q.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    let rm = q.remove_key(key(LAPTOP));
    as_key(LAPTOP, 10 * DAY + 1);
    q.approve(x.id.unwrap());
    q.approve(rm.id.unwrap());
    // Re-audit 7 (R7-1): the laptop of age's removal waits the 21-day fallback.
    as_key(PHONE, 31 * DAY + 1);
    q.run(rm.id.unwrap());
    as_key(WORDS, 31 * DAY + 2);
    q.start_recovery(key(NEW_PHONE));
    assert!(q.waiting_requests().is_empty(), "its approver is gone: not co-signed");
}

/// I-A3: the delay is at most 30 days; at 30 days the floor is 31 days and nothing overflows.
#[test]
fn v_delay_bound() {
    reset();
    as_key(SETUP, 0);
    assert!(fails(|| AccountPolicy::new(U64(30 * DAY + 1), default_bands(), Some(key(PHONE)), None)));
    let mut p = AccountPolicy::new(U64(30 * DAY), default_bands(), Some(key(PHONE)), None);
    p.set_recovery_key(key(WORDS));
    as_key(PHONE, 2 * DAY);
    assert_eq!(p.set_protection(default_bands()).ready_at_ns.unwrap().0, (2 * DAY + 31 * DAY) * SECOND);
}

/// R-1 with a setting: on an account whose strictest level needs the second device, an upgrade the phone asks during the
/// recovery needs the device, so a YOUNG device may approve it, and `approve` installs any code while the recovery waits
/// (once the floor has passed and the owner hasn't finished yet).
#[test]
fn r1b_young_device_approve_installs_code_while_the_recovery_waits() {
    let mut p = thief_young_laptop_with_device_band();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(NEW_PHONE));
    as_key(PHONE, t + 1);
    let code = p.upgrade(Base64VecU8(vec![0xAB; 32]));
    assert!(code.needs_device);
    as_key(0x77, t + 8 * DAY + 1);
    let ran = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.approve(code.id.unwrap()))).map(|o| o.done).unwrap_or(false);
    assert!(!ran, "R-1b: a young device's yes switched the code while the owner's recovery waited");
}
