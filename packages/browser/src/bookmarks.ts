// D131, favourites: sites the person saved, kept on this phone (the Browser's own device.store) and never sent anywhere.
// https only, by their exact address; at most 50. One opens the way the address bar does (goAddress), so a listed
// site is its tile's tap and private browsing applies.
import type { Bridge } from "@zerofee/core/bridge";

export interface Bookmark {
  url: string;
  host: string;
  atIso: string;
}

export const BOOKMARKS_KEY = "browser.bookmarks";
export const MAX_BOOKMARKS = 50;

export const FAVOURITES = {
  head: "Favourites",
  edit: "Edit",
  done: "Done",
  remove: (host: string) => `Remove ${host}`,
  save: (host: string) => `Save ${host} to favourites`,
  unsave: (host: string) => `Remove ${host} from favourites`,
  full: `You have ${MAX_BOOKMARKS} favourites. Remove one first.`,
  saved: (host: string) => `${host} is in your favourites.`,
  notSecure: "Only https sites can be favourites.",
} as const;

/** An https address with a real host, or null. */
function httpsUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password ? u : null;
  } catch {
    return null;
  }
}

/** What the store holds, checked: https only, the host read from the address itself, one per address, newest first. */
export function cleanBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw)) return [];
  const out: Bookmark[] = [];
  for (const b of raw) {
    const u = httpsUrl((b as Bookmark | null)?.url);
    if (!u || out.some((x) => x.url === u.href)) continue;
    const atIso = typeof (b as Bookmark).atIso === "string" ? (b as Bookmark).atIso : new Date(0).toISOString();
    out.push({ url: u.href, host: u.host.toLowerCase(), atIso });
  }
  return out.slice(0, MAX_BOOKMARKS);
}

export async function loadBookmarks(bridge: Bridge): Promise<Bookmark[]> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key: BOOKMARKS_KEY });
  if ("problem" in r || !r.ok?.value) return [];
  try {
    return cleanBookmarks(JSON.parse(r.ok.value));
  } catch {
    return [];
  }
}

const save = (bridge: Bridge, list: Bookmark[]) => bridge.call("device.store.set", { key: BOOKMARKS_KEY, value: JSON.stringify(list) });

export const isSaved = (list: readonly Bookmark[], url: string) => {
  const u = httpsUrl(url);
  return !!u && list.some((b) => b.url === u.href);
};

/** Save one: the new list, or the one line why not (not https, or already 50). Saving one already there keeps it. */
export async function addBookmark(bridge: Bridge, url: string, now = new Date()): Promise<{ list: Bookmark[] } | { line: string }> {
  const u = httpsUrl(url);
  if (!u) return { line: FAVOURITES.notSecure };
  const list = await loadBookmarks(bridge);
  if (list.some((b) => b.url === u.href)) return { list };
  if (list.length >= MAX_BOOKMARKS) return { line: FAVOURITES.full };
  const next = [{ url: u.href, host: u.host.toLowerCase(), atIso: now.toISOString() }, ...list];
  await save(bridge, next);
  return { list: next };
}

export async function removeBookmark(bridge: Bridge, url: string): Promise<Bookmark[]> {
  const next = (await loadBookmarks(bridge)).filter((b) => b.url !== url);
  await save(bridge, next);
  return next;
}
