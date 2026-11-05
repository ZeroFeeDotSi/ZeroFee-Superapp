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

export type StepState = "done" | "now" | "next" | "stopped";
export interface Step { label: string; state: StepState; at?: number; note?: string; etaSec?: number }
export type Badge = "Done" | "Running" | "Waiting" | "Didn't go";
/** Activity's row (design review 3 Nov, item 24): the coin it was (its logo), what moved in its own units ("1,501 DOPE"),
 *  the dollars on the right, and a status only while it isn't done ("Sending…", "Didn't go through", "Waiting"). */
export interface Card { id: string; title: string; result: string; badge: Badge; at: number; steps: Step[]; held?: MoveRow["held"];
  coin?: { chain: TradeRecord["chain"]; address: string; symbol: string }; usd?: number; units?: string; status?: string;
  /** A move's row: the bundled logo of the wallet it moves to or from (its chain's; the NEAR wallet's for the Safe's). */
  moveIcon?: string }

/** The networks by name, where a line is about the chain itself ("Sent to Solana"); a wallet is WALLET_NAME's, always. */
const CHAIN: Record<string, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain", near: "NEAR" };
const wallet = (c?: string): string => (c && c in WALLET_NAME ? WALLET_NAME[c as keyof typeof WALLET_NAME] : "its wallet");
/** The status a row says while it isn't done; a done one says none. */
const STATUS: Record<Badge, string | undefined> = { Done: undefined, Running: "Sending…", Waiting: "Waiting", "Didn't go": "Didn't go through" };

// ---- trades ----
export function tradeTitle(r: TradeRecord): string {
  const did = r.status === "done", side = r.kind === "buy" ? "Bought" : "Sold";
  if (r.kind === "fund") return did ? `Added money to ${wallet(r.chain)}` : `Adding money to ${wallet(r.chain)}`;
  if (r.kind === "withdraw") return did ? "Moved money back to your Safe" : "Moving money back to your Safe";
  if (did) return `${side} ${r.symbol}`;
  if (r.status === "declined" || r.status === "failed" || r.status === "expired") return `Didn't ${r.kind === "buy" ? "buy" : "sell"} ${r.symbol}`;
  return `${r.kind === "buy" ? "Buying" : "Selling"} ${r.symbol}`;
}
export function tradeResult(r: TradeRecord): string {
  if (r.status === "declined") return "You said no · nothing moved";
  // a trade sent and reverted on chain paid its network fee (and an approval before it may have gone through); one that
  // expired, or failed before it was sent, moved nothing
  if (r.status === "failed" && r.hashes.length) return `${r.problem?.whatHappened.replace(/\.$/, "") ?? "It didn't go through"} · only the network fee${r.hashes.length > 1 ? "s were" : " was"} spent`;
  if (r.status === "failed" || r.status === "expired") return `${r.problem?.whatHappened.replace(/\.$/, "") ?? "It didn't go through"} · nothing moved`;
  if (r.status === "unconfirmed") return `Sent · ${CHAIN[r.chain] ?? "the network"} hasn't confirmed it yet`;
  if (r.kind === "fund") return r.status === "done" ? `${usd(r.amountUsd)} · arrived as ${r.symbol}` : r.held ? `On hold · ${usd(r.amountUsd)}` : `${usd(r.amountUsd)} · on its way`;
  const parts = [usd(r.amountUsd)];
  if (r.filledInMs !== undefined) parts.push(tookWords(r.filledInMs));
  if (r.route && r.kind !== "withdraw") parts.push(r.route);
  return parts.join(" · ");
}

/** A buy or sell: signed, sent to the network, landed. */
export function tradeCard(r: TradeRecord): Card {
  const stopped = r.status === "declined" || r.status === "failed" || r.status === "expired";
  const sent = r.sentAt !== undefined || r.hashes.length > 0;
  const signed = sent || r.status === "sending" || r.status === "confirming" || r.status === "done";
  // D143: a trade signs with nothing asked, so there is no "Approved" step (UX audit 4 Nov: it named a sheet nobody saw);
  // a trade the person turned down at a sheet (over a cap) still says so, on its first step
  const steps: Step[] = [
    ...(r.status === "declined" ? [{ label: "Approved", state: "stopped" as const }] : []),
    { label: `Sent to ${CHAIN[r.chain] ?? "the network"}`, state: sent ? "done" : signed ? (stopped ? "stopped" : "now") : "next", ...(r.sentAt ? { at: r.sentAt } : {}) },
    { label: r.kind === "sell" ? "Sold" : "Bought", state: r.status === "done" ? "done" : sent ? (stopped ? "stopped" : "now") : "next",
      ...(r.status === "done" && r.endedAt ? { at: r.endedAt } : {}), ...(r.status === "done" && r.filledInMs !== undefined ? { note: tookWords(r.filledInMs) } : {}) },
  ];
  if (stopped) { const i = steps.findIndex((s) => s.state === "stopped"); if (i >= 0) steps[i] = { ...steps[i]!, note: tradeResult(r) }; }
  const badge: Badge = r.status === "done" ? "Done" : stopped ? "Didn't go" : "Running";
  // the coins that moved, in their own units: a buy's coins got (or quoted), a sale's coins sent
  const q = r.quote, raw = r.kind === "buy" ? r.fill?.got ?? q?.getRaw : r.kind === "sell" ? r.fill?.spent ?? q?.payRaw : undefined;
  const units = raw && q && (r.kind === "buy" || r.kind === "sell") ? `${amount(raw, q.decimals)} ${r.symbol}` : undefined;
  const status = STATUS[badge];
  // the trade's own dollars, as its receipt and its task say them (webd-money2 crawl, 4 Nov: "Bought $0.78" beside a $0.50
  // receipt): the coin's part of the chain's figure, never the fee and the coin account's deposit on top (the receipt's lines)
  const own = tradeUsd(r);
  return { id: r.id, title: tradeTitle(r), result: tradeResult(r), badge, at: r.endedAt ?? r.startedAt, steps, usd: own,
    ...(r.coin && (r.kind === "buy" || r.kind === "sell") ? { coin: { chain: r.chain, address: r.coin, symbol: r.symbol } } : {}),
    ...(units ? { units } : {}), ...(status ? { status } : {}) };
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
export const openByDefault = (c: Card): boolean => c.badge === "Running" || c.badge === "Waiting";
