// The Browser's history and how a site opens. History stays on this phone (device.store, the Browser's own slot) and is
// never sent anywhere: one row per host, newest first.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";

export interface Visit {
  host: string;
  url: string;
  atIso: string;
}

const KEY = "history";
const KEEP = 30;

export async function loadHistory(bridge: Bridge): Promise<Visit[]> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: KEY });
  if ("problem" in r || !r.ok.value) return [];
  try {
    const list = JSON.parse(r.ok.value) as Visit[];
    return Array.isArray(list) ? list.filter((v) => v && typeof v.host === "string" && typeof v.url === "string" && typeof v.atIso === "string") : [];
  } catch {
    return [];
  }
}

export async function addVisit(bridge: Bridge, url: string, now = new Date()): Promise<Visit[]> {
  const host = new URL(url).host;
  const list = [{ host, url, atIso: now.toISOString() }, ...(await loadHistory(bridge)).filter((v) => v.host !== host)].slice(0, KEEP);
  await bridge.call("device.store.set", { key: KEY, value: JSON.stringify(list) });
  return list;
}

/** Product decision, 3 Nov: the newest pages on the Browser's start page, beside pump.fun and GMGN: the last `n` sites opened, never
 *  a listed site (it has its own tile) or a favourite (it has its own row). */
export const RECENT_SHOWN = 4;
export function recentOf(history: readonly Visit[], skipHosts: readonly string[], n = RECENT_SHOWN): Visit[] {
  const skip = new Set(skipHosts.map((h) => h.toLowerCase()));
  return history.filter((v) => !skip.has(v.host.toLowerCase())).slice(0, n);
}

export async function clearHistory(bridge: Bridge): Promise<void> {
  await bridge.call("device.store.set", { key: KEY, value: null });
  // on the phone, where each page was left goes too (a browser build has no such call: its Problem is ignored)
  await Promise.resolve(bridge.call("partner.clearPlaces", {})).catch(() => undefined);
}

/**
 * Open a site. On the phone, `device.openSite` shows it in ZeroFee's own window with the real host in our bar and the
 * Browser wallet built in. Where there is no such window (the web demo), the page opens in the system's browser sheet
 * (`device.openUrl`), without the wallet, and the answer says so.
 */
export async function openSite(bridge: Bridge, url: string, desktop = false): Promise<{ opened: "wallet" | "plain" } | { problem: Problem }> {
  const r = await bridge.call("device.openSite", { url, desktop });
  if ("ok" in r) return { opened: "wallet" };
  // D131: eight pages open and none may close: said ("Close a page first."), never opened another way
  if (r.problem.code === "partner.tabs.full") return { problem: r.problem };
  const plain = await bridge.call("device.openUrl", { url, mode: "sheet" });
  return "ok" in plain ? { opened: "plain" } : { problem: plain.problem };
}
