// The aggregator fallback: Jupiter's keyless lite API, for every coin the local paths don't build (Raydium AMM v4 and
// CLMM, Orca, Meteora DLMM, curves quoted in another coin, Token-2022 coins with a fee or hook). No key, no platform fee.
//   quote : GET  lite-api.jup.ag/swap/v1/quote  (outAmount, otherAmountThreshold, priceImpactPct, swapUsdValue)
//   build : POST lite-api.jup.ag/swap/v1/swap   (swapTransaction = base64 v0 tx, lastValidBlockHeight, prioritizationFeeLamports)
// The quote is shown as soon as it answers; the build, its simulation and the account closes run on, and ready() waits
// for them at the tap (the old live build's Buy button never woke because it waited for all of it). The built
// transaction is simulated: it must pass, and it must not take more SOL than the trade, the fee and the rent.
import { BalanceMemory } from "../balances.ts";
import { fromBase64 } from "./bytes.ts";
import { simProblem, TradeError } from "../errors.ts";
import { applyBps, approvalNeeded, autoSlippageBps, rawToUsd, usdToRaw, volatileSlippageBps } from "../slippage.ts";
import { tokenAmount, mintDecimals, mintExtensions, mintFreezable, EXT, ISSUER_WORDS, issuerHold } from "./codec.ts";
import { agreedMint, BASE_FEE, PRIO_RESERVE, poolPriceRef, readAccounts, readAccountsPair, rentsOf, sleepless, TOKEN22_RENT, TOKEN_RENT, MAX_BUY_IMPACT_PCT, payOf, type Amount, type Ctx, type NeedsApproval, type Side, type SolPrepared, type SolQuote } from "./context.ts";
import { nativeSellWorks } from "./curve-trade.ts";
import { ataOf, PROGRAM, shortAddr, WSOL } from "./keys.ts";
import { buildTx, decodeTx, decompile, lookupTableAddresses, type Instruction, type LookupTable } from "./tx.ts";
import { onCopy } from "@zerofee/core/fork";

