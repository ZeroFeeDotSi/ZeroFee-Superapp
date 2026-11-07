// Trade's list and coin page words that have cases (the copy review's grades, 6 Nov, items 9 and 10; fix/trade-list-coin, 7 Nov):
// each wallet chip names its wallet over its figure; the 24 hours change reads one field wherever it shows; what you hold
// says Up or Down in words since you bought; the price says "Now" (or "Live") until a finger is on the chart, and the
// chart's cursor waits for a finger. Display only: nothing here reaches a quote, an amount or a trade.
import type { ChainId } from "../types.ts";
import { pct, rowUsd, usd } from "./format.ts";

/** Home's words for each chain (D124): the coin, and ETH (RH) for Robinhood Chain. */
export const CHAIN_SHORT: Record<ChainId, string> = { sol: "SOL", hood: "ETH (RH)", near: "NEAR", bsc: "BNB" };

/** A wallet chip on Trade's top row (copy review, item 9): the wallet's name over its figure, "SOL wallet" / "$169.37"; spoken
 *  "SOL wallet · $169.37". `figure` is null while the wallet is read (a shimmer, never "$0.00"). */
export function walletChip(chain: ChainId, usdValue: number | undefined): { name: string; figure: string | null; label: string } {
  const name = `${CHAIN_SHORT[chain]} wallet`;
  const figure = usdValue === undefined || !Number.isFinite(usdValue) ? null : usd(usdValue);
  return { name, figure, label: figure === null ? name : `${name} · ${figure}` };
}

/** A list row's words (copy review, item 9: "Farming …", "dope wif …" cut beside the Buy chip): the name on its own line, whole
 *  (it wraps to 2), and its worth beside the symbol on the line above ("DOPE · $3.27M"); no worth, no dot. */
export function rowLines(r: { symbol: string; name?: string | undefined; marketCapUsd?: number | undefined }): { cap: string | null; name: string } {
  const cap = typeof r.marketCapUsd === "number" && Number.isFinite(r.marketCapUsd) && r.marketCapUsd > 0 ? rowUsd(r.marketCapUsd) : null;
  const name = r.name?.trim() ? r.name.trim() : r.symbol;
  return { cap, name };
}

/** The coin's 24 hours change, one figure for the page (copy review, item 10: the header said +5.9% and the chip +5.0%): with
 *  recorded prices (the Sim) the tapped row's, so the list, the header and the chip agree; else the page's own read,
 *  then the row's. */
export function dayChangePct(fromRow: boolean, rowPct: number | undefined, pagePct: number | undefined): number | undefined {
  const ok = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n);
  if (fromRow) return ok(rowPct) ? rowPct : ok(pagePct) ? pagePct : undefined;
  return ok(pagePct) ? pagePct : ok(rowPct) ? rowPct : undefined;
}

type Window = "m5" | "h1" | "h6" | "h24";
/** The moves row's figures: the market data's 5 min, 1 hour and 6 hours; its 24 hours is the header's own figure
 *  (dayChangePct), never the pool's separate read. A window with no figure is left out. */
export function moveFigures(moves: Partial<Record<Window, number | undefined>> | undefined, dayPct: number | undefined): Partial<Record<Window, number>> {
  const out: Partial<Record<Window, number>> = {};
  for (const w of ["m5", "h1", "h6"] as const) { const v = moves?.[w]; if (typeof v === "number" && Number.isFinite(v)) out[w] = v; }
  const day = dayPct ?? moves?.h24;
  if (typeof day === "number" && Number.isFinite(day)) out.h24 = day;
  return out;
}

/** What you hold against what you paid, in words (the copy review's final words, 7 Nov, T5: "−$0.11 −0.4%" → "Down $0.11 (0.4%)"):
 *  "Up $0.11 (0.4%)", "Down $0.11 (0.4%)". `pnlUsd` to the cent; `pctOf` left out when it can't be said (a cost of almost
 *  nothing). Nothing gained or lost: "No change" (the header's own word for a flat range). */
export function holdingChange(pnlUsd: number, pctOf?: number): string {
  if (!Number.isFinite(pnlUsd) || Math.abs(pnlUsd) < 0.005) return "No change";
  const p = pctOf !== undefined && Number.isFinite(pctOf) ? ` (${pct(Math.abs(pctOf)).replace(/^\+/, "")})` : "";
  return `${pnlUsd > 0 ? "Up" : "Down"} ${usd(Math.abs(pnlUsd))}${p}`;
}

/** A price move in dollars for the header (copy review, T1: "Down $0.0011 (23.8%)", never "-$0.001"): cents from a cent up; under
 *  a cent four places ("$0.0002", "$0.0011"); under that, two significant figures ("$0.000047"). */
export function moveUsd(n: number): string {
  const a = Math.abs(n);
  if (!Number.isFinite(a)) return "—";
  if (a >= 0.01) return usd(a);
  if (a >= 0.0001) return `$${a.toFixed(4)}`;
  if (a < 1e-9) return "$0.00";
  const zeros = -Math.floor(Math.log10(a)) - 1;
  return `$${a.toFixed(zeros + 2)}`;
}

/** The header's change line before its range words (copy review, T1): "Up $0.0002 (5.9%)", "Down $0.0011 (23.8%)"; a change that
 *  rounds to 0.0% is "No change". */
export function headerChange(dollars: number, percent: number): string {
  if (!Number.isFinite(percent) || pct(percent) === "0.0%") return "No change";
  return `${percent > 0 ? "Up" : "Down"} ${moveUsd(dollars)} (${pct(Math.abs(percent)).replace(/^\+/, "")})`;
}

/** The word beside the price when no finger is on the chart (copy review, item 10: first paint reads "Now"): "Live" over the
 *  chain's socket, "Now" for a fresh price read any other way (the Sim's recorded prices too); nothing while a finger
 *  scrubs (the time shows) or once the price is old ("Updated … ago" says so). */
export function priceWord(s: { scrubbing: boolean; stale: boolean; recorded: boolean; feed: "live" | "polling" | string | undefined }): "Live" | "Now" | null {
  if (s.scrubbing) return null;
  if (s.recorded) return "Now";
  if (s.stale) return null;
  return s.feed === "polling" ? "Now" : "Live";
}

/** The chart's cursor waits for a finger (copy review, item 10: a cursor at mid-chart on first paint, left by the tap that opened
 *  the page). It arms on a press on the chart, or on a pointer that really moves over it (more than 2 px from where it
 *  was first seen); a pointer resting where the tap was, or the browser's own move after the page drew, is not one. */
export type ScrubArm = { armed: boolean; first?: { x: number; y: number } };
export function armScrub(s: ScrubArm, e: { type: "down" | "move"; x: number; y: number }): ScrubArm {
  if (s.armed) return s;
  if (e.type === "down") return { armed: true };
  if (!s.first) return { armed: false, first: { x: e.x, y: e.y } };
  return Math.hypot(e.x - s.first.x, e.y - s.first.y) > 2 ? { armed: true } : s;
}

/** A moment on the coin page, as a date (the copy review's final words, 7 Nov, T2: "6 Nov", never "now" or "2 min"): the
 *  latest trades' times and the finger's moment on the chart. Local time. */
export function dayTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours(), m = d.getMinutes();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The coin page's stat labels (the copy review's final words, 7 Nov, T2). */
export const STAT_LABELS = { cap: "Market cap", pool: "Money in the pool", traded: "Traded in the last day", holders: "People holding", age: "Age", top10: "Top 10 wallets own" } as const;
