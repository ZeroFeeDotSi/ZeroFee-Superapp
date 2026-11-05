// T-3, the coin page's "Coin safety" card (QA, 3 Nov): one summary line ("3 checks fine · 1 to know"), then one row per
// check, each one plain sentence. It replaces the Security chips (coin-chips.ts) and sits above the chart.
//
// DISPLAY ONLY, NEVER A GATE: what Buy refuses is coin-refusal.ts's (and every Buy path checks the chain again). Nothing
// here is read by pageRefusal, and nothing here asks anyone anything: the card is drawn from the reads the coin page already
// makes, each cached per coin on the device (screen.ts's mint read, 10 minutes; the market's coin answer; the BNB / Robinhood
// checks' memo). No third-party safety service is asked (asking one would tell it which coins the person looks at).
//
// The checks, and where each answer comes from:
//   Freeze     Solana: "Nobody can freeze your coins" rests ONLY on the chain's own read (screen.ts: two nodes found the mint
//              clean); until it lands, or when it fails, the row says "Not checked yet" (QA, 3 Nov). A warning may rest on
//              either read (the mint's refusal, or the page's freeze flag): a warning is never hidden. BNB Chain /
//              Robinhood Chain: no such thing; the coin's owner() read stands in its place ("Owner"), as one row for both.
//   New coins  Solana: the mint authority.
//   Top 10     The share the ten biggest wallets hold, from the coin's market answer the page already has: a plain fact,
//              never counted as fine; 50 % or more is to know.
//   Creator    The share its creator's wallet holds, from the same answer: a plain fact; 20 % or more is to know.
//   Sell test  Solana: a refusal from the mint's read that is about selling (a transfer hook, a fee). BNB Chain / Robinhood Chain: recent holders' sends to the pool, simulated (evm-security.ts). Any chain: the
//              market answer's own "can't be sold" flag. Otherwise not checked yet.
//   Pool lock  Whether the money in its pool is locked: Trade has no read of it yet, so always "Not checked yet".
// A check with no answer says "Not checked yet", never a guess. The coin's own name, symbol or text never enters a verdict
// or a sentence (a scam coin can name itself "SAFE").
import type { CoinDetail } from "../market/types.ts";
import type { EvmSecurity } from "../market/evm-security.ts";
import type { BuyRefusal } from "../sol/screen.ts";
import type { ChainId } from "../types.ts";

/** "fact": a plain number, said but never counted as fine (Top 10, Creator under their lines). */
export type SafetyState = "fine" | "know" | "fact" | "unread";
export type CheckId = "freeze" | "mint" | "owner" | "top10" | "creator" | "sell" | "lock";
export interface SafetyRow { id: CheckId; label: string; state: SafetyState; text: string }
/** `rows`: every check and fact (unchanged verdicts). `card`: what the coin page shows (design review 10): the checks, and a
 *  fact only when it is something to know; `facts`: the plain facts (and facts not read yet), said in the page's More sheet.
 *  `summary` counts the card, so it never disagrees with what a person can count on screen. */
export interface CoinSafety { summary: string; rows: SafetyRow[]; card: SafetyRow[]; facts: SafetyRow[] }

/** The ten biggest wallets holding this share or more is something to know (they could move the price a lot). */
export const TOP10_KNOW_PCT = 50;
/** Its creator's wallet holding this share or more is something to know (the old chips' line). */
export const CREATOR_KNOW_PCT = 20;
export const NOT_CHECKED = "Not checked yet.";
/** A check with no answer asks its own question, then says it isn't checked yet (design review 10): a 5-year-old knows what
 *  wasn't checked, not only that something wasn't. */
export const QUESTION: Record<CheckId, string> = {
  freeze: "Can its maker freeze your coins?",
  mint: "Can its maker make more of it?",
  owner: "Does anyone control its code?",
  top10: "How much do the top 10 wallets hold?",
  creator: "How much does its creator hold?",
  sell: "Can you sell it back?",
  lock: "Can its maker pull the cash out?",
};
/** The plain facts (never a check): Top 10 and Creator. */
const FACT_IDS: ReadonlySet<CheckId> = new Set(["top10", "creator"]);

export interface SafetyInput {
  /** screen.ts's answer for this coin (Solana): why Buy refuses it, or undefined (clean, or not read). */
  mint?: BuyRefusal;
  /** Solana: true only when the chain's own read found the mint clean (runtime mintClean, after screen.ts answered). */
  mintClean?: boolean;
  /** The coin's market answer, as the page has it (undefined while it loads). */
  detail?: Pick<CoinDetail, "security" | "top10Pct" | "devPct" | "honeypot">;
  /** BNB Chain / Robinhood Chain: the coin's own checks (market.checks), undefined while they run or on another chain. */
  checks?: Pick<EvmSecurity, "owner" | "sell" | "cantSell">;
}

const row = (id: CheckId, label: string, state: SafetyState, text: string): SafetyRow => ({ id, label, state, text });
const unread = (id: CheckId, label: string) => row(id, label, "unread", `${QUESTION[id]} ${NOT_CHECKED}`);

function freezeRow(mint: BuyRefusal | undefined, freezeAuthority: boolean | undefined, chainClean: boolean): SafetyRow {
  if (mint === "freezable") return row("freeze", "Freeze", "know", "Its maker can freeze your coins, so you might not be able to sell them.");
  if (mint === "pausable") return row("freeze", "Freeze", "know", "Its maker can pause it, so you might not be able to sell it.");
  if (mint === "delegated") return row("freeze", "Freeze", "know", "Its maker can take it from any wallet, at any time.");
  if (freezeAuthority === true) return row("freeze", "Freeze", "know", "Its maker can freeze your coins, so you might not be able to sell them.");
  if (chainClean) return row("freeze", "Freeze", "fine", "Nobody can freeze your coins.");
  return unread("freeze", "Freeze");
}

