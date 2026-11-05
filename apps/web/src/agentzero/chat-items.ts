// The real chat's list (the agent package's useChatTurn → ChatItem[], folded by foldChat) as the screen's messages: the
// person's words as their own bubble, and everything AgentZero did between two of them (its words, step cards, a sheet
// it needs a tap for, a fault) as one reply. Pure, so node tests it. A sheet's words here are ZeroFee's own, never the
// model's (review L1: a hostile model never writes a system line).
import type { ChatItem } from "@zerofee/agent/chat/use-chat-turn";
import type { ChatSheet } from "@zerofee/agent/chat/turn";
import type { AzMessage, AzPart } from "./chat-events.ts";
import { CHAT_LINE } from "@zerofee/agent/chat/chat-lines";

/** The watchdog's wait (product decision, 4 Nov): nothing on screen this long after Send, and the chat says so, with Try again. */
export const WATCH_MS = 10_000;
/** What counts as an answer on screen (a cost or a hidden key card alone is none). */
const SEEN = new Set(["agent", "step", "needs-you", "old-sheet", "say", "fault", "note", "stopped", "paused"]);
/**
 * The watchdog (pure): the line to show under the bubble `id` when nothing has answered it. While its turn runs (or the
 * wallet pays before it goes): the slow line once `slow` (WATCH_MS passed); once it ended with nothing on screen: the
 * held reply's line, or the silent one. null: answered, or nothing to say yet.
 */
export function quietLine(items: readonly ChatItem[], id: string | null, o: { running: boolean; slow: boolean }): string | null {
  if (!id) return null;
  const at = items.findIndex((i) => i.kind === "you" && i.id === id);
  if (at < 0) return o.running && o.slow ? CHAT_LINE.slow : null;
  const after = items.slice(at + 1);
  if (after.some((i) => SEEN.has(i.kind))) return null;
  if (o.running) return o.slow ? CHAT_LINE.slow : null;
  return after.some((i) => i.kind === "unpaid" && !i.stopped) ? CHAT_LINE.stillPaying : CHAT_LINE.silent;
}

/** A payment or act sheet's own amount, as ZeroFee writes it ("$5.00"); null for a sheet with no one amount. The chat
 *  shows this figure, never Claude's typed one, beside the proposal (QA, 3 Nov), and the line under it says the same. */
export function sheetUsd(s: unknown): string | null {
  const x = s as { kind?: unknown; usd?: unknown } | null;
  if (!x || (x.kind !== "pay" && x.kind !== "act" && x.kind !== "home")) return null;
  const n = Number(x.usd);
  // only a whole-cent amount a sheet could show as it is (review 5: 5.004 would read $5.00 while 5.004 moved; 1e21 would
  // read "$1e+21"): anything else is no figure in the chat, which then says Not known
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? `$${n.toFixed(2)}` : null;
}

/** What a sheet asks for, in ZeroFee's own words (the sheet itself, and the money, are the core's, on the tap). */
export function sheetLine(s: ChatSheet): string {
  switch (s.kind) {
    case "job": return "AgentZero needs your yes to start this job.";
    case "stop-job": return "AgentZero needs your yes to stop this job.";
    // never "needs your yes to pay": on a real account AgentZero can't pay yet, and the sheet says so (real-Claude walk)
    case "pay": { const usd = sheetUsd(s); return usd ? `A payment of ${usd}. Review it first; nothing moves without your tap.` : "A payment. Review it first; nothing moves without your tap."; }
    case "act": return "AgentZero asks to move money for you. Review it first.";
    case "browse": return "AgentZero needs your yes to open a site.";
    case "home": return s.line;
    case "plan": return s.plan.facts ?? s.plan.goal;
    case "plan-late": return "Check again, or stop the plan.";
    case "memory": return "AgentZero asks to remember this. Keep it?";
    case "routine": return "AgentZero needs your yes to start this routine.";
    default: return "AgentZero needs your yes.";
  }
}

