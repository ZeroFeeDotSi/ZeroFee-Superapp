// Exact NEAR amounts. Money is yoctoNEAR (bigint) inside Earn and a plain decimal string at the bridge. Percentages and
// rates are never money, so they may use floating point; amounts never do.

export const YOCTO = 10n ** 24n;
export const ONE_YOCTO = "1";
/** NEAR's storage price: 10^19 yocto per byte of an account's storage. */
export const YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
/** NEAR kept on the account for network fees, never staked (the same 0.05 NEAR Wallet keeps). */
export const FEE_RESERVE_YOCTO = 50_000_000_000_000_000_000_000n;
/** wrap.near's storage deposit, paid once so the account can hold wNEAR. */
export const WRAP_STORAGE_YOCTO = 1_250_000_000_000_000_000_000n;

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

/** "1.5" → 1.5 × 10^24 yocto. Null unless it is a plain decimal with at most 24 decimals. */
export function toYocto(amount: unknown): bigint | null {
  if (typeof amount !== "string" || !DECIMAL.test(amount)) return null;
  const [whole, raw = ""] = amount.split(".");
  const frac = raw.replace(/0+$/, "");
  if (frac.length > 24) return null;
  return BigInt(whole) * YOCTO + BigInt(frac.padEnd(24, "0") || "0");
}

/** yocto → "1.5" (exact, no grouping). */
export function fromYocto(yocto: bigint): string {
  const digits = yocto.toString().padStart(25, "0");
  const frac = digits.slice(-24).replace(/0+$/, "");
  return `${digits.slice(0, -24)}${frac ? `.${frac}` : ""}`;
}

/** For the words on a sheet: at most 4 decimals, rounded down, so it never says more than moves ("100.6657"). */
export function shortNear(yocto: bigint): string {
  const short = (yocto / 10n ** 20n) * 10n ** 20n;
  return short === 0n && yocto > 0n ? fromYocto(yocto) : fromYocto(short);
}

/** A whole number written as text, as contract views return big amounts. Null for anything else. */
export function units(v: unknown): bigint | null {
  return typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null;
}

export interface Fraction {
  numerator: number;
  denominator: number;
}

export function isFraction(v: unknown): v is Fraction {
  const f = v as Fraction;
  return !!f && Number.isInteger(f.numerator) && Number.isInteger(f.denominator) && f.denominator > 0 && f.numerator >= 0 && f.numerator <= f.denominator;
}

/** {9, 100} → "9", {25, 1000} → "2.5". */
export function percentOf(f: Fraction): string {
  return String(Math.round((f.numerator / f.denominator) * 10000) / 100);
}

/** a > b, exactly. */
export const fractionAbove = (a: Fraction, b: Fraction) => a.numerator * b.denominator > b.numerator * a.denominator;
export const sameFraction = (a: Fraction, b: Fraction) => a.numerator * b.denominator === b.numerator * a.denominator;
