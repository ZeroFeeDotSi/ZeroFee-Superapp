// What the three paths (direct.ts, native.ts, aggregator.ts) share: the engine's deps, one engine's caches, the wallet's
// side of a trade (balances, nonce, allowances), the fee snapshot, and the errors the paths throw before they become a
// TradeError. One engine per chain and trading wallet: nothing is global, so two wallets never share state.
import { abiDecode, encodeCall } from "./abi.ts";
import { bigOf, hexBig, word, type Hex } from "./bytes.ts";
import { BalanceMemory } from "../balances.ts";
import { CHAINS, CLASSIC, PERMIT2, V4, type EvmChain } from "./chains.ts";
import { TradeError } from "../errors.ts";
import type { LCall, SimCall, SimResult, Simulate } from "./launchpads.ts";
import { ChainSaid, medianRead, NodeDown, read, readPair, type EvmRpc, type NodeAnswer } from "./rpc.ts";
import type { Amount, CoinMeta, Quote, Side } from "../types.ts";
import { allowanceData, decodePermit2Allowance, permit2AllowanceData } from "./v4.ts";
import { cleanLabel } from "../market/map.ts";
export type { Amount, CoinMeta, Side };

export interface EvmDeps {
  chain: EvmChain;
  rpc: EvmRpc;
  /** The trading wallet (0x…): it pays the gas and holds the coins. */
  owner: string;
  /** The chain's native coin (BNB, ETH) in dollars. */
  nativeUsd(): Promise<number>;
  /** Market data for a coin. Display, slippage and the pool guards; never the amount a trade moves. */
  meta?(coin: string): Promise<CoinMeta | undefined>;
  fetch?: typeof fetch;
  now(): number;
  /** How long a quote is shown before it is prepared again (old engine: 15 s). */
  quoteTtlMs: number;
}

export const QUOTE_TTL_MS = 15_000;
export const DEADLINE_SEC = 120;
export const APPROVE_GAS_FALLBACK = 100_000n;
export const PERMIT2_APPROVE_GAS = 90_000n;
export const APPROVE_GAS_ASSUMED = 70_000n;
export const ASSUMED_BUY_GAS = 600_000n;
export const ASSUMED_SELL_GAS = 700_000n;
/** A buy whose price impact is above this (20 %) is refused as too thin; the direct path gives way to the aggregator instead. */
export const THIN_IMPACT_BPS = 2000;
/** A curve SELL is refused as thin only past 60 %: a fresh curve's whole-bag exit can lose 20–40 % to its own depth, and it is the only way out. */
export const SELL_THIN_IMPACT_BPS = 6000;
/** Never under-priced: the fee cap and the tip are the nodes' own suggestion + 20 %. */
export const SPEED_NUM = 6n, SPEED_DEN = 5n;
/**
 * A Permit2 allowance lives this long (guardrail: exact amount, short expiry; the old engine gave 30 days). It is only ever
 * the amount of this one sell, and an allowance with less than PERMIT2_REUSE_SEC left is approved again.
 */
export const PERMIT2_EXPIRY_SEC = 1_800;
export const PERMIT2_REUSE_SEC = 600;
export const MAX_U160 = (1n << 160n) - 1n;
/** Remembered between amount changes (old engine): price 30 s (stale up to 10 min while it refreshes), fee snapshot 45 s, market data 2 min, a swap's gas 10 min,
 *  a pool's spot price 4 s (1 min stale), a v2 pair's reserves 1.5 s (BNB Chain makes a block every ~0.45 s), the wallet's side 4 s. */
/** The native coin's price is a dollar buy's size (audit MKT-1, fix review RT-3): kept 30 s, served while a new one is read
 *  for 30 s more, never past a minute; older, the buy waits for a checked price, and one refused sizes nothing. */
export const PRICE_TTL_MS = 30_000, PRICE_SWR_MS = 30_000, FEE_TTL_MS = 45_000, FEE_SWR_MS = 600_000, DMETA_TTL_MS = 120_000, DMETA_SWR_MS = 3_600_000;
export const GAS_TTL_MS = 600_000, SPOT_TTL_MS = 4_000, SPOT_SWR_MS = 60_000, RESERVES_TTL_MS = 1_500, CTX_TTL_MS = 4_000;
export const POOL_TTL_MS = 600_000, NO_POOL_TTL_MS = 120_000;
/** A nonce handed to a sent transaction is never handed out again for this long (a node's pending count can lag the broadcast). */
export const NONCE_MEMORY_MS = 90_000;

