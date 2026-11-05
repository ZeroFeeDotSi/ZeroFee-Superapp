// A coin still on its launchpad curve trades ON the curve: that is where its liquidity is (a pool beside it is dust until
// it graduates). four.meme (BNB Chain, BNB- or BEP20-quoted), Flap (both chains), Pons, hood.fun and RobinFun (Robinhood).
// The curve's own quote, the floor in the calldata, and a simulation of the exact trade before it is offered.
import { bigOf, hexBig } from "./bytes.ts";
import {
  APPROVE_GAS_ASSUMED, APPROVE_GAS_FALLBACK, ceilMul, memo, NoGas, nonceFloor, paidPrice, Refusal, SELL_THIN_IMPACT_BPS, THIN_IMPACT_BPS, toNum,
  type Built, type Ctx, type Side, type WalletSide,
} from "./context.ts";
import { approveCall, fourSellAmount, quoteBuy, quoteSell, routerOf, sellsBack, spenderOf, tradeData, venueOf, type Venue } from "./launchpads.ts";
import { ChainSaid } from "./rpc.ts";
import { impactBps, slippageBps } from "./slippage.ts";
import { allowanceData } from "./v4.ts";

/** Is the coin on a launchpad curve? One eth_call or two, remembered 30 s (a minute more while it refreshes). */
export const venueFor = (c: Ctx, token: string): Promise<Venue | null> => memo(c.now, c.m.venue, token, 30_000, async () => (await venueOf(c.chain, token, c.call)) ?? null, 60_000);

export interface NativeIn {
  side: Side; token: string; payRaw: bigint; isMax: boolean; price: number; fee: Built["fee"]; maxFee: bigint; baseFee: bigint;
  /** A buy keeps this much more native for the sales of the other coins the wallet holds (fix review RT-4). */
  othersGas?: bigint;
  symbol: string; decimals: number; liquidity?: number; ctxP: Promise<WalletSide>; mktUsd?: number; ttl: number;
}

