//! Account policy: the one contract on a ZeroFee account. It holds every rule about the account's money and keys.
//!
//! After setup the account has **no full-access key**. NEAR itself restricts each key to a few methods of this
//! contract on this account:
//! - the **device key** (ML-DSA-65, in the phone's secure chip) asks to spend, changes settings, and cancels;
//! - a **second device key** (the laptop, or a spare phone) can only approve or decline a waiting request, say yes to or
//!   refuse a waiting recovery, and refill the backup words' fee allowance (`refill_recovery_key`, at most once a day);
//! - the **recovery key** (rebuilt from the 24 words) can only start and finish moving the account to a new phone, and
//!   end a laptop's dispute (release 10, `end_dispute`).
//!
//! **The laptop veto (release 10, round 2, decision A).** A second device of age may turn down ANY waiting request the
//! phone asked alone, at any time (`decline`): new words, the protection, a further second device, a key's removal, a
//! release's listing, Agent, a payment in a waiting band. Never a second device's removal (audit F2: a hostile laptop
//! always goes, after max(fallback, floor)), never what the phone and a second device of age asked together (two of
//! three), never the words' recovery. Because the thief holds the phone and could ask again after every no, one no drops
//! every request the phone asked alone and opens a dispute for a change's wait (the floor: 72 hours on the app's 48-hour
//! account): the phone alone asks nothing that waits, and the Face ID band pays nothing (the phone's and Agent's
//! payments; the trading wallets are outside this contract). The phone may still ask what needs a second device's yes,
//! cancel, stop a recovery and remove a second device; the backup words end the dispute at once (`end_dispute`). A no
//! needs a request to turn down, so a laptop can't pause the account unless the phone asked something. Residuals: a
//! thief with the phone can still remove the laptop (max(fallback, floor), at least 7 days, shown on the laptop all that
//! time) and then change the words a floor later (at least 10 days in all on the app's account); the words stop it at
//! any point. A hostile laptop of age holds every request the phone asks alone that waits, and its Face ID spending for a
//! floor per no, until its own removal runs: there is no co-sign by the phone and the words, so the owner's changes wait
//! for that removal (at least 10 days in all on the app's account: the removal, then a floor). The words can only lift
//! the pause (`end_dispute`: Face ID pays and the phone asks again), and nothing else helps a payment in a waiting band:
//! `approve` refuses a payment that doesn't need a second device.
//!
//! The contract checks those roles itself too (release 7, the proofs' A1): a second device's or the words' key is refused
//! by every phone method, only a second device may answer, and only the words may start or finish a recovery, so "who
//! may call what" holds even without NEAR's method lists.
//!
//! **Protection by amount.** The person sets bands, each with a level:
//! - Face ID only (the device key's signature);
//! - a wait the phone can cancel;
//! - the second device's approval;
//! - or both.
//!
//! How a request is placed:
//! - Every request counts toward a rolling 24-hour total per coin, so splitting a big payment doesn't dodge its band;
//!   the 24-hour list holds at most 128 coin rows (one for each coin a request moves; a waiting request's rows count
//!   until it runs or goes, and for 24 hours after it runs).
//! - A request whose value the contract can't measure goes to the strictest band. Every call also counts the gas it
//!   carries as NEAR, so no call can burn the balance outside the bands: one measured by its NEAR alone (contract review,
//!   FB-1), and from release 8 a coin's own call too (a 1-unit `ft_transfer_call` to a receiver that spins its gas,
//!   re-score RS-2).
//! - A band waits at most 31 days: the longest change's wait (a 30-day delay plus a day). Release 10 (round 2, E1): what
//!   waited for a second device's yes when the last one goes waits a change's wait from when it was asked, so a lost
//!   laptop holds a payment no longer than its own removal (max(fallback, floor), at most 31 days from that removal's
//!   ask). With the phone lost too, the words' recovery (the fallback, at most 30 days) comes first: up to about 61 days
//!   on a 30-day account before anything above Face ID moves.
//! - So does every change to the protection or the keys, so whoever holds an unlocked phone can't loosen the rules
//!   first. And a change waits at least the recovery delay plus as much again (up to a day more: the floor, 72 hours on
//!   the app's 48-hour account), so the backup words can always stop it first (audit F1). In an account's first 24
//!   hours its set-up steps (its protection, its first second device) skip that floor; an upgrade, a key removed, a
//!   further second device or new backup words never do.
//!
//! **Recovery (release 7).** The recovery key starts adding a new phone; after the delay (the person's choice at `new`,
//! 24 hours to 30 days, never changed afterwards; the app offers 24 h, 48 h (its default), 3 and 7 days), finishing adds
//! that phone's key, restricted like any device key (audit F1). The owner's
//! rule: recovery also needs the second device; during the delay the old phone or the second device can stop a recovery
//! nobody wanted; so someone holding the phone AND the words still needs the second device to finish. Precisely:
//! - starting a recovery drops every waiting request a second device hasn't approved, so the backup words stop what a
//!   phone alone asked for, new backup words too, but never what the phone and a second device asked for together (two
//!   of three); new backup words asked while a recovery waits run in it only co-signed by a second device of age, and
//!   every end of it drops them otherwise (re-audit 2, N1; release 10, R1: no longer refused outright); run, they end it,
//!   and spending stays frozen for the floor unless the yes came from a device on the account for the words-only fallback
//!   wait (round 3, V3-2, as for the phone's stop);
//! - **with a second device of age on the account** (on it for the floor; a young one vouches for nothing), the finish
//!   needs that device's yes to THIS recovery (`approve_recovery`, bound to the recovery's new key and finish time, so a
//!   yes to an earlier or a later recovery never counts, and the device must still be on the account and of age when the
//!   finish runs; release 10, F1: the yes counts only from a device on the account for the words-only fallback wait, so
//!   a laptop the phone added itself can't vouch sooner than the words alone); the delay still applies. The device can
//!   also refuse the recovery at any moment (`refuse_recovery`):
//!   it ends, spending stays frozen for the floor as after the phone's stop, and what the phone asked alone goes. So the
//!   words alone, or the phone and the words together, finish nothing while the owner's second device is there;
//! - **the words-only fallback**, so a lost second device never locks the owner out: without the device's yes the finish
//!   is allowed after the fallback wait from the start: 3 times the delay, at least a week and at most 30 days (7 days
//!   on a 24- or 48-hour account, 9 on 3 days, 21 on 7; `new` may set it longer, up to 30 days). Why: the owner has to
//!   notice from the second device, which shows the waiting recovery, and a week is the longest ordinary stretch away
//!   from it; at 3 times the delay the device's path is always the fast one by a wide margin, so a thief gains nothing by
//!   waiting that the owner can't see and refuse; and 30 days is the longest fallback there is (a band or a change can
//!   wait 31 days: a 30-day delay plus a day), so no lock-out is much longer than a month (on a 30-day account the
//!   fallback equals the delay: the device then adds
//!   nothing, which that account's owner chose by choosing a month). The phone's stop and any device of age's refusal end
//!   it at any time, as any recovery;
//! - **with no second device of age**: as before, the words alone finish after the delay, and the phone can stop it;
//! - re-audit 7: removing a second device of age waits the fallback too (else phone + words would remove it and recover
//!   under the fallback; release 10, V1: any second device, young too, and re-checked when it runs); the phone has ONE
//!   stop per recovery when a device of age is there (no draining its allowance
//!   with refusals), and a stop nobody answered never ends a recovery that device said yes to; a refusal with
//!   `confirm_stop: true` while the phone's stop waits is that device's yes to the stop (two of three, no freeze; a plain
//!   refusal always freezes; release 10, G2: a yes to the stop, either way, only from a device on the account for the
//!   fallback, as a yes to a recovery); `upgrade_check` from an earlier
//!   release gives every second device's key this release's methods; a chain's gas fits one transaction at the door;
//! - finishing deletes every other device key the account knows and seals the list, so neither the old phone nor a key
//!   that never called can act again (an account made by this release names its phone at `new`; an older one learns
//!   each device key the first time it calls, until its first finished recovery);
//! - while a recovery waits, spending is frozen for every account (re-audit 3, A-1): everything the phone asks waits at
//!   least the floor, so the finish drops it; a second device of age may refuse anything the phone asks alone, and only
//!   what it co-signed (or the phone's stop) can run, by `run` or by `approve` (re-check 1, R-1); a yes given while
//!   a device was young never counts as co-signed (R-I1);
//! - the phone can stop a waiting recovery: with no second device of age (on the account for the floor), at once, and
//!   spending then stays frozen for the floor; with one, after a day (half the delay if shorter), unless that device
//!   refuses, or at once if it says yes (re-audit R1, R3). A stop it didn't say yes to freezes spending for the floor
//!   too (re-check 1, R-2: a lost device refuses nothing). Every end of a recovery but its finish (a stop, new backup
//!   words) drops what the phone asked alone during it (re-audit 3, A-2; re-check 1, R-3);
//! - a finish also removes every second device not of age: nobody vouched for it (re-audit 3, A-4).
//!
//! **Release 8 (the blind re-score's items):** a single `execute` carries at most 250 Tgas in all, as a chain does, so
//! nothing is placed that can never run (RS-1); every call's gas counts as NEAR (RS-2, above); a key removal re-checks
//! the backup key when it runs, so it never deletes the words' key even if new words were set to that key after it was
//! asked, nor the waiting recovery's new key or the only phone key (and a finished recovery drops a waiting removal of
//! its new key: R8-F1); and a second device's key is recorded only while NEAR has it: a callback after the add forgets
//! a device whose add failed, and a refill whose delete-and-add failed (the key missing) adds it alone (FB-3).
//!
//! **Release 9 (the second blind re-score's items):** finishing a recovery adds the new phone's key first, and only a
//! callback that saw the add succeed deletes the old keys and seals the list; an add NEAR refused leaves the old phone
//! and the waiting recovery as they were (R8-RS1). An upgrade goes only to a release on the account's own list, and the
//! list grows only by a change a second device of age co-signs, or after the words-only fallback wait (re-score item 2).
//! A second device of age may refill the backup words' fee allowance (I-2). A call's gas counts as NEAR at ten times
//! NEAR's lowest gas price, a conservative bound: a contract can't read the chain's price (I-4). The phone's key keeps
//! no fee limit, on purpose: one that burns down would lock the owner's own phone out, and nobody else can refill it
//! without becoming able to refill it for a thief (I-3, documented in docs/layers/security.md).
//!
//! **Upgrades.** With no full-access key, the code changes only through `upgrade`. It switches the account to a
//! published release (a NEAR global contract, by code hash) and goes through the strictest level, like any key change.
//! The switch and a call to the new code's `upgrade_check` are one batch, so a release that can't read this state, an
//! older one, or code without the check never stays installed (audit F7). Every release keeps `upgrade_check`. That holds
//! from release 5: an account still on v4 switches with v4's own `upgrade`, which doesn't call it (re-audit 3), so only
//! a release the app knows by its hash is ever offered to one.
//!
//! **State layout is frozen.** Every release must read this exact `AccountPolicy` layout. New features keep their own
//! storage keys, and new `Change` or `Step` variants are only ever appended, so an upgrade can never leave existing data
//! unreadable. Release 7 adds two keys: the fallback wait (`recovery_fallback`, written by `upgrade_check` for an account
//! from release 6 at that release's default) and the second device's yes to a recovery (`recovery_yes`).
//!
//! **Release 10: Agent's own key, with a daily limit (src/agent.rs, the `agent` feature).** The phone gives Agent a key
//! that NEAR lets call only `agent_pay`, with a budget per coin. Agent pays only within that budget, AND only where the
//! same payment asked by the phone would run at once with Face ID alone, counting everything paid in the last 24 hours;
//! so Agent's key can never do more than an unlocked phone already could, and a new Agent key waits a change's wait like any key (one set up with a new account, ending with its first day, excepted). While a
//! recovery waits or spending is frozen it pays nothing; a finished recovery deletes its key; the phone's kill switch
//! (`agent_revoke`) deletes it at once. `upgrade_check` from release 9 or earlier gives the phone's keys this release's
//! methods. Also (R9-AL1): a second device co-signs the listing of a new release only once it has been on the account for
//! the words-only fallback wait, so a phone alone never lists one sooner than that.
//!
//! **B4: selling any coin from the Safe, in dollars (src/quote.rs).** A band lists coin amounts, so a coin no band lists
//! took the last band and a coin bought couldn't be sold at Face ID. `execute` (and `level_for`, the same way) may carry
//! 1Click's own signed answer to a real quote that this very request pays: one `mt_transfer` on intents.near to the
//! signed deposit address, of the signed coin and amount, into this account's own NEAR Intents balance (recipient and
//! refund this account, both INTENTS), signed at most 120 s before the block and still open, with no referral,
//! virtual-chain or custom-message field. Then the coin sold counts as the quote's `amountInUsd` of USDC, i.e. against
//! each band's dollar limit (its USDC entry, as the core writes every mainnet band) in the band's own 24-hour budget:
//! Face ID under the limit, the next band above it. Any failed check, or no dollar limit, leaves the request on its
//! per-coin bands. Payments out, chains (`execute_many`) and Agent keep the per-coin bands. 1Click's quote key is a
//! constant in the code: rotating it is a contract release, which reaches an account only through its guarded upgrade
//! path (`upgrade`). The quote must also give back at least 98% of its dollars (`amountOutUsd`) with at most 1% slippage
//! (round 4, B4-1). Residuals: 1Click's quote key AND the phone AND Face ID together can sell inside the dollar limit, at
//! a price that key signs, into this account's own balance; and a thin coin's dollars are 1Click's price for it, which
//! a thin market can make wrong (round 4, C4-L3): the 98% floor bounds the loss on the sale, not the price itself.
//!
//! **No Legacy, no Kids, no standing orders.** Those (modules.rs, the `modules` feature) are compiled out: their methods
//! don't exist, their storage keys and `Change` places stay reserved, and an account still using any of them fails
//! `upgrade_check`, so it stays on the release it has.
//!
//! Only post-quantum (ML-DSA-65) keys are ever added.
//!
//! **Not supported:** meta-transactions (NEP-366). A relayed call carries the RELAYER's key as `signer_account_pk`
//! (nearcore 2.13.4, runtime/runtime/src/actions.rs:521-534: the inner actions' receipt is built with the relayer's
//! `signer_public_key`), a key no role here holds, so every role gate refuses it: it fails closed (an account that still
//! learns its phone keys would learn it as a phone; the app never relays). And an account drained to its storage stake can't be acted on by any of its keys until it is topped up: every
//! key's fees come out of the account's own balance.
use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::{self, Value};
use near_sdk::borsh;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

const ML_DSA_65_TAG: u8 = 2;
const ML_DSA_65_PUBLIC_KEY_LEN: usize = 1952;
const SECOND: u64 = 1_000_000_000;
const DAY_NS: u64 = 86_400 * SECOND;
/// The shortest recovery delay (product decision, 29 Oct): a day on the release; people choose 24 h, 48 h, 3 or 7 days. The
/// `short-waits` feature (the default for `cargo test` and the sandbox copy, never the release wasm, which is built with
/// `--no-default-features` and pinned by its hash) allows 60 seconds so a rehearsal can finish a recovery in real time.
#[cfg(not(feature = "short-waits"))]
const MIN_RECOVERY_DELAY_NS: u64 = DAY_NS;
#[cfg(feature = "short-waits")]
const MIN_RECOVERY_DELAY_NS: u64 = 60 * SECOND;
const MAX_WAIT_NS: u64 = 30 * DAY_NS;
/// The words-only fallback (see the header): 3 times the delay, at least a week and at most 30 days.
const FALLBACK_MULTIPLE: u64 = 3;
const MIN_FALLBACK_NS: u64 = 7 * DAY_NS;
const MAX_FALLBACK_NS: u64 = 30 * DAY_NS;
/// NEAR's most gas for one transaction, so for any step of a payment (proofs P-1: refused at the door, not at `run`).
const MAX_STEP_GAS: u64 = 300_000_000_000_000;
/// The most a chain's steps and links may carry in all (re-audit 7, R7-5): a `run` at NEAR's 300 Tgas must still pay
/// its own execution and the receipts it makes before it attaches that gas (measured on the sandbox suite, section 8d).
const MAX_CHAIN_GAS: u64 = 250_000_000_000_000;
/** yoctoNEAR per unit of gas a call carries counts as. Release 9 (re-score item 4): a contract on NEAR can't read the
 *  chain's gas price (no host function gives it; near-sdk's `env` has none), so the count uses a conservative upper bound
 *  instead: 1,000,000,000 yocto a gas, ten times NEAR's lowest price (100 million, the price mainnet has held). NEAR raises
 *  its price by at most 1% a block, and only while blocks are more than half full, so it reaches ten times the floor
 *  only after about 230 full blocks in a row; releases 7 and 8 counted twice the floor (contract review, FB-1). From NEAR
 *  protocol 85 an allowance is charged at max(gas price, 1,000,000,000) a gas, so this equals that purchase floor: no
 *  headroom above what a key's allowance pays (accepted, I-4). */
const GAS_PRICE_COUNTED: u128 = 1_000_000_000;
const MAX_STEPS: usize = 10;
const MAX_ARGS: usize = 4096;
const MAX_BANDS: usize = 8;
const MAX_COINS: usize = 32;
/// The longest coin name, in a band and in the 24-hour rows (release 10, M2: longer ones are unmeasurable).
const MAX_COIN_NAME: usize = 128;
const MAX_PENDING: usize = 20;
const MAX_GROUPS: usize = 4;
/// The most rows the 24-hour list (`spent`) holds (re-audit 3): every method loads it, so it stays small whatever is sent.
const MAX_SPENT_ROWS: usize = 128;
/** Gas for each link of a chain: the callback that checks one group before starting the next. */
const CHAIN_LINK_GAS: u64 = 20_000_000_000_000;
/// The most the waiting requests may hold, serialized (audit F12): every callback loads and saves the whole state, so it
/// stays small enough for a callback's gas whatever is waiting. Release 10 (round 2, measured on the 4 Nov proofing's
/// sandbox): loading and saving a state of about 128 KB (64 KB waiting plus the rest) took about 6.8 Tgas, and a
/// callback's own fee about 14 Tgas, which the callbacks' reserved gas covers (20 Tgas or more).
const MAX_PENDING_BYTES: usize = 64 * 1024;

/// What NEAR lets each kind of key call on this account. Nothing else is reachable with them.
#[cfg(not(any(feature = "agent", feature = "modules")))]
pub const DEVICE_METHODS: &str = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade";
/// Release 10: and Agent's four (set it up, change its budget, the kill switch, refill its key's fee allowance).
#[cfg(all(feature = "agent", not(feature = "modules")))]
pub const DEVICE_METHODS: &str = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade,agent_set,agent_set_budget,agent_revoke,agent_renew_key";
#[cfg(feature = "modules")]
pub const DEVICE_METHODS: &str = "execute,execute_many,run,cancel,set_protection,add_second_device,remove_key,set_recovery_key,cancel_recovery,upgrade,legacy_setup,legacy_off,legacy_check_in,legacy_cancel_claim,agent_set,agent_set_budget,agent_add_order,agent_resume,agent_pause,agent_remove_order,agent_revoke,agent_renew_key,kids_set,kids_off";
pub const SECOND_DEVICE_METHODS: &str = "approve,decline,approve_recovery,refuse_recovery,refill_recovery_key";
pub const RECOVERY_METHODS: &str = "start_recovery,finish_recovery,end_dispute";
/// The most the recovery key can ever spend on network fees. It can't send money at all. From NEAR protocol 85 an
/// allowance is charged at max(gas price, 1,000,000,000) a gas (0.3 NEAR for 300 Tgas), so a 0.25 NEAR key can attach
/// at most about 240 Tgas to one call.
const RECOVERY_KEY_ALLOWANCE: u128 = 250_000_000_000_000_000_000_000;
/// A second device's fee cap: 1 NEAR (audit F4: with none, a stolen laptop could burn the account's NEAR on failing
/// transactions until nobody can sign). NEAR checks an allowance against the attached gas at a pessimistic price (from
/// protocol 85, max(gas price, 1,000,000,000) a gas: 0.3 NEAR for 300 Tgas), so 1 NEAR passes every real approval; the
/// phone refills it (`add_second_device` again).
const SECOND_DEVICE_ALLOWANCE: u128 = 1_000_000_000_000_000_000_000_000;

/// Methods this account never calls, on any contract (see packages/core/src/dev-signer.ts).
const NEVER_CALLED: [&str; 3] = ["add_public_key", "remove_public_key", "disable_auth_by_predecessor_id"];
const INTENTS: &str = "intents.near";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Level {
    FaceId,
    Wait { seconds: U64 },
    Device,
    Both { seconds: U64 },
}

