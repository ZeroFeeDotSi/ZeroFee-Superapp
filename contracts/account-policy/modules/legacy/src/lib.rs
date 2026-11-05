//! Legacy: your money still reaches the people you choose, even if something happens to you.
//!
//! A module of the account contract (contracts/account-policy). It is **pure**: no promises, no `env`, no access
//! checks. The account contract stores `legacy: Option<LegacyState>`, guards every method, passes in the caller and
//! the block time, and turns a payout plan into transfers. So every money movement and every access check stays in one
//! place.
//!
//! How it works:
//! - The owner names heirs (NEAR accounts) with whole-percent shares, a quiet period (e.g. 12 months) and a claim delay
//!   (e.g. 30 days). Setting it up or changing it goes through the account's strictest protection level.
//! - Anything the owner's own keys do on the account is a sign of life (`on_owner_activity`): spending, settings, a
//!   Face ID "I'm here", a finished recovery. It restarts the quiet period and stops any claim.
//! - After a full quiet period with no sign of life, any heir can start a claim. It waits the claim delay, and the
//!   owner's phone can stop it.
//! - After the claim delay, any heir can trigger the payout: spendable NEAR and the approved NEAR Intents tokens, split
//!   by shares. Each share rounds down and the remainder goes to the first heir, so the total never exceeds the
//!   balance. It can run again for anything that arrives later, until the owner comes back.
//!
//! Recovery (the 24 words) after death: someone who found the words could take the account in 7 days, long before the
//! heirs could claim. So while a claim is waiting, a recovery can't start; and once the owner has been silent for 30
//! days (or the quiet period, if shorter), any heir may cancel a recovery.
use near_sdk::json_types::U64;
use near_sdk::{near, AccountId};

pub const SECOND: u64 = 1_000_000_000;
pub const DAY_NS: u64 = 86_400 * SECOND;
/// The shortest quiet period and claim delay accepted (60 s exists for testnet demos; the app offers months).
pub const MIN_PERIOD_NS: u64 = 60 * SECOND;
pub const MAX_QUIET_NS: u64 = 10 * 365 * DAY_NS;
pub const MAX_CLAIM_DELAY_NS: u64 = 365 * DAY_NS;
pub const MAX_HEIRS: usize = 10;
pub const MAX_TOKENS: usize = 32;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Heir {
    pub account_id: AccountId,
    /// Whole percent, 1–100. All heirs' shares add up to 100.
    pub share_pct: u8,
}

/// What the owner chooses (the arguments of the `legacy.setup` security method).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyConfig {
    /// In order: the first heir also gets the rounding remainder.
    pub heirs: Vec<Heir>,
    pub quiet_seconds: U64,
    pub claim_delay_seconds: U64,
    /// NEAR Intents token ids the payout may move: "nep141:<contract>" or "nep245:<contract>:<id>". NEAR itself is
    /// always paid out; NFTs can't be split by shares, so they aren't accepted.
    pub tokens: Vec<String>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub by: AccountId,
    pub started_at_ns: U64,
    /// Block time (ns) from which the payout may run.
    pub ready_at_ns: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum StoppedBy {
    /// The owner tapped "I'm here. Stop it."
    Owner,
    /// The owner used the account (any Face ID action), which stops a claim by itself.
    Activity,
}