// (On the mainnet copy, VITE_FORK=1: its stand-in, which builds the swap on the copy's blockhash: core fork.ts, tools/fork/sol/jup.ts.)
export const JUP = `${onCopy("jup", ["https://lite-api.jup.ag"])[0]}/swap/v1`;
export const JUP_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** The keyless host allows 5 calls in any 10 s per IP, a sliding window (measured 21 Oct 2026; a 429 doesn't count). */
export const JUP_WINDOW_MS = 10_000;
export const JUP_PER_WINDOW = 5;
/** How long the quote waits for the swap build before it is shown without it. */
export const PHASE2_GRACE_MS = 350;
/** Jupiter labels of launch curves whose SELL Jupiter doesn't route dependably (Raydium LaunchLab 3 of 3 coins buy-only on 21 Oct, Meteora DBC one-way per pool). */
export const ONE_WAY_CURVES = /launchlab|bonding curve|moonit|boop|heaven|trends|memefun|virtuals/i;
const SLACK = 20_000n;
const NO_ROUTE = /could not find any route|no routes? found|COULD_NOT_FIND_ANY_ROUTE|NO_ROUTES_FOUND/i;
/** The AMMs the core lets a Jupiter route call (its pinned list, jup-programs.ts), by Jupiter's own labels: loaded with
 *  the first Jupiter quote, never in a screen's first load. */
let knownLabels: Promise<Set<string>> | undefined;
const labelsKnown = () => (knownLabels ??= import("@zerofee/core/sol/jup-programs").then((m) => new Set(Object.values(m.JUPITER_ROUTE_PROGRAMS))));
/** A quote's AMMs (Jupiter's labels) the core doesn't know: a route through one would be refused at the tap. */
export function unknownLabels(q: { routePlan?: { swapInfo?: { label?: string } }[] }, known: ReadonlySet<string>): string[] {
  return [...new Set((Array.isArray(q.routePlan) ? q.routePlan : []).map((r) => String(r?.swapInfo?.label ?? "")).filter((l) => !known.has(l)))];
}

interface JupQuote { inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct?: string; swapUsdValue?: string; routePlan?: { swapInfo?: { label?: string } }[]; [k: string]: unknown }
interface JupSwap { swapTransaction: string; lastValidBlockHeight: number; prioritizationFeeLamports?: number }

/** What the aggregator path remembers, per engine. */
export interface JupMemo { stamps: number[]; openHops: Map<string, number>; sellChecked: Map<string, number> }
export const newJupMemo = (): JupMemo => ({ stamps: [], openHops: new Map(), sellChecked: new Map() });
export interface JupCtx extends Ctx { j: JupMemo; fetch: typeof fetch; sleep(ms: number): Promise<void>; graceMs?: number }

async function fetchJson<T>(c: JupCtx, url: string, init: RequestInit = {}, timeoutMs = 6000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try { res = await c.fetch(url, { ...init, signal: ctl.signal }); }
  catch (e) { throw new TradeError("node", `jup.ag: ${ctl.signal.aborted ? "timed out" : (e as Error)?.message ?? e}`); }
  finally { clearTimeout(timer); }
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (!res.ok) {
    const b = body as { error?: unknown; message?: unknown } | undefined;
    const msg = b?.error ?? b?.message ?? res.statusText;
    const text = typeof msg === "string" ? msg : JSON.stringify(msg);
    throw new TradeError(res.status === 429 || res.status >= 500 ? "node" : "unavailable", `jup.ag HTTP ${res.status}: ${text}`);
  }
  return body as T;
}

/** Every Jupiter call goes through this one gate: at most JUP_PER_WINDOW in any JUP_WINDOW_MS. A 429 or 5xx backs off with jitter and tries twice more. */
export async function jup<T>(c: JupCtx, url: string, init?: RequestInit): Promise<T> {
  const gate = async () => {
    const list = c.j.stamps;
    for (;;) {
      const t = c.now();
      while (list.length && t - list[0]! >= JUP_WINDOW_MS + 50) list.shift();
      if (list.length < JUP_PER_WINDOW) { list.push(t); return; }
      await c.sleep(list[0]! + JUP_WINDOW_MS + 50 - t + 20);
    }
  };
  const busy = (x: unknown) => x instanceof TradeError && x.kind === "node" && /HTTP (429|5\d\d)/.test(x.message);
  await gate();
  try { return await fetchJson<T>(c, url, init); }
  catch (e) {
    if (!busy(e)) throw e;
    let last: unknown = e;
    for (const [lo, hi] of [[700, 1400], [1500, 2500]] as const) {
      await c.sleep(lo + Math.random() * (hi - lo));
      await gate();
      try { return await fetchJson<T>(c, url, init); } catch (e2) { last = e2; if (!busy(e2)) throw e2; }
    }
    throw last;
  }
}

/**
 * A quote, first with restrictIntermediateTokens (hops only through liquid tokens). A coin whose only market is quoted in
 * another coin (about a third of new pump.fun curves on 21 Oct) has no route that way: it is asked again without the
 * restriction (the minimum out still holds the price) and remembered for 10 minutes.
 */
function jupQuote(c: JupCtx, mintIn: string, mintOut: string, amount: bigint, bps: number, forceOpen = false): Promise<JupQuote> {
  const coin = mintIn === WSOL ? mintOut : mintIn;
  const url = (restrict: boolean) => `${JUP}/quote?inputMint=${mintIn}&outputMint=${mintOut}&amount=${amount}&slippageBps=${bps}&restrictIntermediateTokens=${restrict}`;
  const open = forceOpen || (c.j.openHops.get(coin) ?? 0) > c.now();
  // audit T-5: the quote is a third party's answer; it is for exactly this amount, or it isn't this trade's quote
  const exact = (q: JupQuote): JupQuote => {
    let inAmount: bigint | undefined;
    try { inAmount = BigInt(String(q?.inAmount)); } catch { inAmount = undefined; }
    if (inAmount !== amount) throw new TradeError("unavailable", "The route quoted another amount than this trade: refused", "not-this-swap");
    return q;
  };
  // the test refused buy (3 Nov): a route through an AMM the core doesn't know is asked again without it, once,
  // so the tap never meets "an app ZeroFee doesn't know"; with no other route the coin is said to have none
  const known = async (q: JupQuote, u: string): Promise<JupQuote> => {
    const labels = await labelsKnown();
    const odd = unknownLabels(q, labels);
    if (!odd.length) return q;
    const again = exact(await jup<JupQuote>(c, `${u}&excludeDexes=${encodeURIComponent(odd.join(","))}`).catch((e) => {
      if (e instanceof TradeError && e.kind === "unavailable" && NO_ROUTE.test(e.message)) throw new TradeError("unavailable", "This coin only trades through an app ZeroFee doesn't know yet", "unknown-app");
      throw e;
    }));
    if (unknownLabels(again, labels).length) throw new TradeError("unavailable", "This coin only trades through an app ZeroFee doesn't know yet", "unknown-app");
    return again;
  };
  let asked = url(!open);
  return jup<JupQuote>(c, asked).catch((e) => {
    if (open || !(e instanceof TradeError) || e.kind !== "unavailable" || !NO_ROUTE.test(e.message)) throw e;
    asked = url(false);
    return jup<JupQuote>(c, asked).then((q) => { c.j.openHops.set(coin, c.now() + 600_000); return q; });
  }).then(exact).then((q) => known(q, asked));
}

/**
 * NEVER A BUY THAT CAN'T BE SOLD: a buy routed through a one-way curve is offered only if what it gets can be sold back,
 * by Jupiter (a sell quote) or natively (the buy and the sell in one simulated transaction). A "sells back" is remembered
 * SELL_VERDICT_MS per coin, and while it stands no Jupiter call is spent on it (4 Nov: a Bags coin's quote, Meteora DBC
 * through Jupiter, took 11 to 12 s, its sell quote queued behind the 5-calls-per-10-s gate). A coin the curve takes back
 * natively trades natively for 10 minutes (no Jupiter call to wait for or be rate-limited on).
 */
export const SELL_VERDICT_MS = 10 * 60_000;
async function sellBackCheck(c: JupCtx, mint: string, q: JupQuote, payRaw: bigint, bps: number): Promise<void> {
  const labels = (Array.isArray(q.routePlan) ? q.routePlan : []).map((r) => String(r?.swapInfo?.label ?? ""));
  if (!labels.some((l) => ONE_WAY_CURVES.test(l)) || c.now() - (c.j.sellChecked.get(mint) ?? -Infinity) < SELL_VERDICT_MS) return;
  const out = BigInt(q.outAmount);
  // sell back what the buy is SURE to get (the route's minimum): Jupiter's quoted out can be more than the curve's own
  // buy gives, and selling more than was bought fails the simulation
  const sure = BigInt(q.otherAmountThreshold);
  let jupSays: "yes" | "no" | "unknown";
  try { await jupQuote(c, mint, WSOL, out, bps, true); jupSays = "yes"; }
  catch (e) { jupSays = e instanceof TradeError && e.kind === "unavailable" ? "no" : "unknown"; }
  if (jupSays === "yes") { c.j.sellChecked.set(mint, c.now()); return; }
  const native = await nativeSellWorks(c, mint, payRaw, sure > 0n && sure < out ? sure : out).catch(() => undefined);
  if (native === true) { c.j.sellChecked.set(mint, c.now()); return; }
  if (jupSays === "no" || native === false) throw new TradeError("unsellable", "This coin could not be sold back right now");
}

/** Jupiter's priceImpactPct, as a percent; at or above 99 % it is no figure (undefined). PumpSwap pools with SOL as the
 *  base report "1" (100 %) on any amount, while a real round trip through them returns 99.4 % (4 Nov: PREDICT, XTEN). */
export const BOGUS_IMPACT_FRACTION = 0.99;
export function jupiterImpact(q: { priceImpactPct?: string }): number | undefined {
  const f = Number(q.priceImpactPct ?? 0);
  return Number.isFinite(f) && f < BOGUS_IMPACT_FRACTION ? f * 100 : undefined;
}

/** A quote's price impact in percent: Jupiter's own figure, or when that is bogus, Trade's own, from the unit price the
 *  route pays against the market's (meta.priceUsd), never below 0. Neither: NaN (unknown). */
export function impactOf(q: { priceImpactPct?: string; inAmount: string; outAmount: string }, side: Side, payRaw: bigint, solUsd: number, decimals: number, priceUsd?: number): number {
  const jup = jupiterImpact(q);
  if (jup !== undefined) return jup;
  if (!(priceUsd && priceUsd > 0 && Number.isFinite(priceUsd) && solUsd > 0)) return NaN;
  const coins = (raw: bigint | string) => Number(raw) / 10 ** decimals;
  if (side === "buy") {
    const got = coins(q.outAmount);
    if (!(got > 0)) return NaN;
    const unit = rawToUsd(payRaw, 9, solUsd) / got;
    return Math.max(0, (unit / priceUsd - 1) * 100);
  }
  const worth = coins(payRaw) * priceUsd;
  if (!(worth > 0)) return NaN;
  return Math.max(0, (1 - rawToUsd(q.outAmount, 9, solUsd) / worth) * 100);
}

/** The most a silent Jupiter buy may pay over an independent price of the coin (as the direct path's PRICE_SLACK). */
export const JUP_PRICE_SLACK = 1.3;
/** A price of the coin none of whose inputs are Jupiter's: the market data's (its liquidity halved for the SOL side), or
 *  the direct path's own pool read (context.ts poolPriceRef). Dollars per whole coin. */
export interface PriceRef { usd: number; solSideUsd?: number }
export function buyPriceRef(meta: { priceUsd?: number; liquidityUsd?: number } | undefined, pool: { lamportsPerRaw: number; solLamports: number } | undefined, solUsd: number, decimals: number): PriceRef | undefined {
  if (meta?.priceUsd && meta.priceUsd > 0 && Number.isFinite(meta.priceUsd)) return { usd: meta.priceUsd, ...(meta.liquidityUsd && meta.liquidityUsd > 0 ? { solSideUsd: meta.liquidityUsd / 2 } : {}) };
  if (pool && solUsd > 0) return { usd: (pool.lamportsPerRaw * 10 ** decimals / 1e9) * solUsd, solSideUsd: (pool.solLamports / 1e9) * solUsd };
  return undefined;
}
/**
 * Audit finding 1 (4 Nov): a Jupiter buy's unit price against PriceRef, never against Jupiter's own priceImpactPct (the
 * old band was 3x the market widened by that figure: up to 4.5x). Up to JUP_PRICE_SLACK it is offered as is; beyond, only
 * the trade's own share of the pool can justify it (constant product: a buy of D into a SOL side R pays (1 + D/R) x spot,
 * D/R at most MAX_BUY_IMPACT_PCT), and then only with the person's approval ("high-impact"); past that it is refused. No
 * reference: "unpriced" (the person approves it on a sheet; a silent trade doesn't sign it). `ratio`: unit / reference.
 */
export function jupiterBuyGate(o: { payRaw: bigint; out: bigint; decimals: number; solUsd: number; ref?: PriceRef }): { ratio?: number; approve?: NeedsApproval } {
  if (!o.ref || !(o.ref.usd > 0) || o.out <= 0n || o.payRaw <= 0n) return { approve: "unpriced" };
  const paidUsd = rawToUsd(o.payRaw, 9, o.solUsd);
  const ratio = paidUsd / (Number(o.out) / 10 ** o.decimals) / o.ref.usd;
  if (!Number.isFinite(ratio)) return { approve: "unpriced" };
  if (ratio <= JUP_PRICE_SLACK) return { ratio };
  const share = o.ref.solSideUsd && o.ref.solSideUsd > 0 ? Math.min(paidUsd / o.ref.solSideUsd, MAX_BUY_IMPACT_PCT / 100) : 0;
  if (ratio > (1 + share) * JUP_PRICE_SLACK) throw new TradeError("unavailable", "The route's price is far above the market: refused");
  return { ratio, approve: "high-impact" };
}

/** The slippage a built route carries (its route instruction ends in in_amount u64, quoted_out u64, slippage_bps u16, platform_fee_bps u8). */
export function routeSlippageBps(b64: string): number | undefined {
  try {
    const t = decodeTx(b64);
    for (const ci of t.instructions) {
      if (t.staticKeys[ci.programIdIndex] !== JUP_PROGRAM || ci.data.length < 19) continue;
      return ci.data[ci.data.length - 3]! | (ci.data[ci.data.length - 2]! << 8);
    }
  } catch { /* not a transaction we can read */ }
  return undefined;
}

/** The two exact-in route instructions (Anchor's first 8 bytes of sha256 "global:route", "global:shared_accounts_route"),
 *  the ones the recorded routes use (fixtures/jup-routes.json); any other kind is not read as a route. */
const EXACT_IN_ROUTES = [[0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a], [0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81]];
/** shared_accounts_route: authority at 2, destination at 6, output mint at 8 (route: 1, 3, 5; its optional destination at 4). */
const SHARED_ROUTE = EXACT_IN_ROUTES[1]!;

/** A Jupiter route instruction's own terms: its data ends in in_amount u64, quoted_out u64, slippage_bps u16,
 *  platform_fee_bps u8. */
export function routeTerms(data: Uint8Array): { inAmount: bigint; quotedOut: bigint; slippageBps: number; feeBps: number } | undefined {
  if (data.length < 8 + 19 || !EXACT_IN_ROUTES.some((h) => h.every((x, i) => data[i] === x))) return undefined;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength), at = data.length - 19;
  return { inAmount: v.getBigUint64(at, true), quotedOut: v.getBigUint64(at + 8, true), slippageBps: v.getUint16(at + 16, true), feeBps: data[at + 18]! };
}