impl Level {
    fn wait_ns(&self) -> u64 {
        match self {
            Level::Wait { seconds } | Level::Both { seconds } => seconds.0.saturating_mul(SECOND),
            _ => 0,
        }
    }
    fn needs_device(&self) -> bool {
        matches!(self, Level::Device | Level::Both { .. })
    }
    /// At least as strict as `other`: waits at least as long, and needs the device if `other` does.
    fn covers(&self, other: &Level) -> bool {
        self.wait_ns() >= other.wait_ns() && (self.needs_device() || !other.needs_device())
    }
    /// The same wait, without the second device (its removal, audit F3).
    fn without_device(self) -> Level {
        match self {
            Level::FaceId | Level::Device => Level::FaceId,
            Level::Wait { seconds } | Level::Both { seconds } => Level::Wait { seconds },
        }
    }
    /// The same wait, and the second device too (Kids: "the parent says yes").
    #[cfg(feature = "modules")]
    fn with_device(self) -> Level {
        match self {
            Level::FaceId | Level::Device => Level::Device,
            Level::Wait { seconds } | Level::Both { seconds } => Level::Both { seconds },
        }
    }
}

/// One amount band. `up_to` lists the most of each coin this band covers; `None` marks the last band (no limit).
/// Coins: "near", or a NEAR Intents token id ("nep141:<contract>", "nep245:<contract>:<id>", "nep171:<contract>:<id>").
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Band {
    pub up_to: Option<Vec<(String, U128)>>,
    pub level: Level,
}

/// One step of a payment, as in a NEAR transaction: only transfers and calls.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    Transfer { deposit: U128 },
    FunctionCall { method_name: String, args: Base64VecU8, deposit: U128, gas: U64 },
}

/// One receiver and its steps, inside a chain (`execute_many`).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Group {
    pub receiver_id: AccountId,
    pub steps: Vec<Step>,
}

// The payloads of Agent's and Kids' changes. Without `modules` they are `Reserved`: nothing in this release can make one,
// and one stored by an earlier release can't be read, so an account holding one fails upgrade_check and stays where it is.
#[cfg(feature = "agent")]
use agent_limits::{Budget, OrderPlan};
#[cfg(feature = "modules")]
use kids::KidsRules;
#[cfg(not(feature = "agent"))]
type Budget = Reserved;
#[cfg(not(feature = "agent"))]
type OrderPlan = Reserved;
#[cfg(not(feature = "modules"))]
type KidsRules = Reserved;

/// A place kept in `Change` for a module this release doesn't have (Agent, Kids): never made, and never read.
#[cfg(not(feature = "modules"))]
#[derive(Clone, Debug, PartialEq)]
pub struct Reserved;

#[cfg(not(feature = "modules"))]
impl borsh::BorshSerialize for Reserved {
    fn serialize<W: borsh::io::Write>(&self, _: &mut W) -> borsh::io::Result<()> {
        Err(borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "not in this release"))
    }
}

#[cfg(not(feature = "modules"))]
impl borsh::BorshDeserialize for Reserved {
    fn deserialize_reader<R: borsh::io::Read>(_: &mut R) -> borsh::io::Result<Self> {
        Err(borsh::io::Error::new(borsh::io::ErrorKind::InvalidData, "not in this release"))
    }
}

#[cfg(not(feature = "modules"))]
impl near_sdk::serde::Serialize for Reserved {
    fn serialize<S: near_sdk::serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
        Err(near_sdk::serde::ser::Error::custom("not in this release"))
    }
}

#[cfg(not(feature = "modules"))]
impl<'de> near_sdk::serde::Deserialize<'de> for Reserved {
    fn deserialize<D: near_sdk::serde::Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
        Err(near_sdk::serde::de::Error::custom("not in this release"))
    }
}

/// Storage keys only Agent, Legacy and Kids write (modules.rs): kept free in this release, so they can come back.
#[cfg(not(any(feature = "agent", feature = "modules")))]
const MODULE_KEYS: [&[u8]; 5] = [b"legacy", b"agent", b"kids", b"kids_why", b"order_tries"];
/// Release 10 has Agent (its key `agent`), but not Legacy, Kids or standing orders' tries.
#[cfg(all(feature = "agent", not(feature = "modules")))]
const MODULE_KEYS: [&[u8]; 4] = [b"legacy", b"kids", b"kids_why", b"order_tries"];

/// Variants are only ever appended (see "State layout is frozen").
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Spend { receiver_id: AccountId, steps: Vec<Step> },
    SetProtection { bands: Vec<Band> },
    AddSecondDevice { public_key: Base64VecU8 },
    RemoveKey { public_key: Base64VecU8 },
    SetRecoveryKey { public_key: Base64VecU8 },
    /// Several receivers in order, each only if the one before succeeded: one approval for e.g. "move in, then pay".
    SpendMany { groups: Vec<Group> },
    /// Switch to a published release (a global contract, by its sha256).
    Upgrade { code_hash: Base64VecU8 },
    /// Legacy (inheritance) rules, as JSON (the module's config type is JSON-only).
    LegacySetup { config_json: String },
    LegacyOff,
    /// Agent (spending limits): a new agent key with its budget and orders, or a loosening of them.
    AgentSet { public_key: Base64VecU8, budget: Budget, orders: Vec<OrderPlan> },
    AgentSetBudget { budget: Budget },
    AgentAddOrder { plan: OrderPlan },
    AgentResume,
    /// Kids (a child's account): the allowed people and weekly limits, set or switched off by the parent.
    KidsSet { rules: KidsRules },
    KidsOff,
    /// The phone stops a waiting recovery while the account has a second device: that device says yes first (audit F1).
    CancelRecovery,
    /// Release 9: add a release (by its sha256) to the releases this account may upgrade to. Asked by `upgrade` for a hash
    /// not on the list; it runs only co-signed by a second device of age, or once the fallback wait has passed since
    /// `asked_at_ns` (set by the contract when it is asked).
    AllowRelease { code_hash: Base64VecU8, asked_at_ns: U64 },
}

impl Change {
    /// An Agent, Legacy or Kids change.
    #[cfg(not(any(feature = "agent", feature = "modules")))]
    fn is_module(&self) -> bool {
        matches!(
            self,
            Change::LegacySetup { .. } | Change::LegacyOff | Change::AgentSet { .. } | Change::AgentSetBudget { .. } | Change::AgentAddOrder { .. } | Change::AgentResume | Change::KidsSet { .. } | Change::KidsOff
        )
    }
    /// A change release 10 doesn't have: Legacy, Kids, a standing order, Agent's resume (it has AgentSet without orders
    /// and AgentSetBudget).
    #[cfg(all(feature = "agent", not(feature = "modules")))]
    fn is_module(&self) -> bool {
        match self {
            Change::AgentSet { orders, .. } => !orders.is_empty(),
            Change::LegacySetup { .. } | Change::LegacyOff | Change::AgentAddOrder { .. } | Change::AgentResume | Change::KidsSet { .. } | Change::KidsOff => true,
            _ => false,
        }
    }
}

