// Home's Swap (the Home plan §1.4; D128): You pay [coin] → You get [coin], one amount, one hold. The coins are each
// wallet's own coin (SOL, ETH (RH), BNB while its gate is open), the NEAR wallet's cash (USDC), and the Safe's USDC and
// NEAR. ONLY pairs the real core completes are listed (no pick-then-refuse: audit dead ends 3–6), each on the one private
// engine, through Trading's confidential balance on NEAR:
//
// - "move":  a wallet's coin → another wallet's coin (SOL → ETH (RH)), or to and from the NEAR wallet's cash
//            (spending.move, E5: one saved job, a move in then a move out).
// - "topup": the Safe's USDC or NEAR → a wallet (spending.topUp with that coin named and one leg: one Face ID).
// - "home":  a wallet's coin, or the NEAR wallet's cash → USDC in the Safe (spending.putAway's legs, no Approve).
// - "safe":  the Safe's NEAR → USDC in the Safe (spending.topUp { swap: "NEAR", home: true }, E7: one Face ID).
// Not listed, because no core path finishes them yet: anything → NEAR in the Safe, BNB while it is shut, Hidden.
// Pure, so every pair is a test.
import { LEG_SEC } from "@zerofee/shell-api/job-steps.ts";
import { HOME_LEG_MIN_USD, PAIR_MIN_USD, SAFE_LEG_MIN_USD, leastHome, leastIn } from "@zerofee/core/float-floors";
import { safeHeld, type EarnPart } from "../format.ts";
import { feesFigure, intentsKept } from "@zerofee/core/zero-fee";
import type { SwapCover } from "./swap-cover.ts";

export { saidOnSheet } from "./swap-refused.ts";

/** 1Click's USDC on NEAR Intents: the NEAR wallet's cash and the Safe's USDC (the core's FLOAT_USDC). */
export const ROW_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

export type Wallet = "sol" | "hood" | "bsc" | "near";
export type SwapPlace = Wallet | "safe-usdc" | "safe-near";
export const SWAP_PLACES: readonly SwapPlace[] = ["sol", "hood", "bsc", "near", "safe-usdc", "safe-near"];
/** Each coin as Home names it (D124: "ETH (RH)"), its logo, and where it sits, in the Agent app's words ("your SOL wallet"). */
export const SWAP_COIN: Record<SwapPlace, { symbol: string; label: string; icon: string; where: string }> = {
  sol: { symbol: "SOL", label: "SOL", icon: "sol", where: "your SOL wallet" },
  hood: { symbol: "ETH", label: "ETH (RH)", icon: "hood", where: "your ETH (RH) wallet" },
  bsc: { symbol: "BNB", label: "BNB", icon: "bnb", where: "your BNB wallet" },
  near: { symbol: "USDC", label: "USDC", icon: "usdc", where: "your NEAR wallet" },
  "safe-usdc": { symbol: "USDC", label: "USDC", icon: "usdc", where: "your Safe" },
  "safe-near": { symbol: "NEAR", label: "NEAR", icon: "near", where: "your Safe" },
};
/** A coin and where it sits, said once each (review of the shots: "SOL  SOL wallet"): "SOL · your SOL wallet". */
export const coinName = (p: SwapPlace): string => `${SWAP_COIN[p].label} · ${SWAP_COIN[p].where}`;

export type SwapRoute =
  | { kind: "move"; from: Wallet; to: Wallet }
  | { kind: "topup"; coin: "USDC" | "NEAR"; to: Wallet }
  | { kind: "home"; from: Wallet }
  | { kind: "safe" };

