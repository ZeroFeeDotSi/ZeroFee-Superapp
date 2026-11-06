// Swap in place (product decision, 5 Nov): coins listed on NEAR Intents swap INSIDE it. One signed intent settles in
// the private balance itself: no withdraw, no deposit from a chain, no bridge. Source A, the NEAR wallet: its private
// balance (NEAR Confidential) pays and gets, the core's own swap (subwallet.float.swap: one NEP-413 intent the wallet's
// key signs, checked against the quote as 1Click signed it). Who prices it today is 1Click, the only way into a private
// balance open to ZeroFee (no third-party layer where a direct path exists; NEAR Intents' Private Relay is
// asked for). When it opens, only the core's quote changes: this file names the quoter once (QUOTER).
// The job is made at the tap, names the protocol ("NEAR Intents is swapping it") and the quoter's own time; the end is
// the core's read of the move, and its time is measured from the tap, never promised. Pure but for the bridge it is handed.
import type { Bridge } from "@zerofee/core/bridge";
import { feesFigure } from "@zerofee/core/zero-fee";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import type { PickCoin } from "./coin-pick.ts";
import { ROW_USDC, SWAP_MIN_USD, SWAP_WORDS } from "./swap-corridor.ts";
import { dollars } from "../format.ts";
import { nearOwnCoins } from "../near-coins.ts";
import { coinShown } from "./swap-coins.ts";
import { NEAR_SWAP_BACK, NEAR_SWAP_SHEET_LINE, NEAR_SWAP_STEP_UNFINISHED, NEAR_SWAP_UNFINISHED, NEAR_SWAP_UNSURE, SWAP_AGAIN, swapEndOf } from "../../near-swap-words.ts";
import type { LiveTrack } from "./live-steps.ts";

/** The protocol the swap settles on, and who prices it today (one line to change when the Private Relay opens). */
export const PROTOCOL = "NEAR Intents";
export const QUOTER = "NEAR Intents";

export { inplaceOf, nearCoinId, type InplaceRoute } from "./swap-inplace-route.ts";
import type { InplaceRoute } from "./swap-inplace-route.ts";

/** subwallet.float.swapQuote's answer (the core's dry quote: display only; the tap's real quote is the core's own). */
export interface InplaceQuote { amountIn: string; amountOut: string; minAmountOut: string; decimals: number; symbol?: string; coinUsd: number; etaSeconds?: number }
/** A NEAR coin the NEAR wallet holds (its raw units and dollars; null: 1Click's list has no price for it), for a sale. */
export interface InplaceHeld { raw: string; usd: number | null }

/**
 * What the swap pays, in smallest units: dollars of cash (6 decimals), or that share of the coin held. Max is ALL of it:
 * the cash's own raw units (`cashRaw`: never the cents below them, so nothing is stranded), or every unit of the coin.
 */
export function inplaceUnits(side: "buy" | "sell", usd: number, all: boolean, held?: InplaceHeld, cashRaw?: string): string | null {
  if (side === "buy") {
    if (all && cashRaw && /^\d{1,40}$/.test(cashRaw) && BigInt(cashRaw) > 0n) return cashRaw;
    if (!(usd > 0)) return null;
    const u = BigInt(Math.floor(usd * 1e6));
    return u > 0n ? u.toString() : null;
  }
  if (!held || !/^\d{1,40}$/.test(held.raw)) return null;
  const raw = BigInt(held.raw);
  if (all) return raw > 0n ? raw.toString() : null;
  if (!(usd > 0) || !(held.usd !== null && held.usd > 0)) return null;
  const u = (raw * BigInt(Math.round(usd * 100))) / BigInt(Math.round(held.usd * 100));
  return u > 0n ? (u > raw ? raw : u).toString() : null;
}

/**
 * Why Swap can't go yet, or null (bug hunt, 4 Nov, item 5: Max lit Swap under the floor, then the core refused it
 * and the line blamed NEAR Intents). The floor is checked here, before any quote: Home's $2 for a buy and a part of a
 * coin; only a sale of ALL of a coin goes under it (the core's own rule: never stuck in the wallet). A coin with no price
 * doesn't sell at all until it has one (the core's own rule: no price, no swap).
 */
