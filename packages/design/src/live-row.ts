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

/** Where a going row's time goes (real-tap proof, 6 Nov, 390 wide): "8 s left" fits the right column; words past the estimate
 *  ("Slower than usual.") would cut the step beside them, so they get their own line under it. */
export const timeSlot = (time: string | undefined): { when?: string; below?: string } => (!time ? {} : /\bleft$/.test(time) ? { when: time } : { below: time });
