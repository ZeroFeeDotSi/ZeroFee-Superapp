// Raydium CP-Swap (CPMMoo8L...): swap_base_input (13 accounts): amount_in, minimum_amount_out.
//   fee : trade_fee = ceil(in * trade_fee_rate / 1_000_000) comes off the input; out = floor(Rout * (in - fee) / (Rin + in - fee)),
//         with reserves = the vault amounts less the pool's accrued protocol and fund fees.
// Pools with the creator fee on aren't quoted here, and neither are Token-2022 coins with a transfer fee (engine.ts).
import { cat, ceilDiv, u64le } from "./bytes.ts";
import type { Struct } from "./codec.ts";
import { PROGRAM } from "./keys.ts";
import { CPMM_SWAP_BASE_INPUT } from "./layouts.ts";
import { ix, R, W, WS, type Instruction } from "./tx.ts";

export interface CpmmState {
  kind: "cpmm";
  poolAddress: string;
  pool: Struct;                       // decoded PoolState
  config: Struct;                     // decoded AmmConfig
  reserve0: bigint; reserve1: bigint; // vault amounts net of the accrued protocol and fund fees
  coinIs0: boolean;
  authority: string;
}
// AmmConfig.creator_fee_rate only counts on a pool that turned the creator fee on (a pool on config index 7 has rate 500
// and enable_creator_fee false)
export const cpmmSupported = (pool: Struct, _config: Struct): boolean => !pool.enable_creator_fee && pool.status === 0;

/** `coinIn` = the coin is the input token (a sell). */
export function cpmmQuote(s: CpmmState, amountIn: bigint, coinIn: boolean): bigint {
  const [rIn, rOut] = coinIn === s.coinIs0 ? [s.reserve0, s.reserve1] : [s.reserve1, s.reserve0];
  const fee = ceilDiv(amountIn * s.config.trade_fee_rate, 1_000_000n);
  const after = amountIn - fee;
  return after > 0n ? (rOut * after) / (rIn + after) : 0n;
}
export function cpmmSwapIx(s: CpmmState, user: string, coinIn: boolean, userIn: string, userOut: string, amountIn: bigint, minOut: bigint): Instruction {
  const p = s.pool;
  const in0 = coinIn === s.coinIs0;                                  // the input token is token 0
  const [vIn, vOut, mIn, mOut, tIn, tOut] = in0
    ? [p.token_0_vault, p.token_1_vault, p.token_0_mint, p.token_1_mint, p.token_0_program, p.token_1_program]
    : [p.token_1_vault, p.token_0_vault, p.token_1_mint, p.token_0_mint, p.token_1_program, p.token_0_program];
  return ix(PROGRAM.cpmm, [WS(user), R(s.authority), R(p.amm_config), W(s.poolAddress), W(userIn), W(userOut), W(vIn), W(vOut), R(tIn), R(tOut), R(mIn), R(mOut), W(p.observation_key)],
    cat(CPMM_SWAP_BASE_INPUT, u64le(amountIn), u64le(minOut)));
}