/// The steps of setting an account up, which skip the floor in its first 24 hours (see `place`).
fn is_setup_step(change: &Change) -> bool {
    match change {
        Change::SetProtection { .. } | Change::AddSecondDevice { .. } => true,
        #[cfg(feature = "modules")]
        Change::KidsSet { .. } | Change::KidsOff => true,
        _ => false,
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pending {
    pub id: U64,
    pub change: Change,
    /// Block time (ns) from which it may run.
    pub ready_at_ns: U64,
    pub needs_device: bool,
    pub approved: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PendingRecovery {
    /// The new phone's key: borsh-encoded NEAR public key (tag 2 + 1,952 bytes).
    pub new_key: Base64VecU8,
    pub ready_at_ns: U64,
}

/// The waiting recovery as the app reads it (release 7, `recovery_status`).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryStatus {
    pub new_key: Base64VecU8,
    pub ready_at_ns: U64,
    /// A second device of age is on the account, so the finish needs a yes (or the fallback); any such device may still
    /// refuse it. Release 10 (F1): the yes counts only from a device on the account for the fallback wait.
    pub needs_device: bool,
    /// A second device on the account for the fallback wait said yes to this recovery (release 10, F1).
    pub approved: bool,
    pub fallback_at_ns: U64,
    pub can_finish_at_ns: U64,
    /// The phone's one stop of this recovery (with a second device of age) has been asked already (R7-2): the app can
    /// hide "Stop it" instead of letting the contract refuse a second one.
    pub stop_asked: bool,
}

/// A second device's yes to a recovery (release 7), under its own storage key: the recovery it's for (its new key's
/// sha256 and its finish time) and the device (its key's sha256).
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct RecoveryYes {
    new_key_hash: Vec<u8>,
    ready_at_ns: u64,
    device_hash: Vec<u8>,
}

/// What `execute` and the settings methods answer: done now, or waiting (and for what).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub done: bool,
    pub id: Option<U64>,
    pub ready_at_ns: Option<U64>,
    pub needs_device: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct Spent {
    at_ns: u64,
    id: u64,
    coin: String,
    amount: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct AccountPolicy {
    recovery_delay_ns: u64,
    recovery: Option<PendingRecovery>,
    recovery_key: Option<Vec<u8>>,
    second_devices: Vec<Vec<u8>>,
    bands: Vec<Band>,
    pending: Vec<Pending>,
    spent: Vec<Spent>,
    next_id: u64,
}

#[near]
impl AccountPolicy {
    /// Set up the account's rules. Only the account itself can (during setup, its one-time classical key).
    /// `device_key`: the phone's own key, added in the same setup batch. Named here, the list of device keys is sealed
    /// from the start (audit F1); an app that doesn't name it leaves the list to be learned.
    /// `recovery_delay_seconds`: the person's choice (product decision, 29 Oct), 24 hours to 30 days, 48 hours in the app by
    /// default; it never changes afterwards. `recovery_fallback_seconds`: the words-only fallback wait (see the header);
    /// None takes the default, 3 times the delay (at least a week, at most 30 days). Like the delay, it never changes.
    #[init]
    pub fn new(recovery_delay_seconds: U64, bands: Vec<Band>, device_key: Option<Base64VecU8>, recovery_fallback_seconds: Option<U64>) -> Self {
        only_this_account();
        let recovery_delay_ns = recovery_delay_seconds.0.checked_mul(SECOND).expect("delay too large");
        require!(recovery_delay_ns >= MIN_RECOVERY_DELAY_NS, "the recovery delay must be at least 24 hours");
        require!(recovery_delay_ns <= MAX_WAIT_NS, "the recovery delay can be at most 30 days"); // re-audit 3, I-A3
        let fallback_ns = match recovery_fallback_seconds {
            Some(s) => s.0.checked_mul(SECOND).expect("fallback too large"),
            None => default_fallback_ns(recovery_delay_ns),
        };
        check_fallback(recovery_delay_ns, fallback_ns);
        store_key(FALLBACK_KEY, &fallback_ns);
        // Release 10 (K1): this build is installed, so its `upgrade_check` never runs on this account.
        store_key(INSTALLED_KEY, &RELEASE_BUILD);
        let this = Self { recovery_delay_ns, recovery: None, recovery_key: None, second_devices: vec![], bands: bands.clone(), pending: vec![], spent: vec![], next_id: 1 };
        this.check_bands(&bands);
        // The setup batch's own one-time key signs this and the calls after it (the first backup key); the same batch
        // deletes it from the account, so on the list it can never sign again.
        let keys = match device_key {
            Some(k) => {
                require!(is_ml_dsa_65_key(&k.0), "the phone's key must be post-quantum (ML-DSA-65)");
                vec![k.0, signer_key()]
            }
            None => vec![],
        };
        let sealed = !keys.is_empty();
        store_devices(&Devices { keys, sealed, created_at_ns: Some(env::block_timestamp()) });
        this
    }

    // ── Spending ──────────────────────────────────────────────────────────────────────────────────────────────────

    /// Ask to send money or call another contract. Runs now at the Face ID level; otherwise it waits. `quote` (B4,
    /// src/quote.rs): 1Click's signed answer to a real quote this request pays; when it passes every check, the coin sold
    /// counts as its dollars. Anything else (none, or one that fails) changes nothing.
    pub fn execute(&mut self, receiver_id: AccountId, steps: Vec<Step>, quote: Option<SignedQuote>) -> Outcome {
        only_this_account();
        self.owner_active();
        check_request(&receiver_id, &steps);
        let (moves, near) = moves_and_near(receiver_id.as_str(), &steps);
        let counted = self.priced(receiver_id.as_str(), &steps, moves.as_deref(), quote.as_ref()).or_else(|| moves.clone());
        let level = match &counted {
            Some(m) => self.level_for_moves(m),
            None => self.strictest(),
        };
        #[cfg(feature = "modules")]
        let (level, why) = modules::kids_hold(level, parties(receiver_id.as_str(), &steps).as_deref(), moves.as_deref());
        let level = self.unless_frozen(level);
        let id = self.take_id();
        #[cfg(feature = "modules")]
        modules::kids_held(id, level == Level::FaceId, why, moves.as_deref());
        // Every request counts toward the 24-hour totals at once, even while it waits, so it can't be split around them.
        // One that can't be measured still counts its NEAR (release 10, the 4 Nov proofing, M1/F2: its transfers,
        // attached deposits and gas), as a chain's unmeasurable group does.
        self.count_today(id, counted.unwrap_or_else(|| vec![("near".to_string(), near)]));
        self.place(id, Change::Spend { receiver_id, steps }, level)
    }

    /// Several receivers in one approval, in order: each group runs only if the one before it succeeded. All of them
    /// count together toward the bands.
    pub fn execute_many(&mut self, groups: Vec<Group>) -> Outcome {
        only_this_account();
        self.owner_active();
        check_chain(&groups);
        let mut all: Option<Vec<(String, u128)>> = Some(vec![]);
        // What could be measured counts toward the next 24 hours even when another group can't be (re-audit 3, I-A2).
        let mut measured: Vec<(String, u128)> = vec![];
        #[cfg(feature = "modules")]
        let mut everyone: Option<Vec<AccountId>> = Some(vec![]);
        for group in &groups {
            #[cfg(feature = "modules")]
            {
                everyone = modules::join_parties(everyone, parties(group.receiver_id.as_str(), &group.steps));
            }
            let (m, near) = moves_and_near(group.receiver_id.as_str(), &group.steps);
            match &m {
                Some(m) => m.iter().for_each(|(coin, amount)| add_move(&mut measured, coin, *amount)),
                // Release 10 (M1/F2): a group that can't be measured still counts its NEAR.
                None => add_move(&mut measured, "near", near),
            }
            all = match (all, m) {
                (Some(mut total), Some(m)) => {
                    for (coin, amount) in m {
                        add_move(&mut total, &coin, amount);
                    }
                    Some(total)
                }
                _ => None,
            };
        }
        let level = match &all {
            Some(m) => self.level_for_moves(m),
            None => self.strictest(),
        };
        #[cfg(feature = "modules")]
        let (level, why) = modules::kids_hold(level, everyone.as_deref(), all.as_deref());
        let level = self.unless_frozen(level);
        let id = self.take_id();
        #[cfg(feature = "modules")]
        modules::kids_held(id, level == Level::FaceId, why, all.as_deref());
        self.count_today(id, all.unwrap_or(measured));
        self.place(id, Change::SpendMany { groups }, level)
    }

    /// Switch this account to a published release, through the strictest level. Release 9 (re-score item 2): only to a
    /// release on this account's list (`allowed_releases`). For a hash not on the list this places the addition instead
    /// (`AllowRelease`: it runs co-signed by a second device of age, or after the fallback wait), and the switch is asked
    /// again; a switch asked while that addition waits is placed as well, and runs only once the hash is on the list.
    pub fn upgrade(&mut self, code_hash: Base64VecU8) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(code_hash.0.len() == 32, "a release is named by its 32-byte sha256");
        let id = self.take_id();
        let level = self.strictest();
        let asked = self.pending.iter().any(|p| matches!(&p.change, Change::AllowRelease { code_hash: h, .. } if h.0 == code_hash.0));
        if release_allowed(&code_hash.0) || asked {
            return self.place(id, Change::Upgrade { code_hash }, level);
        }
        self.place(id, Change::AllowRelease { code_hash, asked_at_ns: U64(env::block_timestamp()) }, level)
    }

    /// Release 9 (re-score items 1(b), I-2): a second device of age refills the backup words' fee allowance, as the phone
    /// can. With the phone lost, leaked words could otherwise drain it with junk until the owner's own words and laptop
    /// can't start a recovery. Nothing else changes: the same key, the same two methods, the same 0.25 NEAR.
    /// Release 10 (the 4 Nov proofing, round 2, L3/V-L1): at most once in 24 hours. Each refill is 0.25 NEAR the words'
    /// key can burn, counted nowhere, so a stolen laptop that also has the words could burn NEAR in fees without limit.
    pub fn refill_recovery_key(&mut self) {
        only_this_account();
        self.second_device_gate();
        require!(self.aged(&signer_key()), "a second device added less than a change's wait ago can't refill the backup words yet");
        let now = env::block_timestamp();
        if let Some(last) = load_key::<u64>(WORDS_REFILLED_KEY) {
            require!(now >= last.saturating_add(DAY_NS), "a second device refills the backup words at most once a day");
        }
        store_key(WORDS_REFILLED_KEY, &now);
        let words = self.recovery_key.clone().unwrap_or_else(|| env::panic_str("this account has no backup words"));
        renew_function_call_key(&words, RECOVERY_METHODS, RECOVERY_KEY_ALLOWANCE);
        event("recovery_key_renewed", 1);
    }

    /// Part of a chain: after one group, start the next only if that group succeeded. It reads no state, so it neither
    /// loads nor saves it (release 10, the 4 Nov proofing, M2: each link no longer pays for the whole state).
    #[private]
    pub fn on_group_done(rest: Vec<Group>) {
        // Only success matters, not the returned value: read at most a few bytes of it. A long reply is still a success.
        if matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed)) {
            event("chain_stopped", rest.len() as u64);
            return;
        }
        if let Some((next, more)) = rest.split_first() {
            dispatch_chain(next.clone(), more.to_vec());
        }
    }

    /// Release 8 (FB-3): after a second device's key was added (`refill` false) or refilled (`refill` true), make the
    /// contract's list follow NEAR's. Nothing to do when the receipt succeeded (no state is read). An add that failed (a
    /// low balance: an access key's storage stake, which NEAR counts by a trie id of about 33 bytes plus its method list,
    /// not the ML-DSA key's 1,952 bytes) forgets the device in the contract only (no key is ever
    /// deleted here), so a device recorded but missing on NEAR never counts as of age, never forces a recovery onto the
    /// fallback, and is never refilled in vain. A refill that failed means the key is missing (its delete failed): the key
    /// is added alone. A refill never forgets a device.
    #[private]
    pub fn on_second_device_key(public_key: Base64VecU8, refill: bool) {
        if !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed)) {
            return;
        }
        let mut this: AccountPolicy = env::state_read().unwrap_or_else(|| env::panic_str("account state is missing"));
        // Only a key that is still one of this account's second devices: one removed meanwhile is left as it is.
        if !this.second_devices.contains(&public_key.0) {
            return;
        }
        if refill {
            add_function_call_key(&public_key.0, SECOND_DEVICE_METHODS, SECOND_DEVICE_ALLOWANCE);
            event("second_device_readded", 0);
        } else {
            this.unrecord_second_device(&public_key.0);
            env::state_write(&this);
            event("second_device_not_added", 0);
        }
    }

    /// Release 10 (the 4 Nov proofing, W1): after the backup words' key was added (new words, or the first). Nothing to do
    /// when the add succeeded (no state is read). An add NEAR refused (a balance at the storage edge, or the key already
    /// on NEAR) leaves the account naming words that can't sign: if they are still the account's words, it forgets them,
    /// so the app asks for words again instead of a lost phone meaning no recovery. Those go as any new words (round 2,
    /// X3: the strictest band and the floor), at Face ID only in the set-up window. No key is ever deleted here.
    #[private]
    pub fn on_recovery_words_key(public_key: Base64VecU8) {
        if !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed)) {
            return;
        }
        let mut this: AccountPolicy = env::state_read().unwrap_or_else(|| env::panic_str("account state is missing"));
        if this.recovery_key.as_ref() == Some(&public_key.0) {
            this.recovery_key = None;
            env::state_write(&this);
            event("backup_words_key_not_added", 0);
        }
    }

    /// Run a waiting request once its wait is over (and, if needed, the second device approved it).
    pub fn run(&mut self, id: U64) -> Outcome {
        only_this_account();
        self.owner_active();
        let p = self.find(id.0);
        require!(env::block_timestamp() >= p.ready_at_ns.0, "this request is still waiting");
        require!(!p.needs_device || p.approved, "this request needs your second device's approval");
        // While a recovery waits, only what the phone and a second device asked together runs, and the phone's stop of
        // that recovery (re-audit 3, A-2): the finish drops the rest, so finishing late can't let it through first.
        require!(self.recovery.is_none() || matches!(p.change, Change::CancelRecovery) || self.co_signed(&p), "a move to a new phone is waiting: only what your second device said yes to can run now");
        self.finish(id.0)
    }

    /// The second device approves a waiting request. It runs at once if no wait is left (while a recovery waits, only if
    /// this yes co-signs it).
    pub fn approve(&mut self, id: U64) -> Outcome {
        only_this_account();
        self.second_device_gate();
        let index = self.index(id.0);
        // Its level needs the second device; or it's a change to the account's rules or keys, which the second device may
        // also sign so that it's the phone's and the second device's together (two of three), and then the backup words
        // can't stop it (audit F1). It still waits its time.
        let cancels_recovery = matches!(self.pending[index].change, Change::CancelRecovery);
        require!(self.pending[index].needs_device || is_setting(&self.pending[index].change) || cancels_recovery, "this request doesn't need your second device");
        // Two of three only from a second device that has been on the account for the floor (re-audit R4): one added in
        // the first 24 hours (or by a thief with the phone) can still say yes to what needs it, but its yes doesn't
        // protect a request from the backup words until then.
        let signer = signer_key();
        require!(self.pending[index].needs_device || self.aged(&signer), "a second device added less than a change's wait ago can't co-sign this yet");
        // Release 10 (the 4 Nov proofing, round 2, G2): a yes to the phone's stop of a recovery ends it at once with no
        // freeze, so it needs a device on the account for the words-only fallback, as a yes to a recovery does (F1). A
        // laptop the phone added itself would otherwise come of age (a change's wait) and end every recovery the owner's
        // words start. A device of age may still refuse the recovery (`refuse_recovery`), which freezes spending.
        require!(!cancels_recovery || self.on_for_fallback_hash(&env::sha256(&signer)), "a second device added less than the words-only fallback's wait ago can't say yes to a stop yet: it can refuse the move instead");
        let id_now = self.pending[index].id.0;
        let mut by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
        // A yes from a device not yet of age is kept as such (re-check 1, R-I1): it lets through what needs a device, but
        // never counts as co-signed, even once the device comes of age (no key hashes to nothing). It never replaces an
        // aged device's co-sign of the same request either (contract review, FB-2).
        // Release 10 (the 4 Nov proofing, round 2, C-L1): nor a yes from a device on the account for the fallback by one
        // that is only of age, which would take a listing (R9-AL1) back from the floor to the fallback. A yes replaces the
        // one on record only if it counts at least as much (`yes_rank`).
        let record = if self.aged(&signer) { env::sha256(&signer).to_vec() } else { vec![] };
        let before = by.iter().find(|(i, _)| *i == id_now).map_or(0, |(_, k)| self.yes_rank(k));
        if self.yes_rank(&record) >= before {
            by.retain(|(i, _)| *i != id_now);
            by.push((id_now, record));
            store_key(APPROVERS_KEY, &by);
        }
        self.pending[index].approved = true;
        event("request_approved", id.0);
        // The phone and the second device together stop a recovery at once (two of three against the words). While one
        // waits, a yes runs only what it co-signs (re-check 1, R-1: as in `run`); the rest waits for the recovery's end.
        let may_run = self.recovery.is_none() || self.co_signed(&self.pending[index]);
        // Release 10 (V2): when it may really run (an AllowRelease without a yes from a device on for the fallback waits
        // the fallback): a yes before then is recorded and waits, instead of running a finish that refuses. Round 2 (T1,
        // X1): the same for an Upgrade behind its listing and a second device's removal (`can_run_now`).
        if cancels_recovery || (may_run && self.can_run_now(&self.pending[index])) {
            return self.finish(id.0);
        }
        self.waiting(&self.pending[index].clone())
    }

    /// The second device turns a waiting request down.
    pub fn decline(&mut self, id: U64) {
        only_this_account();
        self.second_device_gate();
        // Round 4 (C4-L1): a no to a request that is already gone (it ran, was cancelled, or a race dropped it) is still
        // a no from a second device of age while the phone has anything else waiting alone: it drops every such request
        // and opens the dispute, as a no to one of them would. Nothing waiting alone: refused, as before (a laptop can't
        // pause the account unless the phone asked something).
        let Some(index) = self.pending.iter().position(|p| p.id.0 == id.0) else {
            require!(self.aged(&signer_key()) && self.pending.iter().any(|q| self.phone_alone(q)), "no such waiting request");
            return self.veto_phone_alone();
        };
        // Only what needed the second device (audit F2): a wait-only request is for the phone (or the words) to stop, and
        // no second device can stop a second device's removal. On a child's account the parent can (audit F3): the
        // child can't remove the parent, and a lost parent device, which declines nothing, still goes after the wait.
        // The phone's cancel of a recovery waits a day and a second device may refuse it (re-audit R3): a safe laptop stops
        // a thief's cancel, and a lost one doesn't block the owner's.
        if matches!(self.pending[index].change, Change::CancelRecovery) {
            require!(self.aged(&signer_key()), "a second device added less than a change's wait ago can't refuse this yet");
            self.drop_pending(id.0, "request_declined");
            return;
        }
        let removes_device = matches!(&self.pending[index].change, Change::RemoveKey { public_key } if self.second_devices.contains(&public_key.0));
        #[cfg(feature = "modules")]
        if removes_device && modules::kids_on() {
            self.drop_pending(id.0, "request_declined");
            return;
        }
        require!(!removes_device, "a second device can't stop a second device's removal");
        // Release 10 (the 4 Nov proofing, round 2: the laptop veto, decision A): two of three decide. What the phone and a
        // second device of age asked together, no second device turns down.
        require!(!self.co_signed(&self.pending[index]), "your phone and a second device asked this together, so it can't be turned down");
        if !self.aged(&signer_key()) {
            // A second device not yet of age turns down only what needs its yes, one at a time, as before.
            require!(self.pending[index].needs_device, "this request doesn't need your second device");
            self.drop_pending(id.0, "request_declined");
            return;
        }
        // A second device of age may turn down anything the phone asked alone, at any time (before, only while a recovery
        // waited: re-audit 3, A-1). The thief holds the phone and could ask again after every no, so one no drops every
        // request the phone asked alone, and opens a dispute for a change's wait (`DISPUTE_KEY`): the phone alone asks
        // nothing that waits, and the Face ID band pays nothing, until it ends or the backup words end it
        // (`end_dispute`). Never a second device's removal (a hostile laptop always goes), the phone's stop of a recovery
        // (its own rules, above) or anything co-signed. It needs a request to turn down: a laptop can't pause the account
        // unless the phone asked something.
        self.veto_phone_alone();
    }

    /// A second device of age's no (the laptop veto): every request the phone asked alone goes, and the dispute opens.
    fn veto_phone_alone(&mut self) {
        let ids: Vec<u64> = self.pending.iter().filter(|q| self.phone_alone(q)).map(|q| q.id.0).collect();
        for i in ids {
            self.drop_pending(i, "request_declined");
        }
        let until = env::block_timestamp().saturating_add(self.floor_ns());
        store_key(DISPUTE_KEY, &until);
        event("dispute_opened", until);
    }

    /// Release 10 (round 2, the laptop veto): a waiting request the phone asked alone, which a second device of age's no
    /// drops: not co-signed, not a second device's removal, not the phone's stop of a recovery.
    fn phone_alone(&self, p: &Pending) -> bool {
        !matches!(&p.change, Change::CancelRecovery)
            && !matches!(&p.change, Change::RemoveKey { public_key } if self.second_devices.contains(&public_key.0))
            && !self.co_signed(p)
    }

    /// Release 10 (round 2, the laptop veto): a second device of age said no, and the dispute it opened hasn't ended.
    fn in_dispute(&self) -> bool {
        env::block_timestamp() < load_key::<u64>(DISPUTE_KEY).unwrap_or(0)
    }

    /// Release 10 (round 2, the laptop veto): while a dispute is open, the Face ID band pays nothing (the phone's and
    /// Agent's payments; the trading wallets are outside this contract).
    pub(crate) fn not_paused(&self) {
        require!(!self.in_dispute(), "Your laptop paused spending. Your backup words can end it now.");
    }

    /// Release 10 (round 2, the laptop veto, and M-I1): a payment's preview refuses what `place` refuses during a dispute,
    /// in the same words: at Face ID, paused; waiting without a second device's yes, the phone's ask alone.
    fn previewed(&self, level: Level) -> Level {
        if self.in_dispute() {
            if level == Level::FaceId {
                self.not_paused();
            }
            require!(level == Level::FaceId || level.needs_device(), DISPUTE_LINE);
        }
        level
    }

    /// Release 10 (round 2, the laptop veto): the backup words end a dispute at once: the Face ID band pays again and the
    /// phone asks again. The words' key's third method (a function-call key: NEAR lets it call only its three).
    pub fn end_dispute(&mut self) {
        only_this_account();
        self.words_gate();
        require!(self.in_dispute(), "nothing is paused");
        env::storage_remove(DISPUTE_KEY);
        event("dispute_ended", env::block_timestamp());
    }

    /// Release 10 (round 2, the laptop veto): until when a second device's no pauses the Face ID band and the phone's
    /// asks alone. None: no dispute.
    pub fn dispute_until(&self) -> Option<U64> {
        self.in_dispute().then(|| U64(load_key::<u64>(DISPUTE_KEY).unwrap_or(0)))
    }

    /// The phone cancels a waiting request.
    pub fn cancel(&mut self, id: U64) {
        only_this_account();
        self.owner_active();
        // Round 4 (C4-1): the phone's cancel of its own stop of a recovery keeps STOP_ASKED_KEY (round 3's A3-I1 cleared
        // it): the phone has ONE stop per recovery whether a second device refused it or the phone withdrew it, so a
        // thief can't cancel and ask again to drain the laptop's refusals (R7-2).
        self.drop_pending(id.0, "request_cancelled");
    }

    // ── Settings: every change goes through the strictest level ──────────────────────────────────────────────

    pub fn set_protection(&mut self, bands: Vec<Band>) -> Outcome {
        only_this_account();
        self.owner_active();
        self.check_bands(&bands);
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, Change::SetProtection { bands }, level)
    }

    pub fn add_second_device(&mut self, public_key: Base64VecU8) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(is_ml_dsa_65_key(&public_key.0), "the second device's key must be post-quantum (ML-DSA-65)");
        if self.second_devices.contains(&public_key.0) {
            // A second device already here: its fee allowance refilled (audit F4), the same key and methods. Nothing else
            // changes, so it goes at once.
            // Release 8 (FB-3): if the delete-and-add fails (the key isn't on NEAR, so the batch's delete fails), the
            // callback adds the key alone: a device recorded but missing is repaired instead of staying unusable.
            let p = renew_function_call_key(&public_key.0, SECOND_DEVICE_METHODS, SECOND_DEVICE_ALLOWANCE);
            then_check_second_device_key(p, &public_key.0, true);
            event("second_device_renewed", 0);
            return Outcome { done: true, id: None, ready_at_ns: None, needs_device: false };
        }
        require!(self.second_devices.len() < 4, "at most four second devices");
        require!(!self.key_in_use(&public_key.0), "that key is already on this account");
        let id = self.take_id();
        // The first second device in an account's first 24 hours (pairing a parent, or the laptop offered at set-up) goes
        // at once; any other waits as a change does (audit F1: or a thief adds their own laptop and has two of three).
        let level = if self.second_devices.is_empty() && self.in_setup_window() { Level::FaceId } else { self.strictest() };
        self.place(id, Change::AddSecondDevice { public_key }, level)
    }

    /// Remove another key: an old phone or a second device. Only through the strictest level.
    pub fn remove_key(&mut self, public_key: Base64VecU8) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(is_ml_dsa_65_key(&public_key.0), "only post-quantum keys are on this account");
        require!(Some(&public_key.0) != self.recovery_key.as_ref(), "the backup key changes only with new backup words");
        require!(public_key.0 != signer_key(), "this phone can't remove its own key");
        // Release 10: Agent's key goes with Agent's rules, by the kill switch (agent_revoke), at once.
        #[cfg(all(feature = "agent", not(feature = "modules")))]
        require!(!agent::agent_key_is(&public_key.0), "Agent's key goes with Agent: use Agent's off switch");
        let id = self.take_id();
        // A second device's removal never needs a second device (audit F3: a lost laptop would lock the account for
        // good, and F2: it can't refuse its own removal). It waits as a change does, at least the fallback for any second
        // device (re-audit 7, R7-1; release 10, V1: see `floor_for`), and the backup words can stop it.
        let level = if self.second_devices.contains(&public_key.0) { self.strictest().without_device() } else { self.strictest() };
        // Release 10 (V1): when it was asked, so the removal re-checks the fallback when it runs (`finish`). Recorded
        // before it is placed (round 2): its Outcome reads it (`runs_at`). A removal always waits, so `place` never runs it.
        let mut asked: Vec<(u64, u64)> = load_key(REMOVALS_ASKED_KEY).unwrap_or_default();
        asked.push((id, env::block_timestamp()));
        store_key(REMOVALS_ASKED_KEY, &asked);
        self.place(id, Change::RemoveKey { public_key }, level)
    }

    /// Add the recovery key (the 24 words). The first time, during onboarding, it's immediate; replacing it later
    /// goes through the strictest level. Release 10 (round 2, X3): so do words asked after NEAR refused new words' add
    /// (W1 forgot them, and the old words were deleted when they ran), past the set-up window: `first_words`.
    pub fn set_recovery_key(&mut self, public_key: Base64VecU8) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(is_ml_dsa_65_key(&public_key.0), "the recovery key must be post-quantum (ML-DSA-65)");
        if self.recovery_key.as_ref() == Some(&public_key.0) {
            // The same backup key: its fee allowance refilled at once (audit F17: leaked words could burn it with junk
            // transactions until the real words couldn't start a recovery). Who it is doesn't change.
            renew_function_call_key(&public_key.0, RECOVERY_METHODS, RECOVERY_KEY_ALLOWANCE);
            event("recovery_key_renewed", 0);
            return Outcome { done: true, id: None, ready_at_ns: None, needs_device: false };
        }
        require!(!self.key_in_use(&public_key.0), "that key is already on this account");
        // While a recovery waits (re-audit 2, N1 (a)) they may be asked, but the phone's ask alone can't run in it (`run`
        // and `approve` run only what a second device of age co-signed) and every end of it drops it (`end_recovery`),
        // so a stop late in the recovery never leaves the words a day from running. Release 10 (the 4 Nov proofing, R1):
        // no longer refused outright, so the phone and a laptop of age replace leaked words while their recovery waits,
        // instead of needing three transactions to land in the gap after a stop before the leaked words start again.
        let id = self.take_id();
        let level = if self.first_words() { Level::FaceId } else { self.strictest() };
        self.place(id, Change::SetRecoveryKey { public_key }, level)
    }

    // ── Recovery (the 24 words) ──────────────────────────────────────────────────────────────────────────────

    pub fn start_recovery(&mut self, new_key: Base64VecU8) {
        only_this_account();
        self.words_gate();
        #[cfg(feature = "modules")]
        require!(!modules::legacy_blocks_recovery(), "an inheritance claim is waiting, so the account can't be moved now");
        require!(self.recovery.is_none(), "a recovery is already waiting; cancel it from your phone or finish it");
        require!(is_ml_dsa_65_key(&new_key.0), "the new key must be a post-quantum (ML-DSA-65) public key");
        require!(!self.key_in_use(&new_key.0), "that key is already on this account"); // re-audit R7
        let now = env::block_timestamp();
        let ready_at_ns = now.checked_add(self.recovery_delay_ns).expect("time overflow");
        now.checked_add(self.fallback_ns()).expect("time overflow");
        self.recovery = Some(PendingRecovery { new_key, ready_at_ns: U64(ready_at_ns) });
        // No yes from before this recovery can count for it (every end of one removes the record; belt and braces).
        env::storage_remove(RECOVERY_YES_KEY);
        env::storage_remove(STOP_ASKED_KEY);
        event("recovery_started", ready_at_ns);
        // Starting a recovery drops every waiting request a second device hasn't approved (audit F1): whoever holds the
        // backup words can stop what a phone alone asked for, a loosening, an upgrade or a big payment, but never what
        // the phone and a second device asked for together. New backup words too: the words beat the phone (re-audit 2,
        // N1 (a), the product's choice): a stolen phone can't replace them, and leaked words can only freeze, never take.
        self.drop_unapproved("request_stopped_by_recovery");
        // A second device not yet of age stops ageing until this recovery ends (re-audit 2, N2).
        self.restart_young_ages(u64::MAX);
    }

    /// The words finish a waiting recovery: after the delay, and, with a second device of age on the account, only with
    /// that device's yes to this recovery or after the fallback wait (release 7, the header).
    ///
    /// Release 9 (re-score R8-RS1): this only adds the new phone's key (after deleting any copy of it left on NEAR by an
    /// earlier finish: re-freeze 2). The rest of the finish (the old keys deleted, the
    /// list sealed, the recovery's end) is `on_recovery_key`, a callback that runs it only once it sees the add succeed.
    /// An add NEAR refuses (a balance at the storage edge: the new key's storage stake) changes nothing: the old phone
    /// keeps its keys and the recovery still waits, so after a top-up the words finish it again. While the add is on its
    /// way the new key can't act as a phone or take another role (`FINISHING_KEY`), and the words can't ask a second finish.
    pub fn finish_recovery(&mut self) {
        only_this_account();
        self.words_gate();
        let pending = self.recovery.clone().unwrap_or_else(|| env::panic_str("no recovery is waiting"));
        let now = env::block_timestamp();
        if let Some(why) = self.finish_blocker(&pending, now) {
            env::panic_str(&why);
        }
        // Release 10 (the 4 Nov proofing, round 2, G-L1): not while an earlier finish's delete of this same key is on its
        // way (R2's mark). This finish's own add could land first and that delete then take the new phone's key off.
        // The mark goes when the delete's receipt has run (`on_recovery_key_deleted`, with gas of its own reserved).
        require!(!deleting_key_is(&pending.new_key.0), "the new phone's key is still being taken off after an earlier try: finish again in a minute");
        // One finish on its way at a time; one whose callback never ran (it can only run out of its reserved gas) may be
        // asked again an hour later.
        if let Some(f) = load_key::<Finishing>(FINISHING_KEY) {
            require!(now >= f.asked_at_ns.saturating_add(FINISH_RETRY_NS), "this move is finishing already");
            // Re-freeze 2 (the fuzzer's RT3-b): a lost finish of another recovery may have left its key on NEAR with
            // the phone's methods; with its record replaced here it would no longer be refused, so it goes (no role can
            // have taken it while the record named it). Its own receipt; it fails harmlessly if the key isn't there.
            if f.new_key != pending.new_key.0 {
                delete_recovery_key(&f.new_key);
            }
        }
        store_key(FINISHING_KEY, &Finishing { new_key: pending.new_key.0.clone(), ready_at_ns: pending.ready_at_ns.0, asked_at_ns: now });
        // Re-freeze 2 (the red team's RT3): the new key may already be on NEAR, left by an earlier finish whose add
        // succeeded but whose callback never ran (or never finished it). Adding it again would fail for ever, so its
        // delete goes first, in a receipt of its own that may fail (the usual case: the key isn't there), and the add
        // follows it whatever its result. Deleting it is always safe: no role can hold a waiting recovery's new key.
        let add = add_after_delete(&pending.new_key.0, DEVICE_METHODS, 0);
        then_finish_recovery(add, &pending, now);
        event("recovery_finishing", now);
    }

    /// Release 9 (R8-RS1): the second half of `finish_recovery`, after its add of the new phone's key. Only when that add
    /// succeeded and the same recovery still waits and may still finish (a device's refusal or the phone's stop may have
    /// ended it meanwhile) does the recovery finish: the new key becomes the only phone and every other device key is
    /// deleted. An add that failed changes nothing (the old keys stay; the recovery still waits). An add that succeeded
    /// for a recovery that didn't finish takes the key off NEAR again, unless a role holds it. Re-freeze 2: only the
    /// callback of the finish now on record acts (`asked_at_ns` names it); one that arrives after a retry replaced its
    /// record does nothing at all, so a late callback can never finish, or delete a key, under the retry's feet.
    #[private]
    pub fn on_recovery_key(new_key: Base64VecU8, ready_at_ns: U64, asked_at_ns: U64) {
        if !load_key::<Finishing>(FINISHING_KEY).is_some_and(|f| f.asked_at_ns == asked_at_ns.0 && f.new_key == new_key.0) {
            event("recovery_finish_superseded", asked_at_ns.0);
            return;
        }
        let added = !matches!(env::promise_result_checked(0, 64), Err(PromiseError::Failed));
        let mut this: AccountPolicy = env::state_read().unwrap_or_else(|| env::panic_str("account state is missing"));
        env::storage_remove(FINISHING_KEY);
        let now = env::block_timestamp();
        let pending = PendingRecovery { new_key, ready_at_ns };
        let same = this.recovery.as_ref() == Some(&pending);
        if added && same && this.finish_blocker(&pending, now).is_none() {
            this.complete_recovery(pending, now);
            env::state_write(&this);
            return;
        }
        if !added {
            event("recovery_key_not_added", now);
            return;
        }
        let k = &pending.new_key.0;
        if !this.second_devices.contains(k) && this.recovery_key.as_ref() != Some(k) && !load_devices().keys.contains(k) {
            // Release 10 (the 4 Nov proofing, R2): refused as the phone (and for any role) until NEAR has deleted it. The
            // delete is a receipt of its own: before it ran, an account that learns its phone keys took it as a phone.
            delete_recovery_key(k);
        }
        event("recovery_not_finished", now);
    }

    /// Release 10 (R2): NEAR ran the delete of a recovery's key that didn't become the phone (or found it gone already):
    /// the key is no longer refused, so a later recovery may choose it again.
    #[private]
    pub fn on_recovery_key_deleted(public_key: Base64VecU8) {
        forget_deleting_key(&public_key.0);
    }

    /// Release 9: the finish of a recovery once its new key is on NEAR (`on_recovery_key`), as in release 8; release 10
    /// adds Agent's revoke (and forgets the key's deletion mark, R2).
    fn complete_recovery(&mut self, pending: PendingRecovery, now: u64) {
        self.recovery = None;
        env::storage_remove(RECOVERY_YES_KEY);
        env::storage_remove(STOP_ASKED_KEY);
        // The new phone is now the only phone (audit F1): every other device key this account knows is deleted, the
        // list is sealed so a key it never saw can't act either, and whatever the old phone asked alone goes (what a
        // second device of age co-signed stays).
        let mut devices = load_devices();
        // The setup batch's one-time key is on the list too, though that batch deleted it: deleting it again fails only its
        // own receipt, and it can never outlive a recovery even if a setup left it.
        for old in devices.keys.iter().filter(|k| **k != pending.new_key.0) {
            delete_key(old);
        }
        devices.keys = vec![pending.new_key.0.clone()];
        devices.sealed = true;
        store_devices(&devices);
        // Release 10 (R2): an earlier finish of this recovery that didn't finish may have marked its key for deletion;
        // it is the phone now.
        forget_deleting_key(&pending.new_key.0);
        self.drop_unapproved("request_stopped_by_recovery");
        // Release 8 (R8-F1, found by the widened fuzzer): a waiting removal of the new phone's key goes too. One asked
        // before the recovery (when that key had no role) and co-signed survives the start; run after this finish, it
        // would delete the only phone. The removal re-checks this when it runs as well (`finish`).
        let removals: Vec<u64> = self.pending.iter().filter(|p| matches!(&p.change, Change::RemoveKey { public_key } if public_key.0 == pending.new_key.0)).map(|p| p.id.0).collect();
        for id in removals {
            self.drop_pending(id, "request_stopped_by_recovery");
        }
        env::storage_remove(FREEZE_KEY);
        // Release 10 (round 2, the laptop veto): a dispute was with the old phone, whose asks went above.
        env::storage_remove(DISPUTE_KEY);
        // Release 10: Agent's key goes with the old phone, and anything for Agent still waiting (co-signed too: the design
        // review's L5). Whoever set it up (a thief with the old phone, too) keeps nothing.
        #[cfg(all(feature = "agent", not(feature = "modules")))]
        self.agent_revoke_on_recovery();
        // A second device not of age goes with the old phone (re-audit 3, A-4): nobody vouched for it, and left on, it
        // would come of age before the new phone's removal of it (which waits a change's wait) could run.
        let young: Vec<Vec<u8>> = self.second_devices.iter().filter(|k| !self.aged(k)).cloned().collect();
        for k in young {
            self.forget_second_device(&k);
        }
        event("recovery_finished", now);
    }

    /// A second device says yes to the waiting recovery (release 7): the words may then finish it after the delay. Release 10
    /// (F1): only a device on the account for the words-only fallback wait.
    /// Bound to the recovery's new key and finish time, so a yes meant for another recovery (an earlier one that ended,
    /// or one started after the device looked) never counts.
    pub fn approve_recovery(&mut self, new_key: Base64VecU8, ready_at_ns: U64) {
        only_this_account();
        self.second_device_gate();
        let pending = self.recovery.clone().unwrap_or_else(|| env::panic_str("no recovery is waiting"));
        require!(pending.new_key.0 == new_key.0 && pending.ready_at_ns.0 == ready_at_ns.0, "that isn't the recovery that is waiting now");
        let signer = signer_key();
        require!(self.aged(&signer), "a second device added less than a change's wait ago can't say yes to a recovery yet");
        // Release 10 (the 4 Nov proofing, F1, the twin of R9-AL1): a yes counts only from a second device on the account
        // for the words-only fallback wait. Whoever holds the phone and the words could otherwise add a laptop of their
        // own (a change's wait), let it come of age (another) and have it say yes: finished in twice the floor plus the
        // delay, under the fallback the design promises. Refusing stays a device of age's (`refuse_recovery`).
        require!(self.on_for_fallback_hash(&env::sha256(&signer)), "a second device added less than the words-only fallback's wait ago can't say yes to a recovery yet");
        store_key(RECOVERY_YES_KEY, &RecoveryYes { new_key_hash: env::sha256(&new_key.0), ready_at_ns: ready_at_ns.0, device_hash: env::sha256(&signer) });
        event("recovery_approved", ready_at_ns.0);
    }

    /// A second device of age stops the waiting recovery (release 7): it ends at once, spending stays frozen for the
    /// floor as after the phone's stop (whoever started it may hold the phone and the words), and what the phone asked
    /// alone during it goes. Release 10 (round 2, G2): a refusal stays a device of age's (a freeze is no loss, and a lost
    /// phone's owner needs it at once), while a yes to the phone's stop needs a device on for the fallback.
    /// `confirm_stop` (re-audit 7, R7-9): only with `true`, and only while the phone's stop is waiting, is the refusal this
    /// device's yes to that stop (the phone and the second device together, two of three: the recovery ends with no
    /// freeze, as `approve` of the stop does). A plain refusal (false, or absent) always freezes: whoever holds the
    /// phone and the words may have placed that stop to lift the freeze.
    pub fn refuse_recovery(&mut self, confirm_stop: Option<bool>) {
        only_this_account();
        self.second_device_gate();
        require!(self.recovery.is_some(), "no recovery is waiting");
        let signer = signer_key();
        require!(self.aged(&signer), "a second device added less than a change's wait ago can't refuse a recovery yet");
        event("recovery_refused", env::block_timestamp());
        let stop = self.pending.iter().find(|p| matches!(p.change, Change::CancelRecovery)).cloned();
        if confirm_stop == Some(true) {
            require!(stop.is_some(), "no stop from the phone is waiting to confirm");
            // Release 10 (round 2, G2): a yes to the stop, as by `approve`: only a device on for the fallback.
            require!(self.on_for_fallback_hash(&env::sha256(&signer)), "a second device added less than the words-only fallback's wait ago can't say yes to a stop yet: refuse without confirming it");
        }
        if let (Some(true), Some(stop)) = (confirm_stop, stop) {
            let mut by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
            by.retain(|(i, _)| *i != stop.id.0);
            by.push((stop.id.0, env::sha256(&signer).to_vec()));
            store_key(APPROVERS_KEY, &by);
            let index = self.index(stop.id.0);
            self.pending[index].approved = true;
            self.finish(stop.id.0);
            return;
        }
        self.end_recovery(true);
    }

    /// The phone stops a waiting recovery: at once with no second device (and spending then stays frozen for a change's
    /// wait); with one, after a day unless that device refuses (audit F1, re-audit R1, R3), and frozen after it too unless
    /// that device said yes (re-check 1, R-2).
    pub fn cancel_recovery(&mut self) -> Outcome {
        only_this_account();
        self.owner_active();
        require!(self.recovery.is_some(), "no recovery is waiting");
        // One stop at a time (re-audit 2, low), and with a second device of age ONE stop per recovery (re-audit 7, R7-2):
        // a thief can't make the second device refuse stop after stop until its fee allowance runs out (300 refusals
        // would drain the laptop's 1 NEAR, and an unanswered stop then ran). The declined stop's recovery is remembered
        // under its own key until the recovery ends.
        require!(!self.pending.iter().any(|p| matches!(p.change, Change::CancelRecovery)), "a stop of this recovery is already waiting");
        if self.aged_second_devices() == 0 {
            // No second device to tell owner from thief (re-audit R1): the phone cancels at once, but everyday spending
            // stays frozen for a change's wait, so a stolen phone takes nothing by cancelling. A second device not yet of
            // age counts its age again only from the freeze's end (re-audit 2, N2).
            self.end_recovery(true);
            return Outcome { done: true, id: None, ready_at_ns: None, needs_device: false };
        }
        // With one: a day's wait (half the recovery's, if that's shorter, so asked early it runs before the delay ends;
        // asked in the last day before the fallback, the words may finish first), and the second device may refuse it, or
        // say yes to it at once (re-audit R3).
        // Round 4b: the words say what happened whether the second device refused the stop or the phone withdrew it (C4-1).
        require!(!env::storage_has_key(STOP_ASKED_KEY), "You already asked one stop for this recovery.");
        store_key(STOP_ASKED_KEY, &true);
        let id = self.take_id();
        let wait = DAY_NS.min(self.recovery_delay_ns / 2) / SECOND;
        self.place(id, Change::CancelRecovery, Level::Wait { seconds: U64(wait) })
    }

    // ── Views ────────────────────────────────────────────────────────────────────────────────────────────────

    /// This release's number (the app's known-contracts versions).
    pub fn release_version(&self) -> u32 {
        RELEASE_VERSION
    }

    /// Called by `upgrade`, on the NEW code, in the same batch as the switch (audit F7). Loading `&self` proves this
    /// release reads the account's state; it must also be the release it came from or a newer one. Every release keeps
    /// this method, with this meaning.
    /// Release 9: `code_hash` is the release being installed, which release 9 on passes (a release can't read its own
    /// code's hash: NEAR's host function for it, `current_contract_code`, is not on every protocol this must run on).
    /// The list of releases this account may upgrade to becomes exactly that hash, or empty when it isn't given (from
    /// release 8 or earlier): a later release is added only by a co-signed or fallback-long `AllowRelease`.
    /// Release 10 (the 4 Nov proofing, K1): it runs once per release on an account. `#[private]` alone lets any of the
    /// account's own keys call it (were NEAR's method lists ever wrong): it would rewrite the release list (an upgrade
    /// after the floor instead of the fallback) or renew every key's allowance. So `new` and this check store the
    /// installed build (`INSTALLED_KEY`), and the check runs only for a newer one; release 9 and earlier store none.
    /// Round 2 (G3): the marker is `RELEASE_BUILD`, not the release number, so a rebuilt release 10 installs over an
    /// earlier build of it (round 1's stored 10) while `release_version` stays 10.
    #[private]
    pub fn upgrade_check(&self, from_version: u32, code_hash: Option<Base64VecU8>) {
        let installed = load_key::<u32>(INSTALLED_KEY).unwrap_or(0);
        require!(installed < RELEASE_BUILD, "this release is installed already: its check runs only when it is installed");
        store_key(INSTALLED_KEY, &RELEASE_BUILD);
        require!(RELEASE_VERSION >= from_version, "a release can't go back to an older one");
        read_all_state();
        #[cfg(not(feature = "modules"))]
        require!(!self.pending.iter().any(|p| p.change.is_module()), "an Agent, Legacy or Kids change is waiting, which this release doesn't have");
        // Release 10: the phone's keys get this release's methods (Agent's four), each in one delete-and-add batch of its
        // own, keeping no fee limit as before (a key no longer on NEAR, like the set-up batch's, fails only its own).
        // Round 4c (the audit's ruling on S1-1): one rule, every install renews EVERY role key (the phones here, the second
        // devices and the words below) to this build's method lists, whatever release or build it comes from. At the
        // most keys (8 phones, 4 second devices, the words: 13 batches) the mock counts 10.9 Tgas of this check's
        // UPGRADE_CHECK_GAS (`r10_round4c_upgrade_check_renews_13_keys_inside_its_gas`); a node's count is the proof.
        #[cfg(feature = "agent")]
        {
            // An older release's Agent (release 3 or 4, with modules) never met release 10's rules (its budget unchecked
            // against the bands, its key's three methods and uncounted allowance): it stays where it is (the diff
            // review's L-1). Turned off there first, the account updates.
            #[cfg(not(feature = "modules"))]
            if from_version < 10 {
                require!(!env::storage_has_key(b"agent"), "this account has an older Agent: turn it off first");
            }
            for key in &load_devices().keys {
                renew_function_call_key(key, DEVICE_METHODS, 0);
            }
        }
        // Release 7: an account from an earlier release gets the fallback wait at this release's default for its delay
        // (its own storage key; nothing else in its state changes). A waiting recovery keeps its finish time.
        if !env::storage_has_key(FALLBACK_KEY) {
            store_key(FALLBACK_KEY, &default_fallback_ns(self.recovery_delay_ns));
        }
        // Release 10 (the 4 Nov proofing, round 2, T2): release 9 kept no record of when a removal was asked, and V1's
        // re-check would read one as its ready time less the floor: a removal of a device of age, which waited the fallback
        // on release 9 already, then ran (fallback - floor) later than it said, past the 31-day longest wait on a 7-day
        // account. Each waiting removal gets a moment no earlier than its ask: release 9 placed a second device of age's
        // removal at least L = max(floor, fallback) after its ask, any other at least the floor after. So: if the device
        // was of age at ready - L, that moment (either it was of age when asked, and ready - L >= ask; or it came of age
        // after the ask, which is then before ready - L); else ready - floor (it wasn't of age at ready - L, so it wasn't
        // when asked either, ages only ever counting forward, and ready - floor >= ask).
        // Round 3 (B3-1): else ready - max(floor, the strictest band's wait). Release 9 placed any other removal at
        // max(that wait, floor) from its ask (`strictest().without_device()` for a second device, the same wait), so
        // ready - floor ran a young device's removal up to (wait - floor) past V1's fallback from its ask: 28 days, not
        // 21, on a 7-day account with a 15-day band. (Bands made stricter between the ask and the upgrade give a moment
        // before the ask; the removal still never runs before release 9's ready time.)
        // Round 4 (D4-1a): and from main's release-10 build (sha 530846…), which predates the install marker: it arrives
        // with from_version 10 and no marker, its removals unstamped as release 9's.
        // Round 4c (S1-1): on EVERY install, not behind a marker: an account that passed through builds 10, 10_002 or
        // 10_003 on its way (9 -> 10 -> 10_002 ...) still holds release 9's unstamped removals, which a gate on the marker
        // left to `removal_asked_at`'s ready - floor (34 days, not 21, on a 7-day account). A removal with a record (every
        // one release 10 asked) is never touched, so an account on the current build sees no change.
        {
            let (floor, long) = (self.floor_ns(), self.fallback_ns().max(self.floor_ns()));
            let young = floor.max(self.strictest().without_device().wait_ns());
            let mut asked: Vec<(u64, u64)> = load_key(REMOVALS_ASKED_KEY).unwrap_or_default();
            let before = asked.len();
            for p in &self.pending {
                let Change::RemoveKey { public_key } = &p.change else { continue };
                if asked.iter().any(|(i, _)| *i == p.id.0) {
                    continue;
                }
                let ready = p.ready_at_ns.0;
                let aged_then = self.second_devices.contains(&public_key.0) && self.aged_at(&env::sha256(&public_key.0), ready.saturating_sub(long));
                asked.push((p.id.0, ready.saturating_sub(if aged_then { long } else { young })));
            }
            if asked.len() != before {
                store_key(REMOVALS_ASKED_KEY, &asked);
            }
        }
        // Round 3 (X3-2): a build before this one (release 9, or round 1's build of release 10) kept no record of when a
        // request that needs a second device's yes was asked (E1's `DEVICE_ASKED_KEY`), so with the last device gone it
        // took now as its ask: a floor after the removal, 62 days on a 30-day account. Each waiting one gets a moment no
        // earlier than its ask: a setting waited at least the floor from its ask, so its ready time less the floor; a
        // payment's ask is before both its ready time and now.
        // Round 4c (S1-1): on every install, as the removals above: a request placed by release 9 and carried through a
        // later build without its record is stamped here; one with a record (every one 10_002 on asked) is never touched.
        {
            let (floor, now) = (self.floor_ns(), env::block_timestamp());
            let mut asked: Vec<(u64, u64)> = load_key(DEVICE_ASKED_KEY).unwrap_or_default();
            let before = asked.len();
            for p in self.pending.iter().filter(|p| p.needs_device) {
                if asked.iter().any(|(i, _)| *i == p.id.0) {
                    continue;
                }
                let ready = p.ready_at_ns.0;
                asked.push((p.id.0, if is_setting(&p.change) { ready.saturating_sub(floor) } else { now.min(ready) }));
            }
            if asked.len() != before {
                store_key(DEVICE_ASKED_KEY, &asked);
            }
        }
        // Re-audit 7 (R7-3): a second device's key from before this release can only approve and decline. Each is given
        // this release's four methods and a fresh allowance here, so an owner's laptop can say yes to, or refuse, a
        // recovery from the first block of the new code (each renewal is one delete-and-add batch of its own; a key no
        // longer on NEAR fails only its own).
        // Release 9 adds a fifth method (`refill_recovery_key`), so an account from release 8 or earlier renews them too.
        // Release 10 (the 4 Nov proofing, A1): from ANY earlier release. `from_version` is the release whose `upgrade` ran
        // this, not the one that last renewed the keys: an account that reached release 9 from release 4 (whose `upgrade`
        // never calls this check) still holds laptop keys that can only approve and decline, and its 9 -> 10 passes 9.
        // Round 4b (R2-1): and from main's release-10 build (no marker, as main's 530846…): it arrives with from_version
        // 10, and its laptop would otherwise never get approve_recovery, refuse_recovery or refill_recovery_key.
        // Round 4c (S1-1): on every install, whatever the marker says: an account that passed through an earlier build
        // on its way may hold a laptop key that missed a renewal. One cheap batch per key, and the check runs once per build.
        for key in &self.second_devices {
            renew_function_call_key(key, SECOND_DEVICE_METHODS, SECOND_DEVICE_ALLOWANCE);
        }
        // Release 10 (round 2, the laptop veto): the backup words' key gets its third method, end_dispute, in one
        // delete-and-add batch of its own (a key not on NEAR fails only its own), with the same 0.25 NEAR allowance.
        // Round 4c (S1-1): on every install (round 4's D4-1b gated it on the marker, and the marker only says which build
        // ran last, not which repairs an account that passed through 10, 10_002 or 10_003 on its way has had).
        if let Some(words) = &self.recovery_key {
            renew_function_call_key(words, RECOVERY_METHODS, RECOVERY_KEY_ALLOWANCE);
        }
        // A second device recorded by release 7 but missing on NEAR (FB-3) is repaired by the phone's refill
        // (`add_second_device` with that key), which from release 8 adds the key alone when it is missing.
        let list: Vec<Vec<u8>> = match code_hash {
            Some(h) => {
                require!(h.0.len() == 32, "a release is named by its 32-byte sha256");
                vec![h.0]
            }
            None => vec![],
        };
        store_key(RELEASES_KEY, &list);
    }

    /// Release 9: the releases (sha256, 32 bytes) this account may upgrade to.
    pub fn allowed_releases(&self) -> Vec<Base64VecU8> {
        load_key::<Vec<Vec<u8>>>(RELEASES_KEY).unwrap_or_default().into_iter().map(Base64VecU8).collect()
    }

    pub fn protection(&self) -> Vec<Band> {
        self.bands.clone()
    }

    /// While spending is frozen (re-audit R1, an account with no second device of a change's age): until when, as it
    /// stands. A waiting recovery holds it at least until that recovery can finish; the phone cancelling it then adds a
    /// change's wait. None: nothing is frozen. Release 10 (the 4 Nov proofing, V3): while a recovery waits, never a moment
    /// already past (one whose finish time passed with nobody finishing it is still frozen now).
    pub fn frozen_until(&self) -> Option<U64> {
        let until: u64 = load_key(FREEZE_KEY).unwrap_or(0);
        let recovery = self.recovery.as_ref().map_or(0, |r| self.can_finish_at_ns(r).max(env::block_timestamp()));
        let end = until.max(recovery);
        (self.recovery.is_some() || env::block_timestamp() < until).then_some(U64(end))
    }

    /// The waiting recovery as it stands (release 7): its new key and delay's end, whether a second device of age must say
    /// yes (`needs_device`), whether one has (`approved`), when the words alone may finish it (`fallback_at_ns`), and the
    /// earliest finish as things stand (`can_finish_at_ns`). None: no recovery is waiting.
    pub fn recovery_status(&self) -> Option<RecoveryStatus> {
        let r = self.recovery.as_ref()?;
        Some(RecoveryStatus { new_key: r.new_key.clone(), ready_at_ns: r.ready_at_ns, needs_device: self.aged_second_devices() > 0, approved: self.recovery_approved(r), fallback_at_ns: U64(self.fallback_at_ns(r)), can_finish_at_ns: U64(self.can_finish_at_ns(r)), stop_asked: env::storage_has_key(STOP_ASKED_KEY) })
    }

    pub fn fallback_seconds(&self) -> U64 {
        U64(self.fallback_ns() / SECOND)
    }

    /// Release 10 (V2): each `ready_at_ns` is when it may really run, as in `Outcome`.
    pub fn waiting_requests(&self) -> Vec<Pending> {
        self.pending.iter().map(|p| Pending { ready_at_ns: U64(self.runs_at(p)), ..p.clone() }).collect()
    }

    /// The level a payment would get now, for the approval sheet to say before anyone signs.
    /// `quote`: as `execute`'s, read the same way (B4).
    pub fn level_for(&self, receiver_id: AccountId, steps: Vec<Step>, quote: Option<SignedQuote>) -> Level {
        // Release 10 (the 4 Nov proofing, round 2, M-I1/F3): it refuses what `execute` refuses, in the same words: the
        // request's own checks, and a 24-hour list with no room for its rows. Before, the sheet showed a level for a
        // payment that could never be placed.
        check_request(&receiver_id, &steps);
        let (m, near) = moves_and_near(receiver_id.as_str(), &steps);
        let counted = self.priced(receiver_id.as_str(), &steps, m.as_deref(), quote.as_ref()).or_else(|| m.clone());
        self.check_rows(counted.as_deref().unwrap_or(&[("near".to_string(), near)]));
        let level = match &counted {
            Some(c) => self.level_for_moves(c),
            None => self.strictest(),
        };
        #[cfg(feature = "modules")]
        let level = modules::kids_level(level, parties(receiver_id.as_str(), &steps).as_deref(), m.as_deref());
        let level = self.previewed(self.unless_frozen(level));
        // Round 3 (B3-2): and a queue with no room for it, as `place` refuses it, unless it runs at once.
        if level != Level::FaceId {
            self.check_room(&Change::Spend { receiver_id, steps });
        }
        level
    }

    /// The level a chain would get now (see `execute_many`).
    pub fn level_for_many(&self, groups: Vec<Group>) -> Level {
        // Release 10 (round 2, M-I1/F3): what `execute_many` refuses, in the same words, its rows as it counts them.
        check_chain(&groups);
        let mut rows: Option<Vec<(String, u128)>> = Some(vec![]);
        let mut measured: Vec<(String, u128)> = vec![];
        for group in &groups {
            let (m, near) = moves_and_near(group.receiver_id.as_str(), &group.steps);
            match &m {
                Some(m) => m.iter().for_each(|(coin, amount)| add_move(&mut measured, coin, *amount)),
                None => add_move(&mut measured, "near", near),
            }
            rows = match (rows, m) {
                (Some(mut total), Some(m)) => {
                    m.iter().for_each(|(coin, amount)| add_move(&mut total, coin, *amount));
                    Some(total)
                }
                _ => None,
            };
        }
        self.check_rows(rows.as_deref().unwrap_or(&measured));
        let level = self.previewed(self.unless_frozen(self.chain_level(&groups)));
        // Round 3 (B3-2): and a queue with no room for it, as `place` refuses it, unless it runs at once.
        if level != Level::FaceId {
            self.check_room(&Change::SpendMany { groups });
        }
        level
    }

    /// A chain's level before a freeze or a dispute (`level_for_many`'s).
    fn chain_level(&self, groups: &[Group]) -> Level {
        let mut all: Vec<(String, u128)> = vec![];
        #[cfg(feature = "modules")]
        let mut everyone: Option<Vec<AccountId>> = Some(vec![]);
        for group in groups {
            #[cfg(feature = "modules")]
            {
                everyone = modules::join_parties(everyone, parties(group.receiver_id.as_str(), &group.steps));
            }
            match moves(group.receiver_id.as_str(), &group.steps) {
                Some(m) => m.into_iter().for_each(|(c, a)| add_move(&mut all, &c, a)),
                None => {
                    #[cfg(feature = "modules")]
                    return modules::kids_level(self.strictest(), None, None);
                    #[cfg(not(feature = "modules"))]
                    return self.strictest();
                }
            }
        }
        let level = self.level_for_moves(&all);
        #[cfg(feature = "modules")]
        let level = modules::kids_level(level, everyone.as_deref(), Some(&all));
        level
    }

    pub fn spent_today(&self) -> Vec<(String, U128)> {
        let mut totals: Vec<(String, u128)> = vec![];
        for s in self.spent.iter().filter(|s| self.counts(s)) {
            add_move(&mut totals, &s.coin, s.amount);
        }
        totals.into_iter().map(|(c, a)| (c, U128(a))).collect()
    }

    pub fn second_device_count(&self) -> u32 {
        self.second_devices.len() as u32
    }

    /// The second devices on the account for a change's wait: only they co-sign a change, refuse the phone's cancel of a
    /// recovery, or keep spending from freezing (re-audit R1, R3, R4).
    pub fn second_devices_of_age(&self) -> u32 {
        self.aged_second_devices() as u32
    }

    /// When each second device counts fully (on the account for a change's wait), for the app's "Your laptop counts fully
    /// on …": 0 once it does, else that moment, or u64::MAX while a recovery waits (its clock is stopped, re-audit 2, N2).
    pub fn second_device_ages(&self) -> Vec<(Base64VecU8, U64)> {
        let ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        let (floor, now) = (self.floor_ns(), env::block_timestamp());
        self.second_devices
            .iter()
            .map(|k| {
                let hash = env::sha256(k);
                let at = ages.iter().find(|(h, _)| *h == hash).map_or(0, |(_, at)| at.saturating_add(floor));
                (Base64VecU8(k.clone()), U64(if now >= at { 0 } else { at }))
            })
            .collect()
    }

    /// Release 10 (the 4 Nov proofing, round 2, T-Info): the backup words' key as this account records it (borsh: tag 2 and
    /// the ML-DSA-65 key). None when it names none: never set, or forgotten after NEAR refused its add (W1). The app reads
    /// this instead of inferring the words from NEAR's key list.
    pub fn backup_key(&self) -> Option<Base64VecU8> {
        self.recovery_key.clone().map(Base64VecU8)
    }

    /// Release 10 (the 4 Nov proofing, round 2, X2/Y4): when each second device's yes to a recovery counts, and its yes
    /// to the phone's stop of one (G2): once it has been on the account for the words-only fallback wait (at least a
    /// change's wait). 0 once it does, else that moment, or u64::MAX while a recovery waits and the device is young (its
    /// clock is stopped, re-audit 2, N2). Before, `second_device_ages` read 0 ("counts fully") for a device whose yes to
    /// a recovery was still refused.
    pub fn second_device_yes_from(&self) -> Vec<(Base64VecU8, U64)> {
        let ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        let (long, now) = (self.fallback_ns().max(self.floor_ns()), env::block_timestamp());
        self.second_devices
            .iter()
            .map(|k| {
                let hash = env::sha256(k);
                let at = ages.iter().find(|(h, _)| *h == hash).map_or(0, |(_, at)| at.saturating_add(long));
                (Base64VecU8(k.clone()), U64(if now >= at { 0 } else { at }))
            })
            .collect()
    }

    /// Same shape as the recovery policy's `pending`, so the phone reads both alike.
    pub fn pending(&self) -> Option<PendingRecovery> {
        self.recovery.clone()
    }

    pub fn delay_seconds(&self) -> U64 {
        U64(self.recovery_delay_ns / SECOND)
    }
}

