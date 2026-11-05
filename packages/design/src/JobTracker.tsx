// The one tracker for every job (product decision, 5 Nov: every Move, Swap, Send, Add, Private, site top-up, AgentZero
// Add money and Trade shows ALL its steps in one clean design; $ZEROFEE_HOME/JOB-TRACKER-SPEC-2026-11-05.md). Lifted from
// the wallet's LiveTrack tracker (D137) on to the Receipt: ONE object on top (ReceiptMark: the coin, its ring and badge,
// the Receipt's four states), the steps as hairline rows (waiting → doing → done | failed, each with the engine's own
// time), one status line (the row's one-liner: "<Party> is <doing what> · <elapsed>"), the end line (where the money is),
// and the lit verb only when there is one (Done once landed; Try again once refused). The job's state turns "landed" only
// when the LAST step's own answer is in (QA: never before the chain). The words come from the caller: this draws.
// A crawl's clock (QA): the job's state leaves the Receipt's marks (tap.ts), each step `step:<key>:<state>`.
import { useEffect, useRef } from "react";
import { ReceiptMark } from "./Receipt.tsx";
import { CoinIcon } from "./CoinIcon.tsx";
import type { ReceiptState } from "./receipt.ts";
import { mark } from "./tap.ts";
import { markStep, stepTime, type JobProof, type JobStep, type JobStepState } from "./job-steps.ts";
import "./job-tracker.css";
export { markStep, stepTime, type JobProof, type JobStep, type JobStepState } from "./job-steps.ts";

/** A step's mark: the hollow dot while waiting, the live dot while being done (the screen's only moving thing), the tick
 *  with its time once done, the cross where it stopped. */
function StepMark({ state }: { state: JobStepState }) {
  if (state === "done") return <svg className="zf-job__mark is-done" viewBox="0 0 16 16" aria-hidden="true"><path className="zf-draw" pathLength={1} d="M3.5 8.5l3 3 6-7" /></svg>;
  if (state === "doing") return <span className="zf-job__mark is-doing" aria-hidden="true"><span className="zf-live" /></span>;
  if (state === "failed") return <svg className="zf-job__mark is-failed" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  return <span className="zf-job__mark is-waiting" aria-hidden="true" />;
}

export function JobTracker({ title, state, coin, steps, line, end, proof, onProof, onDone, onAgain, size = "page" }: {
  /** What was asked, the person's figure, said once: "Move $5.00". */
  title: string;
  /** The job's state (the Receipt's): away while any step is open; landed only on the last step's own answer. */
  state: ReceiptState;
  /** The coin that moves (drawn here at the mark's own size), never a chain's logo. */
  coin: { symbol: string; icon?: string; src?: string };
  /** 1–5 steps, every one a place or a party, in order. */
  steps: readonly JobStep[];
  /** The one-liner: "NEAR Intents is moving it to Solana · 41 s"; the same words as the Home row's line. */
  line: string;
  /** The end: where the money is ("In your SOL wallet."), or where it stopped and where the money is now. */
  end?: { ok: boolean; line: string };
  /** The chain's own record, under Copy · View (the Activity row's). */
  proof?: readonly JobProof[];
  onProof?: (p: JobProof, what: "copy" | "view") => void;
  /** The lit verb: Done once landed or checking; Try again once refused (when the flow has one). None while away. */
  onDone?: () => void;
  onAgain?: () => void;
  /** "page": the whole screen (the Receipt's 128 object); "row": inside a sheet or a thread (ReceiptMark 48). */
  size?: "page" | "row";
}) {
  // the crawl's clock: the job's state as the Receipt's marks, each step once per state
  useEffect(() => { mark(state); }, [state]);
  const seen = useRef<Record<string, JobStepState>>({});
  useEffect(() => {
    for (const s of steps) { if (seen.current[s.key] !== s.state) { seen.current[s.key] = s.state; markStep(s.key, s.state); } }
  }, [steps]);
  const over = state === "landed" || state === "refused" || state === "checking";
  const ring = size === "page" ? 128 : 48;
  return (
    <div className={`zf-job zf-job--${size}`} data-state={state} role="status" aria-live="polite">
      <div className="zf-job__head">
        <ReceiptMark state={state} icon={<CoinIcon symbol={coin.symbol} icon={coin.icon} src={coin.src} size={Math.round(ring * 0.54)} />} size={ring} />
        <div className="zf-job__words">
          <p className="zf-job__title">{title}</p>
          <p className="zf-job__line">{state === "away" && <span className="zf-live" aria-hidden="true" />}{line}</p>
        </div>
      </div>
      <ol className="zf-job__steps">
        {steps.map((s) => (
          <li key={s.key} className={`zf-job__step is-${s.state}`} data-step={s.key}>
            <StepMark state={s.state} />
            <span className="zf-job__label">{s.label}</span>
            <span className="zf-job__time">{s.state === "done" && s.atMs !== undefined ? stepTime(s.atMs) : ""}</span>
          </li>
        ))}
      </ol>
      {end && <p className={`zf-job__end${end.ok ? "" : " is-bad"}`}>{end.line}</p>}
      {proof && proof.length > 0 && onProof && (
        <div className="zf-job__proof">
          {proof.map((p) => (
            <span key={`${p.chain}:${p.hash}`} className="zf-job__proof-row">
              <button type="button" className="zf-link" onClick={() => onProof(p, "copy")}>Copy</button>
              <button type="button" className="zf-link" onClick={() => onProof(p, "view")}>View</button>
            </span>
          ))}
        </div>
      )}
      {over && (onDone || onAgain) && (
        <div className="zf-job__floor">
          {state === "refused" && onAgain && <button type="button" className="zf-btn" onClick={onAgain}>Try again</button>}
          {state === "refused" && onDone && <button type="button" className={`zf-btn${onAgain ? " zf-btn--quiet" : ""}`} onClick={onDone}>{onAgain ? "Close" : "Done"}</button>}
          {state !== "refused" && onDone && <button type="button" className="zf-btn" onClick={onDone}>Done</button>}
        </div>
      )}
    </div>
  );
}
