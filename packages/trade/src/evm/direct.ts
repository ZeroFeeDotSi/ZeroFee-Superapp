// The direct path: the coin's pool read on chain, quoted with ONE eth_call to the official quoter (v2: none, the pair's
// reserves are priced locally), and the swap built straight against the official router: Uniswap v4 (V4Quoter +
// UniversalRouter + Permit2), Uniswap v3 on Robinhood, PancakeSwap v3 and v2 on BNB Chain. No aggregator and no quote API is
// on the way. Anything it can't route (no pool, a dust pool, too thin here, a pool whose sell reverts) returns undefined and
// the aggregator is asked.
import { bigOf, hexBig } from "./bytes.ts";
import { buildClassicCall, deepestV3, discoverClassic, quoteV2Local, quoteV3Out, readReserves, readV3Sqrt, type ClassicPool } from "./classic.ts";
import { CLASSIC, MAX_TX_GAS, PERMIT2, V4, ZERO } from "./chains.ts";
import type { EvmChain } from "./chains.ts";
import {
  APPROVE_GAS_ASSUMED, APPROVE_GAS_FALLBACK, ceilMul, DEADLINE_SEC, GAS_TTL_MS, MAX_U160, memo, NO_POOL_TTL_MS, NoGas, nonceFloor, paidPrice, PERMIT2_APPROVE_GAS, PERMIT2_EXPIRY_SEC,
  PERMIT2_REUSE_SEC, POOL_TTL_MS, RESERVES_TTL_MS, SPOT_SWR_MS, SPOT_TTL_MS, THIN_IMPACT_BPS, toNum, type Built, type Ctx, type Side, type WalletSide, Refusal, sellTtl } from "./context.ts";
import { encodeCall } from "./abi.ts";
import { fitGas, gasUsedOf } from "./aggregator.ts";
import { ChainSaid } from "./rpc.ts";
import type { LCall } from "./launchpads.ts";
import { slippageBps } from "./slippage.ts";
import { V4_HOOKS } from "@zerofee/core/evm/v4-hooks";
import { approveData, approveToPermit2, buildSwapCall, discoverPools, permit2ApproveRouter, quoteOut, readSqrt, spotFromSqrt, zeroForOne, type V4Pool } from "./v4.ts";
import { buildTwoHopBuy, buildTwoHopSell, discoverMidPools, MIDS, type HopRoute } from "./twohop.ts";

/** POOL FLOOR (old engine, FETCHN: a $0.0000417 coin quoted "Not enough liquidity"): a pool under $500 of reserve, or under 1 % of the coin's deepest pool, is never traded directly when a deeper pool exists. */
export const DUST_USD = 500, DUST_SHARE = 0.01;
/** The pools (lower-cased address / pool id) the direct path must not trade, from market data's reserve per pool. A pool with no known reserve is not judged here. */
export function dustPools(pools: readonly { address: string; liquidityUsd?: number }[] | undefined): Set<string> {
  const known = (pools ?? []).filter((p) => typeof p.liquidityUsd === "number" && Number.isFinite(p.liquidityUsd) && p.liquidityUsd >= 0);
  const top = known.reduce((m, p) => Math.max(m, p.liquidityUsd!), 0);
  const out = new Set<string>();
  for (const p of known) if (p.liquidityUsd! < top && (p.liquidityUsd! < DUST_USD || p.liquidityUsd! < top * DUST_SHARE)) out.add(p.address.toLowerCase());
  return out;
}

/** No hooks, or a hook the core has pinned (v4-hooks.ts): the only v4 pools a session signs through. */
export const hooksSignable = (chain: EvmChain, hooks: string): boolean => /^0x0{40}$/i.test(hooks) || Object.hasOwn(V4_HOOKS[chain], hooks.toLowerCase());

