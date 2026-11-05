// One way a waiting money sheet becomes a job (bug report, 5 Nov): Swap, Send,
// Add to Private, Private's way home, AgentZero's Add money. The sheet's own checks run first (they stay before this);
// then the job's row is made (startJob: Home, Activity, the bell's one pulse) and the sheet says "Job created.":
//  - from a hot wallet (no Face ID): at the tap;
//  - from the Safe: on the yes of this call's own Face ID sheet (onOwnApproval: opened after the call began), or on the
//    core's answer when no such yes is heard (the phone's own chip sheet, a Send's two sheets: never above an unanswered
//    Face ID, QA's SHOULD 2). A No makes nothing.
// A second job on the same money while the first's call hasn't answered is refused before any call (`claim`); after the
// answer the core's own guards hold it (trade.float.taken, a Send's reserved share). Trade's buys and sells never come here.
import type { Problem } from "@zerofee/core/problem";
import { onApprovalAnswered, onApprovalOpened, sheetsHeard, type Opened } from "./approval-answered.ts";
import { startJob, type JobHandle } from "./job-start.ts";
import type { Tasks } from "./tasks.ts";

export type Answer<T> = { ok: T } | { problem: Problem };

/**
 * A job's own sheet (QA's SHOULD, 5 Nov): only the answer to the Face ID sheet that moves this call's money,
 * put up AFTER the call began, counts. A yes on an older sheet, another job's sheet, a hot key's one-tap sheet, or a
 * sheet that moves no money (the swap address's storage set-up before the Safe's real Approve: QA's k-trade3
 * lap, "Job created." 5 s to 1 min early) never makes this job; with no such yes heard, the job is made on the core's
 * answer. `anySheet`: every sheet of the call counts (a hot job's sheet steps its receipt aside); `opened`: one is up.
 * Subscribe right before the core call; stop when it answers. With one Safe job in flight at a time (claim "safe"), the
 * only money sheet opened in that window is this call's.
 */
export const movesMoney = (w: Opened["words"]): boolean => !w.tap && !!w.amount;
export function onOwnApproval(listener: (approved: boolean) => void, o: { opened?: () => void; anySheet?: boolean } = {}): () => void {
  const mine = new Set<string>();
  const off1 = onApprovalOpened((p) => { if (o.anySheet || movesMoney(p.words)) { mine.add(p.id); o.opened?.(); } });
  const off2 = onApprovalAnswered((yes, id) => { if (id && mine.has(id)) listener(yes); });
  return () => { off1(); off2(); };
}

/** Money that has a job's call in flight ("safe", "row:sol", "private", "agent"). */
const inFlight = new Set<string>();
/** Takes every key or none: the release, or null while any is taken. */
export function claim(keys: readonly string[]): (() => void) | null {
  if (keys.some((k) => inFlight.has(k))) return null;
  for (const k of keys) inFlight.add(k);
  let done = false;
  return () => { if (done) return; done = true; for (const k of keys) inFlight.delete(k); };
}

/** Refused before anything is saved: another job's call on this money hasn't answered yet (copywriter, 5 Nov). */
export const jobTaken = (): Problem => ({
  code: "shell.job.taken",
  whatHappened: "Another job is using this money. Nothing moved. Try again once it's signed.",
  money: { state: "safe", where: "where it was" },
  next: { kind: "retry", label: "Try again" },
});

export type JobEnd<T> =
  /** The core said yes: the caller hands the row its ids (job.made) */
  | { job: JobHandle; ok: T }
  /** Refused after the job existed: its row already says why */
  | { job: JobHandle; problem: Problem }
  /** Refused before any job (or the money was taken): the sheet's own Problem, as before */
  | { refused: Problem }
  /** The person said No: nothing made (`after`: a hot job's row was made at the tap and is gone again) */
  | { declined: true; after: boolean };