// ── Internals ────────────────────────────────────────────────────────────────────────────────────────────────────

impl AccountPolicy {
    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    /// B4: a request's rows with the coin it sells counted as dollars, when `quote` passes every check (src/quote.rs) and
    /// the account has a dollar limit (a band that lists USDC, as the core writes every mainnet band); else None, and the
    /// request keeps its per-coin rows. `execute` and `level_for` both ask here, so the preview is what runs.
    fn priced(&self, receiver: &str, steps: &[Step], moves: Option<&[(String, u128)]>, quote: Option<&SignedQuote>) -> Option<Vec<(String, u128)>> {
        let (moves, quote) = (moves?, quote?);
        if !self.bands.iter().any(|b| b.up_to.as_ref().is_some_and(|l| l.iter().any(|(c, _)| c == quote::USDC))) {
            return None;
        }
        quote::priced(receiver, steps, moves, quote)
    }

    fn strictest(&self) -> Level {
        self.bands.last().map(|b| b.level.clone()).unwrap_or(Level::FaceId)
    }

    /// A request's coins into the 24-hour list (re-audit 3): a zero amount counts nothing and adds no row, and the list
    /// holds at most MAX_SPENT_ROWS, so every method that loads it stays far inside a transaction's gas. Past it, a
    /// request that would add a row is refused ("try again tomorrow"), never placed; nothing else is held up. Spending
    /// that still counts: every waiting request, and anything that ran in the last 24 hours.
    fn count_today(&mut self, id: u64, moves: Vec<(String, u128)>) {
        self.prune();
        self.check_rows(&moves);
        let rows: Vec<(String, u128)> = moves.into_iter().filter(|(_, amount)| *amount > 0).collect();
        let now = env::block_timestamp();
        for (coin, amount) in rows {
            self.spent.push(Spent { at_ns: now, id, coin, amount });
        }
    }

