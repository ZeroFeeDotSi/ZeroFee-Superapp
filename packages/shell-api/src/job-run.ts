// One way a waiting money sheet becomes a job (bug report, 5 Nov): Swap, Send,
// Add to Private, Private's way home, AgentZero's Add money. The sheet's own checks run first (they stay before this);
// then the job's row is made (startJob: Home, Activity, the bell's one pulse) and the sheet says "Job created.":
//  - from a hot wallet (no Face ID): at the tap;
//  - from the Safe: "Check this" at the tap; made on the core's job.signed (its last signature, after the one Face ID,
//    before anything is sent: bug report, 6 Nov, the audit's c6), or on the core's answer when no signature came. A No or a
//    Close makes nothing.
// A second job on the same money while the first's call hasn't answered is refused before any call (`claim`); after the
// answer the core's own guards hold it (trade.float.taken, a Send's reserved share). Trade's buys and sells never come here.
import type { Problem } from "@zerofee/core/problem";
import { onApprovalAnswered, onApprovalAsked, onApprovalOpened, onPendingClosed, onSafeSigned, pendingSheet, refuseClosed, sheetsHeard, type Opened } from "./approval-answered.ts";
import { moneyClosed } from "@zerofee/core/money-closed";
import { JOB_WORDS, startJob, type JobHandle } from "./job-start.ts";
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
export function onOwnApproval(listener: (approved: boolean) => void, o: { opened?: (p: Opened) => void; anySheet?: boolean } = {}): () => void {
  const mine = new Set<string>();
  const off1 = onApprovalOpened((p) => { if (o.anySheet || movesMoney(p.words)) { mine.add(p.id); o.opened?.(p); } });
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

/** Each hot wallet's money id, as the sheets name that wallet (Home's rows: SOL, ETH (RH), BNB, NEAR). */
const HOT_WALLET: Readonly<Record<string, string>> = { "row:sol": "SOL", "row:hood": "Robinhood", "row:bsc": "BNB", "row:near": "NEAR" };
/**
 * The busy refusal's words, per the money asked for (the UI reviewer's ruling, 6 Nov): a hot wallet by its name, and "done",
 * since no one signs a hot wallet's job in its session; the Safe's own job (and any money that isn't a hot wallet's) "signed".
 */
export function takenLine(money: readonly string[]): string {
  const hot = money.includes("safe") ? undefined : money.find((m) => Object.hasOwn(HOT_WALLET, m));
  if (hot) return `Another job is using your ${HOT_WALLET[hot]} wallet's money, so nothing moved. Try again once that job is done.`;
  if (money.includes("private") && !money.includes("safe")) return "Another job is using Private's money, so nothing moved. Try again once that job is signed.";
  return "Another job is using this money, so nothing moved. Try again once that job is signed.";
}
/** Refused before anything is saved: another job's call on this money hasn't answered yet (copywriter, 5 Nov). */
export const jobTaken = (money: readonly string[] = ["safe"]): Problem => ({
  code: "shell.job.taken",
  whatHappened: takenLine(money),
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
  /** From the Safe: "Check this" at the tap (pendingSheet); made once its last signature is made (job.signed), or on the
   *  core's answer when none came; a No, a Close or a refusal before it makes nothing. */
  safe: boolean;
  /** A Send from the Safe (its sheets can be two): kept for callers; made at the tap like every job (rule 2). */
  onAnswer?: boolean;
  /** The money it uses (claim): "safe" for every Safe job. */
  money: readonly string[];
  call: () => Promise<Answer<T>>;
  /** A No on a sheet, as this call says it. */
  declined: (r: Answer<T>) => boolean;
  /** The job exists: the sheet says "Job created.", its receipt following this job's own rows (`job.id`: JobMade's `job`). */
  made: (job: JobHandle) => void;
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
  /** Tests: the core's job.signed stream (onSafeSigned by default). */
  onSigned?: typeof onSafeSigned;
  /** Private pays it whole (a hot key, no Face ID by design): its row says so (the copy review's W1). */
  fromPrivate?: boolean;
  /** The Getting-ready sheet's headline (the copy review's W2): the Safe's "Check this" at the tap. Default: the title. */
  headline?: string;
  /** the audit's (B), 7 Nov: a `fromPrivate` job's core asked the Safe after all (the page's prediction was wrong): the sheet takes
   *  back what it said of Private (its W1 line). */
  safeAsked?: () => void;
  /** The job's own key (its call's `key`, which the ledger puts on the Safe's request as TxRequest.job): the core's
   *  approval.asked with this key is this job's Safe sheet about to show (the audit's MUST, 7 Nov). */
  key?: string;
  /** Tests: the core's approval.asked stream (onApprovalAsked by default). */
  onAsked?: typeof onApprovalAsked;
}

/**
 * the audit's ruling (B) and MUST, 7 Nov: a job the page said Private pays whole is made at the tap (rule 2). If the Safe's sheet
 * then comes for it (the core asks the Safe after all), the core says approval.asked with this job's own key just before
 * that sheet shows: the chip's on the phone (Swift's own, never heard by the page), the web's and the Sim's the same way.
 * Its row then waits on that Face ID (JobHandle.asked) until the Safe has signed (job.signed with its key, never one naming
 * none), and a no ends it ("You said no, so nothing moved."), never left waiting. Matched by key only: another
 * job's approval.asked or job.signed changes nothing; with no key nothing is heard. Returns the stop.
 */
export function safeAskedAfterAll(job: () => JobHandle | null, o: { key?: string; onAsked?: typeof onApprovalAsked; onSigned?: typeof onSafeSigned; safeAsked?: () => void } = {}): { asked: () => boolean; stop: () => void } {
  let heard = false;
  const key = o.key;
  const offAsked = (o.onAsked ?? onApprovalAsked)((k) => { if (key && k === key && !heard && job()) { heard = true; job()!.asked(); o.safeAsked?.(); } });
  const offSigned = (o.onSigned ?? onSafeSigned)((k) => { if (heard && k === key) job()?.approved(); });
  return { asked: () => heard, stop: () => { offAsked(); offSigned(); } };
}

export async function runJob<T>(a: JobRun<T>): Promise<JobEnd<T>> {
  const release = claim(a.money);
  if (!release) return { refused: jobTaken(a.money) };
  let job: JobHandle | null = null;
  const make = () => { if (job) return; job = startJob(a.tasks, { ...(a.safe ? { approve: true } : {}), ...(a.fromPrivate ? { fromPrivate: true } : {}), title: a.title, ...(a.usd ? { usd: a.usd } : {}), ...(a.etaSec ? { etaSec: a.etaSec } : {}) }); a.made(job); };
  // bug report (6 Nov, his phone: "Job created." before any signature; prompt, success, prompt): a Safe job is made only
  // once its last signature is made (the core's job.signed, after the one Face ID, before anything is sent), or on the
  // core's answer when no signature came (Private paid it whole). Never at the tap, never on a sheet's yes alone: a yes is
  // not a signature, and a call can ask more than one sheet. At the tap the Safe's "Check this" is up at once instead
  // (pendingSheet, the copy review's W2). A hot wallet in its session: made at the tap, or on its own one-tap sheet's yes, as before.
  const asks = a.asks ?? (a.safe && sheetsHeard("safe"));
  if (!a.safe && !asks) make();
  const own = a.onApproval ?? onOwnApproval;
  let yes = false;
  let closed = false;
  const pend = a.safe ? pendingSheet(a.headline ?? a.title) : null;
  const offClosed = pend ? onPendingClosed(() => { closed = true; moneyClosed(); }) : () => {};
  // a keyed job moves on only on job.signed with ITS key (the audit's MUST and SHOULD, 7 Nov): another job's key, or one naming
  // none (a Safe signer outside runJob: Trade's native Safe buy), never makes it; an unkeyed job hears any, as before
  const offSigned = a.safe ? (a.onSigned ?? onSafeSigned)((k) => { if (closed || (a.key && k !== a.key)) return; yes = true; pend?.end(); make(); (job as JobHandle | null)?.approved(); }) : () => {};
  // the audit's (B): Private was to pay it whole, made at the tap; the Safe's sheet coming for it all the same waits on the Face ID
  const after = !a.safe && a.fromPrivate ? safeAskedAfterAll(() => job, a) : null;
  const stop = a.safe
    ? own((said) => { a.asking?.(false); if (said) yes = true; }, { opened: () => { if (job) a.asking?.(true); } })
    : own((said) => { a.asking?.(false); if (said && asks) make(); }, { anySheet: true, opened: () => { a.asking?.(true); } });
  let r: Answer<T>;
  try { r = await a.call(); }
  catch { r = { problem: { code: "shell.job.lost", whatHappened: "No answer came back. Activity shows if it went.", money: { state: "needs-you", where: "where it was" }, next: { kind: "open", label: "Open Activity", screen: "wallet/activity" } } }; }
  finally { stop(); offSigned(); offClosed(); pend?.end(); refuseClosed(false); release(); a.asking?.(false); }
  const asked = after?.asked() === true;
  after?.stop();
  const made = job as JobHandle | null;
  // the Safe asked after all and heard no (Not now, a Face ID that failed): the job ends with it, never left waiting
  if (a.declined(r)) { if (made && asked) { made.failed(JOB_WORDS.saidNo); return { declined: true, after: true }; } made?.gone(); return { declined: true, after: !!made }; }
  if ("problem" in r) {
    // the Safe refused before any yes: nothing was asked of it yet, so nothing is listed; the sheet's own Problem
    if (made && a.safe && !yes) { made.gone(); return { refused: r.problem }; }
    // Close on the Safe's sheet: nothing was signed, no job (the audit's R5)
    if (!made && closed) return { declined: true, after: false };
    if (made) { made.failed((a.words ?? ((p: Problem) => p.whatHappened))(r.problem)); return { job: made, problem: r.problem }; }
    return { refused: r.problem };
  }
  make();
  // the Safe asked after all and the core answered yes: it signed, whether or not its job.signed was heard
  if (asked) (job as JobHandle | null)?.approved();
  return { job: job as unknown as JobHandle, ok: r.ok };
}
