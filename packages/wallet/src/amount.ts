// Exact amounts. Money is a whole number of the coin's smallest unit (bigint) inside the ledger, and a decimal string at
// the bridge. Nothing here uses floating point except the dollar estimate, which is never money.

const DECIMAL = /^(0|[1-9]\d*)(\.\d+)?$/;

export const isDecimal = (s: unknown): s is string => typeof s === "string" && DECIMAL.test(s);

/** The most decimals any amount here is worked in: a coin has at most 30 (catalogue.ts), the dollar estimate 36. */
const MAX_DECIMALS = 36;
/** A number of decimals amount math may use: a whole number 0..36 (audit W-5). */
export const validDecimals = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= MAX_DECIMALS;

/** "1.5" with 6 decimals → 1500000n. Null if it isn't a plain decimal, has more digits than the coin allows, or the decimals aren't a sane whole number. */
export function toUnits(amount: string, decimals: number): bigint | null {
  if (!isDecimal(amount) || !validDecimals(decimals)) return null;
  const [whole, rawFrac = ""] = amount.split(".");
  const frac = rawFrac.replace(/0+$/, "");
  if (frac.length > decimals) return null;
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 1500000n with 6 decimals → "1.5". */
export function fromUnits(units: bigint | string, decimals: number): string {
  if (!validDecimals(decimals)) throw new Error(`an amount with ${decimals} decimals can't be shown`);
  const n = BigInt(units);
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** The dollar estimate of an amount at a price, rounded down to cents ("12.49"). Undefined without a usable price.
 *  `nearest`: to the nearest cent instead, as the approval sheet and Send's review say it (grade 02h, H1: a balance row
 *  rounded down said $30.40 where the review said $30.41 for the same NEAR at the same price). */
export function usdOf(amount: string, priceUsd: string | number | undefined, nearest = false): string | undefined {
  if (priceUsd === undefined) return undefined;
  const price = typeof priceUsd === "number" ? priceUsd.toFixed(18) : priceUsd;
  if (!isDecimal(price)) return undefined;
  const a = toUnits(amount, 36);
  const p = toUnits(price.replace(/(\.\d{18})\d+$/, "$1"), 18);
  if (a === null || p === null) return undefined;
  const unit = 10n ** BigInt(36 + 18 - 2);
  const [whole, frac = ""] = fromUnits((a * p + (nearest ? unit / 2n : 0n)) / unit, 2).split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}
