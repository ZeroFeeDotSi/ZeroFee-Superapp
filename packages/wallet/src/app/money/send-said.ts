// Send's refusals, said in the sheet (rule 8; QA's Send + Add lap and the copy review's Sim walk, 5 Nov). Only the Send sheet
// and its form load these: kept apart from send-words.ts, which Home's first load reads (format.ts shortId), so these
// lines stay out of it (speed budget).
/** A refusal said before the hold (rule 8): what failed, by name, where the money is, by wallet name, and what to tap. One
 *  or two sentences. `what` is the failure's own words ("ZeroFee can't send to Solana yet."); `place` is "your SOL wallet". */
export const refusedLine = (what: string, place: string, tap: string): string => `${what.trim().replace(/[.!]$/, "")}, and your money is still in ${place}. ${tap}`;
/** S1 (the copy review's Sim walk, 5 Nov): "You need 1.128669792 NEAR for this, with its fee." was raw units, named no wallet
 *  and gave no next step. Rule 8: how much is missing in dollars, where the money is by the wallet's own name, what to tap. */
export const SHORT_TAP = "Add money or send less.";
const dollars2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** `shortUsd` null (no honest figure: no price, or the refusal's figure is under what the wallet shows) says it without one. */
export function shortLine(shortUsd: number | null, place: string): string {
  if (shortUsd !== null && shortUsd >= 0.01) return `You're short about ${dollars2(shortUsd)} in ${place}. Nothing was sent. ${SHORT_TAP}`;
  const p = place.trim();
  return `${p.charAt(0).toUpperCase()}${p.slice(1)} can't cover this and its fee. Nothing was sent. ${SHORT_TAP}`;
}
/** The refusal's own figure ("ledger.balance.low", wallet-problems balanceLow: "You need N SYMBOL for this, with its fee."). */
export function shortOf(p: { code: string; whatHappened: string }): { need: number; symbol: string } | null {
  if (p.code !== "ledger.balance.low") return null;
  const m = /^You need (\d+(?:\.\d+)?) (\S+) for this/.exec(p.whatHappened);
  return m ? { need: Number(m[1]), symbol: m[2]! } : null;
}
/** How many dollars short the Send is from `s` (the From row: its coin, its amount and dollars, what it can send now):
 *  the refusal's figure at the row's own price, less what the row can send. Null when it can't be said honestly. */
export function shortUsdOf(p: { code: string; whatHappened: string }, s: { symbol: string; amount: string; usd?: string; max: string }): number | null {
  const need = shortOf(p);
  const per = Number(s.usd) / Number(s.amount);
  if (!need || need.symbol !== s.symbol || !(per > 0) || !Number.isFinite(per)) return null;
  const short = (need.need - Number(s.max)) * per;
  return short >= 0.01 ? Math.ceil(short * 100) / 100 : null;
}
export const TAP_ADDRESS = "Pick another address.";
export const TAP_PASTE = "Check it and paste it again.";
export const TAP_AGAIN = "Paste the address again.";

/** "Not now" on the Send's own ask (QA's lap, 5 Nov): the person said no, nothing was
 *  sent, where the money is by wallet name, and what to tap. Never "ZeroFee said no"; never "Job created." left up. */
export const declinedLine = (amount: string, place: string): string => `Nothing was sent. The ${amount} is still in ${place}.`;

/** NEAR Intents took no payout to a NEAR account (the relay's 400 quotes.upstream.refused on a payout on NEAR; 1Click's own
 *  answer, read 5 Nov with dry quotes: "Quoting for this pair is not available" for every payout to a NEAR account, from
 *  any coin, while a payout to Solana quoted). Nothing was asked or signed. Rule 8, the protocol by name. */
export const nearPayoutLine = (amount: string, place: string): string => `NEAR Intents said no to this payout, so nothing was sent. The ${amount} is still in ${place}. Try again in a few minutes.`;

/**
 * Send's floor, Swap's pattern (QA, 6 Nov: "make the three sheets one pattern"). `again`: the button's words for a refusal
 * that can be tried again (saidOnSheet decides, per Problem: never one that may already have sent). It reads so only while
 * the form could send; the tap is the form's own Send, the same ask. Otherwise the form's reason goes first, so no lit Try
 * again ever does nothing.
 */
export function sendFloor(o: { label: string; again: string | null; said: string | null; why: string | null; ready: boolean }): { label: string; line: "said" | "why" | null } {
  if (o.again && !o.ready && o.why) return { label: o.label, line: "why" };
  return { label: o.again && o.ready ? o.again : o.label, line: o.said ? "said" : o.why ? "why" : null };
}
