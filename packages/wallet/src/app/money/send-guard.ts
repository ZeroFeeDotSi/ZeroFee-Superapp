// The guard on the person's own Send (FLOW-V5 §5 item 5): the same checks AgentZero's payments run, called from
// packages/agent (judge, unitGuard, obfuscated), never copied. This file only reads the facts judge needs and turns a
// Confirm into unitGuard's inputs.
import type { Bridge } from "@zerofee/core/bridge";
import { unitGuard, type CounterpartyFacts } from "@zerofee/agent/guard/index";
// The sheet loads this file on the first Send tap (speed budget): it hands over the agent's own checks with it.
export { judge, obfuscated } from "@zerofee/agent/guard/index";
import { toUnits } from "@zerofee/pay/amount";
import type { Recipient } from "@zerofee/pay/send";
import type { Prefill } from "@zerofee/pay/app/links.ts";
import { isUsdStable, type TokenDirectory } from "@zerofee/pay/tokens";
import type { Movement, RecipientInfo } from "../../types.ts";

/** A pasted address or amount that hides its words (Base64, Morse, hidden Unicode, look-alike letters). */
export const GUARD_HIDES = "That address or amount hides its words. Nothing was sent.";

/**
 * Rule 8 (the copy review's UI walk, 5 Nov: "First time paying this Solana address." named no wallet and no next step): the guard's
 * first-payment warn on the person's own Send, with who (from judge's own line), the wallet it comes from, and one step.
 * From the Safe it is said before the Face ID yes; from a wallet the send is made at the tap, so it is said as done.
 * Words: the copy review. Null when the warn is another one (judge's own line stays).
 */
export function firstPayLine(line: string, from: { place: string; safe: boolean }): string | null {
  const m = /^First time paying (.+?)\.(?: (.+))?$/.exec(line);
  if (!m) return null;
  const who = m[1]!, more = m[2] ? ` ${m[2]}` : "";
  if (from.safe) return `First payment to ${who}.${more} It comes from ${from.place}. Check the address, then approve.`;
  return `First payment to ${who}${more ? `.${more} It came` : ","} from ${from.place}. Check the address; the next one will be quicker.`;
}

/** Who the guard checks: the address or the NEAR account, as the person gave it. */
export const guardTarget = (r: Recipient): string => (r.kind === "address" ? r.address : r.accountId);

/** judge's facts: the NEAR account on two nodes (exists, its code), and whether this device paid it before (Activity). */
export async function guardFacts(bridge: Bridge, r: Recipient): Promise<CounterpartyFacts> {
  const to = guardTarget(r);
  const [info, activity] = await Promise.all([
    r.kind === "address" ? Promise.resolve(null) : bridge.call<RecipientInfo>("ledger.recipientInfo", { accountId: to }).catch(() => null),
    bridge.call<Movement[]>("ledger.activity", { limit: 50 }).catch(() => null),
  ]);
  const rows = activity && "ok" in activity && Array.isArray(activity.ok) ? activity.ok : [];
  const paidBefore = rows.some((m) => m.status === "done" && typeof m.to === "string" && m.to.toLowerCase() === to.toLowerCase());
  const account = info && "ok" in info ? { exists: info.ok.exists, code: info.ok.code ?? null } : null;
  return { account: r.kind === "address" ? { exists: true, code: null } : account, paidBefore };
}

/**
 * The unit-and-decimal guard before Approve: the coin amount the quote will really send, in its own units and decimals at
 * the coin's price, against the dollars the form showed. Null: it matches, or the form showed no dollars (the person
 * typed the coin amount itself, so there is nothing to be off from).
 */
export function unitCheck(c: { target: { amount: string; token: { decimals: number; symbol: string; priceUsd?: string } } }, askedUsd: number | null): string | null {
  if (askedUsd === null || !(askedUsd > 0)) return null;
  const raw = toUnits(c.target.amount, c.target.token.decimals);
  // a dollar coin is a dollar each, as the form and the Approve sheet count it
  const t = c.target.token;
  const price = t.priceUsd !== undefined ? Number(t.priceUsd) : /^USD[CT]$/i.test(t.symbol) ? 1 : null;
  // no listed price: nothing independent to check the dollars against (review L4: never a dead-end stop)
  if (price === null) return null;
  return unitGuard({ askedUsd, decimals: t.decimals, rawAmount: raw ?? "x", priceUsd: price });
}

/**
 * The same guard on what LEAVES (review M1): the most the quote may take from the paying coin (maxIn, its units at its
 * decimals) at that coin's own price, against the dollars shown. Ten times off stops it before Approve.
 */
export function unitCheckIn(c: { maxIn: string; source: { balance: { amount: string; usd?: string } } }, decimals: number | undefined, askedUsd: number | null): string | null {
  const b = c.source.balance;
  if (askedUsd === null || !(askedUsd > 0) || decimals === undefined || !(Number(b.usd) > 0) || !(Number(b.amount) > 0)) return null;
  const raw = toUnits(c.maxIn, decimals);
  return unitGuard({ askedUsd, decimals, rawAmount: raw ?? "x", priceUsd: Number(b.usd) / Number(b.amount) });
}

/** The dollars a link's or a code's own words name ("Coffee $4.50", "12 USD"), or null. */
export function saysDollars(words: (string | undefined)[]): number | null {
  for (const w of words) {
    const m = w && /\$\s?(\d[\d,]{0,11}(?:\.\d{1,2})?)|(\d[\d,]{0,11}(?:\.\d{1,2})?)\s?(?:USD|dollars?)\b/i.exec(w);
    const said = m ? (m[1] ?? m[2]) : "";
    // "4,50" is four fifty (a comma for cents); "1,250" and "1,250.50" group thousands (security review L5)
    const n = Number(/^\d+,\d{1,2}$/.test(said) ? said.replace(",", ".") : said.replace(/,/g, ""));
    if (n > 0) return n;
  }
  return null;
}

/**
 * A payment link whose amount is ten times off the dollars its own words name ("Coffee $4.50" asking 4,500 USDC): the
 * unit guard's line, or null. Every way a link enters Send runs it before the form fills: a scan, a paste, Chat's link.
 */
export function linkUnitOff(p: Prefill, tokens: TokenDirectory, memo?: string): string | null {
  const said = saysDollars([p.label, p.note, memo]);
  const token = p.tokenId ? tokens.byAsset(p.tokenId) : undefined;
  if (said === null || !p.amount || !token) return null;
  // a dollar coin is a dollar each, as Send's form and the Approve sheet count it
  const price = isUsdStable(token.symbol) ? 1 : token.priceUsd !== undefined ? Number(token.priceUsd) : null;
  if (price === null) return null;
  return unitGuard({ askedUsd: said, decimals: token.decimals, rawAmount: toUnits(p.amount, token.decimals) ?? "x", priceUsd: price });
}

/** judge's facts, but never a wait without end: after GUARD_WAIT_MS it goes on with what isn't known said as such. */
export const GUARD_WAIT_MS = 4_000;
export function guardFactsSoon(bridge: Bridge, r: Recipient, ms = GUARD_WAIT_MS): Promise<CounterpartyFacts> {
  const late: CounterpartyFacts = { account: r.kind === "address" ? { exists: true, code: null } : null, paidBefore: false };
  return Promise.race([guardFacts(bridge, r).catch(() => late), new Promise<CounterpartyFacts>((res) => setTimeout(res, ms, late))]);
}
