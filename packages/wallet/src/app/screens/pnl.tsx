// Home's day change (H-1), drawn once the pulse has answered: loaded with pulse.ts after Home's first paint, never in its
// first load (speed-budget.test.ts).
import type { ReactNode } from "react";

/** The day's change the way money apps write it (product decision, 3 Nov): "−$0.02 (−0.04%) Today",
 *  green up, red down, the sign on both figures; the percent against the money before the change (none when unknown). */
export function pnl(up: boolean, amount: string, total: string | null): ReactNode {
  const usd = Number(amount.replace(/[$,]/g, ""));
  const now = total === null ? NaN : Number(total);
  const before = up ? now - usd : now + usd;
  const pct = Number.isFinite(before) && before > 0 ? (usd / before) * 100 : null;
  const sign = up ? "+" : "\u2212";
  const pctText = pct === null ? "" : ` (${sign}${pct >= 10 ? Math.round(pct) : pct.toFixed(2)}%)`;
  return (
    <span aria-label={`${up ? "Up" : "Down"} ${amount} today`}>
      <span className={`wl-pnl ${up ? "is-up" : "is-down"}`}>{`${sign}${amount}${pctText}`}</span>
      <span className="wl-pnl__when">Today</span>
    </span>
  );
}