/** The coin's v4 pools against the native coin, found once from the PoolManager's Initialize events (a pool key never changes) and remembered. */
async function poolsFor(c: Ctx, token: string): Promise<V4Pool[]> {
  const hit = c.m.pools.get(token);
  if (hit && c.now() - hit.at < (hit.pools.length ? POOL_TTL_MS : NO_POOL_TTL_MS)) return hit.pools;
  let pools: V4Pool[];
  try {
    if (!V4[c.chain].logNodes.length) pools = [];
    else {
      const head = Number(bigOf(await c.rpc("eth_blockNumber", []), "eth_blockNumber"));
      pools = await discoverPools(c.chain, token, head, (url, filter) => c.d.rpc.post(url, "eth_getLogs", [filter]));
    }
  } catch (e) {
    // a failed look-up is remembered for 10 s (an amount change must not repeat the whole log scan); an older answer, if any, is kept
    c.m.pools.set(token, { at: c.now() - NO_POOL_TTL_MS + 10_000, pools: hit?.pools ?? [] });
    throw e;
  }
  c.m.pools.set(token, { at: c.now(), pools });
  return pools;
}
/** The coin's classic (v3 / v2) pools against the wrapped native coin, from the factories, remembered like the v4 ones. */
async function classicFor(c: Ctx, token: string): Promise<ClassicPool[]> {
  const hit = c.m.classic.get(token);
  if (hit && c.now() - hit.at < (hit.pools.length ? POOL_TTL_MS : NO_POOL_TTL_MS)) return hit.pools;
  // only the deepest v3 tier, by the wrapped native it holds on two nodes (the lower), as the core's session rule reads it
  const weth = CLASSIC[c.chain].weth;
  const held = async (pool: string) => {
    const a = (await c.callPair(weth, encodeCall("balanceOf(address)", [pool]))).map((x) => (typeof x === "string" && x.length >= 66 ? BigInt(x.slice(0, 66)) : undefined)).filter((x): x is bigint => x !== undefined);
    return a.length ? a.reduce((m, x) => (x < m ? x : m)) : undefined;
  };
  const pools = await deepestV3(await discoverClassic(c.call, c.chain, token), held);
  c.m.classic.set(token, { at: c.now(), pools });
  return pools;
}
/**
 * Gap 5: the coin's routes through a middle coin (MIDS): for each, the coin's deepest v4 pool with it (by the middle coin
 * it holds, on the PoolManager) and the middle coin's deepest v3 pool with the wrapped native coin. Remembered like the
 * others. Only coins with no native or wrapped-native pool of their own are looked up (a coin with one trades there).
 */
const HOP_RETRY_MS = 2_000;
async function hopsFor(c: Ctx, token: string): Promise<HopRoute[]> {
  const mids = MIDS[c.chain];
  if (!mids.length || !V4[c.chain].logNodes.length) return [];
  const key = `hop:${token.toLowerCase()}`;
  const hit = c.m.pools.get(key) as { at: number; pools: V4Pool[]; hops?: HopRoute[] } | undefined;
  if (hit?.hops && c.now() - hit.at < (hit.hops.length ? POOL_TTL_MS : NO_POOL_TTL_MS)) return hit.hops;
  const head = Number(bigOf(await c.rpc("eth_blockNumber", []), "eth_blockNumber"));
  const hops: HopRoute[] = [];
  for (const m of mids) {
    // the log node rate-limits right after the native pools' scan: unread is asked once more after a pause, then thrown
    // (never remembered as "no pool")
    const lookup = () => discoverMidPools(c.chain, token, m.coin, head, (url, filter) => c.d.rpc.post(url, "eth_getLogs", [filter]));
    const [pools, v3s] = await Promise.all([
      lookup().catch(() => new Promise<void>((r) => setTimeout(r, HOP_RETRY_MS)).then(lookup)).catch(() => new Promise<void>((r) => setTimeout(r, 2 * HOP_RETRY_MS)).then(lookup)),
      classicFor(c, m.coin).then((x) => x.filter((p) => p.kind === "v3")),
    ]);
    const v3 = v3s[0];
    if (!v3 || !pools.length) continue;
    // the coin's deepest pool with the middle coin: the most of the middle coin the PoolManager holds for it can't be read
    // per pool, so each pool's quote decides among them (candidatesOf ranks by what each pays)
    for (const v4 of pools.slice(0, 3)) hops.push({ mid: m.coin, v3, v4 });
  }
  c.m.pools.set(key, { at: c.now(), pools: [], hops } as never);
  return hops;
}
/**
 * The coin's v4 pools worth quoting: only those the core would sign through (hooksSignable), and of more than V4_KEEP the
 * ones with the most liquidity in range (StateView.getLiquidity, one read each, remembered with the pools). Before, the first
 * four in log order were kept: TORCH (Robinhood Chain) has ten, and its deep WETH 0.3 % pool ($2.1M), the oldest, was never
 * quoted (mainnet copy, 4 Nov). A pool whose liquidity isn't read keeps its place after the read ones.
 */
