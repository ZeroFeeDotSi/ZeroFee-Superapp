// What the two local paths (direct.ts, curve-trade.ts) share: the shapes they hand back, one engine's caches, and the
// reads every quote needs (accounts raced over two nodes, the blockhash, the priority fee, rent).
import { fromBase64 } from "./bytes.ts";
import type { BalanceMemory } from "../balances.ts";
import { mintDecimals, mintExtensions, mintFreezable, type Struct } from "./codec.ts";
import { TradeError } from "../errors.ts";
import type { MoveSamples, NeedsApproval } from "../slippage.ts";
import { usdToRaw } from "../slippage.ts";
import { MAX_ACCOUNTS_PER_READ, type NodeAnswer, type SolRpc } from "./rpc.ts";

import type { Amount, CoinMeta, Prepared, Quote, Side } from "../types.ts";
export type { Amount, CoinMeta, Side, NeedsApproval };
/** `needsApproval` (added 4 Nov, audit finding 1/2; every other field as Quote): set when the quote must not be signed
 *  without the person approving it on a sheet. A silent (no-sheet) trade refuses a quote that carries it. */
export type SolQuote = Quote & { needsApproval?: NeedsApproval };
/** A Solana trade: one step, the unsigned v0 transaction with the trading wallet as its only signer and fee payer. */
export type SolPrepared = Prepared;

export interface SolDeps {
  rpc: SolRpc;
  /** The trading wallet: it pays the fee and owns the coin accounts. */
  owner: string;
  /** SOL in dollars. */
  solUsd(): Promise<number>;
  meta?(mint: string): Promise<CoinMeta | undefined>;
  now?(): number;
  /** How long a quote is shown before it is prepared again (default 20 s). */
  quoteTtlMs?: number;
  /** For the aggregator (default: the global fetch). The keyless host's limit is per IP, so one engine per device shares it. */
  fetch?: typeof fetch;
  sleep?(ms: number): Promise<void>;
  /** How long a Jupiter quote waits for its swap build before it is shown without it (default 350 ms). */
  graceMs?: number;
}

export const BASE_FEE = 5_000n;
export const PRIO_RESERVE = 25_000n;           // what Max keeps for each of the two priority fees (this trade and the later sell)
// Rent for a token account as the network answered on 21 Oct 2026 (165 bytes, and 170 for Token-2022 with its required
// extension); only a fallback, since rentsOf reads the live figure.
export const TOKEN_RENT = 1_488_440n;
export const TOKEN22_RENT = 1_513_840n;
/** A buy whose own price impact is above this (percent) is refused as too thin. A sell never is. */
export const MAX_BUY_IMPACT_PCT = 50;

export interface Row { data: Uint8Array; lamports: bigint; owner: string }

/** One engine's memory: routes, pool reads, proofs and the slow-changing reads. */
export interface Memo {
  routes: Map<string, any>; lives: Map<string, { live?: any; pending?: Promise<any> }>; statics: Map<string, { at: number; v: Struct[] }>;
  sims: Map<string, { at: number; p: Promise<any>; ok?: boolean; failed?: unknown }>; provedAt: Map<string, number>; none: Map<string, number>; units: Map<string, number>;
  bh?: { at: number; hash: string; lastValid: number; p?: Promise<unknown> };
  fees: Map<string, { at: number; p75?: bigint }>; metas: Map<string, CoinMeta | undefined>; verified: Set<string>;
  curvePools: Map<string, { at: number; p?: any; ttl: number }>; roundTrips: Map<string, { at: number; out: bigint }>; rents?: { at: number; token: bigint; token22: bigint }; rentsAsk?: Promise<{ at: number; token: bigint; token22: bigint }>;
}
export const newMemo = (): Memo => ({ routes: new Map(), lives: new Map(), statics: new Map(), sims: new Map(), provedAt: new Map(), none: new Map(), units: new Map(), fees: new Map(), metas: new Map(), verified: new Set(), curvePools: new Map(), roundTrips: new Map() });

export interface Ctx {
  d: SolDeps; m: Memo; memory: BalanceMemory; moves: MoveSamples;
  now(): number;
  /** 0 = the first build of this trade; 1 = the automatic re-quote after a revert (wider slippage). */
  attempt: number;
}

