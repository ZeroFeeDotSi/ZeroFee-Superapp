//! Re-audit 2 of the account contract at abdacc1 (release 6; CONTRACT-AUDIT.md, "Re-audit 2"). As before: `n*` tests
//! PASS while their attack works (a fix flips them); `closed_*` try variants of R1–R8 and must keep passing; the fuzz
//! asserts the new rules' properties.
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
const THIEF_WORDS: u8 = 0x99;

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

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn fails<R>(f: impl FnOnce() -> R) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

fn default_bands() -> Vec<Band> {
    vec![
        Band { up_to: Some(vec![("near".into(), U128(200 * NEAR)), (USDC.into(), U128(500_000_000)), (USDT.into(), U128(500_000_000))]), level: Level::FaceId },
        Band { up_to: None, level: Level::Wait { seconds: U64(DAY) } },
    ]
}

/// A release-6 mainnet account as the app makes it: phone named at `new`, first backup key in the setup batch, 7-day
/// recovery, the default bands, no second device.
fn account() -> AccountPolicy {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), default_bands(), Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    p
}

// ══ N1 (Critical) — rule 2 made the phone the master: a stolen phone replaced the words in 24 h and took everything ══

/// FIXED (N1 (a), the owner's choice: the words beat the phone). New backup words asked by the phone wait the floor (8
/// days), not the band's day, and the owner's start drops them; the old words stay, and spending stays frozen while the
/// owner's recovery waits. A stolen phone can't replace the words.
#[test]
fn n1_stolen_phone_replaces_the_backup_words_and_the_owner_cannot_stop_it() {
    let mut p = account();
    let t = 2 * DAY;
    // The thief, with the phone, asks for ITS words (key 0x99): the floor.
    as_key(PHONE, t);
    let swap = p.set_recovery_key(key(THIEF_WORDS));
    assert_eq!(swap.ready_at_ns.unwrap().0, (t + 8 * DAY) * SECOND, "the 8-day floor, not the band's day");
    // The owner starts a recovery with the real words, as late as a day before: the swap goes.
    as_key(WORDS, t + 7 * DAY);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "the owner's start drops the thief's new words");
    as_key(PHONE, t + 8 * DAY);
    assert!(fails(|| p.run(swap.id.unwrap())), "nothing left to run");
    assert!(p.frozen_until().is_some());
    assert!(!p.execute(acct("thief.near"), send(199 * NEAR), None).done, "frozen: nothing at Face ID");
    // Release 10 (R1): new words asked while the recovery waits are placed, but the phone's ask alone can't run in it.
    let swap = p.set_recovery_key(key(THIEF_WORDS));
    as_key(PHONE, t + 7 * DAY + 8 * DAY);
    assert!(fails(|| p.run(swap.id.unwrap())), "and new words asked by the phone alone never run while the recovery waits");
}

/// FIXED (N1 (a)): when the owner was quicker, the phone still cancels at once (no second device), but new words asked
/// then wait the floor from the stop, and the owner's next start drops them.
#[test]
fn n1b_owner_starts_first_thief_cancels_then_swaps() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(0x11));
    as_key(PHONE, t + 1);
    assert!(p.cancel_recovery().done);
    let swap = p.set_recovery_key(key(THIEF_WORDS));
    assert_eq!(swap.ready_at_ns.unwrap().0, (t + 1 + 8 * DAY) * SECOND);
    as_key(WORDS, t + 2);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "dropped by the owner's second start");
    as_key(PHONE, t + 1 + 8 * DAY);
    assert!(fails(|| p.run(swap.id.unwrap())));
}

