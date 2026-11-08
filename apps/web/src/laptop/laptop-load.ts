// The laptop page's first load (product decision, 5 Nov: laptop.zerofee.si "shows nothing"): the laptop's key and its account list
// come from its own core, which reads NEAR. A read that never answers must not leave a bare spinning mark: past
// LOAD_DEADLINE_MS the page says what failed, by name, with Try again (rule 8). Its own module, free of the core, so a
// test can hold it without a browser.
import type { BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import { shortTime } from "@zerofee/core/clock";
import { LAPTOP_START } from "../unlock/laptop-lock-words.ts";

/** How long the laptop's key and its accounts may take to load before the page says so. */
export const LOAD_DEADLINE_MS = 15_000;

/** NEAR didn't answer in time: the laptop holds no money, so none is involved; Try again reads again. */
export const LOAD_LATE: Problem = { code: "shell.laptop.load-late", whatHappened: LAPTOP_START.late, money: { state: "not-involved" }, next: { kind: "retry", label: "Try again" } };

/** The core's answer, or LOAD_LATE once `ms` pass without one. */
export function withinDeadline<T>(call: () => Promise<BridgeResult<T>>, ms = LOAD_DEADLINE_MS): Promise<BridgeResult<T>> {
  let late: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([call(), new Promise<BridgeResult<T>>((r) => (late = setTimeout(() => r({ problem: LOAD_LATE }), ms)))]).finally(() => clearTimeout(late));
}

/**
 * Audit 15 FL3 (rule 9a, keep the last state with its time): what a poll's answer does to the page. The first load's
 * failure is the page's Problem (there is nothing to keep); once the page has shown its state, a NEAR blip keeps the
 * Guarding list, the waiting requests and an open approval sheet, and says one line with the last read's time.
 */
export function pollOutcome<T>(res: BridgeResult<T>, shown: boolean): { ok: T } | { problem: Problem } | { late: true } {
  if (!("problem" in res)) return { ok: res.ok };
  return shown ? { late: true } : { problem: res.problem };
}

/** The kept page's line while NEAR doesn't answer: what is down, that it checks by itself, and when it last read. */
export const keptLines = (lastReadMs: number, locale?: string): [string, string] => [LAPTOP_START.stale, `As of ${shortTime(lastReadMs, locale)}`];