export function inplaceBlock(o: { side: "buy" | "sell"; amount: number; all: boolean; most: number; priced: boolean }): string | null {
  if (o.side === "sell" && !o.priced) return INPLACE_WORDS.noPrice;
  if (o.side === "sell" && o.all) return null;
  if (!(o.amount > 0)) return SWAP_WORDS.amount;
  if (o.amount < SWAP_MIN_USD) return SWAP_WORDS.least;
  if (o.amount > o.most + 0.004) return SWAP_WORDS.most(dollars(o.most.toFixed(2)));
  return null;
}

/** The NEAR wallet's cash (its USDC), to the cent below, and its raw units: the one figure a buy can spend (item 4: no
 *  move-out fee room, an in-place swap has no move out). null: its balance isn't read. */
export function nearCash(coins: readonly { tokenId: string; amount: string }[] | null): { usd: number; raw: string } | null {
  if (!coins) return null;
  const c = coins.find((t) => t.tokenId === ROW_USDC && /^\d{1,40}$/.test(t.amount));
  const raw = c ? c.amount : "0";
  return { usd: Math.floor(Number(raw) / 1e4) / 100, raw };
}

/** The quote in dollars: what leaves, what arrives, and the difference (the fee, all in the price). */
export function inplaceFigures(side: "buy" | "sell", q: InplaceQuote): { payUsd: number; getUsd: number; feeUsd: number } {
  const coin = (raw: string) => (Number(raw) / 10 ** q.decimals) * q.coinUsd;
  const payUsd = side === "buy" ? Number(q.amountIn) / 1e6 : coin(q.amountIn);
  const getUsd = side === "buy" ? coin(q.amountOut) : Number(q.amountOut) / 1e6;
  return { payUsd, getUsd, feeUsd: Math.max(0, Math.round((payUsd - getUsd) * 100) / 100) };
}

/** "You get about 3.2 NEAR, at least 3.1 NEAR. About 10 s." (a buy), "You get about $9.94, at least $9.84." (a sale into USDC): the
 *  quote's own figure, the least the tap signs (`atLeast`, its minAmountOut: item 9, it was never shown), and the quoter's own time. */
export function inplaceArrives(side: "buy" | "sell", q: InplaceQuote, symbol: string): string {
  const time = q.etaSeconds ? ` About ${q.etaSeconds} s.` : "";
  if (side === "sell") return `You get about $${(Number(q.amountOut) / 1e6).toFixed(2)}, at least $${(Math.floor(Number(q.minAmountOut) / 1e4) / 100).toFixed(2)}.${time}`;
  const sym = q.symbol || symbol;
  return `You get about ${coinShown(Number(q.amountOut) / 10 ** q.decimals)} ${sym}, at least ${coinShown(Number(q.minAmountOut) / 10 ** q.decimals)} ${sym}.${time}`;
}

/** Where the money is while nobody can prove it: a signed or submitted move may have run. */
const UNSURE = `Your money is ${NEAR_SWAP_UNSURE.where}.`;
const CHECK = NEAR_SWAP_UNSURE.check;

