// Swap decoders for a coin's pool, ported from wallet v1 (market/live/sol-decode.ts, evm-decode.ts, sol-live.ts `slim`),
// whose layouts were read from real captures (21 Oct 2026) and checked against what the pool's own vaults did:
//  Solana, from the logs (no extra request):
//    PumpSwap         Anchor BuyEvent 67f4521f2cf57777 / SellEvent 3e2f370aa503dc2a, the pool at byte 120
//    pump.fun curve   TradeEvent bddb7fd34ee661ee (mint at 8, the SOL amount, the token amount, is_buy)
//    Raydium CP-Swap  SwapEvent 40c6cde8260871e2, 170 bytes, pool_id at 8, the input / output mint inside
//    Raydium CLMM     SwapEvent 40c6cde8260871e2, 221 bytes, pool_state at 8, amount_0 / 1, the sqrt price
//  Solana, from the whole transaction: what the pool's own vaults gained or lost (Meteora DLMM emits its event as a CPI,
//  Raydium AMM v4 and anything else land here too). A log that holds another pool's event is nothing for this pool.
//  BNB Chain and Robinhood Chain, from a Swap log: Uniswap v2 / PancakeSwap v2, Uniswap v3 / Ramses v3, PancakeSwap v3,
//  Uniswap v4 (and Pons v2, on the same PoolManager), PancakeSwap Infinity CL and Bin. token0 is the lower address; the
//  native coin is the zero address (0xEeee… sorts as it).
// Display only: a price and a side for the chart and the live price, never an amount a trade moves.
import { topicOf } from "../evm/abi.ts";
import { base58, fromBase58, fromBase64 } from "../sol/bytes.ts";

export const PROGRAMS = {
  pumpswap: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  pumpfun: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  clmm: "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  ammV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  dlmm: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
} as const;
export type SolKind = "pumpswap" | "pumpfun" | "cpmm" | "clmm" | "other";
export const kindOfProgram = (owner: string): SolKind => (owner === PROGRAMS.pumpswap ? "pumpswap" : owner === PROGRAMS.pumpfun ? "pumpfun" : owner === PROGRAMS.cpmm ? "cpmm" : owner === PROGRAMS.clmm ? "clmm" : "other");

/** One swap of the pool, in whole coins and whole quote units. `price`: quote per coin, when the pool says it (a sqrt price). */
export interface Swap { side: "buy" | "sell"; coin: number; quote: number; price?: number; trader?: string }

export interface SolCtx {
  pool: string; kind: SolKind;
  coinMint: string; coinDecimals: number;
  quoteMint: string; quoteDecimals: number;
  /** The pool account's data: the vaults are found in it, and a CLMM pool's mints. */
  poolData?: Uint8Array;
}

const D = { pumpBuy: "67f4521f2cf57777", pumpSell: "3e2f370aa503dc2a", curveTrade: "bddb7fd34ee661ee", raySwap: "40c6cde8260871e2" };
const hex = (b: Uint8Array, o: number, n: number): string => Array.from(b.subarray(o, o + n), (x) => x.toString(16).padStart(2, "0")).join("");
const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (b: Uint8Array, o: number): bigint => dv(b).getBigUint64(o, true);
const u128 = (b: Uint8Array, o: number): bigint => u64(b, o) | (u64(b, o + 8) << 64n);
const pk = (b: Uint8Array, o: number): string => base58(b.subarray(o, o + 32));
const ui = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** The "Program data: <base64>" events of a notification or transaction. */
/**
 * The events in a transaction's logs ("Program data: …"). `program`: only those that program logged itself, read from
 * the invoke / success / failed lines that say which program is running (lead from the money audit: any program in the
 * same transaction can log an event with this pool's discriminator and key, and was read as this pool's swap).
 */
export function programData(logs: readonly string[], program?: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const running: string[] = [];
  for (const l of logs) {
    const call = /^Program (\S+) invoke \[\d+\]$/.exec(l);
    if (call) { running.push(call[1]!); continue; }
    if (/^Program \S+ (success|failed\b)/.test(l)) { running.pop(); continue; }
    if (!l.startsWith("Program data: ") || (program !== undefined && running.at(-1) !== program)) continue;
    try { out.push(fromBase64(l.slice(14))); } catch { /* not base64: not an event */ }
  }
  return out;
}