const V4_KEEP = 4;
export async function deepestV4(c: Ctx, token: string, pools: V4Pool[]): Promise<V4Pool[]> {
  const ok = pools.filter((p) => hooksSignable(c.chain, p.key.hooks));
  if (ok.length <= V4_KEEP) return ok;
  const key = `v4rank:${token.toLowerCase()}`;
  const hit = c.m.pools.get(key);
  if (hit && c.now() - hit.at < POOL_TTL_MS && hit.pools.length) return hit.pools;
  const liq = await Promise.all(ok.map((p) => c.call(V4[c.chain].stateView, encodeCall("getLiquidity(bytes32)", [p.id])).then((x) => (typeof x === "string" && x.length >= 66 ? BigInt(x.slice(0, 66)) : -1n), () => -1n)));
  const ranked = ok.map((p, i) => ({ p, l: liq[i]!, i })).sort((a, b) => (a.l === b.l ? a.i - b.i : a.l > b.l ? -1 : 1)).slice(0, V4_KEEP).map((x) => x.p);
  c.m.pools.set(key, { at: c.now(), pools: ranked });
  return ranked;
}
export const directPools = async (c: Ctx, token: string): Promise<{ v4: V4Pool[]; classic: ClassicPool[]; hops: HopRoute[] }> => {
  const [v4, classic] = await Promise.all([poolsFor(c, token).then((x) => deepestV4(c, token, x)).catch(() => [] as V4Pool[]), classicFor(c, token).catch(() => [] as ClassicPool[])]);
  const hops = v4.length || classic.length ? [] : await hopsFor(c, token).catch(() => [] as HopRoute[]);
  return { v4, classic, hops };
};

/** One way to trade the coin directly: where it goes, who must be approved, its quote and its calldata for a floor. */
export interface Cand { id: string; name: string; spender: "permit2" | string; router: string; pool?: V4Pool;
  /** A route through a middle coin (gap 5): its sale is built the same way, through the same pools. */
  hop?: HopRoute;
  /** `alts`: what the other node's answer to the same read pays (none: it didn't answer in time). */
  quote(): Promise<{ out: bigint; gas: bigint; spot: bigint; alts: bigint[] }>; call(minOut: bigint, deadline: number): { to: string; data: string; value: bigint } }
const gasKey = (token: string, side: Side, id: string) => `${token}:${side}:${id}`;
const isRefused = (c: Ctx, token: string, id: string) => (c.m.refused.get(gasKey(token, "buy", id)) ?? 0) > c.now();