export const ceilMul = (n: bigint, num: bigint, den: bigint): bigint => (n * num + den - 1n) / den;
/** Dollars -> wei of the native coin (the old engine's rounding: micro-dollars over micro-dollar price). */
export const wei = (usd: number, price: number): bigint => (BigInt(Math.floor(usd * 1e6)) * 10n ** 18n) / BigInt(Math.max(1, Math.floor(price * 1e6)));
export const toNum = (raw: bigint, dec = 18): number => Number(raw) / 10 ** dec;
export const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => { t = setTimeout(() => r(undefined), ms); })]).finally(() => clearTimeout(t));
};

// ---- errors inside the engine (they become a TradeError at prepare's edge: toTradeError) ----------------------------------
/** The wallet can't pay the amount and the gas (or, a sell, the gas). `empty` = it holds no native coin at all. */
export class NoGas extends Error {
  readonly empty: boolean;
  constructor(message: string, empty = false) { super(message); this.name = "NoGas"; this.empty = empty; }
}
/** How long a sell-back verdict is kept: yes 5 min, no 2 min, no verdict 1 min. */
export const sellTtl = (ok: boolean | undefined): number => (ok === true ? 300_000 : ok === false ? 120_000 : 60_000);

/** `different`: the route isn't worth what its price says, by our own price (audit EVM-4). */
/** `unpriced`: no price for the coin to check the aggregator's route against, neither the market's nor a pool's (RT-2a). */
export type RefusalCode = "no-route" | "unsellable" | "unchecked" | "reverted" | "thin" | "no-balance" | "moved" | "unsafe" | "different" | "unpriced";
/** A path's own refusal: the next path may still trade the coin (a curve that refuses gives way to the AMM, then the aggregator). */
export class Refusal extends Error {
  readonly code: RefusalCode;
  constructor(code: RefusalCode, message: string, detail?: string) { super(detail ? `${message} (${detail})` : message); this.name = "Refusal"; this.code = code; }
}

/** A revert that means the PRICE moved past the floor. Never a bare "price": "insufficient funds for gas * price + value" or "transaction underpriced" is not one,
 *  and an allowance revert ("STF", "transfer amount exceeds allowance") is a refusal (old engine, live: six "STF" sell reverts all read "price moved").
 *  Custom errors by selector: V4TooLittleReceived, the UniversalRouter's V3 / V2TooLittleReceived(), TooLittleReceived(), InsufficientOutputAmount(). */
export const PRICE_REVERT = /return amount|too little received|insufficient.?output|min.?return|amountOutMin|slippage|PriceLimit|TooLittleReceived|0x8b063d73|0x39d35496|0x849eaf98|0xc9f52c71|0x42301c23/i;
export const revertKind = (reason: string): "moved" | "refused" => (PRICE_REVERT.test(reason) ? "moved" : "refused");

/** Any error -> the TradeError the service sees. The words are for tests and "More", never the main line. */
export function toTradeError(e: unknown, side: Side): TradeError {
  if (e instanceof TradeError) return e;
  if (e instanceof NoGas) return new TradeError("funds", side === "buy" ? "Not enough for this buy and its network fee" : "Not enough for the network fee", e.empty ? "wallet-empty" : "sol-low");
  if (e instanceof Refusal) {
    switch (e.code) {
      case "no-balance": return new TradeError("funds", e.message, "coin-low");
      case "thin": return new TradeError("unavailable", e.message, "thin");
      case "different": return new TradeError("unavailable", e.message, "not-this-swap");
      case "unpriced": return new TradeError("unavailable", e.message, "unpriced");
      case "unsellable": return new TradeError("unsellable", e.message);
      case "unchecked": return new TradeError("unavailable", e.message, "unchecked");
      case "moved": return new TradeError("moved", e.message);
      default: return new TradeError("unavailable", e.message);
    }
  }
  if (e instanceof ChainSaid && /insufficient funds/i.test(e.message)) return new TradeError("funds", side === "buy" ? "Not enough for this buy and its network fee" : "Not enough for the network fee", "sol-low");
  if (e instanceof NodeDown) return new TradeError("node", "The network did not answer");
  if (e && (e as Error).name === "KyberError") return (e as { hard?: boolean }).hard ? new TradeError("unavailable", "No route for this coin right now") : new TradeError("node", "The swap service did not answer");
  if (e && (e as Error).name === "UnsafeRouteError") return new TradeError("unavailable", "The route built a transaction this wallet will not sign");
  if (e instanceof Error && /insufficient funds/i.test(e.message)) return new TradeError("funds", side === "buy" ? "Not enough for this buy and its network fee" : "Not enough for the network fee", "sol-low");
  return new TradeError("unavailable", "This coin can't be traded right now");
}

