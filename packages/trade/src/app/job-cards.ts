// Activity as Wallet V1's job cards (V1 port slice 7): one card per trade and per move of the one balance, its title and
// one result line, a badge (Done, Running, Waiting, Didn't go), and its steps as a timeline that fills: done (a check and
// its time), happening now (a pulse, and how long it should take), next (its number), or stopped (where it stopped, and
// where the money is). A step that is retrying looks like one that is running: calm, never red. The words are Activity's
// own (a trade that didn't happen says nothing moved, or that only its network fee was spent).
import type { TradeRecord } from "../service.ts";
import type { MoveRow } from "../float-view.ts";
import { moveWords } from "../move-words.ts";
import { whereWords } from "./boards.ts";
import { WALLET_NAME } from "@zerofee/core/spending";
import { amount, tookWords, usd } from "./format.ts";
import { tradeUsd } from "../trade-usd.ts";
import { liveCheckable } from "../live-check.ts";
import { uncheckedLine } from "../trade-problems.ts";

export type StepState = "done" | "now" | "next" | "stopped";
export interface Step { label: string; state: StepState; at?: number; note?: string; etaSec?: number }
/** "Check" (the copy review's, 7 Nov): a trade whose amount nobody could confirm (unchecked): mute, never Done. */
export type Badge = "Done" | "Running" | "Waiting" | "Didn't go" | "Check";
/** Activity's row (design review 3 Nov, item 24): the coin it was (its logo), what moved in its own units ("1,501 DOPE"),
 *  the dollars on the right, and a status only while it isn't done ("Sending…", "Didn't go through", "Waiting"). */
export interface Card { id: string; title: string; result: string; badge: Badge; at: number; steps: Step[]; held?: MoveRow["held"];
  coin?: { chain: TradeRecord["chain"]; address: string; symbol: string }; usd?: number; units?: string; status?: string;
  /** A move's row: the bundled logo of the wallet it moves to or from (its chain's; the NEAR wallet's for the Safe's). */
  moveIcon?: string;
  /** A trade whose coin Rhea kept (trade.near.rhea-kept, the audit's MUST, 7 Nov): what its way back needs (JobCard's KeptWay). */
  kept?: KeptFacts }
export interface KeptFacts { id: string; wallet: string; hash: string; token: string; symbol: string; decimals: number }

/** The networks by name, where a line is about the chain itself ("Sent to Solana"); a wallet is WALLET_NAME's, always. */
const CHAIN: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain", near: "NEAR" };
const wallet = (c?: string): string => (c && c in WALLET_NAME ? WALLET_NAME[c as keyof typeof WALLET_NAME] : "its wallet");
/** The status a row says while it isn't done; a done one says none. */
const STATUS: Record<Badge, string | undefined> = { Done: undefined, Running: "Sending…", Waiting: "Waiting", "Didn't go": "Didn't go through", Check: "Check" };
/** the audit's MUST (ii), 7 Nov: done on one node's word, its final amount never confirmed (trade.trade.final-unchecked). */
export const unchecked = (r: Pick<TradeRecord, "problem">): boolean => r.problem?.code === "trade.trade.final-unchecked" || keptCard(r);
/** the audit's MUST (7 Nov): Ref kept the trade's coin out on its side, never proven where (trade.near.rhea-kept). */
export const keptCard = (r: Pick<TradeRecord, "problem">): boolean => r.problem?.code === "trade.near.rhea-kept";
/** A kept trade's way back, as the card shows it: its head, its body, and Get it back, or the details to give Rhea's team. */
export interface KeptView { head: string; body?: string; claim?: { label: string; running: string }; details?: { open: string; head: string; rows: { label: string; value: string }[] } }

/**
 * A kept trade's way back (the audit's MUST, 7 Nov; the copy review's words, final), from what Ref's lost and found holds of its coin for the
 * wallet on two nodes (`held`, raw; null: can't tell; undefined: still reading). Some there: its amount and Get it back
 * (claim_lostfound, the wallet's own call). None: Ref's owner may hold it [inference: the contract's own log lines],
 * which only Rhea's team can send back: who to ask, the facts behind Show details, no button, no link (none verified).
 * Never a bare end.
 */
export function keptWay(k: KeptFacts, held: string | null | undefined): KeptView {
  if (held === undefined) return { head: "Checking with Rhea…" };
  if (held === null) return { head: "ZeroFee couldn't reach Rhea, so it stopped.", body: "Nothing moved. Open this again to check." };
  if (BigInt(held) > 0n) return { head: `Your ${k.symbol} is still with Rhea.`, body: `About ${amount(held, k.decimals)} ${k.symbol}. Nothing is lost.`, claim: { label: "Get it back", running: "Getting it back…" } };
  return {
    head: `Your ${k.symbol} didn't reach your NEAR wallet.`, body: "It's most likely with Rhea's team. Ask them to send it back.",
    details: { open: "Show details", head: "Give them these:", rows: [{ label: "Your wallet", value: k.wallet }, { label: "The trade", value: k.hash }, { label: "The coin", value: k.token }] },
  };
}
/** the copy review's receipt for a claim (7 Nov): while it runs, then done. */
export const keptRunning = (symbol: string, sec: number): string => `Job created. Rhea is sending your ${symbol} back. About ${sec} seconds left.`;
export const keptDone = (k: KeptFacts, got: string, ms: number): [string, string] => [`Done in ${Math.max(1, Math.round(ms / 1000))} seconds.`, `${amount(got, k.decimals)} ${k.symbol} · in your NEAR wallet`];
/** A claim's usual time: the send, the claim's receipts and another node's FINAL (about 5 s on mainnet). */
export const KEPT_CLAIM_SEC = 5;

