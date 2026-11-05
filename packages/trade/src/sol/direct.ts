// The direct path: a Solana swap built from on-chain pool state, priced with the program's own maths, with no aggregator
// on the way. PumpSwap, the pump.fun curve (SOL-quoted) and Raydium CP-Swap. Anything else (Raydium AMM v4 / CLMM, Meteora,
// a curve quoted in another coin, a pool with a creator fee) has no direct route, and the caller goes on to the next path.
//
// One read (getMultipleAccounts: the pool, its vaults, the mint, the wallet and its token accounts) is all a quote needs.
// It is reused for 1 s, so a changed amount re-quotes with no network at all. The blockhash, priority fee, rent and the
// programs' configs are cached too. A route is proven by simulation the first time and then at most every 4 s; ready()
// waits for that answer only when there is no recent proof, so a failing swap is known before the tap.
import { fromBase64 } from "./bytes.ts";
import { EXT, ISSUER_WORDS, issuerHold, mintDecimals, mintExtensions, mintFreezable, mintSupply, readStruct, tokenAmount, type MintExtensions, type Struct } from "./codec.ts";
import { BalanceMemory } from "../balances.ts";
import { agreedMint, agreedStatic, blockhash, MAX_BUY_IMPACT_PCT, payOf, priorityLamports, priorityP75, readAccounts, readAccountsPair, rentsOf, sleepless, BASE_FEE, TOKEN22_RENT, TOKEN_RENT, type Amount, type CoinMeta, type Ctx, type Row, type Side, type SolPrepared, type SolQuote } from "./context.ts";
import { cpmmQuote, cpmmSupported, cpmmSwapIx, type CpmmState } from "./cpmm.ts";
import { isFinalRefusal, simProblem, TradeError } from "../errors.ts";
import { ammGlobalConfig, ataOf, bondingCurveOf, canonicalPumpSwapPool, cpmmAuthority, cpmmConfigAddress, cpmmPoolAddress, DEFAULT_KEY, feeConfigOf, PROGRAM, pumpGlobal, shortAddr, WSOL } from "./keys.ts";
import { AMM_FEE_CONFIG_SEED, AMM_LAYOUT, CPMM_LAYOUT, PUMP_FEE_CONFIG_SEED, PUMP_LAYOUT } from "./layouts.ts";
import { curveBuy, curveSell, curveSwapIx, type CurveState } from "./pumpfun.ts";
import { ammBuy, ammSell, ammSwapIx, type AmmState } from "./pumpswap.ts";
import { applyBps, autoSlippageBps, rawToUsd, volatileSlippageBps } from "../slippage.ts";
import { buildTx, closeAccount, computeLimit, computePrice, createAtaIdempotent, harvestWithheld, wrapSol, type Instruction } from "./tx.ts";

export type DirectKind = "pumpswap" | "pumpfun" | "cpmm";
type State = AmmState | CurveState | CpmmState;
/** A pool read is reused this long: a changed amount inside the window re-quotes with no network. */
export const FRESH_MS = 1_000;
export const ROUTE_TTL_MS = 600_000;
export const NO_ROUTE_TTL_MS = 120_000;
const STATIC_TTL_MS = 600_000;
const SIM_EVERY_MS = 4_000;
/** A route whose simulation passed this recently may be sent at the tap without waiting for the newer re-proof. */
export const PROOF_TRUST_MS = 30_000;

interface Route { kind: DirectKind; address: string; at: number; pool?: Struct; /** found by deriving its address (a CP-Swap fee tier), not as the coin's listed market: it may be a shallow side pool */ derived?: boolean }
interface Live {
  /** `alt`: the same pool as the second node read it (audit T-6): the floor is set only where both nodes agree. */
  at: number; st: State; alt: State; route: Route; supply: bigint; decimals: number; program: string;
  native: bigint; coinAta: string; coinAtaExists: boolean; held: bigint; coinAtaLamports: bigint; wsolAta: string;
  /** Token-2022 extensions of the mint (types) and its transfer fee in bps */
  ext: MintExtensions;
  /** The mint has a freeze authority: its issuer can freeze holders' accounts. */
  freezable: boolean;
}
interface SimInfo { units: number; tokenAfter?: bigint; lamportsAfter?: bigint }

