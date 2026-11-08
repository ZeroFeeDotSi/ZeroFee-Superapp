// B35 on V4 Send: the amount can never send more than the coin holds (finding 64: an ask over it is said, never snapped).
import { compare, sub } from "@zerofee/pay/amount";
import { isUsdStable } from "@zerofee/pay/tokens";
import { COIN_SHOWN_DECIMALS } from "@zerofee/core/add-outside";
import { flowCents } from "@zerofee/core/cents";
import { fourPlacesText } from "@zerofee/core/format";
import { PRIVATE_BUFFER_USD, fillStepUsd } from "@zerofee/core/private-route";

/** Finding 64 (tester, 4 Nov: 999999 became the whole wallet and armed "Hold to send $144.27", nothing said): a typed
 *  number over what the coin can send stays as typed, Hold stays off, and the line says the most (Max sends it). The Copywriter's words: never "more than it has", since the most
 *  keeps the network's fee room back (send-rows.ts), so a figure between the two is still in the wallet. */
export const overLine = (place: string, most: string, max = false) => `You can send at most ${most} from ${place}.${max ? ` ${OVER_MAX_TAP}` : ""}`;
/** S1 (QA's ledger re-walk, 6 Nov: the line said the most, not the tap): the next tap, the Max chip that sets the most.
 *  Said only while Max can set something (the coin can send more than nothing). Words provisional (the words reviewer). */
export const OVER_MAX_TAP = "Tap Max to send that.";
/** S1 (QA's ledger re-walk, 6 Nov, b/21: a $90 Send from a wallet holding $28.17 said "0.0383 ETH from your ETH (RH)
 *  wallet" and "0.0106 ETH goes to them"): what the slot under the amount says. Over what can go: nothing, so no coin
 *  figure is ever worked from a sum that can't leave (the "at most" line says the most, over the button). A request's
 *  exact coin: what they asked. Else the typed amount in its coin, and Max's line when it shows. */
/** `stable`: a dollar coin (builder 3, 7 Nov): its figure is the hero's dollars, so no coin line repeats it ("1,165.0485
 *  USDC from your Safe" under "$1,165.04"); any other coin keeps it. */
export function underAmount(o: { over: boolean; stable?: boolean; exact: { amount: string; symbol: string } | null; amount: string; symbol: string; place: string; maxLine: string | null }): { coins: string | null; max: string | null } {
  if (o.over) return { coins: null, max: null };
  if (o.exact) return { coins: `They asked for ${o.exact.amount} ${o.exact.symbol}.`, max: null };
  // the a16 rule (copy review, 6 Nov, 21c): ONE line in the slot; Max's line (what goes to them, where the rest stays: the privacy
  // audit's, 4 Nov) takes it, the coin line leaves
  if (o.maxLine) return { coins: null, max: o.maxLine };
  return { coins: Number(o.amount) > 0 && o.stable !== true ? `${coinSaid(o.amount, o.symbol)} from ${o.place}` : null, max: null };
}
/** S3 (the copy review's Sim walk, 5 Nov): From said "314.4 NEAR · $1,392.79" while "at most $8.85" could go. One figure:
 *  what can be sent now, in dollars, down to the cent: the same figure "at most" says. `per`: the coin's dollar price
 *  (a dollar coin is 1), null without one. */
export function readyUsd(max: string, per: number | null): number | null {
  return per !== null && per > 0 && Number.isFinite(per) && Number(max) >= 0 ? Math.floor(Number(max) * per * 100 + 1e-6) / 100 : null;
}
/** S3 (QA's ledger re-walk, 6 Nov, b/09: "Your Safe $1,383.92 ready to send" under Home's Safe $5,288.01): the row is
 *  one coin of the Safe, so it names it ("NEAR · $1,383.92 ready to send"), as Private's row does ("NEAR · $8.85 in
 *  Private"). Words provisional. */
