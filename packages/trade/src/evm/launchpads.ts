// Launchpad curves: coins no aggregator routes dependably, bought and sold on the launchpad's own contract. Every address
// and selector is the old engine's (its catalogue, read from the chain and from real transactions, 21 Oct 2026):
//   Robinhood  Pons v2     launcher.getLaunchedToken(token) -> word 1 = the coin's own curve, word 4 its quote asset (0 = ETH); curve.graduated() false = on the curve.
//                          BUY  curve.buy{value: x}(x, minTokensOut, to) 0x59a87bc1 (an eth_call of it returns tokensOut: the quote)
//                          SELL token.approve(curve, n); curve.sell(n, minEthOut, to) 0xd04c6983
//   BNB Chain  four.meme   Helper3.getTokenInfo(token): [0] version [1] manager [2] quote (0 = BNB) … [7] offers … [11] liquidityAdded (0 = on the curve)
//                          BUY  manager.buyTokenAMAP{value: funds}(token, funds, minAmount) 0x87f27655
//                          SELL token.approve(manager, n); manager.sellToken(token, n, minFunds) 0x3e11741f
//                          a coin quoted in a BEP20 (USDT): Helper3 converts the BNB both ways:
//                          BUY  Helper3.buyWithEth{value: funds}(0, token, to, funds, minAmount) 0xc932b37b
//                          SELL token.approve(manager, n); Helper3.sellForEth(0, token, n, minFunds) 0x3bb81549
//   both       Flap        one Portal per chain; getTokenV8(token) word 0 = 1: on the curve.
//                          swapExactInput((in, out, amount, minOut, 0x)), the zero address = the native coin; quoteExactInput((in, out, amount))
//   Robinhood  hood.fun / RobinFun  one registry each: curves(token) -> the coin's curve (creator set, not graduated)
//                          BUY  registry.buy{value: x}(token, minOut) 0xcce7ec13   SELL token.approve(registry, n); registry.sell(token, n, minEthOut) 0x6a272462
//                          quote quoteBuy(token, x) 0x0d7a94f6, quoteSell(token, n) 0xd98b2f5c
// A coin's vanity suffix says which registry to ask (7777 / 8888 Flap, 600d hood.fun, 4663 RobinFun); anything else is asked
// of Pons (Robinhood) or four.meme (BNB). Only the curve the official launcher names for THIS coin is ever called.
import { encodeCall } from "./abi.ts";
import { isZeroAddr, same, word, wordAddr, wordBig, words, type Hex } from "./bytes.ts";
import { FLAP_PORTAL, FOUR_HELPER3, FOUR_TM2, HOODFUN, PONS_LAUNCHER, ROBINFUN, ZERO, type EvmChain } from "./chains.ts";

export const SEL = {
  ponsGetLaunched: "0x3cf28b5a", ponsGraduated: "0xe7c2b772", ponsReserves: "0x0902f1ac", ponsFeeBps: "0x24a9d853", ponsBuy: "0x59a87bc1", ponsSell: "0xd04c6983",
  flapState: "0xf1159a49", funCurves: "0x2cc3dc6e", funBuy: "0xcce7ec13", funSell: "0x6a272462", funQuoteBuy: "0x0d7a94f6", funQuoteSell: "0xd98b2f5c",
  fourInfo: "0x1f69565f", fourTryBuy: "0xe21b103a", fourTrySell: "0xc6f43e8c", fourBuyAmap: "0x87f27655", fourSell: "0x3e11741f", fourBuyWithEth: "0xc932b37b", fourSellForEth: "0x3bb81549",
} as const;
const FLAP_SWAP = "swapExactInput((address,address,uint256,uint256,bytes))";
const FLAP_QUOTE = "quoteExactInput((address,address,uint256))";