// ---- one engine's memory -------------------------------------------------------------------------------------------------
export type Slot<T> = { at: number; v?: T; p?: Promise<T> };
/** One value per key: fresh inside `ttl`; inside `ttl + swr` handed back at once while a refresh runs in the background; older = awaited. A failed load is never kept. */
export function memo<T>(now: () => number, m: Map<string, Slot<T>>, key: string, ttl: number, load: () => Promise<T>, swr = 0): Promise<T> {
  let s = m.get(key);
  if (!s) { s = { at: 0 }; m.set(key, s); }
  const slot = s;
  const age = now() - slot.at;
  const refresh = (): Promise<T> => (slot.p ??= load().then((v) => { slot.v = v; slot.at = now(); return v; }).finally(() => { slot.p = undefined; }));
  if (slot.v !== undefined && age < ttl) return Promise.resolve(slot.v);
  if (slot.v !== undefined && age < ttl + swr) { void refresh().catch(() => undefined); return Promise.resolve(slot.v); }
  return refresh();
}

export interface Fee { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; baseFee: bigint }
export interface WalletSide { nativeBal: bigint; nonce: number; tokenBal?: bigint; erc20Allow: bigint; p2Allow: { amount: bigint; expiration: number }; routerAllow: Map<string, bigint> }

export interface Memo {
  price: Map<string, Slot<number>>; tmeta: Map<string, Slot<{ decimals: number; symbol?: string }>>; dmeta: Map<string, Slot<CoinMeta | null>>;
  fee: Map<string, Slot<Fee>>; ctx: Map<string, Slot<WalletSide>>; gas: Map<string, Slot<bigint>>; spot: Map<string, Slot<bigint>>; reserves: Map<string, Slot<{ r0: bigint; r1: bigint; alt?: { r0: bigint; r1: bigint }[] }>>;
  venue: Map<string, Slot<any>>; pools: Map<string, { at: number; pools: any[] }>; classic: Map<string, { at: number; pools: any[] }>;
  /** NEVER A BUY THAT CAN'T BE SOLD: the sell-back verdict per coin (5 min yes, 2 min no). */
  /** Can a buy of this coin be sold back? ok undefined: no node could tell (asked again in a minute; such a buy waits). */
  sell: Map<string, { at: number; ok?: boolean }>;
  /** A direct route the node refused for real on a buy: left out for 60 s. */
  refused: Map<string, number>;
  /** The last nonce a sent transaction used, so a lagging node's pending count is never believed below it. */
  used?: { n: number; at: number };
  /** Proofs (simulations of the exact steps), per side and coin. */
  sims: Map<string, { at: number; p: Promise<void>; ok?: boolean; failed?: unknown }>; provedAt: Map<string, number>;
  /** The floor of the last quote per side and coin: the re-quote after "the price moved" must still clear it. */
  floors: Map<string, { pay: bigint; floor: bigint; at: number }>;
  /** Every coin this engine prepared, filled or was told about: what holdings() reads. */
  seen: Set<string>;
  kyberAsk: Map<string, { at: number; ref?: { pay: bigint; out: bigint; fee: number; at: number } }>;
}
export const newMemo = (): Memo => ({
  price: new Map(), tmeta: new Map(), dmeta: new Map(), fee: new Map(), ctx: new Map(), gas: new Map(), spot: new Map(), reserves: new Map(), venue: new Map(),
  pools: new Map(), classic: new Map(), sell: new Map(), refused: new Map(), sims: new Map(), provedAt: new Map(), floors: new Map(), seen: new Set(), kyberAsk: new Map(),
});

