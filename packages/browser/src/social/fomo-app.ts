// fomo opens in its own app. fomo.family has no phone web app (probed 30 Oct): under 800 CSS px, whatever the user
// agent (iPhone, iPad, Android, Mac), its signed-out home hides Login, and its signed-in app is replaced by a
// full-screen "get the app" blocker (its own CSS: max-width 799px shows .mobile-blocker, hides .desktop-content).
// On the phone, the Browser's fomo (preset, typed or from history) asks the host to open the fomo app by its universal
// link, or fomo's App Store page when the app isn't on this phone (PartnerBridge.swift's PartnerApp: both addresses are
// fixed there). fomo isn't in Apps (D47); a fomo deposit address is paid with Wallet's Send.
import type { Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { browserProblems } from "../browser-problems.ts";

export const FOMO_URL = "https://fomo.family/";

export type FomoOpened = { opened: "app" | "store" | "window" } | { problem: Problem };

export async function openFomoApp(bridge: Bridge): Promise<FomoOpened> {
  const r = await bridge.call<{ opened?: string; ok?: boolean }>("device.openSite", { url: FOMO_URL, nativeApp: true });
  if ("problem" in r) return { problem: browserProblems.appDidntOpen("fomo") };
  if (r.ok.opened === "app" || r.ok.opened === "store") return { opened: r.ok.opened };
  if (r.ok.opened === "none") return { problem: browserProblems.appDidntOpen("fomo") };
  // A phone app from before PartnerApp ignores nativeApp and opens its own window: that is what the person sees.
  return { opened: "window" };
}

/** What the Browser says when the App Store page opened instead (its row is just "fomo"). */
export const FOMO_STORE_LINE_BROWSER = "fomo isn't on this phone yet, so it opened in the App Store. Get the app there, then tap fomo again.";

/** Is the ZeroFee phone app's host here? Only there can fomo's own app be opened; the web demo opens a new tab. */
export const hasPhoneHost = (): boolean =>
  typeof window !== "undefined" && !!(window as { webkit?: { messageHandlers?: Record<string, unknown> } }).webkit?.messageHandlers?.zerofee;
