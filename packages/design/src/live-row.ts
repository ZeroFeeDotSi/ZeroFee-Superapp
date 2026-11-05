// What a LiveRow (LiveRow.tsx) shows, as plain logic (tested in node, no DOM).

/** going: under way · slow: under way, slower than usual · done · stopped · back: the money came back · past: a finished
 *  row in a history list (no progress line). */
export type LiveRowState = "going" | "slow" | "done" | "stopped" | "back" | "past";

/** How far along, 0..1: the steps done, plus half of one under way, over all of them; never under .08 while it runs. */
export function progressOf(steps: readonly { state: string }[], ended = false): number {
  if (ended || steps.length === 0) return ended ? 1 : 0.08;
  const done = steps.filter((s) => s.state === "done").length;
  const doing = steps.some((s) => s.state === "doing") ? 0.5 : 0;
  return Math.min(1, Math.max(0.08, (done + doing) / steps.length));
}