/** What every path is handed. */
export interface Ctx {
  d: EvmDeps; m: Memo; memory: BalanceMemory; chain: EvmChain; wallet: string;
  now(): number;
  /** The quote path's read: raced over two nodes. A revert is thrown as ChainSaid. */
  rpc(method: string, params: unknown[]): Promise<any>;
  /** eth_call [{ to, data, value?, from? }, "latest"]. */
  call: LCall;
  /** The same eth_call, with both nodes' answers kept (rpc.readPair): the first, then the other's if it came in time. */
  callPair(to: string, data: string, value?: bigint, from?: string): Promise<string[]>;
  /** eth_simulateV1 (traceTransfers); undefined when no node answers it. */
  sim: Simulate;
}

/** How far after the first a simulation's later block is, in blocks and seconds: past a same-block or short cooldown, and
 *  inside a swap's DEADLINE_SEC (the node fills the blocks between, each a little later, so the gap stays small). */
export const LATER_BLOCKS = 5, LATER_BLOCK_SEC = 90;

export function makeCtx(d: EvmDeps, m: Memo, memory: BalanceMemory): Ctx {
  const rpc = (method: string, params: unknown[]) => read(d.rpc, method, params);
  const call: LCall = async (to, data, value, from) => rpc("eth_call", [{ to, data, ...(value ? { value: hexBig(value) } : {}), ...(from ? { from } : {}) }, "latest"]) as Promise<string>;
  const callPair = async (to: string, data: string, value?: bigint, from?: string): Promise<string[]> => readPair(d.rpc, "eth_call", [{ to, data, ...(value ? { value: hexBig(value) } : {}), ...(from ? { from } : {}) }, "latest"]);
  const sim: Simulate = async (calls: SimCall[], later?: SimCall[]) => {
    const enc = (cs: SimCall[]) => cs.map((c) => ({ from: c.from, to: c.to, data: c.data, ...(c.value ? { value: hexBig(c.value) } : {}) }));
    if (!later?.length) {
      const r = await rpc("eth_simulateV1", [{ blockStateCalls: [{ calls: enc(calls) }], traceTransfers: true, validation: false }, "latest"]);
      const out = Array.isArray(r) ? r[0]?.calls : undefined;
      return Array.isArray(out) && out.length === calls.length ? (out as SimResult[]) : undefined;
    }
    // the later block LATER_BLOCKS blocks and LATER_BLOCK_SEC seconds after the first, both counted from one block the
    // simulation starts at (read first, so the numbers and times are in order on the node that runs it)
    const head = await rpc("eth_getBlockByNumber", ["latest", false]) as { number?: string; timestamp?: string } | null;
    if (!head?.number || !head.timestamp) return undefined;
    const n0 = Number(BigInt(head.number)), t0 = Number(BigInt(head.timestamp)), hx = (v: number) => "0x" + v.toString(16);
    const blocks = [
      { blockOverrides: { number: hx(n0 + 1), time: hx(t0 + 1) }, calls: enc(calls) },
      { blockOverrides: { number: hx(n0 + 1 + LATER_BLOCKS), time: hx(t0 + 1 + LATER_BLOCK_SEC) }, calls: enc(later) },
    ];
    const r = await rpc("eth_simulateV1", [{ blockStateCalls: blocks, traceTransfers: true, validation: false }, head.number]);
    const out = Array.isArray(r) ? r.flatMap((b: { calls?: unknown[] }) => (Array.isArray(b?.calls) ? b.calls : [])) : undefined;
    return Array.isArray(out) && out.length === calls.length + (later?.length ?? 0) ? (out as SimResult[]) : undefined;
  };
  return { d, m, memory, chain: d.chain, wallet: d.owner.toLowerCase(), now: d.now, rpc, call, callPair, sim };
}

// ---- the slow-changing reads ---------------------------------------------------------------------------------------------
export const priceFor = (c: Ctx): Promise<number> => memo(c.now, c.m.price, c.chain, PRICE_TTL_MS, () => c.d.nativeUsd(), PRICE_SWR_MS);

