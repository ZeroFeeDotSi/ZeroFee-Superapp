// The job is made (bug report, 5 Nov): the sheet becomes the design's one-object receipt, "away" (it grows at once; no
// ring, no tick: those say landed, and only the chain can), "Job created.", what happened to the person (copy review, 7 Nov), the
// protocol by name, its time and Done. It stays until the person closes it. Swap, Send, Add to Private, Private's way home (Move and site top-ups draw their own, the same).
import { useEffect, useState, type ReactNode } from "react";
import { MoneySheet } from "@zerofee/design/MoneySheet.tsx";
import { mark } from "@zerofee/design/tap.ts";
import { JOB_WORDS, jobRows, watchShown } from "@zerofee/shell-api/job-start.ts";
import { jobEndsAt, landedOf, onSecond, receiptLeft, receiptStateOf, type ReceiptState } from "@zerofee/shell-api/job-steps.ts";
import { receiptSaid } from "./receipt-said.ts";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import { jobStepsOf, type RowStep } from "./job-row-steps.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";
import "@zerofee/design/receipt.css";

/** Every job here goes through NEAR Confidential (rule: name the protocol; never "privately", audit H1). */
export const THROUGH_CONFIDENTIAL = "It goes through NEAR Confidential.";
/** M12-1 (8 Nov): the same line once its job landed, in the past ("Done." over "It goes" read as still going; "there" keeps it at grade 5, audit 13). */
export const WENT_CONFIDENTIAL = "It went there through NEAR Confidential.";
/** The time left under "Job created.", counting down from the protocol's own estimate (`etaSec`: its quote, or the
 *  route's measured time), or that there is none (product decision, 5 Nov; QA's Jobs hunt B3). Its job landed
 *  (the rows made since it opened, all done in the shared task store): how long it took ("Done in under a second."), and
 *  the clock stops (the copy review's rule, 5 Nov; words 7 Nov). `follow` false: a row's own time (Home's money on its way), no job of its own to follow. */
// `endsAt`: the job's own end (Hot's moving rows: from its legs, live-steps onLegs), else `etaSec` from now. With neither,
// no line at all: "This job has no time estimate." never reaches the screen (a test of Hot, 5 Nov).
// `watch`: also the receipt's "You can close this. It keeps going." under the time, while the job is still going.
// `line` (a16): the line around the time (Hot's moving row: "On its way · About 29 s left."); the receipt's is bare.
// `job`: the job's id (runJob's made, startJob's handle): it landed when ITS rows did (jobRows), never another job's;
// none, the rows started since it opened (job-steps.ts receiptRows' fallback).
// `doneAt` (audit 13's D1): when the job's own sheet read it landed another way (Move's legs off Activity), so its clock
// stops there too and says "Took 6 s." under "Done.", never a time left.
export function TimeLeft({ etaSec, endsAt: own, follow = true, watch = false, line, job, doneAt }: { etaSec?: number | undefined; endsAt?: number | undefined; follow?: boolean; watch?: boolean; line?: (time: string) => string; job?: string | null | undefined; doneAt?: number | undefined }) {
  const [startMs] = useState(() => Date.now());
  const [fromNow] = useState(() => (etaSec && etaSec > 0 ? startMs + etaSec * 1000 : undefined));
  // one clock with the Jobs row (QA 16's MUST, 8 Nov): the job's own rows' end (jobEndsAt), the time the row counts down to
  const [rowEnds, setRowEnds] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!follow || !job) return;
    const s = taskStore();
    const mine = jobRows(job);
    const read = () => setRowEnds(jobEndsAt(s.list(), mine));
    read();
    return s.subscribe(read);
  }, [follow, job]);
  const endsAt = own !== undefined && Number.isFinite(own) ? own : rowEnds ?? fromNow;
  const [now, setNow] = useState(() => Date.now());
  const [landed, setLanded] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!follow || endsAt === undefined) return;
    const s = taskStore();
    const mine = job ? jobRows(job) : undefined;
    const read = () => setLanded(landedOf(s.list(), startMs, mine));
    read();
    return s.subscribe(read);
  }, [follow, endsAt, startMs, job]);
  useEffect(() => {
    if (endsAt === undefined || landed !== undefined) return;
    // on the second, as the Jobs row is (onSecond): one figure on both
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); t = setTimeout(tick, onSecond(1000, Date.now())); };
    t = setTimeout(tick, onSecond(1000, Date.now()));
    return () => clearTimeout(t);
  }, [endsAt, landed]);
  const watchLine = watch && watchShown(landed ?? doneAt) ? <p className="zf-receipt__line" data-testid="job-watch">{JOB_WORDS.watch}</p> : null;
  // one clock with the Jobs row (QA 16, 8 Nov): from the job's own start, its Approve when it had one (job-start.ts sets
  // the row's startedAt there), never when this receipt opened
  const begun = job ? carried(job)?.from ?? taskStore().list().find((r) => r.id === job)?.startedAt : undefined;
  const from = typeof begun === "number" && Number.isFinite(begun) ? begun : startMs;
  if (endsAt === undefined) return watchLine;
  const time = receiptLeft(endsAt, now, from, landed ?? doneAt);
  return <><p className="zf-receipt__line" data-testid="job-time-left">{line ? line(time) : time}</p>{watchLine}</>;
}

/** The receipt's job as its rows say, followed in the shared task store (`on` false: none): `job`'s own rows (jobRows);
 *  no job id, the rows started since the receipt opened (receiptRows' fallback). */
