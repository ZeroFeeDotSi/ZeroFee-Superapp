// What Agent does with a payment someone asks for, before any key is used: who asked (the person, or text Agent read),
// the check (allow / warn / block), and Agent's daily limit. Pure. Agent pays alone only a payment the person asked for,
// to a recipient not blocked, within what is left of today's limit; a first-time recipient asks the person once;
// anything over the limit goes to the person's own money sheet (Approve, Face ID, the account's bands).
import { checkRecipient, shortName, type Check } from "./check.ts";

/** USDC in the Safe (NEAR Intents, native USDC on NEAR) and NEAR in the Safe (wNEAR there): the coins Agent may spend. */
export const USDC_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR_ID = "nep141:wrap.near";
const DAY_MS = 86_400_000;

/**
 * The contract's budget (release 10) for a daily limit in dollars: USDC 1:1 (6 decimals), NEAR at today's price
 * (24 decimals), a month of 30 days, anyone may be paid within the day limit (the check runs first, in the app), up to 12
 * payments one day, for a year. The contract also refuses a limit beyond the account's Face ID band.
 */
export function dayBudget(usd: number, nearUsd: number, nowMs: number) {
  if (!(usd > 0) || !(nearUsd > 0)) throw new Error("a daily limit and NEAR's price are needed");
  const cents = BigInt(Math.round(usd * 100));
  const usdc = cents * 10_000n;
  const near = (cents * 10n ** 22n * 100n) / BigInt(Math.round(nearUsd * 100));
  const coin = (id: string, perDay: bigint) => ({ coin: id, per_day: perDay.toString(), per_month: (30n * perDay).toString(), convert_per_day: perDay.toString() });
  return { coins: [coin(USDC_ID, usdc), coin(WNEAR_ID, near)], recipients: [] as string[], ends_at_ns: (BigInt(nowMs + 365 * DAY_MS) * 1_000_000n).toString(), max_spends_per_day: 12 };
}

export type Plan =
  | { kind: "none" }
  | { kind: "refused"; line: string; why: string }
  | { kind: "pay"; to: string; usd: number; what: string; check: Check }
  | { kind: "ask-you"; to: string; usd: number; what: string; line: string };

const PAY = /\b(?:pay|send|transfer)\s+\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?|usdc)?\s+to\s+([a-z0-9_.\-]+|0x[0-9a-f]{40})(?:\s+for\s+(.{1,60}?))?(?:[.!]|\s+right now|$)/i;

/**
 * What a text asks Agent to pay. `source`: "you" (the person typed it) or "page" (Agent read it: a web page, a message,
 * a coin's name). A payment from a page is never made, whatever it says (prompt injection); it is shown refused.
 * `leftUsd`: what is left of today's limit.
 */
export function planFrom(text: string, source: "you" | "page", paidBefore: ReadonlySet<string>, leftUsd: number): Plan {
  const m = PAY.exec(text);
  if (!m) return { kind: "none" };
  const usd = Number(m[1]);
  const to = m[2].toLowerCase();
  const what = (m[3] ?? "").trim();
  const check = checkRecipient(to, paidBefore);
  if (source === "page") {
    return { kind: "refused", line: check.verdict === "block" ? `Refused: ${check.line}` : `Refused. AgentZero didn't pay ${shortName(to)}.`, why: "The order came from a web page, not from you. AgentZero takes orders only from you. Nothing was sent." };
  }
  if (check.verdict === "block") return { kind: "refused", line: `Refused: ${check.line}`, why: "Nothing was sent." };
  if (!(usd > 0)) return { kind: "none" };
  if (usd > leftUsd) return { kind: "ask-you", to, usd, what, line: `$${usd.toFixed(2)} is more than AgentZero can spend today. You approve this one.` };
  return { kind: "pay", to, usd, what, check };
}

/** The receipt's words in Activity: "Agent paid $0.20 to api.example.near for a report". */
export const receiptTitle = (usd: number, to: string, what: string) => `Agent paid $${usd.toFixed(2)} to ${shortName(to)}${what ? ` for ${what}` : ""}`;
