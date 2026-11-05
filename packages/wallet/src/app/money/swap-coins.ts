// Home's Swap of any coin (bug report, 5 Nov; the review's rulings). Two kinds of route:
// - "place": between Home's own places (a wallet's coin, the NEAR wallet's cash, the Safe's), as before (swap-corridor.ts):
//   money that moves BETWEEN wallets goes only through NEAR Confidential (spending.move, spending.topUp, putAway).
// - "trade": a coin and another coin inside ONE wallet (SOL ↔ BONK, BONK ↔ WIF, ETH ↔ a Robinhood coin). It never leaves
//   the wallet, so it is a trade: direct, on Trade's own engines, under 2 s (spending.swap.*, trade/src/swap-door.ts).
// Anything else is shown with its one-line reason, never offered and then refused (drop, don't degrade). Pure.
import { NATIVE, PLACE_CHAIN, type PickChain, type PickCoin } from "./coin-pick.ts";
import { routeOf, type SwapPlace, type SwapRoute } from "./swap-corridor.ts";
import { inplaceOf, type InplaceRoute } from "./swap-inplace-route.ts";

export type CoinRoute =
  | { kind: "place"; route: SwapRoute }
  | { kind: "trade"; chain: "sol" | "hood"; pay: string; get: string }
  | InplaceRoute;

/** Each reason a pair isn't offered today, one line each (copywriter; notHere split by reason, words: the copy review. */
export const COIN_WHY = {
  nearCoins: "NEAR coins aren't in Swap yet.",
  nearPair: "Coins swap only to and from cash. Swap one to cash first.",
  crossChain: "This coin can't swap to another network yet.",
  same: "That's the coin you pay with.",
  /** no route lands NEAR in the Safe yet (swap-corridor.ts routeOf) */
  noSafeNear: "Swap can't land NEAR in your Safe yet. Your coin is still here; swap it to USDC instead.",
  /** BNB Chain closed to Move */
  bscClosed: "BNB Chain swaps are closed right now. Your BNB is still in your BNB wallet.",
  /** any other direction not open */
  notHere: "This swap direction isn't open yet. Your coin stays where it is.",
} as const;

/** Why routeOf found no route between two places, in routeOf's own order. */
const placeWhy = (pay: SwapPlace, get: SwapPlace, open: (c: "bsc" | "pair") => boolean): string =>
  (pay === "bsc" || get === "bsc") && !open("bsc") ? COIN_WHY.bscClosed : get === "safe-near" ? COIN_WHY.noSafeNear : COIN_WHY.notHere;

/** The chains a coin trades on inside its wallet (trade/src/swap-door.ts SWAP_TRADE_CHAINS). */
const TRADE_CHAINS: readonly PickChain[] = ["sol", "hood"];
/** A wallet's own coin on a trade chain, as the trade sees it ("native"). */
const nativeOf = (c: PickCoin): string | null => (c.place === "sol" || c.place === "hood" ? NATIVE : c.place ? null : c.address);

/** The route from `pay` to `get`, or the one line why there is none today. `open`: as swap-corridor.ts routeOf. */
export function coinRoute(pay: PickCoin, get: PickCoin, open: (c: "bsc" | "pair") => boolean): CoinRoute | { why: string } {
  if (pay.place && get.place) {
    if (pay.place === get.place) return { why: COIN_WHY.same };
    const route = routeOf(pay.place, get.place, open);
    return route ? { kind: "place", route } : { why: placeWhy(pay.place, get.place, open) };
  }
  // NEAR Intents in place (product decision, 5 Nov): the NEAR wallet's cash and a NEAR coin, one intent in its private balance
  const inplace = inplaceOf(pay, get);
  if (inplace) return inplace;
  // two NEAR coins: through cash (two intents); any other NEAR coin pair isn't offered (Rhea waits for NEAR_TRADES)
  if (!pay.place && pay.chain === "near" && !get.place && get.chain === "near") return { why: COIN_WHY.nearPair };
  // a coin on NEAR (not a place): Trade doesn't buy or sell NEAR coins (trade runtime MARKET has no NEAR)
  if ((!pay.place && pay.chain === "near") || (!get.place && get.chain === "near")) return { why: COIN_WHY.nearCoins };
  if (pay.chain !== get.chain) return { why: COIN_WHY.crossChain };
  if (!TRADE_CHAINS.includes(pay.chain)) return { why: COIN_WHY.notHere };
  const a = nativeOf(pay), b = nativeOf(get);
  if (!a || !b) return { why: COIN_WHY.notHere };
  if (a === b || a.toLowerCase() === b.toLowerCase()) return { why: COIN_WHY.same };
  return { kind: "trade", chain: pay.chain as "sol" | "hood", pay: a, get: b };
}

/** A place as a picker row (its chain; BNB is not in the tray). */
export function placeCoin(place: SwapPlace, coin: { symbol: string; label: string; icon: string; where: string }, usd?: number): PickCoin | null {
  const chain = PLACE_CHAIN[place];
  if (!chain) return null;
  return { chain, address: place, symbol: coin.label, name: coin.where, icon: coin.icon, place, ...(usd !== undefined && usd > 0 ? { heldUsd: usd } : {}) };
}

/** The verbs a trade's job says, naming who does the work (the "they" voice): one leg "Jupiter is swapping it", a leg of
 *  two "PumpSwap is swapping WIF for SOL". */
export const tradeStep = (route: string, from?: string, to?: string): string => `${route || "The exchange"} is swapping ${from && to ? `${from} for ${to}` : "it"}`;
/** The step once landed. */
export const tradeStepDone = (route: string, from?: string, to?: string): string => `${route || "The exchange"} swapped ${from && to ? `${from} for ${to}` : "it"}`;

/** A coin's figure for the eye (design review, 5 Nov: no four decimals): 2,912 · 41.25 · 0.0515. */
export function coinShown(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 100) return Math.round(n).toLocaleString("en-US");
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Number(n.toPrecision(3)).toString();
}

/** "About 2,912 DOPE" (the exchange's own quote; the floor it accepts is its own guard). */
export function tradeArrives(v: { getRaw: string; getDecimals: number; getSymbol: string }, nativeSymbol: string): string {
  const dec = v.getDecimals >= 0 ? v.getDecimals : nativeSymbol === "SOL" ? 9 : 18;
  return `About ${coinShown(Number(v.getRaw) / 10 ** dec)} ${v.getSymbol || nativeSymbol}`;
}
