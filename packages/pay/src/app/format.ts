// How Pay's numbers read on screen. Amounts stay decimal strings: these only round and group them for the eye.
import { add, compare, round, sub } from "../amount.ts";
import type { Token } from "@zerofee/wallet/types.ts";
import type { Confirm } from "../pay.ts";
import { isUsdStable } from "../tokens.ts";
import { approvalWords, type ApprovalWords } from "@zerofee/shell-api/approval-words.ts";

const MONEY_LIKE = new Set(["EURE", "GBPE"]);

/** Decimals worth showing and typing for a coin: cents for dollar and euro coins, up to 6 for the rest. */
export function screenDecimals(t: { symbol: string; decimals: number }): number {
  return isUsdStable(t.symbol) || MONEY_LIKE.has(t.symbol.toUpperCase()) ? 2 : Math.min(6, t.decimals);
}

/** "1240.5" → "1,240.50" for a 2-decimal coin; "0.0123" stays "0.0123". Rounds the way the caller needs. */
export function shown(amount: string, places: number, direction: "up" | "down" = "down"): string {
  const r = round(amount, places, direction);
  const [whole, frac = ""] = r.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = places === 2 ? frac.padEnd(2, "0") : frac;
  return f ? `${grouped}.${f}` : grouped;
}

/** Places that show `amount` with no digit hidden: at least `min`, more when the amount has them. */
function allPlaces(amount: string, min: number): number {
  return Math.max(min, (amount.split(".")[1] ?? "").replace(/0+$/, "").length);
}

/** An amount that is paid exactly: never rounded on screen. "1.999999" USDC reads "1.999999", not "1.99". */
export const shownFor = (amount: string, t: Token) => shown(amount, allPlaces(amount, screenDecimals(t)));

/** The "You pay" row: exactly what leaves the balance, or "up to" when a buffer may come back. */
export function youPay(c: Confirm): { value: string; detail: string } {
  const places = screenDecimals({ symbol: c.inSymbol, decimals: 6 });
  const exact = compare(c.maxIn, c.expectedIn) === 0;
  // Exactly what leaves shows every digit; an "up to" may round up, never down.
  const value = exact ? `${shown(c.maxIn, allPlaces(c.maxIn, places))} ${c.inSymbol}` : `up to ${shown(c.maxIn, places, "up")} ${c.inSymbol}`;
  if (c.source.route === "transfer") return { value, detail: c.feeNote };
  if (c.source.sameCoin) {
    const fee = sub(c.maxIn, c.target.amount);
    // Nothing taken on top of the amount, but NEAR's own fee is still paid (grade 02f, F1: "No network fee" while the sheet
    // said "Fee: at most 0.011 NEAR"): the sheet's own figure when the quote read it, the route's note otherwise.
    if (compare(fee, "0") === 0) return { value, detail: c.quote?.fee ? `Fee: at most ${c.quote.fee}` : c.feeNote };
    return { value, detail: `${shown(c.target.amount, places)} + ${shown(fee, places, "up")} network fee` };
  }
  const fee = c.feeUsd ? ` Includes about $${shown(c.feeUsd, 2, "up")} in fees.` : "";
  return { value, detail: `${fee.trim()}${exact ? "" : " Anything unused comes back."}`.trim() || c.feeNote };
}

/**
 * The review's one total (the UX walk, 2 Nov: "You pay 7.2073 NEAR" beside "Fee: at most … (0.011 NEAR)" read as two
 * answers): when the network fee is paid in the same coin and the sheet's own figure for it is known, the amount plus the
 * most the fee can be, "up to 7.2183 NEAR"; otherwise null (the "You pay" figure stands as the total). Rounded up.
 */
