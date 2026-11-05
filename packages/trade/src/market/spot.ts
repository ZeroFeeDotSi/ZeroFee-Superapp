// A coin's SPOT price read straight from a pool on chain, times the quote's dollar price: no market data. Ported from
// wallet v1 (market/spot.ts, QA-UX 21 Oct: a coin page must not show no price because a free API is rate-limiting us). It
// makes the same node calls v1 made, so v1's recorded cases replay here (spot.test.ts). Layouts as v1 read them from real
// accounts and checked against GeckoTerminal's price of the same minute:
//   EVM     v2 / PancakeSwap v2                 getReserves()
//           v3 / PancakeSwap v3 / Ramses        slot0().sqrtPriceX96
//           Uniswap v4 / Pons v2 / hook pools   PoolManager.extsload(keccak(poolId, 6)): slot0, sqrtPriceX96 in its low 160 bits
//           PancakeSwap Infinity CL             CLPoolManager.getSlot0(poolId)
//   Solana  pump.fun curve (virtual reserves), PumpSwap (its last swap: the vault ratio was 0-23 % below the swaps' price on
//           4 pools v1 measured), Raydium CP-Swap (the two vaults), Raydium CLMM (sqrt price), Meteora DLMM (the active bin)
// Display only: undefined whenever the pool can't be read, never a guess.
import { keccakHex } from "../evm/bytes.ts";
import { selectorOf } from "../evm/abi.ts";
import { base58, fromBase64 } from "../sol/bytes.ts";
import type { ChainId } from "../types.ts";
import { NATIVE_SENTINEL, quoteKindOf, ZERO_ADDRESS, type QuoteKind } from "./map.ts";
import { clmmMints, coinIs0, decodeLogs, decodeTx, isPoolId, kindOfProgram, managerKind, MANAGERS, PROGRAMS, slim, TX_OPTS, type SolCtx } from "./swaps.ts";

/** A pool to price the coin in: the coin's and the quote's address and decimals (when known), the quote's last market price. */
export interface SpotPool {
  chain: ChainId; pool: string; dex: string;
  coin: { address: string; decimals?: number };
  quote: { address: string; decimals?: number; priceUsd?: number; kind?: QuoteKind };
}
export interface Spot { priceUsd: number; quotePerCoin: number; quoteUsd: number; pool: string; source: string }
/** A node call: (chain, method, params). */
export type ChainRpc = (chain: ChainId, method: string, params: unknown[]) => Promise<any>;
export interface SpotEnv { rpc: ChainRpc; nativeUsd(chain: ChainId): Promise<number> }

const Q96 = 2 ** 96, Q64 = 2 ** 64;
const WSOL = "So11111111111111111111111111111111111111112";
const SEL = { slot0: "0x3850c7bd", reserves: "0x0902f1ac", extsload: "0x1e2eaeaf", decimals: "0x313ce567", getSlot0: selectorOf("getSlot0(bytes32)") };
const word = (hex: string, i: number): string => hex.slice(2 + i * 64, 2 + (i + 1) * 64);
const isNativeAddr = (a: string): boolean => { const x = a.toLowerCase(); return x === ZERO_ADDRESS || x === NATIVE_SENTINEL; };
const kindOf = (chain: ChainId, p: SpotPool): QuoteKind | undefined => p.quote.kind ?? (chain !== "sol" && isNativeAddr(p.quote.address) ? "native" : quoteKindOf(chain, p.quote.address));

/** Dollars per quote token: a stable is 1, the native coin its own price (or the pool's snapshot of it), anything else its snapshot. */
async function quoteUsd(env: SpotEnv, chain: ChainId, p: SpotPool): Promise<number | undefined> {
  const k = kindOf(chain, p);
  if (k === "stable") return 1;
  if (k === "native") { try { const v = await env.nativeUsd(chain); return v > 0 ? v : undefined; } catch { return p.quote.priceUsd && p.quote.priceUsd > 0 ? p.quote.priceUsd : undefined; } }
  return p.quote.priceUsd && p.quote.priceUsd > 0 ? p.quote.priceUsd : undefined;
}

/** token1 per token0 (whole tokens) from a sqrt price, as the price of the coin in the quote. */
const fromSqrt = (sqrt: number, c0: boolean, dec0: number, dec1: number): number => { const p01 = sqrt * sqrt * 10 ** (dec0 - dec1); return c0 ? p01 : 1 / p01; };

