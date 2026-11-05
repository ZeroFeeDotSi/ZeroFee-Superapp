// AgentZero's chat (product decision, 3 Nov, D122): the turn's events as the screen keeps them. Pure, so node tests it.
// The events are the agent package's ChatEvent (packages/agent/src/chat/turn.ts: chatTurn picks the person's own key or the
// relay's free reading, and holds the guard and the tools); this file never calls a model. Both the real account and
// the Sim (D157) run that engine; the shape is mirrored here for the screen.

/** One event of a turn, as chatTurn yields them. */
export type ChatEvent =
  | { kind: "text"; delta: string }
  /** H-2: the phone's own figures for the {{fN}} marks in AgentZero's words (the agent package's ChatFact). */
  | { kind: "facts"; facts: { mark: string; shown: string; rows: string[] }[] }
  | { kind: "step"; id: string; tool: string; line: string; state: "running" | "done" | "refused"; why?: string }
  | { kind: "needs-you"; why: string; sheet?: unknown }
  | { kind: "receipt"; line?: string }
  | { kind: "done" }
  | { kind: "fault"; line: string };

export type AzPart =
  /** `facts` (H-2): the figures known when these words came, the only ones its marks may show; set once any are. */
  | { type: "text"; text: string; facts?: Record<string, { mark: string; shown: string; rows: string[] }> }
  | { type: "step"; id: string; tool: string; line: string; state: "running" | "done" | "refused"; why?: string }
  /** `stale`: a newer card took its place (no Open on it). */
  | { type: "needs"; why: string; sheet?: unknown; stale?: boolean; /** a money card's own id (its news is kept) */ card?: string }
  /** `retry`: a Try again beside the line (the same words go again, in the same bubble). */
  | { type: "fault"; line: string; retry?: boolean; /** Try again signs in anew first */ fresh?: boolean };

export interface AzMessage {
  id: string; role: "user" | "assistant"; parts: AzPart[]; done: boolean;
  /** H-2: the figures this reply has received so far (each text part keeps those known when it came). */
  facts?: Record<string, { mark: string; shown: string; rows: string[] }>;
  /** AgentZero's own wallet (L9): what this reply's paid calls cost together, and the credit left after the last. */
  /** `about`: a stopped reply's cost is Stop's estimate (SR3 L9), never shown as exact. */
  cost?: { turnUsd: number; about?: true };
  /** AgentZero's own wallet (L9): this reply paused mid-task for want of money. */
  paused?: boolean;
}

/**
 * One event into the thread: text streams into the last text part of the reply; a step is ONE card by its id, updated
 * in place (running → done or refused); a fault is its own named line; done closes the reply. Never mutates.
 */
/** An event as it arrives, narrowed (review L1 Low): text is text, a state is one of three, anything else is dropped. */
export function narrow(ev: unknown): ChatEvent | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));
  switch (e.kind) {
    case "text": return { kind: "text", delta: str(e.delta) };
    case "step": {
      const state = e.state === "done" || e.state === "refused" ? e.state : "running";
      return { kind: "step", id: str(e.id), tool: str(e.tool), line: str(e.line), state, ...(e.why !== undefined ? { why: str(e.why) } : {}) };
    }
    case "needs-you": return { kind: "needs-you", why: str(e.why), ...(e.sheet !== undefined ? { sheet: e.sheet } : {}) };
    case "receipt": return { kind: "receipt", ...(e.line !== undefined ? { line: str(e.line) } : {}) };
    case "facts": return { kind: "facts", facts: Array.isArray(e.facts) ? e.facts.filter((f): f is { mark: string; shown: string; rows: string[] } => !!f && typeof f === "object" && /^f\d{1,3}$/.test(String((f as { mark?: unknown }).mark)) && typeof (f as { shown?: unknown }).shown === "string" && Array.isArray((f as { rows?: unknown }).rows)).map((f) => ({ mark: f.mark, shown: f.shown, rows: f.rows.map(String) })) : [] };
    case "done": return { kind: "done" };
    case "fault": return { kind: "fault", line: str(e.line) };
    default: return null;
  }
}

export function applyEvent(thread: readonly AzMessage[], ev: ChatEvent, replyId: string): AzMessage[] {
  const at = thread.findIndex((m) => m.id === replyId);
  const reply: AzMessage = at >= 0 ? thread[at]! : { id: replyId, role: "assistant", parts: [], done: false };
  let parts = reply.parts;
  let done = reply.done;
  let facts = reply.facts;
  switch (ev.kind) {
    case "facts":
      facts = { ...facts, ...Object.fromEntries(ev.facts.map((f) => [f.mark, f])) };
      break;
    case "text": {
      if (!ev.delta) return [...thread];
      const last = parts.at(-1);
      parts = last?.type === "text" ? [...parts.slice(0, -1), { ...last, text: last.text + ev.delta }] : [...parts, { type: "text", text: ev.delta, ...(reply.facts ? { facts: reply.facts } : {}) }];
      break;
    }
    case "step": {
      const card: AzPart = { type: "step", id: ev.id, tool: ev.tool, line: ev.line, state: ev.state, ...(ev.why ? { why: ev.why } : {}) };
      const i = parts.findIndex((p) => p.type === "step" && p.id === ev.id);
      parts = i >= 0 ? parts.map((p, j) => (j === i ? card : p)) : [...parts, card];
      break;
    }
    case "needs-you":
      parts = [...parts, { type: "needs", why: ev.why, ...(ev.sheet !== undefined ? { sheet: ev.sheet } : {}) }];
      break;
    case "fault":
      parts = [...parts, { type: "fault", line: ev.line }];
      done = true;
      break;
    case "done":
      done = true;
      break;
    case "receipt":
      return [...thread];
  }
  const next: AzMessage = { ...reply, parts, done, ...(facts ? { facts } : {}) };
  return at >= 0 ? thread.map((m, j) => (j === at ? next : m)) : [...thread, next];
}

/** Stopped by the person: the reply keeps what came, a running card reads stopped, and one line says nothing else ran. */
export function stopReply(thread: readonly AzMessage[], replyId: string): AzMessage[] {
  return thread.map((m) => (m.id !== replyId ? m : { ...m, done: true, parts: [...m.parts.map((p) => (p.type === "step" && p.state === "running" ? { ...p, state: "refused" as const, why: "You stopped it." } : p)), { type: "fault", line: "Stopped. Nothing else ran." }] }));
}

/** H-2: the person asked about their own Activity or balances (what they spent, sent, paid, hold). */
export const asksMoney = (words: string): boolean => /\b(spen[dt]|spending|sent|paid|what did i|balances?|how much (?:do i|have i|money|is in)|worth|came in|come in|received|funded)\b/i.test(words);
/** Asked what came in (product decision, 3 Nov, "when I funded my wallet"): the sample demo reads money in. */
export const asksIn = (words: string): boolean => /\b(came in|come in|received|funded|deposit(?:ed|s)?|got paid)\b/i.test(words);
