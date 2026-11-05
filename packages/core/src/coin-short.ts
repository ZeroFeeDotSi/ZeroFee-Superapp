// A coin figure on a sheet line or an Activity row (mainnet rehearsal, 3 Nov: "Send 0.127781877210164154267814 wNEAR",
// "paying 0.000000000000000000000001 NEAR"): at most 4 decimals; the exact figure, where the signature needs it, one tap
// away in the sheet's "Exact amounts" disclosure. Its own file so the first load (format.ts) never carries it.
import { formatAmount, Unnamed } from "./format.ts";
import type { Details } from "./signer.ts";

/** The most decimals a coin figure has on a line. */
export const COIN_LINE_DECIMALS = 4;

/** A coin figure for a line: at most COIN_LINE_DECIMALS places, rounded as asked ("up" for what is paid, so the line is
 *  never less than what leaves; "down" for what arrives); under 0.0001, "under 0.0001". `exact`: nothing was rounded. */
export function coinShort(units: bigint, decimals: number, round: "down" | "up"): { text: string; exact: boolean } {
  if (units < 0n) return { text: formatAmount(units, decimals), exact: true };
  const unit = 10n ** BigInt(decimals - Math.min(decimals, COIN_LINE_DECIMALS));
  const rest = units % unit;
  if (rest === 0n) return { text: formatAmount(units, decimals), exact: true };
  if (units < unit) return { text: `under ${formatAmount(unit, decimals)}`, exact: false };
  return { text: formatAmount(units - rest + (round === "up" ? unit : 0n), decimals), exact: false };
}

/** One sheet's short figures: each said short on its line, its exact figure kept for the "Exact amounts" disclosure. */
export class Figures {
  private readonly exact: string[] = [];
  short(units: bigint, decimals: number, symbol: string, round: "down" | "up"): string {
    const s = coinShort(units, decimals, round);
    const whole = `${formatAmount(units, decimals)} ${symbol}`;
    if (!s.exact && !this.exact.includes(whole)) this.exact.push(whole);
    return `${s.text} ${symbol}`;
  }
  details(): Details[] {
    return this.exact.length ? [{ label: "Exact amounts", lines: [...this.exact] }] : [];
  }
}

/** A sheet's coins: Unnamed's (a coin ZeroFee can't name) and a named coin's short figures, both disclosures on it. */
export class SheetCoins extends Unnamed {
  private readonly figures = new Figures();
  short(units: bigint, decimals: number, symbol: string, round: "down" | "up"): string {
    return this.figures.short(units, decimals, symbol, round);
  }
  override details(): Details[] {
    return [...super.details(), ...this.figures.details()];
  }
}