/** The words (copywriter, 5 Nov). */
export const INPLACE_WORDS = {
  step: `${PROTOCOL} is swapping it.`,
  stepDone: `${PROTOCOL} swapped it.`,
  stepFailed: NEAR_SWAP_STEP_UNFINISHED,
  landed: "It's in your NEAR wallet.",
  /** Only a true refund, the core's status: 1Click's own no says NOT_TAKEN_REASON (the money never left), any other failure `failed`. */
  refunded: NEAR_SWAP_BACK,
  /** Any other failed move, 1Click's FAILED among them: it promises no refund. A whole line (no "The swap didn't finish." before it). */
  failed: `${NEAR_SWAP_UNFINISHED} ${UNSURE} ${CHECK}`,
  checking: `${PROTOCOL} hasn't finished yet. ${UNSURE}`,
  lost: `${PROTOCOL} didn't answer. ${UNSURE} Activity shows if it swapped.`,
  /** A job a week old whose move the core has let go (float-moves.ts KEEP_MS): nobody can read its end now. */
  unread: `This swap is more than a week old, so ZeroFee can't read how it ended. ${UNSURE} ${CHECK}`,
  declined: "Nothing moved.",
  /** A tap the core's readable record never had: it keeps a move before it signs (KEEP BEFORE SIGN), so nothing was signed. */
  nothing: "Nothing moved. Your money stayed in your NEAR wallet.",
  late: `${QUOTER} didn't answer.`,
  /** Under a price that failed (J02). Nothing was signed: no quote, no Swap (InplaceSwap.tsx go), and a dry quote signs nothing (float-moves.ts swapQuote). */
  stillThere: "Your money is still in your NEAR wallet.",
  /** The core swaps nothing its list doesn't price (float-moves.ts swapNow, swapQuote), a whole sale included: no door to offer. */
  noPrice: `${QUOTER} gave no price for this coin.`,
} as const;

/** The fee block's figure, in the one form (the copy review, 6 Nov): the quote's own difference. */
export const inplaceFee = (side: "buy" | "sell", q: InplaceQuote): string | null => feesFigure(inplaceFigures(side, q).feeUsd);

/** The job's title (copy review, 6 Nov: two decimals, as Move's): "Swap $10.00 of USDC for ZEC". */
export const inplaceTitle = (usd: number, pay: string, get: string): string => `Swap $${usd.toFixed(2)} of ${pay} for ${get}`;
/** A price that failed, and where the money is: nothing was signed (INPLACE_WORDS.stillThere). The core's own words may say so already. */
export const quoteFailed = (words: string): string => (/Nothing moved/.test(words) ? words : `${words} ${INPLACE_WORDS.stillThere}`);

/** The job's detail at the tap: the quoter's own time, or none (never a figure of ours). */
export const tapDetail = (q: { etaSeconds?: number }): string | undefined => (q.etaSeconds ? `${QUOTER} says about ${q.etaSeconds} s` : undefined);
/** When the quoter says it is done: its own time counted down on the job's row and tracker (item 11: the tracker said only
 *  "· now"), or none (never a figure of ours). */
export const endsAtOf = (tapMs: number, q: { etaSeconds?: number }): { endsAt?: number } => (q.etaSeconds ? { endsAt: tapMs + q.etaSeconds * 1000 } : {});
/** Landed, with the time it really took from the tap (measured). */
export const tookLine = (ms: number): string => `Took ${(Math.max(0, ms) / 1000).toFixed(1)} s.`;

/** A move of the NEAR wallet as subwallet.float.swap, .move and .moves answer it (the fields read here). */
export interface InplaceMove { id: string; kind?: string; status: "pending" | "done" | "failed" | "refunded"; reason?: string; usd?: number; sent?: { tokenId: string; amount: string }; expected?: { tokenId: string; amount: string }; startedAtIso?: string }

/** How often the move is read while it runs: every 250 ms for its first 5 s, then each second; past 10 min from the tap it
 *  says "checking" and goes on reading every 10 s, until the core says how it ended. */
export const FOLLOW_FAST_MS = 250, FOLLOW_FAST_FOR_MS = 5_000, FOLLOW_SLOW_MS = 1_000, FOLLOW_CHECK_AFTER_MS = 10 * 60_000, FOLLOW_CHECK_MS = 10_000;
/** How long the core keeps a move (float-moves.ts KEEP_MS): only past this can nothing read its end. The store's clock ends
 *  a job here and no sooner: a closed phone that comes back finds the job pending, and the core's record ends it. */
export const INPLACE_STALE_MS = 7 * 86_400_000;
/** The core's answer for a move it doesn't hold (security-problems.ts floatMoveUnknown). */
const MOVE_UNKNOWN = "security.float.unknown-move";
/** The core's reason when 1Click itself refused a signed intent (float-moves.ts SWAP_NOT_TAKEN): the money never left. */
export const NOT_TAKEN_REASON = "NEAR Intents didn't take it. Nothing moved.";

