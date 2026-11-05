// Social trading (S17, 5 Nov; the copy review's
// words): ONE entry in All apps and the bottom row, its sites listed inside it by their names. A site is named as a
// site ("on pump.fun", "your pump.fun wallet"), never as "the pump.fun app". Kept apart (no logos, no catalog) so the
// shell can name the entry without loading any of the Browser's code into Home's first load. Pure (social-trading.test.ts).
import type { SpendingWallet } from "@zerofee/core/spending";

export const SOCIAL_TRADING = {
  /** The entry's name in All apps, the bottom row, its page's bar and Home's Hot heading. */
  name: "Social trading",
  /** Its short name, where a tile or a tab has room for one word (the tray at 390 cut "Social trading"). */
  short: "Social",
  /** Its sub-line: the sites inside it, more to come. */
  line: "pump.fun, GMGN, more soon",
} as const;

/** Each site's dollars: the sum of its current site wallets (Spending's one figure each); null while any of them can't be
 *  read, or the list isn't (never a made-up $0). */
export function siteFigures(wallets: readonly SpendingWallet[] | null, sites: readonly string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const site of sites) {
    const mine = (wallets ?? []).filter((w) => w.role === "site" && w.site === site && w.current);
    out[site] = !wallets || mine.some((w) => w.unread) ? null : mine.reduce((t, w) => t + (Number(w.cashUsd) || 0) + (Number(w.coinsUsd) || 0), 0);
  }
  return out;
}

/** The site a request names (openApp("social", "pump")), if it is one of `sites`. */
export const siteOf = (tab: string | undefined, sites: readonly string[]): string | null => (tab && sites.includes(tab) ? tab : null);
