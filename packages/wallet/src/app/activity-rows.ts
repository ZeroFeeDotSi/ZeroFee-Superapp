// Activity's rows (and the Statement's, unfolded): its own module, loaded with Activity, never in Home's first load.
import type { SpendingActivity } from "@zerofee/core/spending";
import { foldLegs } from "@zerofee/core/spending-fold";
import type { Movement } from "../types.ts";
import { statusWords } from "./hub.ts";
import { SAFE_LEG_MIN_USD } from "@zerofee/core/float-floors";
import { swapLabel } from "./money/swap-follow.ts";
import { isInplaceRow } from "./money/inplace-activity.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";
import { SLOW_MS, moveTrack, rowTitle, sendFrom, sendTrack, withCarry, type Folded, type LiveTrack } from "./money/live-steps.ts";

/** The job a Spending row is (what Home's Jobs row draws: the figure asked, its own end), when the tap made one; else
 *  null (an older move, one made elsewhere). One source (the copy review's pair-jobs walk, 5 Nov: Activity "Put away $28.80 ·
 *  Brought $29.39 back · Done" beside Home's "Moving $30.00 to your Safe"). */
export function jobOf(s: SpendingActivity): LiveTrack | null {
  const c = carried(`move:${s.id}`);
  // the core kept the person's own figure (askedUsd): its job's name, with no carry too (a reload, another device)
  if (!c?.usd && !c?.words && !s.askedUsd) return null;
  const t = moveTrack(s as Folded);
  return t ? withCarry(t, c) : null;
}
/** A job's line: its end, or the step going now (each ticked on a chain read: live-steps.ts). */
export const jobLine = (t: LiveTrack): string => t.end?.line ?? t.steps.find((x) => x.state === "doing")?.label ?? "";

/** A Spending row's name: a Swap is the person's Swap, named as its job ("Swap $10 of USDC for SOL"), never the Move
 *  underneath ("Moved $11.00 to your SOL wallet"; QA's Jobs re-crawl, 5 Nov: B4). */
// the asked form, as Home's row says it (live-steps.ts rowTitle: "Move $30.00 to your Safe"; the line carries the state)
export const nameOf = (s: SpendingActivity): string => { const t = jobOf(s); return t ? rowTitle(t) : swapLabel(s.id) ?? s.words; };
/** A Spending row's dollars: its job's figure (what was asked, the receipt's), else the row's own. */
export const usdOf = (s: SpendingActivity): string | undefined => carried(`move:${s.id}`)?.usd ?? (s.askedUsd ? `$${s.askedUsd}` : s.usd ? `$${s.usd}` : undefined);
/** A Spending row's second line: its job's (the same as Home's), else each leg's words and the move's state. */
// a swap in place that came back: its name already says where the money is (copy review, 6 Nov: not twice on one row)
export const lineOf = (s: SpendingActivity): string => { if (isInplaceRow(s) && s.status === "refunded") return "Refunded"; const t = jobOf(s); return (t && jobLine(t)) || legsLine(s); };

/** The same move in the ledger and in Spending, by its id (review, 1 Nov: matched by time, two moves a minute apart
 *  could swap rows, and the two sides showed different amounts). A Top up's row carries the ledger movement's id; a Put
 *  away's ledger row carries the engine's move key. */
const sameMove = (m: Movement, r: SpendingActivity) => m.kind === "trading" && m.id === r.id;

/**
 * One Activity list, one row per move. Spending's `shown` rows (what the person did, what waits on them, what failed,
 * a paused step's "Finishes next time you open ZeroFee") follow spending.changed, so a Top up turns Done within about a
 * second: they win over the ledger's row for the same Top up or Put away, which only learns it on its own check. A
 * ledger row with no Spending row (an older move, or one the engine doesn't know) stays. Background moves stay quiet.
 */
export function activityRows(ledger: Movement[], spending: SpendingActivity[]): { ledger: Movement[]; spending: SpendingActivity[] } {
  const shown = spending.filter((r) => r.shown);
  // a move paid from Private is its one row: its payments (the fill, each wallet's) are in it, never rows of their own (S5;
  // "Paid … with the address you gave" for the person's own pump.fun wallet; fix/jobs-4r f9f3ab6d4, ba41a7710)
  const paid = new Set(shown.flatMap((r) => r.paid ?? []));
  // one move, one row: a Move's legs fold into its row (each kept whole in `legs`; the Statement unfolds them)
  return { ledger: ledger.filter((m) => !paid.has(m.id) && !shown.some((r) => sameMove(m, r))), spending: foldLegs(shown).map(stillGoing) };
}

/** One action, one row on Activity's screen (QA's Sim re-check, 5 Nov: a running Swap was a Now card and a
 *  Money row): the same covered-ids rule as `paid` above, widened to a job still going. Its live card (Now; live-steps
 *  watchLive draws every going job) is its one row until it ends, then the record row is. One gone slow (SLOW_MS) leaves
 *  Now, so it stays a row. The record itself (activityRows: the Statement, AgentZero) keeps every row. */
