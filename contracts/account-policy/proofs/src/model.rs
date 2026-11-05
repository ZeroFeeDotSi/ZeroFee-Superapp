//! An independent state-machine MODEL of the account policy, written from the lib.rs header (release 7: recovery needs
//! the second device of age, the words-only fallback, roles checked by the contract), docs/layers/security.md and
//! DECISIONS D44 — not from the code. It shares no type and no function with the contract (its own `MLevel`,
//! its own time and budget arithmetic). The checker (checker.rs) runs it in lockstep with the real contract on every
//! action of every explored sequence and demands the same verdict (ok / refused), the same answer and the same abstract
//! state afterwards. A disagreement is either a model error (fixed here, and said so in contract-proofs.md) or a
//! contract deviation from its own specification (a finding).
//!
//! Keys are small integers (the checker maps them to ML-DSA-65 key bytes). One coin ("near") is modelled; the
//! multi-coin budget arithmetic is proven separately by Kani (P1, P6).

pub const SECOND: u64 = 1_000_000_000;
pub const DAY: u64 = 86_400 * SECOND;
pub const MAX_PENDING: usize = 20;
pub const MAX_SPENT_ROWS: usize = 128;
pub const MAX_SECOND_DEVICES: usize = 4;
pub const MAX_PHONE_KEYS: usize = 8;
/// The one release the checker asks to upgrade to (its hash is 32 bytes of this value).
pub const UPGRADE_HASH: u8 = 7;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum MLevel {
    FaceId,
    Wait(u64),
    Device,
    Both(u64),
}

impl MLevel {
    pub fn wait(&self) -> u64 {
        match self {
            MLevel::Wait(s) | MLevel::Both(s) => s.saturating_mul(SECOND),
            _ => 0,
        }
    }
    pub fn needs_device(&self) -> bool {
        matches!(self, MLevel::Device | MLevel::Both(_))
    }
    pub fn covers(&self, o: &MLevel) -> bool {
        self.wait() >= o.wait() && (self.needs_device() || !o.needs_device())
    }
    pub fn without_device(&self) -> MLevel {
        match self {
            MLevel::FaceId | MLevel::Device => MLevel::FaceId,
            MLevel::Wait(s) | MLevel::Both(s) => MLevel::Wait(*s),
        }
    }
}

/// A band: the most NEAR it covers (None = the last band), and its level.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MBand {
    pub up_to: Option<u128>,
    pub level: MLevel,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum MKind {
    Spend(u128),
    Unmeasured,
    SetProtection(Vec<MBand>),
    AddSecondDevice(u8),
    RemoveKey(u8),
    SetRecoveryKey(u8),
    Upgrade,
    CancelRecovery,
    /// Release 9: add a release (the checker's one hash, by its fill byte) to the account's list; asked at (ns).
    AllowRelease(u8, u64),
}

