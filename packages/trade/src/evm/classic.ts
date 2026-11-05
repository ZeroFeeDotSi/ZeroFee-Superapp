// Classic routers: Uniswap v3 SwapRouter02 (Robinhood), PancakeSwap v3 SmartRouter and the PancakeSwap v2 router (BNB
// Chain). Pools are found from the factories (getPool / getPair for the coin and the wrapped native coin), quoted with ONE
// eth_call to the official QuoterV2 (v3) or locally from the pair's reserves (v2), and the swap is built for the router:
//   v3 buy   multicall(deadline, [exactInputSingle(WETH -> coin, to the wallet)]), msg.value = the amount (the router wraps)
//   v3 sell  multicall(deadline, [exactInputSingle(coin -> WETH, to the router), unwrapWETH9(min, wallet)])   (ADDRESS_THIS = address(2))
//   v2 buy   swapExactETHForTokensSupportingFeeOnTransferTokens(min, [WBNB, coin], wallet, deadline)
//   v2 sell  swapExactTokensForETHSupportingFeeOnTransferTokens(amount, min, [coin, WBNB], wallet, deadline)
// A sell needs ONE plain approve of the router (no Permit2).
import { abiDecode, decodeCall, encodeCall } from "./abi.ts";
import { isZeroAddr, same, type Hex } from "./bytes.ts";
import { CLASSIC, type EvmChain } from "./chains.ts";
import type { Call } from "./v4.ts";

export interface ClassicPool { kind: "v3" | "v2"; address: string; fee: number; router: string; name: string }
export const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

const EXACT_IN = "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))";
const MULTICALL = "multicall(uint256,bytes[])";
const UNWRAP = "unwrapWETH9(uint256,address)";
const V2_BUY = "swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)";
const V2_SELL = "swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)";
const QUOTER = "quoteExactInputSingle((address,address,uint256,uint24,uint160))";

const addrOf = (r: unknown): string | undefined => { const h = String(r ?? ""); if (h.length < 66) return undefined; const a = "0x" + h.slice(26, 66).toLowerCase(); return isZeroAddr(a) ? undefined : a; };

/** Every classic pool pairing `token` with the wrapped native coin: one eth_call per v3 fee tier and one for v2, at once. */
export async function discoverClassic(call: Call, chain: EvmChain, token: string): Promise<ClassicPool[]> {
  const dep = CLASSIC[chain];
  const asks: Promise<ClassicPool | undefined>[] = dep.v3Fees.map(async (fee) => {
    const a = addrOf(await call(dep.v3Factory, encodeCall("getPool(address,address,uint24)", [token.toLowerCase(), dep.weth, BigInt(fee)])).catch(() => undefined));
    return a ? { kind: "v3" as const, address: a, fee, router: dep.v3Router, name: dep.v3Name } : undefined;
  });
  if (dep.v2Factory && dep.v2Router) {
    const v2Factory = dep.v2Factory, v2Router = dep.v2Router;
    asks.push((async () => {
      const a = addrOf(await call(v2Factory, encodeCall("getPair(address,address)", [token.toLowerCase(), dep.weth])).catch(() => undefined));
      return a ? { kind: "v2" as const, address: a, fee: 0, router: v2Router, name: dep.v2Name ?? "v2" } : undefined;
    })());
  }
  return (await Promise.all(asks)).filter((p): p is ClassicPool => !!p);
}

/**
 * Of a coin's v3 pools, the one holding the most wrapped native coin, as the core reads it (Security 0e3ad3f: a session
 * covers a v3 trade only on that tier, since anyone can open a thin pool at an unused tier and quote it well). `held`
 * reads one pool's wrapped balance (the caller reads it on two nodes, the lower). The v2 pair stays as it is; with no v3
 * balance readable, the v3 pools stay too (the core then shows the sheet itself).
 */
export async function deepestV3(pools: readonly ClassicPool[], held: (pool: string) => Promise<bigint | undefined>): Promise<ClassicPool[]> {
  const v3 = pools.filter((p) => p.kind === "v3");
  if (v3.length < 2) return [...pools];
  const read = await Promise.all(v3.map((p) => held(p.address).catch(() => undefined)));
  if (read.every((x) => x === undefined)) return [...pools];
  let best = -1;
  read.forEach((x, i) => { if (x !== undefined && (best < 0 || x > read[best]!)) best = i; });
  return pools.filter((p) => p.kind !== "v3" || p === v3[best]);
}