export function totalWithFee(c: Confirm): string | null {
  if (!c.source.sameCoin && c.source.route !== "transfer") return null;
  if (compare(c.maxIn, c.expectedIn) !== 0 || compare(sub(c.maxIn, c.target.amount), "0") !== 0) return null;
  const m = /([\d.,]+) ([A-Za-z]+)\)?$/.exec(c.quote?.fee ?? "");
  if (!m || m[2] !== c.inSymbol) return null;
  const places = Math.max(allPlaces(c.maxIn, screenDecimals({ symbol: c.inSymbol, decimals: 6 })), allPlaces(m[1]!.replace(/,/g, ""), 0));
  return `up to ${shown(add(c.maxIn, m[1]!.replace(/,/g, "")), places, "up")} ${c.inSymbol}`;
}

/**
 * An amount in dollars, as the approval sheet says it (grade 02g, G11): "$5.00" for a dollar coin, "about $0.04" at the
 * coin's listed price, "under $0.01"; null with no price (never a made-up figure).
 */
export function dollarsFor(amount: string, t: { symbol: string; priceUsd?: string }): string | null {
  const n = Number(amount);
  if (!(n > 0)) return null;
  if (isUsdStable(t.symbol)) return `$${shown(amount, 2)}`;
  const price = Number(t.priceUsd);
  if (!(price > 0)) return null;
  const usd = n * price;
  return usd < 0.01 ? "under $0.01" : `about $${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The payment's dollars on Send's review and on Sent: the approval sheet's own figure when the sheet's words were read
 * for this quote (tx.describe: the core's one NEAR price, grade 02h, H1: review $30.41, sheet $30.34 for one 7.1049
 * NEAR), and none when the sheet says none (a step it can't price, 669aa4fd). Only a payment with no sheet words read
 * (several approvals, a partner's route) is priced from the coin list, as before.
 */
export function paymentDollars(c: Confirm): string | null {
  const said = c.quote?.amount;
  if (said) return said.replace(/\s*\(.*\)\s*$/, "") || null;
  if (c.quote?.fee) return null;
  return dollarsFor(c.target.amount, c.target.token);
}

/** A dollar figure in words ("about $5.00", "$0.05", "under $0.01"), as a number: "under $0.01" counts as $0.01 (a bound). */
function dollarsIn(words: string | null | undefined): number | null {
  const m = words ? /^(?:about |up to )?(under )?\$([\d,]+(?:\.\d+)?)/.exec(words) : null;
  return m ? (m[1] ? 0.01 : Number(m[2]!.replace(/,/g, ""))) : null;
}
const cents = (usd: number) => `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The payment's dollars as Send's review and its button lead with them (J6; audit 2 Nov, B7: "1.1765 NEAR" large and
 * "about $5.00" small, the button "Send 1.1765 NEAR"): "$5.00", the sheet's own figure without its "about". Null with no
 * dollar figure, or one under a cent: the coin then leads, as before.
 */
export function reviewDollars(c: Confirm): string | null {
  const usd = dollarsIn(paymentDollars(c));
  return usd === null || /under/.test(paymentDollars(c) ?? "") ? null : cents(usd);
}

/** "$5.00 (1.1765 NEAR)", or the coin alone with no dollars: the payment as a line says it (the fee's lines, On its way). */
export function moneyWords(c: Confirm, t: Token): string {
  const coin = `${shownFor(c.target.amount, t)} ${t.symbol}`;
  const usd = reviewDollars(c);
  return usd ? `${usd} (${coin})` : coin;
}

/** The review's one button: "Send $5.00"; "Send 1.1765 NEAR" only with no dollar figure (J6, B7). */
export function reviewAction(c: Confirm, verb: string): string {
  return `${verb} ${reviewDollars(c) ?? `${shownFor(c.target.amount, c.target.token)} ${c.target.token.symbol}`}`;
}

/**
 * Confirm's floor (review M4, D143). From Hidden no Face ID follows (a hot key never asks), so paying is a deliberate
 * Hold, Home's Send's own (HoldButton, HOLD_MS), "Hold to pay $5.00", and no line names Face ID. From the Safe: the one
 * pill and the approval's own words ("Face ID next."), as before: the Safe still asks.
 */
export function confirmFloor(c: Confirm, verb: string, w: ApprovalWords = approvalWords()): { hold: boolean; label: string; line: string | null } {
  if (c.privacy?.on) return { hold: true, label: `Hold to ${reviewAction(c, verb.toLowerCase())}`, line: null };
  return { hold: false, label: reviewAction(c, verb), line: w.next };
}

/** The wait while the Safe's approval sheet (Face ID) is up. */
export const SAFE_WAIT = "Waiting for Face ID";
/** The wait after the act: from Hidden it pays straight away (nothing else asks); from the Safe its Face ID sheet is up. */
export const payingText = (c: Confirm): string => (c.privacy?.on ? "Paying from Private" : SAFE_WAIT);

/**
 * The review's one total, dollars first (J6, B7: "Total up to 1.1875 NEAR"): "up to $5.05 (1.1875 NEAR)", the payment's
 * dollars plus the most the fee can be in dollars (the sheet's own figures, so the review and the sheet agree), the coin
 * total after it. A dollar coin is its own dollars, rounded up. No price for either: the coin total alone, as before.
 */
export function totalDollarsFirst(c: Confirm): string {
  const total = totalWithFee(c);
  const value = total ?? youPay(c).value;
  const upTo = value.startsWith("up to ");
  const coin = upTo ? value.slice("up to ".length) : value;
  let usd: number | null = null;
  if (total) {
    const paid = dollarsIn(paymentDollars(c)), fee = dollarsIn(c.quote?.fee);
    if (paid !== null && fee !== null) usd = Math.round((paid + fee) * 100) / 100;
  } else if (isUsdStable(c.inSymbol) && Number(c.maxIn) > 0) {
    usd = Math.ceil(Number(c.maxIn) * 100 - 1e-9) / 100;
  }
  // Two estimates added are not a bound (security review of J6, open item): the dollars are "about"; the coin total keeps
  // its own "up to", which is one.
  return usd === null ? value : upTo ? `about ${cents(usd)} (up to ${coin})` : `${cents(usd)} (${coin})`;
}

/** "9.4 s" from milliseconds. */
export const seconds = (ms: number) => `${(Math.round(ms / 100) / 10).toFixed(1)} s`;

/** A card's money in plain words (UI's robot walk): "€5", "£12.50", "$20", never a coin's symbol like EURe. */
const CARD_SIGN: Record<string, string> = { EURe: "€", GBPe: "£", USDC: "$" };
export const cardMoney = (amount: string, coin: string) => `${CARD_SIGN[coin] ?? ""}${CARD_SIGN[coin] ? amount : `${amount} ${coin}`}`;
/** The coin a card is topped up in, as a person says it. */
export const cardCoinName = (coin: string) => ({ EURe: "euros", GBPe: "pounds", USDC: "dollars" })[coin] ?? coin;

/** The amount "Before you start" prices a send at: the first top-up's test size. */
export const ESTIMATE_AMOUNT = "5";

/**
 * Pay's own move in words, from a live quote (UI's gap list): "Sending $5 there from ZeroFee costs under 1 cent now
 * and takes about a minute (an estimate)." In dollars, never a coin's decimals; the sheet still shows the exact fee.
 */
export function estimateWords(e: { feeUsd: string; etaSeconds?: number }): string {
  const fee = Number(e.feeUsd);
  const cost = !(fee > 0) ? "costs nothing" : fee < 0.01 ? "costs under 1 cent" : `costs about $${fee.toFixed(2)}`;
  const s = e.etaSeconds;
  const time = s === undefined ? "" : s <= 60 ? " and takes about a minute" : s <= 600 ? ` and takes about ${Math.ceil(s / 60)} minutes` : " and can take longer";
  return `Sending $${ESTIMATE_AMOUNT} there from ZeroFee ${cost} now${time} (an estimate).`;
}