/// FIXED (N1 (a)): on an account whose strictest band is Face ID (a child's account before pairing, or after the owner
/// loosened it), new words still wait the floor, so the owner's start drops them.
#[test]
fn n1c_face_id_strictest_swaps_the_words_at_once() {
    as_key(SETUP, 0);
    let mut p = AccountPolicy::new(U64(7 * DAY), vec![Band { up_to: None, level: Level::FaceId }], Some(key(PHONE)), None);
    assert!(p.set_recovery_key(key(WORDS)).done);
    as_key(PHONE, 2 * DAY);
    let swap = p.set_recovery_key(key(THIEF_WORDS));
    assert!(!swap.done && swap.ready_at_ns.unwrap().0 == (2 * DAY + 8 * DAY) * SECOND);
    as_key(WORDS, 3 * DAY);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty());
}

/// N1 (a)'s variant: words asked just after the owner's start would outlast it, and a stop late in the recovery would
/// leave them a day from running. So new words asked by the phone alone while a recovery waits never run in it and go
/// at its end (release 10, R1: no longer refused outright): asked after the stop, they wait the whole floor, and the
/// owner has a change's wait to start again.
#[test]
fn n1d_new_words_during_a_recovery_are_refused_so_a_late_stop_leaves_the_owner_a_full_floor() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(0x11));
    as_key(PHONE, t + 60);
    let early = p.set_recovery_key(key(THIEF_WORDS));
    assert!(!early.done, "placed while the recovery waits, never at once");
    as_key(PHONE, t + 7 * DAY - 1);
    assert!(p.cancel_recovery().done);
    assert!(p.waiting_requests().is_empty(), "the stop drops the words asked during the recovery");
    let swap = p.set_recovery_key(key(THIEF_WORDS));
    assert_eq!(swap.ready_at_ns.unwrap().0, (t + 7 * DAY - 1 + 8 * DAY) * SECOND);
    as_key(WORDS, t + 14 * DAY);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty());
}

/// The cost of N1 (a), accepted by the owner (re-audit R2 reopened): leaked words and no second device. The owner's new
/// words are dropped by each start the leaked words make, so the owner stops recovery after recovery and spending stays
/// frozen, but the leaked words take nothing: no payment runs at Face ID, and the phone stops each move. (The app asks
/// for a second device before the vault holds more than $5,000.)
#[test]
fn n1a_cost_leaked_words_freeze_the_owner_but_take_nothing() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t); // the leaked words
    p.start_recovery(key(0x66));
    as_key(PHONE, t + 60);
    assert!(p.cancel_recovery().done);
    let rotate = p.set_recovery_key(key(0xEF));
    assert_eq!(rotate.ready_at_ns.unwrap().0, (t + 60 + 8 * DAY) * SECOND);
    as_key(WORDS, t + 120);
    p.start_recovery(key(0x66));
    assert!(p.waiting_requests().is_empty(), "the leaked words' next start drops the owner's new words");
    as_key(PHONE, t + 120 + DAY);
    assert!(!p.execute(acct("thief.near"), send(NEAR), None).done, "frozen: nothing at Face ID");
    assert!(p.cancel_recovery().done, "the phone stops this move too");
    assert!(p.pending().is_none());
}

// ══ N2 (High) — first 24 h: a young laptop simply ages; the freeze doesn't stop the clock ═══════════════════════════════

