// A site wallet's Add or Take out the Browser made as its own task before (site-tasks.ts addTask/backTask, "add-…",
// "back-…"): their moves are Home's own jobs now (Now, the tracker, Home's Activity). Such a row opens Home's Activity,
// never the Browser's start page (browser-sites crawl F2), and one left going ends, saying where the move is now.
import type { Task, Tasks } from "./tasks.ts";

export const siteMoneyRow = (t: Pick<Task, "app" | "id">): boolean => t.app === "browser" && /^(add|back)-/.test(t.id);
export const SITE_MONEY_MOVED = "This move is on Home now.";

/** Ends every one still going (`browser`: the Browser's own facade, the only one that may end its tasks). */
export function endOldSiteMoneyRows(list: readonly Task[], browser: Pick<Tasks, "end">): number {
  let n = 0;
  for (const t of list) if (siteMoneyRow(t) && t.state === "pending" && browser.end(t.id, "stopped", SITE_MONEY_MOVED)) n++;
  return n;
}