export function candidatesOf(c: Ctx, token: string, side: Side, payRaw: bigint, v4: V4Pool[], classic: ClassicPool[], hops: HopRoute[] = []): Cand[] {
  const dep = V4[c.chain], payCurrency = side === "buy" ? ZERO : token, out: Cand[] = [];
  if (side === "buy") { v4 = v4.filter((p) => !isRefused(c, token, p.id)); classic = classic.filter((p) => !isRefused(c, token, p.address)); }
  for (const p of v4) out.push({
    id: p.id, name: "Uniswap v4", spender: "permit2", router: dep.universalRouter, pool: p,
    // ONE call: the V4Quoter. The spot price (price impact only) comes from memory, refreshed in the background
    quote: async () => {
      const both = paired(c);
      const [q, sqrt] = await Promise.all([quoteOut(both.call, c.chain, p, payCurrency, payRaw), memo(c.now, c.m.spot, p.id, SPOT_TTL_MS, () => readSqrt(c.call, c.chain, p), SPOT_SWR_MS)]);
      const alts = await Promise.all(both.others().map((v) => quoteOut(async () => v, c.chain, p, payCurrency, payRaw).then((r) => r.amountOut, () => undefined)));
      return { out: q.amountOut, gas: q.gasEstimate + 150_000n, spot: spotFromSqrt(sqrt, zeroForOne(p.key, payCurrency), payRaw), alts: alts.filter((x): x is bigint => x !== undefined) };
    },
    call: (minOut, deadline) => buildSwapCall(dep, p, payCurrency, payRaw, minOut, deadline),
  });
  const wrapped = CLASSIC[c.chain].weth;
  for (const p of classic) out.push({
    id: p.address, name: p.name, spender: p.router, router: p.router,
    quote: p.kind === "v2"
      ? async () => {
        // the reserves kept with the other node's (a warm amount change still asks no node)
        const r = await memo(c.now, c.m.reserves, p.address, RESERVES_TTL_MS, async () => {
          const both = paired(c);
          const res = await readReserves(both.call, p);
          const alt = await Promise.all(both.others().map((v) => readReserves(async () => v, p).catch(() => undefined)));
          return { ...res, alt: alt.filter((x): x is { r0: bigint; r1: bigint } => x !== undefined) };
        });
        const q = quoteV2Local(c.chain, token, side === "buy", payRaw, r);
        return { ...q, alts: (r.alt ?? []).map((a) => quoteV2Local(c.chain, token, side === "buy", payRaw, a).out) };
      }
      : async () => {
        const buy = side === "buy", both = paired(c);
        const [q, sqrt] = await Promise.all([quoteV3Out(both.call, c.chain, p, token, buy, payRaw), memo(c.now, c.m.spot, p.address, SPOT_TTL_MS, () => readV3Sqrt(c.call, p), SPOT_SWR_MS)]);
        const alts = await Promise.all(both.others().map((v) => quoteV3Out(async () => v, c.chain, p, token, buy, payRaw).then((r) => r.out, () => undefined)));
        return { out: q.out, gas: q.gas + 100_000n, spot: spotFromSqrt(sqrt, (buy ? wrapped : token) < (buy ? token : wrapped), payRaw), alts: alts.filter((x): x is bigint => x !== undefined) };
      },
    call: (minOut, deadline) => buildClassicCall(c.chain, p, token, side === "buy", c.wallet, payRaw, minOut, deadline),
  });
  // gap 5: through a middle coin, one transaction (twohop.ts). Each hop is read on both nodes; the second hop is asked of
  // both with the LOWER of the first hop's answers (the two nodes judged on the same amount, the floor never from the
  // higher), and two first-hop answers farther apart than NODES_SPREAD_BPS drop the route
  for (const r of hops) {
    const mid = r.mid.toLowerCase();
    out.push({
      id: `hop:${mid}:${r.v4.id}`, name: "Uniswap v3 + v4", spender: "permit2", router: dep.universalRouter, pool: r.v4, hop: r,
      quote: async () => {
        const buy = side === "buy";
        const lower = (xs: bigint[]) => xs.reduce((m, x) => (x < m ? x : m));
        const agree = (xs: bigint[]) => { const hi = xs.reduce((m, x) => (x > m ? x : m)), lo = lower(xs); if ((hi - lo) * 10_000n > hi * BigInt(NODES_SPREAD_BPS)) throw new Error("the nodes disagree on the first hop"); };
        const first = paired(c);
        const h1 = buy ? await quoteV3Out(first.call, c.chain, r.v3, mid, true, payRaw).then((q) => ({ out: q.out, gas: q.gas })) : await quoteOut(first.call, c.chain, r.v4, token, payRaw).then((q) => ({ out: q.amountOut, gas: q.gasEstimate }));
        const h1alts = await Promise.all(first.others().map((v) => (buy ? quoteV3Out(async () => v, c.chain, r.v3, mid, true, payRaw).then((q) => q.out) : quoteOut(async () => v, c.chain, r.v4, token, payRaw).then((q) => q.amountOut)).catch(() => undefined)));
        const seen1 = [h1.out, ...h1alts.filter((x): x is bigint => x !== undefined && x > 0n)];
        agree(seen1);
        const m1 = lower(seen1);
        const second = paired(c);
        const h2 = buy ? await quoteOut(second.call, c.chain, r.v4, mid, m1).then((q) => ({ out: q.amountOut, gas: q.gasEstimate })) : await quoteV3Out(second.call, c.chain, r.v3, mid, false, m1).then((q) => ({ out: q.out, gas: q.gas }));
        const alts = await Promise.all(second.others().map((v) => (buy ? quoteOut(async () => v, c.chain, r.v4, mid, m1).then((q) => q.amountOut) : quoteV3Out(async () => v, c.chain, r.v3, mid, false, m1).then((q) => q.out)).catch(() => undefined)));
        // the spot (impact only): each pool's own price, chained
        const [s3, s4] = await Promise.all([memo(c.now, c.m.spot, r.v3.address, SPOT_TTL_MS, () => readV3Sqrt(c.call, r.v3), SPOT_SWR_MS), memo(c.now, c.m.spot, r.v4.id, SPOT_TTL_MS, () => readSqrt(c.call, c.chain, r.v4), SPOT_SWR_MS)]);
        const spot = buy
          ? spotFromSqrt(s4, zeroForOne(r.v4.key, mid), spotFromSqrt(s3, wrapped < mid, payRaw))
          : spotFromSqrt(s3, mid < wrapped, spotFromSqrt(s4, zeroForOne(r.v4.key, token), payRaw));
        return { out: h2.out, gas: h1.gas + h2.gas + 200_000n, spot, alts: alts.filter((x): x is bigint => x !== undefined) };
      },
      call: (minOut, deadline) => (side === "buy" ? buildTwoHopBuy(c.chain, r, token, payRaw, minOut, deadline) : buildTwoHopSell(c.chain, r, token, c.wallet, payRaw, minOut, deadline)),
    });
  }
  return out;
}

/**
 * The coin's price in dollars from its own pools on chain (fix review RT-2a: a coin with no market price left the
 * aggregator's route as the only figure, so a route keeping 90 % set the quote and the floor): each pool's spot
 * (its sqrt price or reserves, no impact) for this amount, the one that gives the most, so the aggregator is held to the
 * best price the chain shows. Undefined when no pool can be read.
 */
