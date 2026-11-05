// The gas guard, pure (no I/O, bigint): how much of a chain's native coin must STAY so that every coin held there can
// still be sold. The trade service caps Max, a withdraw or a move at `spendable`, and a buy at `maxBuy`.
//
//   reserveFor(chain, held, fee) = (Σ over held coins of one sell [approvals if not yet approved + the swap] + one more buy
//                                   or sell of slack) x the chain's margin
//
// The gas units are the ones the engine itself assumes (APPROVE 70k, BUY 600k, SELL 700k; a Permit2 sell is two approvals).
// A coin worth under a cent is dust: it never holds a reserve back.
import type { EvmChain } from "./chains.ts";

export const APPROVE_GAS = 70_000n;
export const BUY_GAS = 600_000n;
export const SELL_GAS = 700_000n;
export const DUST_TOKEN_USD = 0.01;
/** The margin on a reserve (num/den). Robinhood's is higher: its L1 data fee moves with Ethereum's. */
const MARGIN: Record<EvmChain, readonly [bigint, bigint]> = { hood: [5n, 2n], bsc: [3n, 2n] };
export const marginOf = (chain: EvmChain): readonly [bigint, bigint] => MARGIN[chain];
const scale = (v: bigint, chain: EvmChain): bigint => { const [n, d] = marginOf(chain); return (v * n + d - 1n) / d; };

export interface HeldToken {
  address: string;
  /** What it is worth, when known. Under DUST_TOKEN_USD it is ignored; unknown is never treated as dust. */
  usd?: number;
  /** The router / Permit2 allowance already covers a full sell: the sell is the swap alone. */
  approved?: boolean;
  /** A measured gas for this coin's swap (units), else SELL_GAS. */
  swapGas?: bigint;
}
export interface GasFeeData { /** the max fee per gas a trade signs with (wei) */ gasPrice?: bigint; /** an L1 data fee outside the gas units (wei per transaction) */ l1FeePerTx?: bigint }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const price = (f: GasFeeData): bigint => (f.gasPrice !== undefined && f.gasPrice > 0n ? f.gasPrice : 0n);

/** The coins that count: worth at least a cent (or of unknown value), one entry per address. */
export function counted(held: readonly HeldToken[]): HeldToken[] {
  const out: HeldToken[] = [];
  for (const t of held) {
    if (t.usd !== undefined && Number.isFinite(t.usd) && t.usd < DUST_TOKEN_USD) continue;
    if (out.some((o) => same(o.address, t.address))) continue;
    out.push(t);
  }
  return out;
}
/** One sell of `tok` at this fee, before any margin: (approvals + swap) gas x price + the L1 data fee per transaction. */
export function sellCost(tok: HeldToken, fee: GasFeeData): bigint {
  const txs = tok.approved ? 1n : 3n;                                     // a Permit2 sell: ERC-20 approve + Permit2 approve + the swap
  const units = (tok.approved ? 0n : 2n * APPROVE_GAS) + (tok.swapGas ?? SELL_GAS);
  return units * price(fee) + (fee.l1FeePerTx ?? 0n) * txs;
}
export const buyCost = (fee: GasFeeData): bigint => BUY_GAS * price(fee) + (fee.l1FeePerTx ?? 0n);

/** The native coin that must stay on `chain` so every held coin can still be sold. 0 when nothing above dust is held. */
export function reserveFor(chain: EvmChain, held: readonly HeldToken[], fee: GasFeeData): bigint {
  const toks = counted(held);
  if (toks.length === 0) return 0n;
  const sells = toks.reduce((n, t) => n + sellCost(t, fee), 0n);
  const dearest = toks.reduce((m, t) => { const c = sellCost(t, fee); return c > m ? c : m; }, 0n);
  const buy = buyCost(fee);
  return scale(sells + (buy > dearest ? buy : dearest), chain);
}
/** native - reserve, never below 0: what Max, a withdraw or a move may take. */
export function spendable(chain: EvmChain, native: bigint, held: readonly HeldToken[], fee: GasFeeData): bigint {
  const r = native - reserveFor(chain, held, fee);
  return r > 0n ? r : 0n;
}
/** The most a buy may spend: native - reserve(held + the coin being bought, counted in full) - this transaction's own gas. <= 0 = not enough for this buy AND a later sell. */
export function maxBuy(chain: EvmChain, native: bigint, held: readonly HeldToken[], buying: HeldToken | undefined, fee: GasFeeData, thisTxCost: bigint): bigint {
  const after = buying ? [...held.filter((h) => !same(h.address, buying.address)), { ...buying, usd: undefined }] : held;
  return native - reserveFor(chain, after, fee) - thisTxCost;
}
/** Native a chain must hold for ONE sell of `tok` now: its cost plus 10 % (the margin lives in the reserve). Below it, the sell path adds gas first. */
export const sellNeed = (tok: HeldToken, fee: GasFeeData): bigint => (sellCost(tok, fee) * 11n + 9n) / 10n;
