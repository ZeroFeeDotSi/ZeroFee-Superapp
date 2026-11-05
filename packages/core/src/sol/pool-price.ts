// A pump.fun coin's price on chain, for the pocket day's drawdown when the market has no price yet (a fresh coin): its
// bonding curve's virtual reserves, or, once it graduated, its canonical PumpSwap pool's two vaults. Lamports per raw
// unit of the coin, or null. The accounts and their layouts are Trade's own (packages/trade/src/sol/keys.ts
// bondingCurveOf / canonicalPumpSwapPool, layouts.ts PUMP_LAYOUT.BondingCurve / AMM_LAYOUT.Pool): the core can't import
// Trade, so the few offsets it needs are read here. One read (two for a graduated coin).
import { base58, fromBase58, fromBase64, u64At, utf8 } from "./bytes.ts";
import { SOL, findProgramAddress } from "../solana.ts";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const CURVE_DISC = [23, 183, 248, 55, 96, 216, 172, 96];
const POOL_DISC = [241, 154, 109, 4, 17, 177, 109, 188];

export const bondingCurveOf = (mint: string): string => findProgramAddress([utf8("bonding-curve"), fromBase58(mint)], PUMP_PROGRAM);
export function canonicalPumpSwapPool(mint: string): string {
  const creator = findProgramAddress([utf8("pool-authority"), fromBase58(mint)], PUMP_PROGRAM);
  return findProgramAddress([utf8("pool"), Uint8Array.of(0, 0), fromBase58(creator), fromBase58(mint), fromBase58(SOL.wsol)], PUMP_AMM_PROGRAM);
}

type Account = { owner?: string; data?: unknown[] } | null;
const bytesOf = (a: Account): Uint8Array | null => (a && Array.isArray(a.data) ? fromBase64(String(a.data[0])) : null);
const hasDisc = (b: Uint8Array, d: number[]) => b.length >= 8 && d.every((x, i) => b[i] === x);
const keyAt = (b: Uint8Array, o: number): Uint8Array => b.subarray(o, o + 32);
const same = (a: Uint8Array, b: string) => { const k = fromBase58(b); return a.length === 32 && k.every((x, i) => a[i] === x); };
const zero = (a: Uint8Array) => a.every((x) => x === 0);

/** BondingCurve: disc 8, virtual_token @8, virtual_quote @16, …, complete @48, creator @49, two bools, quote_mint @83.
 *  A curve still trading in SOL (its quote mint wSOL, or unset on an older curve): lamports per raw unit; else null. */
export function curvePrice(a: Account): number | null {
  const b = bytesOf(a);
  if (!b || a!.owner !== PUMP_PROGRAM || !hasDisc(b, CURVE_DISC) || b.length < 49) return null;
  if (b[48] !== 0) return null; // complete: the coin moved to its pool
  if (b.length >= 115 && !zero(keyAt(b, 83)) && !same(keyAt(b, 83), SOL.wsol)) return null;
  const vToken = u64At(b, 8), vSol = u64At(b, 16);
  return vToken > 0n && vSol > 0n ? Number(vSol) / Number(vToken) : null;
}

/** Pool: disc 8, bump @8, index @9, creator @11, base_mint @43, quote_mint @75, lp_mint @107, base vault @139, quote
 *  vault @171. Its vaults when it is this coin against wSOL; else null. */
export function poolVaults(a: Account, mint: string): { base: string; quote: string } | null {
  const b = bytesOf(a);
  if (!b || a!.owner !== PUMP_AMM_PROGRAM || !hasDisc(b, POOL_DISC) || b.length < 203) return null;
  if (!same(keyAt(b, 43), mint) || !same(keyAt(b, 75), SOL.wsol)) return null;
  const k = (o: number) => base58(keyAt(b, o));
  return { base: k(139), quote: k(171) };
}

/** A token account's amount (offset 64), or null. */
const amountOf = (a: Account): bigint | null => {
  const b = bytesOf(a);
  return b && b.length >= 72 ? u64At(b, 64) : null;
};

/** The coin's on-chain price through `read` (one node's getMultipleAccounts, base64, in order). Null: neither a live
 *  SOL curve nor a SOL pool for it. */
export async function poolPriceFrom(read: (keys: string[]) => Promise<Account[]>, mint: string): Promise<number | null> {
  const [curve, pool] = await read([bondingCurveOf(mint), canonicalPumpSwapPool(mint)]);
  const onCurve = curvePrice(curve ?? null);
  if (onCurve !== null) return onCurve;
  const v = poolVaults(pool ?? null, mint);
  if (!v) return null;
  const [base, quote] = (await read([v.base, v.quote])).map((x) => amountOf(x ?? null));
  return base && quote && base > 0n && quote > 0n ? Number(quote) / Number(base) : null;
}