/** The program that owns each kind of pool. */
const POOL_PROGRAM: Record<DirectKind, string> = { pumpswap: PROGRAM.pumpAmm, pumpfun: PROGRAM.pump, cpmm: PROGRAM.cpmm };
// A mayhem-mode curve is traded here too (k-trade real-money run, 4 Nov: DemWifHat Hjge…cpump went to Jupiter both ways,
// and its sell couldn't land). Checked on mainnet that day from the wallet holding it, simulated, nothing sent: pump.fun's
// program took the same v3 buy and sell (17 accounts) on that curve and paid exactly what curveBuy / curveSell quote.
const pumpCurveOk = (s: Struct) => !s.complete && s.quote_mint === DEFAULT_KEY && !s.is_cashback_coin;
const pumpPoolOk = (p: Struct, mint: string) => p.base_mint === mint && p.quote_mint === WSOL && !p.is_mayhem_mode && !p.is_cashback_coin;

/** Finds the coin's pool with no API where it can be derived (the curve; a graduated pump.fun coin's canonical PumpSwap pool; a CP-Swap fee tier), else from the coin's market data. */
async function discover(c: Ctx, mint: string): Promise<Route | undefined> {
  const curve = bondingCurveOf(mint), canon = canonicalPumpSwapPool(mint);
  const [cv, cp] = await readAccounts(c, [curve, canon]);
  if (cv && cv.owner === PROGRAM.pump && cv.data.length > 100 && pumpCurveOk(readStruct(PUMP_LAYOUT, "BondingCurve", cv.data))) return { kind: "pumpfun", address: curve, at: c.now() };
  if (cp && cp.owner === PROGRAM.pumpAmm) {
    const p = readStruct(AMM_LAYOUT, "Pool", cp.data);
    if (pumpPoolOk(p, mint)) return { kind: "pumpswap", address: canon, at: c.now(), pool: p };
  }
  // Raydium CP-Swap pools are derivable too: ["pool", config, mint0, mint1] for each fee tier (AmmConfig 0..11). The one with
  // the most liquidity (lp_supply) that is quoted here wins
  {
    const pools = Array.from({ length: 12 }, (_, i) => cpmmPoolAddress(cpmmConfigAddress(i), mint, WSOL));
    const rows = await readAccounts(c, pools);
    let best: Route | undefined, bestLp = -1n;
    rows.forEach((r, i) => {
      if (!r || r.owner !== PROGRAM.cpmm) return;
      const p = readStruct(CPMM_LAYOUT, "PoolState", r.data);
      if (p.status === 0 && !p.enable_creator_fee && (p.lp_supply as bigint) > bestLp) { bestLp = p.lp_supply; best = { kind: "cpmm", address: pools[i]!, at: c.now(), pool: p, derived: true }; }
    });
    if (best) return best;
  }
  // not derivable (a PumpSwap pool someone else made): the deepest PumpSwap / Raydium pools in the coin's market data,
  // checked on chain by owner program and mints. No third-party host is asked from the trade path
  const meta = c.d.meta ? await sleepless(c.d.meta(mint), 1_500) : undefined;
  const cands = (meta?.pools ?? []).filter((p) => /pumpswap|raydium/i.test(p.dex) && !/clmm|launchlab/i.test(p.dex)).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, 3).map((p) => p.address);
  if (!cands.length) return undefined;
  const rows = await readAccounts(c, cands);
  for (let i = 0; i < cands.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (r.owner === PROGRAM.pumpAmm) {
      const p = readStruct(AMM_LAYOUT, "Pool", r.data);
      if (pumpPoolOk(p, mint)) return { kind: "pumpswap", address: cands[i]!, at: c.now(), pool: p };
    } else if (r.owner === PROGRAM.cpmm) {
      const p = readStruct(CPMM_LAYOUT, "PoolState", r.data);
      if ((p.token_0_mint === mint && p.token_1_mint === WSOL) || (p.token_1_mint === mint && p.token_0_mint === WSOL)) return { kind: "cpmm", address: cands[i]!, at: c.now(), pool: p };
    }
  }
  return undefined;
}

