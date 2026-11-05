// D144, the Activity centre: the Browser's own tasks, as pure mappers (the app publishes them with useShell().tasks).
// A site wallet's Add and Take out with their real legs, a site's automatic sign-in, and AgentZero's browser runs.
// Dollars only where the title needs them; never an address, a key or a wallet id.
import type { TaskInput, TaskStep, TaskState } from "@zerofee/shell-api/tasks.ts";
import type { Live, NeedsYou } from "./agent/live.ts";

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
  limit: "Your turn: it reached its step limit", "took-over": "You took over",
};
/** AgentZero's browser run, as one task: its steps as they happen (the last 8), the person's turn, and how it ended. */
export function runTask(s: Live, seen: string[], startedAt: number, host: string | null): { task: TaskInput; end?: { state: Exclude<TaskState, "pending">; detail: string } } | null {
  if (s.phase === "idle") return null;
  const where = s.phase === "starting" ? (s.host ?? host) : s.phase === "ended" ? host : s.host;
  const title = where ? `AgentZero on ${where}` : "AgentZero's browser";
  const done = seen.slice(-7).map((l) => step(l, "done"));
  const opening = step(where ? `Opening ${where}` : "Opening the page", s.phase === "starting" ? "doing" : "done");
  const now: TaskStep[] = s.phase === "agent" && s.steps?.length ? [...done.slice(0, -1), step(seen.at(-1)!, "doing")] : done;
  const steps = [opening, ...now, ...(s.phase === "you" ? [step(TURN[s.why], "waiting")] : [])].slice(-8);
  const task: TaskInput = { id: `az-browser-${startedAt}`, title, steps, startedAt, open: {} };
  if (s.phase !== "ended") return { task };
  const state = /^Stopped\b/.test(s.line) ? "stopped" : /is done on/.test(s.line) ? "done" : "failed";
  return { task: { ...task, steps: steps.map((x) => (x.state === "doing" ? { ...x, state: state === "done" ? "done" : "failed" } : x)) }, end: { state, detail: s.line } };
}
