// Swap in place (product decision, 5 Nov): coins listed on NEAR Intents swap INSIDE it. One signed intent settles in
// the private balance itself: no withdraw, no deposit from a chain, no bridge. Source A, the NEAR wallet: its private
// balance (NEAR Confidential) pays and gets, the core's own swap (subwallet.float.swap: one NEP-413 intent the wallet's
// key signs, checked against the quote as 1Click signed it). Who prices it today is 1Click, the only way into a private
// balance open to ZeroFee (no third-party layer where a direct path exists; NEAR Intents' Private Relay is
// asked for). When it opens, only the core's quote changes: this file names the quoter once (QUOTER).
// The job is made at the tap, names the protocol ("NEAR Intents is swapping it") and the quoter's own time; the end is
// the core's read of the move, and its time is measured from the tap, never promised. Pure but for the bridge it is handed.
import type { Bridge } from "@zerofee/core/bridge";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import type { PickCoin } from "./coin-pick.ts";
import { ROW_USDC } from "./swap-corridor.ts";
import { coinShown } from "./swap-coins.ts";
import type { LiveTrack } from "./live-steps.ts";

/** The protocol the swap settles on, and who prices it today (one line to change when the Private Relay opens). */
export const PROTOCOL = "NEAR Intents";
export const QUOTER = "NEAR Intents";

export { inplaceOf, nearCoinId, type InplaceRoute } from "./swap-inplace-route.ts";
import type { InplaceRoute } from "./swap-inplace-route.ts";

/** subwallet.float.swapQuote's answer (the core's dry quote: display only; the tap's real quote is the core's own). */
export interface InplaceQuote { amountIn: string; amountOut: string; minAmountOut: string; decimals: number; symbol?: string; coinUsd: number; etaSeconds?: number }
/** A NEAR coin the NEAR wallet holds (its raw units and dollars), for a sale. */
export interface InplaceHeld { raw: string; usd: number }

/** What the swap pays, in smallest units: dollars of cash (6 decimals), or that share of the coin held (Max: all of it). */
export function inplaceUnits(side: "buy" | "sell", usd: number, all: boolean, held?: InplaceHeld): string | null {
  if (!(usd > 0)) return null;
  if (side === "buy") { const u = BigInt(Math.floor(usd * 1e6)); return u > 0n ? u.toString() : null; }
  if (!held || !/^\d{1,40}$/.test(held.raw) || !(held.usd > 0)) return null;
  const raw = BigInt(held.raw);
  if (all) return raw > 0n ? raw.toString() : null;
  const u = (raw * BigInt(Math.round(usd * 100))) / BigInt(Math.round(held.usd * 100));
  return u > 0n ? (u > raw ? raw : u).toString() : null;
}

/** The quote in dollars: what leaves, what arrives, and the difference (the fee, all in the price). */
export function inplaceFigures(side: "buy" | "sell", q: InplaceQuote): { payUsd: number; getUsd: number; feeUsd: number } {
  const coin = (raw: string) => (Number(raw) / 10 ** q.decimals) * q.coinUsd;
  const payUsd = side === "buy" ? Number(q.amountIn) / 1e6 : coin(q.amountIn);
  const getUsd = side === "buy" ? coin(q.amountOut) : Number(q.amountOut) / 1e6;
  return { payUsd, getUsd, feeUsd: Math.max(0, Math.round((payUsd - getUsd) * 100) / 100) };
}

/** "About 3.2 NEAR" (a buy), "About $9.94" (a sale into cash): the quote's own figure. */
export function inplaceArrives(side: "buy" | "sell", q: InplaceQuote, symbol: string): string {
  return side === "buy" ? `About ${coinShown(Number(q.amountOut) / 10 ** q.decimals)} ${q.symbol || symbol}` : `About $${(Number(q.amountOut) / 1e6).toFixed(2)}`;
}

/** The words (copywriter, 5 Nov). */
export const INPLACE_WORDS = {
  step: `${PROTOCOL} is swapping it`,
  stepDone: `${PROTOCOL} swapped it`,
  landed: "It's in your NEAR wallet.",
  refunded: `${PROTOCOL} couldn't swap it. Your money is back in your NEAR wallet.`,
  checking: `${PROTOCOL} hasn't finished yet. Your money is in your NEAR wallet.`,
  lost: `${PROTOCOL} didn't answer. Your money is in your NEAR wallet. Activity shows if it swapped.`,
  declined: "Nothing moved.",
  late: `${QUOTER} didn't answer.`,
} as const;

/** Under the amount: where it happens, who prices it, the fee (the quote's own difference), and the quoter's own time. */
export function inplaceLine(side: "buy" | "sell", q: InplaceQuote): string {
  const { feeUsd } = inplaceFigures(side, q);
  const fee = feeUsd >= 0.01 ? `fees $${feeUsd.toFixed(2)}` : "fees under $0.01";
  const time = q.etaSeconds ? `, about ${q.etaSeconds} s` : "";
  return `${PROTOCOL} swaps it in your NEAR wallet. ${QUOTER} prices it: ${fee}${time}.`;
}