/** Swaps of THIS pool read from the logs. Undefined: this pool's program has no log event (use decodeTx). */
export function decodeLogs(ctx: SolCtx, logs: readonly string[]): Swap[] | undefined {
  if (ctx.kind === "other") return undefined;
  const out: Swap[] = [];
  for (const b of programData(logs, PROGRAMS[ctx.kind])) {
    if (b.length < 16) continue;
    const d = hex(b, 0, 8);
    if (ctx.kind === "pumpswap" && b.length >= 184 && (d === D.pumpBuy || d === D.pumpSell) && pk(b, 120) === ctx.pool) {
      const buy = d === D.pumpBuy;
      // Buy: base_amount_out @16, quote_amount_in @64. Sell: base_amount_in @16, quote_amount_out @64. The trader @152
      out.push({ side: buy ? "buy" : "sell", coin: ui(u64(b, 16), ctx.coinDecimals), quote: ui(u64(b, 64), ctx.quoteDecimals), trader: pk(b, 152) });
    } else if (ctx.kind === "pumpfun" && d === D.curveTrade && b.length >= 89 && pk(b, 8) === ctx.coinMint) {
      // mint @8, sol_amount @40, token_amount @48, is_buy @56, user @57
      out.push({ side: b[56] ? "buy" : "sell", coin: ui(u64(b, 48), ctx.coinDecimals), quote: ui(u64(b, 40), ctx.quoteDecimals), trader: pk(b, 57) });
    } else if (ctx.kind === "cpmm" && d === D.raySwap && b.length === 170 && pk(b, 8) === ctx.pool) {
      // input_amount @56, output_amount @64, input_mint @89, output_mint @121 (any transfer fee is on top of these)
      const inAmt = u64(b, 56), outAmt = u64(b, 64);
      if (pk(b, 89) === ctx.coinMint) out.push({ side: "sell", coin: ui(inAmt, ctx.coinDecimals), quote: ui(outAmt, ctx.quoteDecimals) });
      else out.push({ side: "buy", coin: ui(outAmt, ctx.coinDecimals), quote: ui(inAmt, ctx.quoteDecimals) });
    } else if (ctx.kind === "clmm" && d === D.raySwap && b.length === 221 && pk(b, 8) === ctx.pool && ctx.poolData) {
      const s = clmmSwap(ctx, b);
      if (s) out.push(s);
    }
  }
  return out;
}

/** A Raydium CLMM pool state: token_mint_0 @73, token_mint_1 @105, mint_decimals @233 / @234. */
export function clmmMints(poolData: Uint8Array): { mint0: string; mint1: string; dec0: number; dec1: number } {
  return { mint0: pk(poolData, 73), mint1: pk(poolData, 105), dec0: poolData[233]!, dec1: poolData[234]! };
}
function clmmSwap(ctx: SolCtx, b: Uint8Array): Swap | undefined {
  const { mint0, mint1, dec0, dec1 } = clmmMints(ctx.poolData!);
  // sender @40, amount_0 @136, amount_1 @152, zero_for_one @168, sqrt_price_x64 @169
  const coin0 = ctx.coinMint === mint0;
  if (!coin0 && ctx.coinMint !== mint1) return undefined;
  const a0 = ui(u64(b, 136), dec0), a1 = ui(u64(b, 152), dec1);
  const zeroForOne = b[168] === 1;                                  // token0 goes in, token1 comes out
  const buy = coin0 ? !zeroForOne : zeroForOne;                     // the coin leaves the pool
  const sqrt = Number(u128(b, 169)) / 2 ** 64;
  const p10 = sqrt * sqrt * 10 ** (dec0 - dec1);                    // token1 per token0, whole tokens
  return { side: buy ? "buy" : "sell", coin: coin0 ? a0 : a1, quote: coin0 ? a1 : a0, price: coin0 ? p10 : 1 / p10, trader: pk(b, 40) };
}

/** A transaction as decodeTx reads it: its keys (with the loaded lookup-table addresses) and its token balances before and after. */
export interface TokenBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
export interface SlimTx { slot: number; blockTime: number | null; err: unknown; keys: string[]; pre: TokenBal[]; post: TokenBal[]; preLamports?: number[]; postLamports?: number[] }
/** getTransaction's options decodeTx needs (json, so the logs and token balances come with it). */
export const TX_OPTS = { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 100 };
/** A getTransaction answer as the decoders read it. */
export function slim(r: any): { tx: SlimTx; logs: string[] } {
  return {
    tx: {
      slot: r.slot, blockTime: r.blockTime, err: r.meta?.err ?? null,
      keys: [...(r.transaction?.message?.accountKeys ?? []), ...(r.meta?.loadedAddresses?.writable ?? []), ...(r.meta?.loadedAddresses?.readonly ?? [])],
      pre: r.meta?.preTokenBalances ?? [], post: r.meta?.postTokenBalances ?? [],
      ...(r.meta?.preBalances ? { preLamports: r.meta.preBalances } : {}), ...(r.meta?.postBalances ? { postLamports: r.meta.postBalances } : {}),
    },
    logs: r.meta?.logMessages ?? [],
  };
}