impl MKind {
    fn is_setting(&self) -> bool {
        !matches!(self, MKind::Spend(_) | MKind::Unmeasured | MKind::CancelRecovery)
    }
    fn is_setup_step(&self) -> bool {
        matches!(self, MKind::SetProtection(_) | MKind::AddSecondDevice(_))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MPending {
    pub id: u64,
    pub kind: MKind,
    pub ready_at: u64,
    pub needs_device: bool,
    pub approved: bool,
    /// The second device whose yes co-signs it: one that was of age when it said yes (None: no yes, or a young one's).
    pub approver: Option<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MOut {
    pub done: bool,
    pub ready_at: Option<u64>,
    pub needs_device: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Model {
    pub delay: u64,
    /// Release 7: the words-only fallback wait from a recovery's start.
    pub fallback: u64,
    pub created_at: u64,
    pub phones: Vec<u8>,
    pub sealed: bool,
    pub recovery_key: Option<u8>,
    /// Second devices with the start of their age clock (u64::MAX: stopped while a recovery waits).
    pub second: Vec<(u8, u64)>,
    /// A waiting recovery: the new phone's key and when its delay ends.
    pub recovery: Option<(u8, u64)>,
    /// Release 7: the second device that said yes to the waiting recovery (it counts while still on the account and of age).
    pub recovery_yes: Option<u8>,
    /// Re-audit 7 (R7-2): the phone has asked its one stop of the waiting recovery (with a device of age).
    pub stop_asked: bool,
    pub freeze_until: u64,
    pub bands: Vec<MBand>,
    pub pending: Vec<MPending>,
    /// The 24-hour list: (time, request id, amount).
    pub spent: Vec<(u64, u64, u128)>,
    pub next_id: u64,
    pub now: u64,
    /// Release 9 (R8-RS1): a finish whose add of the new key is on its way: (new key, the recovery's ready time, asked at).
    pub finishing: Option<(u8, u64, u64)>,
    /// Release 9: the releases this account may upgrade to (by the checker's hash fill byte).
    pub releases: Vec<u8>,
}

pub type MResult = Result<MOut, &'static str>;

impl Model {
    pub fn new(now: u64, delay_s: u64, fallback_s: u64, phone: u8) -> Model {
        Model { delay: delay_s * SECOND, fallback: fallback_s * SECOND, created_at: now, phones: vec![phone], sealed: true, recovery_key: None, second: vec![], recovery: None, recovery_yes: None, stop_asked: false, freeze_until: 0, bands: vec![MBand { up_to: None, level: MLevel::FaceId }], pending: vec![], spent: vec![], next_id: 1, now, finishing: None, releases: vec![] }
    }

    pub fn floor(&self) -> u64 {
        self.delay + self.delay.min(DAY)
    }
    fn frozen(&self) -> bool {
        self.recovery.is_some() || self.now < self.freeze_until
    }
    pub fn frozen_until(&self) -> Option<u64> {
        let end = self.freeze_until.max(self.recovery.map_or(0, |_| self.can_finish_at()));
        self.frozen().then_some(end)
    }
    /// Release 7: a second device of age, still on the account, said yes to the waiting recovery.
    pub fn recovery_approved(&self) -> bool {
        self.recovery.is_some() && self.recovery_yes.map_or(false, |d| self.second.iter().any(|(k, _)| *k == d) && self.aged(d))
    }
    /// Release 7: when the words alone may finish the waiting recovery (the fallback from its start).
    pub fn fallback_at(&self) -> u64 {
        self.recovery.map_or(0, |(_, ready)| ready - self.delay + self.fallback)
    }
    /// Release 7: the earliest the words may finish the waiting recovery as things stand.
    pub fn can_finish_at(&self) -> u64 {
        let ready = self.recovery.map_or(0, |r| r.1);
        if self.aged_count() == 0 || self.recovery_approved() {
            ready
        } else {
            ready.max(self.fallback_at())
        }
    }
    pub fn aged(&self, key: u8) -> bool {
        self.second.iter().find(|(k, _)| *k == key).map_or(false, |(_, at)| self.now >= at.saturating_add(self.floor()))
    }
    pub fn aged_count(&self) -> usize {
        self.second.iter().filter(|(k, _)| self.aged(*k)).count()
    }
    fn in_setup_window(&self) -> bool {
        self.now < self.created_at.saturating_add(DAY)
    }
    fn strictest(&self) -> MLevel {
        self.bands.last().unwrap().level.clone()
    }
    fn key_in_use(&self, key: u8) -> bool {
        self.phones.contains(&key) || self.second.iter().any(|(k, _)| *k == key) || self.recovery_key == Some(key) || self.recovery.map_or(false, |r| r.0 == key) || self.finishing.map_or(false, |f| f.0 == key)
    }
    fn co_signed(&self, p: &MPending) -> bool {
        p.approved && p.approver.map_or(false, |a| self.second.iter().any(|(k, _)| *k == a) && self.aged(a))
    }
    fn counts(&self, row: &(u64, u64, u128)) -> bool {
        row.0 + DAY > self.now || self.pending.iter().any(|p| p.id == row.1)
    }
    fn prune(&mut self) {
        let keep: Vec<bool> = self.spent.iter().map(|r| self.counts(r)).collect();
        let mut i = 0;
        self.spent.retain(|_| {
            i += 1;
            keep[i - 1]
        });
    }
    fn counted_total(&self) -> u128 {
        self.spent.iter().filter(|r| self.counts(r)).map(|r| r.2).fold(0u128, |a, b| a.saturating_add(b))
    }
    /// The first band whose limit holds the last 24 hours plus this amount (one coin: the share is total/limit).
    fn level_for(&self, amount: u128) -> MLevel {
        let total = self.counted_total().saturating_add(amount);
        for b in &self.bands {
            match b.up_to {
                None => return b.level.clone(),
                Some(limit) => {
                    if total == 0 || (limit > 0 && total <= limit) {
                        return b.level.clone();
                    }
                }
            }
        }
        self.strictest()
    }
    fn unless_frozen(&self, level: MLevel) -> MLevel {
        if !self.frozen() {
            return level;
        }
        let f = self.floor() / SECOND;
        match level {
            MLevel::FaceId => MLevel::Wait(f),
            MLevel::Device => MLevel::Both(f),
            MLevel::Wait(s) => MLevel::Wait(s.max(f)),
            MLevel::Both(s) => MLevel::Both(s.max(f)),
        }
    }

    /// Who may act as the phone (release 7): never a second device or the words; any other key must be on the phone
    /// list; a sealed list refuses an unknown key.
    fn gate(&mut self, signer: u8) -> Result<(), &'static str> {
        if self.second.iter().any(|(k, _)| *k == signer) {
            return Err("a second device can't act as the phone");
        }
        if self.recovery_key == Some(signer) {
            return Err("the words can't act as the phone");
        }
        // Release 9 (R8-RS1): a recovery's new key acts only once that recovery has finished (waiting or finishing: no).
        if self.recovery.map_or(false, |r| r.0 == signer) || self.finishing.map_or(false, |f| f.0 == signer) {
            return Err("the new key acts only once its recovery has finished");
        }
        if self.phones.contains(&signer) {
            return Ok(());
        }
        if self.sealed {
            return Err("sealed");
        }
        if self.phones.len() >= MAX_PHONE_KEYS {
            return Err("too many phone keys");
        }
        self.phones.push(signer);
        Ok(())
    }

    /// Release 7: only a second device of this account answers, says yes to or refuses a recovery.
    fn second_gate(&self, signer: u8) -> Result<(), &'static str> {
        if self.second.iter().any(|(k, _)| *k == signer) {
            Ok(())
        } else {
            Err("only a second device can do this")
        }
    }
    /// Release 7: only the words start or finish a recovery.
    fn words_gate(&self, signer: u8) -> Result<(), &'static str> {
        if self.recovery_key == Some(signer) {
            Ok(())
        } else {
            Err("only the words can do this")
        }
    }

    fn take_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn place(&mut self, id: u64, kind: MKind, level: MLevel) -> MResult {
        self.prune();
        let setting_up = self.in_setup_window() && kind.is_setup_step();
        let first_words = matches!(kind, MKind::SetRecoveryKey(_)) && self.recovery_key.is_none();
        let mut floor = if kind.is_setting() && !setting_up && !first_words { self.floor() } else { 0 };
        // Re-audit 7 (R7-1): removing a second device of age waits the fallback as well.
        if let MKind::RemoveKey(k) = kind {
            if self.second.iter().any(|(d, _)| *d == k) && self.aged(k) {
                floor = floor.max(self.fallback);
            }
        }
        if level == MLevel::FaceId && floor == 0 {
            self.pending.push(MPending { id, kind, ready_at: 0, needs_device: false, approved: false, approver: None });
            return self.finish(id);
        }
        if level.needs_device() && self.second.is_empty() {
            return Err("needs a second device, none added");
        }
        if self.pending.len() >= MAX_PENDING {
            return Err("too many waiting");
        }
        let ready_at = self.now + level.wait().max(floor);
        let needs_device = level.needs_device();
        self.pending.push(MPending { id, kind, ready_at, needs_device, approved: false, approver: None });
        Ok(MOut { done: false, ready_at: Some(ready_at), needs_device })
    }

    fn index(&self, id: u64) -> Result<usize, &'static str> {
        self.pending.iter().position(|p| p.id == id).ok_or("no such waiting request")
    }

