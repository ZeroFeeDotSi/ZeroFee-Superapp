// D131, the Browser's open pages (tabs): on the phone, each page the person opened stays open in the back until they
// close it. The start page shows them as a strip; a tap shows one, × closes it. Only the host and the page's own title
// cross from the phone, nothing else of the page. On the web there are no tabs (each site is the browser's own tab).
import type { Bridge } from "@zerofee/core/bridge";

export interface OpenPage {
  id: string;
  host: string;
  title: string;
  private: boolean;
}

export const OPEN_PAGES = {
  head: "Open pages",
  close: (name: string) => `Close ${name}`,
  show: (name: string) => `Show ${name}`,
  gone: "That page isn't open anymore.",
} as const;

/** The phone's answer, read strictly: a page with a bad id or host is left out; anything else is no pages. */
export function pagesOf(raw: unknown): OpenPage[] {
  const tabs = (raw as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(tabs)) return [];
  const out: OpenPage[] = [];
  for (const t of tabs.slice(0, 16)) {
    if (!t || typeof t !== "object") continue;
    const { id, host, title } = t as Record<string, unknown>;
    if (typeof id !== "string" || !/^[0-9A-F-]{36}$/i.test(id) || typeof host !== "string" || !/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) continue;
    const name = typeof title === "string" && title.trim() ? title.trim().slice(0, 60) : host;
    out.push({ id, host, title: name, private: (t as { private?: unknown }).private === true });
  }
  return out;
}

/** The open pages, or none (the web, an older phone, or no answer). */
export async function readPages(bridge: Bridge): Promise<OpenPage[]> {
  const r = await bridge.call("partner.tabs", {}).catch(() => null);
  return r && "ok" in r ? pagesOf(r.ok) : [];
}

export async function showPage(bridge: Bridge, id: string): Promise<boolean> {
  const r = await bridge.call("partner.showTab", { id }).catch(() => null);
  return !!r && "ok" in r;
}

/** Close one; the pages left (or the same list less that page if the phone didn't answer with them). */
export async function closePage(bridge: Bridge, id: string, now: OpenPage[]): Promise<OpenPage[]> {
  const r = await bridge.call("partner.closeTab", { id }).catch(() => null);
  return r && "ok" in r ? pagesOf(r.ok) : now.filter((p) => p.id !== id);
}
