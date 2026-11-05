// The one shape every layer uses to report something that went wrong or needs the user.
//
// The app has no support desk: every problem a layer can produce must be explainable to a five-year-old in three parts.
//   1. what happened                          ("Your money hasn't arrived yet.")
//   2. is the money safe, and where is it now ("It's safe. It's on its way from Solana.")
//   3. the one thing to do next               ("Wait about 2 minutes")
// The app (layer S2) renders a Problem; it never invents its own wording. Each layer lists every Problem code it can
// produce in its own errors.md, and a layer isn't done until each code has a screen and a test.

import type { Fault, Service } from "./services.ts";

/** Where the user's money is while this problem stands. Never leave the user guessing. */
export type MoneyState =
  | { state: "safe"; where: string } //              in the user's own account; nothing is moving
  | { state: "on-the-way"; where: string; etaSeconds?: number } // moving between places, expected to land by itself
  | { state: "coming-back"; where: string; etaSeconds?: number } // a refund is under way, by itself
  | { state: "needs-you"; where: string } //         nothing will happen until the user does the next step
  | { state: "not-involved" }; //                    no money is touched (e.g. a typo in the backup words)

export type NextStep =
  | { kind: "retry"; label: string }
  /** `disabledUntil`: the pill does the step again (e.g. "Try again after 4:14 AM"), so it stays off until then. */
  | { kind: "wait"; label: string; untilIso?: string; disabledUntil?: string }
  // A named screen. Convention: "<app>/<tab>" (e.g. "security/activity") is a place in the whole app, and the shell takes
  // the person there when the pill is tapped (ProblemView's onOpen). A name with no "/" (e.g. "receive", "ask") is the
  // owning app's own screen: the shell just closes the Problem and hands the tapped step back to the app that showed it.
  | { kind: "open"; label: string; screen: string }
  | { kind: "fix-input"; label: string; field: string }
  | { kind: "nothing"; label: string }; // e.g. "You're all set"

export interface Problem {
  /** Stable id, catalogued in the owning layer's errors.md, e.g. "security.faceid.changed". Never shown to the user. */
  code: string;
  /** What happened, in a child's words. One or two short sentences. */
  whatHappened: string;
  money: MoneyState;
  next: NextStep;
  /**
   * Optional quiet second link under the one pill (never a second pill). `kind: "open"` hands back to the host's `onNext2`
   * (with `screen`, "<app>/<tab>", the shell takes the person there as for `next`);
   * `kind: "url"` navigates this page to `url`, and ONLY a same-app relative address ("/?demo": starts with "/", not "//",
   * no scheme, no host) is followed. Anything else is ignored and the link is not shown.
   */
  next2?: { label: string; kind: "open" | "url"; url?: string; screen?: string };
  /** Optional extra detail behind a "More" tap: still plain words, never a stack trace or raw error code. */
  more?: string;
  /**
   * An outside service failed (services.ts, B28): which one, and how. A sheet shows such a Problem as one line on itself
   * and reads again by itself, never as the shell's Problem screen.
   */
  service?: Service;
  fault?: Fault;
}

/** Thrown inside the core; caught at the layer boundary and handed to the app as a Problem. */
export class ProblemError extends Error {
  readonly problem: Problem;
  constructor(problem: Problem) {
    super(problem.code);
    this.problem = problem;
  }
}