/// The thief adds its own laptop in hour 1 (at once, Face ID). While it is young the phone still cancels the owner's
/// recoveries at once (no second device *of age*); the freeze holds spending, but the laptop ages through it. After the
/// floor it is "of age": the freeze is gone and the thief has two of three for good.
/// FIXED (N2): a young laptop's age starts again at every dispute: a recovery start stops its clock, and it counts again
/// only from the freeze's end. Eight days of the owner's recoveries leave it young: the phone still can't co-sign with it,
/// spending stays frozen, and the words still drop what the phone asks.
#[test]
fn n2_young_laptop_ages_through_the_freeze_into_two_of_three() {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done);
    let mut t = 2 * 3_600;
    for _ in 0..8 {
        as_key(WORDS, t);
        p.start_recovery(key(0x11));
        as_key(PHONE, t + 1);
        assert!(p.cancel_recovery().done, "a young laptop doesn't count: the phone cancels at once");
        t += DAY;
    }
    as_key(PHONE, 3_600 + 8 * DAY + 1);
    assert_eq!(p.second_devices_of_age(), 0, "still young: its clock restarted at each dispute");
    assert!(p.frozen_until().is_some(), "and spending is still frozen");
    assert!(!p.execute(acct("thief.near"), send(199 * NEAR), None).done);
    let loosen = p.set_protection(vec![Band { up_to: None, level: Level::FaceId }]);
    as_key(0x77, 3_600 + 8 * DAY + 2);
    assert!(fails(|| p.approve(loosen.id.unwrap())), "can't co-sign");
    as_key(WORDS, 3_600 + 8 * DAY + 3);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "the words drop it");
    // Its age counts only from the end of the last freeze: a change's wait of quiet, then a change's wait more.
    as_key(PHONE, 3_600 + 8 * DAY + 4);
    assert!(p.cancel_recovery().done);
    let quiet = 3_600 + 8 * DAY + 4 + 8 * DAY;
    as_key(PHONE, quiet + 8 * DAY - 1);
    assert_eq!(p.second_devices_of_age(), 0);
    as_key(PHONE, quiet + 8 * DAY);
    assert_eq!(p.second_devices_of_age(), 1);
}

/// The app's "Your laptop counts fully on …" reads `second_device_ages`: the moment each second device is of age, its
/// clock stopped (u64::MAX) while a recovery waits, then counted from the freeze's end, and 0 once it is.
#[test]
fn second_device_ages_says_when_each_counts_fully() {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done);
    let floor = 8 * DAY;
    assert_eq!(p.second_device_ages(), vec![(key(0x77), U64((3_600 + floor) * SECOND))]);
    as_key(WORDS, 2 * DAY);
    p.start_recovery(key(0x11));
    assert_eq!(p.second_device_ages()[0].1, U64(u64::MAX), "stopped while the recovery waits");
    as_key(PHONE, 2 * DAY + 1);
    assert!(p.cancel_recovery().done);
    let full = 2 * DAY + 1 + floor + floor;
    assert_eq!(p.second_device_ages()[0].1, U64(full * SECOND), "from the freeze's end");
    as_key(PHONE, full);
    assert_eq!(p.second_device_ages(), vec![(key(0x77), U64(0))]);
    assert_eq!(p.second_devices_of_age(), 1);
}

/// N2, its clock stopped: a laptop that would come of age while a recovery waits doesn't. Its age counts again only
/// once the recovery ends, so it can't co-sign the phone's stop of that very recovery.
#[test]
fn n2_a_young_laptop_does_not_come_of_age_while_a_recovery_waits() {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(0x77)).done);
    as_key(WORDS, 6 * DAY);
    p.start_recovery(key(0x11));
    as_key(PHONE, 9 * DAY);
    assert_eq!(p.second_devices_of_age(), 0, "it would have been of age on day 8");
    assert!(p.cancel_recovery().done, "so the phone's stop is the phone's alone, and freezes spending");
    assert!(p.frozen_until().is_some());
}

/// N2's other half: a laptop already of age stays of age through a dispute; one added while a recovery waits starts
/// with its clock stopped.
#[test]
fn n2_an_aged_laptop_keeps_its_age_and_one_added_mid_dispute_waits_for_its_end() {
    let mut p = account();
    as_key(PHONE, 3_600);
    assert!(p.add_second_device(key(LAPTOP)).done);
    let t = 10 * DAY;
    as_key(PHONE, t);
    assert_eq!(p.second_devices_of_age(), 1);
    let second = p.add_second_device(key(0x0A));
    as_key(LAPTOP, t + 1);
    p.approve(second.id.unwrap());
    as_key(WORDS, t + 2);
    p.start_recovery(key(0x11));
    assert_eq!(p.second_devices_of_age(), 1, "the aged laptop keeps its age");
    as_key(PHONE, t + 8 * DAY + 2);
    assert!(p.run(second.id.unwrap()).done, "co-signed: it survived the start and runs after its wait");
    as_key(PHONE, t + 30 * DAY);
    assert_eq!(p.second_devices_of_age(), 1, "added while the recovery waits: its clock hasn't started");
    // One stop of a recovery at a time (re-audit 2, low).
    let stop = p.cancel_recovery();
    assert!(!stop.done);
    assert!(fails(|| p.cancel_recovery()), "a second stop while one waits is refused");
}

