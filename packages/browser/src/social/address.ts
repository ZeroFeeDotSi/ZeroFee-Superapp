// The Browser tab's address bar (D118, D122, D131: the person's own browser), read on the phone. An address opens; words
// that aren't one search DuckDuckGo (D131), in the Browser's own window like any page, so private browsing applies. An
// http:// address is opened as https://, never in the clear. A listed site's host opens as its tile does (ST1: a $0.00
// tile is the money sheet first); a site with its own phone app (fomo: no phone web app) opens that app, as the old
// Browser's fomo row did (fomo-app.ts); any other https address opens in ZeroFee's own window.
import { siteUrl } from "../sites.ts";
import { presetForHost } from "../presets.ts";

/** Nothing typed, or an address that can't be read (ftp://, a user name in it): one line. */
export const NOT_AN_ADDRESS = "Type a site address, like pump.fun.";
/** D131: the search for words that aren't an address (DuckDuckGo keeps no search history). */
export const searchUrl = (words: string) => `https://duckduckgo.com/?q=${encodeURIComponent(words.trim())}`;
export const INSECURE = (host: string) => `${host} isn't an https site, so ZeroFee won't open it.`;

export type Address =
  | { kind: "site"; site: string }                         // a listed site's own host: its tile's tap
  | { kind: "app"; name: string; url: string; host: string } // a site with its own phone app (fomo): that app, never a window
  | { kind: "url"; url: string; host: string }            // any other https address
  | { kind: "line"; line: string };                       // words, http, or a malformed address: one line, nothing opens

export function readAddress(typed: string, listed: readonly string[]): Address {
  const text = typed.trim();
  if (!text) return { kind: "line", line: NOT_AN_ADDRESS };
  // words (a space, or no dot at all) that don't start like an address: a search (D131)
  if ((/\s/.test(text) || !/\./.test(text)) && !/^[a-z][a-z0-9+.-]*:/i.test(text)) return { kind: "url", url: searchUrl(text), host: "duckduckgo.com" };
  // http:// is opened as https:// (D131: https only, never in the clear)
  const r = siteUrl(text.replace(/^http:\/\//i, "https://"));
  if ("problem" in r) return { kind: "line", line: r.problem === "insecure" ? INSECURE(r.host ?? text) : NOT_AN_ADDRESS };
  const host = new URL(r.url).host.toLowerCase();
  const preset = presetForHost(host);
  if (preset && listed.includes(preset.id)) return { kind: "site", site: preset.id };
  if (preset?.ownApp) return { kind: "app", name: preset.name, url: r.url, host };
  return { kind: "url", url: r.url, host };
}

/** The web has no ZeroFee window: the site in a new tab, from the tap, without the wallet (D87). */
/** D130: the web can't run Tor, so a typed site opens in a plain new tab and says so. */
export const webOpenedLine = (host: string) => `${host} opened in a new tab, without your wallet.`;

/** A site with its own phone app, typed on the web: the web has no way to open that app. */
export const webAppLine = (host: string, name: string) => `${host} opened in a new tab. On the phone, ${name} opens in its own app.`;
/** Its app isn't on this phone, so its App Store page opened instead. */
export const storeLine = (name: string) => `${name} isn't on this phone yet, so it opened in the App Store. Get the app there, then try again.`;
/** Its app didn't open (and neither did its App Store page). */
export const appDidntOpenLine = (name: string) => `${name}'s app didn't open. Try again.`;

/** What Go does (pure, its effects injected): a listed site → its tile's tap; a site with its own app (fomo) → that app
 *  on the phone, never a window; on the phone, ZeroFee's own window on the Browser engine's bridge (the visit kept on the
 *  phone); on the web, a new tab without the wallet (the visit kept on this device too); else one line. */
export async function goAddress(text: string, d: {
  listed: readonly string[];
  phone: boolean;
  onSite(site: string): void;
  onLine(line: string): void;
  openTab(url: string): void;
  openSite?(url: string): Promise<{ opened: "wallet" | "plain" } | { problem: unknown }>;
  /** fomo's own app (fomo-app.ts openFomoApp), on the phone only. */
  openApp?(): Promise<{ opened: "app" | "store" | "window" } | { problem: unknown }>;
  addVisit?(url: string): Promise<unknown>;
  /** The Sim (Sim pass, 4 Nov): openTab shows the Sim's own page, never a new tab, so no line says one opened. */
  quiet?: boolean;
}): Promise<"site" | "app" | "phone" | "web" | "line"> {
  const a = readAddress(text, d.listed);
  if (a.kind === "line") { d.onLine(a.line); return "line"; }
  if (a.kind === "site") { d.onSite(a.site); return "site"; }
  if (a.kind === "app") {
    // the tab first (a browser opens it only straight from the tap), then the visit, kept on this device (e2e walk,
    // 3 Nov: History stayed empty on the web while its row said "Sites you opened")
    if (!d.phone || !d.openApp) { d.openTab(a.url); if (!d.quiet) d.onLine(webAppLine(a.host, a.name)); await d.addVisit?.(a.url); return "web"; }
    const r = await d.openApp();
    if ("problem" in r) { d.onLine(appDidntOpenLine(a.name)); return "line"; }
    await d.addVisit?.(a.url);
    if (r.opened === "store") d.onLine(storeLine(a.name));
    return "app";
  }
  if (!d.phone || !d.openSite) { d.openTab(a.url); if (!d.quiet) d.onLine(webOpenedLine(a.host)); await d.addVisit?.(a.url); return "web"; }
  const r = await d.openSite(a.url);
  if ("problem" in r) { d.onLine(`${a.host} didn't open. Check the address, then try again.`); return "line"; }
  await d.addVisit?.(a.url);
  if (r.opened === "plain") d.onLine(`${a.host} opened without your wallet.`);
  return "phone";
}