/**
 * Audit SOL-4: Jupiter's built transaction is a third party's bytes, so it's signed only if it is the quoted swap and
 * nothing else. Exactly one route instruction, whose amount in is the quote's, whose quoted out is at least the quote's
 * (the floor the screen shows comes from it), no platform fee, and no looser slippage than asked; besides it, only the
 * plumbing a swap needs: the compute budget, the wallet's own token accounts made or closed (rent back to the wallet),
 * the wallet's SOL wrapped into its own wSOL account and synced. Any other movement (a token transfer, an approval, SOL to
 * anyone else, another program) is refused.
 */
export function checkJupiterSwap(ixs: readonly Instruction[], o: { owner: string; inAmount: bigint; quotedOut: bigint; bps: number; outMint?: string; maxPrioLamports?: bigint }): bigint {
  const no = (why: string) => new TradeError("unavailable", `The route built a transaction that isn't this swap (${why}): refused`, "not-this-swap");
  const wsolAta = ataOf(o.owner, WSOL, PROGRAM.token);
  let routes = 0;
  for (const i of ixs) {
    const k = (n: number) => i.keys[n]?.pubkey;
    if (i.programId === JUP_PROGRAM) {
      const t = routeTerms(i.data);
      if (!t) throw no("a route kind it can't read");
      if (t.inAmount !== o.inAmount) throw no("another amount in");
      if (t.quotedOut < o.quotedOut) throw no("a smaller quoted amount out");
      if (t.slippageBps > o.bps + 1) throw no("a looser price floor");
      if (t.feeBps !== 0) throw no("a platform fee");
      // its accounts (recheck RT-1: the terms were checked, never where the swap pays): the wallet signs as the transfer
      // authority, the output lands in the wallet's own account for the coin it says it delivers (and, when the trade
      // says which coin, that one), and no other destination stands in for it
      const shared = SHARED_ROUTE.every((x, n) => i.data[n] === x);
      const [auth, dest, alt, mint] = shared ? [k(2), k(6), undefined, k(8)] : [k(1), k(3), k(4), k(5)];
      if (auth !== o.owner) throw no("someone else signs for the swap");
      if (!mint || (o.outMint && mint !== o.outMint)) throw no("another coin out");
      if (dest !== ataOf(o.owner, mint, PROGRAM.token) && dest !== ataOf(o.owner, mint, PROGRAM.token2022)) throw no("its coins paid to someone else's account");
      if (alt !== undefined && alt !== JUP_PROGRAM && alt !== dest) throw no("its coins paid to someone else's account");
      routes++;
      continue;
    }
    if (i.programId === PROGRAM.computeBudget) {
      // audit T-4: only the limit and the price, once each; what they pay is bounded below
      const op = i.data[0];
      if (!((op === 2 && i.data.length === 5) || (op === 3 && i.data.length === 9))) throw no("a compute budget it can't read");
      if (ixs.filter((x) => x.programId === PROGRAM.computeBudget && x.data[0] === op).length > 1) throw no("its compute budget set twice");
      continue;
    }
    if (i.programId === PROGRAM.ata) {
      // create / create-idempotent: paid by the wallet, for the wallet
      if (k(0) !== o.owner || k(2) !== o.owner) throw no("a token account for someone else");
      continue;
    }
    if (i.programId === PROGRAM.token || i.programId === PROGRAM.token2022) {
      const op = i.data[0];
      if (op === 17) continue;                                                    // SyncNative: the wallet's wSOL balance
      if (op === 9 && k(1) === o.owner && k(2) === o.owner) continue;             // CloseAccount: rent back to the wallet
      throw no("a token movement besides the swap");
    }
    if (i.programId === PROGRAM.system) {
      // only the wrap: the wallet's SOL into its own wSOL account
      const v = new DataView(i.data.buffer, i.data.byteOffset, i.data.byteLength);
      if (i.data.length >= 4 && v.getUint32(0, true) === 2 && k(0) === o.owner && k(1) === wsolAta) continue;
      throw no("SOL sent somewhere else");
    }
    throw no("another program");
  }
  if (routes !== 1) throw no(routes ? "more than one route" : "no route");
  const prio = priorityFeeOf(ixs);
  if (o.maxPrioLamports !== undefined && prio > o.maxPrioLamports) throw new TradeError("unavailable", `The route's network fee is higher than this trade allows (${prio} lamports): refused`, "not-this-swap");
  return prio;
}