// ══ Closed variants ═══════════════════════════════════════════════════════════════════════════════════════════════════

#[test]
fn closed_r1_nothing_moves_at_face_id_while_frozen_and_the_freeze_outlasts_a_phone_cancel() {
    let mut p = account();
    let t = 2 * DAY;
    as_key(WORDS, t);
    p.start_recovery(key(0x11));
    as_key(PHONE, t + 1);
    assert!(!p.execute(acct("thief.near"), send(1), None).done);
    assert!(!p.execute_many(vec![Group { receiver_id: acct("a.near"), steps: send(1) }, Group { receiver_id: acct("b.near"), steps: send(1) }]).done);
    assert!(p.cancel_recovery().done);
    let pay = p.execute(acct("thief.near"), send(1), None);
    assert!(!pay.done && pay.ready_at_ns.unwrap().0 >= (t + 1 + 8 * DAY) * SECOND);
    as_key(PHONE, t + 8 * DAY);
    assert!(!p.execute(acct("thief.near"), send(1), None).done, "still frozen a second before the end");
    as_key(WORDS, t + 8 * DAY);
    p.start_recovery(key(0x11));
    assert!(p.waiting_requests().is_empty(), "the next start drops what the thief queued");
}

#[test]
fn closed_r3_lost_laptop_the_phones_stop_runs_after_a_day_testnet_after_30_s() {
    for (delay, stop) in [(7 * DAY, DAY), (60, 30)] {
        as_key(SETUP, 0);
        let mut p = AccountPolicy::new(U64(delay), default_bands(), Some(key(PHONE)), None);
        assert!(p.set_recovery_key(key(WORDS)).done);
        as_key(PHONE, 10);
        assert!(p.add_second_device(key(LAPTOP)).done);
        let t = 30 * DAY; // the laptop is of age, then lost
        as_key(WORDS, t);
        p.start_recovery(key(0x66));
        as_key(PHONE, t + 1);
        let s = p.cancel_recovery();
        assert_eq!(s.ready_at_ns.unwrap().0, (t + 1 + stop) * SECOND);
        as_key(PHONE, t + 1 + stop);
        assert!(p.run(s.id.unwrap()).done && p.pending().is_none());
        // and the stop runs before the recovery could finish
        assert!(stop < delay);
    }
}

#[test]
fn closed_r7_start_recovery_refuses_every_key_in_use() {
    let mut p = account();
    as_key(PHONE, 10);
    assert!(p.add_second_device(key(LAPTOP)).done);
    as_key(WORDS, 2 * DAY);
    for k in [PHONE, LAPTOP, WORDS] {
        assert!(fails(|| p.start_recovery(key(k))), "{k:#x}");
    }
}

// ══ Fuzz: freeze and new words under random interleavings (independent model of the freeze) ══════════════════════════

struct Rng(u64);
impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % n
    }
}

