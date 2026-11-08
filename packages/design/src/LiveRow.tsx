// The one row for anything on its way or just finished (ACTIVITY-MOTION, 4 Nov): Home's "Now", the Activity centre,
// AgentZero's jobs. Built like Home's coin rows: a mark, a title, one line under it, the dollars on the right. Its bottom
// hairline is its progress line. Done, Stopped and Came back are a badge on the mark and a past-tense title.
// Any list of rows that open something uses it for its press (Trade's Discover coins, 5 Nov): their own words and figures
// go in its slots as they are (a coin's age chip, its price's glint, its coloured change).
import type { CSSProperties, ReactNode, Ref } from "react";
import "./liverow.css";
import { Checkpoints } from "./Checkpoints.tsx";
import { checkpointLabel, type CheckpointKind } from "./checkpoints.ts";
export { progressOf, timeSlot } from "./live-row.ts";

import type { LiveRowState } from "./live-row.ts";
export type { LiveRowState } from "./live-row.ts";

const Badge = ({ state }: { state: LiveRowState }) => (
  <span className="zf-lrow__badge">
    {state === "done" && <svg viewBox="0 0 10 10"><path d="M2 5.2l2 2L8 3" /></svg>}
    {state === "stopped" && <svg viewBox="0 0 10 10"><path d="M5 2.2v3.4M5 7.6v.2" /></svg>}
    {state === "ended" && <svg viewBox="0 0 10 10"><path d="M3.2 3.2h3.6v3.6H3.2z" /></svg>}
    {state === "back" && <svg viewBox="0 0 10 10"><path d="M4 2.5L2 4.5l2 2M2.2 4.5H6a2 2 0 010 4H5" /></svg>}
  </span>
);

export function LiveRow({ mark, title, line, below, usd, when, state, p, track, onOpen, label, rowRef, className, style, onPointerDown }: {
  /** The coin's logo or the app's glyph. */
  mark: ReactNode;
  title: ReactNode;
  /** The one line under the title: the step and how long ("Making it private · 2 min"), or where the money is. */
  line?: ReactNode;
  /** A second line under it (timeSlot: a going row's time, past its estimate). */
  below?: ReactNode;
  usd?: ReactNode;
  /** The right column's second line ("2 h"). */
  when?: ReactNode;
  state: LiveRowState;
  /** Progress, 0..1 (progressOf). Only a row with progress draws its line: a finished row in a list has none. */
  p?: number;
  /** A going job's four checkpoints (the copy review's spec, 6 Nov), in place of the progress line: its kind and the current one
   *  (checkpointAt). Never on an ended row. The row's label gains "step 2 of 4, Swapping". */
  track?: { kind: CheckpointKind; at: number };
  onOpen?: () => void;
  /** The whole row in words, for screen readers. */
  label?: string;
  /** A list's own hooks on the row: its ref (seen on screen), a class (its rise in), its style, the finger's first touch. */
  rowRef?: Ref<HTMLButtonElement>;
  className?: string;
  style?: CSSProperties;
  onPointerDown?: () => void;
}) {
  const cp = track && (state === "going" || state === "slow") ? track : undefined;
  const said = cp && label ? `${label}, ${checkpointLabel(cp.kind, Math.max(0, Math.min(3, Math.round(cp.at))))}` : label;
  return (
    <button ref={rowRef} type="button" className={`zf-lrow is-${state}${cp ? " has-track" : ""}${className ? ` ${className}` : ""}`} style={style} onClick={onOpen} onPointerDown={onPointerDown} aria-label={said}>
      <span className="zf-lrow__mark" aria-hidden="true">{mark}<Badge state={state} /></span>
      <span className="zf-lrow__text">
        <span className="zf-lrow__t">{title}</span>
        {line && <span className="zf-lrow__d">{line}</span>}
        {below && <span className="zf-lrow__d">{below}</span>}
      </span>
      {(usd || when) && (
        <span className="zf-lrow__r">
          {usd && <span className="zf-lrow__v">{usd}</span>}
          {when && <span className="zf-lrow__w">{when}</span>}
        </span>
      )}
      {cp && <Checkpoints className="zf-lrow__cp" kind={cp.kind} at={cp.at} />}
      {!cp && p !== undefined && (
        <span className="zf-lrow__line" aria-hidden="true">
          <span className="zf-lrow__fill" style={{ "--p": p } as CSSProperties}><span className="zf-lrow__flow" /></span>
        </span>
      )}
    </button>
  );
}
