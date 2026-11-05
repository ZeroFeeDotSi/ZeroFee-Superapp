// Native buy and sell on the launch curves (curves.ts) that aggregators don't route dependably. On 21 Oct 2026 Jupiter
// quoted one DBC coin's buy but not its sell and another the opposite, and routed the buy but NOT the sell of 3 of 3 live
// LaunchLab coins: a coin bought there couldn't be sold.
// The quote is the program's own answer: the swap is simulated with no floor and what the wallet's account receives is
// the quote. The real transaction carries that less the slippage as its minimum, and is simulated again before it can be
// signed. Never a buy that can't be sold: the buy and the sell of what it gets are simulated in one transaction first.
import { fromBase64, pkAt } from "./bytes.ts";
import { BalanceMemory } from "../balances.ts";
import { EXT, ISSUER_WORDS, issuerHold, mintExtensions, mintFreezable, tokenAmount } from "./codec.ts";
import { NODES_SPREAD_BPS } from "./direct.ts";
import { agreedMint, agreedStatic, blockhash, payOf, priorityLamports, priorityP75, readAccountsPair, rentsOf, sleepless, BASE_FEE, type Amount, type CoinMeta, type Ctx, type Row, type Side, type SolPrepared, type SolQuote } from "./context.ts";
import { CURVE_DEX, curveSwapIx, decodeCurvePool, launchlabPool, type CurvePool } from "./curves.ts";
import { simProblem, TradeError } from "../errors.ts";
import { ataOf, PROGRAM, shortAddr, WSOL } from "./keys.ts";
import { applyBps, autoSlippageBps, rawToUsd, volatileSlippageBps } from "../slippage.ts";
import { buildTx, closeAccount, computeLimit, computePrice, createAtaIdempotent, harvestWithheld, wrapSol, type Instruction } from "./tx.ts";

/**
 * The coin's curve pool: the LaunchLab pool is derivable; a DBC or DAMM v2 pool comes from the market data's pool list,
 * checked on chain. Kept 10 min; "none" without the market data only 30 s, since its pools may be named once it answers.
 */
async function findPool(c: Ctx, mint: string, meta: CoinMeta | undefined): Promise<CurvePool | undefined> {
  const hit = c.m.curvePools.get(mint);
  if (hit && c.now() - hit.at < hit.ttl) return hit.p;
  const cands = [launchlabPool(mint), ...(meta?.pools ?? []).filter((p) => CURVE_DEX.test(p.dex)).map((p) => p.address)].filter((a, i, l) => l.indexOf(a) === i).slice(0, 6);
  // the pool, and a DBC pool's config, as two nodes agree on them (audit T-6): one node alone names no pool
  const pr = await readAccountsPair(c, cands, true);
  if (!pr.alts) throw new TradeError("node", "Only one Solana node answered for this coin's pool; try again");
  const decode = (rows: (Row | null)[]) => cands.map((a, i) => decodeCurvePool(a, rows[i] ? { owner: rows[i]!.owner, data: rows[i]!.data } : null, mint)).filter((x): x is CurvePool => !!x);
  const pools = decode(pr.rows), alts = decode(pr.alts);
  const key = (x?: CurvePool) => (x ? JSON.stringify(x) : "none");
  if (key(pools[0]) !== key(alts[0])) throw new TradeError("unavailable", "Two Solana nodes disagree about this coin's pool");
  let p: CurvePool | undefined = pools[0];
  if (p?.venue === "dbc") {
    const cfg = agreedStatic(await readAccountsPair(c, [p.config!], true), 0);
    if (!cfg || pkAt(cfg.data, 8) !== WSOL) p = pools.find((x) => x.venue === "launchlab");      // PoolConfig.quote_mint@8: only SOL-quoted curves
  }
  c.m.curvePools.set(mint, { at: c.now(), p, ttl: p || meta ? 600_000 : 30_000 });
  return p;
}

/**
 * The coin's live launch curve, or undefined: at most one read, remembered for 10 minutes. The router asks it alongside the
 * direct path's probes, so a coin on a curve doesn't wait for probes of venues it isn't on. Waits briefly for market data.
 */
export async function curvePoolOf(c: Ctx, mint: string): Promise<CurvePool | undefined> {
  const hit = c.m.curvePools.get(mint);
  if (hit && c.now() - hit.at < hit.ttl) return hit.p;
  return findPool(c, mint, c.d.meta ? await sleepless(c.d.meta(mint), 800) : undefined);
}