async function staticsOf(c: Ctx, route: Route): Promise<Struct[]> {
  const key = route.kind + (route.kind === "cpmm" ? route.pool!.amm_config : "");
  const hit = c.m.statics.get(key);
  if (hit && c.now() - hit.at < STATIC_TTL_MS) return hit.v;
  let v: Struct[];
  // a program's fees and settings price every quote: two nodes, byte for byte (audit T-6)
  if (route.kind === "pumpswap") {
    const pr = await readAccountsPair(c, [ammGlobalConfig(), feeConfigOf(AMM_FEE_CONFIG_SEED)]);
    const g = agreedStatic(pr, 0), f = agreedStatic(pr, 1);
    if (!g || !f) throw new TradeError("unavailable", "PumpSwap config not found");
    v = [readStruct(AMM_LAYOUT, "GlobalConfig", g.data), readStruct(AMM_LAYOUT, "FeeConfig", f.data)];
  } else if (route.kind === "pumpfun") {
    const pr = await readAccountsPair(c, [pumpGlobal(), feeConfigOf(PUMP_FEE_CONFIG_SEED)]);
    const g = agreedStatic(pr, 0), f = agreedStatic(pr, 1);
    if (!g || !f) throw new TradeError("unavailable", "pump.fun config not found");
    v = [readStruct(PUMP_LAYOUT, "Global", g.data), readStruct(PUMP_LAYOUT, "FeeConfig", f.data)];
  } else {
    const cfg = agreedStatic(await readAccountsPair(c, [route.pool!.amm_config]), 0);
    if (!cfg) throw new TradeError("unavailable", "Raydium config not found");
    v = [readStruct(CPMM_LAYOUT, "AmmConfig", cfg.data)];
  }
  c.m.statics.set(key, { at: c.now(), v });
  return v;
}

