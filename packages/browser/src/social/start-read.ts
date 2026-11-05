// D145 (speed): the Browser start page's favourites, recent sites and open pages as last read, by the Browser's bridge.
// A start page shown again paints them at once, and each show still reads them again (SocialHub.tsx). warmStartPage lets
// the shell read them ahead when it preloads the Browser, so a first tap paints every row in its first frame (not wired
// yet: home-apps.tsx belongs to the shell's lazy fix). Kept in memory only, never written anywhere.
import type { Bridge } from "@zerofee/core/bridge";
import { loadBookmarks, type Bookmark } from "../bookmarks.ts";
import { readPages, type OpenPage } from "../tabs.ts";
import { loadHistory, type Visit } from "../visits.ts";

export type StartRead = Partial<{ favs: Bookmark[]; visits: Visit[]; pages: OpenPage[] }>;
const lastRead = new WeakMap<Bridge, StartRead>();

/** Keep a part of the start page's last read (what the page itself just read or changed). */
export const remember = (browser: Bridge, part: StartRead): void => void lastRead.set(browser, { ...lastRead.get(browser), ...part });

/** What the start page paints first for this bridge: a part never read is absent (never an empty list). */
export const startPageRead = (browser: Bridge): StartRead | undefined => lastRead.get(browser);

/** Read the three lists ahead, side by side (no screen waits on this). */
export async function warmStartPage(browser: Bridge): Promise<void> {
  const [favs, visits, pages] = await Promise.all([loadBookmarks(browser), loadHistory(browser), readPages(browser)]);
  remember(browser, { favs, visits, pages });
}