/** A round trip that passed this recently (for a similar amount) proves the coin can be sold back. */
export const ROUND_TRIP_TRUST_MS = 60_000;
/** Any blockhash: a simulation with replaceRecentBlockhash uses the node's own (32 zero bytes, base58). */
export const ANY_BLOCKHASH = "11111111111111111111111111111111";
const SIM = (accounts: string[]) => ({ encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: accounts } });
const metaOf = (c: Ctx, mint: string) => (c.d.meta ? sleepless(c.d.meta(mint), 2_500) : Promise.resolve(undefined));   // the pool list: worth the wait on this path

/**
 * Can `tokens` of the coin be sold back natively? A buy of `paySol` and the sell of `tokens`, simulated in one transaction.
 * For an aggregator buy routed through a curve whose sell the aggregator may not route. undefined = no curve pool here.
 */
export async function nativeSellWorks(c: Ctx, mint: string, paySol: bigint, tokens: bigint): Promise<boolean | undefined> {
  const owner = c.d.owner;
  const pool = await findPool(c, mint, await metaOf(c, mint));
  if (!pool) return undefined;
  const mintRow = agreedMint(await readAccountsPair(c, [mint], true), 0);
  if (!mintRow) return undefined;
  const program = mintRow.owner;
  const coinAta = ataOf(owner, mint, program), wsolAta = ataOf(owner, WSOL, PROGRAM.token);
  const bh = await blockhash(c);
  const ixs = [computeLimit(800_000), createAtaIdempotent(owner, owner, WSOL, PROGRAM.token), createAtaIdempotent(owner, owner, mint, program), ...wrapSol(owner, wsolAta, paySol),
    curveSwapIx(pool, "buy", owner, mint, program, coinAta, wsolAta, paySol, 0n), curveSwapIx(pool, "sell", owner, mint, program, coinAta, wsolAta, tokens, 0n)];
  const r = await c.d.rpc.call("simulateTransaction", [buildTx(owner, bh.hash, ixs), SIM([owner])]);
  if (!r?.value) throw new TradeError("node", "No simulation answer");
  return !r.value.err;
}

