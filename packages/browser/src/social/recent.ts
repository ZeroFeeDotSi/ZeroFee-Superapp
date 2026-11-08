// The Browser start page's Recent card (UI concept v3.1, 5 Nov): the sites with a wallet of their own first (pump.fun,
// GMGN: "Signed in · wallet $25.00", a tap opens their app), then the pages opened lately (visits.ts) that aren't those
// sites, newest first; RECENT_SHOWN rows at most. Pure, so node tests it. Nothing here is a recommendation: only sites
// the person signed in to or opened.
import { usd } from "@zerofee/trade/app/format.ts";
import { shortTime } from "@zerofee/core/clock";
import type { Visit } from "../visits.ts";
import { RECENT_SHOWN } from "../visits.ts";

export interface RecentSite { site: string; name: string; usd: number | null; wallet?: string; hosts: readonly string[]; /** audit 15 FB1: the last figure read and when, for a read with none */ kept?: { usd: number; at: number } }
export interface RecentRow {
  key: string;
  name: string;
  line: string;
  /** The site's id (opens its own app) or the page's url (opens the way the address bar does). */
  open: { site: string } | { url: string };
  /** The host the logo is looked up by. */
  host: string;
}

/** "Signed in · wallet $25.00"; an unread wallet keeps its last figure with its time (audit 15 FB1, rule 9a); never read,
 *  only that you're signed in. */
export const siteLine = (s: RecentSite, locale?: string): string =>
  s.usd !== null ? `Signed in · wallet ${usd(s.usd)}` : s.kept ? `Signed in · wallet ${usd(s.kept.usd)} · As of ${shortTime(s.kept.at, locale)}` : "Signed in";

/** "Opened today" / "Opened 3 Nov". */
export const visitLine = (v: Visit, now = new Date()): string => {
  const d = new Date(v.atIso);
  return d.toDateString() === now.toDateString() ? "Opened today" : `Opened ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
};

export function recentRows(sites: readonly RecentSite[], visits: readonly Visit[], now = new Date(), n = RECENT_SHOWN): RecentRow[] {
  const signed = sites.filter((s) => s.wallet).map((s): RecentRow => ({ key: `site:${s.site}`, name: s.name, line: siteLine(s), open: { site: s.site }, host: s.hosts[0] ?? s.site }));
  const taken = new Set(sites.flatMap((s) => s.hosts));
  const seen = new Set<string>();
  const pages: RecentRow[] = [];
  for (const v of [...visits].sort((a, b) => b.atIso.localeCompare(a.atIso))) {
    if (taken.has(v.host) || seen.has(v.host)) continue;
    seen.add(v.host);
    pages.push({ key: `page:${v.host}`, name: v.host, line: visitLine(v, now), open: { url: v.url }, host: v.host });
  }
  return [...signed, ...pages].slice(0, n);
}
