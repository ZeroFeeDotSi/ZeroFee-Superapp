// A ticking "how long is left", in words ("1 day 23 hours", "5 hours", "12 minutes", "9 seconds"), for the Waiting
// screens, the old phone's Recovery line and its banner, and the second device's list. Its own module (no screen, no
// words list), so the second device's site carries only this.
import { useEffect, useState } from "react";

/** `text`: the time in words for a sentence ("Finishes in 1 day 23 hours unless you stop it."); `alone`: the same
 *  time standing by itself, a hero or a row's right side ("1 day 23 hours left"). Never "1d 23h" (copy review, 7 Nov). */
export function useCountdown(untilIso: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(untilIso).getTime() - now);
  return { left, text: waitWords(left), alone: waitWords(left, true) };
}

/** the copy review's S5 (7 Nov): a wait in words, never "2d 0h" or "1d 23h": "2 days", "1 day 4 hours", "5 hours", "12 minutes",
 *  "9 seconds"; `alone` adds "left" ("1 day 23 hours left") where the time stands by itself. Whole units only (nothing
 *  rounded up past what is left). The one function for every wait the app counts down (B11, 7 Nov). */
export function waitWords(ms: number, alone = false): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
  const time = d > 0 ? `${n(d, "day")}${h > 0 ? ` ${n(h, "hour")}` : ""}` : h > 0 ? n(h, "hour") : m > 0 ? n(m, "minute") : n(s, "second");
  return alone ? `${time} left` : time;
}

/** The time standing by itself: "2 days left", "1 day 23 hours left" (B8's wait hero; waitWords's `alone`). */
export const leftWords = (ms: number): string => waitWords(ms, true);

/** the copy review's S5: when a wait ends, "9 Nov" (the day first, lower-case am/pm); just the time when it is today. */
export function endsShort(iso: string, now = new Date()): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?(AM|PM)$/, (_m, x: string) => ` ${x.toLowerCase()}`);
  return at.toDateString() === now.toDateString() ? time : `${at.getDate()} ${at.toLocaleDateString("en-US", { month: "short" })}, ${time}`;
}

/** "7:12 PM", or "Tue 7:12 PM" when it isn't today: when a wait ends (grade 1 Nov, D20). */
export function endsWords(iso: string, now = new Date()): string | null {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
