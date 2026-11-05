// Home's last days (UI concept v3.1, 5 Nov: a 7-day sparkline under the number). The phone keeps one figure per day,
// the total it last showed that day, in its own device.store slot (as pulse.ts keeps today's prices): no history is
// asked of any server, nothing leaves the phone. Today's figure is the latest read; a day with no read has no point
// (the line joins the days that were seen). Under two days, nothing is drawn.
import type { Bridge } from "@zerofee/core/bridge";
import { dayOf } from "./pulse.ts";

export const HOME_DAYS_KEY = "home.days";
/** Each Home tab keeps its own days (Safe | Hot, 5 Nov: the number is the tab's own figure). */
export const daysKey = (tab: "safe" | "hot"): string => `${HOME_DAYS_KEY}.${tab}`;
/** How many days the line holds. */
export const DAYS = 7;
export interface HomeDay { day: string; usd: number }

/** The kept days with today's figure set: one entry per day, the newest last, at most DAYS of them. */
export function rememberDay(kept: readonly HomeDay[] | null, usd: number, day: string): HomeDay[] {
  if (!Number.isFinite(usd) || usd < 0) return kept ? [...kept] : [];
  const rest = (kept ?? []).filter((d) => d.day !== day && d.day < day);
  return [...rest, { day, usd }].slice(-DAYS);
}

/** The line's points, oldest first. */
export const seriesOf = (days: readonly HomeDay[]): number[] => days.map((d) => d.usd);

export function readKeptDays(value: string | null | undefined): HomeDay[] | null {
  if (!value) return null;
  try {
    const v: unknown = JSON.parse(value);
    if (!Array.isArray(v)) return null;
    const out = v.filter((d): d is HomeDay => !!d && typeof d === "object" && typeof (d as HomeDay).day === "string" && typeof (d as HomeDay).usd === "number");
    return out.length ? out : null;
  } catch { return null; }
}

/** One read: the kept days brought up to this total, kept again (written only when changed), and the points. */
export async function readDays(bridge: Bridge, usd: number, at = new Date(), key = HOME_DAYS_KEY): Promise<number[]> {
  const r = await bridge.call<{ value: string | null }>("device.store.get", { key });
  const was = "ok" in r ? r.ok?.value : null;
  const days = rememberDay(readKeptDays(was), usd, dayOf(at));
  const value = JSON.stringify(days);
  if (value !== was) await bridge.call("device.store.set", { key, value });
  return seriesOf(days);
}