export interface JobRun<T> {
  tasks: Tasks | undefined;
  title: string;
  usd?: string;
  /** How long the protocol takes (its quote, or the route's measured time): the row counts down from the tap. */
  etaSec?: number;
  /** From the Safe: made at the tap all the same (rule 2); a No or a refusal before its yes takes the job away. */
  safe: boolean;
  /** A Send from the Safe (its sheets can be two): kept for callers; made at the tap like every job (rule 2). */
  onAnswer?: boolean;
  /** The money it uses (claim): "safe" for every Safe job. */
  money: readonly string[];
  call: () => Promise<Answer<T>>;
  /** A No on a sheet, as this call says it. */
  declined: (r: Answer<T>) => boolean;
  /** The job exists: the sheet says "Job created." */
  made: () => void;
  /** A refusal's words for the row (the Problem's own by default). */
  words?: (p: Problem) => string;
  /** One of this call's sheets is up (true) or answered (false): the sheet steps aside meanwhile (D143), so "Job
   *  created." never sits over an unanswered sheet (a hot wallet's send past its cap asks Face ID). */
  asking?: (on: boolean) => void;
  /** This call's approve sheet is drawn and heard here (QA's MUST, Sim test): the person is asked first and
   *  the job is made on its yes, "Job created." once, never under or before the sheet. Default: a Safe job where the
   *  shell hears the Safe's sheet (the web, the Sim); on the iPhone (Swift's own Face ID) it is made at the tap. */
  asks?: boolean;
  /** Tests: the approval stream (onOwnApproval by default). */
  onApproval?: typeof onOwnApproval;
}

export async function runJob<T>(a: JobRun<T>): Promise<JobEnd<T>> {
  const release = claim(a.money);
  if (!release) return { refused: jobTaken() };
  let job: JobHandle | null = null;
  const make = () => { if (job) return; job = startJob(a.tasks, { ...(a.safe ? { approve: true } : {}), title: a.title, ...(a.usd ? { usd: a.usd } : {}), ...(a.etaSec ? { etaSec: a.etaSec } : {}) }); a.made(); };
  // rule 2 (5 Nov: every tap shows "Job created." in under 100 ms): made at the tap when no sheet of
  // ours comes first (a hot wallet in its session; the Safe on the iPhone, whose Face ID is Swift's own sheet the shell
  // never hears). QA's MUST (Sim test): where the sheet IS ours (the web's "Check this"), it comes first and
  // the job is made on its yes, at once; never "Job created." -> sheet -> "Job created." again. The Safe still asks on
  // every signature; a No, or a refusal before any yes, makes nothing (or takes the tap's job away) and the sheet is as it was
  const asks = a.asks ?? (a.safe && sheetsHeard("safe"));
  if (!asks) make();
  const own = a.onApproval ?? onOwnApproval;
  let yes = false;
  // the Safe: its yes is heard where the shell hears it (made then, if not at the tap); a later sheet of the same call
  // steps the receipt aside until answered. A hot wallet: its sheet (if one comes) steps it aside, its yes makes it
  const stop = a.safe
    ? own((said) => { a.asking?.(false); if (said) { yes = true; make(); (job as JobHandle | null)?.approved(); } }, { opened: () => { if (job) a.asking?.(true); } })
    : own((said) => { a.asking?.(false); if (said && asks) make(); }, { anySheet: true, opened: () => a.asking?.(true) });
  let r: Answer<T>;
  try { r = await a.call(); }
  catch { r = { problem: { code: "shell.job.lost", whatHappened: "No answer came back. Activity shows if it went.", money: { state: "needs-you", where: "where it was" }, next: { kind: "open", label: "Open Activity", screen: "wallet/activity" } } }; }
  finally { stop(); release(); a.asking?.(false); }
  const made = job as JobHandle | null;
  if (a.declined(r)) { made?.gone(); return { declined: true, after: !!made }; }
  if ("problem" in r) {
    // the Safe refused before any yes: nothing was asked of it yet, so nothing is listed; the sheet's own Problem
    if (made && a.safe && !yes) { made.gone(); return { refused: r.problem }; }
    if (made) { made.failed((a.words ?? ((p: Problem) => p.whatHappened))(r.problem)); return { job: made, problem: r.problem }; }
    return { refused: r.problem };
  }
  make();
  return { job: job as unknown as JobHandle, ok: r.ok };
}
