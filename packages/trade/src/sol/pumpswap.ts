// PumpSwap AMM (pAMMBay6...): the quote with the program's own maths and the v2 swap instruction, built from the pool.
// Checked on chain against 30 real BuyEvent / SellEvent logs of the MONEYBIZ pool: the maths gives the same amounts, and
// the account list is the IDL's buy_exact_quote_in_v2 / sell_v2 (17 accounts; fees accrue inside the pool account).
//   reserves : base = the pool's base vault; quote = the quote vault + pool.virtual_quote_reserves
//   buy      : the largest net n with n + ceil(n*lp) + ceil(n*protocol) + ceil(n*creator) <= spend; out = floor(Rb * n / (Rq + n))
//   sell     : gross = floor(Rq * in / (Rb + in)); the user gets gross less ceil(gross*lp), ceil(gross*protocol), ceil(gross*creator)
//   fee bps  : the FeeConfig tier of the pool's market cap (Rq * supply / Rb, in lamports); no coin creator = no creator fee
import { ceilDiv, cat, u64le } from "./bytes.ts";
import type { Struct } from "./codec.ts";
import { ataOf, DEFAULT_KEY, eventAuthority, PROGRAM, userVolumeAccumulator, WSOL } from "./keys.ts";
import { ix, R, W, WS, type Instruction } from "./tx.ts";

export interface AmmState {
  kind: "pumpswap";
  poolAddress: string;
  pool: Struct;                       // decoded Pool
  cfg: Struct;                        // decoded GlobalConfig
  fee: Struct;                        // decoded FeeConfig
  baseReserve: bigint;                // the pool's base vault
  quoteReserve: bigint;               // the pool's quote vault + its virtual quote reserves
  supply: bigint;                     // the base mint's supply
  baseProgram: string;                // Token or Token-2022, the coin's
  globalConfig: string; feeConfig: string;
}
export interface Fees { lp: bigint; protocol: bigint; creator: bigint }

export function tierFees(tiers: Struct[], flat: Struct, mcap: bigint): Fees {
  let f = tiers.length ? tiers[0]!.fees : flat;
  for (const t of tiers) { if (mcap >= t.market_cap_lamports_threshold) f = t.fees; else break; }
  return { lp: f.lp_fee_bps, protocol: f.protocol_fee_bps, creator: f.creator_fee_bps };
}
export function ammFees(s: AmmState): Fees {
  const mcap = s.baseReserve > 0n ? (s.quoteReserve * s.supply) / s.baseReserve : 0n;
  const f = tierFees(s.fee.fee_tiers, s.fee.flat_fees, mcap);
  return { ...f, creator: s.pool.coin_creator === DEFAULT_KEY ? 0n : f.creator };
}
const bps = (n: bigint, b: bigint) => ceilDiv(n * b, 10_000n);

export function ammBuy(s: AmmState, spend: bigint): { out: bigint; fees: Fees } {
  const fees = ammFees(s);
  // checked on a simulated buy_exact_quote_in_v2: 9,464,679 spent -> net 9,375,609 -> 707,887,468 base
  let eff = (spend * 10_000n) / (10_000n + fees.lp + fees.protocol + fees.creator);
  while (eff > 0n && eff + bps(eff, fees.lp) + bps(eff, fees.protocol) + bps(eff, fees.creator) > spend) eff--;
  const out = (s.baseReserve * eff) / (s.quoteReserve + eff);
  return { out: out < s.baseReserve ? out : 0n, fees };
}
export function ammSell(s: AmmState, baseIn: bigint): { out: bigint; gross: bigint; fees: Fees } {
  const fees = ammFees(s);
  const gross = (s.quoteReserve * baseIn) / (s.baseReserve + baseIn);
  const out = gross - bps(gross, fees.lp) - bps(gross, fees.protocol) - bps(gross, fees.creator);
  return { out: out > 0n ? out : 0n, gross, fees };
}

const D_BUY_EXACT_QUOTE_IN_V2 = [194, 171, 28, 70, 104, 77, 91, 47];
const D_SELL_V2 = [93, 246, 130, 60, 231, 233, 64, 178];
/** The v2 swap (17 accounts). `a` = SOL to spend (buy) or coins to sell; `limit` = the least base out (buy) or the least SOL out (sell). */
export function ammSwapIx(s: AmmState, side: "buy" | "sell", user: string, userBase: string, userQuote: string, a: bigint, limit: bigint): Instruction {
  const p = s.pool;
  // v2's buyback fee recipient is the wSOL account of one of GlobalConfig.buyback_fee_recipients (checked on chain); any is
  // accepted, so the user's key spreads them
  const recipients: string[] = s.cfg.buyback_fee_recipients;
  const buyback = ataOf(recipients[(userBase.charCodeAt(0) + userBase.charCodeAt(1)) % recipients.length]!, WSOL, PROGRAM.token);
  return ix(PROGRAM.pumpAmm, [
    W(s.poolAddress), WS(user), R(s.globalConfig), R(p.base_mint), R(p.quote_mint), W(userBase), W(userQuote), W(p.pool_base_token_account), W(p.pool_quote_token_account),
    R(s.baseProgram), R(PROGRAM.token), R(PROGRAM.system), W(userVolumeAccumulator(PROGRAM.pumpAmm, user)), R(s.feeConfig), W(buyback), R(eventAuthority(PROGRAM.pumpAmm)), R(PROGRAM.pumpAmm),
  ], cat(side === "buy" ? D_BUY_EXACT_QUOTE_IN_V2 : D_SELL_V2, u64le(a), u64le(limit)));
}
