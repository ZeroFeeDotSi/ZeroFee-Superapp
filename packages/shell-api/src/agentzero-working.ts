// "AgentZero is working · Stop" (D114): the dot on every screen while AgentZero's browser acts on the phone. One JS realm
// runs every app's screens, so this is a module of the shell's: Browser's live view sets it, the shell shows the dot and
// its Stop calls back. Words only; never a page, an address or anything typed.

export interface AgentZeroWorking {
  /** The site's host, as the window's bar shows it. */
  host: string;
  stop(): void;
}

let now: AgentZeroWorking | null = null;
const listeners = new Set<(w: AgentZeroWorking | null) => void>();

export function setAgentZeroWorking(w: AgentZeroWorking | null): void {
  now = w;
  for (const l of listeners) l(now);
}

export const agentZeroWorking = (): AgentZeroWorking | null => now;

export function onAgentZeroWorking(fn: (w: AgentZeroWorking | null) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The dot's words. */
export const workingLine = (w: AgentZeroWorking): string => `AgentZero is working on ${w.host}`;