/** Solana's default compute limit per instruction (no SetComputeUnitLimit), and a transaction's most. */
const DEFAULT_CU_PER_IX = 200_000n, MAX_CU = 1_400_000n;
/**
 * The priority fee a transaction really pays (audit T-4), from its own compute-budget instructions: limit x price / 1e6,
 * rounded up. Without a limit instruction the limit is 200k for each other instruction (at most 1.4M), as the runtime does.
 * Never what the swap builder SAYS the fee is (Jupiter's `prioritizationFeeLamports`).
 */
export function priorityFeeOf(ixs: readonly Instruction[]): bigint {
  let limit: bigint | undefined, price = 0n;
  for (const i of ixs) {
    if (i.programId !== PROGRAM.computeBudget) continue;
    const v = new DataView(i.data.buffer, i.data.byteOffset, i.data.byteLength);
    if (i.data[0] === 2 && i.data.length === 5) limit = BigInt(v.getUint32(1, true));
    if (i.data[0] === 3 && i.data.length === 9) price = v.getBigUint64(1, true);
  }
  const others = BigInt(ixs.filter((i) => i.programId !== PROGRAM.computeBudget).length);
  let cu = limit ?? others * DEFAULT_CU_PER_IX;
  if (cu > MAX_CU) cu = MAX_CU;
  return (cu * price + 999_999n) / 1_000_000n;
}
/** Room above the fee asked (Jupiter rounds its price up per compute unit). */
const PRIO_ROUNDING = 2_000n;