/** The v3 QuoterV2 call alone (one eth_call). `gas` is the quoter's own figure for the swap (no router overhead). */
export async function quoteV3Out(call: Call, chain: EvmChain, pool: ClassicPool, token: string, buy: boolean, amountIn: bigint): Promise<{ out: bigint; gas: bigint }> {
  const dep = CLASSIC[chain];
  const tin = buy ? dep.weth : token.toLowerCase(), tout = buy ? token.toLowerCase() : dep.weth;
  const [out, , , gas] = abiDecode(["uint256", "uint160", "uint32", "uint256"], await call(dep.v3Quoter, encodeCall(QUOTER, [[tin, tout, amountIn, BigInt(pool.fee), 0n]]))) as bigint[];
  return { out: out!, gas: gas! };
}
/** A v3 pool's sqrtPriceX96 (slot0), 0 when unreadable. */
export async function readV3Sqrt(call: Call, pool: ClassicPool): Promise<bigint> {
  const s = await call(pool.address, encodeCall("slot0()", [])).catch(() => undefined);
  return s && String(s).length >= 66 ? BigInt("0x" + String(s).slice(2, 66)) : 0n;
}
export interface V2Reserves { r0: bigint; r1: bigint }
/** A v2 pair's reserves (one eth_call): kept a block or two, every later amount is priced from them with no call. */
export async function readReserves(call: Call, pool: ClassicPool): Promise<V2Reserves> {
  const r = await call(pool.address, encodeCall("getReserves()", []));
  if (!r || String(r).length < 130) throw new Error("getReserves: short answer");
  return { r0: BigInt("0x" + String(r).slice(2, 66)), r1: BigInt("0x" + String(r).slice(66, 130)) };
}
/** The v2 router's getAmountOut, locally: constant product with the pair's fee in bps (PancakeSwap v2 = 25), the contract's integer maths. */
export function v2AmountOut(amountIn: bigint, rIn: bigint, rOut: bigint, feeBps: number): bigint {
  if (amountIn <= 0n || rIn <= 0n || rOut <= 0n) return 0n;
  const inWithFee = amountIn * BigInt(10_000 - feeBps);
  return (inWithFee * rOut) / (rIn * 10_000n + inWithFee);
}
/** A v2 quote from reserves already in hand: no network. */
export function quoteV2Local(chain: EvmChain, token: string, buy: boolean, amountIn: bigint, res: V2Reserves): { out: bigint; gas: bigint; spot: bigint } {
  const dep = CLASSIC[chain];
  const tin = buy ? dep.weth : token.toLowerCase(), tout = buy ? token.toLowerCase() : dep.weth;
  const z = tin < tout;
  const [rin, rout] = z ? [res.r0, res.r1] : [res.r1, res.r0];
  return { out: v2AmountOut(amountIn, rin, rout, dep.v2FeeBps ?? 25), gas: 150_000n, spot: rin > 0n ? (amountIn * rout) / rin : 0n };
}

export function buildClassicCall(chain: EvmChain, pool: ClassicPool, token: string, buy: boolean, wallet: string, amountIn: bigint, minOut: bigint, deadline: number): { to: string; data: Hex; value: bigint } {
  const weth = CLASSIC[chain].weth, t = token.toLowerCase(), w = wallet.toLowerCase();
  if (pool.kind === "v2") {
    return buy
      ? { to: pool.router, value: amountIn, data: encodeCall(V2_BUY, [minOut, [weth, t], w, BigInt(deadline)]) }
      : { to: pool.router, value: 0n, data: encodeCall(V2_SELL, [amountIn, minOut, [t, weth], w, BigInt(deadline)]) };
  }
  const swap = (recipient: string) => encodeCall(EXACT_IN, [[buy ? weth : t, buy ? t : weth, BigInt(pool.fee), recipient, amountIn, minOut, 0n]]);
  const calls = buy ? [swap(w)] : [swap(ADDRESS_THIS), encodeCall(UNWRAP, [minOut, w])];
  return { to: pool.router, value: buy ? amountIn : 0n, data: encodeCall(MULTICALL, [BigInt(deadline), calls]) };
}

/** Reads a classic swap back (tests, and the engine's own check of what it built). */
export function decodeClassicCall(data: string): { kind: "v3" | "v2"; buy: boolean; amountIn?: bigint; minOut: bigint; fee?: number; tokenIn: string; tokenOut: string; recipient: string; deadline: bigint } | undefined {
  try {
    const m = decodeCall(MULTICALL, data);
    if (m) {
      const [deadline, calls] = m as [bigint, string[]];
      const first = decodeCall(EXACT_IN, calls[0] ?? "0x");
      if (!first) return undefined;
      const [[tokenIn, tokenOut, fee, recipient, amountIn, minOut]] = first as [[string, string, bigint, string, bigint, bigint]];
      if (calls.length === 1) return { kind: "v3", buy: true, amountIn, minOut, fee: Number(fee), tokenIn, tokenOut, recipient, deadline };
      const u = decodeCall(UNWRAP, calls[1] ?? "0x");
      if (!u || calls.length !== 2 || !same(recipient, ADDRESS_THIS)) return undefined;
      return { kind: "v3", buy: false, amountIn, minOut, fee: Number(fee), tokenIn, tokenOut, recipient: u[1] as string, deadline };
    }
    const b = decodeCall(V2_BUY, data);
    if (b) { const [min, path, to, dl] = b as [bigint, string[], string, bigint]; return { kind: "v2", buy: true, minOut: min, tokenIn: path[0]!, tokenOut: path[1]!, recipient: to, deadline: dl }; }
    const s = decodeCall(V2_SELL, data);
    if (s) { const [amt, min, path, to, dl] = s as [bigint, bigint, string[], string, bigint]; return { kind: "v2", buy: false, amountIn: amt, minOut: min, tokenIn: path[0]!, tokenOut: path[1]!, recipient: to, deadline: dl }; }
  } catch { /* not one of ours */ }
  return undefined;
}