/** One getMultipleAccounts: the pool, its vaults, the mint, the wallet and the wallet's two possible coin accounts. */
async function loadLive(c: Ctx, owner: string, mint: string): Promise<Live> {
  const m = c.m;
  let route: Route | undefined = m.routes.get(mint);
  if (!route || c.now() - route.at > ROUTE_TTL_MS) {
    // a coin with no pool here is remembered for NO_ROUTE_TTL_MS, so its next quotes go straight to the next path
    if (c.now() - (m.none.get(mint) ?? -Infinity) < NO_ROUTE_TTL_MS) throw new TradeError("unavailable", "No direct route");
    route = await discover(c, mint);
    if (!route) { m.none.set(mint, c.now()); throw new TradeError("unavailable", "No direct route"); }
    m.routes.set(mint, route);
  }
  const ataTok = ataOf(owner, mint, PROGRAM.token), ataT22 = ataOf(owner, mint, PROGRAM.token2022), wsolAta = ataOf(owner, WSOL, PROGRAM.token);
  const extra: string[] = route.kind === "pumpswap" ? [route.pool!.pool_base_token_account, route.pool!.pool_quote_token_account] : route.kind === "cpmm" ? [route.pool!.token_0_vault, route.pool!.token_1_vault] : [];
  // two nodes (audit T-6): the mint's gates must agree, and the pool is read from both, so its quote is checked on both.
  // Speed (3 Nov, traced on mainnet): the program's settings are read beside the pool, not before it: each two-node read
  // waits for the slower node (~1 s), so one wait instead of two. Both reads are as before
  const [statics, pr] = await Promise.all([staticsOf(c, route), readAccountsPair(c, [owner, route.address, mint, ataTok, ataT22, ...extra])]);
  const [me, pool, , t1, t2, v0, v1] = pr.rows;
  const mintRow = agreedMint(pr, 2);
  if (!pool || !mintRow) throw new TradeError("unavailable", "That coin was not found on Solana");
  const program = mintRow.owner;
  const coinAtaRow = program === PROGRAM.token2022 ? t2 : t1;
  const coinAta = program === PROGRAM.token2022 ? ataT22 : ataTok;
  const r = route;
  const stateOf = (pool: Row | null, v0: Row | null | undefined, v1: Row | null | undefined): State => {
    // the pool is still this coin's, owned by its program, on each node's word (discovery may have been one node's)
    if (!pool || pool.owner !== POOL_PROGRAM[r.kind]) throw new TradeError("unavailable", "That pool was not found on Solana");
    if (r.kind === "pumpswap") {
      if (!v0 || !v1) throw new TradeError("unavailable", "Pool vaults not found");
      const p = readStruct(AMM_LAYOUT, "Pool", pool.data);
      if (!pumpPoolOk(p, mint)) throw new TradeError("unavailable", "Not this coin's pool");
      return { kind: "pumpswap", poolAddress: r.address, pool: p, cfg: statics[0]!, fee: statics[1]!, baseReserve: tokenAmount(v0.data), quoteReserve: tokenAmount(v1.data) + (p.virtual_quote_reserves as bigint), supply: mintSupply(mintRow.data), baseProgram: program, globalConfig: ammGlobalConfig(), feeConfig: feeConfigOf(AMM_FEE_CONFIG_SEED) };
    }
    if (r.kind === "pumpfun") {
      const cv = readStruct(PUMP_LAYOUT, "BondingCurve", pool.data);
      if (cv.complete) { m.routes.delete(mint); throw new TradeError("unavailable", "The curve is complete"); }
      if (!pumpCurveOk(cv)) throw new TradeError("unavailable", "Not a curve quoted here");
      return { kind: "pumpfun", curveAddress: r.address, curve: cv, global: statics[0]!, fee: statics[1]!, mint, baseProgram: program, globalAddress: pumpGlobal(), feeConfig: feeConfigOf(PUMP_FEE_CONFIG_SEED) };
    }
    if (!v0 || !v1) throw new TradeError("unavailable", "Pool vaults not found");
    const p = readStruct(CPMM_LAYOUT, "PoolState", pool.data);
    if (!((p.token_0_mint === mint && p.token_1_mint === WSOL) || (p.token_1_mint === mint && p.token_0_mint === WSOL))) throw new TradeError("unavailable", "Not this coin's pool");
    if (!cpmmSupported(p, statics[0]!)) throw new TradeError("unavailable", "This pool is not quoted here");
    return { kind: "cpmm", poolAddress: r.address, pool: p, config: statics[0]!, reserve0: tokenAmount(v0.data) - p.protocol_fees_token_0 - p.fund_fees_token_0, reserve1: tokenAmount(v1.data) - p.protocol_fees_token_1 - p.fund_fees_token_1, coinIs0: p.token_0_mint === mint, authority: cpmmAuthority() };
  };
  const st = stateOf(pool ?? null, v0, v1);
  const alt = stateOf(pr.alts![1] ?? null, pr.alts![5], pr.alts![6]);
  const t = c.now();
  const heldNow = c.memory.fix(BalanceMemory.key(owner, mint), coinAtaRow ? tokenAmount(coinAtaRow.data) : 0n, t);
  return {
    coinAtaExists: !!coinAtaRow || heldNow > 0n,                                  // a lagging node may not show the account a buy just made
    at: t, st, alt, route, supply: mintSupply(mintRow.data), decimals: mintDecimals(mintRow.data), program,
    native: c.memory.fix(BalanceMemory.key(owner), me?.lamports ?? 0n, t),
    coinAta, held: heldNow,
    coinAtaLamports: coinAtaRow?.lamports ?? (heldNow > 0n ? (program === PROGRAM.token2022 ? TOKEN22_RENT : TOKEN_RENT) : 0n), wsolAta,
    ext: program === PROGRAM.token2022 ? mintExtensions(mintRow.data) : { types: new Set<number>(), transferFeeBps: 0, transferFeeAuthority: false },
    freezable: mintFreezable(mintRow.data),
  };
}

/** The pool state, at most FRESH_MS old: a second call inside the window costs nothing, and calls at the same time share one read. */
function live(c: Ctx, owner: string, mint: string): Promise<Live> {
  const key = `${owner}|${mint}`;
  const slot = c.m.lives.get(key) ?? c.m.lives.set(key, {}).get(key)!;
  if (slot.live && c.now() - slot.live.at < FRESH_MS) return Promise.resolve(slot.live);
  if (!slot.pending) slot.pending = loadLive(c, owner, mint).then((l) => { slot.live = l; return l; }).finally(() => { slot.pending = undefined; });
  return slot.pending;
}
/** The next quote of this coin reads the pool again (a pool update from the live feed, or a landed trade). */
export function poolChanged(c: Ctx, owner: string, mint: string): void { const s = c.m.lives.get(`${owner}|${mint}`); if (s?.live) s.live = { ...s.live, at: 0 }; }