    /// Room in the 24-hour list for these rows (each coin moved, not zero): `count_today`'s refusal, and the previews'
    /// (release 10, round 2, F3).
    fn check_rows(&self, moves: &[(String, u128)]) {
        let counted = self.spent.iter().filter(|s| self.counts(s)).count();
        let new = moves.iter().filter(|(_, amount)| *amount > 0).count();
        require!(counted + new <= MAX_SPENT_ROWS, "too many payments in the last 24 hours: try again tomorrow");
    }

    fn counts(&self, s: &Spent) -> bool {
        s.at_ns + DAY_NS > env::block_timestamp() || self.pending.iter().any(|p| p.id.0 == s.id)
    }

    /// The first band whose limits cover this request plus everything already spent in the last 24 hours.
    fn level_for_moves(&self, moves: &[(String, u128)]) -> Level {
        let mut totals: Vec<(String, u128)> = vec![];
        for s in self.spent.iter().filter(|s| self.counts(s)) {
            add_move(&mut totals, &s.coin, s.amount);
        }
        for (coin, amount) in moves {
            add_move(&mut totals, coin, *amount);
        }
        let moving: Vec<&(String, u128)> = totals.iter().filter(|(c, a)| *a > 0 && moves.iter().any(|(m, x)| m == c && *x > 0)).collect();
        for band in &self.bands {
            let fits = match &band.up_to {
                None => true,
                // One budget for the band across its coins (audit F6: "$500 a day" was $500 of each). Every coin moving
                // must be one the band lists; then what each listed coin has moved in the last 24 hours, this request
                // included, as a share of its own limit, added up, is at most the whole.
                Some(limits) => {
                    moving.iter().all(|(coin, _)| limits.iter().any(|(c, _)| c == coin))
                        && limits
                            .iter()
                            .try_fold(0u128, |used, (c, limit)| {
                                let total = totals.iter().find(|(t, _)| t == c).map_or(0, |(_, a)| *a);
                                share_ppm(total, limit.0).and_then(|s| used.checked_add(s))
                            })
                            .is_some_and(|used| used <= PPM)
                }
            };
            if fits {
                return band.level.clone();
            }
        }
        self.strictest()
    }

    /// Run now at the Face ID level; otherwise keep it waiting with its wait and device requirement.
    fn place(&mut self, id: u64, change: Change, level: Level) -> Outcome {
        self.prune();
        let floor = self.floor_for(&change);
        // Release 10 (round 2, the laptop veto): while a second device's no holds, the Face ID band pays nothing, and the
        // phone alone asks nothing that waits. It may still ask what needs a second device's yes, stop a recovery, and
        // remove a second device (which no second device can turn down); the backup words can end the dispute.
        if self.in_dispute() {
            if level == Level::FaceId && floor == 0 {
                if matches!(change, Change::Spend { .. } | Change::SpendMany { .. }) {
                    self.not_paused();
                }
            } else {
                let removes_device = matches!(&change, Change::RemoveKey { public_key } if self.second_devices.contains(&public_key.0));
                require!(level.needs_device() || removes_device || matches!(change, Change::CancelRecovery), DISPUTE_LINE);
            }
        }
        if level == Level::FaceId && floor == 0 {
            self.pending.push(Pending { id: U64(id), change, ready_at_ns: U64(0), needs_device: false, approved: false });
            return self.finish(id);
        }
        require!(!level.needs_device() || !self.second_devices.is_empty(), "this needs a second device, and none is added yet");
        self.check_room(&change);
        let ready_at_ns = env::block_timestamp().checked_add(level.wait_ns().max(floor)).expect("time overflow");
        let p = Pending { id: U64(id), change, ready_at_ns: U64(ready_at_ns), needs_device: level.needs_device(), approved: false };
        // Release 10 (the 4 Nov proofing, round 2, E1): when a request that needs a device's yes was asked, so if the last
        // second device goes it waits a change's wait from then, not from the removal (`unrecord_second_device`).
        if p.needs_device {
            let mut asked: Vec<(u64, u64)> = load_key(DEVICE_ASKED_KEY).unwrap_or_default();
            asked.retain(|(i, _)| self.pending.iter().any(|q| q.id.0 == *i && q.needs_device));
            asked.push((id, env::block_timestamp()));
            store_key(DEVICE_ASKED_KEY, &asked);
        }
        let out = self.waiting(&p);
        event("request_waiting", id);
        self.pending.push(p);
        out
    }

    /// Room in the queue for one more waiting request: `place`'s refusals, and the previews' (round 3, B3-2).
    fn check_room(&self, change: &Change) {
        // Release 10 (the 4 Nov proofing, F-L1, H-8): never the phone's stop of a recovery, so a full queue can't keep the
        // phone from stopping one. It is one at most (STOP_ASKED_KEY, and one waiting at a time) and a few bytes.
        let stop = matches!(change, Change::CancelRecovery);
        require!(stop || self.pending.len() < MAX_PENDING, "too many requests are waiting; finish or cancel some first");
        let size = borsh::to_vec(&self.pending).map(|b| b.len()).unwrap_or(usize::MAX).saturating_add(borsh::to_vec(change).map(|b| b.len()).unwrap_or(usize::MAX));
        require!(stop || size <= MAX_PENDING_BYTES, "too much is waiting; finish or cancel some first");
    }

    /// The least a change waits whatever its level (release 8: moved out of `place` unchanged, so the proofs can check it
    /// alone): a setting's floor, and for a second device of age's removal the fallback if that's longer.
    fn floor_for(&self, change: &Change) -> u64 {
        // A change to the account's rules or keys waits longer than a recovery takes (audit F1), so whoever holds the
        // backup words can always stop it first by starting one. Except the first backup key (onboarding), and in an
        // account's first 24 hours the steps of setting it up: its protection, a second device, a child's rules. Never
        // an upgrade, a key removed, new words or Legacy. Agent's own exceptions follow: a budget that only tightens, and
        // the one first-day Agent.
        // Release 10 (the 4 Nov proofing, round 2, G1): of second devices, only the first (pairing at set-up); every other
        // waits the floor like any new key, as `add_second_device` says (a thief with the phone in hour one would otherwise
        // add laptops of his own with no floor).
        let later_device = matches!(change, Change::AddSecondDevice { .. }) && !self.second_devices.is_empty();
        let setting_up = self.in_setup_window() && is_setup_step(change) && !later_device;
        // Release 10: a new Agent key, or a looser budget, waits the floor like any setting (the design review's H1: a
        // thief with an unlocked phone would otherwise leave with a key of his own that keeps paying after the phone is
        // back). Only a budget that tightens every limit runs at once.
        #[cfg(all(feature = "agent", not(feature = "modules")))]
        if let Change::AgentSetBudget { budget } = change {
            if agent::tightens(budget) {
                return 0;
            }
        }
        // And one Agent set up with a new account, in its first 24 hours, whose budget ends with that window, runs at once
        // (the diff review's M-1: at most one such day of the Face ID band, which the phone could pay itself); round 2
        // (L2): only while Face ID alone could pay its key's allowance (`first_day_agent`).
        #[cfg(all(feature = "agent", not(feature = "modules")))]
        if let Change::AgentSet { budget, .. } = change {
            if self.first_day_agent(budget) {
                return 0;
            }
        }
        // New backup words wait the floor like any change, so a start drops them (re-audit 2, N1 (a)). Release 10 (round
        // 2, X3): the first words are only the account's first (`first_words`).
        let first_backup_key = matches!(change, Change::SetRecoveryKey { .. } if self.first_words());
        let mut floor = if is_setting(change) && !setting_up && !first_backup_key {
            self.floor_ns()
        } else {
            0
        };
        // Re-audit 7 (R7-1): removing a second device of age waits the fallback as well, if that's longer. Otherwise
        // whoever holds the phone and the words removes the laptop (it can't refuse its own removal, F2) and recovers
        // without it in floor + delay, under the fallback the design promises. The laptop, which shows the removal, has
        // the whole fallback to tell the owner, whose words then start a recovery (dropping the removal) and whose laptop
        // approves it. A lost laptop still goes (F3), only later.
        // Release 10 (the 4 Nov proofing, V1): any second device, young too. A removal asked while it was young waited
        // only the floor, ran after it had come of age, and phone + words then recovered without it under the fallback.
        if let Change::RemoveKey { public_key } = change {
            if self.second_devices.contains(&public_key.0) {
                floor = floor.max(self.fallback_ns());
            }
        }
        floor
    }

    fn waiting(&self, p: &Pending) -> Outcome {
        Outcome { done: false, id: Some(p.id), ready_at_ns: Some(U64(self.runs_at(p))), needs_device: p.needs_device && !p.approved }
    }

    /// When a waiting request may run (release 10, the 4 Nov proofing, V2): its ready time; for an AllowRelease not
    /// co-signed by a second device on the account for the fallback wait, no sooner than the fallback from when it was
    /// asked (`finish` refuses it before). What `Outcome` and `waiting_requests` report.
    /// Round 2 (T1, Y3, X1, L1): and every other request `finish` holds past its ready time. An Upgrade to a release not
    /// on the list runs no sooner than its waiting listing (an AllowRelease of the same hash); a removal of a key that is
    /// now a second device, no sooner than the fallback from when it was asked (V1's re-check in `finish`).
    fn runs_at(&self, p: &Pending) -> u64 {
        let long = self.fallback_ns().max(self.floor_ns());
        match &p.change {
            Change::AllowRelease { asked_at_ns, .. } if !(self.co_signed(p) && self.approver_on_for_fallback(p.id.0)) => p.ready_at_ns.0.max(asked_at_ns.0.saturating_add(long)),
            Change::Upgrade { code_hash } if !release_allowed(&code_hash.0) => {
                let listing = self.pending.iter().find(|q| matches!(&q.change, Change::AllowRelease { code_hash: h, .. } if h.0 == code_hash.0));
                p.ready_at_ns.0.max(listing.map_or(0, |q| self.runs_at(q)))
            }
            Change::RemoveKey { public_key } if self.second_devices.contains(&public_key.0) => p.ready_at_ns.0.max(removal_asked_at(p.id.0, p.ready_at_ns.0, self.floor_ns()).saturating_add(long)),
            _ => p.ready_at_ns.0,
        }
    }

    /// Round 2 (T1, X1): `finish` would run this request now as far as its time and its release's listing go. `approve`
    /// runs it only then; before, it records the yes and answers when it can run, so no yes is lost to a refused finish.
    fn can_run_now(&self, p: &Pending) -> bool {
        env::block_timestamp() >= self.runs_at(p) && !matches!(&p.change, Change::Upgrade { code_hash } if !release_allowed(&code_hash.0))
    }

    /// A key already on the account in some role: a phone, a second device, the backup key or Agent's (audit F10, F14,
    /// F15). A key never takes a second role.
    pub(crate) fn key_in_use(&self, key: &[u8]) -> bool {
        // And a waiting recovery's new key (re-audit 3): it becomes the phone when the recovery finishes, so nothing else may
        // take it meanwhile (as a second device it would make that finish fail to add it, after deleting the old phone).
        let known = self.second_devices.iter().any(|k| k == key)
            || self.recovery_key.as_deref() == Some(key)
            || load_devices().keys.iter().any(|k| k == key)
            || self.recovery.as_ref().is_some_and(|r| r.new_key.0 == key)
            // Release 9 (R8-RS1): and a finishing recovery's new key, which may be on NEAR before its callback ran.
            || finishing_key_is(key)
            // Release 10 (R2): and one on its way off NEAR after a finish that didn't finish.
            || deleting_key_is(key);
        #[cfg(feature = "modules")]
        let known = known || modules::agent_key_is(key);
        #[cfg(all(feature = "agent", not(feature = "modules")))]
        let known = known || agent::agent_key_is(key);
        known
    }

    /// New backup words are the account's first, which go at Face ID with no floor: it names no words, and either none
    /// were ever set or it is still in its set-up window. Release 10 (the 4 Nov proofing, round 2, X3): after NEAR refused
    /// new words' add, W1's callback forgets them (the old words were deleted when they ran), and the next words were
    /// taken as the first: whoever held the phone set words of their own at once, even where changes need the laptop.
    /// Round 3 (FB3-1): never during a laptop's dispute, where they are the phone's ask alone like any other change.
    fn first_words(&self) -> bool {
        !self.in_dispute() && self.recovery_key.is_none() && (!env::storage_has_key(WORDS_ONCE_KEY) || self.in_setup_window())
    }

    /// The account's first 24 hours, for an account made by this release (an older one has none).
    fn in_setup_window(&self) -> bool {
        load_devices().created_at_ns.is_some_and(|t| env::block_timestamp() < t.saturating_add(DAY_NS))
    }