/** The route's instructions with its lookup tables resolved (one read for the tables). */
async function decompiled(c: Ctx, b64: string): Promise<{ payer: string; blockhash: string; instructions: Instruction[]; tables: LookupTable[] }> {
  const t = decodeTx(b64);
  const keys = t.lookups.map((l) => l.table);
  const rows = keys.length ? await readAccounts(c, keys) : [];
  const tables = keys.map((k, i) => { const r = rows[i]; if (!r) throw new TradeError("unavailable", "A route table could not be read"); return { key: k, addresses: lookupTableAddresses(r.data) }; });
  return { ...decompile(t, tables), tables };
}

/** A token account to close at the end of the swap (rent back to the wallet); `harvestMint` = a transfer-fee coin's mint, harvested first. */
export interface CloseSpec { ata: string; program: string; harvestMint?: string }

/**
 * The token accounts a route opens for the wallet besides the coin's and wSOL's: a coin quoted in another coin is bought
 * SOL -> PUMP -> coin, and Jupiter leaves the wallet's PUMP account open and empty, holding its rent.
 */
export function routeOpens(instructions: Instruction[], owner: string, coin: string): CloseSpec[] {
  const out: CloseSpec[] = [];
  for (const i of instructions) {
    if (i.programId !== PROGRAM.ata || i.keys.length < 6) continue;           // create / createIdempotent: payer, ata, owner, mint, system, token program
    const [ata, who, mint, program] = [i.keys[1]!.pubkey, i.keys[2]!.pubkey, i.keys[3]!.pubkey, i.keys[5]!.pubkey];
    if (who === owner && mint !== coin && mint !== WSOL && !out.some((x) => x.ata === ata)) out.push({ ata, program });
  }
  return out;
}

/** The route with token accounts closed at its end, lookup tables kept; the compute limit gets room for each close. */
export function withCloses(route: { payer: string; blockhash: string; instructions: Instruction[]; tables: LookupTable[] }, owner: string, closes: CloseSpec[]): string {
  const ixs = route.instructions.map((i) => {
    if (i.programId !== PROGRAM.computeBudget || i.data[0] !== 2 || i.data.length !== 5) return i;
    const v = new DataView(i.data.buffer, i.data.byteOffset, 5);
    const data = i.data.slice();
    new DataView(data.buffer).setUint32(1, Math.min(1_400_000, v.getUint32(1, true) + closes.reduce((n, c) => n + (c.harvestMint ? 20_000 : 12_000), 0)), true);
    return { ...i, data };
  });
  for (const c of closes) {
    if (c.harvestMint && c.program === PROGRAM.token2022) ixs.push({ programId: PROGRAM.token2022, keys: [{ pubkey: c.harvestMint, isSigner: false, isWritable: true }, { pubkey: c.ata, isSigner: false, isWritable: true }], data: Uint8Array.of(26, 4) });
    ixs.push({ programId: c.program, keys: [{ pubkey: c.ata, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false }], data: Uint8Array.of(9) });
  }
  return buildTx(route.payer, route.blockhash, ixs, route.tables);
}

/** The mint (program, decimals, transfer fee) and the wallet's coin account, in one read. */
async function readCoin(c: Ctx, owner: string, mint: string) {
  const a1 = ataOf(owner, mint, PROGRAM.token), a2 = ataOf(owner, mint, PROGRAM.token2022);
  const pr = await readAccountsPair(c, [mint, a1, a2]);
  const [, t1, t2] = pr.rows;
  const m = agreedMint(pr, 0);                                              // the mint's gates on two nodes (audit T-6)
  if (!m) throw new TradeError("unavailable", "That coin was not found on Solana");
  if (m.owner !== PROGRAM.token && m.owner !== PROGRAM.token2022) throw new TradeError("unavailable", "That is not a Solana token");
  const program = m.owner, t = program === PROGRAM.token2022 ? t2 : t1, ata = program === PROGRAM.token2022 ? a2 : a1;
  const held = c.memory.fix(BalanceMemory.key(owner, mint), t ? tokenAmount(t.data) : 0n, c.now());
  // a node a few slots behind may not show the account a buy made seconds ago while the memory (the fill) knows the coins are there
  const exists = !!t || held > 0n;
  const ext = program === PROGRAM.token2022 ? mintExtensions(m.data) : undefined;
  const transferFee = !!ext?.types.has(EXT.transferFeeConfig);
  return { program, decimals: mintDecimals(m.data), ata, ataExists: exists, held, ataLamports: t ? t.lamports : exists ? (program === PROGRAM.token2022 ? TOKEN22_RENT : TOKEN_RENT) : 0n, transferFee, freezable: mintFreezable(m.data), hold: ext ? issuerHold(ext) : undefined };
}

/** Max keeps what this transaction and the later sell need; a route that opens one more account (a middle hop) needs one more rent, so Max is built again keeping it (at most twice). */
export async function prepareJupiter(c: JupCtx, side: Side, mint: string, amount: Amount): Promise<SolPrepared> {
  let extra = 0n;
  let ctx = c;
  for (;;) {
    try { return await prepareOnce(ctx, side, mint, amount, extra); }
    catch (e) {
      if (side === "buy" && "max" in amount && e instanceof TradeError && e.kind === "funds" && extra < 2n * TOKEN22_RENT) { extra += TOKEN22_RENT; continue; }
      // the route's own simulation says the price already moved past the floor: built ONCE more at the re-quote's wider floor
      if (e instanceof TradeError && e.kind === "moved" && ctx.attempt === 0) { ctx = { ...ctx, attempt: 1 }; continue; }
      throw e;
    }
  }
}