function mintRow(mintAuthority: boolean | undefined): SafetyRow {
  if (mintAuthority === true) return row("mint", "New coins", "know", "Its maker can still make more. That can make yours worth less.");
  if (mintAuthority === false) return row("mint", "New coins", "fine", "Nobody can make more of it.");
  return unread("mint", "New coins");
}

function ownerRow(owner: EvmSecurity["owner"]): SafetyRow {
  if (owner === "none") return row("owner", "Owner", "fine", "Nobody controls its code. Its owner gave up control, or it never had one.");
  if (owner === "held") return row("owner", "Owner", "know", "Someone still controls its code. They could change how it works.");
  return unread("owner", "Owner");
}

const pctText = (pct: number) => (pct > 0 && pct < 1 ? "less than 1" : String(Math.round(pct)));
const pctOk = (pct: number | undefined): pct is number => pct !== undefined && Number.isFinite(pct) && pct >= 0 && pct <= 100;

function top10Row(pct: number | undefined): SafetyRow {
  if (!pctOk(pct)) return unread("top10", "Top 10");
  return pct >= TOP10_KNOW_PCT
    ? row("top10", "Top 10", "know", `Top 10 wallets hold ${pctText(pct)}%. They could move the price a lot.`)
    : row("top10", "Top 10", "fact", `Top 10 wallets hold ${pctText(pct)}%.`);
}

function creatorRow(pct: number | undefined): SafetyRow {
  if (!pctOk(pct)) return unread("creator", "Creator");
  return pct >= CREATOR_KNOW_PCT
    ? row("creator", "Creator", "know", `Its creator holds ${pctText(pct)}%. They could sell a lot at once.`)
    : row("creator", "Creator", "fact", `Its creator holds ${pctText(pct)}%.`);
}

/** A Solana refusal that isn't a freeze (a transfer hook, a fee) is about selling: the Sell test row says it. Any refusal
 *  this list doesn't know yet says the same as a hook, never nothing (security review M1). */
const SOL_SELL_WORDS: Partial<Record<BuyRefusal, string>> = {
  hooked: "Its maker could stop you selling it.",
  "fee-raisable": "Its maker can raise its fee and take most of a sale.",
  "fee-high": "It takes over 1% of every send or sale.",
};
const FREEZE_REFUSALS: ReadonlySet<BuyRefusal> = new Set(["freezable", "pausable", "delegated"]);

function sellRow(checks: SafetyInput["checks"], flagged: boolean | undefined, mint?: BuyRefusal): SafetyRow {
  if (mint !== undefined && !FREEZE_REFUSALS.has(mint)) return row("sell", "Sell test", "know", SOL_SELL_WORDS[mint] ?? "Its maker could stop you selling it.");
  if (checks?.cantSell || checks?.sell === "fails") return row("sell", "Sell test", "know", "Recent buyers couldn't sell it. That is a common trap.");
  if (flagged === true) return row("sell", "Sell test", "know", "Market data says buyers might not be able to sell it.");
  if (checks?.sell === "passes") return row("sell", "Sell test", "fine", "Recent holders could sell it. A high sell fee wouldn't show here.");
  return unread("sell", "Sell test");
}

/** The summary line: counts only, the fine first ("2 fine · 1 to know · 1 not checked yet"); a plain fact is never counted as
 *  fine. Given the card's rows, so it counts exactly what is on screen. */
export function safetySummary(rows: SafetyRow[]): string {
  const n = (s: SafetyState) => rows.filter((r) => r.state === s).length;
  const parts: string[] = [];
  const fine = n("fine"), know = n("know"), un = n("unread");
  if (fine) parts.push(`${fine} fine`);
  if (know) parts.push(`${know} to know`);
  if (un) parts.push(`${un} not checked yet`);
  return parts.join(" · ");
}

/** The card for one coin. Pure: no reads, no clock, no coin text. */
export function coinSafety(chain: ChainId, o: SafetyInput): CoinSafety {
  const d = o.detail;
  const rows: SafetyRow[] = [];
  if (chain === "sol") {
    rows.push(freezeRow(o.mint, d?.security?.freezeAuthority, o.mintClean === true), mintRow(d?.security?.mintAuthority));
  } else if (chain === "bsc" || chain === "hood") {
    rows.push(ownerRow(o.checks?.owner));
  } else {
    rows.push(unread("freeze", "Freeze"), unread("mint", "New coins"));
  }
  const evm = chain === "bsc" || chain === "hood";
  rows.push(top10Row(d?.top10Pct), creatorRow(d?.devPct), sellRow(evm ? o.checks : undefined, d?.honeypot, chain === "sol" ? o.mint : undefined), unread("lock", "Pool lock"));
  // the card: every check, and a fact only when it is something to know (a warning is never moved out of sight)
  const card = rows.filter((r) => !FACT_IDS.has(r.id) || r.state === "know");
  const facts = rows.filter((r) => FACT_IDS.has(r.id) && r.state !== "know");
  return { summary: safetySummary(card), rows, card, facts };
}

/**
 * A coin people may not be able to sell back: its sell check's own words when that check says so, else undefined (UX audit
 * 4 Nov: a honeypot's page led with a green "+18.0%", and its warning was the second row of a fold-out). The coin page
 * shows it first, under the name, before any price or change.
 */
export function sellTrap(card: readonly SafetyRow[]): string | undefined {
  return card.find((r) => r.id === "sell" && r.state === "know")?.text;
}