async function evmQuotePerCoin(env: SpotEnv, chain: ChainId, coin: string, p: SpotPool, cd: number, qd: number): Promise<{ q: number; source: string } | undefined> {
  const c0 = coinIs0(coin, p.quote.address);
  const [dec0, dec1] = c0 ? [cd, qd] : [qd, cd];
  const call = (to: string, data: string) => env.rpc(chain, "eth_call", [{ to, data }, "latest"]) as Promise<string>;
  if (isPoolId(p.pool)) {
    const which = managerKind(p.dex);
    if (which === "infBin") return undefined;                                          // a bin pool has no sqrt price
    const mgr = MANAGERS[chain as "bsc" | "hood"]?.[which];
    if (!mgr) return undefined;
    let w0: string;
    if (which === "infCL") w0 = word(await call(mgr, SEL.getSlot0 + p.pool.slice(2)), 0);
    else {
      const slot = keccakHex(p.pool + "00".repeat(31) + "06");
      w0 = (await call(mgr, SEL.extsload + slot.slice(2))).slice(2).padStart(64, "0");
      w0 = "0".repeat(24) + w0.slice(24);                                               // the low 160 bits
    }
    const sqrt = Number(BigInt("0x" + w0.slice(24).padStart(40, "0"))) / Q96;
    if (!(sqrt > 0)) return undefined;
    return { q: fromSqrt(sqrt, c0, dec0, dec1), source: which === "infCL" ? "Infinity getSlot0" : "v4 extsload" };
  }
  const v3first = /v3|clmm|ramses|slipstream/i.test(p.dex);
  const tryV3 = async () => { const r = await call(p.pool, SEL.slot0); const sqrt = Number(BigInt("0x" + word(r, 0))) / Q96; return sqrt > 0 ? { q: fromSqrt(sqrt, c0, dec0, dec1), source: "slot0" } : undefined; };
  const tryV2 = async () => {
    const r = await call(p.pool, SEL.reserves);
    const r0 = Number(BigInt("0x" + (word(r, 0) || "0"))), r1 = Number(BigInt("0x" + (word(r, 1) || "0")));
    if (!(r0 > 0 && r1 > 0)) return undefined;
    const [rc, rq] = c0 ? [r0 / 10 ** cd, r1 / 10 ** qd] : [r1 / 10 ** cd, r0 / 10 ** qd];
    return { q: rq / rc, source: "getReserves" };
  };
  for (const f of v3first ? [tryV3, tryV2] : [tryV2, tryV3]) { try { const r = await f(); if (r) return r; } catch { /* the other layout */ } }
  return undefined;
}

const u64 = (b: Uint8Array, o: number): bigint => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(o, true);
const u128 = (b: Uint8Array, o: number): bigint => u64(b, o) | (u64(b, o + 8) << 64n);
const i32 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getInt32(o, true);
const u16 = (b: Uint8Array, o: number): number => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o, true);
const pk = (b: Uint8Array, o: number): string => base58(b.subarray(o, o + 32));