export interface InplaceView { state: "doing" | "done" | "failed"; end?: { ok: boolean; line: string; whole?: true; head?: string; back?: true }; checking?: string; atMs?: number; /** refused before anything started */ before?: true }

/** The step lines and end of a job, said once to Home's Jobs row (tasks) and the sheet's tracker (`onView`). Every end's line
 *  is its whole story (real-tap proof, 6 Nov): live-steps.ts endLine puts nothing before it, so the sheet says what the row says. */
interface Say { tasks: Tasks | undefined; rowId: string; onView?: ((v: InplaceView) => void) | undefined }
function failWith(o: Say, line: string, before = false): "failed" {
  // only 1Click's FAILED (or one stuck) has a step that didn't finish: any other end names no step (rule 10, one end said once)
  o.tasks?.update(o.rowId, { steps: line === INPLACE_WORDS.failed ? [{ label: INPLACE_WORDS.stepFailed, state: "failed" }] : [] });
  o.tasks?.end(o.rowId, "failed", line);
  o.onView?.({ state: "failed", end: { ok: false, ...swapEndOf(line) }, ...(before ? { before: true as const } : {}) });
  return "failed";
}

/** What a move's end may say: only a true refund says the money is back; 1Click's own no, that nothing moved (audit, 6 Nov:
 *  the core drops that signed intent, or read the balance still holding it, so "back" would say it left). */
export function failedLine(m: Pick<InplaceMove, "status" | "reason">): string {
  if (m.reason === "declined") return INPLACE_WORDS.declined;
  if (m.status === "refunded") return INPLACE_WORDS.refunded;
  return m.reason === NOT_TAKEN_REASON ? NOT_TAKEN_REASON : INPLACE_WORDS.failed;
}

type Follow = Say & { bridge: Bridge; tapMs: number; now: () => number; sleep: (ms: number) => Promise<void>; /** Picked up on a load: a move already over ended while nobody watched. */ resumed?: boolean };

/** The move read until it ends, for as long as it takes; the job ends on what the core says, never on a clock. */
async function follow(o: Follow, m0: InplaceMove): Promise<"done" | "failed"> {
  let m = m0;
  const t0 = o.now();
  let checking = false;
  while (m.status === "pending") {
    const age = o.now() - o.tapMs;
    if (age > FOLLOW_CHECK_AFTER_MS && !checking) {
      checking = true;
      o.tasks?.update(o.rowId, { detail: INPLACE_WORDS.checking });
      o.onView?.({ state: "doing", checking: INPLACE_WORDS.checking });
    }
    await o.sleep(checking ? FOLLOW_CHECK_MS : o.now() - t0 < FOLLOW_FAST_FOR_MS ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS);
    const r = await o.bridge.call<InplaceMove>("subwallet.float.move", { id: m.id }).catch(() => null);
    if (r && "ok" in r) m = r.ok;
    // the core let it go (a week old): no later read can answer. Younger, the move may still be live: this keeps reading
    else if (r && "problem" in r && r.problem.code === MOVE_UNKNOWN && o.now() - o.tapMs >= INPLACE_STALE_MS) return failWith(o, INPLACE_WORDS.unread);
  }
  if (m.status !== "done") return failWith(o, failedLine(m));
  const at = o.now();
  // the time it took only when it was watched: a phone closed through its end would count the time it was closed
  const took = (!o.resumed || m0.status === "pending") && at - o.tapMs <= FOLLOW_CHECK_AFTER_MS ? tookLine(at - o.tapMs) : null;
  o.tasks?.update(o.rowId, { steps: [{ label: INPLACE_WORDS.stepDone, state: "done", at }], detail: took ?? INPLACE_WORDS.landed });
  o.tasks?.end(o.rowId, "done");
  o.onView?.({ state: "done", end: { ok: true, line: took ? `${INPLACE_WORDS.landed} ${took}` : INPLACE_WORDS.landed }, ...(took ? { atMs: at - o.tapMs } : {}) });
  return "done";
}