export const readyWords = (usd: string, symbol: string) => `${symbol} · ${usd} ready`;
const dollarsOf = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A source's dollar price per coin: a dollar coin is 1; otherwise its dollars over its amount; null without one. */
export const perOf = (s: { symbol: string; amount: string; usd?: string }): number | null => (isUsdStable(s.symbol) ? 1 : Number(s.usd) > 0 && Number(s.amount) > 0 ? Number(s.usd) / Number(s.amount) : null);
/** S3: From's line (and each list row's). A Safe coin says the one figure that can go now ("$8.85 ready to send", the
 *  figure "at most" says); a wallet its coin and dollars as before (its max is all of it but the fee room). */
export function heldWords(s: { row: string | null; symbol: string; amount: string; usd?: string; max: string }): string {
  const ready = s.row === null ? readyUsd(s.max, perOf(s)) : null;
  // the copy review's B+ grade (8 Nov): two short lines on From, never clipped ("…ready to sen…"): "Your Safe", then "NEAR · $1,383.92
  // ready"; where the rest of Home's figure is goes under the coin in the From list (restLine)
  return ready !== null ? readyWords(dollarsOf(ready), s.symbol) : `${coinShown(s.amount, "down")} ${s.symbol}${s.usd ? ` · ${dollarsOf(Number(s.usd))}` : ""}`;
}
/** J2-5 (audit, 8 Nov): Home's figure less what can go now, by where it really is (send-sources.ts restOf), in dollars. */
export interface RestParts { privateUsd: number; elsewhereUsd: number; stakedUsd: number; keptUsd?: number }
/** QA 16's MUST 3 (8 Nov, b8's): "$25.00 more is in Private. $120.10 more is elsewhere in your Safe. $75.46 more
 *  stays with you, so this send is harder to trace." was three figures in one breath, and a privacy claim it didn't
 *  explain. Now one idea, from the person's side: what the Safe holds of the coin (Home's figure, Private in it) and
 *  Private's part of it. The ready figure is the From row's own ("$1,165.04 ready"), so it isn't said again. */
export const REST_WORDS = {
  // QA 16 on b9's: two Safe figures on screen ("$1,165.04 ready" and this) need what the gap is
  holds: (total: string, symbol: string, inPrivate: string) => `Your Safe holds ${total} in ${symbol}, ${inPrivate} of it in Private. One send can't take it all.`,
};
/** The rest with the gap a round sum keeps back (QA 16, 7 Nov): what the source's place can send (`maxUsd`) less what
 *  one send pays (`canUsd`, maxSend's), so the parts add up to Home's figure less the one figure. Unchanged without one. */
export function withKept(rest: RestParts | undefined, maxUsd: number | null, canUsd: number | null): RestParts | undefined {
  const kept = maxUsd !== null && canUsd !== null ? Math.round((maxUsd - canUsd) * 100) / 100 : 0;
  if (!(kept >= 0.01)) return rest;
  return { ...(rest ?? { privateUsd: 0, elsewhereUsd: 0, stakedUsd: 0 }), keptUsd: kept };
}
/** "Up to $X can go in one send." with the one figure (QA 16, 7 Nov: it said the raw max, $1,240.50, over a $1,165.04
 *  button); a line with no dollar figure as it was. */
export const onePart = (part: string, figure: string): string => part.replace(/\$[\d,]+\.\d\d/, figure);
/** QA 16's Send Max shots (7 Nov): the form's one figure ("1165.04") as every later line says it, "$1,165.04", with its
 *  commas (the receipt, the Jobs rows and the Getting-ready sheet said "$1165.04"). */
