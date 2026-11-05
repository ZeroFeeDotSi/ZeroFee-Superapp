// B35 on V4 Send: the amount can never send more than the coin holds (finding 64: an ask over it is said, never snapped).
import { compare } from "@zerofee/pay/amount";
import { isUsdStable } from "@zerofee/pay/tokens";
import { COIN_SHOWN_DECIMALS } from "@zerofee/core/add-outside";
import { flowCents } from "@zerofee/core/cents";
import { fourPlacesText } from "@zerofee/core/format";

/** Finding 64 (tester, 4 Nov: 999999 became the whole wallet and armed "Hold to send $144.27", nothing said): a typed
 *  number over what the coin can send stays as typed, Hold stays off, and the line says the most (Max sends it). The Copywriter's words: never "more than it has", since the most
 *  keeps the network's fee room back (send-rows.ts), so a figure between the two is still in the wallet. */
export const overLine = (place: string, most: string) => `You can send at most ${most} from ${place}.`;
/** S3 (the copy review's Sim walk, 5 Nov): From said "314.4 NEAR · $1,392.79" while "at most $8.85" could go. One figure:
 *  what can be sent now, in dollars, down to the cent: the same figure "at most" says. `per`: the coin's dollar price
 *  (a dollar coin is 1), null without one. */
export function readyUsd(max: string, per: number | null): number | null {
  return per !== null && per > 0 && Number.isFinite(per) && Number(max) >= 0 ? Math.floor(Number(max) * per * 100 + 1e-6) / 100 : null;
}
export const readyWords = (usd: string) => `${usd} ready to send`;
const dollarsOf = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A source's dollar price per coin: a dollar coin is 1; otherwise its dollars over its amount; null without one. */
export const perOf = (s: { symbol: string; amount: string; usd?: string }): number | null => (isUsdStable(s.symbol) ? 1 : Number(s.usd) > 0 && Number(s.amount) > 0 ? Number(s.usd) / Number(s.amount) : null);
/** S3: From's line (and each list row's). A Safe coin says the one figure that can go now ("$8.85 ready to send", the
 *  figure "at most" says); a wallet its coin and dollars as before (its max is all of it but the fee room). */
export function heldWords(s: { row: string | null; symbol: string; amount: string; usd?: string; max: string }): string {
  const ready = s.row === null ? readyUsd(s.max, perOf(s)) : null;
  return ready !== null ? readyWords(dollarsOf(ready)) : `${coinShown(s.amount, "down")} ${s.symbol}${s.usd ? ` · ${dollarsOf(Number(s.usd))}` : ""}`;
}
/** Whether From says REST_STAYS: a Safe coin holding more than it can send now (said once, never per row). */
export const restStays = (s: { row: string | null; amount: string; max: string }): boolean => s.row === null && Number(s.amount) > Number(s.max);
/** Said once under From when a Safe coin can send less than it holds (the copy review's words). */
export const REST_STAYS = "The rest stays in your Safe for now.";
/** the copy review's ruling (5 Nov), Send from Private: the coin's row carries its figure ("NEAR · $8.85 in Private"). */
export const privateRow = (symbol: string, most: string) => `${symbol} · ${most} in Private`;

/** the copy review's From card while the fill is shut (5 Nov): the sub-line under From, Private's one figure (format.ts privateFigure,
 *  "20.00"), or that it is empty; under it the quiet link that opens the fill (Safe → Private). */
export const fillShutLine = (usd: string | null | undefined): string =>
  `Public sends go through Private. ${usd && Number(usd) > 0 ? `Private holds $${usd} right now.` : "Private is empty."}`;
export const TOP_UP_PRIVATE = "Top up Private";
/** Said only when the typed amount was over what Private holds (the keypad capped it there). */
export const privateOver = (most: string, symbol: string) => `Private holds ${most} of ${symbol}. Send up to that, or pick another coin.`;
/** The keypad's cap for a Send from Private: an amount (coins, decimal text) over `max` comes down to `max`, and the
 *  keypad shows the figure it capped at (dollars to the cent, down, when the coin is priced in dollars; else the coins).
 *  Null when it isn't over. */
export function privateCap(amount: string, max: string, per: number | null, stable: boolean): { amount: string; typed: string } | null {
  if (!overMax(amount, max)) return null;
  const usd = !stable ? readyUsd(max, per) : null;
  return { amount: max, typed: usd !== null ? usd.toFixed(2) : max };
}
/** Whether a coin amount asks more than the coin can send, worked on the decimal text (no float). */
export const overMax = (amount: string, max: string): boolean => /^\d+(\.\d+)?$/.test(amount) && /^\d+(\.\d+)?$/.test(max) && compare(amount, max) > 0;

/**
 * A coin amount as Send's lines say it (COIN_SHOWN_DECIMALS: at most 4 decimals): what leaves rounds UP, so
 * the line never says less goes than does; what is held or arrives rounds DOWN, so it never says more is there. Worked on
 * the decimal text (no float), with commas and no trailing zeros: "0.0492", "1,234.5".
 */
export function coinShown(amount: string, dir: "up" | "down"): string {
  const text = /e/i.test(amount) ? Number(amount).toFixed(18) : amount.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (!m[1] && !m[2])) return "0";
  const d = COIN_SHOWN_DECIMALS;
  const frac = m[2] ?? "";
  let units = BigInt((m[1] || "0") + frac.slice(0, d).padEnd(d, "0"));
  if (dir === "up" && /[1-9]/.test(frac.slice(d))) units += 1n;
  const s = units.toString().padStart(d + 1, "0");
  const f = s.slice(-d).replace(/0+$/, "");
  return `${BigInt(s.slice(0, -d)).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}

/** The coin amount under Send's keypad ("1.1286 NEAR from your Safe"), rounded as every sheet rounds it (the auditor's
 *  ruling, 5 Nov: the form said 1.1287 while the sheet said 1.1286): the core's own fourPlacesText (format.ts, down) over
 *  the exact figure with its commas, as the sheet's money() writes it (formatAmount). Display only: what is sent is the
 *  exact `amount` the form worked from the typed figure, never this text. */
export function coinSaid(amount: string, symbol: string): string {
  const text = /e/i.test(amount) ? Number(amount).toFixed(18) : amount.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  const whole = m && (m[1] || m[2]) ? BigInt(m[1] || "0").toLocaleString("en-US") : "0";
  const frac = m ? (m[2] ?? "").replace(/0+$/, "") : "";
  return fourPlacesText(`${whole}${frac ? `.${frac}` : ""} ${symbol}`);
}

/** Send's one dollar figure (test, MUST 1: the keypad said $6.85, the button "Send $6.86"): the keypad and the button
 *  both say it: the typed (or capped) dollars when there are any, else the coins' worth rounded once (core cents.ts). A
 *  request's exact coin amount: its worth. Null with no price. Display only (the audit's condition): what is sent is the coin
 *  amount the form worked from the typed figure, never this rounded text. */
export const sendFigure = (o: { typed: string | null; exact: boolean; usd: number | null }): string | null =>
  o.usd !== null ? flowCents(o.exact ? null : o.typed, o.usd) : null;
