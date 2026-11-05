// D119 perps: one step of the Perps tab (turn on, an order, a close, turn off), and the only place it says a line went.
// The shell's "it went" line (sayWent) is an anti-spoof surface (security review of Job 1, M1): Perps says it ONLY with
// words built from the source's own outcome of a step it accepted (the core's answer, from Hyperliquid's fill), never
// from what was typed or from the page, and never for a step that was refused or failed: that is the Problem screen.
import type { NextStep, Problem } from "@zerofee/core/problem";
import { PerpsProblem } from "./source.ts";

/** A failure the source didn't word (a dropped connection): Hyperliquid named, the money line kept. */
export const UNREAD: Problem = { code: "perps.hyperliquid.unreachable", whatHappened: "Hyperliquid didn't answer. Nothing was traded.", money: { state: "safe", where: "on Hyperliquid (test money)" }, next: { kind: "retry", label: "Try again" } };
export const problemOf = (e: unknown): Problem => (e instanceof PerpsProblem ? e.problem : UNREAD);

/** Run `step`; on its accepted outcome say `line(outcome)` and return it; on any failure show its Problem, say nothing,
 *  and return undefined. */
export async function runStep<T>(step: () => Promise<T>, line: ((outcome: T) => string) | undefined, ui: { say(text: string): void; showProblem(p: Problem): Promise<NextStep> }): Promise<{ outcome?: T; next?: NextStep }> {
  let outcome: T;
  try {
    outcome = await step();
  } catch (e) {
    return { next: await ui.showProblem(problemOf(e)) };
  }
  if (line) ui.say(line(outcome));
  return { outcome };
}