    fn drop(&mut self, id: u64) {
        self.pending.retain(|p| p.id != id);
        self.spent.retain(|r| r.1 != id);
    }

    fn drop_unapproved(&mut self) {
        let ids: Vec<u64> = self.pending.iter().filter(|p| !self.co_signed(p)).map(|p| p.id).collect();
        for id in ids {
            self.drop(id);
        }
    }

    fn restart_young_ages(&mut self, from: u64) {
        let (floor, now) = (self.floor(), self.now);
        for (_, at) in self.second.iter_mut().filter(|(_, at)| now < at.saturating_add(floor)) {
            *at = from;
        }
    }

    fn forget_second_device(&mut self, key: u8) {
        self.second.retain(|(k, _)| *k != key);
        if self.second.is_empty() {
            let floor_s = self.floor() / SECOND;
            for b in self.bands.iter_mut().filter(|b| b.level.needs_device()) {
                b.level = MLevel::Wait(b.level.wait().div_ceil(SECOND).max(floor_s));
            }
        }
    }

    fn end_recovery(&mut self, freeze: bool) {
        self.recovery = None;
        self.recovery_yes = None;
        self.stop_asked = false;
        if freeze {
            let until = self.now.saturating_add(self.floor());
            self.freeze_until = until;
            self.restart_young_ages(until);
        } else {
            self.restart_young_ages(self.now.max(self.freeze_until));
        }
        self.drop_unapproved();
    }

