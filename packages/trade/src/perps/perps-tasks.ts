// D144, the Activity centre: perps' own tasks (app "perps"), as pure mappers. Put money in, Take out, Use it for trades,
// Turn on, Turn off: each step said as it stands, ended with the source's own accepted outcome or its Problem's line.
// Dollars only in the title; never an address or a key.
import type { TaskInput, TaskStep } from "@zerofee/shell-api/tasks.ts";

export type PerpsJob = "in" | "out" | "use" | "on" | "off";
const LABELS: Record<PerpsJob, readonly [string, ...string[]]> = {
  in: ["Left Trading", "Sent to Hyperliquid"],
  out: ["Left Hyperliquid", "Sent to Trading"],
  use: ["Moved into trading on Hyperliquid"],
  on: ["Approved on this phone", "Hyperliquid checked it"],
  off: ["Stopped the trading key", "Hyperliquid confirmed it"],
};
const TITLE = (job: PerpsJob, usd?: number) => {
  const $ = usd !== undefined && Number.isFinite(usd) ? `$${usd.toFixed(2)} ` : "";
  return job === "in" ? `Put ${$ || "money "}in perps` : job === "out" ? `Take ${$ || "money "}out of perps` : job === "use" ? "Use money for trades" : job === "on" ? "Turn on perps" : "Turn off perps";
};
export const DONE_LINE: Record<PerpsJob, string> = {
  in: "On its way to Hyperliquid. Tap Use it for trades when it's there.",
  out: "On its way to Trading. About a minute.",
  use: "It's ready for trades.",
  on: "Perps are on.",
  off: "Perps are off on Hyperliquid.",
};

/** The task as it starts: the first step doing, the rest waiting. */
export function perpsTask(job: PerpsJob, at: number, usd?: number): TaskInput {
  const steps: TaskStep[] = LABELS[job].map((label, i) => ({ label, state: i === 0 ? "doing" : "waiting" }));
  return { app: "perps", id: `perps-${job}-${at}`, title: TITLE(job, usd), steps, startedAt: at, open: { route: "perps" } };
}
/** How it ended: every step done, or the step under way failed. */
export function perpsSteps(job: PerpsJob, ok: boolean, at: number): TaskStep[] {
  return LABELS[job].map((label, i) => (ok ? { label, state: "done", ...(i === LABELS[job].length - 1 ? { at } : {}) } : { label, state: i === 0 ? "failed" : "waiting" }));
}
