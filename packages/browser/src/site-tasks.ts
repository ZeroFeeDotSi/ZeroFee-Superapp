// D144, the Activity centre: the Browser's own tasks, as pure mappers (the app publishes them with useShell().tasks).
// A site wallet's Add and Take out with their real legs, a site's automatic sign-in, and AgentZero's browser runs.
// Dollars only where the title needs them; never an address, a key or a wallet id.
import type { TaskInput, TaskStep, TaskState, TaskStore } from "@zerofee/shell-api/tasks.ts";
import { CLOSED_LINE, runPlan, type Live, type NeedsYou } from "./agent/live.ts";
import { tookIn } from "@zerofee/shell-api/job-steps.ts";

const step = (label: string, state: TaskStep["state"], at?: number): TaskStep => ({ label, state, ...(at !== undefined ? { at } : {}) });
/** "$10.00" from the money sheet's own line ("$10.00 is on its way to pump.fun."); none: no figure in the title. */
export const dollarsIn = (line: string | undefined): string | null => line?.match(/\$\d[\d,]*(?:\.\d{2})?/)?.[0] ?? null;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** An Add that went (the person approved it): the Safe → Spending, privately → the site's wallet. */
export function addTask(name: string, line: string | undefined, at: number): TaskInput {
  const $ = dollarsIn(line);
  return {
    id: `add-${slug(name)}-${at}`,
    title: $ ? `Add ${$} to your ${name} wallet` : `Add money to your ${name} wallet`,
    steps: [step("Left your Safe", "done", at), step("Into Spending, privately", "doing"), step(`Into your ${name} wallet`, "waiting")],
    startedAt: at,
    detail: "On its way. About a minute.",
    open: {},
  };
}
/** It landed in the site's wallet. */
export function addLanded(name: string, at: number): { steps: TaskStep[]; detail: string } {
  return { steps: [step("Left your Safe", "done"), step("Into Spending, privately", "done"), step(`Into your ${name} wallet`, "done", at)], detail: `It's in your ${name} wallet.` };
}
export const addNotSeen = (name: string): string => `Solana doesn't show it in your ${name} wallet yet. Look again in a minute.`;

/** A Take out that went: the site's wallet → Spending, privately → your Safe. */
export function backTask(name: string, line: string | undefined, at: number): TaskInput {
  const $ = dollarsIn(line);
  return {
    id: `back-${slug(name)}-${at}`,
    title: $ ? `Take out ${$} from your ${name} wallet` : `Take out money from your ${name} wallet`,
    steps: backSteps(name, { back: { status: "pending" } }).steps,
    startedAt: at,
    detail: "On its way home to your Safe.",
    open: {},
  };
}

/** The core's own record of a move back (subwallet.site.moveBacks), read as the task's steps, and its end once it has one. */
export interface MoveBack { back: { id: string; status: string }; home?: { status: string } }
export function backSteps(name: string, m: { back: { status: string }; home?: { status: string } } | undefined): { steps: TaskStep[]; end?: { state: Exclude<TaskState, "pending">; detail: string } } {
  const out = `Out of your ${name} wallet`, mid = "Into Spending, privately", home = "Into your Safe";
  if (!m || m.back.status === "pending") return { steps: [step(out, "doing"), step(mid, "waiting"), step(home, "waiting")] };
  if (m.back.status === "failed") return { steps: [step(out, "failed"), step(mid, "waiting"), step(home, "waiting")], end: { state: "failed", detail: `It didn't go. Your money is still in your ${name} wallet.` } };
  const h = m.home?.status;
  if (h === "done") return { steps: [step(out, "done"), step(mid, "done"), step(home, "done")], end: { state: "done", detail: "It's in your Safe." } };
  if (h === "refunded" || h === "failed") return { steps: [step(out, "done"), step(mid, "done"), step(home, "failed")], end: { state: "done", detail: "It stopped in Spending. It's safe there." } };
  return { steps: [step(out, "done"), step(mid, "done"), step(home, "doing")] };
}

/** A site's automatic sign-in (the native window's own states), one task per sign-in. */
export type SignInState = "signing" | "signed" | "signing-again" | "failed";
/** Every sign-in task's hard end (phone test, 3 Nov: two sat on "Signing in…" for 2½ hours): no step waits longer. */
export const SIGN_IN_TASK_MS = 2 * 60_000;
export const signInStuck = (name: string): string => `${name} didn't finish signing in. Nothing moved. Open ${name} to try again.`;
/** Only a sign-in the person started shows as a task: one in a window on screen (never a warm-up in the background). */
export const showsSignIn = (state: SignInState, windowOnScreen: boolean, taskOpen: boolean): boolean => windowOnScreen || (taskOpen && state !== "signing");
export function signInTask(name: string, state: SignInState, at: number, id?: string): { publish?: TaskInput; end?: { state: Exclude<TaskState, "pending">; detail: string } } {
  if (state === "signing" || state === "signing-again") {
    return { publish: { id: id ?? `signin-${slug(name)}-${at}`, title: state === "signing" ? `Sign in to ${name}` : `Sign in to ${name} again`, steps: [step(`Opening ${name}`, "done", at), step(`Signing in with your ${name} wallet`, "doing")], startedAt: at, open: {} } };
  }
  if (state === "signed") return { end: { state: "done", detail: "Signed in." } };
  return { end: { state: "failed", detail: `${name} signed you out. Tap its Sign in to come back in.` } };
}