export async function poolPriceUsd(c: Ctx, token: string, side: Side, payRaw: bigint, pools: { v4: V4Pool[]; classic: ClassicPool[]; hops?: HopRoute[] }, nativeUsd: number, decimals: number): Promise<number | undefined> {
  // the spot of the pool that quotes best, never the highest spot of any: an empty pool sits at an extreme price (TORCH's v3
  // 1 % pool, 4 Nov: no liquidity in range, its price at the lowest tick, read as the coin almost free, so every real route
  // looked like a 100 % loss); the best quote is the pool with the depth behind its price
  const quoted = (await Promise.all(candidatesOf(c, token, side, payRaw, pools.v4, pools.classic, pools.hops ?? []).map((cand) => cand.quote().then((q) => q, () => undefined)))).filter((q): q is NonNullable<typeof q> => !!q && q.spot > 0n && q.out > 0n);
  if (!quoted.length || !(nativeUsd > 0)) return undefined;
  const best = quoted.reduce((m, q) => (q.out > m.out ? q : m)).spot;
  // a buy: native in, coins out at spot; a sale: coins in, native out at spot
  const usd = side === "buy" ? (toNum(payRaw) * nativeUsd) / toNum(best, decimals) : (toNum(best) * nativeUsd) / toNum(payRaw, decimals);
  return Number.isFinite(usd) && usd > 0 ? usd : undefined;
}

/** How far apart two nodes' answers for the same pool may be (a block between them moves a busy pool a little), in bps. */
export const NODES_SPREAD_BPS = 300;

/** An eth_call that keeps both nodes' answers: `call` gives the first (for the quote), `others()` the other's after it. */
function paired(c: Ctx): { call: LCall; others(): string[] } {
  let got: string[] = [];
  return { call: async (to, data, value, from) => { got = await c.callPair(to, data, value, from); return got[0]!; }, others: () => got.slice(1) };
}

/**
 * A direct swap's gas limit before any run of its own: `est` is the node's estimate of this very call from the wallet,
 * `quoterGas` the pool's quoted figure (with Trade's padding). A sale: the estimate with room (fitGas: +40 %, at least
 * +60,000). Phone test, 5 Nov: a Robinhood sale was refused "a network fee limit far above what its test run used"
 * (the core's bound, review M6: twice the run's use, or its use + 100,000). The quoter's figure used to floor it, and
 * Uniswap v4's quoter says ~574,000 for a swap the node estimates at 180,000: with Trade's +150,000 and +30 % the limit
 * was 941,713, five times the use. A buy had the same floor (rule 3, 5 Nov: TORCH's v4 buy at 798,473 for a 151,827
 * estimate), so a buy and a sale are both sized the same way: the quoter's figure sizes nothing while there's an estimate.
 * No estimate: the pool's figure x1.6, at least 250,000, only until the trade measures its own run (buildDirect).
 */
export function directSwapGas(est: bigint | undefined, quoterGas: bigint): bigint {
  if (est !== undefined) return fitGas(est);
  const g = ceilMul(quoterGas, 16n, 10n);
  return g < 250_000n ? 250_000n : g;
}

/** A sell route's estimate that wasn't asked for: its approvals aren't on chain yet, so the node could only refuse. */
const NOT_ESTIMATED = new Error("not estimated: the approvals aren't on chain yet");

/** A swap's gas: the node's own estimate of the exact call from the wallet, remembered per pool and side. A real refusal on a buy leaves the route out for 60 s. */
export function gasOf(c: Ctx, token: string, side: Side, cand: Cand, deadline: number): Promise<bigint> {
  const key = gasKey(token, side, cand.id);
  return memo(c.now, c.m.gas, key, GAS_TTL_MS, async () => {
    const probe = cand.call(1n, deadline);
    return bigOf(await c.rpc("eth_estimateGas", [{ from: c.d.owner, to: probe.to, value: hexBig(probe.value), data: probe.data }]), "eth_estimateGas");
  }).catch((e) => { if (side === "buy" && e instanceof ChainSaid && !/insufficient funds/i.test(e.message)) c.m.refused.set(key, c.now() + 60_000); throw e; });
}