/** ChatItem[] → messages; the last reply is still coming while `busy`. */
export function fromItems(items: readonly ChatItem[], busy: boolean): AzMessage[] {
  const out: AzMessage[] = [];
  let reply: AzMessage | null = null;
  /** Every figure so far (marks are unique across the conversation). Each text part keeps a copy of those known when it
   *  came: a mark written before its figure arrived never fills in later (review M4). */
  let facts: NonNullable<AzMessage["facts"]> = {};
  let any = false;
  /** The last bubble's own id: its reply is keyed by it, so a re-render or a Try again keeps one bubble and one reply. */
  let you: string | null = null;
  const replyId = (i: number) => (you ? `r${you}` : `a${i}`);
  /** A bubble from before ids (a saved chat): keyed by place, as before. */
  items.forEach((it, i) => {
    if (it.kind === "you") {
      if (reply) out.push(reply);
      reply = null;
      you = typeof it.id === "string" && it.id ? it.id : null;
      out.push({ id: you ?? `u${i}`, role: "user", parts: [{ type: "text", text: String(it.text) }], done: true });
      return;
    }
    // H-2's figures (ChatFact): no part of their own; the screen shows each in place of its {{fN}} mark (fact-text.ts)
    if (it.kind === "facts") {
      facts = { ...facts, ...Object.fromEntries(it.facts.map((f) => [f.mark, { mark: String(f.mark), shown: String(f.shown), rows: f.rows.map(String) }])) };
      any = true;
      reply ??= { id: replyId(i), role: "assistant", parts: [], done: true };
      return;
    }
    // the key card is the screen's own (live-chat.ts), never a line in the thread
    if (it.kind === "needs-key") return;
    // D152: a reply held until the last is paid: the wallet pays it and the words go again (live-chat.ts), no line here;
    // a STOPPED reply's cost comes this way (its own answer was cut): said under that reply, as "about" (SR3 L9)
    if (it.kind === "unpaid") {
      if (it.stopped && Number.isFinite(Number(it.turnUsd))) {
        const stoppedReply = [...out, ...(reply ? [reply] : [])].reverse().find((m) => m.role === "assistant" && !m.cost);
        if (stoppedReply) stoppedReply.cost = { turnUsd: Number(it.turnUsd), about: true };
      }
      return;
    }
    // L9: a paid call's cost goes on the reply it belongs to (its calls summed; the credit left after the last)
    if (it.kind === "cost") {
      reply ??= { id: replyId(i), role: "assistant", parts: [], done: true };
      reply.cost = { turnUsd: (reply.cost?.turnUsd ?? 0) + Number(it.turnUsd) };
      return;
    }
    if (it.kind === "paused") {
      reply ??= { id: replyId(i), role: "assistant", parts: [], done: true };
      reply.paused = true;
      return;
    }
    reply ??= { id: replyId(i), role: "assistant", parts: [], done: true };
    const part: AzPart =
      it.kind === "agent" ? { type: "text", text: String(it.text), ...(any ? { facts } : {}) }
      : it.kind === "step" ? { type: "step", id: String(it.id), tool: String(it.tool), line: String(it.line), state: it.state === "done" || it.state === "refused" ? it.state : "running", ...(it.why ? { why: String(it.why) } : {}) }
      : it.kind === "needs-you" ? { type: "needs", why: sheetLine(it.sheet), sheet: it.sheet, ...(it.stale ? { stale: true } : {}), ...(it.card ? { card: it.card } : {}) }
      // a money card from before a reload: what it saw, and what Activity says became of it (OldSheet)
      : it.kind === "old-sheet" ? { type: "needs", why: String(it.line), sheet: { kind: "old-sheet", line: String(it.line), was: it.was } }
      // ZeroFee's own line about a plan (plan.ts): its own look, as a sheet's line is (never the model's words)
      : it.kind === "say" ? { type: "needs", why: String(it.line) }
      : it.kind === "stopped" ? { type: "fault", line: "Stopped. Nothing else ran." }
      : it.kind === "note" ? { type: "fault", line: String(it.line) }
      : { type: "fault", line: String(it.line), ...(it.kind === "fault" && it.retry ? { retry: true } : {}), ...(it.kind === "fault" && it.fresh ? { fresh: true } : {}) };
    reply.parts.push(part);
  });
  if (reply) out.push(reply);
  // while a turn runs, its reply is open (thinking before its first item)
  if (busy) {
    const last = out.at(-1);
    if (last?.role === "assistant") last.done = false;
    else out.push({ id: replyId(items.length), role: "assistant", parts: [], done: false });
  }
  return out;
}
