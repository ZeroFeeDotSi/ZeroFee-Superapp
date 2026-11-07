// A going job's four checkpoints (the copy review's spec, 6 Nov, Part 1; Checkpoints.tsx draws them): one table of words by the job's
// kind, the step under way folded to one of four, and the fill to it. Plain logic, tested in node (checkpoints.test.ts).

/** The job's kind, as the track names its working step. A top up is a move. */
export type CheckpointKind = "swap" | "send" | "move" | "buy" | "sell" | "agent" | "add";

/** The four words, ≤ 9 characters each; the working step never names a protocol (the step line above already does).
 *  `add` (money coming in from outside, nothing signed here): provisional, not in the copy review's table. "Sent" is never a checkpoint:
 *  it is an ended row's word; the fourth is always Done (copy review, 6 Nov). */
export const CHECKPOINT_WORDS: Readonly<Record<CheckpointKind, readonly [string, string, string, string]>> = {
  swap: ["Signed", "Swapping", "Landing", "Done"],
  send: ["Signed", "Sending", "Landing", "Done"],
  move: ["Signed", "Moving", "Landing", "Done"],
  buy: ["Signed", "Buying", "Landing", "Done"],
  sell: ["Signed", "Selling", "Landing", "Done"],
  agent: ["Signed", "Working", "Landing", "Done"],
  add: ["Received", "Adding", "Landing", "Done"],
};

/** The kind from what a row already knows: its app and its title's verb ("Swap $10.00 …", "Top up Private"). */
export function checkpointKind(t: { app?: string; kind?: string; title?: string }): CheckpointKind {
  if (t.kind && t.kind in CHECKPOINT_WORDS) return t.kind as CheckpointKind;
  if (t.app === "agentzero") return "agent";
  const verb = /^\s*(\w+)/.exec(t.title ?? "")?.[1]?.toLowerCase();
  if (verb === "swap" || verb === "send" || verb === "buy" || verb === "sell") return verb;
  if (verb === "add") return "add";
  return "move";
}

export type CheckpointAt = 0 | 1 | 2 | 3;

/** Which of the four is current, from the job's own steps (any count). Signed is lit only before the first leg starts
 *  (copy review, 6 Nov: a Send's "Leaving your Safe" lights Sending): any step begun is past it. The last step, once it is the one
 *  going, is Landing; every step before it the working step; all done is Done. A failed step is where it stopped. */
export function checkpointAt(steps: readonly { state: string }[], ended = false): CheckpointAt {
  const n = steps.length;
  const c = steps.findIndex((s) => s.state !== "done");
  if (ended || (n > 0 && c < 0)) return 3;
  if (n === 0 || steps.every((s) => s.state === "waiting")) return 0;
  if (c === n - 1 && n >= 2) return 2;
  return 1;
}

/** How far the fill runs, 0..1: from the first dot to the current one exactly (dots at 0, 1/3, 2/3, 1). */
export const checkpointFill = (at: number): number => Math.max(0, Math.min(3, Math.round(at))) / 3;

/** The row's words for a screen reader: "step 2 of 4, Swapping". */
export const checkpointLabel = (kind: CheckpointKind, at: number): string => `step ${at + 1} of 4, ${CHECKPOINT_WORDS[kind][at]}`;

/** Each dot's face: done (filled), now (ring and centre), bad (where it stopped, Part 2), or not yet (a ring). Past a bad dot
 *  nothing is lit. */
export type DotState = "done" | "now" | "bad" | "next";
export const dotsOf = (at: number, bad = false): DotState[] => [0, 1, 2, 3].map((i) => (i < at ? "done" : i === at ? (bad ? "bad" : "now") : "next"));
