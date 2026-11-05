// When Trade's screens read the network. The shell draws Trade beside the app on screen (instant swipes); the UX audit of
// 4 Nov measured rows as a skeleton for 0.56 s and the wallet chips still shimmering at 412 ms after the tap, because
// nothing was read until Trade was on screen. Now a screen's FIRST read goes when Trade is drawn; everything after it (the
// timed refreshes, a search, a Retry) waits for Trade to be on screen, as before.
import type { ListKind, Paint } from "../market/paint.ts";

/** Whether a screen's read goes now: always while Trade is on screen; beside another app only its very first read. */
export function liveReadsNow(active: boolean, first: boolean): boolean {
  return active || first;
}

/** Whether a list is read now: on screen, always; beside another app, only a list's first read (never a search, a refresh
 *  or a list already painted). */
export function listReadsNow(o: { active: boolean; kind: ListKind["kind"]; hasRows: boolean }): boolean {
  return o.active || (o.kind !== "search" && !o.hasRows);
}

/** A list read that failed (a market 429, QA's crawl, 4 Nov: Trending stopped on "GeckoTerminal isn't
 *  answering") is asked again by itself, sooner first: 2 s, 4 s, 8 s, 16 s, then every 30 s while it still fails. */
export const LIST_RETRY_FIRST_MS = 2_000, LIST_RETRY_MAX_MS = 30_000;
export function listRetryMs(fails: number): number {
  return Math.min(LIST_RETRY_MAX_MS, LIST_RETRY_FIRST_MS * 2 ** Math.max(0, Math.min(fails, 16) - 1));
}

/** The rows the device kept for a list, painted before the network answers. A chain's Hot list it hasn't kept paints
 *  that chain's rows of the All list it has (never an empty screen when a list was read before, QA's crawl). */
export function keptList(paint: Pick<Paint, "list">, k: ListKind): ReturnType<Paint["list"]> {
  const own = paint.list(k);
  if (own || k.kind !== "trending" || k.chain === "all") return own;
  const all = paint.list({ kind: "trending", chain: "all" });
  const v = all?.v.filter((r) => r.chain === k.chain);
  return all && v?.length ? { ...all, v } : undefined;
}
