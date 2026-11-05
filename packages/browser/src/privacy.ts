// D131, the Browser's Privacy screen: private browsing (Tor, on the iPhone only) on or off, the sites set to normal
// browsing, and clearing what sites saved. The setting lives on the phone (PrivateBrowsing.swift), read and changed
// through the Browser's own bridge (partner.privacy and its three changes); on the web there is no Tor (D130).
import type { Bridge } from "@zerofee/core/bridge";
import { onPhone } from "@zerofee/shell-api/approval-words.ts";

export type PrivacyView =
  /** A browser on a computer or the web demo: there is no private browsing here. */
  | { kind: "web" }
  /** The iPhone app. `built`: false while this build has no Tor in it (nothing private opens then). */
  | { kind: "phone"; private: boolean; normalSites: string[]; built: boolean; blockTrackers?: boolean };

export const PRIVACY = {
  row: "Privacy",
  rowLine: (v: PrivacyView | null) => (!v || v.kind === "web" ? "Private browsing, history and site data" : !v.built ? "Private browsing isn't ready yet" : v.private ? "Private browsing is on" : "Private browsing is off"),
  switchTitle: "Private browsing",
  switchLine: "Sites can't see where you are. Pages open a bit slower.",
  sampleOff: "Off. Sites can see your address.",
  sampleOn: "On. Sites can't see where you are.",
  notBuilt: "Private browsing isn't ready yet.",
  web: "Private browsing isn't ready yet.",
  offTitle: "Turn off private browsing?",
  offLine: "Sites will see your phone's address.",
  offYes: "Turn off",
  offNo: "Keep it on",
  normalHead: "Sites on normal browsing",
  normalLine: "These sites see your phone's address.",
  normalRemove: "Make private",
  clearHistory: "Clear history",
  historyCleared: "History cleared.",
  clearData: "Clear site data",
  dataCleared: "Site data cleared. Sites will ask you to sign in again.",
  downloads: "Downloads are off.",
  trackersTitle: "Block trackers",
  trackersLine: "Stops hidden trackers on sites from watching you.",
  trackersCredit: "Tracker list by the EasyList authors (CC BY-SA 4.0).",
  trackersDidntChange: "Block trackers didn't change. Try again.",
  didntChange: "Private browsing didn't change. Try again.",
} as const;

const exactHost = (h: unknown): h is string => typeof h === "string" && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && h.length <= 253;

/** The phone's answer, checked: only a well-formed answer counts; anything else is "not on this phone yet". */
export function viewOf(r: { ok: unknown } | { problem: { code: string } }): PrivacyView {
  if ("problem" in r) return r.problem.code === "partner.unavailable" ? { kind: "web" } : { kind: "phone", private: true, normalSites: [], built: false };
  const v = r.ok as { private?: unknown; normalSites?: unknown; built?: unknown } | null;
  if (!v || typeof v.private !== "boolean" || typeof v.built !== "boolean") return { kind: "phone", private: true, normalSites: [], built: false };
  const sites = Array.isArray(v.normalSites) ? v.normalSites.filter(exactHost) : [];
  const trackers = (r.ok as { blockTrackers?: unknown }).blockTrackers;
  return { kind: "phone", private: v.private, normalSites: [...new Set(sites)].sort(), built: v.built, ...(typeof trackers === "boolean" ? { blockTrackers: trackers } : {}) };
}

/** Off the iPhone (a browser, the web demo) there is no private browsing, whatever the bridge answers. */
export async function readPrivacy(bridge: Bridge, phone = onPhone()): Promise<PrivacyView> {
  if (!phone) return { kind: "web" };
  return viewOf(await bridge.call("partner.privacy", {}));
}

/** Turn private browsing on or off (off only after our own sheet's "Turn off"). */
export async function setPrivate(bridge: Bridge, on: boolean): Promise<PrivacyView> {
  return viewOf(await bridge.call("partner.setPrivate", { on }));
}

/** Block trackers on or off (D131), for the next page opened. */
export async function setBlockTrackers(bridge: Bridge, on: boolean): Promise<PrivacyView> {
  return viewOf(await bridge.call("partner.setBlockTrackers", { on }));
}

/** A site back to private browsing (or set to normal). Only an exact host is sent. */
export async function setNormalSite(bridge: Bridge, host: string, normal: boolean): Promise<PrivacyView | null> {
  if (!exactHost(host)) return null;
  return viewOf(await bridge.call("partner.setNormalSite", { host, normal }));
}

/** Clear every site's data on the phone (its own alert asks first). The line to show, or null when kept. */
export async function clearSiteData(bridge: Bridge): Promise<string | null> {
  const r = await bridge.call<{ cleared?: boolean }>("partner.clearSites", {});
  if ("problem" in r) return r.problem.whatHappened;
  return r.ok?.cleared ? PRIVACY.dataCleared : null;
}
