// The fallback: KyberSwap finds the route for coins the direct path and the curves can't trade, its calldata is checked
// byte by byte (kyber.ts) and the exact swap is simulated from the wallet before it is offered. Never a buy that can't be
// sold back: before a KyberSwap buy is offered, the sell of what it brings is routed and simulated after it, in one block.
import { bigOf, hexBig } from "./bytes.ts";
import { KYBER_ROUTER, NATIVE } from "./chains.ts";
import {
  APPROVE_GAS_ASSUMED, APPROVE_GAS_FALLBACK, ceilMul, DEADLINE_SEC, NoGas, nonceFloor, paidPrice, PRICE_REVERT, Refusal, THIN_IMPACT_BPS, toNum,
  type Built, type Ctx, type Side, type WalletSide, sellTtl } from "./context.ts";
import { KyberError, kyberBuild, kyberRoute, rfqSourcesOf, routeName, verifySwapCalldata, type KyberDeps, type KyberRoute } from "./kyber.ts";
import { ChainSaid } from "./rpc.ts";
import { impactBps, slippageBps } from "./slippage.ts";
import { allowanceData, approveData } from "./v4.ts";

const kd = (c: Ctx): KyberDeps => (c.d.fetch ? { fetch: c.d.fetch } : {});

/** One eth_call of the exact swap from the wallet. A revert is a verdict (price moved vs a real refusal); a node failure throws. */
/**
 * A swap's gas limit from what its test run used (review M6: the core refuses a limit over twice its own test run, or the
 * run's use + 100,000 when that is more): 40 % over, at least 60,000 over, so it always sits inside that bound and keeps
 * room for a block that costs a little more.
 */
export function fitGas(used: bigint): bigint {
  const pct = ceilMul(used, 14n, 10n), flat = used + 60_000n;
  return pct > flat ? pct : flat;
}
/** A simulated call's gas used, when it ran and said so. */
export function gasUsedOf(r: { status?: string; gasUsed?: string } | undefined): bigint | undefined {
  return r?.status === "0x1" && typeof r.gasUsed === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(r.gasUsed) ? BigInt(r.gasUsed) : undefined;
}
async function simulate(c: Ctx, value: bigint, data: string): Promise<{ ok: true; outRaw?: bigint } | { ok: false; reason: string; priceMoved: boolean }> {
  try {
    const out = await c.rpc("eth_call", [{ from: c.d.owner, to: KYBER_ROUTER, value: hexBig(value), data }, "latest"]);
    return { ok: true, ...(typeof out === "string" && out.length >= 66 ? { outRaw: BigInt("0x" + out.slice(2, 66)) } : {}) };
  } catch (e) {
    if (!(e instanceof ChainSaid)) throw e;
    if (/insufficient funds/i.test(e.message)) throw new NoGas(e.message);   // the wallet's own balance, not the coin
    return { ok: false, reason: e.reason, priceMoved: PRICE_REVERT.test(e.reason) };
  }
}

/** Can what this buy brings be sold back through KyberSwap? The buy, the approve and the sell of 90 % simulated in one block: undefined = nobody could tell. Remembered per coin (5 min yes, 2 min no, 1 min no verdict). */
async function sellable(c: Ctx, token: string, buyTx: { value: bigint; data: string }, got: bigint): Promise<boolean | undefined> {
  const s = c.m.sell.get(token);
  if (s && c.now() - s.at < sellTtl(s.ok)) return s.ok;
  const amount = (got * 9n) / 10n;
  if (amount <= 0n) return true;
  let ok: boolean | undefined;
  try {
    let route = await kyberRoute(c.chain, token, NATIVE, amount.toString(), kd(c));
    const rfq = rfqSourcesOf(route);
    if (rfq.length) route = await kyberRoute(c.chain, token, NATIVE, amount.toString(), kd(c), rfq).catch(() => route);   // a feasibility check must not hang on a market maker's signature
    const built = await kyberBuild(c.chain, route, c.d.owner, c.d.owner, 2_000, Math.floor(c.now() / 1000) + 600, kd(c));   // a simulation only: never a step
    const w = c.d.owner;
    const r = await c.sim([{ from: w, to: KYBER_ROUTER, data: buyTx.data, value: buyTx.value }, { from: w, to: token, data: approveData(built.routerAddress, amount) }, { from: w, to: built.routerAddress, data: built.data }]).catch(() => undefined);
    // a verdict only when the buy itself ran: then the sell passing or reverting says it; anything else is no verdict
    if (r && r[0]?.status === "0x1") ok = r[2]?.status === "0x1";
  } catch (e) {
    if (e instanceof KyberError && e.hard) ok = false;                      // KyberSwap has no sell route at all
    // anything else (the service or a node didn't answer): no verdict, and the buy waits
  }
  c.m.sell.set(token, { at: c.now(), ok });
  return ok;
}