export type Venue =
  | { kind: "pons"; name: "Pons curve"; curve: string }
  | { kind: "four"; name: "four.meme curve"; manager: string; quote: string; version: number }
  | { kind: "flap"; name: "Flap curve"; portal: string }
  | { kind: "fun"; name: "hood.fun curve" | "RobinFun curve"; registry: string };

export type LCall = (to: string, data: string, value?: bigint, from?: string) => Promise<string>;
export interface SimCall { from: string; to: string; data: string; value?: bigint }
export interface SimResult { status: string; returnData?: string; gasUsed?: string; error?: { message?: string }; logs: { address: string; topics: string[]; data: string }[] }
/** eth_simulateV1 of calls in one block (traceTransfers on): each call's status, return data and logs. Undefined when no node answers it.
 *  `later`: more calls in a block after it, a minute later (a coin with an anti-MEV cooldown refuses a sale in the block of
 *  its buy, as PONS does: "anti-MEV: cooldown active"); their results follow the first block's, in order. */
export type Simulate = (calls: SimCall[], later?: SimCall[]) => Promise<SimResult[] | undefined>;

export const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** traceTransfers' address for a native-coin transfer. */
export const NATIVE_LOG = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const p = (v: string | bigint): string => word(v);
export const sumTo = (logs: SimResult["logs"], asset: string, to: string): bigint =>
  logs.filter((l) => same(l.address, asset) && l.topics[0] === TRANSFER && l.topics[2] && same(wordAddr(l.topics[2].slice(2)), to)).reduce((n, l) => n + BigInt(l.data), 0n);
/** four.meme: some curve coins carry a buy / sell tax (one took 9 % of a buy) that the helper's tryBuy / trySell don't count. Without a simulation, the helper's figure less this margin. */
export const FOUR_NO_SIM_MARGIN_BPS = 1500n;

/** Is this coin on a launchpad curve right now? A coin that graduated (or never launched there) is undefined: its pools are the AMM's. */
export async function venueOf(chain: EvmChain, token: string, call: LCall): Promise<Venue | undefined> {
  const suffix = token.slice(-4).toLowerCase();
  const portal = FLAP_PORTAL[chain];
  if (suffix === "7777" || suffix === "8888") {
    try { if (wordBig(words(await call(portal, SEL.flapState + p(token)))[0]) === 1n) return { kind: "flap", name: "Flap curve", portal }; } catch { /* not a Flap coin */ }
  }
  if (chain === "hood" && (suffix === "600d" || suffix === "4663")) {
    const fun = suffix === "600d";
    try {
      const w = words(await call(fun ? HOODFUN : ROBINFUN, SEL.funCurves + p(token)));
      // hood.fun: (vEth, vTokens, realEth, realTokens, creator, block, flag, flag, feeBps); RobinFun: (…, readyToGraduate [7], graduated [8], creator [9], …)
      const live = fun ? w.length >= 9 && !isZeroAddr(wordAddr(w[4])) && wordBig(w[6]) === 0n && wordBig(w[7]) === 0n : w.length >= 12 && !isZeroAddr(wordAddr(w[9])) && wordBig(w[8]) === 0n;
      if (live) return { kind: "fun", name: fun ? "hood.fun curve" : "RobinFun curve", registry: fun ? HOODFUN : ROBINFUN };
    } catch { /* not this registry's coin */ }
  }
  if (chain === "hood") {
    let w: string[];
    try { w = words(await call(PONS_LAUNCHER, SEL.ponsGetLaunched + p(token))); } catch { return undefined; }
    if (w.length < 2 || !same(wordAddr(w[0]), token)) return undefined;        // not a Pons coin
    const curve = wordAddr(w[1]);
    if (isZeroAddr(curve)) return undefined;
    let g: string;
    try { g = await call(curve, SEL.ponsGraduated); } catch { return undefined; }
    if (wordBig(words(g)[0]) !== 0n) return undefined;                           // graduated: a Uniswap v4 pool with the Pons hook now
    // word 4 is the curve's quote asset: only a coin quoted in the native coin (0) is traded here. One quoted in a token (a
    // stock token: found live on 25 Oct 2026, its sell paid that token, not ETH) reverts a buy paid in ETH and sells for
    // something else than the quote shows: it is left to the AMM / aggregator, which see its real pair
    if (w.length >= 5 && !isZeroAddr(wordAddr(w[4]))) return undefined;
    return { kind: "pons", name: "Pons curve", curve };
  }
  let r: string;
  try { r = await call(FOUR_HELPER3, SEL.fourInfo + p(token)); } catch { return undefined; }   // not a four.meme coin: the helper reverts
  const w = words(r);
  if (w.length < 12) return undefined;
  const version = Number(wordBig(w[0])), manager = wordAddr(w[1]), quote = wordAddr(w[2]), offers = wordBig(w[7]), added = wordBig(w[11]);
  if (added !== 0n || offers === 0n) return undefined;                          // graduated (a PancakeSwap pair now) or sold out
  if (version !== 2 || !same(manager, FOUR_TM2)) return undefined;              // only TokenManager2
  return { kind: "four", name: "four.meme curve", manager, quote, version };
}