export function onScreen(rows: { ledger: Movement[]; spending: SpendingActivity[] }, now: number = Date.now()): { ledger: Movement[]; spending: SpendingActivity[] } {
  const going = (t: LiveTrack | null) => !!t && !t.end && Number.isFinite(t.startMs) && now - t.startMs < SLOW_MS;
  return {
    // a Send the live watch follows (its last hour, as watchLive), going
    ledger: rows.ledger.filter((m) => !(Date.parse(m.startedAtIso) > now - 60 * 60_000 && going(sendTrack(m, sendFrom(m))))),
    spending: rows.spending.filter((r) => !going(moveTrack(r as Folded))),
  };
}

/** D137 + rule 11: a Move is done only once each wallet it goes to has it, read on chain: from the Safe, its leg row
 *  there done; paid from Private (no leg rows), that wallet in `landed` (its own chain read after the ledger's end, or
 *  the money came back to Private), never the ledger's "done" alone (the prover, 5 Nov: "Moved $5.20 to your SOL wallet"
 *  ticked 60 s before the SOL wallet had it). A Move that ends in the NEAR wallet goes nowhere on: done there. */
const notLanded = (s: SpendingActivity) => s.status === "done" && (s.goesTo ?? []).some((c) => (s.via === "private" ? !(s.landed ?? []).includes(c) : !(s.legs ?? []).some((l) => l.network === c && l.status === "done")));
/** Rule 11 (the proof's Sim walk, 5 Nov): such a row never ticks or says "Moved" before that read: "Moving … · On its way". */
function stillGoing(s: SpendingActivity): SpendingActivity {
  return notLanded(s) ? { ...s, status: "on-its-way", words: s.words.replace(/^Moved /, "Moving ") } : s;
}

/** The row's tick (rule 11: ticked only once the chain reads show it all done, notLanded, paid from Private too): the same
 *  test as its line, so a row never says "On its way" beside a tick (QA's Sim crawl, 5 Nov). A refund
 *  that landed back is ticked too. */
export const rowTicked = (s: SpendingActivity): boolean => (s.status === "done" && !notLanded(s)) || s.status === "refunded";

/** A folded row's second line: each leg's own words (and its state while not done), then the move's state. */
export function legsLine(s: SpendingActivity): string {
  // D137: a Move from the Safe is done only once it is in every wallet the person chose, not when it reaches the NEAR wallet
  // paid from Private there are no leg rows: each wallet is paid straight, and the engine holds the row on its way until
  // each wallet's own chain read after its payment ended (float-private chainShown, `landed`); the line and the tick
  // read the same rule (notLanded), so it never says "On its way" under a tick (the prover, 5 Nov; Sim test)
  const short = notLanded(s);
  return [...(s.legs ?? []).map((l) => (l.status === "done" ? l.words : `${l.words}: ${statusWords(l)}`)), short ? statusWords({ ...s, status: "on-its-way" }) : statusWords(s)].join(" · ");
}


/** A one-tap way on from a stopped move's page: finish the hop (Make ready), or bring it home (Move to your Safe). */
/** `parked`: under $2 parked, it goes home from this row itself (spending.putAway {parked}), never the Put away sheet
 *  (its $2 floor refused it: the money had no way out). */
export type StoppedWay = { label: string; kind: "home"; parked?: string } | { label: string; kind: "on"; network: string; usd: number; wallet?: string };
/**
 * Finding 61 / k-trade (4 Nov): a move whose hop on from the NEAR wallet stopped (the core's record: stoppedShort; a site's
 * Add, or a Move's leg to a wallet) offers the one tap that ends it: "Try again" (that hop, from the NEAR wallet: Make
 * ready, to the site's own wallet or the network's), only when it is at least a Safe -> wallet leg's least so the same
 * floor never stops it twice; and "Move back to your Safe" always. `wallets`: Spending's list (its site wallets).
 */
export function stoppedWays(s: SpendingActivity, wallets: readonly { id: string; role: string; site?: string; current?: boolean }[] | null | undefined): StoppedWay[] {
  if (!s.stoppedShort) return [];
  // under $2 parked: home from this row, under the floor too, saying the least that lands (the core's own 98 %)
  const small = s.parkedUsd !== undefined && s.parkedUsd >= 0.01 && s.parkedUsd < 2;
  const home: StoppedWay = small ? { label: `Move back to your Safe. At least $${(Math.floor(s.parkedUsd! * 98) / 100).toFixed(2)} lands.`, kind: "home", parked: s.id } : { label: "Move back to your Safe", kind: "home" };
  const leg = (s.legs ?? []).find((l) => (l.status === "failed" || l.status === "refused" || l.status === "refunded") && l.network);
  const site = s.site ? (wallets ?? []).find((w) => w.role === "site" && w.site === s.site && w.current !== false) : undefined;
  // review (QA): the record's own number, never the row's text; never more than is parked (the NEAR wallet may
  // hold other money), a leg's own part when its row has it
  const parked = s.parkedUsd;
  const most = (x: number | undefined) => (parked === undefined || x === undefined ? parked : Math.min(parked, x));
  const siteLeg = (s.legs ?? []).find((l) => l.parkedUsd !== undefined);
  const on = parked === undefined ? null : site ? { network: "sol", usd: most(siteLeg?.parkedUsd)!, wallet: site.id } : leg ? { network: leg.network!, usd: most(leg.parkedUsd)! } : s.goesTo?.length === 1 ? { network: s.goesTo[0]!, usd: parked } : null;
  if (s.site && !site) return [home];
  return on && on.usd >= SAFE_LEG_MIN_USD ? [{ label: "Try again", kind: "on", ...on }, home] : [home];
}
