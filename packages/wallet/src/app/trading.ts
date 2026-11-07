// Trading (FLOW-V4 §1.1, QA 3 Nov): everything that isn't the Safe or Hidden. One formula for Home's number and for the
// total kept on the device for the next cold open, so the number never jumps (review M3).
import type { SpendingActivity, SpendingStatus, SpendingWallet } from "@zerofee/core/spending";
import { plusUsd } from "./format.ts";

/** A coin held on a chain (trade.positions): a row's sub-row. */
export interface HeldCoin { chain: string; address: string; symbol: string; amount: string; usd?: string }

const sumUsd = (xs: (string | null | undefined)[]) => xs.reduce<string>((n, x) => (x && /^\d+(\.\d+)?$/.test(x) ? plusUsd(n, x) : n), "0.00");
export { sumUsd };

const num = (x: string | undefined) => (x && /^\d+(\.\d+)?$/.test(x) ? Number(x) : 0);

/** What the engine counts on its way (its totalUsd past the NEAR wallet and the open wallets' own figures: float-core
 *  inFlight + addsOnWay, and the cents its rounding leaves). The cap on the person's own moves (movingMoves); what is past
 *  them counts in Hot's total (awayUsd) with no row. */
const engineAwayUsd = (s: SpendingStatus): number => Math.round((num(s.totalUsd) - num(s.reserveUsd) - s.networks.filter((n) => !n.closed).reduce((n, x) => n + num(x.cashUsd) + num(x.coinsUsd), 0)) * 100) / 100;

/** A wallet Hot money goes to, as Move names it (move-split.ts WHERE). */
export const MOVING_TO: Record<string, string> = { sol: "your SOL wallet", hood: "your ETH (RH) wallet", near: "your NEAR wallet", bsc: "your BNB wallet" };

/** Where a person's move on its way lands, by name; null: a leg the person never asked for (the engine's own rebalance or
 *  refill), never a row. Home (a put-away, the over-cap's return) and a site's wallet count too (D140, D128: a Move never
 *  changes the total while its money is between two places; the train-24 drop: $30 home vanished, $100 dipped). */
function movingTo(a: SpendingActivity): string | null {
  if (a.kind === "put-away" || a.kind === "over-cap") return "your Safe";
  if (a.site || a.siteName) return a.siteName ? `your ${a.siteName} wallet` : null;
  if (a.kind === "move" && a.to) return MOVING_TO[a.to] ?? null;
  if (a.kind === "top-up") return MOVING_TO[a.goesTo?.[0] ?? "near"] ?? null;
  if (a.kind === "rebalance" || a.kind === "older") return MOVING_TO.near!;
  return a.network ? MOVING_TO[a.network] ?? null : null;
}

/** The kinds only the person starts (spending.ts shownInActivity: always shown). */
const OWN_KINDS: ReadonlySet<string> = new Set(["top-up", "put-away", "ready", "move"]);

/** The engine's rounding: its total and its parts are each rounded to the cent, so they can differ by a cent or two. */
const ROUNDING_USD = 0.02;

/**
 * The person's own moves on their way into Hot (QA's test, MUST 1: "On its way to your NEAR wallet · $0.01"
 * with no job started, and Hot's total a cent off): only a move with a Jobs row (`shown`, spending.ts shownInActivity),
 * on its way, that the engine still counts (a move already in its wallet's read is that wallet's, never twice). What the
 * engine counts past them is never one of these rows: a background leg with no Jobs row counts in the total (awayUsd,
 * engineLegs), the rounding's cents never.
 */
export function movingMoves(s: SpendingStatus): { a: SpendingActivity; to: string; usd: number; /** counted from its own record, never in the engine's figure (paidStraight) */ own?: true }[] {
  let left = engineAwayUsd(s);
  const out: { a: SpendingActivity; to: string; usd: number; own?: true }[] = [];
  for (const a of s.onItsWay ?? []) {
    // the person's own: a Jobs row (`shown`), or a kind only the person starts (spending.ts shownInActivity's own kinds);
    // a status not read is on its way, a settled one is its wallet's read
    if (!(a.shown || OWN_KINDS.has(a.kind)) || a.held || a.signing === "asked" || (a.status !== undefined && a.status !== "waiting" && a.status !== "on-its-way")) continue;
    // the figure the person approved (core askedUsd: a Move's legs, never the inflow grid's amount the Safe sent)
    const to = movingTo(a), usd = num(a.askedUsd ?? a.usd);
    if (!to || !(usd >= 0.01)) continue;
    if (paidStraight(a)) { const own = straightUsd(a, usd); if (own >= 0.01) out.push({ a, to, usd: own, own: true }); continue; }
    if (usd > left + ROUNDING_USD) continue;
    out.push({ a, to, usd });
    left -= usd;
  }
  return out;
}