/** Prepares a native curve swap, or throws: "unavailable" (no curve pool here, the curve refuses), "unsellable" (the round trip failed), "funds". */
export async function prepareCurve(c: Ctx, side: Side, mint: string, amount: Amount): Promise<SolPrepared> {
  const { d } = c;
  const owner = d.owner;
  const meta = await metaOf(c, mint);
  const pool = await findPool(c, mint, meta);
  if (!pool) throw new TradeError("unavailable", "No route for this coin right now");
  const ataTok = ataOf(owner, mint, PROGRAM.token), ataT22 = ataOf(owner, mint, PROGRAM.token2022), wsolAta = ataOf(owner, WSOL, PROGRAM.token);
  const [pr, px, rents] = await Promise.all([readAccountsPair(c, [owner, mint, ataTok, ataT22, wsolAta], true), d.solUsd(), rentsOf(c)]);
  const [me, , t1, t2, ws] = pr.rows;
  const mintRow = agreedMint(pr, 1);                                        // the mint's gates on two nodes (audit T-6)
  if (!mintRow) throw new TradeError("unavailable", "That coin was not found on Solana");
  const program = mintRow.owner;
  const ext = program === PROGRAM.token2022 ? mintExtensions(mintRow.data) : undefined;
  const hold = side === "buy" && ext ? issuerHold(ext) : undefined;
  if (hold) throw new TradeError("unsellable", ISSUER_WORDS[hold], hold);
  if (ext && (ext.transferFeeBps > 0 || (ext.types.has(EXT.transferHook) && ext.transferHookLive !== false))) throw new TradeError("unavailable", "No route for this coin right now");
  if (side === "buy" && mintFreezable(mintRow.data)) throw new TradeError("unsellable", "Its issuer can freeze it, so a sell could be stopped", "freezable");
  const coinAta = program === PROGRAM.token2022 ? ataT22 : ataTok;
  const coinRow = program === PROGRAM.token2022 ? t2 : t1;
  const decimals = mintRow.data[44]!;
  const symbol = meta?.symbol ?? shortAddr(mint);
  const t = c.now();
  const bal = c.memory.fix(BalanceMemory.key(owner), me?.lamports ?? 0n, t);
  const held = c.memory.fix(BalanceMemory.key(owner, mint), coinRow ? tokenAmount(coinRow.data) : 0n, t);
  const wsolBefore = ws ? tokenAmount(ws.data) : 0n;
  const rentNew = coinRow ? 0n : program === PROGRAM.token2022 ? rents.token22 : rents.token;
  const payRaw = payOf(side, amount, { bal, held, solUsd: px, rentNew, wsolRent: rents.token, symbol });
  const closing = side === "sell" && (!!coinRow || held > 0n) && payRaw === held;   // a lagging node may not show the account a buy just made

  // the quote's simulations replace the blockhash and use a fixed fee, so only the real transaction waits for these two
  const realP = Promise.all([blockhash(c), priorityP75(c, mint)]);
  realP.catch(() => undefined);
  const build = (hash: string, min: bigint, units: number, prioLamports: bigint, probe: boolean, thenSell?: bigint): string => {
    const ixs: Instruction[] = [computeLimit(units), computePrice((prioLamports * 1_000_000n) / BigInt(units)), createAtaIdempotent(owner, owner, WSOL, PROGRAM.token)];
    if (side === "buy") { ixs.push(createAtaIdempotent(owner, owner, mint, program)); ixs.push(...wrapSol(owner, wsolAta, payRaw)); }
    ixs.push(curveSwapIx(pool, side, owner, mint, program, coinAta, wsolAta, payRaw, min));
    if (thenSell !== undefined) ixs.push(curveSwapIx(pool, "sell", owner, mint, program, coinAta, wsolAta, thenSell, 0n));   // the round trip: what was just bought, sold back
    if (!probe) {
      ixs.push(closeAccount(wsolAta, owner));
      if (closing && ext?.types.has(EXT.transferFeeConfig)) ixs.push(harvestWithheld(mint, coinAta));
      if (closing) ixs.push(closeAccount(coinAta, owner, program));
    }
    return buildTx(owner, hash, ixs);
  };
  const simulate = async (tx: string, out: string) => {
    const r = await d.rpc.call("simulateTransaction", [tx, SIM([owner, out])]);
    const v = r?.value;
    if (!v) throw new TradeError("node", "No simulation answer");
    if (v.err) { const pe = simProblem(v.err, v.logs); throw pe.kind === "moved" ? pe : new TradeError("unavailable", "This coin can't be traded right now"); }
    return v;
  };
  // 1. the program's own quote: the swap with no floor, simulated (the wSOL account stays open so a sell's SOL can be read from it).
  // On TWO nodes (audit T-6): the floor is set from it, so one node's word isn't enough. Within NODES_SPREAD_BPS the higher
  // sets it (a node saying less can't loosen it); farther apart, one of them is wrong and nothing is offered
  const outAcct = side === "buy" ? coinAta : wsolAta;
  const probeTx = build(ANY_BLOCKHASH, 0n, 400_000, 10_000n, true);
  const heard = (await d.rpc.askNodes("simulateTransaction", [probeTx, SIM([owner, outAcct])], 2)).filter((a): a is { ok: true; value: any } => a.ok && !!a.value?.value);
  if (heard.length < 2) throw new TradeError("node", "Only one Solana node answered this coin's quote; try again");
  const outOf = (v: any): bigint => {
    if (v.err) { const pe = simProblem(v.err, v.logs); throw pe.kind === "moved" ? pe : new TradeError("unavailable", "This coin can't be traded right now"); }
    const after = v.accounts?.[1]?.data?.[0] ? tokenAmount(fromBase64(v.accounts[1].data[0])) : undefined;
    return after === undefined ? 0n : after - (side === "buy" ? held : wsolBefore);
  };
  const outs = heard.map((a) => outOf(a.value.value));
  const probe = heard[0]!.value.value;
  const out = outs.reduce((m, x) => (x > m ? x : m)), lowest = outs.reduce((m, x) => (x < m ? x : m));
  if (out <= 0n || lowest <= 0n) throw new TradeError("unavailable", "No route for this coin right now");
  if ((out - lowest) * 10_000n > out * BigInt(NODES_SPREAD_BPS)) throw new TradeError("unavailable", "Two Solana nodes disagree about this coin's price");
  // NEVER A BUY THAT CAN'T BE SOLD: the buy and the sell of what it gets, in one simulated transaction. A round trip that
  // passed for this coin in the last minute, for at least half of this amount, isn't run again on every quote
  if (side === "buy") {
    const passed = c.m.roundTrips.get(mint);
    if (!(passed && c.now() - passed.at < ROUND_TRIP_TRUST_MS && out <= passed.out * 2n)) {
      try { await simulate(build(ANY_BLOCKHASH, 0n, 800_000, 10_000n, true, out), outAcct); }
      catch { throw new TradeError("unsellable", "This coin could not be sold back right now"); }
      c.m.roundTrips.set(mint, { at: c.now(), out });
    }
  }
  const units = Math.min(1_400_000, Math.ceil(Number(probe.unitsConsumed ?? 200_000) * 1.3) + 10_000);

  // 2. the price must agree with the market (a curve's price is its own, so only a far-off answer is refused), then the floor
  const tradeUsd = side === "buy" ? rawToUsd(payRaw, 9, px) : rawToUsd(out, 9, px);
  const mkt = meta?.priceUsd;
  if (mkt && mkt > 0) {
    const unit = side === "buy" ? tradeUsd / (Number(out) / 10 ** decimals) : tradeUsd / (Number(payRaw) / 10 ** decimals);
    // a curve's price is its own (3x band); a DAMM v2 pool IS the market, so its fee schedule (launch pools start very high) may cost at most 1.5x
    const band = pool.venue === "damm2" ? 1.5 : 3;
    if (side === "buy" ? unit > mkt * band : unit < mkt / band) throw new TradeError("unavailable", "The pool's price is far from the market");
  }
  const [bh, p75] = await realP;
  // Trade's own quote of the coin, kept for its moves (coins per SOL, as Jupiter's): a coin quoted for a while is "watched",
  // and its floor is then what Trade measured (fix review RT-5: only Jupiter's path recorded one)
  if (out > 0n && payRaw > 0n) c.moves.note(mint, c.now(), side === "buy" ? Number(out) / Number(payRaw) : Number(payRaw) / Number(out));
  const bps = volatileSlippageBps({ baseBps: autoSlippageBps({ liquidityUsd: meta?.liquidityUsd, tradeUsd }), liquidityUsd: meta?.liquidityUsd, ownMoveBps: c.moves.bps(mint, c.now()), watched: c.moves.watched(mint, c.now()), moveBps: meta?.moveBps60s, change24hPct: meta?.change24hPct, widen: 1 + 0.5 * c.attempt });
  const min = applyBps(out, bps);
  const prioLamports = priorityLamports(side, payRaw, p75, units);

  // 3. the real transaction (floor = the program's answer less the slippage), proven by its own simulation: it runs while
  // the quote is shown, and ready() waits for it, so the tap never sends an unproven transaction
  const tx = build(bh.hash, min, units, prioLamports, false);
  const proof = simulate(tx, coinAta);
  proof.catch(() => undefined);
  const feeLamports = BASE_FEE + prioLamports + rentNew;
  const payUsd = side === "buy" ? rawToUsd(payRaw, 9, px) : rawToUsd(out, 9, px);
  const quote: SolQuote = {
    side, chain: "sol", coin: mint, symbol, decimals, payRaw: payRaw.toString(), payUsd, getRaw: out.toString(), getUsd: side === "buy" ? (mkt ? (Number(out) / 10 ** decimals) * mkt : payUsd) : payUsd, getMinRaw: min.toString(),
    feeRaw: feeLamports.toString(), feeUsd: rawToUsd(feeLamports, 9, px), route: pool.venue === "dbc" ? "Meteora DBC" : pool.venue === "damm2" ? "Meteora DAMM v2" : "Raydium LaunchLab",
    slippageBps: bps, expiresAt: c.now() + (d.quoteTtlMs ?? 20_000),
    ...(rentNew > 0n ? { rentUsd: rawToUsd(rentNew, 9, px) } : {}),
    ...(closing ? { rentBackUsd: rawToUsd(coinRow?.lamports ?? (program === PROGRAM.token2022 ? rents.token22 : rents.token), 9, px), closesAccount: true } : {}),
  };
  return { key: `${side}|sol|${mint}|${quote.payRaw}|${quote.getMinRaw}|${quote.expiresAt}`, at: c.now(), quote, steps: [{ id: "swap", tx, lastValidBlockHeight: bh.lastValid }], ready: async () => { await proof; } };
}