/** How far apart two nodes' quotes on the same pool may be, in bps (as the EVM direct path's NODES_SPREAD_BPS). */
export const NODES_SPREAD_BPS = 300;
/** A pool must hold at least this share of the coin's liquidity to be traded directly. Anything smaller is a side pool. */
export const MAIN_POOL_SHARE = 0.5;
/** A direct buy may cost at most this much over the market price plus its own impact (a sell may get this much less). */
export const PRICE_SLACK = 1.3;
/**
 * The pool is the coin's market, and its price agrees with the market data. The old live build quoted ZEREBRO and RAY
 * (whose markets are a Raydium AMM v4 / CLMM pool) on a derived CP-Swap side pool 1.77x and 1.06x above the market. Throws
 * "unavailable", so the next path builds it.
 *   * a CP-Swap or PumpSwap pool must hold MAIN_POOL_SHARE of the coin's liquidity; a DERIVED pool with no liquidity figure isn't trusted;
 *   * the quote's price must be within PRICE_SLACK of the market price, beyond its own impact, in the direction that costs the user.
 * The pump.fun curve is a coin's only market before it completes, so only the price rule applies to it.
 */
export function marketCheck(side: Side, st: State, lv: { decimals: number }, payRaw: bigint, out: bigint, impactPct: number, solUsd: number, meta: CoinMeta | undefined, route: { derived?: boolean }): void {
  const solSide = st.kind === "pumpswap" ? st.quoteReserve - BigInt(st.pool.virtual_quote_reserves ?? 0n) : st.kind === "cpmm" ? (st.coinIs0 ? st.reserve1 : st.reserve0) : undefined;
  if (solSide !== undefined) {
    const poolUsd = 2 * (Number(solSide) / 1e9) * solUsd;
    const liq = meta?.liquidityUsd;
    if (liq && liq > 0 && poolUsd < MAIN_POOL_SHARE * liq) throw new TradeError("unavailable", "Not the coin's main pool");
    if (route.derived && !(liq && liq > 0)) throw new TradeError("unavailable", "A derived pool with no market figure yet");
  }
  const mkt = meta?.priceUsd;
  if (!(mkt && mkt > 0) || out <= 0n || payRaw <= 0n) return;
  const imp = 1 + Math.max(0, impactPct) / 100;
  if (side === "buy") {
    const paid = (Number(payRaw) / 1e9) * solUsd, got = Number(out) / 10 ** lv.decimals;
    if (paid / got > mkt * imp * PRICE_SLACK) throw new TradeError("unavailable", "The pool's price is far above the market");
  } else {
    const sold = Number(payRaw) / 10 ** lv.decimals, got = (Number(out) / 1e9) * solUsd;
    if (got / sold < mkt / imp / PRICE_SLACK) throw new TradeError("unavailable", "The pool's price is far below the market");
  }
}

/** The finest price impact quoteOn measures, in %: a reading of 0 is an impact under this, not none (fix review RT-6). */
export const IMPACT_STEP_PCT = 0.0001;

/** The quote: the program's own maths on the pool state just read, and the price impact. */
function quoteOn(st: State, side: Side, payRaw: bigint): { out: bigint; impactPct: number } {
  const pct = (a: bigint, r: bigint) => Number((a * 1_000_000n) / (r + a)) / 10_000;
  const net = (fees: { lp: bigint; protocol: bigint; creator: bigint }) => (payRaw * 10_000n) / (10_000n + fees.lp + fees.protocol + fees.creator);
  if (side === "buy") {
    if (st.kind === "pumpswap") { const q = ammBuy(st, payRaw); return { out: q.out, impactPct: pct(net(q.fees), st.quoteReserve) }; }
    if (st.kind === "pumpfun") { const q = curveBuy(st, payRaw); return { out: q.out, impactPct: pct(net(q.fees), st.curve.virtual_quote_reserves) }; }
    return { out: cpmmQuote(st, payRaw, false), impactPct: pct(payRaw, st.coinIs0 ? st.reserve1 : st.reserve0) };
  }
  if (st.kind === "pumpswap") return { out: ammSell(st, payRaw).out, impactPct: pct(payRaw, st.baseReserve) };
  if (st.kind === "pumpfun") return { out: curveSell(st, payRaw).out, impactPct: pct(payRaw, st.curve.virtual_token_reserves) };
  return { out: cpmmQuote(st, payRaw, true), impactPct: pct(payRaw, st.coinIs0 ? st.reserve0 : st.reserve1) };
}