/** The direct pool's buy, then a sell of 90 % of it through the same pool, simulated (the sale in the next block): false = the sell reverts, undefined = no node could tell. Cached per coin (5 min yes, 2 min no, 1 min no verdict). */
export async function directSellsBack(c: Ctx, token: string, cand: Cand, buyCall: { to: string; data: string; value: bigint }, out: bigint, deadline: number, classic: ClassicPool[]): Promise<boolean | undefined> {
  const c0 = c.m.sell.get(token);
  if (c0 && c.now() - c0.at < sellTtl(c0.ok)) return c0.ok;
  const n = (out * 9n) / 10n, exp = Math.floor(c.now() / 1000) + 3600, UR = V4[c.chain].universalRouter;
  const sc = cand.hop
    ? candidatesOf(c, token, "sell", n, [], [], [cand.hop])[0]
    : candidatesOf(c, token, "sell", n, cand.pool ? [cand.pool] : [], cand.pool ? [] : classic.filter((cp) => cp.address === cand.id))[0];
  if (!sc || n <= 0n) return undefined;
  const w = c.d.owner;
  // a simulation only: these approvals are never built into a step (and n is what the buy brings, never more)
  const approvals = sc.spender === "permit2"
    ? [{ from: w, to: token, data: approveToPermit2(n) }, { from: w, to: PERMIT2, data: permit2ApproveRouter(token, UR, n > MAX_U160 ? MAX_U160 : n, exp) }]
    : [{ from: w, to: token, data: approveData(sc.spender, n) }];
  const sellCall = sc.call(1n, deadline);
  // THIS wallet's sale, in a later block (its number and time advanced: Simulate's `later`), as a person's real sale always
  // is: a coin with a short block or time cooldown is judged fairly, and nothing else stands in for this wallet (review M3:
  // another holder's sale, or the coin's own "cooldown" words, prove nothing about this one). A coin whose cooldown follows
  // the parent chain's block number (PONS on Robinhood Chain, measured 4 Nov: still "anti-MEV: cooldown active" 250 blocks
  // and an hour later, since no simulation moves that number) reads as not sellable, and isn't bought directly
  const r = await c.sim([{ from: w, to: buyCall.to, data: buyCall.data, value: buyCall.value }], [...approvals, { from: w, to: sellCall.to, data: sellCall.data, value: 0n }]).catch(() => undefined);
  if (r && r.length === approvals.length + 2 && r[0]!.status === "0x1") { const ok = r[r.length - 1]!.status === "0x1"; c.m.sell.set(token, { at: c.now(), ok }); return ok; }
  c.m.sell.set(token, { at: c.now() });                        // no node simulates: no verdict, asked again in a minute (not on every amount change)
  return undefined;
}

export interface DirectIn {
  side: Side; token: string; payRaw: bigint; isMax: boolean; price: number; fee: Built["fee"]; maxFee: bigint; baseFee: bigint;
  /** A buy keeps this much more native for the sales of the other coins the wallet holds (fix review RT-4). */
  othersGas?: bigint;
  symbol: string; decimals: number; liquidity?: number; ctxP: Promise<WalletSide>; dust?: Set<string>; ttl: number;
  /** The coin's pools, already being looked for (engine.ts starts it early); undefined: look them up here. */
  poolsP?: Promise<{ v4: V4Pool[]; classic: ClassicPool[]; hops?: HopRoute[] } | undefined>;
}

/**
 * The quote and the steps from the official contracts only. Per amount: each candidate pool is quoted (one quoter call;
 * v2 none) and the best wins; the swap's gas is the cached estimate of that route; the wallet's side is read again only when
 * older than 4 s, in the same round trip. Undefined = the aggregator's turn. A wallet that can't pay throws NoGas.
 */
