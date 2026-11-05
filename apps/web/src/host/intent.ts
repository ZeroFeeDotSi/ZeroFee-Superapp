// A-4 Siri and Shortcuts (master plan row 11): what an App Intent asked for (apps/ios/ZeroFee/Intents.swift), taken by
// the shell once the app is showing (shell.intent.take: Swift holds one, the newest, until the page takes it).
// - "ask": AgentZero opens with the words in its field. The person taps Send there; nothing is sent by itself.
// - "send": Wallet's Send opens (Hidden by default, its guard, then the core's Approve with Face ID), with the payee
//   filled in when the words name one. Never an amount: the person types the dollars on Send (Siri never hears one).
// A shortcut can be automated by anyone who has the phone unlocked, so an intent can only ever OPEN and FILL IN: no
// ledger call, no signature, no send (intent.test.ts).
import { readable } from "@zerofee/core/signer";
import { sendLink } from "@zerofee/pay/app/links.ts";
import { chainsForAddress, isNamedNearAccount } from "@zerofee/pay/chains";
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";
import type { Problem } from "@zerofee/core/problem";
import type { IosHost } from "./ios.ts";

export type Intent = { kind: "ask"; words: string } | { kind: "send"; to?: string };

export const ASK_MAX = 500;

/** What Swift handed over, checked again here: anything else is nothing. */
export function readIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "ask" && typeof r.words === "string") {
    const words = readable(r.words).replace(/\s+/g, " ").trim().slice(0, ASK_MAX);
    return words ? { kind: "ask", words } : null;
  }
  if (r.kind === "send") {
    const to = typeof r.to === "string" ? r.to.trim() : "";
    return to && /^\S{2,128}$/.test(to) ? { kind: "send", to } : { kind: "send" };
  }
  return null;
}

/** Send's link for a payee as the person said it: a NEAR name or an address on its one chain; an EVM address with no
 *  network goes in as it is, and Send asks which network (H-5's rule). Null: not a payee Send can read. */
export function payeeLink(to: string): string | null {
  const t = to.trim();
  if (isNamedNearAccount(t.toLowerCase())) return sendLink({ to: t.toLowerCase(), chain: "near" });
  const chains = chainsForAddress(t);
  if (chains.length === 1) return sendLink({ to: t, chain: chains[0]! });
  if (chains.length > 1 && /^0x[0-9a-fA-F]{40}$/.test(t)) return t;
  return null;
}

/** Siri heard a payee Send can't read: one plain screen, nothing opened, no money involved. */
export const PAYEE_UNKNOWN: Problem = {
  code: "shell.intent.payee",
  whatHappened: "Siri's words weren't a name or address ZeroFee knows.",
  money: { state: "not-involved" },
  more: "Open Send and type who to pay.",
  next: { kind: "nothing", label: "OK" },
};

/** Where an intent goes: an app to open (and what to put in it), the money sheet, or one plain screen. Never more. */
export type Route = { open: { id: "agent"; tab: "ask"; link: string } } | { money: MoneyAsk } | { problem: Problem };

export function routeIntent(i: Intent): Route {
  if (i.kind === "ask") return { open: { id: "agent", tab: "ask", link: i.words } };
  if (!i.to) return { money: { kind: "send" } };
  const link = payeeLink(i.to);
  return link ? { money: { kind: "send", link } } : { problem: PAYEE_UNKNOWN };
}

/** The shell's three doors an intent may use, and nothing else (AppHost's own api, on the app on screen). */
export interface IntentDoors {
  openApp: (id: string, tab?: string, link?: string) => void;
  openMoney: (at: number, ask: MoneyAsk) => void;
  showProblem: (at: number, p: Problem) => unknown;
}

/** Takes what the phone holds (shell.intent.take: the shell's own call, read once) and opens it. A taken intent is always
 *  acted on: it is gone from the phone (a dev double-run once lost it). */
export async function takeIntent(host: Pick<IosHost, "call">, api: { current: IntentDoors }, at: { current: number }): Promise<void> {
  const r = await host.call<unknown>("shell.intent.take");
  const i = "ok" in r ? readIntent(r.ok) : null;
  if (!i) return;
  const to = routeIntent(i);
  if ("open" in to) return api.current.openApp(to.open.id, to.open.tab, to.open.link);
  if ("problem" in to) return void api.current.showProblem(at.current, to.problem);
  api.current.openMoney(at.current, to.money);
}
