// Two hops through a middle coin (coverage audit gap 5, the review's ruling 4 Nov): a coin whose market is quoted in the
// chain's dollar coin (Robinhood Chain's PONS: $58.7M in a Uniswap v4 pool against USDG, and no pool against ETH) is
// traded in ONE UniversalRouter transaction:
//   buy   [WRAP_ETH, V3_SWAP_EXACT_IN, V4_SWAP]  all the ETH sent is wrapped into the router; the router swaps it for the
//         middle coin in the deepest v3 WETH/middle pool and keeps it; the v4 swap settles all of it, swaps all that credit
//         for the coin and pays the coin to the wallet (TAKE_ALL, the floor);
//   sell  [V4_SWAP, V3_SWAP_EXACT_IN, UNWRAP_WETH]  the v4 swap sells the coin (Permit2, as any v4 sale) for the middle coin
//         and leaves it with the router; the router swaps all it holds for WETH and unwraps it to the wallet (the floor).
// The core reads exactly these shapes (core evm/decode.ts twoHopBuy / twoHopSell) and signs with no sheet only through a
// middle coin it pins (core evm/middle-coins.ts), with the middle balance unchanged and the reference band end to end.
import { abiEncode, encodeCall } from "./abi.ts";
import type { Hex } from "./bytes.ts";
import { CLASSIC, V4, ZERO, type EvmChain } from "./chains.ts";
import type { ClassicPool } from "./classic.ts";
import { INITIALIZE_TOPIC, poolOfLog, zeroForOne, type PoolKey, type V4Pool } from "./v4.ts";

/** The middle coins Trade routes through, per chain (each also pinned in the core's middle-coins.ts; a test holds them
 *  equal). BNB Chain: none yet (its UniversalRouter's v3 hop is Uniswap's, Trade's v3 there is PancakeSwap's). */
