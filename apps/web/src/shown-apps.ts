// Which of the registered apps this build shows: the MVP set (D31, unless `?all`), never an app whose account-contract
// part isn't in the release on mainnet, and the public build's apps in Sim and in Real. Kept apart from
// apps.ts so it is testable without the app modules.

import type { Problem } from "@zerofee/core/problem";
import { WEB_TRADE, webWallet } from "@zerofee/shell-api/release.ts";
import type { PhoneReason } from "@zerofee/shell-api/web-wallet-words.ts";

/** D31: the MVP build shows Security (the shell's own) and only these (ZeroFee Chat joined them with D55, Agent with
 *  release 10 on 3 Nov). The rest stay registered, behind `?all`. */
export const MVP_APPS: ReadonlySet<string> = new Set(["wallet", "trade", "chat", "social", "agent"]);
/** Is the MVP build on? True unless the page address has the `all` key (`?all`, `?demo&all`, `?screens&all`); always
 *  true on mainnet (audit H-2: an address can't unhide unaudited apps where the money is real). The public build
 *  doesn't read it at all (publicApps). */
export function mvpOn(search: string, mainnet = false): boolean {
  return mainnet || !new URLSearchParams(search).has("all");
}

/** Apps whose account-contract part isn't in any release on mainnet: never shown there, `?all` or not, so nothing calls
 *  a method the account's release doesn't have. Empty since release 10 (3 Nov): Agent shows, and on an account without
 *  release 10 it says so in place with the update (D57), never calling a method the account doesn't have. */
export const NOT_IN_RELEASE: ReadonlySet<string> = new Set([]);

/** The registry's apps for this phone. With `mvp` (default off here; the shell passes `mvpOn(location.search)`) only
 *  MVP_APPS; without it (`?all`) all of them. On `mainnet`, never NOT_IN_RELEASE. */
export function appsFor<T extends { id: string }>(apps: readonly T[], mvp = false, mainnet = false): T[] {
  return apps.filter((m) => (!mvp || MVP_APPS.has(m.id)) && (!mainnet || !NOT_IN_RELEASE.has(m.id)));
}

/** The public web build's Real mode (mainnet): the apps that are live there. ZeroFee Chat isn't (its sends are Private
 *  only, and Private isn't open in the release: drop, don't degrade); hosting.ts keeps Chat's sockets out of the CSP. */
export const LIVE_IN_RELEASE: ReadonlySet<string> = new Set(["wallet", "trade", "social", "agent"]);
/** The web wallet's apps (product decision, 4 Nov: no Safe): Home, Trade, the Browser and AgentZero (W7, product decision, 5 Nov: its
 *  chat works on the web, with its own wallet and mailbox and the tools that work there: chat/tools.ts webTools).
 *  Chat's sends are Private only. */
export const LIVE_ON_WEB: ReadonlySet<string> = new Set(["wallet", "trade", "social", "agent"]);
/** On the web, the apps that live on the phone and their page's reason (OnYourPhone): the Browser's tab
 *  (and pump.fun's and GMGN's) is that page; a way in to AgentZero or Chat (not on the web's bar) opens it too. */
export const PHONE_ON_WEB: Readonly<Record<string, PhoneReason>> = { chat: "chat", social: "browser", browser: "browser" };
/**
 * The public web build's apps (Sim | Real, product decision, 3 Nov): the phone's (the MVP set, `?all` never read), every one
 * working, never a "Coming soon" screen. Sim has them all on sample money; Real only LIVE_IN_RELEASE (Security, Home's
 * own, is the shell's).
 */
export function publicApps<T extends { id: string }>(apps: readonly T[], sim: boolean, web = webWallet(), trade = WEB_TRADE): T[] {
  return appsFor(apps, true, !sim).filter((m) => sim || (web ? LIVE_ON_WEB.has(m.id) && (trade || m.id !== "trade") : LIVE_IN_RELEASE.has(m.id)));
}

/** D48: Pay folds into Wallet. openApp("pay", "send") opens Wallet's Send; any other Pay screen, Wallet's Receive. */
/** D118: the old Browser app folds into the Browser tab (app id "social"): an old link to it lands there. */
export function foldedInto(id: string, tab?: string): { id: string; tab: string } | null {
  if (id === "browser") return { id: "social", tab: tab ?? "" };
  return id === "pay" ? { id: "wallet", tab: tab === "send" ? "send" : "receive" } : null;
}

/** What the person sees when something opens an app this build doesn't show (the Problem screen, never a blank one). */
export const HIDDEN_APP_PROBLEM: Problem = {
  code: "shell.app.hidden",
  whatHappened: "That part of ZeroFee isn't in this build yet.",
  money: { state: "not-involved" },
  next: { kind: "nothing", label: "Go back" },
};