const TURN: Record<NeedsYou | "took-over", string> = {
  "sign-in": "Your turn: sign in", "person-check": "Your turn: show you're a person", code: "Your turn: type the code", terms: "Your turn: read and agree",
  "create-account": "Your turn: make the account", money: "Your turn: this step is yours", stuck: "Your turn: it got stuck", refused: "Your turn: the site said no",
  limit: "Your turn: it reached its step limit", steered: "Your turn: the page gave orders", leaves: "Your turn: the link leaves the site", "took-over": "You took over",
};
/** E3: the done row's line and AgentZero's report, said once, inside the store's 300 characters (cut at a word, no dots).
 *  b18: then how long it took ("Took 5 s."), the receipt rule of every job row; the report is cut first, never the time. */
export function doneDetail(line: string, summary: string | undefined, took?: string | null): string {
  const end = took ? ` ${took}` : "";
  if (!summary) return `${line}${end}`;
  const room = 299 - line.length - end.length;
  const said = summary.length <= room ? summary : summary.slice(0, room).replace(/\s+\S*$/, "");
  return `${line} ${said}${end}`;
}
/** E5: how long a run may sit with no update before its row ends by itself: the person's turn's own limit and a minute. */
export const RUN_STALE_MS = 11 * 60_000;
/** AgentZero's browser run, as one task: its steps as they happen (the last 8), the person's turn, time left on the
 *  run's one clock (E5: the row counts down to the card's own figure), and how it ended (E3: with AgentZero's report). */
export function runTask(s: Live, seen: string[], startedAt: number, host: string | null): { task: TaskInput; end?: { state: Exclude<TaskState, "pending">; detail: string } } | null {
  if (s.phase === "idle") return null;
  const where = s.phase === "starting" ? (s.host ?? host) : s.phase === "ended" ? host : s.host;
  const title = where ? `AgentZero on ${where}` : "AgentZero's browser";
  // audit 17's H6: the run's plan (live.ts runPlan, the card's own steps), each ticking on the run's events; the step
  // AgentZero is on says what it last did (`seen`); the person's turn says whose step it is
  const plan = runPlan(s, where ?? host);
  const steps: TaskStep[] = plan.map((p, i) => {
    if (p.state === "you") return step(s.phase === "you" ? TURN[s.why] : p.label, "waiting");
    if (i === 1 && p.state === "doing" && seen.length) return step(`${p.label}: ${seen.at(-1)!}`, "doing");
    return step(p.label, p.state);
  });
  const task: TaskInput = { id: `az-browser-${startedAt}`, title, steps, startedAt, open: {}, staleMs: RUN_STALE_MS, staleDetail: CLOSED_LINE, ...(s.phase !== "ended" && typeof s.endsAt === "number" ? { endsAt: s.endsAt } : {}) };
  if (s.phase !== "ended") return { task };
  const took = typeof s.at === "number" && typeof s.endedAt === "number" ? tookIn(s.endedAt - s.at) : null;
  const state = s.stopped || /^Stopped\b/.test(s.line) ? "stopped" : s.done ? "done" : "failed";
  // H8: a run that didn't find it ends in the problem state with its reason and its time, never a green done
  return { task, end: { state, detail: s.done ? doneDetail(s.line, s.summary, took) : s.missed ? doneDetail(s.line, undefined, took) : s.line } };
}

/** Audit 17's H6: the runs this device finished before, start to end (ms), newest first, at most 5: the first frame's
 *  time left (live.ts runEndsAt) is their median, the measured-legs rule, never a set figure. Pure. */
export function pastRunMs(rows: readonly { id: string; state: string; startedAt: number; endedAt?: number }[]): number[] {
  return rows.filter((r) => isRunTask(r.id) && r.state === "done" && typeof r.endedAt === "number" && r.endedAt > r.startedAt)
    .sort((a, b) => b.endedAt! - a.endedAt!).slice(0, 5).map((r) => r.endedAt! - r.startedAt);
}

/** E5: is this an AgentZero browser run's row? */
export const isRunTask = (id: string): boolean => /^az-browser-\d+$/.test(id);

/** E5: a run's row that is still going but isn't one of this page's runs was cut off when ZeroFee closed (a reload, the
 *  app shut): it ends now with CLOSED_LINE, so Activity says how it ended. Only AgentZero's runs. */
const SHELL_OF = { agentzero: "agent", browser: "browser" } as const;
export function sweepClosedRuns(store: Pick<TaskStore, "list" | "forApp">, live: ReadonlySet<string>): void {
  for (const t of store.list()) {
    if (t.state !== "pending" || !isRunTask(t.id) || live.has(t.id)) continue;
    const shell = SHELL_OF[t.app as keyof typeof SHELL_OF];
    if (shell) store.forApp(shell).end(t.id, "stopped", CLOSED_LINE);
  }
}