    /// A waiting recovery ends other than by its finish: the phone's stop, or new words (re-check 1, R-3: every such path
    /// comes here). What the phone asked alone during it goes (re-audit 3, A-2): it waited the floor from when it was
    /// asked, so an end late in the recovery would leave it a day from running. `freeze`: no second device of age said yes
    /// to the end, so everyday spending stays frozen for a change's wait (re-audit R1; re-check 1, R-2: a stop that waited
    /// out its day too), and a second device not yet of age counts again only from the freeze's end (re-audit 2, N2).
    fn end_recovery(&mut self, freeze: bool) {
        let now = env::block_timestamp();
        if self.recovery.take().is_some() {
            event("recovery_cancelled", now);
        }
        env::storage_remove(RECOVERY_YES_KEY);
        env::storage_remove(STOP_ASKED_KEY);
        if freeze {
            let until = now.saturating_add(self.floor_ns());
            store_key(FREEZE_KEY, &until);
            self.restart_young_ages(until);
        } else {
            // A freeze already running stays to its end (re-audit 2, N1 (a)).
            self.restart_young_ages(now.max(load_key(FREEZE_KEY).unwrap_or(0)));
        }
        self.drop_unapproved("request_stopped_by_recovery");
    }

    /// Drop every waiting request a second device hasn't approved, or approved before it had been on the account for
    /// the floor (a recovery starting or finishing; re-audit R4).
    fn drop_unapproved(&mut self, name: &str) {
        let ids: Vec<u64> = self.pending.iter().filter(|p| !self.co_signed(p)).map(|p| p.id.0).collect();
        for id in ids {
            self.drop_pending(id, name);
        }
    }

    /// A second device off the account: the contract forgets it (`unrecord_second_device`: its record and its age, and
    /// with the last one gone every level that needed one waits instead, at least as long as a change does, audit F3: a
    /// stricter band stays stricter, and nothing is ever left needing a device that isn't there; release 10, C1: a
    /// waiting request either), and NEAR deletes its key.
    fn forget_second_device(&mut self, key: &[u8]) {
        self.unrecord_second_device(key);
        delete_key(key);
    }

    /// The contract's side of `forget_second_device`, NEAR's key list untouched (release 8, FB-3: a device whose add NEAR
    /// refused; the callback never deletes a key, so a failed add can't remove a key that was already there).
    fn unrecord_second_device(&mut self, key: &[u8]) {
        self.second_devices.retain(|k| k != key);
        let mut ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        let gone = env::sha256(key);
        ages.retain(|(k, _)| *k != gone);
        store_key(DEVICE_AGES_KEY, &ages);
        if self.second_devices.is_empty() {
            let floor_s = self.floor_ns() / SECOND;
            for band in self.bands.iter_mut().filter(|b| b.level.needs_device()) {
                band.level = Level::Wait { seconds: U64(band.level.wait_ns().div_ceil(SECOND).max(floor_s)) };
            }
            // Release 10 (the 4 Nov proofing, C1): and what waits for a device's yes now waits a change's wait instead
            // (at least as long as it already had to), so it can run, and its 24-hour rows don't count for ever. Round 2
            // (E1): a change's wait from when it was asked, as if asked at that level, not from now: from now, the last
            // device's removal (max(fallback, floor)) and then a floor held it 62 days on a 30-day account, past the
            // longest wait. A request with no ask on record (placed by an earlier build) takes the earlier of now and its
            // ready time, either no earlier than its ask, so it never waits less than from its ask.
            // Round 3 (X3-1): that is a payment's. A change to the rules or keys waits a floor from now (the removal), as
            // the header says: new words asked with the laptop's removal ran WITH it (7 days on the app's account), not a
            // floor after it (at least 10), so the words had no time to stop them once the laptop was gone.
            let (now, floor) = (env::block_timestamp(), self.floor_ns());
            let asked: Vec<(u64, u64)> = load_key(DEVICE_ASKED_KEY).unwrap_or_default();
            for p in self.pending.iter_mut().filter(|p| p.needs_device && !p.approved) {
                let from = if is_setting(&p.change) { now } else { asked.iter().find(|(i, _)| *i == p.id.0).map_or(now.min(p.ready_at_ns.0), |(_, at)| *at) };
                p.needs_device = false;
                p.ready_at_ns = U64(p.ready_at_ns.0.max(from.saturating_add(floor)));
            }
            let left: Vec<(u64, u64)> = asked.into_iter().filter(|(i, _)| self.pending.iter().any(|q| q.id.0 == *i && q.needs_device)).collect();
            if left.is_empty() {
                env::storage_remove(DEVICE_ASKED_KEY);
            } else {
                store_key(DEVICE_ASKED_KEY, &left);
            }
        }
    }

    /// Asked by the phone and a second device together: approved by one that is still a second device and was of age
    /// (re-audit R4; re-audit 3: one removed since leaves no age record, and an unknown approver would read as one from
    /// before ages were kept). An approval with no approver on record (made before they were kept) counts.
    /// Release 10 (R9-AL1): the second device whose yes request `id` has, on the account for the words-only fallback wait
    /// (at least a change's wait). No approver on record: no (every release with AllowRelease records them). A device with
    /// no age record is one from before ages were kept, as in `aged`.
    fn approver_on_for_fallback(&self, id: u64) -> bool {
        let by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
        let Some((_, hash)) = by.iter().find(|(i, _)| *i == id) else { return false };
        self.on_for_fallback_hash(hash)
    }

    /// Release 10 (the 4 Nov proofing, round 2, C-L1): how much a recorded yes counts: 2 from a second device on the account
    /// for the fallback, 1 from one of age, 0 from one not of age (an empty record) or no longer on the account.
    fn yes_rank(&self, hash: &[u8]) -> u8 {
        if hash.is_empty() || !self.second_devices.iter().any(|d| env::sha256(d) == hash) || !self.aged_hash(hash) {
            0
        } else if self.on_for_fallback_hash(hash) {
            2
        } else {
            1
        }
    }

    /// Has this second device (its key's sha256) been on the account for the words-only fallback wait (at least a
    /// change's wait)? One with no age record is from before ages were kept, as in `aged`. Release 10: a release's listing
    /// (R9-AL1) and a yes to a recovery (F1) count only from such a device.
    fn on_for_fallback_hash(&self, hash: &[u8]) -> bool {
        let ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        let long = self.fallback_ns().max(self.floor_ns());
        ages.iter().find(|(k, _)| k.as_slice() == hash).map_or(true, |(_, at)| env::block_timestamp() >= at.saturating_add(long))
    }

    fn co_signed(&self, p: &Pending) -> bool {
        let by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
        p.approved && by.iter().find(|(i, _)| *i == p.id.0).map_or(true, |(_, k)| self.second_devices.iter().any(|d| env::sha256(d) == *k) && self.aged_hash(k))
    }

    /// A change's wait: the recovery delay plus as much again, up to a day more (audit F1).
    fn floor_ns(&self) -> u64 {
        self.recovery_delay_ns + self.recovery_delay_ns.min(DAY_NS)
    }

    /// The words-only fallback wait (release 7). An account from before this release reads the default for its delay
    /// until `upgrade_check` has stored it (the same number).
    fn fallback_ns(&self) -> u64 {
        load_key(FALLBACK_KEY).unwrap_or_else(|| default_fallback_ns(self.recovery_delay_ns))
    }

    /// When the words alone may finish this recovery: the fallback wait from its start.
    fn fallback_at_ns(&self, r: &PendingRecovery) -> u64 {
        r.ready_at_ns.0.saturating_sub(self.recovery_delay_ns).saturating_add(self.fallback_ns())
    }

    /// Why this recovery can't finish now, or None when it can (release 9: checked by `finish_recovery` and again by its
    /// callback): before its delay's end; or, with a second device of age on the account and no yes from one to this
    /// recovery, before the fallback.
    fn finish_blocker(&self, r: &PendingRecovery, now: u64) -> Option<String> {
        if now < r.ready_at_ns.0 {
            return Some(format!("the recovery can finish in {} seconds", (r.ready_at_ns.0 - now) / SECOND));
        }
        if self.aged_second_devices() > 0 && !self.recovery_approved(r) {
            let fallback_at = self.fallback_at_ns(r);
            if now < fallback_at {
                return Some(format!("your second device hasn't said yes to this recovery: without it, the recovery can finish in {} seconds", (fallback_at - now) / SECOND));
            }
        }
        None
    }

    /// Has a second device, still on the account and on it for the words-only fallback wait (release 10, F1), said yes to
    /// exactly this recovery (release 7)?
    fn recovery_approved(&self, r: &PendingRecovery) -> bool {
        let Some(yes) = load_key::<RecoveryYes>(RECOVERY_YES_KEY) else { return false };
        yes.new_key_hash == env::sha256(&r.new_key.0) && yes.ready_at_ns == r.ready_at_ns.0 && self.second_devices.iter().any(|d| env::sha256(d) == yes.device_hash) && self.on_for_fallback_hash(&yes.device_hash)
    }

    /// The earliest the words may finish this recovery as things stand: after the delay with no second device of age or
    /// with one's yes; else the fallback.
    fn can_finish_at_ns(&self, r: &PendingRecovery) -> u64 {
        if self.aged_second_devices() == 0 || self.recovery_approved(r) {
            r.ready_at_ns.0
        } else {
            r.ready_at_ns.0.max(self.fallback_at_ns(r))
        }
    }

    /// Only a second device of this account (release 7, A1): its methods are its own.
    fn second_device_gate(&self) {
        require!(self.second_devices.contains(&signer_key()), "only a second device of this account can do this");
    }

    /// Only the backup words' key (release 7, A1).
    fn words_gate(&self) {
        require!(self.recovery_key.as_ref() == Some(&signer_key()), "only the backup words can do this");
    }

    /// Has this second device been on the account for a change's wait? One added before ages were kept: yes.
    fn aged(&self, key: &[u8]) -> bool {
        self.aged_hash(&env::sha256(key))
    }

    fn aged_hash(&self, hash: &[u8]) -> bool {
        self.aged_at(hash, env::block_timestamp())
    }

    /// Was this second device (its key's sha256) of age at `t`? One with no age record is from before ages were kept.
    fn aged_at(&self, hash: &[u8], t: u64) -> bool {
        let ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        ages.iter().find(|(k, _)| k.as_slice() == hash).map_or(true, |(_, at)| t >= at.saturating_add(self.floor_ns()))
    }

    /// The second devices that tell owner from thief: those on the account for a change's wait.
    fn aged_second_devices(&self) -> usize {
        self.second_devices.iter().filter(|k| self.aged(k)).count()
    }

    /// Re-audit 2 (N2): a second device not yet of age starts its wait again at every dispute, counting from `from_ns`.
    /// A recovery start stops its clock (u64::MAX); the recovery's end starts it: the freeze's end after a phone-only
    /// stop, or at once after a finish, a co-signed stop or new words. A device nobody can vouch for never ages through
    /// a dispute. Devices already of age, and those from before ages were kept, are left as they are.
    pub(crate) fn restart_young_ages(&self, from_ns: u64) {
        let mut ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
        let (floor, now) = (self.floor_ns(), env::block_timestamp());
        let mut changed = false;
        for (_, at) in ages.iter_mut().filter(|(_, at)| now < at.saturating_add(floor)) {
            *at = from_ns;
            changed = true;
        }
        if changed {
            store_key(DEVICE_AGES_KEY, &ages);
        }
    }

    /// Re-audit R1: with no such second device, while a recovery waits, and for a change's wait after the phone cancels
    /// one, nothing runs at Face ID and every payment waits at least a change's wait, so the next recovery start (which
    /// drops it) always comes first.
    fn unless_frozen(&self, level: Level) -> Level {
        // While a recovery waits, for every account (re-audit 3, A-1: a second device of age doesn't make it safe to let
        // the phone spend through the owner's recovery; it can only co-sign or refuse). After a phone-only stop, for a
        // change's wait. The freeze is set by the phone's stop with no second device of age, by a second device's
        // refusal of a recovery, and by a stop that waited out its day with no yes.
        let until: u64 = load_key(FREEZE_KEY).unwrap_or(0);
        if self.recovery.is_none() && env::block_timestamp() >= until {
            return level;
        }
        let floor = U64(self.floor_ns() / SECOND);
        match level {
            Level::FaceId => Level::Wait { seconds: floor },
            Level::Device => Level::Both { seconds: floor },
            Level::Wait { seconds } => Level::Wait { seconds: seconds.max(floor) },
            Level::Both { seconds } => Level::Both { seconds: seconds.max(floor) },
        }
    }

    /// Who may act as the phone (audit F1). A second device's or the backup words' key never does (release 7, A1: their
    /// own methods check them); any other signer is a device key. Once the list is sealed it must be on it; before (an
    /// older account, until its first finished recovery), it's learned the first time it calls.
    /// Every owner method's first check: a key that may act as the phone (device_gate). With `modules`, also proof of
    /// life for Legacy and never Agent's key (modules.rs).
    #[cfg(not(feature = "modules"))]
    pub(crate) fn owner_active(&mut self) {
        // Release 10: never Agent's key (NEAR's method list already keeps it to agent_pay; this holds even if it didn't).
        #[cfg(feature = "agent")]
        agent::not_agent_key();
        self.device_gate();
    }

    pub(crate) fn device_gate(&mut self) {
        let signer = signer_key();
        require!(!self.second_devices.contains(&signer), "a second device can only answer: it can't act as the phone");
        require!(self.recovery_key.as_ref() != Some(&signer), "the backup words can only move the account to a new phone");
        // Release 9 (R8-RS1): a recovery's new key acts as the phone only once that recovery has finished. Its key is on
        // NEAR from the finish's add until the callback, so neither a waiting recovery's key nor a finishing one's acts.
        // Release 10 (R2): nor one a finish that didn't finish is deleting (still on NEAR until that receipt runs).
        require!(!self.recovery.as_ref().is_some_and(|r| r.new_key.0 == signer) && !finishing_key_is(&signer) && !deleting_key_is(&signer), "this key becomes the phone only when the move to it has finished");
        let mut devices = load_devices();
        if devices.keys.contains(&signer) {
            return;
        }
        require!(!devices.sealed, "this key isn't one of this account's phone keys (a phone's key is replaced when the account moves to a new phone)");
        require!(devices.keys.len() < MAX_DEVICE_KEYS, "too many phone keys");
        devices.keys.push(signer);
        store_devices(&devices);
    }

    fn index(&self, id: u64) -> usize {
        self.pending.iter().position(|p| p.id.0 == id).unwrap_or_else(|| env::panic_str("no such waiting request"))
    }

    fn find(&self, id: u64) -> Pending {
        self.pending[self.index(id)].clone()
    }

    #[cfg(feature = "modules")]
    pub(crate) fn drop_waiting(&mut self, id: u64, name: &str) {
        self.drop_pending(id, name);
    }

    fn drop_pending(&mut self, id: u64, name: &str) {
        let index = self.index(id);
        match self.pending.remove(index).change {
            Change::RemoveKey { .. } => forget_removal_asked(id),
            // Release 10 (A2): the record that a budget change was asked at the strictest band.
            #[cfg(all(feature = "agent", not(feature = "modules")))]
            Change::AgentSetBudget { .. } => agent::forget_strict(id),
            _ => {}
        }
        forget_approver(id);
        self.spent.retain(|s| s.id != id);
        #[cfg(feature = "modules")]
        modules::kids_ended(id, false);
        event(name, id);
    }