export const ponsBuyData = (amountIn: bigint, minOut: bigint, to: string): Hex => SEL.ponsBuy + p(amountIn) + p(minOut) + p(to);
export const ponsSellData = (tokensIn: bigint, minOut: bigint, to: string): Hex => SEL.ponsSell + p(tokensIn) + p(minOut) + p(to);
export const fourBuyData = (token: string, funds: bigint, minAmount: bigint): Hex => SEL.fourBuyAmap + p(token) + p(funds) + p(minAmount);
export const fourSellData = (token: string, amount: bigint, minFunds: bigint): Hex => SEL.fourSell + p(token) + p(amount) + p(minFunds);
export const fourBuyWithEthData = (token: string, to: string, funds: bigint, minAmount: bigint): Hex => SEL.fourBuyWithEth + p(0n) + p(token) + p(to) + p(funds) + p(minAmount);
export const fourSellForEthData = (token: string, amount: bigint, minFunds: bigint): Hex => SEL.fourSellForEth + p(0n) + p(token) + p(amount) + p(minFunds);
export const flapData = (side: "buy" | "sell", token: string, amountIn: bigint, floor: bigint): Hex =>
  encodeCall(FLAP_SWAP, [[side === "buy" ? ZERO : token.toLowerCase(), side === "buy" ? token.toLowerCase() : ZERO, amountIn, floor, "0x"]]);
const flapQuoteData = (side: "buy" | "sell", token: string, amountIn: bigint): Hex =>
  encodeCall(FLAP_QUOTE, [[side === "buy" ? ZERO : token.toLowerCase(), side === "buy" ? token.toLowerCase() : ZERO, amountIn]]);
export const funData = (side: "buy" | "sell", token: string, amountIn: bigint, floor: bigint): Hex => (side === "buy" ? SEL.funBuy + p(token) + p(floor) : SEL.funSell + p(token) + p(amountIn) + p(floor));
export const approveCall = (spender: string, n: bigint): Hex => "0x095ea7b3" + p(spender) + p(n);
/** A four.meme coin quoted in a BEP20 (not BNB): traded through Helper3, which converts the BNB both ways. */
export const viaHelper = (v: Venue): boolean => v.kind === "four" && !isZeroAddr(v.quote);
/** Where the trade is sent: the Pons curve, the Flap portal, the hood.fun / RobinFun registry, TokenManager2 or (BEP20-quoted four.meme) Helper3. */
export const routerOf = (v: Venue): string => (v.kind === "pons" ? v.curve : v.kind === "flap" ? v.portal : v.kind === "fun" ? v.registry : viaHelper(v) ? FOUR_HELPER3 : v.manager);
/** The contract a sell approves. */
export const spenderOf = (v: Venue): string => (v.kind === "pons" ? v.curve : v.kind === "flap" ? v.portal : v.kind === "fun" ? v.registry : v.manager);
/** The calldata of the curve trade, with its floor. */
export function tradeData(v: Venue, side: "buy" | "sell", token: string, amountIn: bigint, floor: bigint, wallet: string): Hex {
  if (v.kind === "pons") return side === "buy" ? ponsBuyData(amountIn, floor, wallet) : ponsSellData(amountIn, floor, wallet);
  if (v.kind === "flap") return flapData(side, token, amountIn, floor);
  if (v.kind === "fun") return funData(side, token, amountIn, floor);
  if (viaHelper(v)) return side === "buy" ? fourBuyWithEthData(token, wallet, amountIn, floor) : fourSellForEthData(token, amountIn, floor);
  return side === "buy" ? fourBuyData(token, amountIn, floor) : fourSellData(token, amountIn, floor);
}

