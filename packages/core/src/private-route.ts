// Move and a site's top-up pay from Private (NEAR Confidential: the product's HARD RULE, every money move confidential):
// the route's words and its refusal, for the ledger's route (wallet private-move.ts), the Sim and the job's steps. The
// fill's switch is safe-fill-open.ts. Loaded only with the route's own code, never in Home's first load.
import type { Problem } from "./problem.ts";
import { INFLOW_GAP_BPS } from "./inflow-grid.ts";
import { FEES_KEPT } from "./zero-fee.ts";

/** The payout couldn't go and came back to Private, its refund address (the copywriter, 5 Nov): never "failed". The
 *  route's steps are job-steps.ts's (privateMoveSteps), the one source for every job's words. S5 (the copy review's Sim walk, 5 Nov:
 *  "Your money is in Private" said no why): the copy review's words, the job's own figure: "The $5.00 is back in Private."; a figure
 *  truly unknown: "It's back in Private." */
export const privateBack = (usd?: number | null): string => (typeof usd === "number" && Number.isFinite(usd) && usd >= 0.01 ? `The $${usd.toFixed(2)} is back in Private.` : "It's back in Private.");
export const PRIVATE_BACK = privateBack();
/** A Move that landed (the ledger's word) whose wallet reads failed to show it LANDED_MISSES times in a row (the copy review's words,
 *  QA's change, 5 Nov): never Done on a timer, said so until a read shows it. */
export const LANDED_UNREAD = "Can't read this right now. Your money is safe; it shows when the read works.";
export const LANDED_MISSES = 3;

/** A Move's fill sheet, its legs block (the design session's words, 5 Nov): "From Private · $12.50", "From your Safe ·
 *  $20.00", "Together · $32.50" (core intents.ts splitLines; the Sim's sheet the same). */
export const LEG_WORDS = { private: "From Private", safe: "From your Safe", stays: "Stays in Private", together: "Together", seen: "Anyone can see the Safe's part.", other: (usd: string) => `The other ${usd} follows in a second step.`, adds: (usd: string) => `Your Safe adds ${usd} to Private first.` } as const;
/** A Send's fill sheet, its legs block (the UI lead's rulings, 5 Nov; QA's Sim walk: the brackets are what the payee's
 *  coin is worth, the quote's amountOutUsd, and the payout's network fees are named last, "Fees · about $0.40",
 *  the same form as every outside sheet's, send-words.ts OUTSIDE_WORDS.fees): what they get first, once, the signed coin figure
 *  then the payout's dollars, then what the Safe sends and what stays in Private: "They get · 1.2345 SOL ($40.00)", "Your
 *  Safe sends · $50.00", "Stays in Private · $10.00" (core send-fill.ts and intents.ts; the Sim's sheet the same). No
 *  "Together" on this sheet; the Move's split block (splitLines) keeps it. */
export const SEND_LEG_WORDS = { gets: "They get", sends: "Your Safe sends", stays: LEG_WORDS.stays, fees: (usd: string) => `Fees · about ${usd}`, kept: FEES_KEPT } as const;
/** The split block, as Private's money really goes (QA's Sim re-check, 5 Nov: "From Private · $15.00" while Private fell
 *  $10.00; "From Private · $5.00" while it rose $0.26): Private pays its own share and then the fill's payout, and the Safe's
 *  fill lands in Private first, so Private's own part is the Move less the Safe's fill, never its gross share. More than
 *  the Move filled: Private pays nothing and the rest stays there. "From Private" + "From your Safe" - "Stays in Private" =
 *  "Together", in whole cents; a $0 line is left out. `typed`: the Move's figure; `safe`: the bytes' amountIn. */
export function splitLines(typed: bigint, safe: bigint, say: (v: bigint) => string): string[] {
  const priv = typed > safe ? typed - safe : 0n, stays = safe > typed ? safe - typed : 0n;
  return [...(priv > 0n ? [`${LEG_WORDS.private} · ${say(priv)}`] : []), `${LEG_WORDS.safe} · ${say(safe)}`, ...(stays > 0n ? [`${LEG_WORDS.stays} · ${say(stays)}`] : []), `${LEG_WORDS.together} · ${say(typed)}`];
}

/** A Move's leg as the core recorded it (subwallets privateLeg, for the fill's sheet): the coin, the pocket's own share
 *  (`units`, absent when Private paid none), what the payment out of Private pays from the Safe's fill (`payUnits`,
 *  1Click's signed amountIn), and to whom (`recipient`, and `own`: the core's ownPayee said it is the person's own). */
export interface PrivateLegRecord { tokenId: string; units?: string; payUnits?: string; recipient?: string; own?: boolean }

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