/**
 * A Move paid from Private straight to a chain's wallet (the real app's every Move from the Safe, NEAR Confidential): the
 * engine never counts it on its way (float-core onWayOf: rule 11, it is that wallet's money only once the wallet's chain
 * read shows it), so it counts from the person's own job, its row, until then (the copy review's ruling, 5 Nov: one Hot row per move the
 * person started, until it lands; the review's Q3: "On its way to your SOL wallet" was only a Jobs card). The row
 * turns Done in the round whose read of that wallet shows the money (float-private chainShown), the same snapshot whose
 * wallet figure then holds it: counted once, never twice, never dipping. A chain it already landed on is that wallet's.
 */
function paidStraight(a: SpendingActivity): boolean {
  const to = a.kind === "top-up" && a.via === "private" && !a.site && !a.siteName ? a.goesTo ?? [] : [];
  return to.length > 0 && !to.every((c) => (a.landed ?? []).includes(c as never));
}
/**
 * What of a Move paid straight from Private is still on its way into Hot (audit, 6 Nov): never a part that never reached its
 * wallet (`missed`: it stopped, never started or came back; the same rule as its landing step, spending.ts privLanded),
 * so its dollars (`missedUsd`, the parts' own) come off the row's figure; every wallet it goes to missed or landed: none.
 * Pure: a table test.
 */
export function straightUsd(a: Pick<SpendingActivity, "goesTo" | "landed" | "missed" | "missedUsd">, usd: number): number {
  const missed = a.missed ?? [];
  const going = (a.goesTo ?? []).filter((c) => !missed.includes(c) && !(a.landed ?? []).includes(c));
  if (!going.length) return 0;
  return Math.max(0, Math.round((usd - num(a.missedUsd)) * 100) / 100);
}

/** The money on its way inside Hot: the sum of the person's own moves on their way (movingMoves). Hot shows it as rows
 *  (hot-moving.ts movingRows, loaded only when there is some), which always add up to it. */
export const movingUsd = (s: SpendingStatus): number => Math.round(movingMoves(s).reduce((n, m) => n + m.usd, 0) * 100) / 100;
/** The part of it the engine's own figure holds (everything but a Move paid straight from Private: paidStraight). */
const engineOwnUsd = (s: SpendingStatus): number => Math.round(movingMoves(s).filter((m) => !m.own).reduce((n, m) => n + m.usd, 0) * 100) / 100;

/** All the money on its way that Hot's total counts (the review's ruling on D128, 5 Nov: a Move never changes the
 *  total): the person's own moves (their rows) plus the engine's own legs past them (counted, no row of their own). Only
 *  the rounding's cents left over (ROUNDING_USD or less) are neither a row nor counted, so the total keeps to its rows. */
/** The engine's own legs on their way (a rebalance, a refill: no Jobs row), past the person's moves and capped by what the
 *  engine still counts; the rounding's cents are never one. Counted in Hot's total (awayUsd); a row only once a leg runs
 *  past its route's measured time (hot-moving.ts, the copy review's condition, 5 Nov). */
export function engineLegs(s: SpendingStatus): { a: SpendingActivity; usd: number }[] {
  let left = Math.round((engineAwayUsd(s) - engineOwnUsd(s)) * 100) / 100;
  if (!(left > ROUNDING_USD + 1e-9)) return [];
  const own = new Set(movingMoves(s).map((m) => m.a.id));
  const out: { a: SpendingActivity; usd: number }[] = [];
  for (const a of s.onItsWay ?? []) {
    if (own.has(a.id) || homeward(a) || a.held || (a.status !== undefined && a.status !== "waiting" && a.status !== "on-its-way")) continue;
    const usd = Math.min(num(a.usd), left);
    if (!(usd > ROUNDING_USD + 1e-9)) continue;
    out.push({ a, usd: Math.round(usd * 100) / 100 });
    left = Math.round((left - usd) * 100) / 100;
  }
  return out;
}

