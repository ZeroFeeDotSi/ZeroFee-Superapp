// The Buy and Sell button's words and the quote's start (UX audit 4 Nov: the page's first quote waited 250 ms for nothing,
// and the button's words changed twice on every amount: "Buy $25 of DOPE", "Checking you can sell it back…", then back).

import { isPositive } from "@zerofee/design/keypad.ts";
import type { CoinDetail, CoinRow } from "../../market/types.ts";

/** The coin the page's Buy opens with: the page's own read, else the row the person tapped (QA's Sim crawl,
 *  5 Nov: Buy sat disabled 2.5-8 s while the market data and the chart loaded; rule 3: Buy never waits on them). The
 *  sheet reads only the coin's chain, address, symbol and logo, its quote comes from the engine, and every buy reads the
 *  coin's mint itself, so the row is enough. A row with no name (a pasted address not read yet) waits for the read. */
export function buyCoin(d: CoinDetail | undefined, seed: CoinRow): CoinDetail | undefined {
  if (d) return d;
  if (!seed.symbol) return undefined;
  return { chain: seed.chain, address: seed.address, symbol: seed.symbol, name: seed.name, ...(seed.logoUrl ? { logoUrl: seed.logoUrl } : {}), ...(seed.priceUsd !== undefined ? { priceUsd: seed.priceUsd } : {}) };
}

/** Where a page's amount opens. A buy opens on the Quick buy amount the person picked in Settings (product decision, 5 Nov, via a
 *  proxy: "never $0 with nothing picked"; it was Finding 37's no amount), or on what a flow handed it (Top up coming back,
 *  another app filling it in). With no setting read it is still no amount, its button off. A sale opens on all of it. */
export function openAmount(side: "buy" | "sell", start?: string, quick?: number): string {
  return start ?? (side === "buy" ? (quick ? String(quick) : "") : "100");
}

/** A buy's button: the dollars once there are some; before, why it is off (the Copywriter: never the title again). */
export function buyLabel(value: string, symbol: string): string {
  return isPositive(value) ? `Buy $${value} of ${symbol}` : "Choose an amount";
}

/** The lit button's words on a buy (the copy review's final words, 7 Nov, T4): "Buy $25.00", two decimals, the coin named once (in the
 *  title). The task and Activity keep buyLabel's "Buy $25 of DOPE", which names the coin. */
export function buyButtonLabel(value: string): string {
  return isPositive(value) ? `Buy $${withCommas(Number(value).toFixed(2))}` : "Choose an amount";
}

/** How long a new amount waits before it is quoted: at once, unless a key was just typed (the next key may follow). */
export function quoteDelayMs(instant: boolean): number {
  return instant ? 0 : 250;
}

/** The button's words. They stay the trade ("Buy $25 of DOPE") while it is checked; only offline, sending and a press
 *  kept until the check ends say anything else. */
export function buttonWords(o: { online: boolean; busy: boolean; queued: boolean; side: "buy" | "sell"; label: string }): string {
  if (!o.online && !o.busy) return "You're offline";
  // rule 2 (b9): a state, never an ellipsis
  if (o.busy) return "Sending";
  if (o.queued) return o.side === "buy" ? "Buys once it's checked" : "Sells once it's checked";
  return o.label;
}

/** A typed dollar amount with its thousands marked, as typed ("9999" -> "9,999", "1234.5" -> "1,234.5", "0." stays "0."). */
export function withCommas(typed: string): string {
  const [whole = "", ...rest] = typed.split(".");
  const marked = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return rest.length ? `${marked}.${rest.join(".")}` : marked;
}

/** How long one quote's ask (prepare, then its proof) may take before the sheet says why instead of waiting. */
export const ASK_LIMIT_MS = 10_000;
/** How long a press kept for a quote not ready yet waits before it is dropped and the sheet says why (the 2-second rule:
 *  QA's re-test, AODF sat on "Buying when it's checked…" for 70 s). */
export const QUEUED_LIMIT_MS = 3_000;

/** `p`'s value, or `late()` thrown once `ms` pass first. */
export function withinMs<T>(ms: number, p: Promise<T>, late: () => unknown): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const out = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(late()), ms); });
  return Promise.race([p, out]).finally(() => clearTimeout(timer));
}

/**
 * The sheet's asks for a quote, in order. A new amount always starts one (the old one is no longer live); the 8 s
 * refresh starts one only when none is on its way, so a slow ask still lands (13:20: every ask of a thin coin took over
 * 8 s, each refresh dropped the one before, and none ever landed).
 */
export function createAsks() {
  let seq = 0;
  let flying: number | null = null;
  return {
    /** The new ask's number, or null: a refresh while one is flying. */
    begin(refresh: boolean): number | null {
      if (refresh && flying !== null) return null;
      flying = ++seq;
      return seq;
    },
    /** Ask `n` is over (landed, failed or out of time). */
    end(n: number): void { if (flying === n) flying = null; },
    /** Is `n` still the newest ask? Only its answer is shown. */
    live(n: number): boolean { return n === seq; },
  };
}

/** The coins a buy brought, for the Bought moment: what landed (the fill, as Activity and Sell say it), the quote's figure
 *  only when the fill isn't known or is an estimate (13:20: the moment said 86,936, Activity 84,578). */
export function boughtRaw(quoteGetRaw: string, fill: { got: string; estimated?: boolean } | undefined): string {
  return fill && !fill.estimated ? fill.got : quoteGetRaw;
}

/** The button's own one-tap lock (QA's sd-errors crawl: two clicks 4 ms apart both passed the `busy` state, which
 *  React sets only on the next render). take() says yes once until done(); the engine's own lock (service.trade) is the
 *  money's guard, this one keeps a second task row and a second receipt off the screen. */
export function createOneTap() {
  let going = false;
  return { take(): boolean { if (going) return false; going = true; return true; }, done(): void { going = false; } };
}
