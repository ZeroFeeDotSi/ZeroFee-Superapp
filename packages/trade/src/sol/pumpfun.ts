// The pump.fun bonding curve (6EF8rrec...), curves quoted in SOL. The v3 instructions (17 accounts) take the user's wSOL
// account as the money leg; the older buy answers BuybackFeeRecipientMissing without extra accounts, and v2 needs 27.
// Maths, checked against real TradeEvents of the PUMPE curve: fee = ceil(sol * bps / 10000), bps = the FeeConfig tier of
// the curve's market cap.
//   buy  : net = floor(S * 10000 / (10000 + lp + protocol + creator)); tokens = floor(vt * net / (vs + net)), at most the real reserve
//   sell : gross = floor(vs * tokens / (vt + tokens)); the user gets gross - ceil(gross*(lp+protocol)) - ceil(gross*creator)
import { ceilDiv, cat, u64le } from "./bytes.ts";
import type { Struct } from "./codec.ts";
import { ataOf, DEFAULT_KEY, eventAuthority, PROGRAM, userVolumeAccumulator, WSOL } from "./keys.ts";
import { tierFees, type Fees } from "./pumpswap.ts";
import { ix, R, W, WS, type Instruction } from "./tx.ts";

export interface CurveState {
  kind: "pumpfun";
  curveAddress: string;
  curve: Struct;                      // decoded BondingCurve
  global: Struct;                     // decoded Global
  fee: Struct;                        // decoded FeeConfig (pump's)
  mint: string; baseProgram: string;
  globalAddress: string; feeConfig: string;
}
const bps = (n: bigint, b: bigint) => ceilDiv(n * b, 10_000n);

export function curveFees(s: CurveState): Fees {
  const c = s.curve;
  const mcap: bigint = c.virtual_token_reserves > 0n ? ((c.virtual_quote_reserves as bigint) * (c.token_total_supply as bigint)) / (c.virtual_token_reserves as bigint) : 0n;
  const f = tierFees(s.fee.fee_tiers, s.fee.flat_fees, mcap);
  return { ...f, creator: c.creator === DEFAULT_KEY ? 0n : f.creator };
}
export function curveBuy(s: CurveState, spend: bigint): { out: bigint; fees: Fees } {
  const c = s.curve, fees = curveFees(s);
  const net = (spend * 10_000n) / (10_000n + fees.lp + fees.protocol + fees.creator);
  let out: bigint = (c.virtual_token_reserves * net) / (c.virtual_quote_reserves + net);
  if (out > c.real_token_reserves) out = c.real_token_reserves;
  return { out, fees };
}
export function curveSell(s: CurveState, tokens: bigint): { out: bigint; gross: bigint; fees: Fees } {
  const c = s.curve, fees = curveFees(s);
  const gross: bigint = (c.virtual_quote_reserves * tokens) / (c.virtual_token_reserves + tokens);
  const out = gross - bps(gross, fees.lp + fees.protocol) - bps(gross, fees.creator);   // the curve's own fee (TradeEvent.fee), the creator's apart
  return { out: out > 0n ? out : 0n, gross, fees };
}

const D_BUY_EXACT_QUOTE_IN_V3 = [225, 247, 80, 30, 213, 179, 132, 136];
const D_SELL_V3 = [28, 146, 222, 119, 38, 196, 105, 213];
/** `a` = SOL to spend (buy) or tokens to sell; `limit` = the least tokens out (buy) or the least SOL out (sell). */
export function curveSwapIx(s: CurveState, side: "buy" | "sell", user: string, userBase: string, userQuote: string, a: bigint, limit: bigint): Instruction {
  const recipients: string[] = s.global.buyback_fee_recipients;
  const buyback = recipients[(userBase.charCodeAt(0) + userBase.charCodeAt(1)) % recipients.length]!;
  return ix(PROGRAM.pump, [
    R(s.globalAddress), R(s.mint), R(WSOL), R(s.baseProgram), R(PROGRAM.token), W(s.curveAddress), W(ataOf(s.curveAddress, s.mint, s.baseProgram)), W(ataOf(s.curveAddress, WSOL, PROGRAM.token)),
    WS(user), W(userBase), W(userQuote), W(userVolumeAccumulator(PROGRAM.pump, user)), R(s.feeConfig), W(buyback), R(PROGRAM.system), R(eventAuthority(PROGRAM.pump)), R(PROGRAM.pump),
  ], side === "buy" ? cat(D_BUY_EXACT_QUOTE_IN_V3, u64le(a), u64le(limit), [0]) : cat(D_SELL_V3, u64le(a), u64le(limit)));
}