/// The last claim the owner stopped, so the phone can say "Mia asked for your money; you used your account, so it
/// stopped."
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct StoppedClaim {
    pub claim: Claim,
    pub stopped_at_ns: U64,
    pub by: StoppedBy,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyState {
    pub heirs: Vec<Heir>,
    pub quiet_ns: U64,
    pub claim_delay_ns: U64,
    pub tokens: Vec<String>,
    /// The owner's last sign of life (block time, ns).
    pub last_seen_ns: U64,
    pub claim: Option<Claim>,
    pub last_stopped: Option<StoppedClaim>,
}

/// One heir's part of a payout. The account contract sends `near` as a transfer and `tokens` as one
/// `mt_batch_transfer` on intents.near.
#[derive(Clone, Debug, PartialEq)]
pub struct Payout {
    pub receiver_id: AccountId,
    pub near: u128,
    pub tokens: Vec<(String, u128)>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Stage {
    /// The owner was heard from recently enough; nobody can ask yet.
    Quiet,
    /// A full quiet period has passed: any heir can start a claim.
    CanClaim,
    /// A claim started; the owner's phone can stop it until `ready_at_ns`.
    ClaimWaiting,
    /// The claim delay is over: any heir can trigger the payout.
    CanPayOut,
}

/// What both phones show: the owner's ("Last check-in: today") and each heir's ("Last heard from 3 days ago").
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LegacyStatus {
    pub stage: Stage,
    pub heirs: Vec<Heir>,
    pub quiet_seconds: U64,
    pub claim_delay_seconds: U64,
    pub tokens: Vec<String>,
    pub last_seen_ns: U64,
    /// When a claim may start, if none has.
    pub claimable_at_ns: U64,
    pub claim: Option<Claim>,
    pub last_stopped: Option<StoppedClaim>,
}

/// Check the owner's choices and start the quiet period now. `owner` is the account itself, which can't be its own heir.
pub fn setup(owner: &AccountId, cfg: LegacyConfig, now_ns: u64) -> Result<LegacyState, String> {
    let LegacyConfig { heirs, quiet_seconds, claim_delay_seconds, tokens } = cfg;
    if heirs.is_empty() || heirs.len() > MAX_HEIRS {
        return Err("name between one and ten people".into());
    }
    let mut total: u32 = 0;
    for (i, heir) in heirs.iter().enumerate() {
        if &heir.account_id == owner {
            return Err("this account can't be its own heir".into());
        }
        if heirs[..i].iter().any(|h| h.account_id == heir.account_id) {
            return Err(format!("{} is named twice", heir.account_id));
        }
        if heir.share_pct == 0 {
            return Err(format!("{} needs a share of at least 1%", heir.account_id));
        }
        total += u32::from(heir.share_pct);
    }
    if total != 100 {
        return Err(format!("the shares add up to {total}%, not 100%"));
    }
    let quiet_ns = to_ns(quiet_seconds.0).filter(|ns| (MIN_PERIOD_NS..=MAX_QUIET_NS).contains(ns)).ok_or("the quiet period must be between 60 seconds and 10 years")?;
    let claim_delay_ns = to_ns(claim_delay_seconds.0).filter(|ns| (MIN_PERIOD_NS..=MAX_CLAIM_DELAY_NS).contains(ns)).ok_or("the claim delay must be between 60 seconds and 1 year")?;
    if tokens.len() > MAX_TOKENS {
        return Err("at most 32 coins".into());
    }
    for (i, token) in tokens.iter().enumerate() {
        if !is_splittable_token(token) {
            return Err(format!("{token} isn't a coin the legacy can split"));
        }
        if tokens[..i].contains(token) {
            return Err(format!("{token} is listed twice"));
        }
    }
    Ok(LegacyState { heirs, quiet_ns: U64(quiet_ns), claim_delay_ns: U64(claim_delay_ns), tokens, last_seen_ns: U64(now_ns), claim: None, last_stopped: None })
}

impl LegacyState {
    pub fn is_heir(&self, who: &AccountId) -> bool {
        self.heirs.iter().any(|h| &h.account_id == who)
    }

    /// When a claim may start: a full quiet period after the owner's last sign of life.
    pub fn claimable_at_ns(&self) -> u64 {
        self.last_seen_ns.0.saturating_add(self.quiet_ns.0)
    }

    /// A sign of life from the owner's own keys: restart the quiet period and stop any claim, waiting or ready. Returns
    /// the claim it stopped, so the contract can log it.
    pub fn on_owner_activity(&mut self, now_ns: u64) -> Option<Claim> {
        self.stop(now_ns, StoppedBy::Activity)
    }

    /// An heir asks, after a full quiet period. The payout may run after the claim delay, unless the owner stops it.
    pub fn start_claim(&mut self, caller: &AccountId, now_ns: u64) -> Result<(), String> {
        if !self.is_heir(caller) {
            return Err("only someone named in this legacy can ask".into());
        }
        if self.claim.is_some() {
            return Err("a claim has already started".into());
        }
        let at = self.claimable_at_ns();
        if now_ns < at {
            return Err(format!("you can ask in {} seconds", ceil_seconds(at - now_ns)));
        }
        let ready_at_ns = now_ns.checked_add(self.claim_delay_ns.0).ok_or("time overflow")?;
        self.claim = Some(Claim { by: caller.clone(), started_at_ns: U64(now_ns), ready_at_ns: U64(ready_at_ns) });
        Ok(())
    }

    /// The owner's phone stops a claim ("I'm here. Stop it."). Like `on_owner_activity`, but it insists a claim was
    /// there to stop: call one or the other for a request, not both.
    pub fn cancel_claim(&mut self, now_ns: u64) -> Result<Claim, String> {
        if self.claim.is_none() {
            return Err("no claim is waiting".into());
        }
        Ok(self.stop(now_ns, StoppedBy::Owner).expect("checked above"))
    }

    fn stop(&mut self, now_ns: u64, by: StoppedBy) -> Option<Claim> {
        self.last_seen_ns = U64(self.last_seen_ns.0.max(now_ns));
        let claim = self.claim.take()?;
        self.last_stopped = Some(StoppedClaim { claim: claim.clone(), stopped_at_ns: U64(now_ns), by });
        Some(claim)
    }

    /// Who gets what, once the claim delay is over. `near_spendable` is the NEAR the contract can give away (after its
    /// own storage reserve); `balances` are this account's NEAR Intents balances of approved tokens.
    pub fn payout_plan(&self, now_ns: u64, near_spendable: u128, balances: &[(String, u128)]) -> Result<Vec<Payout>, String> {
        let claim = self.claim.as_ref().ok_or("no claim has started")?;
        if now_ns < claim.ready_at_ns.0 {
            return Err(format!("it can be paid out in {} seconds", ceil_seconds(claim.ready_at_ns.0 - now_ns)));
        }
        if balances.len() > MAX_TOKENS {
            return Err("at most 32 coins at once".into());
        }
        for (i, (token, _)) in balances.iter().enumerate() {
            if !self.tokens.contains(token) {
                return Err(format!("{token} isn't one of the coins this legacy pays out"));
            }
            if balances[..i].iter().any(|(t, _)| t == token) {
                return Err(format!("{token} is listed twice"));
            }
        }
        let near = self.split(near_spendable);
        let tokens: Vec<(&String, Vec<u128>)> = balances.iter().map(|(t, amount)| (t, self.split(*amount))).collect();
        let mut plan = vec![];
        for (i, heir) in self.heirs.iter().enumerate() {
            let payout = Payout {
                receiver_id: heir.account_id.clone(),
                near: near[i],
                tokens: tokens.iter().filter(|(_, parts)| parts[i] > 0).map(|(t, parts)| ((*t).clone(), parts[i])).collect(),
            };
            if payout.near > 0 || !payout.tokens.is_empty() {
                plan.push(payout);
            }
        }
        if plan.is_empty() {
            return Err("there's nothing to pay out".into());
        }
        Ok(plan)
    }

    /// While a claim is waiting, the 24 words can't start moving the account to a new phone.
    pub fn blocks_recovery(&self, now_ns: u64) -> bool {
        matches!(&self.claim, Some(c) if now_ns < c.ready_at_ns.0)
    }

    /// An heir may cancel a recovery only once the owner has been silent for the whole quiet period they chose, when the
    /// heirs could claim anyway (audit F11: after 30 days an heir could veto a living owner who'd lost their phone, every
    /// time, until the claim). Within it, whoever has the backup words can always come back.
    pub fn can_cancel_recovery(&self, caller: &AccountId, now_ns: u64) -> bool {
        self.is_heir(caller) && now_ns >= self.last_seen_ns.0.saturating_add(self.quiet_ns.0)
    }

    pub fn status(&self, now_ns: u64) -> LegacyStatus {
        let stage = match &self.claim {
            None if now_ns < self.claimable_at_ns() => Stage::Quiet,
            None => Stage::CanClaim,
            Some(c) if now_ns < c.ready_at_ns.0 => Stage::ClaimWaiting,
            Some(_) => Stage::CanPayOut,
        };
        LegacyStatus {
            stage,
            heirs: self.heirs.clone(),
            quiet_seconds: U64(self.quiet_ns.0 / SECOND),
            claim_delay_seconds: U64(self.claim_delay_ns.0 / SECOND),
            tokens: self.tokens.clone(),
            last_seen_ns: self.last_seen_ns,
            claimable_at_ns: U64(self.claimable_at_ns()),
            claim: self.claim.clone(),
            last_stopped: self.last_stopped.clone(),
        }
    }

    /// Each heir's part of `amount`, in heir order: rounded down, with the remainder going to the first heir.
    fn split(&self, amount: u128) -> Vec<u128> {
        let mut parts: Vec<u128> = self.heirs.iter().map(|h| share_of(amount, h.share_pct)).collect();
        let given: u128 = parts.iter().sum();
        parts[0] += amount - given;
        parts
    }
}

/// `amount × pct / 100`, rounded down, without overflowing even at u128::MAX.
fn share_of(amount: u128, pct: u8) -> u128 {
    let pct = u128::from(pct);
    (amount / 100) * pct + (amount % 100) * pct / 100
}

fn to_ns(seconds: u64) -> Option<u64> {
    seconds.checked_mul(SECOND)
}

fn ceil_seconds(ns: u64) -> u64 {
    ns.div_ceil(SECOND)
}

/// Fungible NEAR Intents token ids: "nep141:<account>" or "nep245:<account>:<id>".
fn is_splittable_token(token: &str) -> bool {
    if token.len() > 128 {
        return false;
    }
    if let Some(contract) = token.strip_prefix("nep141:") {
        return contract.parse::<AccountId>().is_ok();
    }
    if let Some((contract, id)) = token.strip_prefix("nep245:").and_then(|rest| rest.split_once(':')) {
        return contract.parse::<AccountId>().is_ok() && !id.is_empty();
    }
    false
}

#[cfg(test)]
mod tests;
