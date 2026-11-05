// One way to say how long, app-wide (the review's walk, 3 Nov, item 8): "30 s", "2 min", "3 h", and a range in one unit,
// "2 to 10 min". A clock time is clock.ts's (the device's own locale: "10:52", "Tue 14:00"). The core's sheets and
// Wallet's screens say a span only through these.

const S = 1_000;
const MIN = 60 * S;
const H = 60 * MIN;
const unitOf = (ms: number): [number, string] => (ms < 90 * S ? [S, "s"] : ms < 90 * MIN ? [MIN, "min"] : [H, "h"]);

/** How long: under 90 s in seconds, under 90 min in minutes, else hours ("45 s", "20 min", "2 h"). */
export function spanWords(ms: number): string {
  const [u, w] = unitOf(Math.max(0, ms));
  return `${Math.round(Math.max(0, ms) / u)} ${w}`;
}

/** A range, in the longer end's unit ("2 to 10 min"). */
export function rangeWords(fromMs: number, toMs: number): string {
  const [u, w] = unitOf(Math.max(0, toMs));
  return `${Math.round(Math.max(0, fromMs) / u)} to ${Math.round(Math.max(0, toMs) / u)} ${w}`;
}

/** A wait the account's rules set, in seconds, in its largest whole unit ("2 minutes", "1 day", "14 days"). Never rounded
 *  up: a 2-minute wait is "2 minutes", not "1 day". */
export function waitWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const unit = s > 0 && s % 86_400 === 0 ? [86_400, "day"] as const : s > 0 && s % 3_600 === 0 ? [3_600, "hour"] as const : s > 0 && s % 60 === 0 ? [60, "minute"] as const : [1, "second"] as const;
  const n = s / unit[0];
  return `${n} ${unit[1]}${n === 1 ? "" : "s"}`;
}