    /// Carry out a request and forget it.
    fn finish(&mut self, id: u64) -> Outcome {
        let index = self.index(id);
        let co_signed = self.co_signed(&self.pending[index]);
        // Release 10 (R9-AL1): a release's listing counts a yes only from a second device on the account for the
        // words-only fallback wait; round 2 (G2): so does the phone's stop of a recovery. Read before the approver's
        // record is forgotten below.
        // Round 3 (V3-2): so do new words that end a recovery (below).
        let co_signed_long = co_signed && matches!(self.pending[index].change, Change::AllowRelease { .. } | Change::CancelRecovery | Change::SetRecoveryKey { .. }) && self.approver_on_for_fallback(id);
        let p = self.pending.remove(index);
        forget_approver(id);
        let now = env::block_timestamp();
        let (ready_at, removal) = (p.ready_at_ns.0, matches!(p.change, Change::RemoveKey { .. }));
        for s in self.spent.iter_mut().filter(|s| s.id == id) {
            s.at_ns = now; // it counts for 24 hours from when it actually ran
        }
        #[cfg(feature = "modules")]
        modules::kids_ended(id, true); // and for 7 days, in a child's weekly limits
        match p.change {
            Change::Spend { receiver_id, steps } => {
                let _ = group_promise(Group { receiver_id, steps });
            }
            Change::SpendMany { groups } => {
                let mut groups = groups;
                let first = groups.remove(0);
                dispatch_chain(first, groups);
            }
            Change::Upgrade { code_hash } => {
                // Release 9 (re-score item 2): only to a release on the account's list, checked when it runs.
                require!(release_allowed(&code_hash.0), "that release isn't on this account's list of releases: ask for it to be added first");
                let hash: [u8; 32] = code_hash.0.clone().try_into().unwrap_or_else(|_| env::panic_str("a release is named by its 32-byte sha256"));
                // In ONE batch with a call to the new code's own check (audit F7). NEAR applies a batch's actions together
                // or not at all, so code that can't read this account's state, an older release, or anything without
                // this check is never left installed: the code stays as it was. From release 9 the check is told the
                // hash it runs as, so its list starts as exactly that release.
                let args = serde_json::to_vec(&serde_json::json!({ "from_version": RELEASE_VERSION, "code_hash": code_hash })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
                let _ = Promise::new(env::current_account_id()).use_global_contract(hash).function_call("upgrade_check", args, NearToken::from_yoctonear(0), UPGRADE_CHECK_GAS);
            }
            Change::AllowRelease { code_hash, asked_at_ns } => {
                // Release 9: co-signed by a second device of age (two of three), or after the fallback wait from when it
                // was asked (and never before a change's wait, which `place` already gave it): the phone alone adds a
                // release no sooner than the words alone could take the account, and the words' start drops it first.
                let alone_at = asked_at_ns.0.saturating_add(self.fallback_ns().max(self.floor_ns()));
                // Release 10 (R9-AL1): the yes must come from a second device on the account for the fallback wait. A
                // phone alone could add its own laptop, let it come of age (a change's wait) and have it say yes: the
                // release would be listed in twice the floor, under the fallback the design promises.
                require!(co_signed_long || now >= alone_at, "adding a release needs the yes of a second device you've had for the words-only fallback's wait, or that wait");
                let mut list: Vec<Vec<u8>> = load_key(RELEASES_KEY).unwrap_or_default();
                if !list.contains(&code_hash.0) {
                    if list.len() >= MAX_RELEASES {
                        list.remove(0);
                    }
                    list.push(code_hash.0);
                }
                store_key(RELEASES_KEY, &list);
            }
            #[cfg(feature = "modules")]
            change @ (Change::LegacySetup { .. }
            | Change::LegacyOff
            | Change::AgentSet { .. }
            | Change::AgentSetBudget { .. }
            | Change::AgentAddOrder { .. }
            | Change::AgentResume
            | Change::KidsSet { .. }
            | Change::KidsOff) => {
                modules::finish_module_change(change);
            }
            // Release 10: Agent's key and budget.
            #[cfg(all(feature = "agent", not(feature = "modules")))]
            change @ (Change::AgentSet { .. } | Change::AgentSetBudget { .. }) => {
                self.finish_agent_change(change, id, co_signed);
            }
            // Nothing in this release places one, and upgrade_check refuses an account still holding one.
            #[cfg(all(feature = "agent", not(feature = "modules")))]
            Change::LegacySetup { .. } | Change::LegacyOff | Change::AgentAddOrder { .. } | Change::AgentResume | Change::KidsSet { .. } | Change::KidsOff => env::panic_str("this release has no such change"),
            #[cfg(not(any(feature = "agent", feature = "modules")))]
            Change::LegacySetup { .. }
            | Change::LegacyOff
            | Change::AgentSet { .. }
            | Change::AgentSetBudget { .. }
            | Change::AgentAddOrder { .. }
            | Change::AgentResume
            | Change::KidsSet { .. }
            | Change::KidsOff => env::panic_str("this release has no such change"),
            Change::SetProtection { bands } => {
                self.check_bands(&bands);
                self.bands = bands;
            }
            Change::AddSecondDevice { public_key } => {
                // Checked again when it runs (audit F10): several may have waited together.
                require!(self.second_devices.len() < 4, "at most four second devices");
                require!(!self.key_in_use(&public_key.0), "that key is already on this account");
                let p = add_function_call_key(&public_key.0, SECOND_DEVICE_METHODS, SECOND_DEVICE_ALLOWANCE);
                // Release 8 (FB-3): recorded now, and forgotten by the callback if NEAR refused the add.
                then_check_second_device_key(p, &public_key.0, false);
                // Its age counts from now, or, during a dispute, from its end (re-audit 2, N2).
                let freeze: u64 = load_key(FREEZE_KEY).unwrap_or(0);
                let now = env::block_timestamp();
                let from = if self.recovery.is_some() { u64::MAX } else { now.max(freeze) };
                let mut ages: Vec<(Vec<u8>, u64)> = load_key(DEVICE_AGES_KEY).unwrap_or_default();
                ages.push((env::sha256(&public_key.0), from));
                store_key(DEVICE_AGES_KEY, &ages);
                self.second_devices.push(public_key.0);
            }
            // Said yes to by a second device of age: the dispute ends. Waited out its day with no yes: as a phone-only stop.
            Change::CancelRecovery => {
                // Re-audit 7 (R7-2): a stop nobody answered never ends a recovery the second device said yes to; only
                // that device's yes to the stop (or its refusal of the recovery) can. The stop stays until the finish.
                // Release 10 (round 2, G2): a yes from a device on the account for the fallback (read before the
                // approver's record went); `approve` and `refuse_recovery` already refuse any other.
                if !co_signed_long {
                    require!(!self.recovery.as_ref().is_some_and(|r| self.recovery_approved(r)), "your second device said yes to this move: only it can stop it now");
                }
                self.end_recovery(!co_signed_long)
            }
            Change::RemoveKey { public_key } => {
                // Release 8 (the re-score's informational item): checked again when it runs, as at `remove_key`. New
                // backup words set to this key after the removal was asked would otherwise lose their access key here.
                require!(Some(&public_key.0) != self.recovery_key.as_ref(), "the backup key changes only with new backup words");
                // Release 10 (the 4 Nov audit): nor Agent's key, which may have become it after the removal was asked
                // (key_in_use doesn't look at waiting removals): it goes only with Agent, by the kill switch.
                #[cfg(all(feature = "agent", not(feature = "modules")))]
                require!(!agent::agent_key_is(&public_key.0), "Agent's key goes with Agent: use Agent's off switch");
                // Release 8 (R8-F1): nor the waiting recovery's new key, nor the last key on the device list (the only
                // phone): whatever was asked before, a removal never leaves the account without a phone.
                require!(!self.recovery.as_ref().is_some_and(|r| r.new_key.0 == public_key.0), "that key is the new phone of the move that is waiting");
                // Release 10 (V1): a second device goes no sooner than the fallback (at least a change's wait) after its
                // removal was asked, whatever it was when asked (a young device, or a key with no role then).
                if self.second_devices.contains(&public_key.0) {
                    let since = removal_asked_at(id, ready_at, self.floor_ns()).saturating_add(self.fallback_ns().max(self.floor_ns()));
                    require!(now >= since, "a second device's removal waits the words-only fallback from when it was asked");
                }
                let mut devices = load_devices();
                require!(!(devices.keys.len() == 1 && devices.keys[0] == public_key.0), "this is the account's only phone key");
                devices.keys.retain(|k| *k != public_key.0);
                store_devices(&devices);
                if self.second_devices.contains(&public_key.0) {
                    self.forget_second_device(&public_key.0);
                } else {
                    delete_key(&public_key.0);
                }
            }
            Change::SetRecoveryKey { public_key } => {
                require!(!self.key_in_use(&public_key.0) || self.recovery_key.as_ref() == Some(&public_key.0), "that key is already on this account");
                if let Some(old) = self.recovery_key.take() {
                    delete_key(&old);
                    // A recovery started with the old words goes with them (audit F14). While one waits only co-signed new
                    // words run; one freeze already running stays to its end (re-audit 2, N1 (a)). Round 3 (V3-2, the twin
                    // of G2): no freeze follows only when the yes came from a second device on the account for the
                    // words-only fallback (read before the approver's record went). A laptop the phone added itself,
                    // only of age, would otherwise co-sign a thief's words that end the owner's recovery with no freeze.
                    if self.recovery.is_some() {
                        self.end_recovery(!co_signed_long);
                    }
                }
                let add = add_function_call_key(&public_key.0, RECOVERY_METHODS, RECOVERY_KEY_ALLOWANCE);
                // Release 10 (the 4 Nov proofing, W1): recorded now, and forgotten by the callback if NEAR refused the
                // add, so the account never names backup words NEAR doesn't hold.
                then_check_recovery_words_key(add, &public_key.0);
                self.recovery_key = Some(public_key.0);
                // Release 10 (round 2, X3): words were set once; if NEAR refuses this add, the next words aren't the first.
                store_key(WORDS_ONCE_KEY, &true);
            }
        }
        if removal {
            forget_removal_asked(id);
        }
        event("request_done", id);
        Outcome { done: true, id: Some(U64(id)), ready_at_ns: None, needs_device: false }
    }

    fn prune(&mut self) {
        let keep: Vec<bool> = self.spent.iter().map(|s| self.counts(s)).collect();
        let mut i = 0;
        self.spent.retain(|_| {
            i += 1;
            keep[i - 1]
        });
    }

    fn check_bands(&self, bands: &[Band]) {
        require!(!bands.is_empty() && bands.len() <= MAX_BANDS, "between one and eight bands");
        for (i, band) in bands.iter().enumerate() {
            let last = i == bands.len() - 1;
            require!(band.up_to.is_none() == last, "only the last band has no limit");
            // As long as the longest change's wait (a 30-day delay's floor, 31 days), so the wait a band gets when the last
            // second device goes (forget_second_device) is always one the account may set again (contract review, FB-4).
            require!(band.level.wait_ns() <= MAX_WAIT_NS + DAY_NS, "a wait can be at most 31 days");
            if let Some(limits) = &band.up_to {
                require!(limits.len() <= MAX_COINS && limits.iter().all(|(c, _)| !c.is_empty() && c.len() <= MAX_COIN_NAME), "too many coins in a band");
            }
            if i > 0 {
                require!(band.level.covers(&bands[i - 1].level), "a bigger band can't be less protected than a smaller one");
            }
        }
        if bands.iter().any(|b| b.level.needs_device()) {
            require!(!self.second_devices.is_empty(), "add a second device before choosing a level that needs it");
        }
    }
}

/// One receiver's steps as a single batch of actions.
pub(crate) fn group_promise(group: Group) -> Promise {
    let mut promise = Promise::new(group.receiver_id);
    for step in group.steps {
        promise = match step {
            Step::Transfer { deposit } => promise.transfer(NearToken::from_yoctonear(deposit.0)),
            Step::FunctionCall { method_name, args, deposit, gas } => promise.function_call(method_name, args.0, NearToken::from_yoctonear(deposit.0), Gas::from_gas(gas.0)),
        };
    }
    promise
}

/// Start `group`; if more follow, a callback checks it succeeded before starting the next.
fn dispatch_chain(group: Group, rest: Vec<Group>) {
    let promise = group_promise(group);
    if rest.is_empty() {
        return;
    }
    let gas: u64 = rest.iter().map(|g| g.steps.iter().map(|s| if let Step::FunctionCall { gas, .. } = s { gas.0 } else { 0 }).sum::<u64>() + CHAIN_LINK_GAS).sum::<u64>() + CHAIN_LINK_GAS;
    let _ = promise.then(AccountPolicy::ext(env::current_account_id()).with_static_gas(Gas::from_gas(gas)).with_unused_gas_weight(1).on_group_done(rest));
}

/// The gas a step carries (a transfer carries none).
fn step_gas(step: &Step) -> u64 {
    if let Step::FunctionCall { gas, .. } = step {
        gas.0
    } else {
        0
    }
}

/// One request's own refusals, `execute`'s and `level_for`'s (release 10, the 4 Nov proofing, round 2, M-I1).
fn check_request(receiver_id: &AccountId, steps: &[Step]) {
    require!(*receiver_id != env::current_account_id(), "this account's own rules change only through their own methods");
    check_steps(steps);
    // Release 8 (re-score RS-1): the steps' gas in all fits one `run`, as a chain's does (R7-5), so a request that could
    // never run is refused here instead of holding a queue place and its 24-hour share until cancelled.
    let gas: u64 = steps.iter().map(step_gas).fold(0u64, u64::saturating_add);
    require!(gas <= MAX_CHAIN_GAS, "a request's steps can carry at most 250 Tgas in all");
}

/// A chain's own refusals, `execute_many`'s and `level_for_many`'s (release 10, round 2, M-I1).
fn check_chain(groups: &[Group]) {
    require!(!groups.is_empty() && groups.len() <= MAX_GROUPS, "between one and four groups");
    // Re-audit 7 (R7-5): the whole chain's gas, its links included, fits one transaction, or it could never run.
    let chain_gas: u64 = groups.iter().map(|g| g.steps.iter().map(step_gas).fold(CHAIN_LINK_GAS, u64::saturating_add)).fold(0u64, u64::saturating_add);
    require!(chain_gas <= MAX_CHAIN_GAS, "a chain's steps and links can carry at most 250 Tgas in all");
    for group in groups {
        require!(group.receiver_id != env::current_account_id(), "this account's own rules change only through their own methods");
        check_steps(&group.steps);
    }
}

fn check_steps(steps: &[Step]) {
    require!(!steps.is_empty() && steps.len() <= MAX_STEPS, "between one and ten steps");
    for step in steps {
        if let Step::FunctionCall { method_name, args, gas, .. } = step {
            require!(!method_name.is_empty() && method_name.len() <= 256, "a step has no valid method name");
            require!(args.0.len() <= MAX_ARGS, "a step's details are too long");
            require!(!NEVER_CALLED.contains(&method_name.as_str()), "this account never calls that method");
            // P-1 (the proofs): more gas than NEAR gives a transaction can't run, so it's refused here, not when a chain's
            // gas is added up at `run`.
            require!(gas.0 <= MAX_STEP_GAS, "a step can carry at most 300 Tgas");
        }
    }
}

fn add_move(moves: &mut Vec<(String, u128)>, coin: &str, amount: u128) {
    match moves.iter_mut().find(|(c, _)| c == coin) {
        Some((_, total)) => *total = total.saturating_add(amount),
        None => moves.push((coin.to_string(), amount)),
    }
}

/// The calls the app makes on other contracts that move nothing out of this account beyond their attached NEAR (counted
/// as "near"), each with the only argument names it may carry, so the same name with a recipient isn't let through:
/// wrapping and unwrapping NEAR (wrap.near), registering storage, staking with a pool and taking it back (the pool
/// returns it to this account), and, with `modules`, an heir's two calls on another ZeroFee account (Legacy).
const MOVES_NOTHING_MORE: [(&str, &[&str]); 8] = [
    ("near_deposit", &[]),
    ("near_withdraw", &["amount"]),
    ("storage_deposit", &["account_id", "registration_only"]),
    ("deposit_and_stake", &[]),
    ("unstake", &["amount"]),
    ("unstake_all", &[]),
    ("withdraw", &["amount"]),
    ("withdraw_all", &[]),
];
#[cfg(feature = "modules")]
const HEIR_CALLS: [(&str, &[&str]); 2] = [("legacy_start_claim", &[]), ("legacy_distribute", &["balances"])];

fn moves_nothing_more(method: &str, args: &[u8]) -> bool {
    let known = MOVES_NOTHING_MORE.iter();
    #[cfg(feature = "modules")]
    let known = known.chain(HEIR_CALLS.iter());
    let Some((_, allowed)) = known.into_iter().find(|(m, _)| *m == method) else { return false };
    if args.is_empty() {
        return true;
    }
    match parse_args(args) {
        Some(Value::Object(fields)) => fields.keys().all(|k| allowed.contains(&k.as_str())),
        _ => false,
    }
}

/// A step's JSON args as `moves` reads them, or None when they aren't JSON or repeat a key in any object at any level
/// (release 10, the 4 Nov proofing, M-L1): serde_json keeps the last of two equal keys, and a contract whose parser kept
/// the first would move more than was measured. Keys compare unescaped ("\u0061" is "a").
fn parse_args(args: &[u8]) -> Option<Value> {
    serde_json::from_slice::<NoDuplicateKeys>(args).ok()?;
    serde_json::from_slice::<Value>(args).ok()
}

/// Deserializes any JSON, refusing an object that names a key twice (`parse_args`).
struct NoDuplicateKeys;

impl<'de> near_sdk::serde::Deserialize<'de> for NoDuplicateKeys {
    fn deserialize<D: near_sdk::serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        d.deserialize_any(NoDuplicateKeysVisitor)
    }
}

struct NoDuplicateKeysVisitor;

impl<'de> near_sdk::serde::de::Visitor<'de> for NoDuplicateKeysVisitor {
    type Value = NoDuplicateKeys;
    fn expecting(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
        f.write_str("JSON with no repeated key")
    }
    fn visit_bool<E>(self, _: bool) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_i64<E>(self, _: i64) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_u64<E>(self, _: u64) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_f64<E>(self, _: f64) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_str<E>(self, _: &str) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_unit<E>(self) -> Result<NoDuplicateKeys, E> {
        Ok(NoDuplicateKeys)
    }
    fn visit_seq<A: near_sdk::serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<NoDuplicateKeys, A::Error> {
        while seq.next_element::<NoDuplicateKeys>()?.is_some() {}
        Ok(NoDuplicateKeys)
    }
    fn visit_map<A: near_sdk::serde::de::MapAccess<'de>>(self, mut map: A) -> Result<NoDuplicateKeys, A::Error> {
        let mut keys: Vec<String> = vec![];
        while let Some(key) = map.next_key::<String>()? {
            if keys.contains(&key) {
                return Err(near_sdk::serde::de::Error::custom("a key is repeated"));
            }
            keys.push(key);
            map.next_value::<NoDuplicateKeys>()?;
        }
        Ok(NoDuplicateKeys)
    }
}

/// What a request moves out of the account, per coin. None when it can't be measured (it then takes the strictest band).
///
/// NEAR attached to any step counts as "near". Coins move only through the standard methods (NEP-141/171/245) and
/// intents.near's withdrawals, and all of those are read here; other methods can't move standard coins. Any other
/// intents.near method can't be measured.
pub fn moves(receiver: &str, steps: &[Step]) -> Option<Vec<(String, u128)>> {
    moves_and_near(receiver, steps).0
}

/// `moves`, and the NEAR the request spends in any case: every Transfer, every attached deposit and every call's gas at
/// GAS_PRICE_COUNTED, the "near" row of a measurable request. Release 10 (the 4 Nov proofing, M1/F2): a request that can't
/// be measured still counts that NEAR toward the 24 hours (it still takes the strictest band).
pub fn moves_and_near(receiver: &str, steps: &[Step]) -> (Option<Vec<(String, u128)>>, u128) {
    let near = steps
        .iter()
        .map(|step| match step {
            Step::Transfer { deposit } => deposit.0,
            Step::FunctionCall { deposit, gas, .. } => deposit.0.saturating_add(u128::from(gas.0) * GAS_PRICE_COUNTED),
        })
        .fold(0u128, u128::saturating_add);
    (measure(receiver, steps), near)
}

fn measure(receiver: &str, steps: &[Step]) -> Option<Vec<(String, u128)>> {
    let mut out: Vec<(String, u128)> = vec![];
    for step in steps {
        let (method, args, deposit, gas) = match step {
            Step::Transfer { deposit } => {
                add_move(&mut out, "near", deposit.0);
                continue;
            }
            Step::FunctionCall { method_name, args, deposit, gas } => (method_name.as_str(), &args.0, deposit.0, gas.0),
        };
        add_move(&mut out, "near", deposit);
        // Any contract a call goes to may run it to its gas limit, and the gas it burns is this account's NEAR (unused gas
        // comes back). So every call's gas counts as NEAR at twice NEAR's lowest gas price: a call measured by its NEAR
        // alone (contract review, FB-1), and from release 8 a coin's own methods too (re-score RS-2: a 1-unit
        // `ft_transfer_call` to a receiver that spins its gas burnt about 0.03 NEAR a time outside the bands).
        add_move(&mut out, "near", u128::from(gas) * GAS_PRICE_COUNTED);
        let standard = matches!(method, "ft_transfer" | "ft_transfer_call" | "mt_transfer" | "mt_transfer_call" | "mt_batch_transfer" | "mt_batch_transfer_call" | "nft_transfer" | "nft_transfer_call" | "ft_withdraw");
        if receiver != INTENTS && !standard {
            // Measured by allowlist (audit F5): only a method known to move nothing out beyond its attached NEAR, with
            // exactly the arguments it takes, counts as that NEAR. Anything else can't be measured (approvals, payouts,
            // LP transfers, storage_unregister, an Intents contract by another name...) and takes the strictest band.
            if moves_nothing_more(method, args) {
                continue;
            }
            return None;
        }
        let v: Value = parse_args(args)?;
        let units = |x: &Value| x.as_str().and_then(|s| s.parse::<u128>().ok());
        let text = |x: &Value| x.as_str().map(str::to_string);
        match (receiver == INTENTS, method) {
            (true, "mt_transfer" | "mt_transfer_call") => add_move(&mut out, &text(&v["token_id"])?, units(&v["amount"])?),
            (true, "mt_batch_transfer" | "mt_batch_transfer_call") => {
                let ids = v["token_ids"].as_array()?;
                let amounts = v["amounts"].as_array()?;
                if ids.len() != amounts.len() {
                    return None;
                }
                for (id, amount) in ids.iter().zip(amounts) {
                    add_move(&mut out, &text(id)?, units(amount)?);
                }
            }
            (true, "ft_withdraw") => {
                // Round 4c (defence in depth): only the arguments measured or harmless here. Any other (intents.near's
                // `storage_deposit`, which pays NEAR out of the ledger, or one a later intents.near adds) can't be
                // measured, and the request takes the strictest band.
                if !v.as_object()?.keys().all(|k| matches!(k.as_str(), "token" | "receiver_id" | "amount" | "memo" | "msg")) {
                    return None;
                }
                add_move(&mut out, &format!("nep141:{}", text(&v["token"])?), units(&v["amount"])?)
            }
            (true, _) => return None,
            (false, "ft_transfer" | "ft_transfer_call") => add_move(&mut out, &format!("nep141:{receiver}"), units(&v["amount"])?),
            (false, "mt_transfer" | "mt_transfer_call") => add_move(&mut out, &format!("nep245:{receiver}:{}", text(&v["token_id"])?), units(&v["amount"])?),
            (false, "mt_batch_transfer" | "mt_batch_transfer_call") => {
                let ids = v["token_ids"].as_array()?;
                let amounts = v["amounts"].as_array()?;
                if ids.len() != amounts.len() {
                    return None;
                }
                for (id, amount) in ids.iter().zip(amounts) {
                    add_move(&mut out, &format!("nep245:{receiver}:{}", text(id)?), units(amount)?);
                }
            }
            (false, "nft_transfer" | "nft_transfer_call") => add_move(&mut out, &format!("nep171:{receiver}:{}", text(&v["token_id"])?), 1),
            // ft_withdraw on anything but intents.near isn't a standard method: it can't be measured.
            (false, _) => return None,
        }
    }
    // Release 10 (the 4 Nov proofing, M2): a coin's name is at most 128 bytes, as in a band. A longer one (read from a
    // step's args, up to 4 KB) can't be measured: the 24-hour rows every method and callback loads stay small.
    if out.iter().any(|(coin, _)| coin.len() > MAX_COIN_NAME) {
        return None;
    }
    Some(out)
}

/// Every account a group calls or pays: its receiver, and the payee of each standard move `moves` reads (a USDC
/// transfer is called on the USDC contract but pays someone else). None when it can't tell. For Kids' allowed list.
#[cfg(feature = "modules")]
pub fn parties(receiver: &str, steps: &[Step]) -> Option<Vec<AccountId>> {
    let mut out: Vec<AccountId> = vec![receiver.parse().ok()?];
    for step in steps {
        let Step::FunctionCall { method_name, args, .. } = step else { continue };
        let pays = matches!(method_name.as_str(), "ft_transfer" | "ft_transfer_call" | "mt_transfer" | "mt_transfer_call" | "mt_batch_transfer" | "mt_batch_transfer_call" | "nft_transfer" | "nft_transfer_call")
            || (receiver == INTENTS && method_name == "ft_withdraw");
        if !pays {
            continue;
        }
        let v: Value = serde_json::from_slice(&args.0).ok()?;
        let payee: AccountId = v["receiver_id"].as_str()?.parse().ok()?;
        // A `*_call` (or an Intents withdrawal with a msg) hands the payee a message it acts on: NEAR Intents credits
        // whoever the message names, so who is paid can't be known and the parent decides (audit F16). The one exception
        // is a deposit into this account's own NEAR Intents balance: an empty message, or this account's own name.
        let forwards = method_name.ends_with("_call") || (method_name == "ft_withdraw" && !v["msg"].is_null());
        let own_deposit = payee.as_str() == INTENTS && matches!(v["msg"].as_str(), Some(m) if m.is_empty() || m == env::current_account_id().as_str());
        if forwards && !own_deposit {
            return None;
        }
        if !out.contains(&payee) {
            out.push(payee);
        }
    }
    Some(out)
}

/// Every change must come from this account itself, i.e. from one of its own keys. Calls from other accounts are refused.
pub(crate) fn only_this_account() {
    require!(env::predecessor_account_id() == env::current_account_id(), "only this account's own keys can do this");
}

fn is_ml_dsa_65_key(bytes: &[u8]) -> bool {
    bytes.len() == 1 + ML_DSA_65_PUBLIC_KEY_LEN && bytes[0] == ML_DSA_65_TAG
}

