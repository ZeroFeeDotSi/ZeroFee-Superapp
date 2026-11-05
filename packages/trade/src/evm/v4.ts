// Uniswap v4: a coin's native pools found on chain, quoted with ONE eth_call to the official V4Quoter, and the swap built
// for the UniversalRouter. Layouts the old engine read from the deployed contracts and checked by simulation:
//   PoolKey          (currency0, currency1, fee, tickSpacing, hooks); poolId = keccak256(abi.encode(key))
//   Initialize       Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160, int24)
//   V4Quoter         quoteExactInputSingle((PoolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) -> (amountOut, gasEstimate)
//   StateView        getSlot0(id) -> (sqrtPriceX96, tick, protocolFee, lpFee)
//   UniversalRouter  execute(commands, inputs, deadline); command 0x10 V4_SWAP, input = abi.encode(actions, params[]),
//                    actions SWAP_EXACT_IN_SINGLE 0x06, SETTLE_ALL 0x0c, TAKE_ALL 0x0f
// The native coin is currency address(0): msg.value settles a buy and TAKE_ALL pays a sell out in the native coin.
import { abiDecode, abiEncode, decodeCall, encodeCall, topicOf } from "./abi.ts";
import { keccakHex, same, type Hex } from "./bytes.ts";
import { PERMIT2, V4, ZERO, type EvmChain, type V4Deployment } from "./chains.ts";

export interface PoolKey { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }
export interface V4Pool { id: string; key: PoolKey }
export type Call = (to: string, data: string) => Promise<string>;

export const INITIALIZE_TOPIC = topicOf("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)");
/** V4TooLittleReceived(uint256,uint256): the floor in TAKE_ALL. */
export const TOO_LITTLE_RECEIVED = "0x8b063d73";
const KEY = "(address,address,uint24,int24,address)";
const QUOTE = `quoteExactInputSingle((${KEY},bool,uint128,bytes))`;
const EXECUTE = "execute(bytes,bytes[],uint256)";
const ACTIONS = "0x060c0f";            // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
const CMD_V4_SWAP = "0x10";
const MAX_U128 = (1n << 128n) - 1n;

const keyTuple = (k: PoolKey) => [k.currency0, k.currency1, BigInt(k.fee), BigInt(k.tickSpacing), k.hooks];
export const poolId = (k: PoolKey): Hex => keccakHex(abiEncode(["address", "address", "uint24", "int24", "address"], keyTuple(k)));
const topicAddr = (a: string): string => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
/** zeroForOne: the swap pays currency0. A buy pays the native coin (currency0 = address(0)); a sell pays the coin. */
export const zeroForOne = (k: PoolKey, payCurrency: string): boolean => same(k.currency0, payCurrency);

/** The getLogs filter that finds the coin's native pools (token as currency1, the native coin as currency0). */
export const initializeFilter = (chain: EvmChain, token: string, from: number, to: number) =>
  ({ address: V4[chain].poolManager, topics: [INITIALIZE_TOPIC, null, [topicAddr(ZERO)], topicAddr(token)], fromBlock: "0x" + Math.max(0, from).toString(16), toBlock: "0x" + to.toString(16) });

/**
 * Pools that pair the native coin with `token`, from the PoolManager's Initialize events: one getLogs per window, newest
 * first, the three newest windows (~35 days on Robinhood) in parallel, the rest only if they were empty.
 */
export async function discoverPools(chain: EvmChain, token: string, head: number, getLogs: (url: string, filter: object) => Promise<any[]>): Promise<V4Pool[]> {
  const dep = V4[chain];
  if (!dep.logNodes.length) return [];
  const ask = async (from: number, to: number): Promise<any[]> => {
    let lastErr: unknown;
    for (const url of dep.logNodes) {
      try { return await getLogs(url, initializeFilter(chain, token, from, to)); } catch (e) { lastErr = e; }
    }
    throw lastErr;
  };
  const wins: [number, number][] = [];
  for (let i = 0; i < dep.logWindows; i++) wins.push([head - (i + 1) * dep.logSpan + 1, head - i * dep.logSpan]);
  for (const b of [wins.slice(0, 3), wins.slice(3)]) {
    if (!b.length) continue;
    const got = (await Promise.all(b.map(([f, t]) => ask(f, t).catch(() => [] as any[])))).flat();
    if (got.length) return got.map((l) => poolOfLog(l)).filter((p): p is V4Pool => !!p);
  }
  return [];
}

/** A pool from its Initialize log; a log whose id is not keccak(key) is dropped, not trusted. */
export function poolOfLog(l: { topics: string[]; data: string }): V4Pool | undefined {
  try {
    const [fee, tickSpacing, hooks] = abiDecode(["uint24", "int24", "address", "uint160", "int24"], l.data) as [bigint, bigint, string];
    const key: PoolKey = { currency0: "0x" + l.topics[2]!.slice(26).toLowerCase(), currency1: "0x" + l.topics[3]!.slice(26).toLowerCase(), fee: Number(fee), tickSpacing: Number(tickSpacing), hooks };
    const id = poolId(key);
    return same(id, l.topics[1]) ? { id, key } : undefined;
  } catch { return undefined; }
}