/** The answer of `p`, or undefined after `ms`. */
export const sleepless = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
  Promise.race([p.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

/**
 * Accounts, raced over two nodes. When neither gives a complete answer (a refused or resting node), `patient` reads ask
 * the ordinary failover read too. Only the native-curve reads are patient; the direct path's hot read stays fast.
 */
export async function readAccounts(c: Ctx, keys: string[], patient = false): Promise<(Row | null)[]> {
  if (keys.length > MAX_ACCOUNTS_PER_READ) {
    const parts: string[][] = [];
    for (let i = 0; i < keys.length; i += MAX_ACCOUNTS_PER_READ) parts.push(keys.slice(i, i + MAX_ACCOUNTS_PER_READ));
    return (await Promise.all(parts.map((p) => readAccounts(c, p, patient)))).flat();
  }
  const params = [keys, { encoding: "base64", commitment: "confirmed" }];
  const full = (v: any) => Array.isArray(v?.value) && v.value.length === keys.length;
  const a = await c.d.rpc.askNodes("getMultipleAccounts", params, 2, { until: (x) => x.ok && full(x.value) });
  const good = a.find((x) => x.ok && full(x.value));
  let value: any[] | undefined = good && good.ok ? good.value.value : undefined;
  if (!value && patient) {
    const v = await c.d.rpc.call("getMultipleAccounts", params).catch(() => undefined);
    if (full(v)) value = v.value;
  }
  if (!value) throw new TradeError("node", "No Solana node answered the pool read");
  return value.map((r) => (r ? { data: fromBase64(r.data[0]), lamports: BigInt(r.lamports), owner: String(r.owner) } : null));
}

/** How long the second node's answer is waited for after the first complete one (the EVM path's PAIR_GRACE_MS). */
export const PAIR_GRACE_MS = 1_500;
/** One read on two nodes: the first node's rows, and the second's (absent when only one node answered in time). */
export interface PairedRows { rows: (Row | null)[]; alts?: (Row | null)[] }
const rowsOf = (v: any): (Row | null)[] => (v.value as any[]).map((r) => (r ? { data: fromBase64(r.data[0]), lamports: BigInt(r.lamports), owner: String(r.owner) } : null));

/**
 * Accounts read on TWO nodes, both answers kept (audit T-6: a mint's gates and a pool's state were one node's word). The
 * second node is waited for up to PAIR_GRACE_MS after the first; when it didn't answer, the next healthiest pair is asked
 * once more. `alts` is absent when two nodes couldn't be had: a gate or a floor then isn't set on one node's word.
 */
export async function readAccountsPair(c: Ctx, keys: string[], patient = false): Promise<PairedRows> {
  if (keys.length > MAX_ACCOUNTS_PER_READ) {
    const parts: string[][] = [];
    for (let i = 0; i < keys.length; i += MAX_ACCOUNTS_PER_READ) parts.push(keys.slice(i, i + MAX_ACCOUNTS_PER_READ));
    const got = await Promise.all(parts.map((p) => readAccountsPair(c, p, patient)));
    return { rows: got.flatMap((g) => g.rows), ...(got.every((g) => g.alts) ? { alts: got.flatMap((g) => g.alts!) } : {}) };
  }
  const params = [keys, { encoding: "base64", commitment: "confirmed" }];
  const full = (v: any) => Array.isArray(v?.value) && v.value.length === keys.length;
  const ask = async (): Promise<NodeAnswer[]> => {
    const heard: NodeAnswer[] = [];
    let done: NodeAnswer[] | undefined, firstFull: () => void = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const first = new Promise<void>((r) => { firstFull = r; });
    const all = c.d.rpc.askNodes("getMultipleAccounts", params, 2, { until: (x) => { heard.push(x); const n = heard.filter((h) => h.ok && full(h.value)).length; if (n === 1) firstFull(); return n >= 2; } }).then((a) => { done = a; });
    await Promise.race([all, first.then(() => new Promise<void>((r) => { timer = setTimeout(r, PAIR_GRACE_MS); }))]);
    clearTimeout(timer);
    return (done ?? heard).filter((x) => x.ok && full(x.value));
  };
  let good = await ask();
  if (good.length < 2) { const again = await ask(); if (again.length > good.length) good = again; }
  if (!good.length && patient) {
    const v = await c.d.rpc.call("getMultipleAccounts", params).catch(() => undefined);
    if (full(v)) return { rows: rowsOf(v) };
  }
  if (!good.length) throw new TradeError("node", "No Solana node answered the pool read");
  const [a, b] = good as { ok: true; value: any }[];
  return { rows: rowsOf(a!.value), ...(b ? { alts: rowsOf(b.value) } : {}) };
}

/** How old the direct path's pool read may be to stand as a price reference for another path (no new read is made). */
export const POOL_REF_MS = 10_000;
/** How far apart the two nodes' prices of that pool may be, in bps (as direct.ts NODES_SPREAD_BPS). */
export const POOL_REF_SPREAD_BPS = 300;
/** A pool state's spot price (lamports per raw coin) and its SOL side (lamports), from the reserves its own maths use. */
function spotOf(st: any): { price: number; sol: number } | undefined {
  const pair = st?.kind === "pumpswap" ? [st.quoteReserve, st.baseReserve]
    : st?.kind === "pumpfun" ? [st.curve?.virtual_quote_reserves, st.curve?.virtual_token_reserves]
    : st?.kind === "cpmm" ? (st.coinIs0 ? [st.reserve1, st.reserve0] : [st.reserve0, st.reserve1]) : undefined;
  if (!pair || typeof pair[0] !== "bigint" || typeof pair[1] !== "bigint" || pair[0] <= 0n || pair[1] <= 0n) return undefined;
  const sol = Number(pair[0]), price = sol / Number(pair[1]);
  return Number.isFinite(price) && price > 0 ? { price, sol } : undefined;
}
/**
 * The coin's price on its own pool as the direct path last read it (audit finding 1, 4 Nov): an on-chain price no
 * aggregator says, for holding another path's quote to. From memory only (no network): the read must be under POOL_REF_MS
 * old, of the coin's listed or canonical pool (never a derived side pool), and its two nodes within POOL_REF_SPREAD_BPS.
 * The lower of the two prices and SOL sides (the stricter for a buy). Undefined when there's no such read.
 */
export function poolPriceRef(c: Ctx, mint: string): { lamportsPerRaw: number; solLamports: number } | undefined {
  const lv = c.m.lives.get(`${c.d.owner}|${mint}`)?.live;
  if (!lv || !(c.now() - lv.at <= POOL_REF_MS) || lv.route?.derived) return undefined;
  const a = spotOf(lv.st), b = spotOf(lv.alt);
  if (!a || !b) return undefined;
  const hi = Math.max(a.price, b.price), lo = Math.min(a.price, b.price);
  if ((hi - lo) * 10_000 > hi * POOL_REF_SPREAD_BPS) return undefined;
  return { lamportsPerRaw: lo, solLamports: Math.min(a.sol, b.sol) };
}

/** What every Buy path gates on in a mint: its program, decimals, freeze authority and Token-2022 powers. */
function mintGates(r: Row | null): string {
  if (!r) return "none";
  const e = mintExtensions(r.data);
  return JSON.stringify([r.owner, mintDecimals(r.data), mintFreezable(r.data), [...e.types].sort((x, y) => x - y), e.transferFeeBps, e.transferFeeAuthority]);
}
/**
 * The mint row two nodes agree on (audit T-6): the same program, decimals, freeze authority and Token-2022 extensions. One
 * node alone ("node": try again), or two that disagree ("unavailable": refused), never passes a gate.
 */
export function agreedMint(p: PairedRows, i: number): Row | null {
  if (!p.alts) throw new TradeError("node", "Only one Solana node answered for this coin's checks; try again");
  if (mintGates(p.rows[i] ?? null) !== mintGates(p.alts[i] ?? null)) throw new TradeError("unavailable", "Two Solana nodes disagree about this coin: refused");
  return p.rows[i] ?? null;
}
/** Two nodes' rows for an account that doesn't change from slot to slot (a program's config): byte for byte the same. */
export function agreedStatic(p: PairedRows, i: number): Row | null {
  if (!p.alts) throw new TradeError("node", "Only one Solana node answered for this pool's settings; try again");
  const a = p.rows[i] ?? null, b = p.alts[i] ?? null;
  const same = (!a && !b) || (!!a && !!b && a.owner === b.owner && a.data.length === b.data.length && a.data.every((x, n) => x === b.data[n]));
  if (!same) throw new TradeError("unavailable", "Two Solana nodes disagree about this pool's settings: refused");
  return a;
}

const BLOCKHASH_TTL_MS = 20_000;
/** A recent blockhash, read again in the background after 10 s and in the foreground after 20 s. */
export async function blockhash(c: Ctx): Promise<{ hash: string; lastValid: number }> {
  const m = c.m;
  const read = async () => {
    const r = await c.d.rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const v = r?.value;
    if (!v?.blockhash) throw new TradeError("node", "No blockhash");
    m.bh = { at: c.now(), hash: v.blockhash, lastValid: Number(v.lastValidBlockHeight) };
  };
  if (!m.bh) await read();
  else if (c.now() - m.bh.at > BLOCKHASH_TTL_MS) await read();
  else if (c.now() - m.bh.at > BLOCKHASH_TTL_MS / 2 && !m.bh.p) m.bh.p = read().catch(() => undefined).finally(() => { if (m.bh) m.bh.p = undefined; });
  return { hash: m.bh!.hash, lastValid: m.bh!.lastValid };
}

/** The 75th percentile of what recent slots paid for this coin (micro-lamports per CU), read again in the background every 15 s. */
export async function priorityP75(c: Ctx, mint: string): Promise<bigint | undefined> {
  const m = c.m;
  const hit = m.fees.get(mint);
  const read = () => c.d.rpc.call("getRecentPrioritizationFees", [[mint]]).then((rows: unknown) => {
    const v = (Array.isArray(rows) ? rows : []).map((r: { prioritizationFee?: number }) => Number(r?.prioritizationFee ?? 0)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    return v.length ? BigInt(Math.ceil(v[Math.min(v.length - 1, Math.floor(v.length * 0.75))]!)) : undefined;
  }).catch(() => undefined);
  if (hit && c.now() - hit.at < 15_000) return hit.p75;
  if (hit) { m.fees.set(mint, { at: c.now(), p75: hit.p75 }); void read().then((p75) => m.fees.set(mint, { at: c.now(), p75: p75 ?? hit.p75 })); return hit.p75; }
  const p75 = await read();
  m.fees.set(mint, { at: c.now(), p75 });
  return p75;
}

/** The network's rent for a token account (165 bytes; Token-2022 with its required extension, 170), read once per 10 minutes. */
export async function rentsOf(c: Ctx): Promise<{ token: bigint; token22: bigint }> {
  const hit = c.m.rents;
  if (hit && c.now() - hit.at < 600_000) return hit;
  // Rent changes only rarely, network-wide, and the simulation proves the real transaction before it can be signed: a quote
  // never waits for it (free nodes took 3-4 s to answer on 25 Oct). The known figures until a node says otherwise (they
  // matched mainnet that day); one ask at a time.
  c.m.rentsAsk ??= (async () => {
    const [a, b] = await Promise.all([165, 170].map((n) => c.d.rpc.call("getMinimumBalanceForRentExemption", [n]).then((v: unknown) => { const x = BigInt(v as number); return x > 0n ? x : undefined; }, () => undefined)));
    const r = { at: c.now(), token: a ?? hit?.token ?? TOKEN_RENT, token22: b ?? hit?.token22 ?? TOKEN22_RENT };
    c.m.rents = r;
    return r;
  })().finally(() => { c.m.rentsAsk = undefined; });
  return hit ?? { token: TOKEN_RENT, token22: TOKEN22_RENT };
}

/** Priority fee in lamports: the coin's p75 priced for `units`, at least 10k, at most 1% of the trade (10k–500k). */
export function priorityLamports(side: Side, payRaw: bigint, p75: bigint | undefined, units: number): bigint {
  const clamp = (v: bigint, lo: bigint, hi: bigint) => (v < lo ? lo : v > hi ? hi : v);
  const cap = clamp((side === "buy" ? payRaw : 100_000_000n) / 100n, 10_000n, 500_000n);
  return p75 === undefined ? 10_000n : clamp((p75 * BigInt(units)) / 1_000_000n, 10_000n, cap);
}

/**
 * How much a trade pays: lamports for a buy, raw coins for a sell. Max keeps what this transaction and the later sell need
 * (two fee reserves, a new coin account's rent, the temporary wSOL account's rent). Throws "funds" when it can't be paid.
 */
export function payOf(side: Side, amount: Amount, o: { bal: bigint; held: bigint; solUsd: number; rentNew: bigint; wsolRent: bigint; symbol: string }): bigint {
  const feeEst = BASE_FEE + PRIO_RESERVE;
  const solLow = (message: string) => new TradeError("funds", message, o.bal === 0n ? "wallet-empty" : "sol-low");
  let pay: bigint;
  if (side === "buy") {
    if ("raw" in amount) pay = BigInt(amount.raw);
    else if ("usd" in amount) pay = usdToRaw(amount.usd, o.solUsd, 9);
    else if ("max" in amount) pay = o.bal - (2n * feeEst + o.rentNew + o.wsolRent);
    else throw new TradeError("unavailable", "A buy is an amount in dollars");
    if (pay <= 0n || o.bal < pay + feeEst + o.rentNew + o.wsolRent) throw solLow("Not enough SOL for this buy and its fee");
    return pay;
  }
  if (o.held === 0n) throw new TradeError("funds", `You don't hold any ${o.symbol}`, "coin-low");
  if ("raw" in amount) pay = BigInt(amount.raw);
  else if ("fraction" in amount) pay = amount.fraction >= 1 ? o.held : (o.held * BigInt(Math.floor(amount.fraction * 1e6))) / 1_000_000n;
  else if ("max" in amount) pay = o.held;
  else throw new TradeError("unavailable", "A sell is a share of what you hold");
  if (pay <= 0n || pay > o.held) throw new TradeError("funds", `You don't hold that much ${o.symbol}`, "coin-low");
  if (o.bal < feeEst + o.wsolRent) throw solLow("Not enough SOL for the network fee");
  return pay;
}
