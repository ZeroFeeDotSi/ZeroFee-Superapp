// Instant open for pump.fun and GMGN (product decision, 3 Nov): what the start page asks the phone to build off screen
// (device.warmSite, WarmSites.swift), once its wallets are read. Pure, so node tests it.
import type { HubRow } from "./hub-state.ts";

export interface WarmAsk { url: string; pill?: string }

/**
 * The listed sites whose wallet is made, after a good read, each once: their own address and the window's pill. Nothing
 * before the first read (a window with no wallet would sign nothing), nothing on the web (no phone to build it).
 */
export function warmAsks(rows: readonly HubRow[], read: "first" | "ok" | "failed", listed: readonly { id: string; preset: { url: string } }[], pillOf: (r: HubRow) => string | undefined, done: ReadonlySet<string>): WarmAsk[] {
  if (read !== "ok") return [];
  const out: WarmAsk[] = [];
  for (const a of listed) {
    if (done.has(a.id)) continue;
    const r = rows.find((x) => x.site === a.id);
    if (!r?.wallet) continue;
    const pill = pillOf(r);
    out.push({ url: a.preset.url, ...(pill ? { pill } : {}) });
  }
  return out.slice(0, 2);
}
