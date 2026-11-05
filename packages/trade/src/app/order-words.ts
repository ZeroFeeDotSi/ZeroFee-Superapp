// T-1 landing 2: an order's words, dollars first. Pure, so each line is tested. A coin's symbol comes from the market
// data (a scam coin names itself): it is cut to 12 letters on these lines.
import type { OrderKind, PriceOrder } from "../orders.ts";
import { price, usd } from "./format.ts";

export const sym = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
export const KIND_LABEL: Record<OrderKind, string> = { "limit-buy": "Buy if it falls", "take-profit": "Sell if it rises", "stop-loss": "Sell if it falls", "sell-after": "Sell after a time" };

/** "Buy $10 if it falls to $0.002989" / "Sell all if it rises to $0.0041" / "Sell all if it falls to $0.0028" (copy row 28). */
export function orderLine(o: Pick<PriceOrder, "kind" | "usd" | "triggerPx" | "at">): string {
  if (o.kind === "sell-after") return `Sell all at ${when(o.at ?? 0)}`;
  return o.kind === "limit-buy" ? `Buy ${usd(o.usd ?? 0)} if it falls to ${price(o.triggerPx)}` : `Sell all if it ${o.kind === "take-profit" ? "rises" : "falls"} to ${price(o.triggerPx)}`;
}
/** Its state, one or two words. */
export function stateWord(o: Pick<PriceOrder, "status">): string {
  return { waiting: "Waiting", missed: "Needs you", running: "Running", done: "Done", stopped: "Stopped", failed: "Didn't go", expired: "Ran out", cancelled: "Cancelled" }[o.status];
}
/** The trigger as a step from today's price: −10 % for a buy or a stop, +25 % for a take profit. */
export function triggerFrom(px: number, pct: number): number { return Number((px * (1 + pct / 100)).toPrecision(4)); }
export const STEPS: Record<OrderKind, number[]> = { "limit-buy": [-5, -10, -20], "take-profit": [10, 25, 50], "stop-loss": [-5, -10, -20], "sell-after": [] };
/** A time on the phone's clock: "Tue 6:05 PM". */
export const when = (t: number) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
/** A time ahead: "today 9:05 AM", "tomorrow 8:16 AM", else "Wed 8:16 AM" (e2e walk 3 Nov: "next Wed" on a Tuesday read
 *  as next week's). */
export const nextWhen = (t: number, now = Date.now()): string => {
  const at = new Date(t), clock = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date(now))) / 86_400_000);
  return days === 0 ? `today ${clock}` : days === 1 ? `tomorrow ${clock}` : `${at.toLocaleDateString([], { weekday: "short" })} ${clock}`;
};
/** A tap's work on the book (Buy now, Sell now, Cancel): its failure says one line, never an unhandled rejection (ST-B
 *  review L2, and T-1's own screens). `say(null)` when it went; `after` always (the list is read again). */
export const TAP_FAILED = "That didn't go. Try again.";
export const NOT_NOW = "It already started or ended, so it can't be cancelled.";
export function tapped(p: Promise<unknown>, say: (line: string | null) => void, after: () => void): Promise<void> {
  // a book that answered "no change" (false: it had already started or ended) says so too (ST-C review)
  return p.then((v) => say(v === false ? NOT_NOW : null), () => say(TAP_FAILED)).finally(after);
}