export const sendCash = (figure: string): string => dollarsOf(Number(figure));
export function restLine(s: { row: string | null; symbol: string; amount: string; usd?: string; max: string; rest?: RestParts }): string | null {
  const ready = s.row === null ? readyUsd(s.max, perOf(s)) : null;
  if (ready === null || !s.rest) return null;
  const r = s.rest;
  const inPrivate = r.privateUsd >= 0.01 ? r.privateUsd : 0;
  const others = [r.elsewhereUsd, r.stakedUsd, r.keptUsd ?? 0].filter((usd) => usd >= 0.01).reduce((a, b) => a + b, 0);
  if (!(inPrivate + others >= 0.01)) return null;
  // the copy review's exact words (8 Nov, QA 16): the rest all in Private (the Send at Max from the Safe's other place)
  if (!(others >= 0.01)) return `${PRIVATE_KEEPS} · about ${dollarsOf(inPrivate)}`;
  // QA 16's MUST 3: one idea, the Safe's whole figure of the coin and Private's part of it
  const total = Number(s.usd);
  if (inPrivate && total > 0) return REST_WORDS.holds(dollarsOf(total), s.symbol, dollarsOf(inPrivate));
  // QA 20 (8 Nov): one figure for the rest
  return `${REST_KEPT} · ${isUsdStable(s.symbol) ? "" : "about "}${dollarsOf(Math.round((inPrivate + others) * 100) / 100)}`;
}
/** A worked dollar figure down to the cent (audit, 6 Nov: Max read "Send $27.94" beside "at most $27.93"), as the "at most"
 *  line is, so the keypad and the button never say a cent over what goes. Pure. */
export const centsDown = (usd: number): number => Math.floor(usd * 100 + 1e-6) / 100;
/** The line under From, "Up to $X can go in one send.", only when its figure isn't the row's own (the copy review's ruling, 6 Nov: the
 *  row now says what can send, so the same figure twice is noise; it stays when the cap is lower than the row). Pure. */
export function partShown(part: string | null | undefined, rowLine: string): string | null {
  if (!part) return null;
  const figure = /\$[\d,]+\.\d\d/.exec(part)?.[0];
  return figure && rowLine.includes(figure) ? null : part;
}
/** Whether From says where the rest is (restStaysLine): a Safe coin holding more than it can send now (said once, never per row). */
export const restStays = (s: { row: string | null; amount: string; max: string }): boolean => s.row === null && Number(s.amount) > Number(s.max);
/** QA 20 (8 Nov, B+): the line under From said "The rest stays in your Safe for now.", no figure, no place. Said once
 *  under From when a Safe coin can send less than it holds: all of it in Private, "Private keeps the rest · about $X"
 *  (the copy review's words); spread over places, each by its own figure (restLine, J2-5's words); else the Safe's own figure, "Your Safe keeps the rest · about $X" ("about": worked
 *  from a price; a dollar coin's is exact; no price: the coins). Null when nothing rests (words to 53). */
export const REST_KEPT = "Your Safe keeps the rest";
export const PRIVATE_KEEPS = "Private keeps the rest";
export function restStaysLine(s: { row: string | null; symbol: string; amount: string; usd?: string; max: string; rest?: RestParts }): string | null {
  if (!restStays(s)) return null;
  // the rest by its real places (restLine): all in Private, the copy review's "Private keeps the rest · about $X"; with Private's part,
  // one idea (QA 16's MUST 3); else the rest's one figure (QA 20)
  const placed = restLine(s);
  if (placed) return placed;
  let coins: string;
  try { coins = sub(s.amount, s.max); } catch { return null; }
  if (!(Number(coins) > 0)) return null;
  const per = perOf(s);
  const usd = per !== null ? Math.floor(Number(coins) * per * 100 + 1e-6) / 100 : 0;
  if (usd >= 0.01) return `${REST_KEPT} · ${isUsdStable(s.symbol) ? "" : "about "}${dollarsOf(usd)}`;
  return `${REST_KEPT} · ${coinShown(coins, "down")} ${s.symbol}`;
}
/** the copy review's ruling (5 Nov), Send from Private: the coin's row carries its figure ("NEAR · $8.85 in Private"). */
export const privateRow = (symbol: string, most: string) => `${symbol} · ${most} in Private`;

/** the copy review's From card while the fill is shut (5 Nov): the sub-line under From, Private's one figure (format.ts privateFigure,
 *  "20.00"), or that it is empty; under it the quiet link that opens the fill (Safe → Private). */
export const fillShutLine = (usd: string | null | undefined): string =>
  `Public sends go through Private. ${usd && Number(usd) > 0 ? `Private holds $${usd} right now.` : "Private is empty."}`;