export interface KyberIn {
  side: Side; token: string; payRaw: bigint; isMax: boolean; price: number; fee: Built["fee"]; maxFee: bigint; baseFee: bigint;
  /** A buy keeps this much more native for the sales of the other coins the wallet holds (fix review RT-4). */
  othersGas?: bigint;
  symbol: string; decimals: number; liquidity?: number; ctx: WalletSide; mktUsd?: number; ttl: number;
  /** A launchpad curve's refusal: it is the reason shown when KyberSwap has no route either. */
  curveErr?: unknown;
}

export async function buildKyber(c: Ctx, a: KyberIn): Promise<Built> {
  const { side, token, ctx } = a;
  const tokenIn = side === "buy" ? NATIVE : token, tokenOut = side === "buy" ? token : NATIVE;
  const nativeBal = ctx.nativeBal, nonce0 = Math.max(ctx.nonce, nonceFloor(c));
  let payRaw = a.payRaw;
  let allowance = 0n;
  if (side === "sell") allowance = bigOf(await c.rpc("eth_call", [{ to: token, data: allowanceData(c.wallet, KYBER_ROUTER) }, "latest"]), "allowance");

  let slipFloor = 0;                       // a sell KyberSwap over-quoted: the room the chain's own simulation showed it needs (one rebuild)
  let excluded: string[] | undefined;      // RFQ / market-maker sources of a route whose simulation failed (one re-route without them)
  for (let pass = 0; ; pass++) {
    let route: KyberRoute;
    try { route = await kyberRoute(c.chain, tokenIn, tokenOut, payRaw.toString(), kd(c), excluded); }
    catch (e) { if (a.curveErr && e instanceof KyberError) throw a.curveErr; throw e; }
    // KyberSwap prices only the coins it knows: a launchpad coin comes back with amountOutUsd "0", which read as a 100 % impact. A side it can't price is priced with OUR
    // market price; with none, the impact is unknown (0) and the floor + the simulation still hold the amount
    const mkt = a.mktUsd && a.mktUsd > 0 ? a.mktUsd : undefined;
    const kIn = Number(route.summary.amountInUsd ?? 0), kOut = Number(route.summary.amountOutUsd ?? 0);
    const ourIn = side === "buy" ? toNum(payRaw) * a.price : mkt ? toNum(payRaw, a.decimals) * mkt : undefined;
    const ourOut = side === "buy" ? (mkt ? toNum(BigInt(route.summary.amountOut), a.decimals) * mkt : undefined) : toNum(BigInt(route.summary.amountOut)) * a.price;
    const inUsd = side === "buy" ? toNum(payRaw) * a.price : kIn > 0 ? kIn : ourIn ?? 0;
    // Audit EVM-4: KyberSwap's dollar figures are its own, so a route that keeps most of the coins can still read "$5 in,
    // $5 out". With our own price for both sides, the impact is ours as well (the larger of the two counts), and a route
    // KyberSwap calls fine that our price calls past thin isn't the trade its price is for.
    const kImp = kIn > 0 && kOut > 0 ? impactBps(kIn, kOut) : undefined;
    const ownImp = ourIn !== undefined && ourOut !== undefined && ourIn > 0 ? impactBps(ourIn, ourOut) : undefined;
    const imp = Math.max(kImp ?? 0, ownImp ?? 0);
    if (imp > THIN_IMPACT_BPS) {
      if (kImp !== undefined && kImp <= THIN_IMPACT_BPS) throw new Refusal("different", "The trade gives far less than its price says, so it was refused", `KyberSwap's impact ${kImp / 100}%, ours ${imp / 100}%`);
      throw new Refusal("thin", "Not enough for sale at this amount", `price impact ${imp / 100}%`);
    }
    const slip = Math.max(slipFloor, slippageBps({ liquidityUsd: a.liquidity, payUsd: inUsd, impactBps: kImp === undefined && ownImp === undefined ? undefined : imp }));
    const getRawQuoted = BigInt(route.summary.amountOut);
    const floor = (getRawQuoted * BigInt(10_000 - slip)) / 10_000n;
    const built = await kyberBuild(c.chain, route, c.d.owner, c.d.owner, slip, Math.floor(c.now() / 1000) + DEADLINE_SEC, kd(c));
    const v = verifySwapCalldata(built, { chain: c.chain, wallet: c.wallet, tokenIn, tokenOut, amountIn: payRaw, minOutFloor: floor });
    const kyberGas = BigInt(built.gas || route.summary.gas);

    // Gas: a buy is estimated by the node from the wallet itself; a sell's swap can't be (its approve isn't mined yet): KyberSwap's figure x2
    let swapGas: bigint;
    const pre: Built["pre"] = [];
    let simOutRaw: bigint | undefined;
    let simulated = true;
    if (side === "buy") {
      const [est, sim] = await Promise.all([
        c.rpc("eth_estimateGas", [{ from: c.d.owner, to: v.to, value: hexBig(v.value), data: built.data }]).then((r: unknown) => bigOf(r, "eth_estimateGas")).catch((err: unknown) => {
          if (/insufficient funds/i.test(String((err as Error)?.message))) throw new NoGas(`balance ${nativeBal} does not cover the amount plus gas`, nativeBal === 0n);
          return undefined;
        }),
        simulate(c, v.value, built.data),
      ]);
      if (!sim.ok) {
        // a route through a private market maker whose simulation reverts "Call failed" is asked again ONCE without the RFQ sources before the buy is refused
        const rfq = rfqSourcesOf(route);
        if (!sim.priceMoved && !excluded && rfq.length) { excluded = rfq; continue; }
        throw sim.priceMoved ? new Refusal("moved", "The price moved", sim.reason) : new Refusal("reverted", "This coin can't be bought right now", sim.reason);
      }
      simOutRaw = sim.outRaw;
      const sells = await sellable(c, token, { value: v.value, data: built.data }, simOutRaw && simOutRaw > 0n ? simOutRaw : getRawQuoted);
      if (sells === false) throw new Refusal("unsellable", "This coin can't be sold back right now", "no way to sell it back: KyberSwap has no sell route, or the sell reverts");
      if (sells === undefined) throw new Refusal("unchecked", "Its sell-back isn't checked yet: no market answered", "no node or KyberSwap answered the sell-back check");
      swapGas = est !== undefined ? ceilMul(est, 13n, 10n) : ceilMul(kyberGas, 16n, 10n);
    } else {
      swapGas = ceilMul(kyberGas, 2n, 1n);
      if (swapGas < 250_000n) swapGas = 250_000n;
      if (allowance < payRaw) {
        const data = approveData(KYBER_ROUTER, payRaw);   // EXACTLY this sell (guardrail)
        const est = await c.rpc("eth_estimateGas", [{ from: c.d.owner, to: token, data }]).then((r: unknown) => bigOf(r, "eth_estimateGas")).catch(() => undefined);
        pre.push({ to: token, data, gas: est !== undefined ? (ceilMul(est, 13n, 10n) < 60_000n ? 60_000n : ceilMul(est, 13n, 10n)) : APPROVE_GAS_FALLBACK, spender: KYBER_ROUTER });
        // the approve, then this very swap, in one simulated block: KyberSwap can quote a sell above what its route really pays. Rebuilt ONCE with the room the market
        // price says it needs (never past 'thin'); with no simulating node the sell goes as built and the floor still holds the amount
        const sv = await c.sim([{ from: c.d.owner, to: token, data }, { from: c.d.owner, to: v.to, data: built.data, value: 0n }]).catch(() => undefined);
        if (sv && sv[1]?.status !== "0x1") {
          const reason = String(sv[1]?.error?.message ?? "reverted");
          if (!PRICE_REVERT.test(reason)) {
            const rfq = rfqSourcesOf(route);
            if (!excluded && rfq.length) { excluded = rfq; continue; }
            throw new Refusal("reverted", "This coin can't be sold right now", reason);
          }
          const fairWei = ourOut !== undefined && a.price > 0 ? BigInt(Math.floor((ourOut / a.price) * 0.97 * 1e18)) : 0n;
          const need = fairWei > 0n && fairWei < getRawQuoted ? Number(((getRawQuoted - fairWei) * 10_000n) / getRawQuoted) + 50 : 0;
          if (slipFloor === 0 && need > slip && need <= THIN_IMPACT_BPS) { slipFloor = need; continue; }
          throw new Refusal("moved", "The price moved", reason);
        }
        if (sv?.[1]?.returnData && sv[1].returnData.length >= 66) simOutRaw = BigInt("0x" + sv[1].returnData.slice(2, 66));
        if (!sv) simulated = false;
        // the test web sale on Robinhood Chain (3 Nov): KyberSwap's figure x2 was far past what the swap uses, and the
        // core refuses a limit over twice its own test run (review M6): the limit comes from this very test run
        const used = gasUsedOf(sv?.[1]);
        if (used !== undefined) swapGas = fitGas(used);
      } else {
        const [sim, est] = await Promise.all([
          simulate(c, 0n, built.data),
          c.rpc("eth_estimateGas", [{ from: c.d.owner, to: v.to, value: "0x0", data: built.data }]).then((r: unknown) => bigOf(r, "eth_estimateGas")).catch(() => undefined),
        ]);
        if (!sim.ok) throw sim.priceMoved ? new Refusal("moved", "The price moved", sim.reason) : new Refusal("reverted", "This coin can't be sold right now", sim.reason);
        simOutRaw = sim.outRaw;
        // the allowance is there: the node's own estimate +30 %, as a buy (never KyberSwap's figure x2)
        if (est !== undefined) swapGas = ceilMul(est, 13n, 10n);
      }
    }

    // the gas is paid in the same tap: the wallet must hold this transaction's gas (and a sell's approve) on top of the amount
    const gasNow = swapGas * a.maxFee + pre.reduce((n, x) => n + x.gas * a.maxFee, 0n);
    const laterSell = ceilMul((APPROVE_GAS_ASSUMED + swapGas) * a.maxFee, 3n, 2n) + (a.othersGas ?? 0n);
    if (side === "buy") {
      // every buy keeps one later sale's gas (audit EVM-6: a dollar buy could spend the wallet down to its own gas, and with
      // Trading empty the coin was stuck); short of it, the sheet gets the fee from Trading as for any buy short of gas
      const need = payRaw + gasNow + laterSell;
      if (nativeBal < need) {
        if (a.isMax && pass < 2) { payRaw = nativeBal - gasNow - laterSell - nativeBal / 200n; if (payRaw > 0n) continue; }
        throw new NoGas(`balance ${nativeBal} < amount ${payRaw} + gas ${gasNow} + the later sell ${laterSell}`, nativeBal === 0n);
      }
    } else if (nativeBal < gasNow) throw new NoGas(`balance ${nativeBal} < gas ${gasNow}`, nativeBal === 0n);

    const expectedGas = (side === "buy" ? (swapGas * 10n) / 13n : kyberGas) + pre.reduce((n, x) => n + (x.gas * 10n) / 13n, 0n);
    const feeRaw = expectedGas * paidPrice(a.fee, a.baseFee);
    const getRaw = side === "sell" && simOutRaw !== undefined && simOutRaw > 0n && simOutRaw < BigInt(built.amountOut) ? simOutRaw : BigInt(built.amountOut);   // the chain's own answer when it is lower
    const t = c.now();
    const payUsd = side === "buy" ? toNum(payRaw) * a.price : inUsd;
    // "you get" is never more than fair: on a buy, what the coins are worth at our price when we have one, and never more
    // than what is paid (KyberSwap's own figure only when it is lower)
    const kGetUsd = Number(route.summary.amountOutUsd ?? built.amountOutUsd ?? 0);
    const getUsd = side === "buy" ? Math.min(payUsd, ourOut ?? kGetUsd, kGetUsd > 0 ? kGetUsd : Infinity) : toNum(getRaw) * a.price;
    return {
      side, token, payRaw, router: KYBER_ROUTER, value: v.value, data: built.data, swapGas, pre, fee: a.fee, nonce: nonce0, simulated,
      quote: {
        side, chain: c.chain, coin: token, symbol: a.symbol, decimals: a.decimals, payRaw: payRaw.toString(), payUsd, getRaw: getRaw.toString(), getUsd, getMinRaw: v.minReturn.toString(),
        feeRaw: feeRaw.toString(), feeUsd: toNum(feeRaw) * a.price, route: routeName(route), slippageBps: slip, priceImpactPct: imp / 100, expiresAt: t + a.ttl,
      },
    };
  }
}
