// The one-balance screens' words and problems (TRADE-FLOAT.md §1, §8): the top line, the Buy sheet's short-chain state,
// a move's "where it is now", the set-up's five steps, and every Problem these screens can show. Pure, so the tests read
// them without a screen. The Problems live with Trade's others in trade-problems.ts and errors.md.
import { WALLET_NAME } from "@zerofee/core/spending";
import { cameBack } from "../back-words.ts";
import { ProblemError, type Problem } from "@zerofee/core/problem";
import { tradeProblems } from "../trade-problems.ts";
import { CHAIN_MIN_USD, type ChainView, type FloatChain, type FloatSnapshot, type MoveRow } from "../float-view.ts";
import type { FloatMove } from "@zerofee/shell-api/mock-float.ts";
import { usd } from "./format.ts";

/** "Trading $X · Solana $a · Robinhood $b · BNB $c": each chain's wallets and coins, the reserve inside the total. */
export function tradingLine(s: FloatSnapshot): string {
  // H04: a chain Trade doesn't offer (BNB until proven) isn't in the line, as it isn't in the total
  return [`Your NEAR wallet ${usd(s.totalUsd)}`, ...s.chains.filter((c) => !c.closed).map((c) => `${c.name} ${usd(chainShown(c))}`)].join(" · ");
}
/** A chain's figure beside the Trading total: its money and coins, and money on its way there (the total already counts it,
 *  so the two never disagree while a move lands). */
export const chainShown = (c: ChainView): number => c.nativeUsd + c.coinsUsd + (c.inFlight?.to === "chain" ? c.inFlight.usd : 0);

/** "about N s", or "about a minute" past 50 s: an honest ETA in a child's words. */
export const about = (sec: number): string => (sec <= 0 ? "any moment" : sec > 50 ? `about ${Math.max(1, Math.round(sec / 60))} minute${sec > 90 ? "s" : ""}` : `about ${Math.ceil(sec)} s`);

/**
 * The Buy sheet when the buy is bigger than what's ready on its chain (§3): what's ready now, what's on its way, and the
 * one tap for more. `ready` under $1 offers no smaller buy.
 */
export function shortChain(c: ChainView, wantUsd: number): { ready: string; buyNow?: number; onWay?: string; moreUsd: number } {
  const buyNow = c.readyUsd >= 1 ? Math.floor(c.readyUsd) : undefined;
  const onWay = c.inFlight && c.inFlight.to === "chain" ? `More is on its way · ${about(c.inFlight.etaSec)}` : undefined;
  return { ready: `${usd(c.readyUsd)} ready now`, ...(buyNow !== undefined ? { buyNow } : {}), ...(onWay ? { onWay } : {}), moreUsd: Math.max(0, Math.ceil(wantUsd - c.readyUsd)) };
}

/** "Move $N more" (re-walk.3): what's missing for the buy, never more than the reserve can pay with the move's own fee
 *  on top, in whole dollars. */
export const moveMoreUsd = (moreUsd: number, reserveUsd: number, feeRoom: number): number => Math.min(moreUsd, Math.floor(reserveUsd / (1 + feeRoom)));

/** Where a move's money is now, in words, for its row in Activity. */
export function whereWords(m: MoveRow, chainName?: string): string {
  // an Add the account's protection holds: still in the main balance, waiting its time (tap: the Waiting screen)
  if (m.kind === "add" && m.held) return "Waiting · in your Safe";
  // S5: one paid from Private came back there (its refund address, float-private.ts settle's note), never "in your Safe"
  if (m.kind === "add" && m.status === "failed") return m.priv ? `Didn't go · ${m.note ?? cameBack(m.usd)}` : "Didn't go · still in your Safe";
  if (m.status === "failed") return "It didn't go through · nothing moved";
  if (m.status === "refunded") return "Back in your NEAR wallet";
  // the planner's own moves say why they happen: keeping the person's split between chains
  if (m.status === "waiting") return m.kind === "in" || m.kind === "out" ? "Waiting its turn" : "Waiting its turn · still in your NEAR wallet";
  if (m.where === "in-flight") return `On its way · ${about(m.etaSec ?? 0)}`;
  // a wallet by its own name (D129, the Copywriter's row 9); `chainName` stays for callers that pass it
  if (m.where === "chain") return m.chain && m.chain in WALLET_NAME ? `Now in ${WALLET_NAME[m.chain as keyof typeof WALLET_NAME]}` : `Now on ${chainName ?? "its chain"}`;
  if (m.where === "main") return "Back in your Safe";
  return "Now in your NEAR wallet";
}