/** decimals() and symbol() from the coin itself (decimals formats every amount: never guessed). */
export const metaFor = (c: Ctx, token: string) => memo(c.now, c.m.tmeta, token, Infinity, async () => {
  const [dec, sym] = await Promise.all([c.rpc("eth_call", [{ to: token, data: encodeCall("decimals()", []) }, "latest"]), c.rpc("eth_call", [{ to: token, data: encodeCall("symbol()", []) }, "latest"]).catch(() => undefined)]);
  const decimals = Number(bigOf(dec, "decimals"));
  if (!(decimals >= 0 && decimals <= 36)) throw new Refusal("reverted", "ZeroFee can't trade this coin right now", `decimals ${decimals}`);
  let symbol: string | undefined;
  try { symbol = abiDecode(["string"], sym as Hex)[0] as string; } catch {
    try { symbol = new TextDecoder().decode(Uint8Array.from((String(sym).slice(2, 66).match(/../g) ?? []).map((b) => parseInt(b, 16)))).replace(/\0+$/g, ""); } catch { /* none */ }
  }
  // the coin's own symbol, with every format character (right-to-left override, zero-width) and control character out
  const clean = Array.from(cleanLabel(symbol)).slice(0, 24).join("");
  return { decimals, ...(clean ? { symbol: clean } : {}) };
});

/** Market data: waited for at most 800 ms once, then handed back from memory while it refreshes. Never an input to an amount. */
export const dmetaFor = (c: Ctx, token: string) => memo(c.now, c.m.dmeta, token, DMETA_TTL_MS, async () => (c.d.meta ? (await withTimeout(c.d.meta(token), 800)) ?? null : null), DMETA_SWR_MS);

/**
 * The chain's fee inputs, one snapshot: the latest block's base fee, and the gas price and tip as the median of three
 * nodes. maxFeePerGas = baseFee x 1.25 + tip (two full base-fee rises), never under the node's own gas price (BNB Chain
 * reports a base fee of 0 but enforces a minimum price). Robinhood (Arbitrum) takes no tip.
 */
export const feeFor = (c: Ctx): Promise<Fee> => memo(c.now, c.m.fee, c.chain, FEE_TTL_MS, async () => {
  const info = CHAINS[c.chain];
  const [block, tipRaw, gasPriceRaw] = await Promise.all([
    c.rpc("eth_getBlockByNumber", ["latest", false]),
    medianRead(c.d.rpc, "eth_maxPriorityFeePerGas").then((v) => v ?? 0n, () => 0n),
    medianRead(c.d.rpc, "eth_gasPrice").then((v) => v ?? 0n, () => 0n),
  ]);
  const baseFee: bigint | undefined = block?.baseFeePerGas === undefined ? undefined : bigOf(block.baseFeePerGas, "baseFeePerGas");
  if (baseFee === undefined) {
    // a node with no EIP-1559 block: the gas price + 10 % as both cap and tip (a legacy price, in a type-2 transaction)
    const gp = ceilMul(gasPriceRaw, 110n, 100n);
    return { maxFeePerGas: gp, maxPriorityFeePerGas: gp, baseFee: 0n };
  }
  const tip = info.zeroTip ? 0n : tipRaw > info.minTip ? tipRaw : info.minTip;
  let maxFeePerGas = ceilMul(baseFee * 125n, 1n, 100n) + tip;
  if (gasPriceRaw > maxFeePerGas) maxFeePerGas = gasPriceRaw;
  return { maxFeePerGas, maxPriorityFeePerGas: tip, baseFee };
}, FEE_SWR_MS);

/** What a transaction really pays per gas: the base fee + the tip, never above the cap. The fee line uses this, not the cap. */
export const paidPrice = (f: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, baseFee: bigint): bigint =>
  f.maxFeePerGas < baseFee + f.maxPriorityFeePerGas ? f.maxFeePerGas : baseFee + f.maxPriorityFeePerGas;

/**
 * The nonce: the pending count from TWO nodes, the higher one (a node that hasn't seen our last send says less), never below
 * a nonce this engine already sent (nonceFloor). The second node is waited for at most NONCE_WAIT_MS after the call; with one
 * answer only, that one is used; with none, the ordinary failover read.
 */
