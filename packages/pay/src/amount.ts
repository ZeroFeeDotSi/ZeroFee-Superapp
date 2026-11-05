// Amounts are decimal strings everywhere (docs/interfaces.md). These helpers do exact arithmetic on them with BigInt, so
// no amount ever passes through a float. Prices are decimal strings too; only ranking ever compares estimates.

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** A non-negative decimal written plainly: "12", "12.5", "0.000001". No signs, exponents or separators. */
export function isDecimal(s: string): boolean {
  return DECIMAL.test(s);
}

interface Scaled {
  units: bigint;
  scale: number;
}

function scaled(s: string): Scaled {
  const m = DECIMAL.exec(s);
  if (!m) throw new Error(`not a decimal amount: "${s}"`);
  const frac = m[2] ?? "";
  return { units: BigInt(m[1] + frac), scale: frac.length };
}

function rescale(a: Scaled, scale: number): bigint {
  return a.units * 10n ** BigInt(scale - a.scale);
}

function render(units: bigint, scale: number): string {
  const digits = units.toString().padStart(scale + 1, "0");
  const int = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** "12.5" with 6 decimals → 12500000n. Null if the amount has more decimals than the token can carry. */
export function toUnits(amount: string, decimals: number): bigint | null {
  const a = scaled(amount);
  if (a.scale > decimals) {
    // Trailing zeros beyond the token's precision are harmless ("1.500" for a 2-decimal currency).
    const extra = 10n ** BigInt(a.scale - decimals);
    if (a.units % extra !== 0n) return null;
    return a.units / extra;
  }
  return rescale(a, decimals);
}

/** 12500000n with 6 decimals → "12.5". */
export function fromUnits(units: bigint, decimals: number): string {
  if (units < 0n) throw new Error("negative amount");
  return render(units, decimals);
}

/** Tidy a decimal: no leading or trailing zeros ("012.50" → "12.5"). */
export function normalise(amount: string): string {
  const a = scaled(amount);
  return render(a.units, a.scale);
}

export function compare(a: string, b: string): -1 | 0 | 1 {
  const x = scaled(a);
  const y = scaled(b);
  const scale = Math.max(x.scale, y.scale);
  const d = rescale(x, scale) - rescale(y, scale);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

export function isZero(a: string): boolean {
  return scaled(a).units === 0n;
}

export function add(a: string, b: string): string {
  const x = scaled(a);
  const y = scaled(b);
  const scale = Math.max(x.scale, y.scale);
  return render(rescale(x, scale) + rescale(y, scale), scale);
}

/** a − b, never below zero (throws if it would be). */
export function sub(a: string, b: string): string {
  const x = scaled(a);
  const y = scaled(b);
  const scale = Math.max(x.scale, y.scale);
  const d = rescale(x, scale) - rescale(y, scale);
  if (d < 0n) throw new Error(`${a} − ${b} is negative`);
  return render(d, scale);
}

/** Exact product, e.g. amount × price. */
export function mul(a: string, b: string): string {
  const x = scaled(a);
  const y = scaled(b);
  return render(x.units * y.units, x.scale + y.scale);
}

/** Round to `places` decimals, up (for "at most") or down (for "at least"). */
export function round(amount: string, places: number, direction: "up" | "down"): string {
  const a = scaled(amount);
  if (a.scale <= places) return render(a.units, a.scale);
  const step = 10n ** BigInt(a.scale - places);
  let units = a.units / step;
  if (direction === "up" && a.units % step !== 0n) units += 1n;
  return render(units, places);
}

/**
 * A whole number of base units as payment links write it: "2014000000000000000", or with an exponent, "2.014e18"
 * (EIP-681). Null if it isn't a whole, non-negative number.
 */
export function wholeUnits(text: string): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?(?:[eE]\+?(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  const exp = Number(m[3] ?? "0");
  if (exp > 80) return null;
  if (frac.length > exp) {
    // Digits left after the exponent must all be zero, or this isn't a whole number of units.
    if (!/^0*$/.test(frac.slice(exp))) return null;
    return BigInt(m[1] + frac.slice(0, exp));
  }
  return BigInt(m[1] + frac) * 10n ** BigInt(exp - frac.length);
}