/** The pair's route, or null: a pair no core path finishes (never listed). `open`: a chain whose gate is open. */
/** `open("pair")`: E5 between two chains' wallets and E7, on only in the test proof build (review L9, home-proof.ts). */
export function routeOf(pay: SwapPlace, get: SwapPlace, open: (c: "bsc" | "pair") => boolean): SwapRoute | null {
  if (pay === get) return null;
  if ((pay === "bsc" || get === "bsc") && !open("bsc")) return null;
  if (get === "safe-near") return null;                                       // nothing lands as NEAR in the Safe yet
  const wallet = (x: SwapPlace): x is Wallet => x === "sol" || x === "hood" || x === "bsc" || x === "near";
  if (wallet(pay) && wallet(get)) return pay !== "near" && get !== "near" && !open("pair") ? null : { kind: "move", from: pay, to: get };
  if (wallet(pay) && get === "safe-usdc") return { kind: "home", from: pay };
  if ((pay === "safe-usdc" || pay === "safe-near") && wallet(get)) return { kind: "topup", coin: pay === "safe-usdc" ? "USDC" : "NEAR", to: get };
  if (pay === "safe-near" && get === "safe-usdc") return open("pair") ? { kind: "safe" } : null;
  return null;
}

/** What "You get" lists for a coin paid: only coins a route reaches. */
export const getsFor = (pay: SwapPlace, open: (c: "bsc" | "pair") => boolean): SwapPlace[] => SWAP_PLACES.filter((g) => routeOf(pay, g, open) !== null);

/** The least one swap can be (the core's floor, SPENDING_MIN_MOVE_USD). */
export const SWAP_MIN_USD = 2;
const cents = (x: number) => Math.floor(x * 100 + 1e-6) / 100;

/**
 * What arrives for `usd`, before any quote: "at least" where the core holds every leg to a floor (a move in: leastIn; a
 * move home: 98 %; a move out: exactly its amount at the core's price, 1 % of room for the price moving), "about" where a
 * leg is 1Click's own quote with only its Approve to show the least (the Safe's Add). `price`: the coin got, in dollars.
 */
export function arrives(r: SwapRoute, usd: number, price: number): { amount: number; least: boolean } {
  const per = (dollars: number) => (price > 0 ? dollars / price : 0);
  switch (r.kind) {
    case "move":
      if (r.from === "near") return { amount: per(usd * 0.99), least: true };
      // the second leg keeps 3 % of what arrived for its fee (no trim since D137)
      return r.to === "near" ? { amount: leastIn(usd * 0.99), least: true } : { amount: per(leastIn(usd * 0.99) / 1.03), least: true };
    case "home":
      return { amount: cents(leastHome(r.from === "near" ? Math.max(0, usd - 0.01) : leastIn(usd * 0.99))), least: true };
    case "topup":
      // the Add (USDC as it is; NEAR changed inside its quote), then the leg on, which keeps 3 % of it for its fee (D137: no trim)
      return { amount: r.to === "near" ? cents(usd * (r.coin === "USDC" ? 1 : 0.99)) : per((usd * (r.coin === "USDC" ? 1 : 0.99)) / 1.03), least: false };
    case "safe":
      return { amount: cents(usd * 0.99 * 0.98), least: false };
  }
}

/**
 * Audit H1 (fix #3), by the core's own rule (`sends`: core spending.ts safeSends with the Safe's coins, the cap's room
 * and the Face ID band as the core reads them): the Safe's USDC swapped on to a wallet leaves rounded UP to the inflow
 * grid, and the rest stays in Private (privacy audit, 4 Nov: never a public step back to the Safe), in Move's own line
 * form (the copy review's words, move-split.ts MOVE_WORDS.fill; QA's Sim walk, 5 Nov: "The rest" named no figure):
 * "Your Safe sends $110.00. $10.00 stays in Private." Said before the tap; null when nothing is rounded or `sends`
 * isn't known.
 */
export function swapStays(r: SwapRoute | null, usd: number, sends?: (usd: number) => number, privatePays = PRIVATE_PAYS, cover: SwapCover | null = null): string | null {
  // the build's trace (S2, 5 Nov): the app pays the Safe's money on to a wallet from Private (trade runtime.ts fromPrivate, the
  // the HARD RULE; float-core paysPrivately: every Add but E7's), never the public Safe → NEAR wallet leg the grid
  // rounds, so the place that pays is named and nothing is rounded. T-F (6 Nov): "your Safe covers the rest" only when it
  // will (swap-cover.ts swapCover); Private short with no cover: nothing here (the sub-line slot says it, the button off)
  if (privatePays && r?.kind === "topup" && r.to !== "near" && usd > 0) {
    if (cover?.kind === "refuse") return null;
    return cover?.kind === "cover" ? SWAP_WORDS.paidFrom(`$${usd.toFixed(2)}`) : SWAP_WORDS.paidPrivate(`$${usd.toFixed(2)}`);
  }
  if (!sends || !r || r.kind !== "topup" || r.coin !== "USDC" || r.to === "near" || !(usd > 0)) return null;
  const g = sends(usd);
  return g - usd >= 0.01 ? SWAP_WORDS.fill(`$${g.toFixed(2)}`, `$${(g - usd).toFixed(2)}`) : null;
}

