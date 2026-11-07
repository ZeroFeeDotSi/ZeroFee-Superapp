// Move and a site's top-up pay from Private (NEAR Confidential: the product's HARD RULE, every money move confidential):
// the route's words and its refusal, for the ledger's route (wallet private-move.ts), the Sim and the job's steps. The
// fill's switch is safe-fill-open.ts. Loaded only with the route's own code, never in Home's first load.
import type { Problem } from "./problem.ts";
import { INFLOW_GAP_BPS } from "./inflow-grid.ts";
import { FEES_KEPT } from "./zero-fee.ts";
import { SERVICE_NAMES } from "./services.ts";

/** The payout couldn't go and came back to Private, its refund address (the copywriter, 5 Nov): never "failed". The
 *  route's steps are job-steps.ts's (privateMoveSteps), the one source for every job's words. S5 (the copy review's Sim walk, 5 Nov:
 *  "Your money is in Private" said no why): the copy review's words, the job's own figure: "The $5.00 is back in Private."; a figure
 *  truly unknown: "It's back in Private." */
export const privateBack = (usd?: number | null): string => (typeof usd === "number" && Number.isFinite(usd) && usd >= 0.01 ? `The $${usd.toFixed(2)} is back in Private.` : "It's back in Private.");
export const PRIVATE_BACK = privateBack();
/** A part whose payment never went and whose money is still on its way to Private (its Problem's money state
 *  "on-the-way": send-job.ts's slow end, leg 1 not arrived yet): never "back in Private" (audit, 6 Nov). Words provisional. */
export const privateOnWay = (usd?: number | null): string => (typeof usd === "number" && Number.isFinite(usd) && usd >= 0.01 ? `The $${usd.toFixed(2)} is on its way to Private.` : "It's on its way to Private.");
/** Said after privateOnWay on a stopped part (audit, 6 Nov): its row offers no Try again while that money is on its way. */
export const ONWAY_AGAIN = "Try again once it's there.";
/** Where to look after 1Click's FAILED, one full sentence on screen (copy review, 6 Nov): never "it comes back". 53, 7 Nov: "Check
 *  your Safe first.", the same form for every place (no "'s balance"). The ledger's
 *  failedProblem uses it (wallet-problems.ts); its one line (services.ts: "Your money is {where}. {check}") is a Move part's
 *  words once its payment's money is unsure (privateUnsure). */
export const unsureIn = (place: string) => ({ state: "unsure" as const, where: `either in ${place} or still with ${SERVICE_NAMES.oneclick}`, check: `Check ${place} first.` });
/** A Move part whose payment's money is unsure (audit, 6 Nov: leg 1 ended FAILED, or a hold past PRIVATE_KEEP_MS with no
 *  record): failedProblem's words for Private, as one line. No Try again (spending privUnsure). */
export const PRIVATE_UNSURE = `Your money is ${unsureIn("Private").where}. ${unsureIn("Private").check}`;
/** How long a Move's record and a slow payment's leg 1 are kept on the device (private-move.ts, send-job.ts): past it, a
 *  hold with no record left says PRIVATE_UNSURE and is read no more (audit, 6 Nov). */
export const PRIVATE_KEEP_MS = 3 * 86_400_000;
/** A Move that landed (the ledger's word) whose wallet reads failed to show it LANDED_MISSES times in a row (the copy review's words,
 *  QA's change, 5 Nov): never Done on a timer, said so until a read shows it. */
export const LANDED_UNREAD = "Can't read this right now. Your money is safe; it shows when the read works.";
export const LANDED_MISSES = 3;

/** A Move's fill sheet, its rows' names (the design session's words, 5 Nov; the copy review's, 7 Nov: never "Together"):
 *  "From your Safe · $150.00", "Stays in Private · $1.75" (fillRows below; core intents.ts legsBlock and the Sim's sheet). */
export const LEG_WORDS = { private: "From Private", safe: "From your Safe", stays: "Stays in Private", seen: "Anyone can see the Safe's part.", adds: (usd: string) => `Your Safe adds ${usd} to Private first.` } as const;
/** A Send's fill sheet, its legs block (the UI lead's rulings, 5 Nov; QA's Sim walk: the brackets are what the payee's
 *  coin is worth, the quote's amountOutUsd, and the payout's network fees are named last, "Fees · about $0.40",
 *  the same form as every outside sheet's, send-words.ts OUTSIDE_WORDS.fees): what they get first, once, the signed coin figure
 *  then the payout's dollars, then what the Safe sends and what stays in Private: "They get · 1.2345 SOL ($40.00)", "Your
 *  Safe sends · $50.00", "Stays in Private · $10.00" (core send-fill.ts and intents.ts; the Sim's sheet the same). No
 *  "Together" on this sheet, nor on the Move's (fillRows). */