export function useReceiptState(on = true, job?: string | null): ReceiptState {
  const [startMs] = useState(() => Date.now());
  const [state, setState] = useState<ReceiptState>({ state: "going" });
  useEffect(() => {
    if (!on) return;
    const s = taskStore();
    const mine = job ? jobRows(job) : undefined;
    const read = () => setState(receiptStateOf(s.list(), startMs, mine));
    read();
    return s.subscribe(read);
  }, [on, startMs, job]);
  return state;
}
/** A receipt's what-happened line in its tense (the receipts that draw their own: a site's Add). */
export function SaidLine({ going, landed, testid, job }: { going: string; landed: string; testid: string; job?: string | null }) {
  const state = useReceiptState(true, job);
  return <p className="zf-receipt__line" data-testid={testid}>{receiptSaid({ going, landed }, state)}</p>;
}

/** The receipt and its Done, inside a sheet the caller draws. `said`: what happened to the person, under "Job created.",
 *  from the job's own figures (receipt-said.ts: "Sent $25.00 to bob.near.", 53, 7 Nov). `through`: the protocol's line;
 *  null for a job whose route isn't NEAR Confidential's (a NEAR wallet move: never say a protocol that doesn't do the
 *  work, rule 10). */
/** `paidLine`: the W1 line (job-start receiptPrivate) when Private pays the job whole, so no Face ID came. */
/** `landedSaid`: the line once the job landed, its rows all ended done by their chain reads (receiptStateOf): "Sent $25.00
 *  to bob.near." after "Sending …", Swap's "swapped: …" after "Swapping …" (the copy review's J5); stopped, `said` and its stop words
 *  (receiptSaid, QA's MUST). */
/** Audit 18's I2 (builder 22): the job's own rows' steps (job-row-steps.ts), read again on every change of the store;
 *  the first frame has them (read at mount, never an empty list first). */
export function useJobSteps(job: string | null | undefined): RowStep[] {
  const [steps, setSteps] = useState<RowStep[]>(() => jobStepsOf(taskStore().list(), job));
  useEffect(() => {
    const s = taskStore();
    const read = () => setSteps(jobStepsOf(s.list(), job));
    read();
    return s.subscribe(read);
  }, [job]);
  return steps;
}
export function JobRowSteps({ job, testid = "job-steps" }: { job: string | null | undefined; testid?: string }) {
  const steps = useJobSteps(job);
  return steps.length ? <ol className="nc-steps" data-testid={testid}>{steps.map((x) => <li key={x.key} className="zf-receipt__line" data-state={x.state}>{x.label}</li>)}</ol> : null;
}

/** `steps` (builder 15): the job's own steps under the protocol's line (Trade's Safe Buy and Sell: into Private, the swap, back). */
export function JobReceipt({ amount, icon, testid, etaSec, said, landedSaid, through = THROUGH_CONFIDENTIAL, paidLine = null, job, steps, onDone }: { amount: string; icon: ReactNode; testid: string; etaSec?: number | undefined; said?: string | null | undefined; landedSaid?: string | null | undefined; through?: string | null; paidLine?: string | null; job?: string | null | undefined; steps?: ReactNode; onDone: () => void }) {
  useEffect(() => { mark("away"); }, []);
  // M12-1 (8 Nov): the head follows the job too: "Done." once every row of it landed, else "Job created."
  const state = useReceiptState(true, job);
  const line = said ? receiptSaid({ going: said, landed: landedSaid ?? said }, state) : null;
  const landed = state.state === "landed";
  return (
    <>
      <div className="zf-receipt zf-receipt--job" data-state="away" role="status" aria-live="polite" data-testid={testid}>
        <div className="zf-receipt__obj">
          <svg className="zf-receipt__ring" viewBox="0 0 128 128" aria-hidden="true"><circle cx="64" cy="64" r="62" pathLength="1" /></svg>
          <div className="zf-receipt__coin"><span className="zf-receipt__disc">{icon}</span></div>
        </div>
        <p className="zf-receipt__amount">{amount}</p>
        <p className="zf-receipt__head" data-testid={`${testid}-head`}>{landed ? JOB_WORDS.landed : JOB_WORDS.created}</p>
        {line && <p className="zf-receipt__line" data-testid={`${testid}-said`}>{line}</p>}
        {through && <p className="zf-receipt__line" data-testid={`${testid}-through`}>{landed && through === THROUGH_CONFIDENTIAL ? WENT_CONFIDENTIAL : through}</p>}
        {steps}
        <TimeLeft etaSec={etaSec} watch job={job} />
        {paidLine && <p className="zf-receipt__line" data-testid={`${testid}-from-private`}>{paidLine}</p>}
      </div>
      <button className="zf-btn wl-sheet-go" onClick={onDone} data-testid={`${testid}-done`}>Done</button>
    </>
  );
}

/** `away`: one of the job's own sheets is up (a hot wallet's send past its cap): the sheet steps aside meanwhile. */
export function JobMade({ title, amount, icon, testid, away = false, etaSec, said, through, job, onDone }: { title: string; amount: string; icon: ReactNode; testid: string; away?: boolean; etaSec?: number; said?: string | null; through?: string | null; job?: string | null; onDone: () => void }) {
  return (
    <MoneySheet title={title} away={away} onClose={onDone}>
      <JobReceipt amount={amount} icon={icon} testid={testid} etaSec={etaSec} said={said} {...(through !== undefined ? { through } : {})} job={job} onDone={onDone} />
    </MoneySheet>
  );
}