/** The app's Safe → a wallet Add pays from Private (trade runtime.ts `fromPrivate: true`; pinned by swapsend-logic.test). */
export const PRIVATE_PAYS = true;

/** The Safe → a chain's wallet, as measured (a UI test, 4 Nov). */
export const SAFE_TO_WALLET_TIME = "About 4 min.";

/** How long the route takes, in seconds: the network's own time only (D137: no waits of ZeroFee's own between legs). The
 *  sheet's words and the job's time left (product decision, 5 Nov) both read it. */
export function routeSec(r: SwapRoute): number {
  // D137: no waits of ZeroFee's own; one 1Click leg is about 30 s, two about a minute
  const oneLeg = (r.kind === "topup" && r.to === "near") || (r.kind === "move" && (r.from === "near" || r.to === "near")) || (r.kind === "home" && r.from === "near");
  // the Safe's money on to a chain's wallet: its Approve, the Add into the NEAR wallet, then the leg out. Measured on
  // mainnet (a UI test, 4 Nov: "about 1 min" said, about 4 min taken; a real-money test's Add about 3 min)
  // the Safe's money on to a chain's wallet is paid from Private by NEAR Confidential (the product's HARD RULE; the core's
  // fromPrivate), so its time is that route's as measured, the same the job's row counts down (live-steps privateMove:
  // LEG_SEC.privateSwap). Sim re-check (5 Nov): the sheet said "About 4 min left." for a Swap that landed at once
  return oneLeg ? 30 : r.kind === "topup" ? LEG_SEC.privateSwap : 60;
}
/** the audit's Send audit M6 (7 Nov): the time on a line that already says "About" its figure, said plainly ("In 1 min."), so
 *  a line has one "about" (the arrives lines; the receipt keeps aboutTime). */
export const inTime = (r: SwapRoute): string => aboutTime(r).replace(/^About /, "In ");
/** About how long, in words (routeSec). */
export function aboutTime(r: SwapRoute): string {
  const s = routeSec(r);
  return s === LEG_SEC.safeToChain ? SAFE_TO_WALLET_TIME : s === 30 ? "About 30 s." : "About 1 min.";
}

/**
 * A coin's figure, at most 4 decimals (review of the shots, 3 Nov: "0.003774 ETH"): what arrives rounds DOWN, so it is
 * never more than lands; what must be sent rounds UP, so it is never less than goes. "0.0037", "1,234.5678".
 */