/** `why`: said right under "Stays in Private" (QA's ledger re-walk, 6 Nov, b/12: "$30.00 leaves for a $25.00 Send" with no
 *  why), only when the Safe's figure is a whole step (roundFill). The true reason: the ledger's fill is a whole step over
 *  what Private is short by and its gap (fillStepUsd), so the Safe's public figure is never the payout's; the sheet says
 *  only that, never that nobody can match them (the time still can). Words provisional (the words reviewer). */
export const SEND_LEG_WORDS = { gets: "They get", sends: "From your Safe", stays: LEG_WORDS.stays, why: "Your Safe sends a round sum, so this send is harder to trace.", more: "Your Safe sends a little more than you typed; the rest stays in Private.", seen: (network: string) => (network === "NEAR" ? "Public on NEAR: anyone can see the Safe's part." : `Public on ${network}. Anyone can see the Safe's part on NEAR.`), fees: (usd: string) => (usd === "$0.00" ? "Fees · $0.00" : `Fees · about ${usd}`), kept: FEES_KEPT } as const;
/** A Move's fill sheet (the copy review's words, 7 Nov): the wallet that gets the leg, then the Safe, then what stays.
 *  `gets` takes the wallet's name as the core's own list says it ("your SOL wallet"). `why`: said right under "Stays in
 *  Private", only when a difference stays. `all`: the whole Move in one line, both sources and the total last. */
export const FILL_WORDS = {
  gets: (wallet: string) => `${wallet.charAt(0).toUpperCase()}${wallet.slice(1)} gets`,
  why: "Your Safe sends a little more than the wallet gets; the difference stays in Private.",
  all: (safe: string, priv: string, total: string) => `${safe} from your Safe, ${priv} from Private. ${total} in all.`,
  /** J4 (the copy review's walk and the audit's bar, 7 Nov): a Move of more parts is never titled by one leg's figure. Provisional (the audit's
   *  words; the copy review rules). */
  title: (safe: string, total: string) => `Your Safe adds ${safe} to this ${total} Move`,
} as const;
/** the copy review's one rule (7 Nov): "about" goes before every figure that comes from a quote (what a fill brings, what stays of it,
 *  what a payee gets and its dollars); a figure the person typed or the ledger holds (the Safe's bytes, a leg, Private's
 *  share) never gets it. Every sheet's quote figure goes through here: "Stays in Private · about $10.10". */
export const quoted = (figure: string): string => `about ${figure}`;
/** the copy review's final row for Private on every Check-this (J2-1/J2-2, 8 Nov; the audit's ruling: the core folds Private's share into
 *  the fill, so Private's change is a net one): "Private keeps the rest · about $4.37", the delta that closes the sum,
 *  hidden at $0.00. "Stays in Private" is retired on Check-this (Private's balance lives on the Private page). The rows
 *  close on sight: every From row = every gets row + Fee + the rest. Words: the copy review's; one home. */
export const PRIVATE_ROW_WORDS = { rest: "Private keeps the rest" } as const;
/** The Fee row on every fill's Check-this (J2-2: "Fee line on every Check-this"): a quote's figure is "about"; none taken
 *  (the bytes bring in what they send) says $0.00 plainly. */
export const feeRow = (fee: bigint, say: (v: bigint) => string): string => `Fee · ${fee > 0n ? quoted(say(fee)) : say(0n)}`;
/**
 * Private's row from its NET change on this job (`net`: what comes into Private less what leaves it, in the sheet's
 * units): a gain, "Private keeps the rest · about $X"; a loss, "From Private · $Y" (`about`: when a quote's figure is in
 * it), the core's plan taking money from Private on net. Nothing either way: no row. Pure: every sheet's sum test reads it.
 */
export function privateRows(net: bigint, say: (v: bigint) => string, o: { about: boolean }): string[] {
  if (net > 0n) return [`${PRIVATE_ROW_WORDS.rest} · ${quoted(say(net))}`];
  if (net === 0n) return [];
  return [`${LEG_WORDS.private} · ${o.about ? quoted(say(-net)) : say(-net)}`];
}
/** A Send's headline (J2-2, 53): "Send $25.00 to alice.near" when the payee is a short name; a long address (it is in
 *  full on the To row right under) keeps "Send $25.00 from your Safe". */