async function prepareOnce(c: JupCtx, side: Side, mint: string, amount: Amount, extra: bigint): Promise<SolPrepared> {
  const { d } = c;
  const owner = d.owner;
  const pxP = d.solUsd();
  const metaP = d.meta ? sleepless(d.meta(mint), 800) : Promise.resolve(undefined);
  const balP = d.rpc.call("getBalance", [owner, { commitment: "confirmed" }]).then((r: any) => c.memory.fix(BalanceMemory.key(owner), BigInt(r?.value ?? 0), c.now()));
  const rest = Promise.all([balP, readCoin(c, owner, mint), metaP, rentsOf(c)]);
  const px = await pxP;
  // the market data the page already holds sets the early quote's slippage, so that quote is the one used
  const meta0 = await Promise.race([metaP, new Promise<undefined>((r) => setTimeout(() => r(undefined), 40))]);
  // everything that doesn't wait on another answer starts now: the priority fee, and for a dollar buy the quote itself
  const feeP75 = d.rpc.call("getRecentPrioritizationFees", [[mint]]).then((rows: unknown) => {
    const v = (Array.isArray(rows) ? rows : []).map((r: { prioritizationFee?: number }) => Number(r?.prioritizationFee ?? 0)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    return v.length ? BigInt(Math.ceil((v[Math.min(v.length - 1, Math.floor(v.length * 0.75))]! * 200_000) / 1_000_000)) : undefined;
  }).catch(() => undefined);
  const mintIn = side === "buy" ? WSOL : mint, mintOut = side === "buy" ? mint : WSOL;
  const widen = 1 + 0.5 * c.attempt;
  // the coin's moves: Trade's own quotes' (free to widen) and the market data's (capped, slippage.ts MARKET_WIDEN_MAX_BPS)
  const moves = (m?: { moveBps60s?: number }) => ({ ownMoveBps: c.moves.bps(mint, c.now()), watched: c.moves.watched(mint, c.now()), ...(m?.moveBps60s !== undefined ? { moveBps: m.moveBps60s } : {}) });
  const early = side === "buy" && "usd" in amount ? (() => {
    const pay = usdToRaw(amount.usd, px, 9);
    const bps0 = volatileSlippageBps({ baseBps: autoSlippageBps({ liquidityUsd: meta0?.liquidityUsd, tradeUsd: amount.usd }), liquidityUsd: meta0?.liquidityUsd, ...moves(meta0), change24hPct: meta0?.change24hPct, widen });
    const p = pay > 0n ? jupQuote(c, mintIn, mintOut, pay, bps0) : Promise.reject(new TradeError("funds", "Not enough SOL for this buy and its fee", "sol-low"));
    p.catch(() => undefined);
    return { pay, bps0, p };
  })() : undefined;
  const [bal, sc, meta, rents] = await rest;
  const symbol = meta?.symbol ?? shortAddr(mint);
  if (side === "buy" && sc.hold) throw new TradeError("unsellable", ISSUER_WORDS[sc.hold], sc.hold);   // named before a freeze authority, as on every path
  if (side === "buy" && sc.freezable) throw new TradeError("unsellable", "Its issuer can freeze it, so a sell could be stopped", "freezable");
  const rentNew = sc.ataExists ? 0n : sc.program === PROGRAM.token2022 ? rents.token22 : rents.token;
  const wsolRent = rents.token;
  const payRaw = payOf(side, amount, { bal: side === "buy" && "max" in amount ? bal - extra : bal, held: sc.held, solUsd: px, rentNew, wsolRent, symbol });

  // the priority fee: the p75 of recent fees for this coin, priced for a 200k-CU swap, at most 1% of the trade
  const capLamports = (() => { const v = (side === "buy" ? payRaw : 100_000_000n) / 100n; return v < 10_000n ? 10_000n : v > 500_000n ? 500_000n : v; })();
  const feeRead = feeP75.then((l) => (l === undefined ? undefined : l < 1_000n ? 1_000n : l > capLamports ? capLamports : l));
  const tradeUsd0 = side === "buy" ? rawToUsd(payRaw, 9, px) : meta?.priceUsd ? rawToUsd(payRaw, sc.decimals, meta.priceUsd) : 0;
  const slip = (tradeUsd: number, impactPct?: number) => volatileSlippageBps({ baseBps: autoSlippageBps({ liquidityUsd: meta?.liquidityUsd, tradeUsd, impactPct }), liquidityUsd: meta?.liquidityUsd, ...moves(meta), impactPct, change24hPct: meta?.change24hPct, widen });
  let bps = slip(tradeUsd0);
  // the quote started with the reads is used when the figure picked now is within 50 bps of it
  let q = early && early.pay === payRaw && Math.abs(bps - early.bps0) <= 50 ? await early.p.then((x) => { bps = early.bps0; return x; }, () => undefined) : undefined;
  q ??= await jupQuote(c, mintIn, mintOut, payRaw, bps);
  let impact = impactOf(q, side, payRaw, px, sc.decimals, meta?.priceUsd);
  const tradeUsd = side === "buy" ? tradeUsd0 : rawToUsd(q.outAmount, 9, px);
  const bps2 = slip(tradeUsd, Number.isFinite(impact) ? impact : 0);
  if (bps2 > bps + 50) { bps = bps2; q = await jupQuote(c, mintIn, mintOut, payRaw, bps); impact = impactOf(q, side, payRaw, px, sc.decimals, meta?.priceUsd); }
  if (!q.outAmount || q.outAmount === "0") throw new TradeError("unavailable", "No route for this coin right now");
  if (BigInt(q.otherAmountThreshold) < applyBps(BigInt(q.outAmount), bps) - 1n) throw new TradeError("unavailable", "The route's price floor is lower than asked: refused");
  // Trade's own price of the coin from before this quote (a sale's band below may stand on it); a sale's own quote is
  // noted only once it passed that band, so a lowball never becomes the reference for the next one
  const ownBefore = c.moves.last(mint, c.now());
  if (side === "buy") c.moves.note(mint, c.now(), Number(q.outAmount) / Number(q.inAmount));
  if (side === "buy") await sellBackCheck(c, mint, q, payRaw, bps);

  const out = BigInt(q.outAmount), min = BigInt(q.otherAmountThreshold);
  // a buy that moves the pool more than MAX_BUY_IMPACT_PCT is too thin; a route far above an independent price isn't
  // offered (jupiterBuyGate: the market data's price, else the direct path's two-node pool read; never Jupiter's own
  // figure). A sell is never refused as thin; its band is below
  let approve: NeedsApproval | undefined;
  if (side === "buy") {
    const ref = buyPriceRef(meta, poolPriceRef(c, mint), px, sc.decimals);
    // Jupiter's figure unknown (bogus): Trade's own, from the same independent price; with none, the buy isn't offered
    const ratio = ref && out > 0n ? rawToUsd(payRaw, 9, px) / (Number(out) / 10 ** sc.decimals) / ref.usd : NaN;
    if (!Number.isFinite(impact) && Number.isFinite(ratio)) impact = Math.max(0, (ratio - 1) * 100);
    if (!Number.isFinite(impact)) throw new TradeError("unavailable", "This buy's price couldn't be checked right now", "prices");
    if (impact > MAX_BUY_IMPACT_PCT) throw new TradeError("unavailable", "The pool is too thin for this amount", "thin");
    approve = jupiterBuyGate({ payRaw, out, decimals: sc.decimals, solUsd: px, ref }).approve;
  }
  // audit T-5 / T2-1: a sale is held to a market band, none of whose inputs are Jupiter's own words. The SOL it pays is
  // valued at `px`, the core's price (R-2: 1Click's, asked directly, with a witness). The coins sold are valued at the
  // market data's price, else at Trade's own last price of the coin (its quotes before this one). The room for a thin pool
  // is the constant-product share a pool of the market's liquidity would pay (half of it on each side), else 10 %; then a
  // factor of 3. Jupiter's priceImpactPct no longer widens it. With no price to hold it to, the sale isn't offered
  // ("Coin prices are busy right now"): it is again once the market data, or a buy's quote of the coin, gives a price.
  if (side === "sell" && payRaw > 0n) {
    const coins = Number(payRaw) / 10 ** sc.decimals;
    const ownUsd = ownBefore && ownBefore > 0 ? (10 ** sc.decimals / ownBefore / 1e9) * px : undefined;   // coin raw per lamport -> $ per coin
    const ref = meta?.priceUsd && meta.priceUsd > 0 ? meta.priceUsd : ownUsd;
    if (!(ref && ref > 0 && Number.isFinite(ref))) throw new TradeError("unavailable", "This sale's price couldn't be checked right now", "prices");
    const worth = coins * ref, side1 = meta?.liquidityUsd && meta.liquidityUsd > 0 ? meta.liquidityUsd / 2 : undefined;
    const share = side1 !== undefined ? side1 / (side1 + worth) : 0.1;
    if (worth > 0 && rawToUsd(out, 9, px) < (worth * share) / 3) throw new TradeError("unavailable", "The route pays far below the market for this coin: refused", "not-this-swap");
    c.moves.note(mint, c.now(), Number(q.inAmount) / Number(q.outAmount));
  }
  const payUsd = side === "buy" ? rawToUsd(payRaw, 9, px) : Number(q.swapUsdValue ?? 0) || rawToUsd(out, 9, px);
  const getUsd = side === "buy" ? payUsd * (1 - Math.max(0, Number.isFinite(impact) ? impact : 0) / 100) : rawToUsd(out, 9, px);
  const expiresAt = c.now() + (d.quoteTtlMs ?? 20_000);
  // a floor over 5 %, a buy over 15 % impact, or the price gate's own reason: the person approves it on a sheet (finding 2)
  const needs = approvalNeeded({ side, slippageBps: bps, priceImpactPct: Number.isFinite(impact) ? impact : undefined, needsApproval: approve });
  const mkQuote =(feeLamports: bigint, closed: boolean): SolQuote => ({
    side, chain: "sol", coin: mint, symbol, decimals: sc.decimals, payRaw: payRaw.toString(), payUsd, getRaw: out.toString(), getUsd, getMinRaw: min.toString(),
    feeRaw: feeLamports.toString(), feeUsd: rawToUsd(feeLamports, 9, px), route: "Jupiter", slippageBps: bps, priceImpactPct: Number.isFinite(impact) ? impact : undefined, expiresAt,
    ...(rentNew > 0n ? { rentUsd: rawToUsd(rentNew, 9, px) } : {}),
    ...(closed ? { rentBackUsd: rawToUsd(sc.ataLamports, 9, px), closesAccount: true } : {}),
    ...(needs ? { needsApproval: needs } : {}),
  });
  const quote0 = mkQuote(BASE_FEE + ((await Promise.race([feeRead, Promise.resolve(undefined)])) ?? 10_000n) + rentNew, false);

  // PHASE 2: the swap transaction, its simulation and the closes. The quote above is what the person needs to see and tap.
  const phase2 = (async () => {
    const prioLamports = await feeRead;
    const swap = await jup<JupSwap>(c, `${JUP}/swap`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: q, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: prioLamports !== undefined ? Number(prioLamports) : { priorityLevelWithMaxLamports: { maxLamports: Number(capLamports), priorityLevel: "high" } },
      }),
    });
    if (!swap.swapTransaction) throw new TradeError("unavailable", "No route for this coin right now");
    // the wallet must be the only signer and the fee payer (the Security layer refuses anything else)
    const shape0 = decodeTx(swap.swapTransaction);
    if (shape0.header[0] !== 1 || shape0.staticKeys[0] !== owner) throw new TradeError("unavailable", "The route built a transaction this wallet will not sign");
    const carried = routeSlippageBps(swap.swapTransaction);
    if (carried !== undefined && carried > bps + 1) throw new TradeError("unavailable", "The route built a looser price floor than asked: refused", "not-this-swap");
    // it must be the quoted swap and nothing else (audit SOL-4): unreadable (its tables not read) is refused too
    const shape = await decompiled(c, swap.swapTransaction).catch(() => undefined);
    if (!shape) throw new TradeError("unavailable", "The route's transaction could not be read here: refused", "not-this-swap");
    // the priority fee is the transaction's own (limit x price), never Jupiter's word for it, and at most the cap asked (audit T-4)
    const prio = checkJupiterSwap(shape.instructions, { owner, inAmount: payRaw, quotedOut: BigInt(q.outAmount), bps, outMint: mintOut, maxPrioLamports: capLamports + PRIO_ROUNDING });

    const simulate = (tx: string) => d.rpc.call("simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: side === "buy" ? [owner, sc.ata] : [owner] } }]);
    // a FULL sell closes the now-empty coin account in the same transaction; the accounts a route opens for a middle hop close too
    const closing = side === "sell" && sc.ataExists && payRaw === sc.held;
    const opens = routeOpens(shape.instructions, owner, mint);
    const coinClose: CloseSpec[] = closing ? [{ ata: sc.ata, program: sc.program, harvestMint: sc.transferFee ? mint : undefined }] : [];
    const variant = async (closes: CloseSpec[]) => {
      if (!closes.length || !shape) return undefined;
      try {
        const tx = withCloses(shape, owner, closes);
        // the closes raise the compute limit at the route's price: what that pays is checked again (audit T-4)
        if (priorityFeeOf(decompile(decodeTx(tx), shape.tables).instructions) > capLamports + PRIO_ROUNDING * 4n) return undefined;
        return { tx, closes, sim: await simulate(tx) };
      } catch { return undefined; }
    };
    const [sim, allTry] = await Promise.all([simulate(swap.swapTransaction), variant([...opens, ...coinClose])]);
    // every close didn't pass (dust left in a middle account, or the coin's account can't be closed): the coin's close alone, then the middle ones alone
    const passes = (t: Awaited<ReturnType<typeof variant>>) => !!t && !t.sim?.value?.err;
    let closeTry = passes(allTry) ? allTry : undefined;
    if (!closeTry && opens.length && coinClose.length) { const a = await variant(coinClose); closeTry = passes(a) ? a : undefined; }
    if (!closeTry && opens.length && coinClose.length) { const b = await variant(opens); closeTry = passes(b) ? b : undefined; }
    const v = sim?.value;
    if (v?.err) throw simProblem(v.err, v.logs);
    // a middle-hop account holds its rent (refundable; closed in the same transaction when the close passes): it isn't "more than the trade"
    const limit = (side === "buy" ? payRaw : 0n) + BASE_FEE + prio + rentNew + wsolRent + SLACK + BigInt(opens.length) * (rents.token22 + 100_000n);
    const guard = (value: any): bigint | undefined => {
      // what the test run says ARRIVES (recheck RT-1): a buy's coins in the wallet's own coin account, a sale's SOL in the
      // wallet, at least the floor the screen shows; a route that pays it anywhere else falls short and is refused
      if (side === "buy") {
        const data = value?.accounts?.[1]?.data?.[0];
        if (typeof data === "string" && data.length) {
          const raw = fromBase64(data);
          const after = raw.length >= 72 ? new DataView(raw.buffer, raw.byteOffset).getBigUint64(64, true) : 0n;
          if (after - sc.held < min) throw new TradeError("unavailable", "The test run doesn't bring the coins to this wallet: refused", "not-this-swap");
        }
      }
      const post = value?.accounts?.[0]?.lamports;
      if (post === undefined || post === null) return undefined;
      const drop = bal - BigInt(post);
      if (drop > limit) throw new TradeError("unavailable", "The route asked for more than the trade: refused", "not-this-swap");
      if (side === "sell" && BigInt(post) - bal + limit < min) throw new TradeError("unavailable", "The test run doesn't bring the SOL to this wallet: refused", "not-this-swap");
      return drop;
    };
    let drop = guard(v);
    let txB64 = swap.swapTransaction;
    let closed = false;
    if (closeTry) { try { const d2 = guard(closeTry.sim.value); txB64 = closeTry.tx; closed = closeTry.closes.some((x) => x.ata === sc.ata); drop = d2 ?? drop; } catch { /* the plain swap stays */ } }
    // the fee line is what the transaction really takes besides the trade: the simulation's own drop, never below the estimate
    let feeLamports = BASE_FEE + prio + rentNew;
    if (side === "buy" && drop !== undefined && drop - payRaw > feeLamports) feeLamports = drop - payRaw;
    return { quote: mkQuote(feeLamports, closed), tx: txB64, lastValid: swap.lastValidBlockHeight };
  })();
  let settled: "ok" | "failed" | undefined, failure: unknown;
  phase2.then(() => { settled = "ok"; }, (e) => { settled = "failed"; failure = e; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([phase2.catch(() => undefined), new Promise<void>((r) => { timer = setTimeout(r, c.graceMs ?? PHASE2_GRACE_MS); })]);
  clearTimeout(timer);
  if (settled === "failed") throw failure;                                // a refusal that came at once is the answer
  const keyOf = (qq: SolQuote) => `${side}|sol|${mint}|${qq.payRaw}|${qq.getMinRaw}|${qq.expiresAt}`;
  if (settled === "ok") {
    const r = await phase2;
    return { key: keyOf(r.quote), at: c.now(), quote: r.quote, steps: [{ id: "swap", tx: r.tx, lastValidBlockHeight: r.lastValid }], ready: async () => {} };
  }
  // still building (a slow network, a rate-limited API): the quote is shown now with the fee estimated; the build goes on,
  // and the Prepared stops being provisional once it lands (the old live build kept handing back the same provisional quote)
  const prep: SolPrepared = {
    key: keyOf(quote0), at: c.now(), quote: quote0, steps: [], provisional: true,
    ready: async () => { await phase2; },
  };
  phase2.then((r) => { Object.assign(quote0, r.quote); prep.steps.push({ id: "swap", tx: r.tx, lastValidBlockHeight: r.lastValid }); prep.provisional = false; }, () => undefined);
  return prep;
}
