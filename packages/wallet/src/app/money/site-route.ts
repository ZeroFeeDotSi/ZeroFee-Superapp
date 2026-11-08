// A site's top-up (pump.fun, GMGN), one exit (QA, 5 Nov): Private (NEAR Confidential) pays the site's wallet in
// ONE 1Click payment. Private short: the Safe fills Private first (fix/fill-intents' fill: one mt_transfer inside
// intents.near, a whole $10/$50/$100 step, one Face ID; the extra stays in Private under the 24 h sweep hold), then that
// same one payment, with no tap of its own. Never a direct Safe → site quote (it would tie the Safe to the site's wallet
// in public). Words through the copywriter (5 Nov). The pure part of SiteMoney.tsx's sheet; loaded with it, never Home's.
import { fillStepUsd } from "@zerofee/core/private-route";

export const ROUTE_WORDS = {
  // one word per move (browser-sites F14, the copywriter): Add in, Take out; the job's own title ("Add $5.00 to your pump.fun wallet")
  title: (amount: string, site: string) => `Add ${amount} to your ${site} wallet`,
  /** fromLine's place when Private pays: "From Private · $33.86 available" (Private's one figure, format.ts privateFigure). */
  fromPrivate: "Private",
  /** Audit 15 FB2 (say a figure once): when Private holds more than its USDC, the from line says only the part that pays a
   *  site, "From Private · $25.00 in USDC" (no second line with another figure). */
  inUsdc: "in USDC",
  // the copywriter's voice guard (64997494c): no service named where it only did its job
  private: "NEAR Confidential pays it from Private. No Face ID.",
  fill: (have: string | null, fill: string) => `${have ? `Private has ${have} in USDC. ` : ""}Your Safe adds ${fill} to Private first, with Face ID. Then NEAR Confidential pays it. The extra stays in Private.`,
  closed: (have: string) => `Private has ${have} in USDC. Adding from your Safe isn't open yet.`,
} as const;

/** How this amount goes: Private alone (one exit, no Face ID), the Safe's fill then the exit, the fill not open yet (the
 *  button is off), or Private not read yet (the core decides on the tap). */
export type SiteRoute = { kind: "private" } | { kind: "fill"; fillUsd: number } | { kind: "closed"; haveUsd: number } | { kind: "unread" };

/** `privateUsd`: Private's USDC in dollars (privateUsdcOf), null while unread; `fillOpen`: VITE_SAFE_FILL_OPEN. Private
 *  covers it: no fill. Short: the fill of the WHOLE amount, rounded up a step (safe-send.ts `whole`), never the gap. */
export function siteRoute(usd: number, privateUsd: number | null, fillOpen: boolean): SiteRoute {
  if (privateUsd === null) return { kind: "unread" };
  if (privateUsd + 0.000001 >= usd) return { kind: "private" };
  return fillOpen ? { kind: "fill", fillUsd: fillStepUsd(usd) } : { kind: "closed", haveUsd: privateUsd };
}

/** Private's USDC (the coin a top-up pays from, as spending.topUp counts it): null while the pocket isn't read; 0 with
 *  none set up on this phone. */
export function privateUsdcOf(pocket: { available: boolean; ready: boolean; rows: readonly { symbol: string; amount: string }[] } | null): number | null {
  if (!pocket) return null;
  if (!pocket.available || !pocket.ready) return 0;
  return pocket.rows.filter((r) => r.symbol === "USDC").reduce((n, r) => n + (Number(r.amount) || 0), 0);
}

/** The From line's figure when Private pays (test, MUST 3): Private's one figure (format.ts privateFigure), never its
 *  USDC alone; the USDC that pays a site said in its own line when it is less. Private's figure not read: its USDC. */
export function privateFrom(figure: string | null, usdc: number | null): { usd: string | null; usdc?: true } {
  if (figure === null) return { usd: usdc === null ? null : usdc.toFixed(2) };
  const pays = Math.floor((usdc ?? 0) * 100 + 1e-6) / 100;
  return Number(figure) - pays >= 0.01 ? { usd: pays.toFixed(2), usdc: true } : { usd: figure };
}
