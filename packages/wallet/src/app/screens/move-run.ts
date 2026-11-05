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
import type { Tasks } from "@zerofee/shell-api/tasks.ts";
import { startJob, type JobHandle } from "@zerofee/shell-api/job-start.ts";
import { sheetsHeard } from "@zerofee/shell-api/approval-answered.ts";
import { legLine, legTime, WHERE, type Leg, type MoveFollow, type MovePlan } from "./move-split.ts";

type Answer<T> = { ok: T } | { problem: Problem };
export interface MoveRunIo {
  call<T>(method: string, params: Record<string, unknown>): Promise<Answer<T>>;
  tasks: Tasks | undefined;
  /** The shell's word that the Safe's Approve was answered (approval-answered.ts); returns its stop. */
  onApproval(fn: (yes: boolean) => void): () => void;
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
  /** The job exists: the sheet says "Job created." (its dollars). */
  made(usd: number): void;
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
export const refusedLine = (p: Problem): string | null => (p.next.kind === "open" ? null : p.whatHappened);
/** The refusal's next step, drawn under its line (rule 8, the proof of 5 Nov: "Move less" was never shown): `less`, an
 *  amount the Safe can't pay (Private short, one coin, the cap), sets the Safe's slider to what it can move; else the tap
 *  clears the line so the person can try again. Null: a step that opens a screen (the shell's). */
export function refusedStep(p: Problem): { label: string; less: boolean } | null {
  if (p.next.kind === "open" || !p.next.label) return null;
  const less = (p.next.kind === "fix-input" && (p.next as { field?: string }).field === "usd") || p.code === "ledger.private.short" || p.code === "spending.topup.one-coin";
  return { label: p.next.label, less };
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
  return `${said}${line} ${MOVE_AGAIN}`;
}

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
  let job: JobHandle | null = null;
  // a Safe Move's key is its job's: the core saves the job under `mv-<key>` before the Safe signs, so its row here has
  // that id from the start (bug report, 5 Nov: closed and opened again, it is the same row, never gone, never two)
  const topKey = plan.topUp ? io.keyFor(`topup ${JSON.stringify(plan.topUp.legs)}`) : undefined;
  // the Safe's own money is in it (its fill into Private): the Safe's Approve. Paid from Private alone, no sheet comes
  // (the ledger's D143), so the job is made at the tap like any other (Sim re-check, 5 Nov: a Private -> NEAR wallet
  // Move waited 1.6 s for the core's answer and drew no Home line meanwhile)
  const safeAsks = !!plan.topUp && legs.some((l) => l.from === "safe") && io.fills !== false;
  const make = () => { if (job) return; job = made.job = startJob(io.tasks, { ...(safeAsks ? { approve: true } : {}), title: moveTitle(legs), usd: usdText(total), ...(topKey ? { id: `move:mv-${topKey}` } : {}), etaSec: Math.max(0, ...legs.map(legTime)) }); io.made(total); };
  // QA's MUST (Sim test: "Job created." at 58 ms, "Check this" over it at 1,186 ms, "Job created." again after
  // Approve): where the Safe's sheet is ours, it comes first and the job is made on its yes; otherwise at the tap (rule 2)
  const asks = safeAsks && (io.asks ?? sheetsHeard("safe"));
  if (!asks) make();
  // the Safe's money first, through its Approve (Face ID): a no there stops everything, nothing else has moved
  if (plan.topUp) {
    io.asking(true);
    let yes = false;
    const stop = io.onApproval((said) => { if (!said) return; yes = true; make(); (job as JobHandle | null)?.approved(); io.asking(false); });
    const r = await io.call<SpendingActivity | { declined: true }>("spending.topUp", { usd: plan.topUp.usd, legs: plan.topUp.legs, key: topKey }).finally(() => (stop(), io.asking(false)));
    const unmake = () => { (job as JobHandle | null)?.gone(); job = made.job = null; };
    // a refusal after "Job created." never takes the job away (QA's real-money lap, 5 Nov: Safe → SOL wallet said
    // "Job created. About 4 min left.", was refused 2 s later, and a Done in those 2 s left no trace): its row stops with
    // what failed, where the money is and what to tap (rule 8); before the Approve's yes the sheet says it too
    if ("problem" in r) { (job as JobHandle | null)?.failed(stoppedWords(r.problem, usdText(total))); if (!yes) io.refused(r.problem); return null; }
    if ("declined" in r.ok) { unmake(); io.declined(); return null; }
    // asked first and no yes heard (the core moved it without our sheet): made now, on its answer
    make();
    if (r.ok.held) held = r.ok.held;
    else for (const l of legs.filter((x) => x.from === "safe")) followed.push({ leg: l, id: r.ok.id, by: "topup" });
  }
  // each wallet → wallet leg, its own job (E5); one that's refused is said on the row, the ones before it still go
  for (const b of plan.between) {
    const r = await io.call<SpendingActivity>("spending.move", { from: b.from, to: b.to, usd: b.usd, key: io.keyFor(`${b.from} ${b.to} ${b.usd}`) });
    const leg = legs.find((l) => l.from === b.from && l.to === b.to)!;
    if ("problem" in r) { missed.push(`${legLine(leg)} didn't go: ${r.problem.whatHappened}`); continue; }
    followed.push({ leg, id: r.ok.id, by: "move" });
  }
  // money home last: one take-out for every wallet coming home (no Approve: money only goes home)
  if (plan.putAway) {
    const r = await io.call<SpendingActivity>("spending.putAway", { legs: plan.putAway.legs });
    if ("problem" in r) missed.push(`Home didn't go: ${r.problem.whatHappened}`);
    else for (const l of legs.filter((x) => x.to === "safe")) followed.push({ leg: l, id: r.ok.id, by: "putaway" });
  }
  const j = job as JobHandle | null;
  if (!followed.length && !held) { j?.failed(missed.join(" ") || "Nothing moved."); return null; }
  j?.made(followed.map((f) => `move:${f.id}`), missed.join(" ") || undefined);
  return { followed, ...(held ? { held } : {}) };
}
