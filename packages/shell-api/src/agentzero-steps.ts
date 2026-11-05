// AgentZero's site steps (D75, AZ2 job 4 "Sign me in"): the line a site window shows under its bar when ZeroFee does a
// step for the person ("AgentZero signed you in to GMGN."), kept so AgentZero's own screen can show it as a receipt.
//
// The site window (packages/browser, Social trading's builder) calls `noteAgentZeroStep` with the SAME line it shows;
// the Agent app reads `agentZeroSteps()` and listens with `onAgentZeroStep`. One JS realm runs every app's screens (the
// shell's web view), so this is a module of the shell's, not the core: it holds words only, never an address, a key or an
// amount the core didn't already show. Display only (D75): it changes nothing that is signed. Lives for this run of the
// app; AgentZero copies what it shows into its own receipts on the device.

export interface AgentZeroStep {
  atIso: string;
  /** The site's short name, as the window's bar says it ("GMGN", "pump.fun"). */
  site: string;
  /** The window's own line, word for word, grade 5 ("AgentZero signed you in."). */
  line: string;
  /** "done" (a sign-in, a move), "handed" (the person must act: a code), "refused" (AgentZero couldn't). */
  state: "done" | "handed" | "refused";
}

const MAX = 50;
const steps: AgentZeroStep[] = [];
const listeners = new Set<(s: AgentZeroStep) => void>();

/** Record a step the window just showed. A line over 140 characters or with no site is ignored. */
export function noteAgentZeroStep(step: Omit<AgentZeroStep, "atIso"> & { atIso?: string }): void {
  const site = String(step.site ?? "").trim().slice(0, 40);
  const line = String(step.line ?? "").trim();
  if (!site || !line || line.length > 140) return;
  const s: AgentZeroStep = { atIso: step.atIso ?? new Date().toISOString(), site, line, state: step.state === "handed" || step.state === "refused" ? step.state : "done" };
  steps.unshift(s);
  steps.length = Math.min(steps.length, MAX);
  for (const l of listeners) l(s);
}

/** The steps recorded in this run, newest first. */
export const agentZeroSteps = (): readonly AgentZeroStep[] => steps.slice();

export function onAgentZeroStep(fn: (s: AgentZeroStep) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** For tests only. */
export const clearAgentZeroSteps = () => void (steps.length = 0);
