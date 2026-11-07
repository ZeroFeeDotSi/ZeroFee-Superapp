// A going job's checkpoint track (the copy review's spec, 6 Nov): four dots on a hairline, the done part filled in --up, a label under
// each. Activity's Now, Home's Jobs and Trade's going row draw it inside LiveRow; the job page draws it full width (Part 2,
// `bad`: the dot where it stopped). Not a control: aria-hidden; the row's own label says the step (checkpointLabel).
import type { CSSProperties } from "react";
import "./checkpoints.css";
import { CHECKPOINT_WORDS, checkpointFill, dotsOf, type CheckpointKind } from "./checkpoints.ts";
export { CHECKPOINT_WORDS, checkpointAt, checkpointFill, checkpointKind, checkpointLabel, dotsOf, type CheckpointAt, type CheckpointKind, type DotState } from "./checkpoints.ts";

export function Checkpoints({ kind, at, bad = false, className }: {
  /** The job's kind: its four words (CHECKPOINT_WORDS). */
  kind: CheckpointKind;
  /** The current checkpoint, 0..3 (checkpointAt from the job's steps); -1: nothing lit, every dot hollow (a job page whose
   *  Safe sheet is open, 53, 7 Nov). */
  at: number;
  /** Stopped at `at`: that dot --bad, the fill only to the last done dot (Part 2). */
  bad?: boolean;
  className?: string;
}) {
  const i = Math.max(-1, Math.min(3, Math.round(at)));
  const words = CHECKPOINT_WORDS[kind];
  return (
    <span className={`zf-cp${bad ? " is-bad" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true" data-at={i}>
      <span className="zf-cp__fill" style={{ "--cp": checkpointFill(bad ? Math.max(0, i - 1) : i) } as CSSProperties} />
      {dotsOf(i, bad).map((s, k) => (
        <span key={k} className={`zf-cp__pt is-${s}`}><i /><b>{words[k]}</b></span>
      ))}
    </span>
  );
}