/** BUY quote: coins out for `amountIn` of the native coin. Pons: the curve's own answer to the exact buy. four.meme / Flap / hood.fun / RobinFun: the chain's simulation of the exact buy (a taxed coin keeps part of it). */
export async function quoteBuy(v: Venue, token: string, amountIn: bigint, wallet: string, call: LCall, sim?: Simulate): Promise<bigint> {
  if (v.kind === "pons") return wordBig(words(await call(v.curve, ponsBuyData(amountIn, 1n, wallet), amountIn, wallet))[0]);
  const r = sim ? await sim([{ from: wallet, to: routerOf(v), data: tradeData(v, "buy", token, amountIn, 0n, wallet), value: amountIn }]).catch(() => undefined) : undefined;
  if (r?.[0]) return r[0].status === "0x1" ? sumTo(r[0].logs, token, wallet) : 0n;
  if (v.kind === "flap" || v.kind === "fun") return wordBig(words(await call(routerOf(v), v.kind === "flap" ? flapQuoteData("buy", token, amountIn) : SEL.funQuoteBuy + p(token) + p(amountIn)))[0]);
  if (viaHelper(v)) return 0n;   // a BEP20-quoted coin with no simulating node: no quote we'd trust
  const w = words(await call(FOUR_HELPER3, SEL.fourTryBuy + p(token) + p(0n) + p(amountIn)));
  return (wordBig(w[2]) * (10_000n - FOUR_NO_SIM_MARGIN_BPS)) / 10_000n;
}

/** SELL quote: native out for `tokensIn`, net of the curve's fees. Pons: constant product on the reserves less the fee and the creator tax; the others: the simulated approve + sell. */
export async function quoteSell(v: Venue, token: string, tokensIn: bigint, call: LCall, sim?: Simulate, wallet?: string): Promise<bigint> {
  if (v.kind === "flap" || v.kind === "fun") {
    if (sim && wallet) {
      const r = await sim([{ from: wallet, to: token, data: approveCall(routerOf(v), tokensIn) }, { from: wallet, to: routerOf(v), data: tradeData(v, "sell", token, tokensIn, 0n, wallet) }]).catch(() => undefined);
      if (r?.[1]) return r[1].status === "0x1" ? sumTo(r[1].logs, NATIVE_LOG, wallet) : 0n;
    }
    return wordBig(words(await call(routerOf(v), v.kind === "flap" ? flapQuoteData("sell", token, tokensIn) : SEL.funQuoteSell + p(token) + p(tokensIn)))[0]);
  }
  if (v.kind === "pons") {
    const [r, f] = await Promise.all([call(v.curve, SEL.ponsReserves), call(v.curve, SEL.ponsFeeBps).catch(() => "0x" + p(100n))]);
    const w = words(r);
    const qr = wordBig(w[0]), tr = wordBig(w[1]);
    if (qr === 0n || tr === 0n) return 0n;
    const gross = (qr * tokensIn) / (tr + tokensIn);
    const feeBps = wordBig(words(f)[0]) + 200n;                                  // fee + creator tax
    return (gross * (10_000n - (feeBps > 2_000n ? 2_000n : feeBps))) / 10_000n;
  }
  if (sim && wallet) {
    const r = await sim([{ from: wallet, to: token, data: approveCall(v.manager, tokensIn) }, { from: wallet, to: routerOf(v), data: tradeData(v, "sell", token, tokensIn, 0n, wallet) }]).catch(() => undefined);
    if (r?.[1]) return r[1].status === "0x1" ? sumTo(r[1].logs, NATIVE_LOG, wallet) : 0n;
  }
  if (viaHelper(v)) return 0n;
  const w = words(await call(FOUR_HELPER3, SEL.fourTrySell + p(token) + p(tokensIn)));
  const funds = wordBig(w[2]), fee = wordBig(w[3]);
  return funds > fee ? ((funds - fee) * (10_000n - FOUR_NO_SIM_MARGIN_BPS)) / 10_000n : 0n;
}