// ---- trades ----
export function tradeTitle(r: TradeRecord): string {
  const did = r.status === "done", side = r.kind === "buy" ? "Bought" : "Sold";
  if (r.kind === "fund") return did ? `Added money to ${wallet(r.chain)}` : `Adding money to ${wallet(r.chain)}`;
  if (r.kind === "withdraw") return did ? "Moved money back to your Safe" : "Moving money back to your Safe";
  // the copy review's title (7 Nov): no figure; clamped short, "Bought <coin>" and the badge says Check
  if (did) return unchecked(r) ? `${side} ${r.symbol}, amount unchecked` : `${side} ${r.symbol}`;
  // the copy review's titles (7 Nov): a trade no read can place yet, and one the chain provably never took
  if (r.status === "unconfirmed") return `${r.kind === "buy" ? "Buy" : "Sell"} not confirmed`;
  if (r.status === "expired") return `${r.kind === "buy" ? "Buy" : "Sell"} stopped`;
  if (r.status === "declined" || r.status === "failed") return `Didn't ${r.kind === "buy" ? "buy" : "sell"} ${r.symbol}`;
  return `${r.kind === "buy" ? "Buying" : "Selling"} ${r.symbol}`;
}
export function tradeResult(r: TradeRecord, now = Date.now()): string {
  if (r.status === "declined") return "You said no · nothing moved";
  // a trade sent and reverted on chain paid its network fee (and an approval before it may have gone through); one that
  // expired, or failed before it was sent, moved nothing
  if (r.status === "failed" && r.hashes.length) return `${r.problem?.whatHappened.replace(/\.$/, "") ?? "It didn't go through"} · only the network fee${r.hashes.length > 1 ? "s were" : " was"} spent`;
  // the copy review's reasons (7 Nov), whole: an expiry says where the money is; a trade not confirmed yet says who is checking
  if (r.status === "expired") return `${CHAIN[r.chain] ?? "The network"} didn't confirm it in time, so nothing was traded. Your money is in ${wallet(r.chain)}.`;
  if (r.status === "failed") return `${r.problem?.whatHappened.replace(/\.$/, "") ?? "It didn't go through"} · nothing moved`;
  // "keeps checking" only where the live re-check can look at it while this card shows (live-check.ts); else the truth
  if (r.status === "unconfirmed") return `${CHAIN[r.chain] ?? "The network"} hasn't confirmed this trade yet. ${liveCheckable(r, now) ? "ZeroFee keeps checking." : "Open this again to check."}`;
  // the audit's MUST (ii), 7 Nov, the copy review's line: a trade whose final amount nobody will check says so, never a silent "done"
  if (keptCard(r)) return r.problem!.whatHappened;
  if (unchecked(r)) return uncheckedLine(r.kind === "sell" ? "sell" : "buy", r.symbol, CHAIN[r.chain]);
  if (r.kind === "fund") return r.status === "done" ? `${usd(r.amountUsd)} · arrived as ${r.symbol}` : r.held ? `On hold · ${usd(r.amountUsd)}` : `${usd(r.amountUsd)} · on its way`;
  const parts = [usd(r.amountUsd)];
  if (r.filledInMs !== undefined) parts.push(tookWords(r.filledInMs));
  if (r.route && r.kind !== "withdraw") parts.push(r.route);
  return parts.join(" · ");
}

