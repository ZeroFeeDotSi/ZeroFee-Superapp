// How old a coin list on screen is (audit 2 Nov): the lists are read again while they're shown, and one whose answer is
// older than a few minutes (the market data couldn't be asked: market/index.ts serves it up to a day old, as `asOf`) says
// the time it is from, on every screen that shows one.

/** A list on screen is read again this often (the market's own list cache time: one call a minute at most). */
export const LIST_REFRESH_MS = 60_000;

/** " · as of 15:24" for a list from an older answer; "" for a fresh one. */
export function asOfText(asOf: number | undefined, timeOf: (ms: number) => string = clock): string {
  return asOf !== undefined && Number.isFinite(asOf) ? ` · as of ${timeOf(asOf)}` : "";
}
const clock = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The time a list on screen is from: its own `asOf`, or, when the read that should have replaced it failed, the time it
 * was read (it is that old, and stays on screen rather than going blank).
 */
export function listAsOf(rows: { asOf?: number } | null, readAt: number | undefined, refreshFailed: boolean): number | undefined {
  if (!rows) return undefined;
  if (rows.asOf !== undefined) return rows.asOf;
  return refreshFailed ? readAt : undefined;
}

/** The one line a list says when it is older than a minute (design review 3 Nov, item 21): "From 2 min ago", "From 1 h
 *  ago"; no label repeating the tab above it. */
export function fromAgoText(ageMs: number): string {
  const min = Math.max(1, Math.round(ageMs / 60_000));
  return min < 60 ? `From ${min} min ago` : `From ${Math.round(min / 60)} h ago`;
}