const inData = (data: Uint8Array, key: Uint8Array): boolean => {
  outer: for (let o = 0; o + 32 <= data.length; o++) {
    for (let i = 0; i < 32; i++) if (data[o + i] !== key[i]) continue outer;
    return true;
  }
  return false;
};

/**
 * A transaction whose only instructions move liquidity (no swap): the vaults can move opposite ways in it, which isn't a
 * trade. Found live on 27 Oct 2026: a Meteora DLMM RebalanceLiquidity took 0.24 SOL out of LAUNCH's pool and put 84.9 LAUNCH
 * in, which read as a sale at 189x the price (fixtures/dlmm-launch.json). Anchor programs log each instruction's name.
 */
export function liquidityOnly(logs: readonly string[]): boolean {
  const ix = logs.filter((l) => l.startsWith("Program log: Instruction: "));
  return ix.some((l) => /Liquidity|Position/.test(l)) && !ix.some((l) => /Swap/i.test(l));
}

/** Swaps of this pool from a whole transaction: what the pool's vaults gained or lost. Both moving the same way (liquidity) is
 *  no swap; with its `logs`, neither is a transaction that only moves liquidity (liquidityOnly). */
export function decodeTx(ctx: SolCtx, tx: SlimTx, logs?: readonly string[]): Swap[] {
  if (tx.err) return [];
  if (logs && liquidityOnly(logs)) return [];
  const isVault = (t: TokenBal): boolean => {
    if (t.mint !== ctx.coinMint && t.mint !== ctx.quoteMint) return false;
    if (t.owner === ctx.pool) return true;
    const k = tx.keys[t.accountIndex];
    if (!k || !ctx.poolData) return false;
    try { return inData(ctx.poolData, fromBase58(k)); } catch { return false; }
  };
  const delta = (mint: string, dec: number): number => {
    let d = 0n;
    for (const p of tx.post) {
      if (p.mint !== mint || !isVault(p)) continue;
      const before = tx.pre.find((x) => x.accountIndex === p.accountIndex);
      d += BigInt(p.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0");
    }
    return Number(d) / 10 ** dec;
  };
  const dCoin = delta(ctx.coinMint, ctx.coinDecimals), dQuote = delta(ctx.quoteMint, ctx.quoteDecimals);
  if (dCoin === 0 || dQuote === 0 || Math.sign(dCoin) === Math.sign(dQuote)) return [];
  return [{ side: dCoin < 0 ? "buy" : "sell", coin: Math.abs(dCoin), quote: Math.abs(dQuote), ...(tx.keys[0] ? { trader: tx.keys[0] } : {}) }];
}

// ---- BNB Chain and Robinhood Chain

export const T = {
  v2: topicOf("Swap(address,uint256,uint256,uint256,uint256,address)"),
  v3: topicOf("Swap(address,address,int256,int256,uint160,uint128,int24)"),
  pv3: topicOf("Swap(address,address,int256,int256,uint160,uint128,int24,uint128,uint128)"),
  v4: topicOf("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"),
  infCL: topicOf("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24,uint16)"),
  infBin: topicOf("Swap(bytes32,address,int128,int128,uint24,uint24,uint16)"),
} as const;

/** The singleton pool managers (v1 checked each emitting its Swap topic for real pool ids, 21 Oct 2026). */
export const MANAGERS: Record<"bsc" | "hood", { v4?: string; infCL?: string; infBin?: string }> = {
  bsc: { v4: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df", infCL: "0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b", infBin: "0xc697d2898e0d09264376196696c51d7abbbaa4a9" },
  hood: { v4: "0x8366a39cc670b4001a1121b8f6a443a643e40951" },    // Uniswap v4 (Pons v2 and the hook pools swap through it too)
};
/** Which singleton manager a pool id's dex uses. */
export const managerKind = (dex: string): "v4" | "infCL" | "infBin" => (/infinity-bin|-bin$/.test(dex) ? "infBin" : /infinity/.test(dex) ? "infCL" : "v4");

export interface EvmCtx { coin: string; coinDecimals: number; quoteDecimals: number; coinIs0: boolean; /** a singleton pool: its id (topic 1) */ poolId?: string }
export interface EvmLog { topics: string[]; data: string; transactionHash?: string; logIndex?: string; address?: string; blockNumber?: string; removed?: boolean }

export const isPoolId = (a: string): boolean => /^0x[0-9a-fA-F]{64}$/.test(a);
const sortKey = (a: string): string => { const x = a.toLowerCase(); return x === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ? "0x0000000000000000000000000000000000000000" : x; };
/** token0 is the lower address; 0xEeee… (the native coin as market data names it) sorts as the zero address. */
export const coinIs0 = (coin: string, quote: string): boolean => sortKey(coin) < sortKey(quote);

const Q96 = 2 ** 96;
const wordAt = (data: string, i: number): string => data.slice(2 + i * 64, 2 + (i + 1) * 64);
const big = (w: string): bigint => BigInt("0x" + (w || "0"));
const signed = (w: string): bigint => { const v = big(w); return v >= 1n << 255n ? v - (1n << 256n) : v; };
const addrOf = (topic: string | undefined): string => (topic ? "0x" + topic.slice(-40).toLowerCase() : "");

export function decodeEvmLog(ctx: EvmCtx, log: EvmLog): Swap | undefined {
  const t0 = log.topics[0], d = log.data;
  const cd = ctx.coinDecimals, qd = ctx.quoteDecimals;
  const [dec0, dec1] = ctx.coinIs0 ? [cd, qd] : [qd, cd];
  const sqrtPrice = (w: string): number | undefined => {
    const s = Number(big(w)) / Q96;
    if (!(s > 0)) return undefined;
    const p01 = s * s * 10 ** (dec0 - dec1);                       // token1 per token0, whole tokens
    return ctx.coinIs0 ? p01 : 1 / p01;                             // quote per coin
  };
  const split = (a0: bigint, a1: bigint) => (ctx.coinIs0 ? { coin: a0, quote: a1 } : { coin: a1, quote: a0 });
  const out = (coin: bigint, quote: bigint, buy: boolean, trader: string, price?: number): Swap | undefined => {
    const c = Number(coin < 0n ? -coin : coin) / 10 ** cd, q = Number(quote < 0n ? -quote : quote) / 10 ** qd;
    if (!(c > 0) || !(q > 0)) return undefined;
    return { side: buy ? "buy" : "sell", coin: c, quote: q, ...(price !== undefined ? { price } : {}), ...(trader ? { trader } : {}) };
  };
  if (t0 === T.v2 && d.length >= 2 + 4 * 64) {
    const a0In = big(wordAt(d, 0)), a1In = big(wordAt(d, 1)), a0Out = big(wordAt(d, 2)), a1Out = big(wordAt(d, 3));
    const cIn = ctx.coinIs0 ? a0In : a1In, cOut = ctx.coinIs0 ? a0Out : a1Out, qIn = ctx.coinIs0 ? a1In : a0In, qOut = ctx.coinIs0 ? a1Out : a0Out;
    const trader = addrOf(log.topics[2]);
    return cOut > cIn ? out(cOut - cIn, qIn - qOut, true, trader) : out(cIn - cOut, qOut - qIn, false, trader);
  }
  if ((t0 === T.v3 || t0 === T.pv3) && d.length >= 2 + 5 * 64) {
    const { coin, quote } = split(signed(wordAt(d, 0)), signed(wordAt(d, 1)));
    return out(coin, quote, coin < 0n, addrOf(log.topics[2]), sqrtPrice(wordAt(d, 2)));   // the pool paid the coin out: a buy
  }
  if ((t0 === T.v4 || t0 === T.infCL) && d.length >= 2 + 5 * 64) {
    if (ctx.poolId && log.topics[1]?.toLowerCase() !== ctx.poolId.toLowerCase()) return undefined;
    const { coin, quote } = split(signed(wordAt(d, 0)), signed(wordAt(d, 1)));
    return out(coin, quote, coin > 0n, addrOf(log.topics[2]), sqrtPrice(wordAt(d, 2)));    // the swapper received the coin: a buy
  }
  if (t0 === T.infBin && d.length >= 2 + 2 * 64) {
    if (ctx.poolId && log.topics[1]?.toLowerCase() !== ctx.poolId.toLowerCase()) return undefined;
    const { coin, quote } = split(signed(wordAt(d, 0)), signed(wordAt(d, 1)));
    return out(coin, quote, coin > 0n, addrOf(log.topics[2]));
  }
  return undefined;
}