export const sendTitle = (figure: string, to: string): string => (to && to.length <= 32 && !/^0x/i.test(to) && !/\s/.test(to) ? `Send ${figure} to ${to}` : `Send ${figure} from your Safe`);
/** The fill's rows (copy review, 7 Nov), in this order: "Your SOL wallet gets · $148.25", "From your Safe · $150.00", "Stays in
 *  Private · $1.75" and the why line. Nothing stays: no Stays row, no why line. The Safe brings less than the leg (Private
 *  pays the rest of it from its own share): "From Private · $10.00" after the Safe's row (provisional: the copy review ruled only the
 *  three rows). `typed`: what the wallet gets on this leg (the core's own: the pocket's share plus the payment's signed
 *  amountIn); `safe`: the bytes' amountIn; `wallet`: the leg's wallet by the core's own list. The core (intents.ts
 *  legsBlock) and the Sim (MockBridge) both draw it, so the two say the same words from the same figures. */
/** `o.brought` (the audit's MUST for A++, 7 Nov): what the fill brings into Private, its quote's amountOut (the Send's rule,
 *  send-fill.ts): what stays is that less the leg (the only part this fill pays: the ledger fills each part on its own,
 *  moveFills), never the Safe's figure less the leg, which says the fill's own fee as money staying. Absent: the Safe's
 *  figure (a fill that lands whole, the Sim's). What stays always comes from the fill's quote: said "about" (the copy review's rule,
 *  quoted); the gets, the Safe's and Private's rows are the leg and the ledger's own figures: never. */
export function fillRows(typed: bigint, safe: bigint, wallet: string, say: (v: bigint) => string, o: { brought?: bigint } = {}): string[] {
  const brought = o.brought !== undefined && o.brought <= safe ? o.brought : safe;
  // J2-1 (8 Nov): Private's rows by its net change (what the fill brings less the leg), the fee on every sheet; no why
  // sentence (the row says it). From your Safe = gets + Fee + what Private keeps (or + From Private on the other side)
  return [`${FILL_WORDS.gets(wallet)} · ${say(typed)}`, `${LEG_WORDS.safe} · ${say(safe)}`, ...privateRows(brought - typed, say, { about: brought !== safe }), feeRow(safe - brought, say)];
}
/** The plan's other parts, once the fill's own leg is found in it (the core's check, the copy review's (a), 7 Nov). `plan`: each part
 *  of the whole Move as the call carried it, in units of the fill's coin; `isLeg(part)`: whether that part is the very leg
 *  the core built (intents.ts: the payment's signed amountIn is the asked share of that part). Null: no plan, a plan of one
 *  part (a single-leg Move gets no line), more than 4 parts, a part that isn't a figure, or no part that is the leg. */
export function planOthers(plan: readonly string[] | undefined, isLeg: (part: bigint) => boolean): bigint[] | null {
  if (!Array.isArray(plan) || plan.length < 2 || plan.length > 4 || !plan.every((u) => typeof u === "string" && /^\d{1,40}$/.test(u) && BigInt(u) > 0n)) return null;
  const parts = plan.map((u) => BigInt(u));
  const at = parts.findIndex(isLeg);
  return at < 0 ? null : parts.filter((_, i) => i !== at);
}
/** The whole Move's line under the headline (the copy review's (a), 7 Nov): "$148.25 from your Safe, $12.75 from Private. $161.00 in
 *  all." The Safe's part is what of this leg its fill pays (the leg, or the bytes' amountIn when that is less); Private's
 *  is the rest of the leg and every other part; the total is the leg and the other parts. No other parts: none. */
export function moveAllLine(typed: bigint, safe: bigint, others: readonly bigint[], say: (v: bigint) => string): string | null {
  const w = moveWhole(typed, safe, others);
  return w ? FILL_WORDS.all(say(w.fromSafe), say(w.fromPrivate), say(w.total)) : null;
}
/** The headline of a Move of more parts (J4, 7 Nov): the Safe's share and the whole Move, both from the plan, "Your Safe
 *  adds $112.96 to this $135.00 Move"; one part: null (the leg's own title stays). */