/** All the money on its way the engine counts, homeward too: what the whole total keeps (D128: a Move never changes it). */
export const allAwayUsd = (s: SpendingStatus): number => {
  const own = movingUsd(s), rest = Math.round((engineAwayUsd(s) - engineOwnUsd(s)) * 100) / 100;
  return Math.round((own + (rest > ROUNDING_USD + 1e-9 ? rest : 0)) * 100) / 100;
};

/** A move leaving Hot for the Safe (a put-away, the over-cap's return): the Safe's money, never Hot's (QA's Sim test,
 * : a NEAR wallet -> Safe Move was "On its way to your NEAR wallet · $4.89" and Hot counted it). */
export const homeward = (a: SpendingActivity): boolean => a.kind === "put-away" || a.kind === "over-cap";

/** The person's own moves on their way to the Safe: counted in the whole total (allAwayUsd), never in Hot's. */
export const homewardUsd = (s: SpendingStatus): number => Math.round(movingMoves(s).filter((m) => homeward(m.a)).reduce((n, m) => n + m.usd, 0) * 100) / 100;

/** Hot's money on its way: all of it but what goes to the Safe (homewardUsd). Hot's rows (hot-moving.ts) add up to it. */
export const awayUsd = (s: SpendingStatus): number => Math.round((allAwayUsd(s) - homewardUsd(s)) * 100) / 100;

/**
 * Hot's total is the sum of what Hot shows (QA's MUST, Sim test: $286.62 over rows of $294.06): the NEAR
 * wallet, each chain wallet's own coin and every coin it holds (trade.positions, counted once: the engine's own coinsUsd
 * is taken out), a closed chain's money too (BNB until it opens: never left out of the total), the money on its way
 * (movingUsd), every site wallet (pump.fun, GMGN per chain) and AgentZero's pocket once it holds money. trade.positions
 * are Trade's own trades in its chain wallets (trade service.ts pricedPositions); a site's coins are its own wallet's
 * (subwallet.coins), so nothing is counted twice. `partial`: a part not read yet, or read and unreadable: the screens say
 * "Updating…", never $0 (review M2).
 */
/**
 * `own`: the NEAR wallet's own coins as its balance holds them (near-coins.ts nearOwnCoins: a coin bought in place, or by
 * Trade): when read, they are the NEAR coins counted (Trade's positions name only what Trade bought, so a coin bought in
 * place was in neither figure: bug hunt, 4 Nov). `uncounted`: one of them has no price and is left out.
 */
export function tradingUsd(s: SpendingStatus, held: HeldCoin[] | null, wallets: SpendingWallet[] | null, own: readonly { usd: string | null }[] | null = null): { usd: string; partial: boolean; uncounted?: true } {
  // each chain's own coin (a closed one's, BNB's, only while it holds money, as its row: Home.tsx homeRows), and the coins
  // held where a row shows them (NEAR, SOL, ETH (RH) always; BNB with its row); a closed chain's coins the engine counts
  // and Trade lists none of are never left off (review L6)
  const listed = s.networks.filter((n) => !(n.closed || n.network === "bsc") || num(n.cashUsd) + num(n.coinsUsd) >= 0.01), shown = ["near", "sol", "hood", ...listed.map((n) => n.network)];
  const cash = listed.map((n) => n.cashUsd);
  const coinsHeld = [...(held ?? []).filter((h) => shown.includes(h.chain) && !(own && h.chain === "near")).map((h) => h.usd), ...(own ?? []).map((c) => c.usd)];
  const closedCoins = listed.filter((n) => n.closed && !(held ?? []).some((h) => h.chain === n.network)).map((n) => n.coinsUsd);
  // AgentZero's own wallet counts as a site's does (QA 5 Nov: its $1.99 was counted nowhere on Home)
  const sites = (wallets ?? []).filter((w) => w.role === "site" || w.role === "agent");
  const usd = sumUsd([s.reserveUsd ?? "0.00", ...cash, ...closedCoins, ...coinsHeld, allAwayUsd(s).toFixed(2), ...sites.flatMap((w) => [w.cashUsd, w.coinsUsd])]);
  // never a NEAR-only figure (D111): an answer missing Solana's or Robinhood's row is a part not read
  // a coin with no price is left out, as the Safe leaves out coins it can't price; only a part not read is "updating…"
  const partial = !["sol", "hood"].every((c) => s.networks.some((n) => n.network === c)) || held === null || wallets === null || sites.some((w) => w.unread);
  return { usd, partial, ...(own?.some((c) => c.usd === null) ? { uncounted: true as const } : {}) };
}