export const NONCE_WAIT_MS = 2_000;
export async function nonceOf(c: Ctx): Promise<number> {
  const got: NodeAnswer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    c.d.rpc.askNodes("eth_getTransactionCount", [c.d.owner, "pending"], 2, { until: (x) => { got.push(x); return false; } }).then((a) => { for (const x of a) if (!got.includes(x)) got.push(x); }),
    new Promise<void>((r) => { timer = setTimeout(r, NONCE_WAIT_MS); }),
  ]).finally(() => clearTimeout(timer));
  const vals = got.filter((x) => x.ok).map((x) => { try { return Number(bigOf((x as { value: unknown }).value, "eth_getTransactionCount")); } catch { return -1; } }).filter((n) => n >= 0);
  if (!vals.length) {
    const said = got.find((x) => !x.ok && x.said);
    if (said && !said.ok) throw new ChainSaid(said.error);
    return Number(bigOf(await c.d.rpc.call("eth_getTransactionCount", [c.d.owner, "pending"]), "eth_getTransactionCount"));
  }
  return Math.max(...vals);
}
export const nonceFloor = (c: Ctx): number => (c.m.used && c.now() - c.m.used.at < NONCE_MEMORY_MS ? c.m.used.n : 0);

/** The wallet's side of the trade: balances, the pending nonce and (a sell) the allowances. Reused for CTX_TTL_MS; an older one is read again in the same round trip as the quote. */
export const ctxFor = (c: Ctx, token: string, side: Side): Promise<WalletSide> => memo(c.now, c.m.ctx, `${token}:${side}`, CTX_TTL_MS, async () => {
  const sell = side === "sell", dep = V4[c.chain], cl = CLASSIC[c.chain], w = c.wallet;
  const spenders = [...new Set([cl.v3Router, cl.v2Router].filter((x): x is string => !!x).map((x) => x.toLowerCase()))];
  const allowOf = (sp: string) => c.rpc("eth_call", [{ to: token, data: allowanceData(w, sp) }, "latest"]).then((r: unknown) => bigOf(r, "allowance")).catch(() => 0n);
  const [bal, nonce, tokenRaw, erc20Allow, p2Allow, routers] = await Promise.all([
    c.rpc("eth_getBalance", [c.d.owner, "latest"]),
    nonceOf(c),
    sell ? c.rpc("eth_call", [{ to: token, data: "0x70a08231" + word(w) }, "latest"]) : Promise.resolve(undefined),
    sell ? c.rpc("eth_call", [{ to: token, data: allowanceData(w, PERMIT2) }, "latest"]).then((r: unknown) => bigOf(r, "allowance")).catch(() => 0n) : Promise.resolve(0n),
    sell ? c.rpc("eth_call", [{ to: PERMIT2, data: permit2AllowanceData(w, token, dep.universalRouter) }, "latest"]).then((r: unknown) => decodePermit2Allowance(r as string)).catch(() => ({ amount: 0n, expiration: 0 })) : Promise.resolve({ amount: 0n, expiration: 0 }),
    sell ? Promise.all(spenders.map(async (sp) => [sp, await allowOf(sp)] as const)) : Promise.resolve([] as (readonly [string, bigint])[]),
  ]);
  const t = c.now();
  const nativeBal = c.memory.fix(BalanceMemory.key(w), bigOf(bal, "eth_getBalance"), t);
  const tokenBal = tokenRaw === undefined ? undefined : c.memory.fix(BalanceMemory.key(w, token), tokenRaw === "0x" ? 0n : bigOf(tokenRaw, "balanceOf"), t);
  return { nativeBal, nonce, ...(tokenBal !== undefined ? { tokenBal } : {}), erc20Allow, p2Allow, routerAllow: new Map(routers) };
});
export const dropCtx = (c: Ctx): void => c.m.ctx.clear();

/** The trade being built, path-independent: what goes into the steps and the quote. */
export interface Built {
  side: Side; token: string; quote: Quote; payRaw: bigint;
  /** The swap: where it goes, its value and calldata, its gas limit. */
  router: string; value: bigint; data: Hex; swapGas: bigint;
  /** The approvals the sell carries first, in order (token -> spender; or Permit2 -> the UniversalRouter). `spender` is checked against the allowlist. */
  pre: { to: string; data: Hex; gas: bigint; spender: string }[];
  fee: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  nonce: number;
  /** A Pons curve this coin's launcher named: the only per-coin contract a step may go to. */
  curve?: string;
  /** The exact swap was already simulated while building (the aggregator and curve paths): no further proof is needed. */
  simulated?: boolean;
}