export const quoteData = (pool: V4Pool, payCurrency: string, amountIn: bigint): Hex => encodeCall(QUOTE, [[keyTuple(pool.key), zeroForOne(pool.key, payCurrency), amountIn, "0x"]]);
/** The quoter call alone (one eth_call): what an amount change costs once the pool's spot price is remembered. */
export async function quoteOut(call: Call, chain: EvmChain, pool: V4Pool, payCurrency: string, amountIn: bigint): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
  if (amountIn <= 0n || amountIn > MAX_U128) throw new Error("amount out of range");
  const [amountOut, gasEstimate] = abiDecode(["uint256", "uint256"], await call(V4[chain].quoter, quoteData(pool, payCurrency, amountIn))) as [bigint, bigint];
  return { amountOut, gasEstimate };
}
/** The pool's sqrtPriceX96 (StateView.getSlot0), 0 when unreadable: it only feeds the price-impact figure, never an amount. */
export async function readSqrt(call: Call, chain: EvmChain, pool: V4Pool): Promise<bigint> {
  const s = await call(V4[chain].stateView, encodeCall("getSlot0(bytes32)", [pool.id])).catch(() => undefined);
  return s && String(s).length >= 66 ? BigInt("0x" + String(s).slice(2, 66)) : 0n;
}
/** What `amountIn` buys at the spot price, before impact and fee (from sqrtPriceX96), to read the price impact off a quote. */
export function spotFromSqrt(sqrtPriceX96: bigint, zeroForOne_: boolean, amountIn: bigint): bigint {
  if (sqrtPriceX96 <= 0n) return 0n;
  const p = sqrtPriceX96 * sqrtPriceX96;
  return zeroForOne_ ? (amountIn * p) >> 192n : (amountIn << 192n) / p;
}

/** UniversalRouter.execute(V4_SWAP): one exact-in swap through ONE pool, paid to the caller. `minOut` is enforced on chain (TAKE_ALL). */
export function buildSwapCall(dep: V4Deployment, pool: V4Pool, payCurrency: string, amountIn: bigint, minOut: bigint, deadlineSec: number): { to: string; data: Hex; value: bigint } {
  const z = zeroForOne(pool.key, payCurrency);
  const outCurrency = z ? pool.key.currency1 : pool.key.currency0;
  const swap = abiEncode([`(${KEY},bool,uint128,uint128,bytes)`], [[keyTuple(pool.key), z, amountIn, minOut, "0x"]]);
  const settle = abiEncode(["address", "uint256"], [payCurrency.toLowerCase(), amountIn]);
  const take = abiEncode(["address", "uint256"], [outCurrency, minOut]);
  const input = abiEncode(["bytes", "bytes[]"], [ACTIONS, [swap, settle, take]]);
  return { to: dep.universalRouter, data: encodeCall(EXECUTE, [CMD_V4_SWAP, [input], BigInt(deadlineSec)]), value: same(payCurrency, ZERO) ? amountIn : 0n };
}

/** Reads a V4_SWAP back (tests, and the engine's own check of what it built). Undefined unless it is exactly [V4_SWAP] with [SWAP, SETTLE_ALL, TAKE_ALL]. */
export function decodeSwapCall(data: string): { poolKey: PoolKey; zeroForOne: boolean; amountIn: bigint; minOut: bigint; settleCurrency: string; settleMax: bigint; takeCurrency: string; takeMin: bigint; deadline: bigint } | undefined {
  try {
    const a = decodeCall(EXECUTE, data);
    if (!a) return undefined;
    const [commands, inputs, deadline] = a as [string, string[], bigint];
    if (commands !== CMD_V4_SWAP || inputs.length !== 1) return undefined;
    const [actions, params] = abiDecode(["bytes", "bytes[]"], inputs[0]!) as [string, string[]];
    if (actions !== ACTIONS || params.length !== 3) return undefined;
    const [[k, z, amountIn, minOut]] = abiDecode([`(${KEY},bool,uint128,uint128,bytes)`], params[0]!) as [[[string, string, bigint, bigint, string], boolean, bigint, bigint, string]];
    const [sc, sm] = abiDecode(["address", "uint256"], params[1]!) as [string, bigint];
    const [tc, tm] = abiDecode(["address", "uint256"], params[2]!) as [string, bigint];
    return { poolKey: { currency0: k[0], currency1: k[1], fee: Number(k[2]), tickSpacing: Number(k[3]), hooks: k[4] }, zeroForOne: z, amountIn, minOut, settleCurrency: sc, settleMax: sm, takeCurrency: tc, takeMin: tm, deadline };
  } catch { return undefined; }
}

/** A sell pays an ERC-20: the UniversalRouter pulls it through Permit2, so the wallet needs token.approve(Permit2) and Permit2.approve(token, router, amount, expiry). */
export const approveData = (spender: string, amount: bigint): Hex => encodeCall("approve(address,uint256)", [spender.toLowerCase(), amount]);
export const approveToPermit2 = (amount: bigint): Hex => approveData(PERMIT2, amount);
export const permit2ApproveRouter = (token: string, router: string, amount: bigint, expirySec: number): Hex => encodeCall("approve(address,address,uint160,uint48)", [token.toLowerCase(), router.toLowerCase(), amount, BigInt(expirySec)]);
export const allowanceData = (owner: string, spender: string): Hex => encodeCall("allowance(address,address)", [owner.toLowerCase(), spender.toLowerCase()]);
export const permit2AllowanceData = (owner: string, token: string, router: string): Hex => encodeCall("allowance(address,address,address)", [owner.toLowerCase(), token.toLowerCase(), router.toLowerCase()]);
export function decodePermit2Allowance(hex: string): { amount: bigint; expiration: number } {
  const [amount, expiration] = abiDecode(["uint160", "uint48", "uint48"], hex) as [bigint, bigint];
  return { amount, expiration: Number(expiration) };
}