/// The borsh bytes of the key that signed this transaction (near-sdk's PublicKey type predates ML-DSA-65).
/// The account's device keys (audit F1), under their own storage key (the layout is frozen).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub(crate) struct Devices {
    keys: Vec<Vec<u8>>,
    /// Only `keys` may act as the phone. Sealed at `new` when it names the phone, or by a finished recovery.
    sealed: bool,
    /// When `new` ran (this release on): the first 24 hours are the setup window. None on an older account.
    created_at_ns: Option<u64>,
}
const DEVICES_KEY: &[u8] = b"devices";
/// Until when everyday spending stays frozen after a phone-only cancel of a recovery (re-audit R1), ns.
const FREEZE_KEY: &[u8] = b"freeze";
/// When each second device was added (by its key's sha256): its yes protects only once it's had a change's wait (R4).
const DEVICE_AGES_KEY: &[u8] = b"device_ages";
/// Which second device (by its key's sha256) approved each waiting request (R4).
const APPROVERS_KEY: &[u8] = b"approved_by";
/// Release 7: the words-only fallback wait, ns (set at `new`; `upgrade_check` writes the default for an older account).
const FALLBACK_KEY: &[u8] = b"recovery_fallback";
/// Release 7: a second device of age's yes to the waiting recovery (`RecoveryYes`); removed at every end of a recovery.
const RECOVERY_YES_KEY: &[u8] = b"recovery_yes";
/// Release 7 (re-audit, R7-2): the phone has asked its one stop of the waiting recovery (with a second device of age);
/// removed at every end of a recovery.
const STOP_ASKED_KEY: &[u8] = b"stop_asked";
/// Release 9 (R8-RS1): a finish of a recovery whose add of the new key is on its way (`Finishing`); removed by its callback.
const FINISHING_KEY: &[u8] = b"recovery_finishing";
/// Release 10 (the 4 Nov proofing, K1): the build installed on this account (`RELEASE_BUILD`; round 1's build wrote its
/// `RELEASE_VERSION`, 10), written by `new` and by `upgrade_check`, which runs only while it is older. Release 9 and
/// earlier don't write it.
const INSTALLED_KEY: &[u8] = b"installed";
/// Release 9 (re-score item 2): the releases (sha256) this account may upgrade to, at most `MAX_RELEASES`.
const RELEASES_KEY: &[u8] = b"releases";
const MAX_RELEASES: usize = 4;
/// Release 10 (the 4 Nov proofing, V1): when each waiting key removal was asked, `(id, ns)`, so a second device's removal
/// re-checks the fallback when it runs. At most one per waiting request (MAX_PENDING).
const REMOVALS_ASKED_KEY: &[u8] = b"removal_asked";
/// Release 10 (the 4 Nov proofing, round 2, X3): backup words were set on this account once (`first_words`). Written when
/// new words run; release 9 and earlier don't write it, but their words can't be forgotten (W1 is release 10's).
const WORDS_ONCE_KEY: &[u8] = b"words_once";
/// Release 10 (the 4 Nov proofing, round 2, E1): when each waiting request that needs a device's yes was asked, (id, ns),
/// written by `place`; only requests still waiting for that yes are kept.
const DEVICE_ASKED_KEY: &[u8] = b"device_asked";
// Round 4c (S1-1): DEVICE_ASKED_BUILD (10_002) is gone: `upgrade_check` records a missing ask on every install.
/// Release 10 (the 4 Nov proofing, round 2, the laptop veto): until when a second device of age's no holds (ns): the
/// Face ID band pays nothing and the phone alone asks nothing that waits. Written by `decline`, removed by `end_dispute`
/// and a finished recovery.
const DISPUTE_KEY: &[u8] = b"dispute_until";
/// Round 3 (copy a): what the phone hears when it asks alone, during a dispute, something that would wait without a second
/// device's yes. The laptop can't help with it (`approve` refuses a payment that doesn't need one, and the change is
/// refused before anything waits for a yes; the laptop may be gone too): only the words (`end_dispute`) or the window's end.
const DISPUTE_LINE: &str = "Your laptop said no. Your backup words can end the pause now. Or wait for it to end.";
/// Release 10 (the 4 Nov proofing, round 2, L3): when a second device last refilled the backup words' allowance, ns.
const WORDS_REFILLED_KEY: &[u8] = b"words_refilled";
/// A finish whose callback never ran may be asked again after this (its callback can fail only by running out of gas).
const FINISH_RETRY_NS: u64 = 3_600 * SECOND;

/// Release 9 (R8-RS1): the recovery `finish_recovery` is finishing, until its callback has seen the add.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct Finishing {
    new_key: Vec<u8>,
    ready_at_ns: u64,
    asked_at_ns: u64,
}

/// Release 10 (the 4 Nov proofing, R2): recovery keys whose delete is on its way (a finish that didn't finish, or a lost
/// finish's key), until `on_recovery_key_deleted` sees that receipt run. At most a few: one per finish.
const DELETING_KEY: &[u8] = b"recovery_deleting";

fn deleting_key_is(key: &[u8]) -> bool {
    load_key::<Vec<Vec<u8>>>(DELETING_KEY).is_some_and(|keys| keys.iter().any(|k| k == key))
}

/// The key is no longer on its way off NEAR: its delete ran, or a later finish of the same recovery added it as the phone.
fn forget_deleting_key(key: &[u8]) {
    let Some(mut keys) = load_key::<Vec<Vec<u8>>>(DELETING_KEY) else { return };
    keys.retain(|k| k != key);
    if keys.is_empty() {
        env::storage_remove(DELETING_KEY);
    } else {
        store_key(DELETING_KEY, &keys);
    }
}

/// Gas reserved for `on_recovery_key_deleted` (release 10, R2): it reads and writes one small storage key.
const RECOVERY_KEY_DELETED_GAS: u64 = 5_000_000_000_000;

/// Delete a recovery's new key that didn't become the phone, and keep it refused until NEAR has (release 10, R2).
fn delete_recovery_key(borsh_key: &[u8]) {
    let mut keys: Vec<Vec<u8>> = load_key(DELETING_KEY).unwrap_or_default();
    if !keys.iter().any(|k| k == borsh_key) {
        keys.push(borsh_key.to_vec());
        store_key(DELETING_KEY, &keys);
    }
    let account = env::current_account_id();
    let args = serde_json::to_vec(&serde_json::json!({ "public_key": Base64VecU8(borsh_key.to_vec()) })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
    let method = "on_recovery_key_deleted";
    let zero = 0u128.to_le_bytes();
    unsafe {
        let del = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_delete_key(del, borsh_key.len() as u64, borsh_key.as_ptr() as u64);
        let cb = near_sys::promise_batch_then(del, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_function_call_weight(cb, method.len() as u64, method.as_ptr() as u64, args.len() as u64, args.as_ptr() as u64, zero.as_ptr() as u64, RECOVERY_KEY_DELETED_GAS, 1);
    }
}

/// Is this key the new key of a recovery that is finishing (its add on its way)?
fn finishing_key_is(key: &[u8]) -> bool {
    load_key::<Finishing>(FINISHING_KEY).is_some_and(|f| f.new_key == key)
}

/// Is this release (sha256) on the account's list (release 9)?
fn release_allowed(code_hash: &[u8]) -> bool {
    load_key::<Vec<Vec<u8>>>(RELEASES_KEY).unwrap_or_default().iter().any(|h| h.as_slice() == code_hash)
}

/// This release's default fallback (the header): 3 times the delay, at least a week, at most 30 days. So 7 days on a
/// 24- or 48-hour account, 9 days on 3 days, 21 on 7, and 30 on a 30-day account (there the delay itself is the fallback).
fn default_fallback_ns(delay_ns: u64) -> u64 {
    delay_ns.saturating_mul(FALLBACK_MULTIPLE).max(MIN_FALLBACK_NS).min(MAX_FALLBACK_NS)
}

/// A fallback `new` is given: never shorter than the default for its delay, never over 30 days.
fn check_fallback(delay_ns: u64, fallback_ns: u64) {
    require!(fallback_ns >= default_fallback_ns(delay_ns), "the words-only fallback must be at least 3 times the recovery delay, and a week");
    require!(fallback_ns <= MAX_FALLBACK_NS, "the words-only fallback can be at most 30 days");
}

pub(crate) fn load_key<T: borsh::BorshDeserialize>(key: &[u8]) -> Option<T> {
    env::storage_read(key).map(|b| borsh::from_slice::<T>(&b).unwrap_or_else(|_| env::panic_str("stored account state is unreadable")))
}

fn store_key<T: borsh::BorshSerialize>(key: &[u8], value: &T) {
    env::storage_write(key, &borsh::to_vec(value).unwrap_or_else(|_| env::panic_str("account state can't be stored")));
}

/// When removal `id` was asked (V1). One asked before release 10 has no record: the latest it can have been asked, its
/// ready time less the floor (every removal waited at least the floor), so the check is never looser than the truth.
fn removal_asked_at(id: u64, ready_at_ns: u64, floor_ns: u64) -> u64 {
    let asked: Vec<(u64, u64)> = load_key(REMOVALS_ASKED_KEY).unwrap_or_default();
    asked.iter().find(|(i, _)| *i == id).map_or(ready_at_ns.saturating_sub(floor_ns), |(_, at)| *at)
}

fn forget_removal_asked(id: u64) {
    let mut asked: Vec<(u64, u64)> = load_key(REMOVALS_ASKED_KEY).unwrap_or_default();
    let before = asked.len();
    asked.retain(|(i, _)| *i != id);
    if asked.len() != before {
        store_key(REMOVALS_ASKED_KEY, &asked);
    }
}

fn forget_approver(id: u64) {
    let mut by: Vec<(u64, Vec<u8>)> = load_key(APPROVERS_KEY).unwrap_or_default();
    let before = by.len();
    by.retain(|(i, _)| *i != id);
    if by.len() != before {
        store_key(APPROVERS_KEY, &by);
    }
}

/// Every piece of state this release reads, decoded (re-audit R8): a release that can't read one of them fails its
/// upgrade_check, so the switch is undone instead of leaving every owner call unable to run.
pub(crate) fn read_all_state() {
    let _ = load_devices();
    let _: Option<u64> = load_key(FREEZE_KEY);
    let _: Option<Vec<(Vec<u8>, u64)>> = load_key(DEVICE_AGES_KEY);
    let _: Option<Vec<(u64, Vec<u8>)>> = load_key(APPROVERS_KEY);
    let _: Option<u64> = load_key(FALLBACK_KEY);
    let _: Option<RecoveryYes> = load_key(RECOVERY_YES_KEY);
    let _: Option<bool> = load_key(STOP_ASKED_KEY);
    let _: Option<Finishing> = load_key(FINISHING_KEY);
    let _: Option<Vec<Vec<u8>>> = load_key(DELETING_KEY);
    let _: Option<Vec<Vec<u8>>> = load_key(RELEASES_KEY);
    let _: Option<u32> = load_key(INSTALLED_KEY);
    let _: Option<Vec<(u64, u64)>> = load_key(REMOVALS_ASKED_KEY);
    let _: Option<bool> = load_key(WORDS_ONCE_KEY);
    let _: Option<u64> = load_key(WORDS_REFILLED_KEY);
    let _: Option<Vec<(u64, u64)>> = load_key(DEVICE_ASKED_KEY);
    let _: Option<u64> = load_key(DISPUTE_KEY);
    #[cfg(feature = "modules")]
    modules::read_all_module_state();
    #[cfg(all(feature = "agent", not(feature = "modules")))]
    agent::read_agent_state();
    // This release has no Legacy or Kids (release 10: nor standing orders): an account using one stays on the release it
    // has (its methods would be gone, and its money or rules with them).
    #[cfg(not(feature = "modules"))]
    for key in MODULE_KEYS {
        require!(!env::storage_has_key(key), "this account uses Agent, Legacy or Kids, which this release doesn't have");
    }
}
const MAX_DEVICE_KEYS: usize = 8;

pub(crate) fn load_devices() -> Devices {
    env::storage_read(DEVICES_KEY)
        .map(|b| borsh::from_slice::<Devices>(&b).unwrap_or_else(|_| env::panic_str("the device keys are unreadable")))
        .unwrap_or_default()
}

fn store_devices(d: &Devices) {
    env::storage_write(DEVICES_KEY, &borsh::to_vec(d).unwrap_or_else(|_| env::panic_str("the device keys can't be stored")));
}

/// This release's number. Each release raises it; `upgrade_check` refuses to go back (audit F7).
pub const RELEASE_VERSION: u32 = 10;
/// This build, for the one-shot install marker (K1): the release times 1000 plus its re-spin. Release 10 (the 4 Nov
/// proofing, round 2, G3): raised at every rebuild of a release, so an account on an earlier build of it takes the new
/// one (its check runs once), while `release_version` and the app's release number stay the same. Round 1's build of
/// release 10 wrote 10; round 2's (360b8075c) wrote 10_002; this is release 10's third build (round 4: B4, src/quote.rs),
/// so an account on round 2's build takes it; round 4b's (R2-1) is the fourth, 10_004, and round 4c's (S1-1) the fifth,
/// 10_005, so an account on any earlier build takes it. It must always be above every RELEASE_VERSION before it.
pub const RELEASE_BUILD: u32 = 10_005;
/// Gas for the new code's own check in the upgrade batch: it loads the whole state.
const UPGRADE_CHECK_GAS: Gas = Gas::from_tgas(50);

/// A whole band's budget, in millionths.
const PPM: u128 = 1_000_000;

/// `total` as a share of `limit`, in millionths, rounded up; None when it's more than the whole (or the limit is zero).
fn share_ppm(total: u128, limit: u128) -> Option<u128> {
    if total == 0 {
        return Some(0);
    }
    if limit == 0 || total > limit {
        return None;
    }
    match total.checked_mul(PPM) {
        Some(t) => Some(t.div_ceil(limit)),
        // Too big to scale: the same share from a coarser limit, still rounded up.
        None => Some(total.div_ceil(limit / PPM).min(PPM)),
    }
}

/// A change to the account's rules or keys, not a payment: these wait longer than a recovery takes (audit F1).
fn is_setting(change: &Change) -> bool {
    !matches!(change, Change::Spend { .. } | Change::SpendMany { .. } | Change::CancelRecovery)
}

pub(crate) fn signer_key() -> Vec<u8> {
    const REGISTER: u64 = u64::MAX - 1;
    unsafe {
        near_sys::signer_account_pk(REGISTER);
        let len = near_sys::register_len(REGISTER) as usize;
        let mut bytes = vec![0u8; len];
        near_sys::read_register(REGISTER, bytes.as_mut_ptr() as u64);
        bytes
    }
}

/// Add a key that NEAR restricts to `methods` on this account. `allowance` 0 means no fee limit.
pub(crate) fn add_function_call_key(borsh_key: &[u8], methods: &str, allowance: u128) -> u64 {
    let account = env::current_account_id();
    let allowance = allowance.to_le_bytes();
    unsafe {
        let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_add_key_with_function_call(
            promise,
            borsh_key.len() as u64,
            borsh_key.as_ptr() as u64,
            0,
            allowance.as_ptr() as u64,
            account.as_bytes().len() as u64,
            account.as_bytes().as_ptr() as u64,
            methods.len() as u64,
            methods.as_ptr() as u64,
        );
        promise
    }
}

/// The same key with a fresh fee allowance: deleted and added again in ONE batch (adding a key that exists is refused).
pub(crate) fn renew_function_call_key(borsh_key: &[u8], methods: &str, allowance: u128) -> u64 {
    let account = env::current_account_id();
    let allowance = allowance.to_le_bytes();
    unsafe {
        let p = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_delete_key(p, borsh_key.len() as u64, borsh_key.as_ptr() as u64);
        near_sys::promise_batch_action_add_key_with_function_call(
            p,
            borsh_key.len() as u64,
            borsh_key.as_ptr() as u64,
            0,
            allowance.as_ptr() as u64,
            account.as_bytes().len() as u64,
            account.as_bytes().as_ptr() as u64,
            methods.len() as u64,
            methods.as_ptr() as u64,
        );
        p
    }
}

/// Gas reserved for `on_second_device_key` (release 8, FB-3) and `on_recovery_words_key` (W1); it also gets a share of
/// what is left. On success it reads no state; on failure it loads and saves the state. Release 10 (round 2): 20 Tgas,
/// up from 10. Round 4c (the audit's ruling): 40 Tgas. The failure branch measured about 13.5 Tgas at a 120 KB state (r3-G),
/// about 23 scaled to the largest (about 209 KB), over 20; 40 leaves at least 10 over that.
const DEVICE_KEY_CHECK_GAS: u64 = 40_000_000_000_000;

/// After a second device's key add or refill (`promise`), call `on_second_device_key` with its result (release 8, FB-3).
fn then_check_second_device_key(promise: u64, borsh_key: &[u8], refill: bool) {
    let account = env::current_account_id();
    let args = serde_json::to_vec(&serde_json::json!({ "public_key": Base64VecU8(borsh_key.to_vec()), "refill": refill })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
    let method = "on_second_device_key";
    let zero = 0u128.to_le_bytes();
    unsafe {
        let cb = near_sys::promise_batch_then(promise, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_function_call_weight(cb, method.len() as u64, method.as_ptr() as u64, args.len() as u64, args.as_ptr() as u64, zero.as_ptr() as u64, DEVICE_KEY_CHECK_GAS, 1);
    }
}

/// After the backup words' key add (`promise`), call `on_recovery_words_key` with its result (release 10, W1).
fn then_check_recovery_words_key(promise: u64, borsh_key: &[u8]) {
    let account = env::current_account_id();
    let args = serde_json::to_vec(&serde_json::json!({ "public_key": Base64VecU8(borsh_key.to_vec()) })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
    let method = "on_recovery_words_key";
    let zero = 0u128.to_le_bytes();
    unsafe {
        let cb = near_sys::promise_batch_then(promise, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_function_call_weight(cb, method.len() as u64, method.as_ptr() as u64, args.len() as u64, args.as_ptr() as u64, zero.as_ptr() as u64, DEVICE_KEY_CHECK_GAS, 1);
    }
}

/// Delete a key in a receipt of its own, then add it (restricted to `methods` on this account) in a receipt chained
/// after the delete, which runs whether or not the delete succeeded (release 9, re-freeze 2). Returns the add's promise.
fn add_after_delete(borsh_key: &[u8], methods: &str, allowance: u128) -> u64 {
    let account = env::current_account_id();
    let allowance = allowance.to_le_bytes();
    unsafe {
        let del = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_delete_key(del, borsh_key.len() as u64, borsh_key.as_ptr() as u64);
        let add = near_sys::promise_batch_then(del, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_add_key_with_function_call(
            add,
            borsh_key.len() as u64,
            borsh_key.as_ptr() as u64,
            0,
            allowance.as_ptr() as u64,
            account.as_bytes().len() as u64,
            account.as_bytes().as_ptr() as u64,
            methods.len() as u64,
            methods.as_ptr() as u64,
        );
        add
    }
}

/// Gas reserved for `on_recovery_key` (release 9, R8-RS1); it also gets a share of what is left. On success it loads and
/// saves the state and deletes at most 8 phone keys and 4 young devices' keys. Round 4c (G4-1): at the largest state
/// (about 209 KB: an aged and three young devices, a full Agent log, 128 rows, a full queue) that success branch needs
/// about 30.8 Tgas on near-sandbox 2.13.4, over round 2's 30 (its "about 6.8 Tgas" was a 128 KB state's load and save
/// alone). 45 Tgas leaves at least 10 over the need. The app's finish (100 Tgas) covers it with the finish's own work.
const RECOVERY_KEY_CHECK_GAS: u64 = 45_000_000_000_000;

/// After `finish_recovery`'s add of the new phone's key (`promise`), call `on_recovery_key` with its result (release 9).
fn then_finish_recovery(promise: u64, r: &PendingRecovery, asked_at_ns: u64) {
    let account = env::current_account_id();
    let args = serde_json::to_vec(&serde_json::json!({ "new_key": r.new_key, "ready_at_ns": r.ready_at_ns, "asked_at_ns": U64(asked_at_ns) })).unwrap_or_else(|_| env::panic_str("account state can't be stored"));
    let method = "on_recovery_key";
    let zero = 0u128.to_le_bytes();
    unsafe {
        let cb = near_sys::promise_batch_then(promise, account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_function_call_weight(cb, method.len() as u64, method.as_ptr() as u64, args.len() as u64, args.as_ptr() as u64, zero.as_ptr() as u64, RECOVERY_KEY_CHECK_GAS, 1);
    }
}

pub(crate) fn delete_key(borsh_key: &[u8]) {
    let account = env::current_account_id();
    unsafe {
        let promise = near_sys::promise_batch_create(account.as_bytes().len() as u64, account.as_bytes().as_ptr() as u64);
        near_sys::promise_batch_action_delete_key(promise, borsh_key.len() as u64, borsh_key.as_ptr() as u64);
    }
}

pub(crate) fn event(name: &str, value: u64) {
    env::log_str(&format!(r#"EVENT_JSON:{{"standard":"zerofee_account","version":"1.0.0","event":"{name}","data":{{"value":"{value}"}}}}"#));
}

#[cfg(feature = "modules")]
mod modules;
#[cfg(all(feature = "agent", not(feature = "modules")))]
mod agent;

mod quote;
pub use quote::SignedQuote;

#[cfg(test)]
mod tests;