/// No second device. Ops: payments, phone-asked new words, words start, phone cancel, run, finish, time (incl. the
/// floor's and the band's edges). Model: frozen while a recovery waits, and until a phone cancel + floor; a finished
/// recovery ends it (new words don't, N1 (a)). Properties: F1 nothing runs at Face ID while the model says frozen; F2 a
/// payment asked while frozen never runs before its floor; F3 new words never run before the floor and are refused while
/// a recovery waits (release 10, R1: asked then, they are placed and never run: every end drops them); F4 the model and
/// `frozen_until` agree; F5 every start leaves nothing the phone alone asked.
#[test]
fn fuzz_freeze_and_new_words_races() {
    let floor = 8 * DAY;
    let mut stats = [0u64; 4];
    for seed in 1..=400u64 {
        let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
        // A fresh account: the mock keeps storage across testing_env!, so clear the previous seed's module keys.
        let _ = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
        let mut p = account();
        let mut phone = PHONE;
        let mut words = WORDS;
        let mut next = 0x60u8;
        let mut now = 2 * DAY;
        let mut cancel_freeze_until = 0u64;
        let mut asked: std::collections::HashMap<u64, (u64, bool, Option<u8>)> = Default::default();
        let mut asked_during: std::collections::HashSet<u64> = Default::default();
        for _ in 0..60 {
            let frozen = p.pending().is_some() || now < cancel_freeze_until;
            as_key(phone, now);
            assert_eq!(p.frozen_until().is_some(), frozen, "seed {seed}: F4");
            if p.waiting_requests().len() >= 18 {
                let w = p.waiting_requests()[0].id;
                p.cancel(w);
                asked.remove(&w.0);
            }
            let op = r.below(9);
            match op {
                0 | 1 => {
                    let out = p.execute(acct("bob.near"), send((r.below(250) as u128) * NEAR), None);
                    assert!(!(out.done && frozen), "seed {seed}: F1");
                    if out.done {
                        stats[0] += 1;
                    } else {
                        asked.insert(out.id.unwrap().0, (now, frozen, None));
                    }
                }
                2 => {
                    next = next.wrapping_add(1).max(0x60);
                    let during = p.pending().is_some();
                    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| p.set_recovery_key(key(next)))) {
                        Ok(out) => {
                            assert!(!out.done, "seed {seed}: F3 new words at once");
                            asked.insert(out.id.unwrap().0, (now, true, Some(next)));
                            if during {
                                asked_during.insert(out.id.unwrap().0);
                            }
                        }
                        Err(_) => assert!(p.waiting_requests().len() >= 18, "seed {seed}: new words refused"),
                    }
                }
                3 => {
                    if p.pending().is_none() {
                        as_key(words, now);
                        next = next.wrapping_add(1).max(0x60);
                        if !fails(|| p.start_recovery(key(next))) {
                            stats[1] += 1;
                            assert!(p.waiting_requests().is_empty(), "seed {seed}: F5");
                        }
                    }
                }
                4 => {
                    if p.pending().is_some() && p.cancel_recovery().done {
                        cancel_freeze_until = now + floor;
                    }
                }
                5 => {
                    if let Some(w) = p.waiting_requests().get(r.below(20) as usize).cloned() {
                        if now * SECOND >= w.ready_at_ns.0 && !fails(|| p.run(w.id)) {
                            stats[2] += 1;
                            assert!(!asked_during.contains(&w.id.0), "seed {seed}: F3 new words asked during a recovery ran");
                            if let Some((at, special, new_words)) = asked.remove(&w.id.0) {
                                if special {
                                    assert!(now >= at + floor, "seed {seed}: F2/F3 ran before the floor");
                                }
                                if let Some(k) = new_words {
                                    words = k;
                                }
                            }
                        }
                    }
                }
                6 => {
                    if let Some(rec) = p.pending() {
                        if now * SECOND >= rec.ready_at_ns.0 {
                            as_key(words, now);
                            finish_ok(&mut p);
                            stats[3] += 1;
                            phone = rec.new_key.0[1];
                            cancel_freeze_until = 0;
                        }
                    }
                }
                _ => {
                    now += match r.below(4) {
                        0 => 1 + r.below(600),
                        1 => DAY - 1 + r.below(3),
                        2 => floor - 1 + r.below(3),
                        _ => r.below(9 * DAY),
                    };
                }
            }
        }
    }
    eprintln!("REAUDIT2-FUZZ (face_id_runs, starts, held_runs, finishes) = {stats:?}");
    assert!(stats.iter().all(|s| *s > 50), "{stats:?}");
}