async function solAccount(env: SpotEnv, address: string): Promise<{ owner: string; data: Uint8Array } | null> {
  const r = await env.rpc("sol", "getAccountInfo", [address, { encoding: "base64", commitment: "confirmed" }]);
  return r?.value ? { owner: r.value.owner, data: fromBase64(r.value.data[0]) } : null;
}
async function solDecimals(env: SpotEnv, mint: string): Promise<number> {
  if (mint === WSOL) return 9;
  const r = await env.rpc("sol", "getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }]);
  const d = r?.value?.data?.parsed?.info?.decimals;
  if (typeof d !== "number") throw new Error("not a mint");
  return d;
}

/** What the decoders need for this pool: its program, its data, both sides' decimals. Undefined when the pool account isn't there. */
export async function solPoolCtx(env: SpotEnv, coin: string, p: SpotPool, coinDecimals: number): Promise<{ ctx: SolCtx; owner: string } | undefined> {
  const a = await solAccount(env, p.pool).catch(() => null);
  if (!a) return undefined;
  const quoteDecimals = p.quote.address === WSOL ? 9 : p.quote.decimals ?? (await solDecimals(env, p.quote.address));
  return { ctx: { pool: p.pool, kind: kindOfProgram(a.owner), coinMint: coin, coinDecimals, quoteMint: p.quote.address, quoteDecimals, poolData: a.data }, owner: a.owner };
}

/** Quote per coin of the pool's most recent successful swap (a few signatures back at most), with the swap decoders. */
async function lastTrade(env: SpotEnv, coin: string, p: SpotPool, cd: number): Promise<number | undefined> {
  const setup = await solPoolCtx(env, coin, p, cd);
  if (!setup) return undefined;
  const sigs = (await env.rpc("sol", "getSignaturesForAddress", [p.pool, { limit: 12, commitment: "confirmed" }])) as { signature: string; err: unknown }[];
  let tried = 0;
  for (const s of sigs ?? []) {
    if (s.err) continue;
    if (++tried > 4) break;
    const r = await env.rpc("sol", "getTransaction", [s.signature, TX_OPTS]).catch(() => null);
    if (!r) continue;
    const { tx, logs } = slim(r);
    const sw = (decodeLogs(setup.ctx, logs) ?? decodeTx(setup.ctx, tx, logs))[0];
    if (sw && sw.coin > 0 && sw.quote > 0) return sw.price ?? sw.quote / sw.coin;
  }
  return undefined;
}

async function solQuotePerCoin(env: SpotEnv, coin: string, p: SpotPool, cd: number, qd: number): Promise<{ q: number; source: string } | undefined> {
  const acc = await solAccount(env, p.pool);
  if (!acc) return undefined;
  const data = acc.data, kind = kindOfProgram(acc.owner);
  const vaults = async (a: string, b: string): Promise<[bigint, bigint] | undefined> => {
    const r = await env.rpc("sol", "getMultipleAccounts", [[a, b], { encoding: "base64", commitment: "confirmed" }]);
    const x = r?.value?.[0], y = r?.value?.[1];
    return x && y ? [u64(fromBase64(x.data[0]), 64), u64(fromBase64(y.data[0]), 64)] : undefined;
  };
  if (kind === "pumpfun") {
    if (data.length < 49) return undefined;
    const vt = Number(u64(data, 8)), vs = Number(u64(data, 16));                       // virtual token / virtual SOL reserves
    return vt > 0 && vs > 0 ? { q: vs / 1e9 / (vt / 10 ** cd), source: "pump.fun curve" } : undefined;
  }
  if (kind === "pumpswap") {
    const last = await lastTrade(env, coin, p, cd).catch(() => undefined);
    if (last) return { q: last, source: "PumpSwap last swap" };
    const v = await vaults(pk(data, 139), pk(data, 171));                               // only when the pool has no recent swap at all
    if (!v) return undefined;
    const coinIsBase = pk(data, 43) === coin;
    const [rc, rq] = coinIsBase ? [Number(v[0]) / 10 ** cd, Number(v[1]) / 10 ** qd] : [Number(v[1]) / 10 ** cd, Number(v[0]) / 10 ** qd];
    return rc > 0 && rq > 0 ? { q: rq / rc, source: "PumpSwap vaults (approx)" } : undefined;
  }
  if (acc.owner === PROGRAMS.cpmm) {                                                    // token_0_vault @72, token_1_vault @104, token_0_mint @168
    const v = await vaults(pk(data, 72), pk(data, 104));
    if (!v) return undefined;
    const coin0 = pk(data, 168) === coin;
    const [rc, rq] = coin0 ? [Number(v[0]) / 10 ** cd, Number(v[1]) / 10 ** qd] : [Number(v[1]) / 10 ** cd, Number(v[0]) / 10 ** qd];
    return rc > 0 && rq > 0 ? { q: rq / rc, source: "CPMM vaults" } : undefined;
  }
  if (kind === "clmm") {                                                                // sqrt_price_x64 @253
    const { mint0, dec0, dec1 } = clmmMints(data);
    const sqrt = Number(u128(data, 253)) / Q64;
    return sqrt > 0 ? { q: fromSqrt(sqrt, mint0 === coin, dec0, dec1), source: "CLMM sqrt price" } : undefined;
  }
  if (acc.owner === PROGRAMS.dlmm) {                                                    // active_id i32 @76, bin_step u16 @80, token_x_mint @88; X in Y = (1 + step/10000)^id
    const id = i32(data, 76), step = u16(data, 80);
    const xIsCoin = pk(data, 88) === coin;
    const [dx, dy] = xIsCoin ? [cd, qd] : [qd, cd];
    const yPerX = (1 + step / 10_000) ** id * 10 ** (dx - dy);
    return Number.isFinite(yPerX) && yPerX > 0 ? { q: xIsCoin ? yPerX : 1 / yPerX, source: "DLMM active bin" } : undefined;
  }
  return undefined;
}

/** decimals() as the chain says it: an empty answer (no contract there, the 0xEeee sentinel) throws, so nothing is priced with a guess. */
async function decimalsOf(env: SpotEnv, chain: ChainId, token: string): Promise<number> {
  if (chain === "sol") return solDecimals(env, token);
  if (isNativeAddr(token)) return 18;
  const h = (await env.rpc(chain, "eth_call", [{ to: token, data: SEL.decimals }, "latest"])) as string;
  if (typeof h !== "string" || h === "0x" || h === "") throw new Error("no decimals() at this address");
  const d = Number(BigInt(h));
  if (!(d >= 0 && d <= 36)) throw new Error(`decimals ${d} out of range`);
  return d;
}

/** The coin's price in pool `p`; `coinDecimals` when the caller read them already. Undefined when the pool can't be read: never a guess. */
export async function spotPrice(env: SpotEnv, chain: ChainId, coin: string, p: SpotPool, coinDecimals?: number): Promise<Spot | undefined> {
  try {
    const cd = coinDecimals ?? p.coin.decimals ?? (await decimalsOf(env, chain, coin));
    const qd = p.quote.decimals ?? (await decimalsOf(env, chain, p.quote.address));
    const [qp, qu] = await Promise.all([chain === "sol" ? solQuotePerCoin(env, coin, p, cd, qd) : evmQuotePerCoin(env, chain, coin, p, cd, qd), quoteUsd(env, chain, p)]);
    if (!qp || !qu || !(qp.q > 0) || !Number.isFinite(qp.q)) return undefined;
    return { priceUsd: qp.q * qu, quotePerCoin: qp.q, quoteUsd: qu, pool: p.pool, source: qp.source };
  } catch { return undefined; }
}