export async function buildDirect(c: Ctx, a: DirectIn): Promise<Built | undefined> {
  const { side, token } = a;
  let { v4, classic, hops = [] } = (await a.poolsP) ?? await directPools(c, token);
  if (a.dust?.size) { v4 = v4.filter((p) => !a.dust!.has(p.id.toLowerCase())); classic = classic.filter((p) => !a.dust!.has(p.address.toLowerCase())); hops = hops.filter((h) => !a.dust!.has(h.v4.id.toLowerCase())); }   // POOL FLOOR
  // review L5: a coin whose only own pools are dust still gets its routes through a middle coin (looked up after the floor)
  if (!v4.length && !classic.length && !hops.length) hops = (await hopsFor(c, token).catch(() => [] as HopRoute[])).filter((h) => !a.dust?.has(h.v4.id.toLowerCase()));
  // a pool with hooks only when the core would sign it (its hook pinned in the core's list): an unpinned one that quotes
  // more would win here, then be refused at the tap (TORCH, mainnet copy 4 Nov: its deep hook-free pool lost to a hooked one)
  v4 = v4.filter((p) => hooksSignable(c.chain, p.key.hooks)); hops = hops.filter((h) => hooksSignable(c.chain, h.v4.key.hooks));
  if (!v4.length && !classic.length && !hops.length) return undefined;
  let payRaw = a.payRaw;
  const UR = V4[c.chain].universalRouter;
  try {
    for (let pass = 0; ; pass++) {
      const nowSec = Math.floor(c.now() / 1000);
      const deadline = nowSec + DEADLINE_SEC;
      const cands = candidatesOf(c, token, side, payRaw, v4, classic, hops);
      const needs = (w: WalletSide, cand: Cand) => side === "sell" && (cand.spender === "permit2" ? w.erc20Allow < payRaw || w.p2Allow.amount < payRaw || w.p2Allow.expiration <= nowSec + PERMIT2_REUSE_SEC : (w.routerAllow.get(String(cand.spender).toLowerCase()) ?? 0n) < payRaw);
      // a sell has read the wallet already (to know what's held): a route whose approvals aren't on chain isn't estimated,
      // since the node can only refuse before they're mined (the old engine asked anyway, on every refresh)
      const known = side === "sell" ? await a.ctxP : undefined;
      const estimate = (cand: Cand) => (known && needs(known, cand) ? Promise.resolve(NOT_ESTIMATED) : gasOf(c, token, side, cand, deadline).catch((e: unknown) => e as Error));
      const [evaluated, ctx] = await Promise.all([
        Promise.all(cands.map(async (cand) => {
          try {
            const [q, est] = await Promise.all([cand.quote(), estimate(cand)]);
            return { c: cand, q, est };
          } catch { return undefined; }
        })),
        a.ctxP,
      ]);
      const nativeBal = ctx.nativeBal, nonce0 = Math.max(ctx.nonce, nonceFloor(c));
      const erc20Allow = ctx.erc20Allow, p2Allow = ctx.p2Allow;
      type Ev = NonNullable<(typeof evaluated)[number]>;
      const needsApproval = (e: Ev) => needs(ctx, e.c);
      for (const e of evaluated) if (e && e.est instanceof Error && side === "buy" && /insufficient funds/i.test(e.est.message)) throw new NoGas(`balance ${nativeBal} does not cover the amount plus gas`, nativeBal === 0n);
      // a sell that still needs its approvals can't be estimated (they aren't mined yet): such a candidate stands on its quote alone
      const valid = evaluated.filter((e): e is Ev => !!e && e.q.out > 0n && (typeof e.est === "bigint" || (side === "sell" && needsApproval(e))));
      if (!valid.length) return undefined;
      // a SELL is ranked by what it pays NET of the approvals it must still send (a route already approved wins a tie)
      const net = (e: Ev) => (side === "sell" && needsApproval(e) ? e.q.out - (e.c.spender === "permit2" ? 2n : 1n) * APPROVE_GAS_ASSUMED * a.maxFee : e.q.out);
      valid.sort((x, y) => (net(y) > net(x) ? 1 : net(y) < net(x) ? -1 : 0));
      const best = valid[0]!;
      // two nodes on the quote that sets the floor (a session signs it with no sheet): both answers to the read the race
      // asks anyway. Within NODES_SPREAD_BPS the higher sets the floor (a node saying less can't loosen it); farther apart one
      // of them is wrong, and the direct route steps aside (the aggregator has its own checks). A second node that didn't
      // answer in time (rpc.ts PAIR_GRACE_MS) is no floor either: one node alone never sets it (fix review RT-8)
      if (!best.q.alts.some((x) => x > 0n)) return undefined;
      const seen = [best.q.out, ...best.q.alts.filter((x) => x > 0n)];
      const hi = seen.reduce((m, x) => (x > m ? x : m)), lo = seen.reduce((m, x) => (x < m ? x : m));
      if ((hi - lo) * 10_000n > hi * BigInt(NODES_SPREAD_BPS)) return undefined;
      const out = hi, spot = best.q.spot;
      const imp = spot > 0n && out < spot ? Number(((spot - out) * 10_000n) / spot) : 0;
      if (imp > THIN_IMPACT_BPS) return undefined;   // too thin HERE: the aggregator may route a deeper venue; it says "thin" itself if it can't
      const payUsd = side === "buy" ? toNum(payRaw) * a.price : toNum(spot > 0n ? spot : out) * a.price;
      const slip = slippageBps({ liquidityUsd: a.liquidity, payUsd, impactBps: spot > 0n ? imp : undefined, impactStepBps: 1 });   // on chain, to 1 bp; no spot: not measured
      const floor = (out * BigInt(10_000 - slip)) / 10_000n;
      const call = best.c.call(floor, deadline);
      // NEVER A BUY THAT CAN'T BE SOLD: a direct pool can take buys and refuse sells (a hook; one-sided liquidity). Every direct buy is simulated with a sell of 90 % right after
      if (side === "buy") {
        const sells = await directSellsBack(c, token, best.c, call, out, deadline, classic);
        if (sells === false) return undefined;                                // the aggregator gets its turn, and its own sell check
        // NEVER A BUY THAT CAN'T BE SOLD, and never one nobody checked: no node could tell, so the buy waits (try again)
        if (sells === undefined) throw new Refusal("unchecked", "Its sell-back isn't checked yet: no market answered", "no node could simulate the sell-back");
      }
      const est = typeof best.est === "bigint" ? best.est : undefined;
      let swapGas = directSwapGas(est, best.q.gas);
      const pre: Built["pre"] = [];
      if (needsApproval(best)) {
        // EXACT amounts only (guardrail): the coin approves Permit2 for this sell, Permit2 lets the UniversalRouter take this sell, for 30 minutes
        if (best.c.spender === "permit2") {
          if (payRaw > MAX_U160) return undefined;
          if (erc20Allow < payRaw) pre.push({ to: token, data: approveToPermit2(payRaw), gas: APPROVE_GAS_FALLBACK, spender: PERMIT2 });
          if (p2Allow.amount < payRaw || p2Allow.expiration <= nowSec + PERMIT2_REUSE_SEC) pre.push({ to: PERMIT2, data: permit2ApproveRouter(token, UR, payRaw, nowSec + PERMIT2_EXPIRY_SEC), gas: PERMIT2_APPROVE_GAS, spender: UR });
        } else pre.push({ to: token, data: approveData(best.c.spender, payRaw), gas: APPROVE_GAS_FALLBACK, spender: best.c.spender });
      }

      // a trade with no estimate (a sale's approvals aren't mined yet, or the node didn't answer one): the limit comes from
      // the approvals, if any, and this swap run in one block (the test web sale, 3 Nov: the pool's figure x1.6 was past
      // the core's bound, review M6, and refused); a buy the same, from its own run (rule 3, 5 Nov)
      if (est === undefined) {
        const sv = await c.sim([...pre.map((p) => ({ from: c.d.owner, to: p.to, data: p.data })), { from: c.d.owner, to: call.to, data: call.data, value: call.value }]).catch(() => undefined);
        const used = gasUsedOf(sv?.[sv.length - 1]);
        if (used !== undefined) swapGas = fitGas(used);
      }
      // coverage audit (4 Nov): a Clanker coin's v4 pool estimated 7.49M gas for the direct path's 1-wei probe, past the cap,
      // and the whole buy was refused "The route needs far more gas than a trade does", while KyberSwap's route for the same
      // coin needs 475k. A direct route past the cap steps aside; the aggregator gets its turn (the cap itself is unchanged)
      if (swapGas > MAX_TX_GAS) return undefined;
      const gasNow = swapGas * a.maxFee + pre.reduce((n, x) => n + x.gas * a.maxFee, 0n);
      const laterSell = ceilMul((2n * APPROVE_GAS_ASSUMED + swapGas) * a.maxFee, 3n, 2n) + (a.othersGas ?? 0n);
      if (side === "buy") {
        // every buy keeps one later sale's gas (audit EVM-6), as the aggregator path does
        const need = payRaw + gasNow + laterSell;
        if (nativeBal < need) {
          if (a.isMax && pass < 2) { payRaw = nativeBal - gasNow - laterSell - nativeBal / 200n; if (payRaw > 0n) continue; }
          throw new NoGas(`balance ${nativeBal} < amount ${payRaw} + gas ${gasNow} + the later sell ${laterSell}`, nativeBal === 0n);
        }
      } else if (nativeBal < gasNow) throw new NoGas(`balance ${nativeBal} < gas ${gasNow}`, nativeBal === 0n);

      // THE FEE LINE: this transaction's own gas x the price the chain really charges (base fee + tip, capped). A buy never carries the later approve's gas
      const expectedGas = (est ?? best.q.gas) + pre.reduce((n, x) => n + (x.gas * 10n) / 13n, 0n);
      const feeRaw = expectedGas * paidPrice(a.fee, a.baseFee);
      const getUsd = side === "buy" ? (spot > 0n ? payUsd * (Number(out) / Number(spot)) : payUsd * (1 - imp / 10_000)) : toNum(out) * a.price;
      const t = c.now();
      return {
        side, token, payRaw, router: call.to, value: call.value, data: call.data, swapGas, pre, fee: a.fee, nonce: nonce0,
        quote: {
          side, chain: c.chain, coin: token, symbol: a.symbol, decimals: a.decimals, payRaw: payRaw.toString(), payUsd, getRaw: out.toString(), getUsd, getMinRaw: floor.toString(),
          feeRaw: feeRaw.toString(), feeUsd: toNum(feeRaw) * a.price, route: best.c.name, slippageBps: slip, priceImpactPct: imp / 100, expiresAt: t + a.ttl,
        },
      };
    }
  } catch (e) {
    if (e instanceof NoGas || (e instanceof Refusal && e.code === "unchecked")) throw e;   // a buy nobody could check waits; it doesn't go elsewhere
    return undefined;
  }
}