export const MIDS: Record<EvmChain, readonly { coin: string; symbol: string }[]> = {
  hood: [{ coin: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG" }],
  bsc: [],
};

/** One two-hop route: the middle coin, its deepest v3 pool with the wrapped native coin, and the coin's v4 pool with it. */
export interface HopRoute { mid: string; v3: ClassicPool; v4: V4Pool }

export const ROUTER_SELF = "0x0000000000000000000000000000000000000002";
export const CONTRACT_BALANCE = 1n << 255n;
const KEY = "(address,address,uint24,int24,address)";
const EXECUTE = "execute(bytes,bytes[],uint256)";
/** V3_SWAP_EXACT_IN's input on these chains' UniversalRouter (2.1: a sixth field, minHopPriceX36, read off its own swaps on
 *  Robinhood Chain, 4 Nov; the five-field input reverts SliceOutOfBounds): recipient, amountIn, amountOutMin, path,
 *  payerIsUser, and the per-hop price floors (none: the trade's own floor is the last step's). */
const V3_IN = ["address", "uint256", "uint256", "bytes", "bool", "uint256[]"];
/** v4 SWAP_EXACT_IN's params on this periphery: (currencyIn, PathKey[] path, uint256[] minHopPriceX36, amountIn, amountOutMinimum),
 *  a PathKey being (intermediateCurrency, fee, tickSpacing, hooks, hookData) (read off its own swaps, 4 Nov). */
const EXACT_IN = "(address,(address,uint24,int24,address,bytes)[],uint256[],uint128,uint128)";
const keyTuple = (k: PoolKey) => [k.currency0, k.currency1, BigInt(k.fee), BigInt(k.tickSpacing), k.hooks];
const topicAddr = (a: string): string => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
/** A v3 path of one hop: token(20) fee(3) token(20). */
export const v3Path = (from: string, fee: number, to: string): Hex => ("0x" + from.slice(2).toLowerCase() + fee.toString(16).padStart(6, "0") + to.slice(2).toLowerCase()) as Hex;

/** The getLogs filter for the v4 pools pairing `token` with `mid` (currency0 is the lower address). */
export function midFilter(chain: EvmChain, token: string, mid: string, from: number, to: number) {
  const [a, b] = [token.toLowerCase(), mid.toLowerCase()].sort();
  return { address: V4[chain].poolManager, topics: [INITIALIZE_TOPIC, null, topicAddr(a!), topicAddr(b!)], fromBlock: "0x" + Math.max(0, from).toString(16), toBlock: "0x" + to.toString(16) };
}

/** The coin's v4 pools with `mid`, from the PoolManager's Initialize logs (the same windows as the native pools). */
export async function discoverMidPools(chain: EvmChain, token: string, mid: string, head: number, getLogs: (url: string, filter: object) => Promise<any[]>): Promise<V4Pool[]> {
  const dep = V4[chain];
  if (!dep.logNodes.length || token.toLowerCase() === mid.toLowerCase() || token.toLowerCase() === ZERO) return [];
  const ask = async (from: number, to: number): Promise<any[]> => {
    let lastErr: unknown;
    for (const url of dep.logNodes) {
      try { return await getLogs(url, midFilter(chain, token, mid, from, to)); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };
  const wins: [number, number][] = [];
  for (let i = 0; i < dep.logWindows; i++) wins.push([head - (i + 1) * dep.logSpan + 1, head - i * dep.logSpan]);
  // a window that failed is unread, not empty: with every window failed (the official node's 429 right after the native
  // pools' scan, measured 4 Nov) the lookup throws, so it is never remembered as "no pool"
  let failed = 0;
  for (const b of [wins.slice(0, 3), wins.slice(3)]) {
    if (!b.length) continue;
    const got = (await Promise.all(b.map(([f, t]) => ask(f, t).catch(() => { failed++; return [] as any[]; })))).flat();
    if (got.length) return got.map((l) => poolOfLog(l)).filter((p): p is V4Pool => !!p);
  }
  if (failed === wins.length) throw new Error("no node answered the middle coin's pool lookup");
  return [];
}

/** The buy: all of `amountIn` native through the middle coin to the coin, the coin paid to the wallet, at least `minOut`. */
export function buildTwoHopBuy(chain: EvmChain, r: HopRoute, coin: string, amountIn: bigint, minOut: bigint, deadlineSec: number): { to: string; data: Hex; value: bigint } {
  const weth = CLASSIC[chain].weth, mid = r.mid.toLowerCase();
  const wrap = abiEncode(["address", "uint256"], [ROUTER_SELF, amountIn]);
  const v3 = abiEncode(V3_IN, [ROUTER_SELF, amountIn, 0n, v3Path(weth, r.v3.fee, mid), false, []]);
  const settle = abiEncode(["address", "uint256", "bool"], [mid, CONTRACT_BALANCE, false]);
  // SWAP_EXACT_IN with one PathKey and amountIn OPEN_DELTA (all the credit SETTLE made): the form this periphery takes for an
  // open amount (read off its own swaps on Robinhood Chain; the single-pool action with OPEN_DELTA reverts there)
  const k = r.v4.key, out_ = coin.toLowerCase();
  const swap = abiEncode([EXACT_IN], [[mid, [[out_, BigInt(k.fee), BigInt(k.tickSpacing), k.hooks, "0x"]], [], 0n, minOut]]);
  const take = abiEncode(["address", "uint256"], [out_, minOut]);
  const v4 = abiEncode(["bytes", "bytes[]"], ["0x0b070f", [settle, swap, take]]);
  return { to: V4[chain].universalRouter, data: encodeCall(EXECUTE, ["0x0b0010", [wrap, v3, v4], BigInt(deadlineSec)]), value: amountIn };
}

/** The sale: `amountIn` of the coin through the middle coin to the native coin, unwrapped to `wallet`, at least `minOut`. */
export function buildTwoHopSell(chain: EvmChain, r: HopRoute, coin: string, wallet: string, amountIn: bigint, minOut: bigint, deadlineSec: number): { to: string; data: Hex; value: bigint } {
  const weth = CLASSIC[chain].weth, mid = r.mid.toLowerCase(), c = coin.toLowerCase();
  // as this periphery's own sales go (read off them): SWAP_EXACT_IN of exactly amountIn, SETTLE that amount from the wallet
  // (through Permit2), TAKE all the middle coin's credit to the router
  const k = r.v4.key;
  const swap = abiEncode([EXACT_IN], [[c, [[mid, BigInt(k.fee), BigInt(k.tickSpacing), k.hooks, "0x"]], [], amountIn, 0n]]);
  const settle = abiEncode(["address", "uint256", "bool"], [c, amountIn, true]);
  const take = abiEncode(["address", "address", "uint256"], [mid, ROUTER_SELF, 0n]);
  const v4 = abiEncode(["bytes", "bytes[]"], ["0x070b0e", [swap, settle, take]]);
  const v3 = abiEncode(V3_IN, [ROUTER_SELF, CONTRACT_BALANCE, minOut, v3Path(mid, r.v3.fee, weth), false, []]);
  const unwrap = abiEncode(["address", "uint256"], [wallet.toLowerCase(), minOut]);
  return { to: V4[chain].universalRouter, data: encodeCall(EXECUTE, ["0x10000c", [v4, v3, unwrap], BigInt(deadlineSec)]), value: 0n };
}