/** The job's detail at the tap: the quoter's own time, or none (never a figure of ours). */
export const tapDetail = (q: InplaceQuote): string | undefined => (q.etaSeconds ? `${QUOTER} says about ${q.etaSeconds} s` : undefined);
/** Landed, with the time it really took from the tap (measured). */
export const tookLine = (ms: number): string => `Took ${(Math.max(0, ms) / 1000).toFixed(1)} s.`;

/** A move of the NEAR wallet as subwallet.float.swap and .move answer it (the fields read here). */
interface Move { id: string; status: "pending" | "done" | "failed" | "refunded"; reason?: string }

/** How often the move is read while it runs: every 250 ms for its first 5 s, then each second; past 10 min, "checking". */
export const FOLLOW_FAST_MS = 250, FOLLOW_FAST_FOR_MS = 5_000, FOLLOW_SLOW_MS = 1_000, FOLLOW_GIVE_UP_MS = 10 * 60_000;

export interface InplaceView { state: "doing" | "done" | "failed"; end?: { ok: boolean; line: string }; checking?: string; atMs?: number }

/**
 * The swap behind its job: one call (subwallet.float.swap: the core asks the real quote, checks it as 1Click signed it,
 * signs ONE intent and hands it on), then the move read until it ends. Home's Jobs row (tasks) and the sheet's tracker
 * (`onView`) say the same. Never throws.
 */
export async function runInplaceJob(o: {
  bridge: Bridge; tasks: Tasks | undefined; rowId: string; route: InplaceRoute; units: string; q: InplaceQuote; key: string; tapMs: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>; onView?: (v: InplaceView) => void;
}): Promise<"done" | "failed" | "checking"> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fail = (line: string): "failed" => {
    o.tasks?.update(o.rowId, { steps: [{ label: INPLACE_WORDS.step, state: "failed" }] });
    o.tasks?.end(o.rowId, "failed", line);
    o.onView?.({ state: "failed", end: { ok: false, line } });
    return "failed";
  };
  let m: Move;
  try {
    const r = await o.bridge.call<Move | { declined: true }>("subwallet.float.swap", { side: o.route.side, coin: o.route.coin, amount: o.units, atLeast: o.q.minAmountOut, key: o.key });
    if ("problem" in r) return fail(r.problem.whatHappened);
    if ("declined" in r.ok) return fail(INPLACE_WORDS.declined);
    m = r.ok;
  } catch {
    return fail(INPLACE_WORDS.lost);
  }
  const t0 = now();
  while (m.status === "pending") {
    if (now() - t0 > FOLLOW_GIVE_UP_MS) {
      o.tasks?.update(o.rowId, { detail: INPLACE_WORDS.checking });
      o.onView?.({ state: "doing", checking: INPLACE_WORDS.checking });
      return "checking";
    }
    await sleep(now() - t0 < FOLLOW_FAST_FOR_MS ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS);
    const r = await o.bridge.call<Move>("subwallet.float.move", { id: m.id }).catch(() => null);
    if (r && "ok" in r) m = r.ok;
  }
  if (m.status !== "done") return fail(m.reason === "declined" ? INPLACE_WORDS.declined : INPLACE_WORDS.refunded);
  const at = now();
  o.tasks?.update(o.rowId, { steps: [{ label: INPLACE_WORDS.stepDone, state: "done", at }], detail: tookLine(at - o.tapMs) });
  o.tasks?.end(o.rowId, "done");
  o.onView?.({ state: "done", end: { ok: true, line: `${INPLACE_WORDS.landed} ${tookLine(at - o.tapMs)}` }, atMs: at - o.tapMs });
  return "done";
}

/** The sheet's tracker from the job's view (LiveTracker's shape). */
export function inplaceTrack(t: LiveTrack, v: InplaceView, now: number): LiveTrack {
  const label = v.state === "done" ? INPLACE_WORDS.stepDone : v.checking ?? INPLACE_WORDS.step;
  const steps = [{ label, state: v.state, ...(v.atMs !== undefined ? { atMs: v.atMs } : {}) }];
  return { ...t, steps, ...(v.end ? { end: v.end, endMs: now } : {}) };
}

/** The NEAR wallet's coins as "You pay" rows (subwallet.float.balance), named and priced from 1Click's list; cash and
 *  coins with no name or price are left out (a sale needs its dollars). */
export function nearHeldRows(coins: readonly { tokenId: string; amount: string }[] | null, token: (id: string) => { symbol: string; decimals: number; priceUsd?: string; icon?: string } | undefined): (PickCoin & { held: InplaceHeld })[] {
  return (coins ?? []).flatMap((c) => {
    const t = token(c.tokenId);
    if (c.tokenId === ROW_USDC || !c.tokenId.startsWith("nep141:") || !t || !/^\d{1,40}$/.test(c.amount) || BigInt(c.amount) === 0n) return [];
    const usd = Math.floor((Number(c.amount) / 10 ** t.decimals) * (Number(t.priceUsd) || 0) * 100) / 100;
    if (!(usd >= 0.01)) return [];
    return [{ chain: "near" as const, address: c.tokenId.slice(7), symbol: t.symbol, name: "Your NEAR wallet", ...(t.icon ? { logo: t.icon } : {}), heldUsd: usd, held: { raw: c.amount, usd } }];
  });
}