/** The answer to a tap was lost: the job goes on, and says so. */
function sayLost(o: Say): void {
  o.tasks?.update(o.rowId, { detail: INPLACE_WORDS.lost });
  o.onView?.({ state: "doing", checking: INPLACE_WORDS.lost });
}

/** A job whose answer was lost (a reload, a dropped call): its move found in the core's record and followed. A read that
 *  fails ends nothing: it is read again. Only a record read whole, with no such move, ends it: "Nothing moved" (the core
 *  keeps a move before it signs), once the tap has had time to get there.
 *  `refusal` (audit, 6 Nov): the core did answer, with this problem, yet it can throw after it handed the swap on (float-moves.ts
 *  swapNow's last keep), and a row once ended can't correct itself. So the record decides here too: a move there is followed;
 *  none there, or one the core ended itself with no reason (its own refusal, nothing signed), ends on the refusal's words, at
 *  once, as the tap is over. A read that fails says what a lost answer says, the row going on, and never "Nothing moved". */
async function pickUp(o: Follow, refusal?: string): Promise<"done" | "failed"> {
  const id = moveIdOf(o.rowId);
  let waited = false, said = false;
  for (;;) {
    const r = await o.bridge.call<InplaceMove[]>("subwallet.float.moves").catch(() => null);
    const moves = r && "ok" in r && Array.isArray(r.ok) ? r.ok : null;
    if (!moves) {
      if (refusal !== undefined && !said) { said = true; sayLost(o); }
      await o.sleep(FOLLOW_CHECK_MS);
      continue;
    }
    const m = moves.find((x) => x.id === id);
    if (m && !(refusal !== undefined && m.status === "failed" && !m.reason)) return follow(o, m);
    if (refusal !== undefined) return failWith(o, refusal, true);
    const age = o.now() - o.tapMs;
    if (age >= INPLACE_STALE_MS) return failWith(o, INPLACE_WORDS.unread);
    if (waited || age >= RESUME_WAIT_MS) return failWith(o, INPLACE_WORDS.nothing, true);
    waited = true;
    await o.sleep(RESUME_WAIT_MS - age);
  }
}

/**
 * The swap behind its job: one call (subwallet.float.swap: the core asks the real quote, checks it as 1Click signed it,
 * signs ONE intent and hands it on), then the move read until it ends. Home's Jobs row (tasks) and the sheet's tracker
 * (`onView`) say the same. The core keeps the move by its key from before it signs (float-moves.ts KEEP BEFORE SIGN), and
 * the job's row is in Home's sealed store, so a reload finds it again (resumeInplace). Never throws.
 */
export async function runInplaceJob(o: {
  bridge: Bridge; tasks: Tasks | undefined; rowId: string; route: InplaceRoute; units: string; q: InplaceQuote; key: string; tapMs: number;
  now?: () => number; sleep?: (ms: number) => Promise<void>; onView?: (v: InplaceView) => void;
}): Promise<"done" | "failed"> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const say: Say = { tasks: o.tasks, rowId: o.rowId, onView: o.onView };
  running.add(o.rowId);
  try {
    let m: InplaceMove;
    try {
      const r = await o.bridge.call<InplaceMove | { declined: true }>("subwallet.float.swap", { side: o.route.side, coin: o.route.coin, amount: o.units, atLeast: o.q.minAmountOut, key: o.key });
      if ("problem" in r) return await pickUp({ ...say, bridge: o.bridge, tapMs: o.tapMs, now, sleep }, r.problem.whatHappened);
      if ("declined" in r.ok) return failWith(say, INPLACE_WORDS.declined, true);
      m = r.ok;
    } catch {
      // the answer was lost, not the swap: it may have run, so the core's record says how it ended
      sayLost(say);
      return await pickUp({ ...say, bridge: o.bridge, tapMs: o.tapMs, now, sleep });
    }
    return await follow({ ...say, bridge: o.bridge, tapMs: o.tapMs, now, sleep }, m);
  } finally {
    running.delete(o.rowId);
  }
}

