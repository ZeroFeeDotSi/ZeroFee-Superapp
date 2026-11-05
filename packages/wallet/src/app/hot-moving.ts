// Hot's money on its way (copy review, 5 Nov; QA's MUST, Sim test): one row per move at the top of the wallets, loaded
// only when the engine counts money on its way (never in Home's first load).
import type { SpendingActivity, SpendingStatus } from "@zerofee/core/spending";
import { engineLegs, homeward, movingMoves } from "./trading.ts";
import { LEG_SEC, MEASURED_SEC } from "@zerofee/shell-api/job-steps.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";
import { moveTrack, onLegs, withCarry, type Folded } from "./money/live-steps.ts";

/** The mid-move row's words (the copy review's ruling, 5 Nov), one place to change them; its time left is TimeLeft's own line. */
/** The row's words. `name`/`engineName`: the title alone (a16, 5 Nov: Hot's row is shaped as the wallet rows under it, the
 *  figure its own right column); `row`/`engine`: the one-line form, for anything that still says it in one piece. */
export const MOVING_WORDS = {
  /** The row's title: the destination, capitalised ("Your ETH (RH) wallet", "Your wallets"): the one thing the person needs, never cut. */
  title: (to: string) => to.charAt(0).toUpperCase() + to.slice(1),
  /** The row's sub-line: "On its way · About 29 s left."; with no estimate, "On its way". */
  sub: (time?: string) => (time ? `On its way · ${time}` : "On its way"),
  name: (to: string) => `On its way to ${to}`,
  engineName: () => "On its way into your wallets",
  row: (to: string, usd: string) => `On its way to ${to} · ${usd}`,
  engine: (usd: string) => `On its way into your wallets · ${usd}`,
} as const;

/** Money on its way inside Hot (copy review, 5 Nov): one row per move, at the top of the wallets, until it lands (then it is in the
 *  wallet's own row and gone from here). */
/** `etaSec`: always one, from the one time model (phone test, 5 Nov: a row said "This job has no time estimate.");
 *  `endsAt`: when its own legs say it ends, counted from the last leg a read ticked (live-steps onLegs, as its Jobs row). */
export interface MovingRow { id: string; to: string; usd: string; etaSec: number; endsAt?: number; /** the engine's own legs, past their time (MOVING_WORDS.engine) */ engine?: true }

/** A move's route as measured on mainnet (job-steps LEG_SEC), when its job's legs give no end: the Safe on to a chain paid
 *  from Private, the Safe into the NEAR wallet, a chain wallet's leg in then out, the NEAR wallet's leg out. */
export function routeSec(a: SpendingActivity): number {
  const out = (a.goesTo ?? []).length > 0;
  if (a.kind === "top-up") return out ? (a.via === "private" ? LEG_SEC.privateOut : LEG_SEC.safeToChain) : MEASURED_SEC.safeToNear;
  if (a.kind === "move") return a.to === "near" ? LEG_SEC.chainIn : LEG_SEC.chainIn + LEG_SEC.nearOut;
  if (a.kind === "ready" || a.kind === "refill" || a.kind === "rebalance") return LEG_SEC.nearOut;
  return LEG_SEC.other;
}

/** A move's time: its quote, else its job's legs re-counted from the last tick (the Jobs row's own), else its route's. */
function timeOf(a: SpendingActivity): { etaSec: number; endsAt?: number } {
  const start = Date.parse(a.atIso);
  if (a.etaSeconds && a.etaSeconds > 0) return { etaSec: a.etaSeconds, ...(Number.isFinite(start) ? { endsAt: start + a.etaSeconds * 1000 } : {}) };
  const t = moveTrack(a as Folded);
  const ends = t ? onLegs(withCarry(t, carried(t.id))).endsAt : undefined;
  const etaSec = routeSec(a);
  if (ends !== undefined && Number.isFinite(ends)) return { etaSec, endsAt: ends };
  return { etaSec, ...(Number.isFinite(start) ? { endsAt: start + etaSec * 1000 } : {}) };
}

/**
 * The person's own moves on their way into Hot (trading.ts movingMoves: each has a Jobs row), one row each, adding up to
 * what Hot's total counts on its way (QA's MUST, Sim test: Hot's total and its rows disagreed). The engine's
 * rounding cents and a background leg with no Jobs row are never a row (test, MUST 1: a phantom "On its way to your
 * NEAR wallet · $0.01").
 */
export function movingRows(s: SpendingStatus, now: number = Date.now()): MovingRow[] {
  // money going to the Safe is never a Hot row (QA's Sim test): its Jobs row says it; the Safe shows it landed
  const rows: MovingRow[] = movingMoves(s).filter(({ a }) => !homeward(a)).map(({ a, to, usd }) => ({ id: a.id, to, usd: usd.toFixed(2), ...timeOf(a) }));
  // the engine's own legs count in Hot's total with no row (D128); one still counted past its route's measured time gets
  // one row for them all (the copy review's condition, 5 Nov), so the gap between the total and the rows is never silent for long
  const late = engineLegs(s).filter(({ a }) => { const t = Date.parse(a.atIso); return Number.isFinite(t) && now > t + routeSec(a) * 1000; });
  const usd = Math.round(late.reduce((n, l) => n + l.usd, 0) * 100) / 100;
  if (usd >= 0.01) rows.push({ id: "moving-engine", to: "", usd: usd.toFixed(2), etaSec: Math.max(...late.map(({ a }) => routeSec(a))), engine: true });
  return rows;
}