export function moveAllTitle(typed: bigint, safe: bigint, others: readonly bigint[], say: (v: bigint) => string): string | null {
  const w = moveWhole(typed, safe, others);
  return w ? FILL_WORDS.title(say(w.fromSafe), say(w.total)) : null;
}
function moveWhole(typed: bigint, safe: bigint, others: readonly bigint[]): { fromSafe: bigint; fromPrivate: bigint; total: bigint } | null {
  if (!others.length || others.some((u) => u <= 0n)) return null;
  const rest = others.reduce((n, u) => n + u, 0n), fromSafe = typed < safe ? typed : safe;
  return { fromSafe, fromPrivate: typed - fromSafe + rest, total: typed + rest };
}

/** A Move's leg as the core recorded it (subwallets privateLeg, for the fill's sheet): the coin, the pocket's own share
 *  (`units`, absent when Private paid none), what the payment out of Private pays from the Safe's fill (`payUnits`,
 *  1Click's signed amountIn), and to whom (`recipient`, and `own`: the core's ownPayee said it is the person's own). */
export interface PrivateLegRecord { tokenId: string; units?: string; payUnits?: string; recipient?: string; own?: boolean; /** the payment's own coin out (its signed destinationAsset): a Swap's sheet names it */ toTokenId?: string;
  /** A Move's one fill (the audit's ruling, 7 Nov): every part of the Move bound to it, from the core's own plan and what it
   *  signed or held for it, in the order asked: Private's own payment to that wallet (`units`) and the fill's (`payUnits`,
   *  1Click's signed amountIn of its held leg 2). */
  move?: MoveLeg[];
  /** The same Move's wallet parts (move-plan.ts othersForSheet): what spending.topUp checked against the engine's own read
   *  and kept under this Move's key, each a place to a place in whole cents. Words only, never signed. */
  others?: OtherPart[] }
/** A Move's wallet part (C2, 7 Nov): `from` and `to` are wallet places (sol, hood, near, bsc), `cents` its dollars. */
export interface OtherPart { from: string; to: string; cents: string }
export interface MoveLeg { recipient: string; own: boolean; units: string; payUnits: string; toTokenId?: string; /** leg 2's signed amountOut and its dollars (J2-2: a Swap's "You get"; words only) */ outUnits?: string; outUsd?: string;
  /** What every signed quote of this wallet's legs gives, in cents (quoteGot, summed): its amountOutUsd, and its
   *  minAmountOut at that price (the audit's ruling (c), 8 Nov: the Move sheet's "gets · about $X, at least $Y"; words only) */
  gotCents?: string; leastCents?: string }
/** One signed quote's dollars out, in whole cents: `got` its amountOutUsd (rounded down), `least` its minAmountOut at the
 *  quote's own price (amountOutUsd × minAmountOut / amountOut, rounded down). None: a figure missing or not one. Words
 *  only: what the sheet says a Move's wallet gets, never what is signed. */
export function quoteGot(q: { amountOut?: string; minAmountOut?: string; amountOutUsd?: string }): { got: bigint; least: bigint } | null {
  const isUnits = (v: unknown): v is string => typeof v === "string" && /^\d{1,40}$/.test(v);
  if (!isUnits(q.amountOut) || !isUnits(q.minAmountOut) || BigInt(q.amountOut) <= 0n || typeof q.amountOutUsd !== "string" || !/^\d{1,12}(\.\d+)?$/.test(q.amountOutUsd)) return null;
  const got = BigInt(Math.floor(Number(q.amountOutUsd) * 100 + 1e-6));
  const min = BigInt(q.minAmountOut), out = BigInt(q.amountOut);
  return { got, least: (got * (min < out ? min : out)) / out };
}

const dollars = (usd: number): string => `$${(Math.floor(usd * 100 + 1e-6) / 100).toFixed(2)}`;
/** Private is short and the fill is closed (only a caller that closes it: the fill is open in every build, safe-fill-open.ts):
 *  refused before anything is saved or signed. `haveUsd` 0: Private is empty. */
export function privateShort(haveUsd: number, needUsd: number): Problem {
  return {
    code: "ledger.private.short",
    whatHappened: haveUsd > 0.004 ? `Nothing moved. Private has ${dollars(haveUsd)}, and this needs ${dollars(needUsd)}.` : "Private is empty. Nothing moved.",
    money: { state: "safe", where: "in your Safe and in Private" },
    next: { kind: "nothing", label: "Move less" },
  };
}