export async function buildNative(c: Ctx, a: NativeIn, v: Venue): Promise<Built> {
  const { side, token } = a, w = c.d.owner;
  const spender = spenderOf(v), router = routerOf(v);
  // four.meme moves the coin in whole gwei units only (any other amount reverts "GW"): a sell rounds DOWN to a multiple of 1e9
  const payRaw = side === "sell" && v.kind === "four" ? fourSellAmount(a.payRaw) : a.payRaw;
  if (payRaw <= 0n) throw new Refusal("no-balance", `You don't hold enough ${a.symbol} to sell`);
  const [ctx, out, allowance] = await Promise.all([
    a.ctxP,
    (side === "buy" ? quoteBuy(v, token, payRaw, w, c.call, c.sim) : quoteSell(v, token, payRaw, c.call, c.sim, w))
      .catch((e) => { if (e instanceof Error && /insufficient funds/i.test(e.message)) throw new NoGas(`balance does not cover ${payRaw}`); throw e; }),
    side === "sell" ? c.call(token, allowanceData(c.wallet, spender)).then((r) => bigOf(r, "allowance")).catch(() => 0n) : Promise.resolve(0n),
  ]);
  if (!(out > 0n)) throw new Refusal("thin", "Not enough for sale at this amount", `${v.name} quoted 0`);
  // NEVER A BUY THAT CAN'T BE SOLD: a Flap / hood.fun / RobinFun curve buy is simulated with its own sell right after (Flap on BNB Chain has coins whose every sell reverts)
  if (side === "buy" && (v.kind === "flap" || v.kind === "fun")) {
    const s = c.m.sell.get(token);
    let ok = s && c.now() - s.at < (s.ok ? 300_000 : 120_000) ? s.ok : undefined;
    if (ok === undefined) { const r = await sellsBack(v, token, payRaw, out, w, c.sim); if (r !== undefined) { ok = r; c.m.sell.set(token, { at: c.now(), ok: r }); } }
    if (ok === false) throw new Refusal("unsellable", "This coin can't be sold back right now", `${v.name}: its sell reverts`);
  }
  const nativeBal = ctx.nativeBal, nonce0 = Math.max(ctx.nonce, nonceFloor(c));
  // the market price says how far this amount moves the curve (a quiet curve can be thin); with no market price the curve's own quote stands
  const mkt = a.mktUsd && a.mktUsd > 0 ? a.mktUsd : undefined;
  const inUsd = side === "buy" ? toNum(payRaw) * a.price : mkt ? toNum(payRaw, a.decimals) * mkt : undefined;
  const outUsd = side === "buy" ? (mkt ? toNum(out, a.decimals) * mkt : undefined) : toNum(out) * a.price;
  const imp = inUsd !== undefined && outUsd !== undefined ? impactBps(inUsd, outUsd) : 0;
  // a SELL on a thin curve goes through up to 60 %: the coin is the user's, and refusing it would leave them no way out (the floor still holds the quoted amount)
  if (imp > (side === "sell" ? SELL_THIN_IMPACT_BPS : THIN_IMPACT_BPS)) throw new Refusal("thin", "Not enough for sale at this amount", `${v.name} impact ${imp / 100}%`);
  const payUsd = inUsd ?? 0;
  const slip = slippageBps({ liquidityUsd: a.liquidity, payUsd, impactBps: inUsd !== undefined && outUsd !== undefined ? imp : undefined });   // undefined: not measured
  const floor = (out * BigInt(10_000 - slip)) / 10_000n;
  const data = tradeData(v, side, token, payRaw, floor, w);
  const value = side === "buy" ? payRaw : 0n;
  const needsApprove = side === "sell" && allowance < payRaw;
  let swapGas: bigint;
  let simulated = false;
  if (!needsApprove) {
    // the exact call from the wallet: a revert here is the curve's own verdict (the price moved past the floor, or it refuses)
    let est: bigint;
    try { est = bigOf(await c.rpc("eth_estimateGas", [{ from: w, to: router, value: hexBig(value), data }]), "eth_estimateGas"); }
    catch (e) {
      if (e instanceof ChainSaid && /insufficient funds/i.test(e.message)) throw new NoGas(`balance ${nativeBal} does not cover the amount plus gas`, nativeBal === 0n);
      if (e instanceof ChainSaid) throw new Refusal("reverted", side === "buy" ? "This coin can't be bought right now" : "This coin can't be sold right now", e.reason);
      throw e;
    }
    swapGas = ceilMul(est, 13n, 10n);
    simulated = true;
  } else {
    // a sell whose approve isn't mined can't be estimated: its gas is the simulated approve + sell's own figure (+30 %). A fixed 300k ran out of gas on a taxed four.meme coin
    const sv = await c.sim([{ from: w, to: token, data: approveCall(spender, payRaw) }, { from: w, to: router, data, value: 0n }]).catch(() => undefined);
    const used = sv?.[1]?.status === "0x1" ? BigInt(sv[1].gasUsed ?? 0) : 0n;
    swapGas = used > 0n ? ceilMul(used, 13n, 10n) : c.chain === "bsc" ? 600_000n : 450_000n;
    if (swapGas < 150_000n) swapGas = 150_000n;
    simulated = used > 0n;
  }
  // the approve is EXACTLY this sell's amount, to the contract the trade goes through (guardrail)
  const pre: Built["pre"] = needsApprove ? [{ to: token, data: approveCall(spender, payRaw), gas: APPROVE_GAS_FALLBACK, spender }] : [];
  const gasNow = swapGas * a.maxFee + pre.reduce((n, x) => n + x.gas * a.maxFee, 0n);
  if (side === "buy") {
    const laterSell = ceilMul((APPROVE_GAS_ASSUMED + swapGas) * a.maxFee, 3n, 2n) + (a.othersGas ?? 0n);
    // every buy keeps one later sale's gas (audit EVM-6), as the aggregator path does
    if (nativeBal < payRaw + gasNow + laterSell) throw new NoGas(`balance ${nativeBal} < amount ${payRaw} + gas ${gasNow} + the later sell ${laterSell}`, nativeBal === 0n);
  } else if (nativeBal < gasNow) throw new NoGas(`balance ${nativeBal} < gas ${gasNow}`, nativeBal === 0n);
  const expectedGas = (swapGas * 10n) / 13n + pre.reduce((n, x) => n + (x.gas * 10n) / 13n, 0n);
  const feeRaw = expectedGas * paidPrice(a.fee, a.baseFee);
  const t = c.now();
  return {
    side, token, payRaw, router, value, data, swapGas, pre, fee: a.fee, nonce: nonce0, simulated, ...(v.kind === "pons" ? { curve: v.curve } : {}),
    quote: {
      side, chain: c.chain, coin: token, symbol: a.symbol, decimals: a.decimals, payRaw: payRaw.toString(), payUsd, getRaw: out.toString(), getUsd: outUsd ?? 0, getMinRaw: floor.toString(),
      feeRaw: feeRaw.toString(), feeUsd: toNum(feeRaw) * a.price, route: v.name, slippageBps: slip, priceImpactPct: imp / 100, expiresAt: t + a.ttl,
    },
  };
}