/** A buy or sell: signed, sent to the network, landed. */
export function tradeCard(r: TradeRecord, now = Date.now()): Card {
  const stopped = r.status === "declined" || r.status === "failed" || r.status === "expired";
  const sent = r.sentAt !== undefined || r.hashes.length > 0;
  const signed = sent || r.status === "sending" || r.status === "confirming" || r.status === "done";
  // D143: a trade signs with nothing asked, so there is no "Approved" step (UX audit 4 Nov: it named a sheet nobody saw);
  // a trade the person turned down at a sheet (over a cap) still says so, on its first step
  const steps: Step[] = [
    ...(r.status === "declined" ? [{ label: "Approved", state: "stopped" as const }] : []),
    // T2-6 (the copy review's walk, 8 Nov): a buy's first step says where the money came from, by the wallet's real name ("Paid from
    // your SOL wallet"); a sale's still says the network it went to ("Sent to Solana")
    { label: r.kind === "buy" ? `Paid from ${wallet(r.chain)}` : `Sent to ${CHAIN[r.chain] ?? "the network"}`, state: sent ? "done" : signed ? (stopped ? "stopped" : "now") : "next", ...(r.sentAt ? { at: r.sentAt } : {}) },
    // the copy review (8 Nov): a buy's second step says where the coins landed, not the title again ("Landed in your SOL wallet")
    { label: r.kind === "sell" ? "Sold" : `Landed in ${wallet(r.chain)}`, state: r.status === "done" ? "done" : sent ? (stopped ? "stopped" : "now") : "next",
      ...(r.status === "done" && r.endedAt ? { at: r.endedAt } : {}), ...(r.status === "done" && r.filledInMs !== undefined ? { note: tookWords(r.filledInMs) } : {}) },
  ];
  if (stopped) { const i = steps.findIndex((s) => s.state === "stopped"); if (i >= 0) steps[i] = { ...steps[i]!, note: tradeResult(r, now) }; }
  const badge: Badge = r.status === "done" ? (unchecked(r) ? "Check" : "Done") : stopped ? "Didn't go" : "Running";
  // the coins that moved, in their own units: a buy's coins got (or quoted), a sale's coins sent
  const q = r.quote, raw = r.kind === "buy" ? r.fill?.got ?? q?.getRaw : r.kind === "sell" ? r.fill?.spent ?? q?.payRaw : undefined;
  const units = raw && q && (r.kind === "buy" || r.kind === "sell") ? `${amount(raw, q.decimals)} ${r.symbol}` : undefined;
  // the copy review's row words (7 Nov): "Not confirmed yet" while no read places it; "Buy stopped" once it provably never landed
  const status = r.status === "unconfirmed" ? "Not confirmed yet" : r.status === "expired" ? `${r.kind === "sell" ? "Sell" : "Buy"} stopped` : STATUS[badge];
  // the trade's own dollars, as its receipt and its task say them (webd-money2 crawl, 4 Nov: "Bought $0.78" beside a $0.50
  // receipt): the coin's part of the chain's figure, never the fee and the coin account's deposit on top (the receipt's lines)
  const own = tradeUsd(r);
  return { id: r.id, title: tradeTitle(r), result: tradeResult(r, now), badge, at: r.endedAt ?? r.startedAt, steps, usd: own,
    ...(r.coin && (r.kind === "buy" || r.kind === "sell") ? { coin: { chain: r.chain, address: r.coin, symbol: r.symbol } } : {}),
    ...(units ? { units } : {}), ...(status ? { status } : {}),
    ...(keptCard(r) && r.kept ? { kept: { id: r.id, ...r.kept, symbol: r.kept.token === "wrap.near" ? "NEAR" : r.symbol, decimals: r.kept.token === "wrap.near" ? 24 : q?.decimals ?? 0 } } : {}) };
}

// ---- the one balance's moves ----
/** Each kind's steps: the first is waiting its turn (the planner's short wait, or the protection's hold), then on its way, then there. */
function moveSteps(m: MoveRow): [string, string, string] {
  if (m.kind === "add") return [m.held ? "Waiting for your Safe's protection" : "Leaving your Safe", "On its way to your NEAR wallet", "In your NEAR wallet"];
  if (m.kind === "out") return ["Waiting", `On its way to ${wallet(m.chain)}`, `In ${wallet(m.chain)}`];
  if (m.kind === "in") return [`Leaving ${wallet(m.chain)}`, "On its way back to your NEAR wallet", "Back in your NEAR wallet"];
  return ["Collecting your money from each wallet", "On its way to your Safe", "In your Safe"];
}

export function moveCard(m: MoveRow, chainName?: string): Card {
  const [a, b, c] = moveSteps(m);
  const where = whereWords(m, chainName);
  const st = (i: number): StepState => {
    if (m.status === "done") return "done";
    if (m.status === "failed" || m.status === "refunded") return i === (m.status === "refunded" ? 1 : 0) ? "stopped" : i < (m.status === "refunded" ? 1 : 0) ? "done" : "next";
    if (m.status === "waiting") return i === 0 ? "now" : "next";
    return i === 0 ? "done" : i === 1 ? "now" : "next";                 // moving
  };
  const steps: Step[] = [a, b, c].map((label, i) => ({ label, state: st(i), ...(i === 0 && st(0) === "done" ? { at: m.at } : {}) }));
  const stop = steps.find((s) => s.state === "stopped");
  if (stop) stop.note = where;
  const now = steps.find((s) => s.state === "now");
  if (now && m.etaSec !== undefined) now.etaSec = m.etaSec;           // on its way: until it lands; waiting: until it goes
  const badge: Badge = m.status === "done" ? "Done" : m.status === "failed" || m.status === "refunded" ? "Didn't go" : m.status === "waiting" ? "Waiting" : "Running";
  const status = m.status === "waiting" ? "Waiting" : m.status === "moving" ? "Moving…" : STATUS[badge];
  return { id: m.id, title: moveWords(m), result: where, badge, at: m.at, steps, usd: m.usd, moveIcon: m.chain ?? "near", ...(status ? { status } : {}), ...(m.held ? { held: m.held } : {}) };
}

/** Running and waiting cards open (you watch them happen); a finished one closed (tap to see what happened). */
export const openByDefault = (c: Card): boolean => c.badge === "Running" || c.badge === "Waiting" || !!c.kept;