    fn check_bands(&self, bands: &[MBand]) -> Result<(), &'static str> {
        if bands.is_empty() || bands.len() > 8 {
            return Err("between one and eight bands");
        }
        for (i, b) in bands.iter().enumerate() {
            if b.up_to.is_none() != (i + 1 == bands.len()) {
                return Err("only the last band has no limit");
            }
            if b.level.wait() > 31 * DAY {
                return Err("a wait can be at most 31 days");
            }
            if i > 0 && !b.level.covers(&bands[i - 1].level) {
                return Err("a bigger band can't be less protected");
            }
        }
        if bands.iter().any(|b| b.level.needs_device()) && self.second.is_empty() {
            return Err("add a second device first");
        }
        Ok(())
    }

    fn finish(&mut self, id: u64) -> MResult {
        let index = self.index(id)?;
        let co_signed = self.co_signed(&self.pending[index]);
        let p = self.pending.remove(index);
        let now = self.now;
        for r in self.spent.iter_mut().filter(|r| r.1 == id) {
            r.0 = now;
        }
        match p.kind {
            MKind::Spend(_) | MKind::Unmeasured => {}
            // Release 9: an upgrade runs only to a release on the list (checked when it runs).
            MKind::Upgrade => {
                if !self.releases.contains(&UPGRADE_HASH) {
                    return Err("that release isn't on the list");
                }
            }
            // Release 9: a release joins the list co-signed by a second device of age, or once max(fallback, floor) has
            // passed since it was asked; at most four on the list (the oldest goes).
            MKind::AllowRelease(h, asked) => {
                if !co_signed && now < asked.saturating_add(self.fallback.max(self.floor())) {
                    return Err("adding a release needs the device's yes or the fallback's wait");
                }
                if !self.releases.contains(&h) {
                    if self.releases.len() >= 4 {
                        self.releases.remove(0);
                    }
                    self.releases.push(h);
                }
            }
            MKind::SetProtection(bands) => {
                self.check_bands(&bands)?;
                self.bands = bands;
            }
            MKind::AddSecondDevice(key) => {
                if self.second.len() >= MAX_SECOND_DEVICES {
                    return Err("at most four second devices");
                }
                if self.key_in_use(key) {
                    return Err("key already on this account");
                }
                let from = if self.recovery.is_some() { u64::MAX } else { now.max(self.freeze_until) };
                self.second.push((key, from));
            }
            MKind::CancelRecovery => {
                // Re-audit 7 (R7-2): a stop nobody answered never ends an approved recovery.
                if !co_signed && self.recovery_approved() {
                    self.pending.insert(index, p);
                    return Err("the second device said yes to this move");
                }
                self.end_recovery(!co_signed)
            }
            MKind::RemoveKey(key) => {
                self.phones.retain(|k| *k != key);
                if self.second.iter().any(|(k, _)| *k == key) {
                    self.forget_second_device(key);
                }
            }
            MKind::SetRecoveryKey(key) => {
                if self.key_in_use(key) && self.recovery_key != Some(key) {
                    return Err("key already on this account");
                }
                if self.recovery_key.take().is_some() && self.recovery.is_some() {
                    self.end_recovery(false);
                }
                self.recovery_key = Some(key);
            }
        }
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    // ── The phone's methods ──────────────────────────────────────────────────────────────────────────────────────

    pub fn execute(&mut self, signer: u8, amount: Option<u128>) -> MResult {
        self.gate(signer)?;
        let level = match amount {
            Some(a) => self.level_for(a),
            None => self.strictest(),
        };
        let level = self.unless_frozen(level);
        let id = self.take_id();
        self.prune();
        let rows = usize::from(amount.is_some_and(|a| a > 0));
        if self.spent.len() + rows > MAX_SPENT_ROWS {
            return Err("too many payments in the last 24 hours");
        }
        if let Some(a) = amount.filter(|a| *a > 0) {
            self.spent.push((self.now, id, a));
        }
        let kind = amount.map_or(MKind::Unmeasured, MKind::Spend);
        self.place(id, kind, level)
    }

    pub fn run(&mut self, signer: u8, id: u64) -> MResult {
        self.gate(signer)?;
        let p = self.pending[self.index(id)?].clone();
        if self.now < p.ready_at {
            return Err("still waiting");
        }
        if p.needs_device && !p.approved {
            return Err("needs the second device");
        }
        if self.recovery.is_some() && !matches!(p.kind, MKind::CancelRecovery) && !self.co_signed(&p) {
            return Err("a recovery waits: only co-signed runs");
        }
        self.finish(id)
    }

    pub fn cancel(&mut self, signer: u8, id: u64) -> MResult {
        self.gate(signer)?;
        self.index(id)?;
        self.drop(id);
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    pub fn set_protection(&mut self, signer: u8, bands: Vec<MBand>) -> MResult {
        self.gate(signer)?;
        self.check_bands(&bands)?;
        let id = self.take_id();
        let level = self.strictest();
        self.place(id, MKind::SetProtection(bands), level)
    }

    pub fn add_second_device(&mut self, signer: u8, key: u8) -> MResult {
        self.gate(signer)?;
        if self.second.iter().any(|(k, _)| *k == key) {
            return Ok(MOut { done: true, ready_at: None, needs_device: false });
        }
        if self.second.len() >= MAX_SECOND_DEVICES {
            return Err("at most four second devices");
        }
        if self.key_in_use(key) {
            return Err("key already on this account");
        }
        let id = self.take_id();
        let level = if self.second.is_empty() && self.in_setup_window() { MLevel::FaceId } else { self.strictest() };
        self.place(id, MKind::AddSecondDevice(key), level)
    }

    pub fn remove_key(&mut self, signer: u8, key: u8) -> MResult {
        self.gate(signer)?;
        if self.recovery_key == Some(key) {
            return Err("the backup key changes only with new words");
        }
        if key == signer {
            return Err("this phone can't remove its own key");
        }
        let id = self.take_id();
        let level = if self.second.iter().any(|(k, _)| *k == key) { self.strictest().without_device() } else { self.strictest() };
        self.place(id, MKind::RemoveKey(key), level)
    }

    pub fn set_recovery_key(&mut self, signer: u8, key: u8) -> MResult {
        self.gate(signer)?;
        if self.recovery_key == Some(key) {
            return Ok(MOut { done: true, ready_at: None, needs_device: false });
        }
        if self.key_in_use(key) {
            return Err("key already on this account");
        }
        if self.recovery.is_some() {
            return Err("a recovery waits: new words after it ends");
        }
        let id = self.take_id();
        let level = if self.recovery_key.is_none() { MLevel::FaceId } else { self.strictest() };
        self.place(id, MKind::SetRecoveryKey(key), level)
    }

    /// Release 9: an upgrade to a listed release (or one whose addition already waits) is placed; for any other, the
    /// addition to the list is placed instead.
    pub fn upgrade(&mut self, signer: u8) -> MResult {
        self.gate(signer)?;
        let id = self.take_id();
        let level = self.strictest();
        let asked = self.pending.iter().any(|p| matches!(p.kind, MKind::AllowRelease(h, _) if h == UPGRADE_HASH));
        if self.releases.contains(&UPGRADE_HASH) || asked {
            return self.place(id, MKind::Upgrade, level);
        }
        let now = self.now;
        self.place(id, MKind::AllowRelease(UPGRADE_HASH, now), level)
    }

    /// Release 9 (I-2): a second device of age refills the words' fee allowance; nothing in the state changes.
    pub fn refill_recovery_key(&mut self, signer: u8) -> MResult {
        self.second_gate(signer)?;
        if !self.aged(signer) {
            return Err("too young to refill the words");
        }
        if self.recovery_key.is_none() {
            return Err("no words");
        }
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    pub fn cancel_recovery(&mut self, signer: u8) -> MResult {
        self.gate(signer)?;
        if self.recovery.is_none() {
            return Err("no recovery is waiting");
        }
        if self.pending.iter().any(|p| matches!(p.kind, MKind::CancelRecovery)) {
            return Err("a stop is already waiting");
        }
        if self.aged_count() == 0 {
            self.end_recovery(true);
            return Ok(MOut { done: true, ready_at: None, needs_device: false });
        }
        if self.stop_asked {
            return Err("one stop per recovery with a device of age");
        }
        self.stop_asked = true;
        let id = self.take_id();
        let wait = DAY.min(self.delay / 2) / SECOND;
        self.place(id, MKind::CancelRecovery, MLevel::Wait(wait))
    }

    // ── The second device's methods ──────────────────────────────────────────────────────────────────────────────

    pub fn approve(&mut self, signer: u8, id: u64) -> MResult {
        self.second_gate(signer)?;
        let index = self.index(id)?;
        let cancels = matches!(self.pending[index].kind, MKind::CancelRecovery);
        let p = &self.pending[index];
        if !(p.needs_device || p.kind.is_setting() || cancels) {
            return Err("doesn't need your second device");
        }
        if !p.needs_device && !self.aged(signer) {
            return Err("too young to co-sign");
        }
        let young = !self.aged(signer);
        let co_signed_before = self.co_signed(p);
        let p = &mut self.pending[index];
        if !(young && co_signed_before) {
            p.approver = if young { None } else { Some(signer) };
        }
        p.approved = true;
        let p = self.pending[index].clone();
        let may_run = self.recovery.is_none() || self.co_signed(&p);
        if cancels || (may_run && self.now >= p.ready_at) {
            return self.finish(id);
        }
        Ok(MOut { done: false, ready_at: Some(p.ready_at), needs_device: false })
    }

    pub fn decline(&mut self, signer: u8, id: u64) -> MResult {
        self.second_gate(signer)?;
        let index = self.index(id)?;
        let p = self.pending[index].clone();
        if matches!(p.kind, MKind::CancelRecovery) {
            if !self.aged(signer) {
                return Err("too young to refuse this");
            }
            self.drop(id);
            return Ok(MOut { done: true, ready_at: None, needs_device: false });
        }
        let removes_device = matches!(p.kind, MKind::RemoveKey(k) if self.second.iter().any(|(d, _)| *d == k));
        let disputed = self.recovery.is_some() && self.aged(signer) && !self.co_signed(&p);
        if !(p.needs_device || (disputed && !removes_device)) {
            return Err("doesn't need your second device");
        }
        if removes_device {
            return Err("can't stop a second device's removal");
        }
        self.drop(id);
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    // ── The words' methods ───────────────────────────────────────────────────────────────────────────────────────

    /// Release 7: the second device of age says yes to the waiting recovery. `stale`: the yes names another recovery
    /// (an earlier finish time), so it must be refused.
    pub fn approve_recovery(&mut self, signer: u8, stale: bool) -> MResult {
        self.second_gate(signer)?;
        if self.recovery.is_none() {
            return Err("no recovery is waiting");
        }
        if stale {
            return Err("that isn't the recovery waiting now");
        }
        if !self.aged(signer) {
            return Err("too young to say yes to a recovery");
        }
        self.recovery_yes = Some(signer);
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    /// Release 7: the second device of age stops the waiting recovery; spending stays frozen for the floor.
    pub fn refuse_recovery(&mut self, signer: u8, confirm_stop: bool) -> MResult {
        self.second_gate(signer)?;
        if self.recovery.is_none() {
            return Err("no recovery is waiting");
        }
        if !self.aged(signer) {
            return Err("too young to refuse a recovery");
        }
        // Re-audit 7 (R7-4, R7-9): only the device's explicit confirmation of the phone's waiting stop co-signs it (two
        // of three, no freeze); a plain refusal always freezes.
        let waiting = self.pending.iter().position(|p| matches!(p.kind, MKind::CancelRecovery));
        if confirm_stop && waiting.is_none() {
            return Err("no stop from the phone is waiting to confirm");
        }
        if let (true, Some(i)) = (confirm_stop, waiting) {
            self.pending[i].approved = true;
            self.pending[i].approver = Some(signer);
            let id = self.pending[i].id;
            return self.finish(id);
        }
        self.end_recovery(true);
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    pub fn start_recovery(&mut self, signer: u8, new_key: u8) -> MResult {
        self.words_gate(signer)?;
        if self.recovery.is_some() {
            return Err("a recovery is already waiting");
        }
        if self.key_in_use(new_key) {
            return Err("key already on this account");
        }
        self.recovery = Some((new_key, self.now + self.delay));
        self.recovery_yes = None;
        self.stop_asked = false;
        self.drop_unapproved();
        self.restart_young_ages(u64::MAX);
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    /// Release 7: why the waiting recovery can't finish now (its delay; with a device of age, its yes or the fallback).
    fn finish_blocked(&self) -> Option<&'static str> {
        let (_, ready_at) = self.recovery?;
        if self.now < ready_at {
            return Some("the recovery can finish later");
        }
        if self.aged_count() > 0 && !self.recovery_approved() && self.now < self.fallback_at() {
            return Some("the second device hasn't said yes: the fallback is later");
        }
        None
    }

    pub fn finish_blocked_pub(&self) -> bool {
        self.finish_blocked().is_some()
    }

    /// Release 9 (R8-RS1): the words' finish only checks, marks the recovery as finishing and asks NEAR to add the new
    /// key; the rest is `on_recovery_key`. One finish on its way at a time; a second one only an hour after the first.
    pub fn finish_recovery(&mut self, signer: u8) -> MResult {
        self.words_gate(signer)?;
        let (new_key, ready_at) = self.recovery.ok_or("no recovery is waiting")?;
        if let Some(why) = self.finish_blocked() {
            return Err(why);
        }
        if let Some((_, _, asked)) = self.finishing {
            if self.now < asked.saturating_add(3_600 * SECOND) {
                return Err("finishing already");
            }
        }
        self.finishing = Some((new_key, ready_at, self.now));
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    /// Release 9 (R8-RS1): the finish's callback. `added`: NEAR added the new key. The recovery completes only if the
    /// add succeeded, the same recovery still waits and it may still finish; otherwise nothing but the marker changes.
    /// Re-freeze 2: only the callback of the finish on record (its key and `asked`) acts; any other does nothing at all.
    pub fn on_recovery_key(&mut self, new_key: u8, ready_at: u64, asked: u64, added: bool) -> MResult {
        if !self.finishing.map_or(false, |f| f.0 == new_key && f.2 == asked) {
            return Ok(MOut { done: true, ready_at: None, needs_device: false });
        }
        self.finishing = None;
        if added && self.recovery == Some((new_key, ready_at)) && self.finish_blocked().is_none() {
            self.complete_recovery(new_key);
        }
        Ok(MOut { done: true, ready_at: None, needs_device: false })
    }

    fn complete_recovery(&mut self, new_key: u8) {
        self.recovery = None;
        self.recovery_yes = None;
        self.stop_asked = false;
        self.phones = vec![new_key];
        self.sealed = true;
        self.drop_unapproved();
        self.freeze_until = 0;
        let young: Vec<u8> = self.second.iter().filter(|(k, _)| !self.aged(*k)).map(|(k, _)| *k).collect();
        for k in young {
            self.forget_second_device(k);
        }
    }

    pub fn advance(&mut self, by: u64) {
        self.now += by;
    }
}
