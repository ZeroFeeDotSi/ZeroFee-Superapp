// Move's tap (product decision, 5 Nov: "I click move and then bam, a job is created, a slight animation on top right, Home shows the
// job and the move popup shows job created"). The job is made at once (job-start.ts: its row on Home and in Activity, the
// bell's pulse) and the sheet says "Job created."; the legs' calls go on after, and the sheet never waits on them.
// Rule 2 (5 Nov: every tap shows "Job created." in under 100 ms, never "Moving…"): a Move with a
// Safe leg is made at the tap too. On the phone the Safe's Face ID is the iPhone's own sheet, which the shell never hears,
// so before this its job waited for the core's whole answer (the quote, Face ID and the send) under "Moving…". The Safe
// still asks Face ID on its signature (rule 4); a no takes the job away (no row) and puts the sheet back; a refusal,
// before or after its yes, stays as the job's stopped row (stoppedWords, rule 8), and before the yes the sheet says it too.
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Problem } from "@zerofee/core/problem";
import { moneyMayHaveMoved } from "@zerofee/core/money-calls";
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { JOB_WORDS, startJob, type JobHandle } from "@zerofee/shell-api/job-start.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { safeAskedAfterAll } from "@zerofee/shell-api/job-run.ts";
import { refusalFace, refusalText } from "@zerofee/shell-api/refusal-face.ts";
import type { Opened } from "@zerofee/shell-api/approval-answered.ts";
import { onPendingClosed, onSafeSigned, pendingSheet, refuseClosed, sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { moneyClosed } from "@zerofee/core/money-closed";
import { PLACES, legLine, legTime, legWords, WHERE, type Leg, type MoveFollow, type MovePlan, type MoveStep } from "./move-split.ts";

type Answer<T> = { ok: T } | { problem: Problem };
export interface MoveRunIo {
  call<T>(method: string, params: Record<string, unknown>): Promise<Answer<T>>;
  tasks: Tasks | undefined;
  /** The shell's word that the Safe's Approve was answered (approval-answered.ts); returns its stop. `o.opened`: a money
   *  sheet of this call is up (job-run.ts onOwnApproval). */
  onApproval(fn: (yes: boolean) => void, o?: { opened?: (p: Opened) => void }): () => void;
  /** Tests: the core's job.signed (the Safe's last signature made, before anything is sent); default onSafeSigned. */
  onSigned?: (fn: (jobKey?: string) => void) => () => void;
  /** Tests: the core's approval.asked (a job's sheet about to show, by its key); default onApprovalAsked. */
  onAsked?: (fn: (jobKey: string) => void) => () => void;
  keyFor(what: string): string;
  /** The Safe's Approve is drawn and heard here (the web's "Check this"): asked first, the job made on its yes (QA's MUST,
   *  Sim test). Default: sheetsHeard("safe"); on the iPhone (Swift's own Face ID) the job is made at the tap. */
  asks?: boolean;
  /** The Safe signs a fill into Private for this Move (move-split fillOf: Private falls short). False: Private alone pays
   *  the Safe's side, so no Safe sheet comes (rule 2, QA's Sim lap: 1.2 s from tap to "Job created." while the
   *  job waited for a sheet that never came) and the job is made at the tap with no Approve step. Unknown (Private not
   *  read yet): as if it fills. A sheet that comes all the same steps the sheet aside; its no takes the job away. */
  fills?: boolean;
  say(text: string, state?: "busy"): void;
  /** The Safe's Approve may be up: the sheet steps aside (D143). */
  asking(on: boolean): void;
  /** The job exists: the sheet says "Job created." (its dollars); `job`, its id, so its receipt follows its own rows. */
  made(usd: number, job: string): void;
  /** Refused before anything moved (a wallet leg's, or the Safe's before its yes): the job is gone, the sheet's own
   *  Problem, nothing moved. */
  refused(p: Problem): void;
  /** The person said no on the Safe's Approve: the job is gone, nothing moved. */
  declined(): void;
}
export type MoveRan = { followed: MoveFollow[]; held?: NonNullable<SpendingActivity["held"]> } | null;

const usdText = (n: number) => `$${n.toFixed(2)}`;

/** The job's title: "Move $30.00 to your SOL wallet", or "Move $30.00" when its legs end in several places. */
export function moveTitle(legs: readonly Leg[]): string {
  const total = legs.reduce((n, l) => n + l.usd, 0);
  const to = [...new Set(legs.map((l) => l.to))];
  return `Move ${usdText(total)}${to.length === 1 ? ` to ${WHERE[to[0]!]}` : ""}`;
}

/** A call that threw after the job existed (QA's crawl, 5 Nov: a refused Move stayed "1 going"): its row ends. */
export const MOVE_LOST = "No answer came back. Home shows where your money is.";

/** A refusal before anything moved, said on the Move sheet itself (QA's proof lap, 5 Nov: a refusal whose
 *  next step was a field the sheet doesn't have showed nothing at all). Only a step that opens a screen (a hold, the
 *  rules) goes to the shell; every other refusal's own words stay on the sheet. */
export const refusedLine = (p: Problem): string | null => { if (p.next.kind === "open") return null; const f = refusalFace(p); return f ? refusalText(f) : p.whatHappened; };
/** The refusal's next step, drawn under its line (rule 8, the proof of 5 Nov: "Move less" was never shown): `less`, an
 *  amount the Safe can't pay (Private short, one coin, the cap), sets the Safe's slider to what it can move; else the tap
 *  clears the line so the person can try again. Null: a step that opens a screen (the shell's). */
export function refusedStep(p: Problem): MoveStep | null {
  if (p.next.kind === "open" || !p.next.label) return null;
  const less = (p.next.kind === "fix-input" && (p.next as { field?: string }).field === "usd") || p.code === "ledger.private.short" || p.code === "spending.topup.one-coin";
  if (less) return { label: p.next.label, less };
  // the floor's one button runs the Move again only for these (a "wait" or "nothing" step may mean the money already left):
  // a retry step, and the core's busy refusal, which stops before anything is asked ("Nothing else moved.")
  if (p.code === "spending.topup.busy") return { label: "Try again", less, again: true };
  return p.next.kind === "retry" ? { label: p.next.label, less, again: true } : { label: p.next.label, less };
}

/** A job's row that stopped (rule 8): what failed, by name (the Problem's own words); where the money is, by place; and
 *  the next tap. The row stays in Jobs and Activity: a job, once made, never vanishes. */
export const MOVE_AGAIN = "Tap Move to try again.";
/** the copy review's words (5 Nov): "NEAR Intents said no. Nothing moved. The $13.00 is still in your Safe. Tap Move to try again." The
 *  protocol by its name (never "1Click"); the figure from the job. */
export function stoppedWords(p: Problem, usd: string): string {
  const said = p.whatHappened.trim().replace(/\b1Click\b/g, "NEAR Intents");
  const where = "where" in p.money && p.money.where && !said.includes(p.money.where) ? p.money.where : "";
  const line = !where ? "" : p.money.state === "safe" ? ` The ${usd} is still ${where}.` : ` Your money is ${where}.`;
  // one whose step opens a screen may have sent, or waits on that screen (audit, 6 Nov): never "try again"
  return `${said}${line}${p.next.kind === "open" ? "" : ` ${MOVE_AGAIN}`}`;
}

/** A wallet leg's refusal on its row (audit, 6 Nov): one with nothing gone "didn't go", and the next leg still goes; one whose
 *  money is unknown (moneyMayHaveMoved: "Check Activity") never says "didn't go", and ends the Move there: no leg after it
 *  starts, each saying its money is still where it was. Pure: a table test. */
export function legRefused(p: Problem, line: string): { said: string; halt: boolean } {
  return moneyMayHaveMoved(p) ? { said: `${line}: ${p.whatHappened}`, halt: true } : { said: `${line} didn't go: ${p.whatHappened}`, halt: false };
}
/** A leg that never started because one before it stopped with its money unknown. */
export const legNotStarted = (l: Leg): string => `${legWords(l)} didn't start. It's still in ${WHERE[l.from]}.`;

export async function runMove(legs: readonly Leg[], plan: MovePlan, io: MoveRunIo): Promise<MoveRan> {
  const held: { job: JobHandle | null } = { job: null };
  try { return await runMoveNow(legs, plan, io, held); }
  catch (e) { held.job?.failed(MOVE_LOST); throw e; }
}

async function runMoveNow(legs: readonly Leg[], plan: MovePlan, io: MoveRunIo, made: { job: JobHandle | null }): Promise<MoveRan> {
  const followed: MoveFollow[] = [];
  const missed: string[] = [];
  let held: NonNullable<SpendingActivity["held"]> | undefined;
  const total = legs.reduce((n, l) => n + l.usd, 0);
  // the job's places in the plan's order (the audit's M3, 7 Nov): its one row and card name every wallet, one order everywhere
  const to = PLACES.filter((p) => legs.some((l) => l.to === p));
  let job: JobHandle | null = null;
  // a Safe Move's key is its job's: the core saves the job under `mv-<key>` before the Safe signs, so its row here has
  // that id from the start (bug report, 5 Nov: closed and opened again, it is the same row, never gone, never two)
  const topKey = plan.topUp ? io.keyFor(`topup ${JSON.stringify(plan.topUp.legs)}`) : undefined;
  // the Safe's own money is in it (its fill into Private): the Safe's Approve. Paid from Private alone, no sheet comes
  // (the ledger's D143), so the job is made at the tap like any other (Sim re-check, 5 Nov: a Private -> NEAR wallet
  // Move waited 1.6 s for the core's answer and drew no Home line meanwhile)
  const safeAsks = !!plan.topUp && legs.some((l) => l.from === "safe") && io.fills !== false;
  // Try again keeps its key, so a refused try's ended row has this id, and an ended row never goes back to pending (tasks.ts): this try takes its place (audit, 6 Nov)
  const make = () => { if (job) return; if (topKey) io.tasks?.drop?.(`move:mv-${topKey}`); job = made.job = startJob(io.tasks, { ...(safeAsks ? { approve: true } : plan.topUp && legs.some((l) => l.from === "safe") ? { fromPrivate: true } : {}), title: moveTitle(legs), usd: usdText(total), ...(topKey ? { id: `move:mv-${topKey}` } : {}), etaSec: Math.max(0, ...legs.map(legTime)) }); carryTo([job.id], { to }); io.made(total, job.id); };
  // bug report (6 Nov): a Move with a Safe leg is made only once the Safe has signed (the core's job.signed, after its one
  // Face ID, before anything is sent), never at the tap and never on a sheet's yes alone; "Check this" is up at the tap
  // instead (pendingSheet, the copy review's W2). Paid from Private alone (no Safe sheet, D143): made at the tap, as before
  if (!safeAsks) make();
  // the Safe's money first, through its Approve (Face ID): a no there stops everything, nothing else has moved; its
  // wallet parts ride with it (`others`) so its one sheet says the whole Move, and each wallet leg carries its key (C2)
  if (plan.topUp) {
    io.asking(true);
    let yes = false;
    let closed = false;
    const pend = safeAsks ? pendingSheet(moveTitle(legs)) : null;
    const offClosed = pend ? onPendingClosed(() => { closed = true; moneyClosed(); }) : () => {};
    const signed = () => { if (closed) return; yes = true; pend?.end(); make(); (job as JobHandle | null)?.approved(); io.asking(false); };
    // its own key only (the audit's SHOULD, 7 Nov): another job's job.signed, or one naming none, never moves it on
    const offSigned = safeAsks ? (io.onSigned ?? onSafeSigned)((k) => { if (k === topKey) signed(); }) : () => {};
    // the audit's (B) and MUST, 7 Nov: Private was to pay the Safe's side whole (made at the tap); the Safe's sheet coming all the
    // same (the core's approval.asked with this Move's key, the phone's chip sheet too): the row waits on its Face ID until
    // the Safe has signed (job.signed), never on the sheet's yes
    const after = !safeAsks && legs.some((l) => l.from === "safe") ? safeAskedAfterAll(() => job, { ...(topKey ? { key: topKey } : {}), ...(io.onAsked ? { onAsked: io.onAsked } : {}), ...(io.onSigned ? { onSigned: io.onSigned } : {}) }) : null;
    // a sheet's yes is not a signature: it only steps the sheet back (a Private-only Move's job was made at the tap)
    const stop = io.onApproval((said) => { if (!said) return; if (!safeAsks) { yes = true; make(); if (!after?.asked()) (job as JobHandle | null)?.approved(); } io.asking(false); });
    const r = await io.call<SpendingActivity | { declined: true }>("spending.topUp", { usd: plan.topUp.usd, legs: plan.topUp.legs, key: topKey, ...(plan.between.length ? { others: plan.between.map((b) => ({ from: b.from, to: b.to, usd: legs.find((l) => l.from === b.from && l.to === b.to)?.usd })) } : {}) }).finally(() => { stop(); offSigned(); offClosed(); pend?.end(); refuseClosed(false); io.asking(false); });
    const asked = after?.asked() === true;
    after?.stop();
    if (closed && !job) { io.declined(); return null; }
    const unmake = () => { (job as JobHandle | null)?.gone(); job = made.job = null; };
    // a refusal after "Job created." never takes the job away (QA's real-money lap, 5 Nov: Safe → SOL wallet said
    // "Job created. About 4 min left.", was refused 2 s later, and a Done in those 2 s left no trace): its row stops with
    // what failed, where the money is and what to tap (rule 8); before the Approve's yes the sheet says it too
    if ("problem" in r) { (job as JobHandle | null)?.failed(stoppedWords(r.problem, usdText(total))); if (!yes) io.refused(r.problem); return null; }
    // the Safe asked after all and heard no (Not now, a Face ID that failed): the job ends with it, never left waiting
    if ("declined" in r.ok) { if (asked && job) { (job as JobHandle).failed(JOB_WORDS.saidNo); job = made.job = null; } else unmake(); io.declined(); return null; }
    // no signature heard (the core moved it without the Safe's sheet): made now, on its answer
    make();
    // the Safe asked after all and the core answered yes: it signed, whether or not its job.signed was heard
    if (asked) (job as JobHandle | null)?.approved();
    if (r.ok.held) held = r.ok.held;
    else for (const l of legs.filter((x) => x.from === "safe")) followed.push({ leg: l, id: r.ok.id, by: "topup" });
  }
  // each wallet → wallet leg, its own job (E5); one that's refused is said on the row, the ones before it still go
  // a leg whose money is unknown ends the Move there: no leg after it starts (the audit's ruling, 6 Nov; legRefused)
  let halted = false;
  for (const b of plan.between) {
    const leg = legs.find((l) => l.from === b.from && l.to === b.to)!;
    if (halted) { missed.push(legNotStarted(leg)); continue; }
    const r = await io.call<SpendingActivity>("spending.move", { from: b.from, to: b.to, usd: b.usd, key: io.keyFor(`${b.from} ${b.to} ${b.usd}`), ...(topKey ? { job: topKey } : {}) });
    if ("problem" in r) { const said = legRefused(r.problem, legWords(leg)); missed.push(said.said); halted = said.halt; continue; }
    followed.push({ leg, id: r.ok.id, by: "move" });
  }
  // money home last: one take-out for every wallet coming home (no Approve: money only goes home)
  if (plan.putAway && halted) for (const l of legs.filter((x) => x.to === "safe")) missed.push(legNotStarted(l));
  else if (plan.putAway) {
    const r = await io.call<SpendingActivity>("spending.putAway", { legs: plan.putAway.legs });
    if ("problem" in r) missed.push(legRefused(r.problem, "Home").said);
    else for (const l of legs.filter((x) => x.to === "safe")) followed.push({ leg: l, id: r.ok.id, by: "putaway" });
  }
  const j = job as JobHandle | null;
  if (!followed.length && !held) { j?.failed(missed.join(" ") || "Nothing moved."); return null; }
  j?.made(followed.map((f) => `move:${f.id}`), missed.join(" ") || undefined);
  carryTo(followed.map((f) => `move:${f.id}`), { to });
  // the Safe's part's legs as the plan sized them (the audit's M4, 7 Nov): its page gives each wallet's leg its own step and figure
  const safePart = followed.find((f) => f.by === "topup");
  if (safePart && plan.topUp) carryTo([`move:${safePart.id}`], { legs: plan.topUp.legs.map((l) => ({ to: l.network, usd: usdText(l.usd) })) });
  return { followed, ...(held ? { held } : {}) };
}