/** Prepares a direct swap. Throws a TradeError when the coin's pool isn't one built here or the swap wouldn't pass. */
export async function prepareDirect(c: Ctx, side: Side, mint: string, amount: Amount): Promise<SolPrepared> {
  const { d, m } = c;
  const owner = d.owner;
  if (mint === WSOL) throw new TradeError("unavailable", "wSOL is not swapped here");
  // the blockhash and the coin's priority fees need nothing from the pool: read beside it (speed, 3 Nov: they waited for it)
  const early = Promise.all([blockhash(c), priorityP75(c, mint)]);
  early.catch(() => undefined);                                             // awaited below; a failure surfaces there
  const [px, lv, meta0, rents] = await Promise.all([d.solUsd(), live(c, owner, mint), d.meta ? sleepless(d.meta(mint), 150) : Promise.resolve(undefined), rentsOf(c)]);
  const meta = meta0 ?? m.metas.get(mint);
  if (meta0) m.metas.set(mint, meta0);
  // Token-2022 coins whose transfers aren't plain (a transfer fee comes off every transfer, which the pool maths here don't
  // take; a transfer hook needs extra accounts) are priced elsewhere
  const hold = side === "buy" ? issuerHold(lv.ext) : undefined;
  if (hold) throw new TradeError("unsellable", ISSUER_WORDS[hold], hold);
  if (lv.ext.transferFeeBps > 0 || (lv.ext.types.has(EXT.transferHook) && lv.ext.transferHookLive !== false) || lv.ext.types.has(EXT.nonTransferable)) throw new TradeError("unavailable", "A coin with a transfer fee or hook goes to the aggregator");
  const symbol = meta?.symbol ?? shortAddr(mint);
  if (side === "buy" && lv.freezable) throw new TradeError("unsellable", "Its issuer can freeze it, so a sell could be stopped", "freezable");
  const bal = lv.native;
  const rentNew = lv.coinAtaExists ? 0n : lv.program === PROGRAM.token2022 ? rents.token22 : rents.token;
  const payRaw = payOf(side, amount, { bal, held: lv.held, solUsd: px, rentNew, wsolRent: rents.token, symbol });

  const st = lv.st;
  const { out: out0, impactPct } = quoteOn(st, side, payRaw);
  // the second node's read of the same pool (audit T-6): within NODES_SPREAD_BPS (a slot between the reads moves a busy
  // pool a little) the higher sets the floor, so a node saying less can't loosen it; farther apart one of them is wrong,
  // and the direct route steps aside for the next path, as the EVM direct path does
  const out1 = quoteOn(lv.alt, side, payRaw).out;
  const hi = out0 > out1 ? out0 : out1, lo = out0 > out1 ? out1 : out0;
  if (hi > 0n && (hi - lo) * 10_000n > hi * BigInt(NODES_SPREAD_BPS)) throw new TradeError("unavailable", "Two Solana nodes disagree about this pool");
  const out = hi;
  if (out <= 0n || lo <= 0n) throw new TradeError("unavailable", "No route for this coin right now");
  if (side === "buy" && impactPct > MAX_BUY_IMPACT_PCT) throw new TradeError("unavailable", "The pool is too thin for this amount", "thin");
  marketCheck(side, st, lv, payRaw, out, impactPct, px, meta, lv.route);

  const tradeUsd = side === "buy" ? rawToUsd(payRaw, 9, px) : rawToUsd(out, 9, px);
  // the coin's moves: Trade's own quotes' (free to widen) and the market data's (capped, slippage.ts MARKET_WIDEN_MAX_BPS)
  // Trade's own quote of the coin, kept for its moves (coins per SOL, as Jupiter's): a coin quoted for a while is "watched",
  // and its floor is then what Trade measured (fix review RT-5: only Jupiter's path recorded one)
  if (out > 0n && payRaw > 0n) c.moves.note(mint, c.now(), side === "buy" ? Number(out) / Number(payRaw) : Number(payRaw) / Number(out));
  // an impact that reads 0 is one under the quote's step, so the pool is at least as deep as that step says: a market figure
  // listing it thinner can't widen the floor (fix review RT-6: listed at $1, a small trade in a deep pool got the ceiling)
  const depthImpactPct = Math.max(impactPct, IMPACT_STEP_PCT);
  const bps = volatileSlippageBps({ baseBps: autoSlippageBps({ liquidityUsd: meta?.liquidityUsd, tradeUsd, impactPct: depthImpactPct }), liquidityUsd: meta?.liquidityUsd, ownMoveBps: c.moves.bps(mint, c.now()), watched: c.moves.watched(mint, c.now()), impactPct, moveBps: meta?.moveBps60s, change24hPct: meta?.change24hPct, widen: 1 + 0.5 * c.attempt });
  const min = applyBps(out, bps);

  // the transaction
  const closing = side === "sell" && lv.coinAtaExists && payRaw === lv.held;
  const [bh, p75] = await early;
  const unitKey = `${st.kind}|${side}`;
  const proofKey = `${unitKey}|${lv.route.address}`;
  const limit = m.units.get(unitKey) ?? (side === "buy" ? 200_000 : 160_000);
  const prioLamports = priorityLamports(side, payRaw, p75, limit);
  const ixs: Instruction[] = [computeLimit(limit), computePrice((prioLamports * 1_000_000n) / BigInt(limit))];
  const swapIx = (userBase: string, userQuote: string) =>
    st.kind === "pumpswap" ? ammSwapIx(st, side, owner, userBase, userQuote, payRaw, min)
    : st.kind === "pumpfun" ? curveSwapIx(st, side, owner, userBase, userQuote, payRaw, min)
    : side === "sell" ? cpmmSwapIx(st, owner, true, userBase, userQuote, payRaw, min) : cpmmSwapIx(st, owner, false, userQuote, userBase, payRaw, min);
  ixs.push(createAtaIdempotent(owner, owner, WSOL, PROGRAM.token));
  if (side === "buy") { ixs.push(createAtaIdempotent(owner, owner, mint, lv.program)); ixs.push(...wrapSol(owner, lv.wsolAta, payRaw)); }
  ixs.push(swapIx(lv.coinAta, lv.wsolAta));
  ixs.push(closeAccount(lv.wsolAta, owner));
  if (closing && lv.ext.types.has(EXT.transferFeeConfig)) ixs.push(harvestWithheld(mint, lv.coinAta));   // withheld transfer fees would block the close
  if (closing) ixs.push(closeAccount(lv.coinAta, owner, lv.program));
  const tx = buildTx(owner, bh.hash, ixs);

  // proof: a simulation (signatures not checked) the first time and at most every SIM_EVERY_MS
  const simKey = `${owner}|${mint}|${side}`;
  let simP = m.sims.get(simKey);
  const runSim = (): Promise<SimInfo> => d.rpc.call("simulateTransaction", [tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [owner, lv.coinAta] } }]).then((r: any) => {
    const v = r?.value;
    if (!v) throw new TradeError("node", "No simulation answer");
    if (v.err) { const pe = simProblem(v.err, v.logs); throw pe.kind === "funds" ? new TradeError("unavailable", pe.message) : pe; }   // only the local checks may say "funds"
    const [a0, a1] = v.accounts ?? [];
    return { units: Number(v.unitsConsumed ?? 0), lamportsAfter: a0?.lamports !== undefined ? BigInt(a0.lamports) : undefined, tokenAfter: a1?.data?.[0] ? tokenAmount(fromBase64(a1.data[0])) : undefined };
  });
  const firstTime = !m.verified.has(proofKey);
  if (!simP || c.now() - simP.at > SIM_EVERY_MS) {
    const slot: { at: number; p: Promise<SimInfo>; ok?: boolean; failed?: unknown } = { at: c.now(), p: runSim() };
    slot.p.then(() => { slot.ok = true; m.provedAt.set(simKey, c.now()); }, (e) => { slot.failed = e; });
    simP = slot; m.sims.set(simKey, slot);
  }
  if (firstTime) {
    const info: SimInfo = await simP.p;
    m.verified.add(proofKey);
    if (info.units > 0) m.units.set(unitKey, Math.min(1_400_000, Math.ceil(info.units * 1.3) + 5_000));
    // the simulation's own number is the truth: a local quote clearly above it isn't trusted
    const got = side === "buy" ? (info.tokenAfter !== undefined ? info.tokenAfter - lv.held : undefined) : info.lamportsAfter !== undefined ? info.lamportsAfter - bal : undefined;
    if (got !== undefined && got > 0n) {
      const real = side === "buy" ? got : got + BASE_FEE + prioLamports - (closing ? lv.coinAtaLamports : 0n);
      if (side === "buy" && real * 1_000n < out * 997n) throw new TradeError("unavailable", "The simulated fill is below the local quote");
      if (side === "sell" && real * 1_000n < out * 985n) throw new TradeError("unavailable", "The simulated fill is below the local quote");
    }
  }

  const feeLamports = BASE_FEE + prioLamports + rentNew;
  const payUsd = side === "buy" ? rawToUsd(payRaw, 9, px) : rawToUsd(out, 9, px);
  const getUsd = side === "buy" ? payUsd * (1 - Math.max(0, impactPct) / 100) : rawToUsd(out, 9, px);
  const quote: SolQuote = {
    side, chain: "sol", coin: mint, symbol, decimals: lv.decimals, payRaw: payRaw.toString(), payUsd, getRaw: out.toString(), getUsd, getMinRaw: min.toString(),
    feeRaw: feeLamports.toString(), feeUsd: rawToUsd(feeLamports, 9, px), route: st.kind === "pumpswap" ? "PumpSwap" : st.kind === "pumpfun" ? "pump.fun" : "Raydium",
    slippageBps: bps, priceImpactPct: Number.isFinite(impactPct) ? impactPct : undefined, expiresAt: c.now() + (d.quoteTtlMs ?? 20_000),
    ...(rentNew > 0n ? { rentUsd: rawToUsd(rentNew, 9, px) } : {}),
    ...(closing ? { rentBackUsd: rawToUsd(lv.coinAtaLamports, 9, px), closesAccount: true } : {}),
  };
  const slot = simP;
  return {
    key: `${side}|sol|${mint}|${quote.payRaw}|${quote.getMinRaw}|${quote.expiresAt}`, at: c.now(), quote, steps: [{ id: "swap", tx, lastValidBlockHeight: bh.lastValid }],
    // The tap only sends (the old live build waited 16.8 s here): the sheet re-quotes every 8 s and each quote re-proves the
    // route in the background. The tap waits for that re-proof only when there's no recent one. A route proven in the last
    // PROOF_TRUST_MS goes at once, unless its newest simulation already said no.
    ready: async () => {
      const proven = c.now() - (m.provedAt.get(simKey) ?? -Infinity) < PROOF_TRUST_MS;
      const refused = (e: unknown) => e instanceof TradeError && e.kind !== "node";
      if (slot.failed !== undefined && (refused(slot.failed) || !proven)) throw slot.failed;
      if (!slot.ok && slot.failed === undefined && !proven) await slot.p;
    },
  };
}

/**
 * The direct path, or undefined to let the next path build it. Only money and the issuer's powers are final: every path
 * would say the same. A read no node answered is asked again once, so a coin on its curve isn't moved to another venue by
 * one slow read (4 Nov: a pump.fun curve sell went to Jupiter and couldn't land); a coin known to be on the pump.fun curve
 * whose read fails again says so ("node") rather than switching venue.
 */
export async function tryDirect(c: Ctx, side: Side, mint: string, amount: Amount): Promise<SolPrepared | undefined> {
  for (let tries = 1; ; tries++) {
    try { return await prepareDirect(c, side, mint, amount); }
    catch (e) {
      if (isFinalRefusal(e)) throw e;                                           // every path would say the same
      const unread = e instanceof TradeError && e.kind === "node";
      if (unread && tries < 2) continue;
      if (unread && c.m.routes.get(mint)?.kind === "pumpfun") throw e;
      return undefined;
    }
  }
}
