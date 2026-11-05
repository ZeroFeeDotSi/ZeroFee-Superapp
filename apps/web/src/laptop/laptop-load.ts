// The laptop page's first load (product decision, 5 Nov: laptop.zerofee.si "shows nothing"): the laptop's key and its account list
// come from its own core, which reads NEAR. A read that never answers must not leave a bare spinning mark: past
// LOAD_DEADLINE_MS the page says what failed, by name, with Try again (rule 8). Its own module, free of the core, so a
// test can hold it without a browser.
import type { BridgeResult } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
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