export function coinFigure(x: number, dir: "down" | "up"): string {
  if (!Number.isFinite(x) || x <= 0) return "0";
  const n = dir === "down" ? Math.floor(x * 1e4 + 1e-9) / 1e4 : Math.ceil(x * 1e4 - 1e-9) / 1e4;
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** The line under the amount: "At least 0.0158 ETH arrives. About 2 min." */
export function arrivesLine(r: SwapRoute, get: SwapPlace, usd: number, price: number): string {
  const a = arrives(r, usd, price);
  const sym = SWAP_COIN[get].symbol;
  return `${a.least ? "At least" : "About"} ${coinFigure(a.amount, "down")} ${sym} arrives. ${inTime(r)}`;
}

/**
 * UI's mainnet rehearsal (3 Nov): a $2 SOL → USDC swap said "at least 1.4 USDC", the core's floor (its fee and price
 * room), about 30 % under what it brings. With 1Click's own dry quotes of the legs (subwallet.float.swapCost, nothing
 * moves): what it really brings first, the floor as "at least"; and when its fees are over FEE_SAY_SHARE of it, how
 * much, with the least amount where they fall under FEE_OK_SHARE.
 */
// QA's real-money check (5 Nov): fees of 24-28 % on small amounts went by as a quiet line; over FEE_OK_SHARE
// they are now a plain warning with the real figure before the tap (and a second price finds where they fall under it)
export const FEE_OK_SHARE = 0.05, FEE_SAY_SHARE = FEE_OK_SHARE;
export interface SwapPrice { arrivesUsd: number; feeUsd: number }
/** "About 1.98 USDC arrives, at least 1.4. In 1 min." (no quote back: the floor line, as before). */
export function arrivesWith(r: SwapRoute, get: SwapPlace, usd: number, price: number, cost: SwapPrice | null): string {
  if (!cost || !(price > 0)) return arrivesLine(r, get, usd, price);
  const a = arrives(r, usd, price);
  const about = cost.arrivesUsd / price;
  const floor = a.least && a.amount < about ? `, at least ${coinFigure(a.amount, "down")}` : "";
  return `About ${coinFigure(about, "down")} ${SWAP_COIN[get].symbol} arrives${floor}. ${inTime(r)}`;
}
/** The least whole dollars where fees fall under FEE_OK_SHARE, from two quotes (fees = fixed + a share): null when a
 *  bigger swap doesn't bring them under it. */
export function leastFair(usd: number, fee: number, big: { usd: number; feeUsd: number } | null): number | null {
  if (!big || !(big.usd > usd)) return null;
  const share = (big.feeUsd - fee) / (big.usd - usd), fixed = fee - share * usd;
  if (!(share < FEE_OK_SHARE) || !(fixed > 0)) return null;
  const at = Math.ceil(fixed / (FEE_OK_SHARE - share));
  return at > usd ? at : null;
}
/**
 * The fee, from the price 1Click gave (finding 48: said whenever priced; product decision, 5 Nov: never scary, ZeroFee takes nothing; the copy review's
 * fee line): "Fees · about $0.13" over the button, and who keeps it under the button. No price yet: who is paid, no figure.
 */
export const feesLine = (cost: SwapPrice | null): string | null => feesFigure(cost && Number.isFinite(cost.feeUsd) ? cost.feeUsd : null);
export const paidLine = (cost: SwapPrice | null): string => intentsKept(feesLine(cost) !== null);
/** Over FEE_OK_SHARE of a small amount (QA, 5 Nov: said before the tap; the real figure is feesLine's): the
 *  least amount where the fee falls under 5 %, plainly. Null when it isn't over, or no size brings it under. */
export function fairLine(usd: number, cost: SwapPrice | null, big: { usd: number; feeUsd: number } | null): string | null {
  if (!cost || !feeHigh(usd, cost)) return null;
  const from = leastFair(usd, cost.feeUsd, big);
  return from ? `Swap $${from} or more and the fee drops under 5%.` : null;
}
/** Fees over FEE_OK_SHARE of the amount: the size where they fall under is said, before the tap. */
export const feeHigh = (usd: number, cost: SwapPrice | null): boolean => !!cost && usd > 0 && cost.feeUsd > usd * FEE_OK_SHARE;

/**
 * QA (5 Nov): floors of $2, $2.09 and $2.59 stopped small amounts only after they were typed. Each route's
 * least, said once and plainly while the amount is picked ("At least $2.59 from a wallet to your Safe."); no chip, Max
 * or opening amount under it is offered.
 */
/** `under`: what the refusal says once an amount under the route's least is typed (the UI reviewer's ruling, 6 Nov: the
 *  least is said only then, never as a standing line above the keypad); chips and Max under `usd` are never offered. */
export function floorOf(r: SwapRoute | null): { usd: number; under: string } {
  if (r?.kind === "move" && r.from !== "near" && r.to !== "near") return { usd: PAIR_MIN_USD, under: SWAP_WORDS.leastPair };
  if (r?.kind === "topup" && r.to !== "near") return { usd: SAFE_LEG_MIN_USD, under: SWAP_WORDS.safeSwapLeast };
  if (r?.kind === "home" && r.from !== "near") return { usd: HOME_LEG_MIN_USD, under: SWAP_WORDS.leastToSafe };
  if (r?.kind === "safe") return { usd: SAFE_LEG_MIN_USD, under: SWAP_WORDS.safeSwapLeast };
  return { usd: SWAP_MIN_USD, under: SWAP_WORDS.least };
}

/**
 * Swap's floor, line 1 and the one button (the UI reviewer's ruling and QA's conditions, 6 Nov). One slot, in this order: a
 * refusal that can be asked again, with the button reading its "Try again" (never a second grey button); why the amount
 * can't go; the sheet's own line; a price that didn't come, with Try again asking for it; else the privacy line. `again`:
 * the refusal's button words while it stands; an edit ends it (the sheet's `edited`). The fee block is another line: no
 * state here takes its place.
 */
export function swapFloor(o: { again: string | null; block: string | null; tried: boolean; said: boolean; priceDown: boolean }): { line: "stopped" | "why" | "said" | "price" | "stays"; tap: "swap" | "again" | "price"; label: string } {
  if (o.again) return { line: "stopped", tap: "again", label: o.again };
  const go = { tap: "swap" as const, label: SWAP_WORDS.title };
  // nothing can go: the sub-line slot says it (swapSub), once
  if (o.block === SWAP_WORDS.none) return { line: "stays", ...go };
  if (o.block && (o.block !== SWAP_WORDS.amount || o.tried)) return { line: "why", ...go };
  const price = !o.block && o.priceDown ? { tap: "price" as const, label: "Try again" } : go;
  if (o.said) return { line: "said", ...price };
  return { line: price.tap === "price" ? "price" : "stays", ...price };
}

/** The one sub-line slot above the keypad: a swap that couldn't come back, else what arrives once an amount can go (the
 *  coin figure, as Send), else what one swap can take. */
export function swapSub(o: { back: string | null; arrives: string | null; part: string | null; /** Private short, no cover (swap-cover.ts coverLine) */ short?: string | null }): { id: "swap-back" | "swap-arrives" | "swap-part" | "swap-short"; text: string } | null {
  if (o.short) return { id: "swap-short", text: o.short };
  if (o.back) return { id: "swap-back", text: o.back };
  if (o.arrives) return { id: "swap-arrives", text: o.arrives };
  return o.part ? { id: "swap-part", text: o.part } : null;
}

/** The words of the sheet (a five-year-old can read them; under 12 words where a person acts). */
export const SWAP_WORDS = {
  title: "Swap",
  pay: "You pay",
  get: "You get",
  pick: "Pick a coin",
  max: "Max",
  hold: "Hold to swap",
  holding: "Keep holding…",
  least: `Swaps start at $${SWAP_MIN_USD}.`,
  leastPair: `From one wallet to another, swaps start at $${PAIR_MIN_USD.toFixed(2)}.`,
  leastToSafe: `From a wallet to your Safe, swaps start at $${HOME_LEG_MIN_USD.toFixed(2)}.`,
  // an amount under the Safe's least typed (the UI reviewer's ruling, 6 Nov)
  safeSwapLeast: `Swaps start at $${SAFE_LEG_MIN_USD.toFixed(2)}.`,
  // the floor's cost line over the floor (the copy review's ruling, 5 Nov): the quote's own fee, never a fee-size line
  amount: "Pick an amount.",
  // the place that really pays a Safe → wallet swap (the build's trace, S2; words: the copy review
  paidFrom: (usd: string) => `${usd} leaves Private. If Private is short, your Safe covers the rest.`,
  // Private pays it all, or the cover isn't known yet: no promise (T-F, 6 Nov; words provisional)
  paidPrivate: (usd: string) => `${usd} leaves Private.`,
  // what the Safe sends past the typed amount, and what of it stays (Move's line, the copy review's words: move-split.ts MOVE_WORDS.fill)
  fill: (sends: string, stays: string) => `Your Safe sends ${sends}. ${stays} stays in Private.`,
  most: (usd: string) => `You can swap up to ${usd}.`,
  /** Under Max, when one swap pays only part of the Safe coin's one figure (product decision, 5 Nov). the copy review's words. */
  part: (usd: string) => `Up to ${usd} can go in one swap.`,
  /** The sub-line slot when one swap can take nothing now (copy review, 6 Nov): never "Up to $0.00"; the button stays off. */
  none: "Nothing more can go in one swap right now.",
  // the From list empty (the copy review's ruling, 5 Nov): one line
  nothing: "Nothing in your Safe can be swapped yet.",
  // audit H1: only what's true (the account isn't named; an amount and time can still be matched)
  privately: "Your account isn't named on the chain. The amount and time can still be matched.",
  nothingGets: "This coin can't be swapped yet.",
  // a UI test (4 Nov, S2): a $2 swap to a wallet could not be swapped back (a wallet → Safe move needs $2.59)
  noWayBack: `You'll need $${HOME_LEG_MIN_USD.toFixed(2)} in that wallet to swap it back to your Safe.`,
} as const;

// Rule (drop, don't degrade; QA's Sim walk, 5 Nov): a coin Swap can't pay with is simply not in
// "You pay", never named with a "can't ... yet" line (finding 48's notSwappable is gone). The Safe's own coins (SOL,
// ETH, BTC and the rest of the band list) swap in place on their coin page (intents-swap.ts, InplaceSwap).

/** The privacy line, only where it holds (review L6): the Safe's NEAR to its own USDC starts and ends at the Safe's public
 *  account, so that swap itself isn't hidden; it says nothing there. */
export const privateLine = (r: SwapRoute | null): string | null => (r && r.kind !== "safe" ? SWAP_WORDS.privately : null);

/** Why "Hold to swap" can't go yet, in one line (every disabled control says why), or null. */
export function swapBlock(o: { route: SwapRoute | null; usd: number; most: number }): string | null {
  if (!o.route) return SWAP_WORDS.pick;
  if (!(o.usd > 0)) return SWAP_WORDS.amount;
  if (o.route && o.most < 0.01) return SWAP_WORDS.none;
  // the route's own least, in its own words (the copy review's walk, 5 Nov: under $2 the Safe → a wallet said "$2" beside its "$2.09"):
  // between two chains' wallets, the least that still arrives (review M1); the core's floors after the fees, before any
  // Approve (UI's AgentZero walk, 3 Nov: Face ID is never asked for a leg that would stop on the way); E7 (swap
  // directions, 5 Nov): its move home needs $2 of what came in, so under $2.09 it could stop in the NEAR wallet
  const floor = floorOf(o.route);
  if (o.usd < floor.usd) return floor.under;
  if (o.usd > o.most + 0.004) return SWAP_WORDS.most(`$${o.most.toFixed(2)}`);
  return null;
}

/** A UI test (4 Nov, S2): the Safe's money swapped to a chain's wallet that leaves it under the least a swap back
 *  can be (HOME_LEG_MIN_USD), said before the hold. `walletUsd`: what that wallet holds now. */
export function backLine(route: SwapRoute | null, usd: number, walletUsd: number): string | null {
  if (!route || route.kind !== "topup" || route.to === "near" || !(usd > 0)) return null;
  return walletUsd + (usd * 0.99) / 1.03 < HOME_LEG_MIN_USD - 0.004 ? SWAP_WORDS.noWayBack : null;
}

/** What a coin paid can give at most, in dollars, to the cent below. */
export interface PayHere { place: SwapPlace; usd: number; most: number; amount?: string; /** The Safe's coin, when one swap can pay only part of its one figure: the quiet line under Max saying why. */ part?: string }
/**
 * Each coin the person holds and can pay with, from Spending's and the Safe's figures: a wallet's coin less the fee
 * reserve it keeps while it holds coins; the NEAR wallet's cash less a move out's fee room; the Safe's USDC, or its
 * largest NEAR coin (one coin pays), inside Trading's room under its limit (a Safe swap passes through Trading).
 */
export function paysHere(o: { networks: readonly { network: string; cashUsd: string; coinsUsd: string; readyUsd: string; nativeAmount?: string; closed?: true }[]; reserveUsd?: string; roomUsd: string; safe: readonly { tokenId: string; symbol?: string; usd?: string; amount: string; held?: string; listed?: boolean; test?: boolean }[] | null; /** Private's rows (D128: counted under the Safe), for the coin's one figure */ pocket?: readonly { tokenId: string; symbol?: string; usd?: string; amount: string; held?: string; listed?: boolean; test?: boolean }[] | null; /** NEAR's validators (Home's NEAR line counts them) */ earning?: readonly EarnPart[] }): PayHere[] {
  const out: PayHere[] = [];
  for (const c of ["sol", "hood", "bsc"] as const) {
    const n = o.networks.find((x) => x.network === c);
    if (!n || n.closed) continue;
    const cash = Math.max(0, Number(n.cashUsd) || 0);
    const can = Number(n.coinsUsd) > 0.01 ? Math.min(cash, Math.max(0, Number(n.readyUsd) || 0)) : cash;
    if (cash >= 0.01) out.push({ place: c, usd: cash, most: cents(can), ...(n.nativeAmount ? { amount: n.nativeAmount } : {}) });
  }
  const reserve = Math.max(0, Number(o.reserveUsd ?? 0) || 0);
  if (reserve >= 0.01) out.push({ place: "near", usd: reserve, most: cents(reserve / 1.03) });
  const room = Math.max(0, Number(o.roomUsd) || 0);
  const mine = (o.safe ?? []).filter((b) => b.held !== "private" && b.listed !== false && !b.test);
  const usdc = mine.filter((b) => b.tokenId === ROW_USDC).map((b) => Number(b.usd) || 0);
  const near = mine.filter((b) => b.tokenId === "near" || b.tokenId === "nep141:wrap.near").map((b) => Number(b.usd) || 0);
  // the figure shown is the coin's one Safe figure, Home's (format.ts safeHeld: every place the Safe holds it, Private's
  // part and NEAR's validators counted; product decision, 5 Nov); `most` stays what one swap can pay now (the largest
  // part, inside Trading's room), said in one quiet line (`part`) when it is less
  const all = [...mine, ...(o.pocket ?? [])];
  const push = (place: "safe-usdc" | "safe-near", symbol: string, parts: number[]) => {
    const usd = Number(safeHeld(all, symbol, o.earning ?? [])?.usd ?? parts.reduce((n, x) => n + x, 0));
    const most = cents(Math.min(room, Math.max(...parts)));
    out.push({ place, usd, most, ...(usd - most >= 0.01 && most >= 0.01 ? { part: SWAP_WORDS.part(`$${most.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) } : {}) });
  };
  if (Math.max(0, ...usdc) >= 0.01) push("safe-usdc", "USDC", usdc);
  if (Math.max(0, ...near) >= 0.01) push("safe-near", "NEAR", near);
  return out;
}

/** The most a pay coin gives on a route: the NEAR wallet's cash goes home whole (no move out's fee room). */
export const mostOn = (p: PayHere, r: SwapRoute | null): number => (p.place === "near" && r?.kind === "home" ? cents(Math.max(0, p.usd - 0.01)) : p.most);

/** Home's tab → the "You pay" Swap opens on: that wallet's coin; from the Safe, its USDC, else its NEAR; none held: null.
 *  From All (no tab), D70: the Safe's, as Send opens on Private (a web test: Swap opened on the SOL wallet). */
export function payFor(wallet: "safe" | Wallet | undefined, pays: readonly PayHere[]): SwapPlace | null {
  const want: SwapPlace[] = !wallet || wallet === "safe" ? ["safe-usdc", "safe-near"] : [wallet];
  return want.find((p) => pays.some((x) => x.place === p)) ?? null;
}

/** A swap's own key (the same tap, the same job: a double tap never makes two). */
export const swapKey = (): string => `home-swap-${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** The money a Swap's job claims while its call is out (job-run claim; J3, the audit's MUST, 7 Nov): the Safe's own route
 *  ("safe"); a Safe route Private pays whole (`signs` false, D143) is Private's money, never the Safe's, so a second
 *  Private job is refused by name; a wallet's own swap, its row. Pure: a table test. */
export function swapMoney(safe: boolean, signs: boolean | undefined, place: string): string[] {
  return safe ? ["safe"] : signs === false ? ["private"] : [`row:${place}`];
}
