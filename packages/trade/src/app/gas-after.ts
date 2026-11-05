// The Buy sheet's own read of the planner's gas rule (outside Home's first load: the speed budget).
import { DEFAULT_POLICY, gasTopUpUsd, type FloatPolicy } from "../float.ts";
import type { ChainId } from "../types.ts";

/** A buy's own costs past its price the sheet allows for (Solana: the coin account's deposit and pump.fun's one-time
 *  account, about $0.40 between them), so a buy that ends just under the fee reserve is said too. */
export const BUY_ROOM_USD: Partial<Record<ChainId, number>> = { sol: 0.6 };
/**
 * The crawl (4 Nov: "$2.10 kept for fees on Solana" moved right after a buy, with no tap): the gas top-up a buy sets off,
 * said on the Buy sheet BEFORE the tap (the product rule: nothing moves unasked unless it was set up and said). The
 * planner tops up a wallet that holds coins and is under its fee reserve, from the NEAR wallet's cash when it has that
 * much (float-core round, gasTopUps). Its dollars, or null: nothing moves.
 */
export function gasAfterBuy(o: { chain: ChainId; nativeUsd: number; payUsd: number; feeUsd: number; floatUsd: number }, p: FloatPolicy = DEFAULT_POLICY): number | null {
  const reserve = p.feeReserveUsd[o.chain] ?? 0;
  const left = o.nativeUsd - o.payUsd - o.feeUsd - (BUY_ROOM_USD[o.chain] ?? 0);
  if (!(reserve > 0) || left >= reserve) return null;
  const usd = gasTopUpUsd(o.chain, p.feeReserveUsd);
  return usd <= o.floatUsd ? usd : null;
}
