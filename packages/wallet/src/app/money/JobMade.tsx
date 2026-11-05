// The job is made (bug report, 5 Nov): the sheet becomes the design's one-object receipt, "away" (it grows at once; no
// ring, no tick: those say landed, and only the chain can), "Job created." and where to watch it, and Done. It stays until
// the person closes it. Swap, Send, Add to Private, Private's way home (Move and site top-ups draw their own, the same).
import { useEffect, useState, type ReactNode } from "react";
import { MoneySheet } from "@zerofee/design/MoneySheet.tsx";
import { mark } from "@zerofee/design/tap.ts";
import { JOB_WORDS, watchShown } from "@zerofee/shell-api/job-start.ts";
import { landedOf, receiptLeft } from "@zerofee/shell-api/job-steps.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import "@zerofee/design/receipt.css";

/** Every job here goes through NEAR Confidential (rule: name the protocol; never "privately", audit H1). */
export const THROUGH_CONFIDENTIAL = "It goes through NEAR Confidential.";
/** The time left under "Job created.", counting down from the protocol's own estimate (`etaSec`: its quote, or the
 *  route's measured time), or that there is none (product decision, 5 Nov; QA's Jobs hunt B3). Its job landed
 *  (the rows made since it opened, all done in the shared task store): "Landed early." before the estimate, and the clock
 *  stops (the copy review's rule, 5 Nov). `follow` false: a row's own time (Home's money on its way), no job of its own to follow. */
// `endsAt`: the job's own end (Hot's moving rows: from its legs, live-steps onLegs), else `etaSec` from now. With neither,
// no line at all: "This job has no time estimate." never reaches the screen (a test of Hot, 5 Nov).
// `watch`: also the receipt's "You can close this. It keeps going." under the time, while the job is still going.
// `line` (a16): the line around the time (Hot's moving row: "On its way · About 29 s left."); the receipt's is bare.
export function TimeLeft({ etaSec, endsAt: own, follow = true, watch = false, line }: { etaSec?: number | undefined; endsAt?: number | undefined; follow?: boolean; watch?: boolean; line?: (time: string) => string }) {
  const [startMs] = useState(() => Date.now());
  const [fromNow] = useState(() => (etaSec && etaSec > 0 ? startMs + etaSec * 1000 : undefined));
  const endsAt = own !== undefined && Number.isFinite(own) ? own : fromNow;
  const [now, setNow] = useState(() => Date.now());
  const [landed, setLanded] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!follow || endsAt === undefined) return;
    const s = taskStore();
    const read = () => setLanded(landedOf(s.list(), startMs));
    read();
    return s.subscribe(read);
  }, [follow, endsAt, startMs]);
  useEffect(() => {
    if (endsAt === undefined || landed !== undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt, landed]);
  const watchLine = watch && watchShown(landed) ? <p className="zf-receipt__line" data-testid="job-watch">{JOB_WORDS.watch}</p> : null;
  if (endsAt === undefined) return watchLine;
  const time = receiptLeft(endsAt, now, startMs, landed);
  return <><p className="zf-receipt__line" data-testid="job-time-left">{line ? line(time) : time}</p>{watchLine}</>;
}

/** The receipt and its Done, inside a sheet the caller draws. `through`: the protocol's line; null for a job whose
 *  route isn't NEAR Confidential's (a NEAR wallet move: never say a protocol that doesn't do the work, rule 10). */
export function JobReceipt({ amount, icon, testid, etaSec, through = THROUGH_CONFIDENTIAL, onDone }: { amount: string; icon: ReactNode; testid: string; etaSec?: number; through?: string | null; onDone: () => void }) {
  useEffect(() => { mark("away"); }, []);
  return (
    <>
      <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid={testid}>
        <div className="zf-receipt__obj">
          <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
          <div className="zf-receipt__coin"><span className="zf-receipt__disc">{icon}</span></div>
        </div>
        <p className="zf-receipt__amount">{amount}</p>
        <p className="zf-receipt__head">{JOB_WORDS.created}</p>
        {through && <p className="zf-receipt__line" data-testid={`${testid}-through`}>{through}</p>}
        <TimeLeft etaSec={etaSec} watch />
      </div>
      <button className="zf-btn wl-sheet-go" onClick={onDone} data-testid={`${testid}-done`}>Done</button>
    </>
  );
}

/** `away`: one of the job's own sheets is up (a hot wallet's send past its cap): the sheet steps aside meanwhile. */
export function JobMade({ title, amount, icon, testid, away = false, etaSec, through, onDone }: { title: string; amount: string; icon: ReactNode; testid: string; away?: boolean; etaSec?: number; through?: string | null; onDone: () => void }) {
  return (
    <MoneySheet title={title} away={away} onClose={onDone}>
      <JobReceipt amount={amount} icon={icon} testid={testid} etaSec={etaSec} {...(through !== undefined ? { through } : {})} onDone={onDone} />
    </MoneySheet>
  );
}