export const TOP_UP_PRIVATE = "Top up Private";
/** Said only when the typed amount was over what Private holds (the keypad capped it there). */
// the audit's S3 (7 Nov): "Private holds 0.5 of USDC." A figure in dollars is held in the coin; a coin figure is said once, with its name
export const privateOver = (most: string, symbol: string) => `Private holds ${most.startsWith("$") ? `${most} in ${symbol}` : most.endsWith(` ${symbol}`) ? most : `${most} ${symbol}`}. Send up to that, or pick another coin.`;
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
  o.usd !== null ? flowCents(o.exact ? null : o.typed, o.exact || o.typed === null ? centsDown(o.usd) : o.usd) : null;

/** The Safe's Getting-ready headline for a Send (copy review, 6 Nov): the typed figure alone, "Send $25.00". The core's bound
 *  title only adds the source, "Send $25.00 from your Safe", never another figure or the payee (the To row says whom). */
export const sendHeadline = (shown: string): string => `Send ${shown}`;

/** the audit's S9 (7 Nov): a $5 Safe Send moves $10 out of the Safe (the fill's whole step, core fillStepUsd) and leaves about $5
 *  in Private, and the person first met "From your Safe · $10.00" on the Face ID sheet. One quiet line on the floor says
 *  it before the tap. The core's rule: past what Private holds of the coin, the whole Send goes through the fill, a step
 *  over it while Private's share plus the extra stays under the buffer (PRIVATE_BUFFER_USD), else the Send's own figure.
 *  Null: not a Safe coin that fills, nothing over Private, no price, or nothing stays. `coins`: the typed amount. */
export function fillStepLine(o: { place: string; row: string | null; privateOnly?: boolean; coins: number; pocket: number; per: number | null }): string | null {
  if (o.place !== "your Safe" || o.row !== null || o.privateOnly || o.per === null || !(o.coins > 0) || !(o.coins > o.pocket + 1e-9)) return null;
  const usd = o.coins * o.per, step = fillStepUsd(usd);
  const fill = step > usd && o.pocket * o.per + (step - usd) <= PRIVATE_BUFFER_USD ? step : usd;
  const stays = Math.floor((fill - usd) * 100 + 1e-6) / 100;
  return stays < 0.01 ? null : FILL_STEP_WORDS(dollarsOf(fill), dollarsOf(stays));
}
/** "$10.00 leaves your Safe. About $5.00 stays in Private." (the Face ID sheet's own two figures, said first here). */
export const FILL_STEP_WORDS = (leaves: string, stays: string): string => `${leaves} leaves your Safe. About ${stays} stays in Private.`;

/** Audit 10's A4 (8 Nov): Max on the Safe's NEAR offered "$1,333.28 ready" that the Safe's $500 rule refuses. A Safe coin
 *  that fills (not Private-only, not a wallet) can send today only what the rules let go: `leftUsd`, the core's own
 *  figure (account.protection.get's sendLeftUsd, the one the over-limit refusal says: the most one Send can ask whose
 *  whole fill fits). Its `max` comes down to that ask in coins at the row's own price (Max then pays the core's maxSend
 *  under it, so its fill fits too), never under what Private holds of it (Private pays without the Safe's rule); so
 *  "ready", Max and the "at most" line all say what can go. Unchanged: no figure read yet, no price, or the rule lets the whole of it go. Pure. */
export function ruleCap<S extends { row: string | null; privateOnly?: boolean; symbol: string; amount: string; usd?: string; max: string; pocket?: string }>(s: S, leftUsd: number | null | undefined): S {
  if (s.row !== null || s.privateOnly || typeof leftUsd !== "number" || !Number.isFinite(leftUsd) || leftUsd < 0) return s;
  const per = perOf(s);
  const max = Number(s.max), pocket = Number(s.pocket ?? 0) || 0;
  if (per === null || !(max > pocket)) return s;
  const places = isUsdStable(s.symbol) ? 6 : 9;
  const coins = Math.max(pocket, Math.floor((leftUsd / per) * 10 ** places + 1e-6) / 10 ** places);
  return coins < max ? { ...s, max: coins.toFixed(places).replace(/\.?0+$/, "") || "0" } : s;
}
