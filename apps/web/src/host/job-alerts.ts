// A-6 Push per action, local only (master plan row 11; catalogue 20): when AgentZero's job ends a step while ZeroFee is
// not on screen, the phone shows one local notification (Notify.swift: device.notify.schedule, as AgentZero). No server,
// no APNs key (D37): only what this phone itself knows. The words are fixed per kind and never carry an amount, an
// address, a coin or a name: the lock screen is public (job-alerts.test.ts). The agent package's engine says which kind it was
// (packages/agent/src/zero/engine.ts JOB_DONE_EVENT, its kind only). Nothing while ZeroFee is on screen: the app says it
// there itself. At most one per event; the same kind replaces its last one (a busy day is one line, not a pile).
import type { JobDoneKind } from "@zerofee/agent/zero/engine";
import type { IosHost } from "./ios.ts";

/** The engine's JOB_DONE_EVENT, by its name: importing the value would load the whole engine (34 KB) on every phone
 *  start; job-alerts.test.ts holds the two equal. */
export const JOB_DONE = "agentzero:job-done";

export const JOB_WORDS: Readonly<Record<JobDoneKind, string>> = Object.freeze({
  "trade-done": "AgentZero finished a trade. Open ZeroFee to see it.",
  "needs-you": "AgentZero needs you to look at something. Open ZeroFee.",
  "job-stopped": "AgentZero stopped a job. Open ZeroFee to see why.",
});

/** The notification for one event, or null: an unknown kind, or ZeroFee on screen. */
export function jobAlert(detail: unknown, onScreen: boolean, nowMs: number): Record<string, string> | null {
  const kind = (detail as { kind?: unknown } | null)?.kind;
  if (onScreen || typeof kind !== "string" || !Object.hasOwn(JOB_WORDS, kind)) return null;
  return { app: "agent", id: `job.${kind}`, title: "AgentZero", body: JOB_WORDS[kind as JobDoneKind], atIso: new Date(nowMs + 3_000).toISOString() };
}

/** Listens on the page for the engine's event and hands each one to the phone. Back on screen, its lines are taken off
 *  the lock screen (the app shows what happened itself; review L2). Returns the stop. */
export function watchJobs(host: Pick<IosHost, "call">, page: Pick<Window, "addEventListener" | "removeEventListener"> = window, onScreen: () => boolean = () => document.visibilityState === "visible", now: () => number = Date.now, seen: Pick<Document, "addEventListener" | "removeEventListener"> = document): () => void {
  const heard = (e: Event) => {
    const n = jobAlert((e as CustomEvent).detail, onScreen(), now());
    if (n) void host.call("device.notify.schedule", n);
  };
  const back = () => {
    if (onScreen()) for (const kind of Object.keys(JOB_WORDS)) void host.call("device.notify.cancel", { app: "agent", id: `job.${kind}` });
  };
  page.addEventListener(JOB_DONE, heard);
  seen.addEventListener("visibilitychange", back);
  return () => { page.removeEventListener(JOB_DONE, heard); seen.removeEventListener("visibilitychange", back); };
}