/** The step as a job kept by an earlier build says it: still this job's, so a reload finds it. */
const STEP_NO_STOP = `${PROTOCOL} is swapping it`;
/** The jobs this page is following itself (resumeInplace leaves them alone). */
const running = new Set<string>();

/** The core's id for a job's move: both are made from the one key of the tap (`swap:<key>`, `fm-<key>`). */
export const moveIdOf = (rowId: string): string => `fm-${rowId.slice("swap:".length)}`;

/** How long after its tap a job not in the core's moves may still be on its way into it; past this, nothing reached the
 *  protocol (the core keeps a move before it signs anything). The phone's core outlives a page reload and can still be
 *  waiting on its quote, so this waits well past a slow one (audit, 6 Nov: at 30 s the row could say "Nothing moved" and
 *  the core then sign). */
export const RESUME_WAIT_MS = 120_000;

/**
 * Item 3 (a reload mid-swap left the job "swapping" forever): on every load of Home, once its sealed job rows are back,
 * each in-place job still pending is picked up from the core's own moves (subwallet.float.moves) and followed to its end;
 * one the core never had ends "Nothing moved". A moves read that fails ends nothing. Never throws.
 */
export async function resumeInplace(o: { bridge: Bridge; tasks: Tasks | undefined; pending: readonly { id: string; steps: readonly { label: string }[]; startedAt: number }[]; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<number> {
  const now = o.now ?? Date.now, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // only Swap in place's own rows: another swap's job has its own step's words and its own way to end
  const ours = o.pending.filter((t) => t.id.startsWith("swap:") && !running.has(t.id) && (t.steps[0]?.label === INPLACE_WORDS.step || t.steps[0]?.label === STEP_NO_STOP));
  if (!ours.length) return 0;
  await Promise.all(ours.map(async (t) => {
    running.add(t.id);
    try {
      await pickUp({ tasks: o.tasks, rowId: t.id, bridge: o.bridge, tapMs: t.startedAt, now, sleep, resumed: true });
    } catch { /* a job row that can't be written: the next load picks it up */ } finally {
      running.delete(t.id);
    }
  }));
  return ours.length;
}

/** The sheet's tracker from the job's view (LiveTracker's shape). */
export function inplaceTrack(t: LiveTrack, v: InplaceView, now: number): LiveTrack {
  if (v.state === "failed") {
    const unfinished = v.end?.line === NEAR_SWAP_SHEET_LINE;
    return { ...t, steps: unfinished ? [{ label: INPLACE_WORDS.stepFailed, state: "failed" }] : [], ...(v.end ? { end: v.end, endMs: now } : {}), ...(v.end?.line === INPLACE_WORDS.refunded ? { next: [{ label: SWAP_AGAIN, go: { kind: "swap" as const } }] } : {}) };
  }
  const label = v.state === "done" ? INPLACE_WORDS.stepDone : v.checking ?? INPLACE_WORDS.step;
  const steps = [{ label, state: v.state, ...(v.atMs !== undefined ? { atMs: v.atMs } : {}) }];
  return { ...t, steps, ...(v.end ? { end: v.end, endMs: now } : {}) };
}

/** The NEAR wallet's coins as "You pay" rows (subwallet.float.balance), named and priced from 1Click's list; its cash and
 *  dust are left out. A coin the list doesn't price is kept with no dollars: shown, and said why it can't sell yet. */
export function nearHeldRows(coins: readonly { tokenId: string; amount: string }[] | null, token: (id: string) => { symbol: string; decimals: number; priceUsd?: string; icon?: string } | undefined): (PickCoin & { held: InplaceHeld })[] {
  return nearOwnCoins(coins, token, true).map((c) => {
    const usd = c.usd === null ? null : Number(c.usd);
    return { chain: "near" as const, address: c.address, symbol: c.symbol, name: "Your NEAR wallet", ...(c.icon ? { logo: c.icon } : {}), ...(usd !== null ? { heldUsd: usd } : {}), held: { raw: c.raw, usd } };
  });
}
