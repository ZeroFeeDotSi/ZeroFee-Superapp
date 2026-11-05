// C-1 Split the bill (master plan row 7), the typed total (the receipt photo comes later). The asker types the bill's
// total in dollars and how many people share it, themselves included. Each other person's share is the total divided,
// cut down to the cent; the cent or two left over stays with the asker (QA). Two plain messages go out, both readable in
// BitChat as they are:
//   "Splitting a $50.00 bill 4 ways. Each pays $12.50."
//   "Request: 12.50 USDC on Solana to <the asker's address> · ZeroFee Chat"   (messages.ts, the one request format)
// A payer's chip is the request's own (useMoney: Wallet's Send on Hidden, its guard, the core's Approve; never auto-pay).
// The asker sees what came in from their OWN Activity only: payments of the share's amount in that coin on that network
// since they asked. No names (D98): who paid is not known, so it is never said.
import type { Movement } from "@zerofee/wallet/types.ts";
import type { PayRequest } from "./messages.ts";

export const SPLIT_MIN = 2;
export const SPLIT_MAX = 20;

/** "$1,234.50" from cents. */
export const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type Split = { totalCents: number; people: number; eachCents: number; askerCents: number };

/** The shares, or the one line that says what to fix. */
export function splitBill(totalTyped: string, people: number): { ok: Split } | { line: string } {
  const t = totalTyped.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) return { line: "Type the bill's total in dollars, like 48.50." };
  const totalCents = Math.round(Number(t) * 100);
  if (!(totalCents > 0)) return { line: "Type the bill's total in dollars, like 48.50." };
  if (!Number.isInteger(people) || people < SPLIT_MIN || people > SPLIT_MAX) return { line: `Split it ${SPLIT_MIN} to ${SPLIT_MAX} ways.` };
  const eachCents = Math.floor(totalCents / people);
  if (eachCents < 1) return { line: "That's less than a cent each." };
  return { ok: { totalCents, people, eachCents, askerCents: totalCents - eachCents * (people - 1) } };
}

/** The line before the request: what the bill was and what each pays. */
export const splitText = (s: Pick<Split, "totalCents" | "people" | "eachCents">): string =>
  `Splitting a ${dollars(s.totalCents)} bill ${s.people} ways. Each pays ${dollars(s.eachCents)}.`;

const SPLIT = /^Splitting a \$(\d{1,3}(?:,\d{3})*\.\d{2}) bill (\d{1,2}) ways\. Each pays \$(\d{1,3}(?:,\d{3})*\.\d{2})\.$/;

/** A split line read back (only ever to count the asker's own; a split line is never a chip). */
export function readSplit(text: string): Pick<Split, "totalCents" | "people" | "eachCents"> | null {
  const m = SPLIT.exec(text.trim());
  if (!m) return null;
  const cents = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
  const people = Number(m[2]);
  const s = { totalCents: cents(m[1]!), people, eachCents: cents(m[3]!) };
  if (people < SPLIT_MIN || people > SPLIT_MAX || s.eachCents < 1 || s.eachCents * (people - 1) > s.totalCents) return null;
  return s;
}

/** The share as the request's coin amount. A split asks in a dollar coin only (USDC, USDT): the share is exact, never
 *  priced from a kept list that may be old (review M1). Null for any other coin: the sheet says so. */
export function shareAmount(eachCents: number, coin: string): string | null {
  return /^USD[CT]$/i.test(coin) ? (eachCents / 100).toFixed(2) : null;
}
export const SPLIT_DOLLARS_ONLY = "A split asks in USDC or USDT, so each share is exact. Change the coin.";

/**
 * The request a split posted: the asker's own next message after the split line (strangers' lines skipped, however
 * many), or their own message just before it in the same second (the relays may order one second either way; review L3).
 */
export function splitRequest(lines: readonly { mine: boolean; text: string; atIso?: string }[], at: number, read: (text: string) => PayRequest | null): PayRequest | null {
  const split = lines[at]!;
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i]!.mine) {
      const r = read(lines[i]!.text);
      if (r) return r;
      break;
    }
  }
  for (let i = at - 1; i >= 0; i--) {
    const l = lines[i]!;
    if (!l.mine) continue;
    if (split.atIso === undefined || l.atIso !== split.atIso) return null;
    return read(l.text);
  }
  return null;
}

/** A split is counted for 7 days after it was asked, then left as it is (review L5). */
export const SPLIT_COUNT_MS = 7 * 86_400_000;
export const splitLive = (askedAtIso: string, nowMs: number = Date.now()): boolean => nowMs - Date.parse(askedAtIso) < SPLIT_COUNT_MS;

/** Skew allowed between when this device first saw a payment and when the ask went out. */
const SKEW_MS = 2 * 60_000;

/**
 * How many payments of the share came in since the ask, from the asker's own Activity: deposits on the request's network,
 * in its coin (`assetId`, the ledger's id for it), of exactly the share's amount. Never names, never more than the
 * number of other people.
 */
export function cameIn(r: Pick<PayRequest, "amount" | "chain">, assetId: string, askedAtIso: string, people: number, activity: readonly Movement[]): number {
  const asked = Date.parse(askedAtIso);
  let n = 0;
  for (const m of activity) {
    // landed only: a deposit still on its way can still fail (review L2)
    if (m.kind !== "deposit" || m.status !== "done") continue;
    if (m.from !== r.chain || m.to !== assetId || Number(m.amount) !== Number(r.amount)) continue;
    if (Number.isFinite(asked) && Date.parse(m.startedAtIso) < asked - SKEW_MS) continue;
    n++;
  }
  return Math.min(n, people - 1);
}

/** The asker's one line under their split. It says what reached them, never who sent it: any payment of exactly that
 *  much, in that coin, on that network, counts (review L2). */
export function cameInWords(n: number, s: Pick<Split, "eachCents">): string {
  const each = dollars(s.eachCents);
  if (n === 0) return `No payment of ${each} has reached your Safe since you asked.`;
  return n === 1 ? `1 payment of ${each} has reached your Safe since you asked.` : `${n} payments of ${each} have reached your Safe since you asked.`;
}

/** Under a split asked on NEAR: Activity can't count payments coming in there, so the line says where they show. */
export const SPLIT_NEAR_WORDS = "Payments on NEAR land in your Safe. They aren't counted here.";

/** The split line went out but its request didn't (review L1): payers can't pay a bill alone. */
export const SPLIT_HALF = "Your split went out, but its request didn't. Tap $ to ask again.";
