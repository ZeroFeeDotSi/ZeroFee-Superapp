// A site wallet's Take out finishes from its saved record, never from the page that started it (QA's
// browser-sites crawl F1, MUST, 5 Nov: a reload 0.7 s after a Move back left $14.85 in the NEAR wallet for good; the
// real $2 Take out the same). The core keeps every Take out (float-moves.ts, thenHome) and sends a landed first leg on
// home whenever its moves back are read (goHome, its own key: once). So the shell reads them once the account is home,
// on any app, and again while one is still open: no page, no tap. Reading only; nothing here signs or moves money.
import type { Bridge } from "@zerofee/core/bridge";
import { every } from "@zerofee/shell-api/rest.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { endOldSiteMoneyRows } from "@zerofee/shell-api/site-money-rows.ts";

interface Back { back?: { status?: string; homeId?: string; homeStopped?: string }; home?: { status?: string } }
/** Still going: leg 1 on its way, or landed with its leg home not started or not ended. */
export const stillOpen = (b: Back): boolean => {
  const s = b.back?.status, h = b.home?.status;
  if (s === "pending") return true;
  if (s !== "done") return false;
  // its leg home refused for good (said on its row): the quiet minute read tries it again, never every few seconds
  return h === undefined ? !b.back?.homeStopped : h === "pending";
};

export const RESUME_MS = 10_000;

export function resumeTakeOuts(bridge: Bridge, ms: number = RESUME_MS): () => void {
  // none open: a quiet read each minute (a Take out started later, in another window); one open: every `ms`
  let open = true, busy = false, live = true, n = 0;
  const read = () => {
    if (!live || busy || (!open && ++n % 6 !== 0)) return;
    busy = true;
    void bridge.call<Back[]>("subwallet.site.moveBacks").then((r) => {
      open = "ok" in r && Array.isArray(r.ok) ? r.ok.some(stillOpen) : open;
    }, () => undefined).finally(() => { busy = false; });
  };
  // the Browser's old rows for these moves (they never ended): ended once, saying the move is on Home now
  try { const store = taskStore(); endOldSiteMoneyRows(store.list(), store.forApp("browser")); } catch { /* no store: nothing to end */ }
  read();
  const stop = every(ms, read);
  return () => { live = false; stop(); };
}
