// Settings > Open source: what ZeroFee is (BRAND.md's positioning line, word for word) and the third-party notices,
// generated from the lockfile by tools/shell/notices.mjs (never edited by hand). Links open through the shell's browser
// sheet (device.openUrl, mode "sheet"): the system browser with its real address bar, never a link inside ZeroFee.
import type { Bridge } from "@zerofee/core/bridge";
import { forApps } from "@zerofee/core/bridge";
import data from "./third-party-notices.json" with { type: "json" };

// Product decision, 5 Nov late: "phone app should link to the open repo" (the UI lead's words, the form true before the push: Terms
// and this line never say "open source" while the repo isn't public, web5-onboard.test.ts). The Sim's intro says the same
// (sim-intro.ts INTRO_SOURCE): built in the open, and "Get the code" goes to it.
export const POSITIONING = "ZeroFee is built in the open. Run it yourself from the code. No middleman takes a fee.";
/** The link under the line (the phone's way to the open code; the web note's "Get the code" goes to the same address,
 *  top-note-words.ts, pinned equal in top-note.test.ts). Kept in this file, not a shared module: a shared one moved
 *  Rollup's chunks so the Sim reached the real vault (speed-budget.test.ts). */
export const CODE_LABEL = "Get the code";
/** Where it goes while the build names no code address (VITE_CODE_URL unset): the self-host guide. */
export const CODE_FALLBACK = "https://zerofee.si/docs/self-host";
/** The build's VITE_CODE_URL when it is an https address, else the fallback (never empty or dead). */
export function codeHref(codeUrl: string | undefined): string {
  const url = (codeUrl ?? "").trim();
  return /^https:\/\/[^\s/]+/.test(url) ? url : CODE_FALLBACK;
}

export type Notice = { name: string; version: string | null; licence: string | null; licenceText: string | null; noticeText: string | null; licenceUrl: string | null };
export type Notices = { tradingview: { name: string; notice: string; noticeText: string; url: string }; packages: Notice[] };
export const NOTICES: Notices = data;

/** The line under a package's name: its version and licence, in plain words when the package states none. */
export function noticeMeta(n: Notice): string {
  return [n.version ? `Version ${n.version}` : null, n.licence ? `Licence ${n.licence}` : "No licence stated by the package"].filter(Boolean).join(" · ");
}

/** the copy review's S6 (7 Nov): a package's name as a person reads it, never a raw scoped id: "@babel/runtime" is "runtime (babel)";
 *  a plain name stays itself. The exact id stays in its licence text. */
export function plainName(name: string): string {
  const m = /^@([^/]+)\/(.+)$/.exec(name);
  return m ? `${m[2]} (${m[1]})` : name;
}
/** The one row the package list folds under (the copy review's S6). */
export const licencesLabel = (n: number): string => `Licences (${n})`;

/** Opens a page in the shell's browser sheet, as ZeroFee itself (the wallet's own screens). */
export function openInBrowserSheet(bridge: Bridge, url: string) {
  return forApps(bridge, "wallet").call("device.openUrl", { url, mode: "sheet" });
}