/**
 * Move and a site's top-up paid from Private (QA's SHOULD, privacy): the Safe → Private fill is rounded UP to a
 * whole step, $10 under $100, $50 under $500, then $100, always over the payout and its 3 % gap (INFLOW_GAP_BPS), so the
 * fill and the payout never share a figure; the extra stays in Private. `usd`: what Private is short by.
 */
export function fillStepUsd(usd: number): number {
  if (!(usd > 0)) return 0;
  const floor = usd * (1 + Number(INFLOW_GAP_BPS) / 10_000);
  const step = floor < 100 ? 10 : floor < 500 ? 50 : 100;
  return (Math.floor(floor / step + 1e-9) + 1) * step;
}

/** What a fill may leave in Private (QA's MUST 2, 5 Nov): Private's own share plus the step's extra stays under
 *  this; past it the fill brings the payout's figure instead (no step). The ledger's (wallet safe-send.ts) and the Sim's. */
export const PRIVATE_BUFFER_USD = 500;

/** One part of a Move paid from Private, as the ledger pays it (wallet private-move.ts, safe-send.ts sendFromSafe): what
 *  Private pays of it from its own share (`fromPrivate`), what the Safe's fill brings for the rest (`fill`, 0: none, so
 *  no Safe sheet), and that rest (`rest`). In dollars. */
export interface PartFill { part: number; at: number; fromPrivate: number; rest: number; fill: number }
const cents = (n: number) => Math.round(n * 100) / 100;
/**
 * Each part's fill, as the ledger sizes it (the Sim's mirror, 7 Nov: the Sim filled the whole Move's shortfall on one
 * leg, $200 for a $164.86 Move, where the ledger fills each part on its own): the smallest parts first
 * (private-move.ts); a part folds whole into its fill while Private's share plus the step's extra stays under the buffer
 * (safe-send.ts foldsWhole, the audit's R2), Private's share then staying; else Private pays what it can and the fill covers the
 * rest; the fill a whole step over the rest (fillUnits), or the rest itself past the buffer or past what the Safe holds
 * (the ledger's balance.low fallback). A fill lands after the next part is read, so it never counts toward that part's
 * share. `whole`: a site's top-up (one fill of the whole). Pure: the Sim's and the ledger's figures meet in a test.
 */
export function moveFills(parts: readonly number[], share: number, o: { whole?: boolean; safeHas?: number } = {}): PartFill[] {
  const order = parts.map((_, i) => i).sort((a, b) => parts[a]! - parts[b]!);
  const out: PartFill[] = [];
  let left = cents(share), safe = o.safeHas ?? Infinity;
  for (const [at, i] of order.entries()) {
    const wanted = cents(parts[i]!);
    const step = (usd: number) => fillStepUsd(usd);
    const fold = left > 0 && wanted > 0 && left + Math.max(0, step(wanted) - wanted) <= PRIVATE_BUFFER_USD;
    const whole = (o.whole === true || fold) && wanted > left;
    const fromPrivate = whole ? 0 : Math.min(wanted, left);
    const rest = cents(wanted - fromPrivate);
    let fill = 0;
    if (rest > 0) {
      const s = step(rest);
      fill = s > rest && left + (s - rest) <= PRIVATE_BUFFER_USD && s <= safe ? s : rest;
    }
    left = cents(left - fromPrivate);
    safe -= fill;
    out[i] = { part: i, at, fromPrivate, rest, fill };
  }
  return out;
}

/** Whether the Safe's part of a Send's fill, in whole cents, is a fill step (fillStepUsd: every step is a whole $10, $50
 *  or $100, all whole tens): within 1 % of a whole $10 (a coin's dollars are the quote's, at its own price, a little off
 *  the ledger's). A part that only keeps a payout's slippage room ("Stays in Private · $0.05" on an exact Send) is not, so
 *  the sheet says no why it doesn't have. Null or nothing: false. */
export function roundFill(cents: bigint | null): boolean {
  if (cents === null || cents < 1000n) return false;
  const off = cents % 1000n, gap = off < 500n ? off : 1000n - off;
  return gap * 100n <= cents;
}

/** The one line under "Stays in Private" (the copy review's ruling, 6 Nov; the audit's MUST: the round sum is only true of a dollar coin): a
 *  dollar coin's whole fill step says why it is round, a dollar coin off a step says nothing, any other coin says the
 *  Safe sends a little more than typed. Never both. */
export const stayWhy = (dollar: boolean, sends: bigint): string[] => (dollar ? (roundFill(sends) ? [SEND_LEG_WORDS.why] : []) : [SEND_LEG_WORDS.more]);