/** A chain's second line on the sliders: its share in dollars, or why it won't move. */
export function shareWords(c: ChainView): string {
  if (c.closed) return "Opens once ZeroFee has tested it · the other networks get its share for now";
  if (c.pct === 0) return "Off";
  if (c.tooLittle) return `${usd(c.targetUsd)} · too little to move (under ${usd(CHAIN_MIN_USD[c.chain])})`;
  return usd(c.targetUsd);
}


const NAME: Record<FloatChain, string> = { sol: "Solana", hood: "Robinhood Chain", bsc: "BNB Chain" };

/** The one balance's Problems, catalogued with Trade's others (trade-problems.ts, errors.md). */
export const floatProblems = {
  addFailed: (): Problem => tradeProblems.floatAddFailed(),
  takeOutFailed: (): Problem => tradeProblems.floatTakeOutFailed(),
  /** `sampleShown`: ?demo shows sample money in Trading that was never moved in (it can't come out): say so, not "sell first". */
  /** Take out with nothing over the core's $2 floor: what IS there that can move, said (re-walk, 12.1); none at all,
   *  "nothing", and in ?demo why the sample wallets' own money shown in Trading isn't it (re-walk.1, `sampleShown`). */
  nothingToTakeOut: (takeableUsd: number, sampleShown = false): Problem => {
    if (takeableUsd >= 0.01) return tradeProblems.floatUnderFloor(usd(takeableUsd));
    const p = tradeProblems.floatNothingToTakeOut();
    return p;
  },
  moveFailed: (chain: FloatChain): Problem => tradeProblems.floatMoveFailed(NAME[chain]),
  reserveEmpty: (chain: FloatChain): Problem => tradeProblems.floatReserveEmpty(NAME[chain]),
  moveRefused: (chain: FloatChain): Problem => tradeProblems.floatMoveRefused(NAME[chain]),
  movesUsed: (): Problem => tradeProblems.floatMovesUsed(),
};

/** A refill (Security's sheet, Wallet's `ledger.toTrading`) the person said no to: said plainly on the screen, never a Problem. */
/** Spending's Activity filter (D52, D102): what the person did (a Top up, a Put away, Make ready for Apps), what failed,
 *  and every move the engine still makes by itself (gas, an older wallet's cash coming back, the put-away above the cap). */
export const shownMove = (m: MoveRow): boolean => m.kind === "add" || m.why === "asked" || m.why === "ready" || m.why === "gas" || m.why === "older" || m.why === "over-cap" || m.status === "failed";

/** A site's Add (pump.fun's Put money in) and its move on to the site's wallet are Home's: one row in its history, never
 *  also Trade's ("Moved $5.00 to your NEAR wallet", QA 5 Nov: five rows for one top-up). */
/** A Move from the Safe on to a chain's wallet (its legs, or its payments from Private to a chain) is Home's job too: its
 *  one row is Money's "Move $5.20 to your SOL wallet", never also Trade's "Moved $5.20 to your NEAR wallet" (the proof's
 *  Sim walk of fix/browser-sites-4, 5 Nov, rule 11). A Move that ends in the NEAR wallet stays Trade's. */
const homeJob = (m: MoveRow): boolean => !!m.ready || (m.kind === "add" && (!!m.legs?.length || !!m.priv?.parts.some((p) => p.chain !== "near")));
export const siteMove = (m: MoveRow, all: readonly MoveRow[]): boolean => homeJob(m) || (!!m.of && all.some((x) => x.id === m.of && homeJob(x)));

export const DECLINED_WORDS = "You said no. Nothing moved.";

/** What a failed float call shows: the core's own Problem (security.float.short, security.request.not-allowed, …) as it
 *  came, in its words; anything else the screen's fallback. */
export const problemOf = (e: unknown, fallback: Problem): Problem => (e instanceof ProblemError ? e.problem : fallback);

/** A core FloatMove (docs/interfaces.md, subwallet.float.move) as the screens' row: `float` is the reserve, `pending` is moving. */
/** A swap inside Spending (a NEAR coin bought or sold) is a trade, in Trade's own Activity: never a move row. */
export function rowOf(m: FloatMove & { kind: Exclude<FloatMove["kind"], "swap"> }, etaSec?: number): MoveRow {
  return {
    id: m.id, kind: m.kind, usd: m.usd, at: Date.parse(m.startedAtIso), ...(m.chain ? { chain: m.chain } : {}),
    status: m.status === "pending" ? "moving" : m.status,
    where: m.where === "float" ? "reserve" : m.where,
    ...(m.status === "pending" && etaSec !== undefined ? { etaSec } : {}),
  };
}
