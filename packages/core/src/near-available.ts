// The NEAR a person can use, one figure for every screen (grade 01c, P6): the approval sheet said "NEAR 9.9941 →
// 9.9871" while the Safe said 7.3038 NEAR for the same account. The sheet counted the storage NEAR locks while the
// account exists (its contract's ~2.6 NEAR) and the fee reserve; the Safe (Wallet's ledger, `spendable`) leaves both
// out. Both now use this: the account's balance less its storage and the reserve kept for network fees.

/** NEAR's storage price: 1e19 yocto a byte, locked for as long as the bytes are kept. */
export const YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
/**
 * NEAR kept on the account for network fees, never shown as usable: what a plain Send of NEAR takes up front (50 Tgas at
 * 1e9 yocto a gas unit, 0.05 NEAR, plus 0.01 NEAR of slack): 0.06 NEAR. Wallet's ledger keeps the same figure
 * (ledger.ts FEE_RESERVE_YOCTO, derived from its own gas sums); a test holds the two equal.
 */
export const FEE_RESERVE_YOCTO = 60_000_000_000_000_000_000_000n;

/** What the account can use now: its balance, less its storage and the fee reserve (never below zero). */
export function availableYocto(a: { balanceYocto: bigint; storageBytes: bigint } | null | undefined): bigint {
  if (!a) return 0n;
  const free = a.balanceYocto - a.storageBytes * YOCTO_PER_BYTE - FEE_RESERVE_YOCTO;
  return free > 0n ? free : 0n;
}