/** four.meme moves coins in whole gwei units only (any other amount reverts "GW"): the sellable part of `n`, rounded down. */
export const fourSellAmount = (n: bigint): bigint => (n / 1_000_000_000n) * 1_000_000_000n;

/** The buy, the approve and a sell of 90 % of what it brings, simulated in one block. false = the sell reverts; undefined = no node simulates. */
export async function sellsBack(v: Venue, token: string, amountIn: bigint, got: bigint, wallet: string, sim: Simulate): Promise<boolean | undefined> {
  const n = (got * 9n) / 10n;
  if (n <= 0n) return undefined;
  const r = await sim([
    { from: wallet, to: routerOf(v), data: tradeData(v, "buy", token, amountIn, 0n, wallet), value: amountIn },
    { from: wallet, to: token, data: approveCall(spenderOf(v), n) },
    { from: wallet, to: routerOf(v), data: tradeData(v, "sell", token, n, 0n, wallet) },
  ]).catch(() => undefined);
  if (!r || r.length < 3 || r[0]!.status !== "0x1") return undefined;
  return r[2]!.status === "0x1";
}

/**
 * The price of a coin market data doesn't index yet (old engine: a hood.fun coin bought fine, then its Sell page had no
 * price): the curve's own, in the native coin per whole coin (a four.meme coin quoted in a stablecoin: in that stablecoin).
 * Pons: the reserves' ratio; four.meme: the manager's last price; Flap / hood.fun / RobinFun: their quote of a tiny buy.
 * Display only: an amount is always quoted by the trade itself.
 */
export async function curvePrice(chain: EvmChain, token: string, call: LCall): Promise<{ perCoin: number; unit: "native" | "stable"; venue: Venue["name"] } | undefined> {
  const v = await venueOf(chain, token, call);
  if (!v) return undefined;
  const small = 10n ** 12n;   // 0.000001 of the native coin: far below any curve's depth, so the quote is the price plus the fee
  try {
    if (v.kind === "pons") {
      const w = words(await call(v.curve, SEL.ponsReserves));
      const q = Number(wordBig(w[0])), t = Number(wordBig(w[1]));
      return q > 0 && t > 0 ? { perCoin: q / t, unit: "native", venue: v.name } : undefined;
    }
    if (v.kind === "four") {
      const pr = Number(wordBig(words(await call(FOUR_HELPER3, SEL.fourInfo + p(token)))[3])) / 1e18;
      return pr > 0 ? { perCoin: pr, unit: isZeroAddr(v.quote) ? "native" : "stable", venue: v.name } : undefined;
    }
    const out = wordBig(words(await call(routerOf(v), v.kind === "flap" ? flapQuoteData("buy", token, small) : SEL.funQuoteBuy + p(token) + p(small)))[0]);
    return out > 0n ? { perCoin: Number(small) / Number(out), unit: "native", venue: v.name } : undefined;
  } catch { return undefined; }
}
