// AgentZero's chat turn (D122): the API UI's Claude-app-style AgentZero app calls. One turn = the person's words in, a
// stream of ChatEvents out, ending in "done" with the conversation to keep.
//
// THE EVENTS (ChatEvent):
//   {kind:"text", delta}                                   Claude's words, as they stream.
//   {kind:"step", id, tool, line, state, why?}             A tool AgentZero is using, for the step card: one "running"
//                                                          when it starts, then the same id with "done" or "refused"
//                                                          (with `why`, a few words). `line` is AgentZero's own words.
//   {kind:"needs-you", why, sheet}                         A sheet the person must tap: a job, a payment, a stop, a
//                                                          browser task (start it with useLiveSession), an act.
//   {kind:"facts", facts}                                 H-2: read_activity's figures (ChatFact: the {{fN}} mark, the
//                                                          figure as shown, the rows it counts). Never in the history:
//                                                          Claude sees only the marks.
//   {kind:"fault", line}                                   Something failed, said by name ("Claude didn't answer.").
//   {kind:"needs-key", why}                                No key of the person's own and no free reading to use (none
//                                                          set up here, off, unreachable, used up or full): the screen
//                                                          shows its "Paste an AI key to start" card, not a fault line.
//   {kind:"allowance", usedUsd, limitUsd, turnUsd?, owed?} The reading's meter after a relay call; with per-reply payment
//                                                          on the relay (D152), this call's exact cost and what it owes.
//   {kind:"unpaid", owed}                                  The relay won't start a reply while the last one is unpaid
//                                                          (D152): what it owes, so the phone pays it and asks again.
//   {kind:"done", history}                                 The turn is over; keep `history` for the next one.
//
// THE RELAY'S STREAM (POST {relay}/v0/agentzero/chat {messages, today, model?, effort?}, Bearer <free sign-up token>, text/event-stream): each
// Anthropic stream event as `event: <type>` + `data: <its JSON>`, then `event: zerofee` `data: {"allowance":{…}}`, or on a
// failure mid-stream `event: zerofee_error` `data: {"line":"…"}` (apps/quotes/agentzero-chat.mjs).
//
// Nothing Claude reads is an order: a money tool only ever yields a needs-you sheet; the person's tap does it, through the
// paths that already exist (the job sheet, the pay sheet, Stop, useLiveSession, account.agent.act).
import { CHAT_LINE } from "./chat-lines.ts";
import type Anthropic from "@anthropic-ai/sdk";
import { freshNonce } from "../claude.ts";
import { DEFAULT_CHOICE, claudeChoice, type ClaudeChoice } from "./model.ts";
import { HIDES_ITS_WORDS, obfuscated, textHides } from "../guard/index.ts";
import type { JobTerms } from "../zero/jobs.ts";
import { checkReading, readPayOnce, signUpSaid, type Allowance } from "../zero/rulebox.ts";
import { ACT_MAX_USD } from "@zerofee/core/agent-route";
import { ACT_PLACES, CHAT_MAX_TOKENS, CHAT_SYSTEM, CHAT_TOOLS, READ_TOOLS } from "./tools.ts";
import { sseStream, type Stream } from "./relay-stream.ts";
import { SIM_HISTORY, SIM_PATH, SIM_REAL_LINE, SIM_RESTED_LINE, SIM_REST_CODES, SIM_VISITOR_CODE, SIM_VISITOR_LINE, simReal, simWords } from "./sim.ts";
import { wantsSite } from "./site-ask.ts";
import { memoryContext, memoryRefusal, type MemoryKind, type MemoryLine } from "../zero/memory.ts";
import { readRoutine, type RoutineTerms } from "../zero/routines.ts";
import { NOT_OFFERED_LINE, POCKET_CHOICES, isNearName, payListRuns } from "../zero/jobs.ts";
import { keepRuns } from "../zero/keep-read.ts";
import type { PriceAsk, QuoteAsk, SkillHands } from "./skills.ts";
import { ALL_WORDS, PLACE_WORD, SHOWN, moveLeast, addSheet, moveSheet, requestSheet, sendSheet, swapSheet, tradeSheet, tradeWant, appFound, type HomePlace, type HomeSheet } from "./home-ask.ts";
import { maskMessages, unmaskInput, unmaskStream } from "./standins.ts";
import { quickWord } from "./plan.ts";
import { againPlan, askedPlan, attachSheet, coinAmountSaid, dropPlan, fit, fromSaid, pickSource, live, nextPlan, planContext, quickPlan, shareSaid, shareUsd, startPlan, wordsDone, type Balances, type Plan, type PlanMove, type TaggedSheet } from "./plan.ts";
import { LIMITS, Stopped, isTimedOut, linked, paced, timedOutLine, within, withinOr } from "./wait.ts";

export type ChatMessage = Anthropic.MessageParam;
/** A sign-up the relay refused without its own line, or one that didn't answer (crawl S2: never a blank chat). */
export const SIGNUP_REFUSED = "AgentZero can't start here today. Try again tomorrow.";
export const SIGNUP_UNANSWERED = "ZeroFee didn't answer. Try again in a minute.";
export type StepState = "running" | "done" | "refused";
export type ChatSheet =
  | { kind: "job"; terms: JobTerms }
  | { kind: "pay"; to: string; usd: number }
  | { kind: "stop-job"; job: string }
  | { kind: "browse"; task: string; url: string | null }
  | { kind: "act"; act: string; from: string; to: string | null; usd: number }
  /** "Remember this?" (A-11): kept only on the person's Keep. */
  | { kind: "memory"; memory: MemoryKind; text: string }
  /** A routine ("every Friday …", "tell me if SOL drops 20%"), read by our own code only (A-2), never by a model. */
  | { kind: "routine"; terms: RoutineTerms }
  /** Home's own sheet, filled in (home-ask.ts): Send, Swap, Move, Add, Request, or Trade's market. The person's Face ID
   *  does it; AgentZero never draws a money sheet and never signs. */
  | ({ kind: "home" } & TaggedSheet)
  /** A plan (plan.ts): ZeroFee's facts and the shortest fix as numbered steps, started by the person's Start or yes. */
  | { kind: "plan"; plan: Plan }
  /** A plan's step waited past the runner's limit for its money (plan-runner.ts): Check again, or Stop the plan. */
  | { kind: "plan-late"; plan: string };
/** H-2: one figure read_activity worked out on the device. Claude sees only `mark`; the screen shows `shown` in its
 *  place and a tap opens `rows` (Activity's own ids). */
export interface ChatFact {
  mark: string;
  shown: string;
  rows: string[];
}
/** What the model may ask read_activity (each part checked before the device reads anything). */
export interface ActivityAsk {
  from?: string;
  to?: string;
  way?: "out" | "in" | "all";
  who?: string;
  coin?: string;
}
export type ChatEvent =
  | { kind: "text"; delta: string }
  | { kind: "facts"; facts: ChatFact[] }
  | { kind: "step"; id: string; tool: string; line: string; state: StepState; why?: string }
  | { kind: "needs-you"; why: ChatSheet["kind"]; sheet: ChatSheet }
  /** `retry`: a Try again beside it (the same words go again); none where trying again can't help (money, a full chat). */
  /** `fresh`: the Try again signs in anew first (the relay can't read this phone's sign-in any more). */
  | { kind: "fault"; line: string; retry?: true; fresh?: true }
  | { kind: "needs-key"; why: NeedsKey }
  | { kind: "allowance"; usedUsd: number; limitUsd: number; turnUsd?: number; owed?: ReplyOwed }
  /** D152: the relay holds the next reply until the last one is paid; what it owes, for the phone to pay. */
  | { kind: "unpaid"; owed: ReplyOwed }
  /** AgentZero said no to a money ask (the device keeps a refused receipt for it); the screen shows the words already said. */
  | { kind: "refused"; line: string }
  /** A line from ZeroFee itself, said once in the thread (the oldest messages set aside). */
  | { kind: "note"; line: string }
  /** AgentZero's own wallet (L9): a tool loop stopped before its next call for want of money; what it did so far is kept. */
  | { kind: "paused" }
  /** The chat's plan as it now is (plan.ts): the device keeps it with the chat and sends it back with the next turn. */
  | { kind: "plan"; plan: Plan }
  /** A line from ZeroFee itself about a plan or a check (its facts, why a step paused): our code's words, never Claude's. */
  | { kind: "say"; line: string }
  /** Audit L16: the chat's stand-ins grew; the device keeps the list with the chat. */
  | { kind: "stand-ins"; list: string[] }
  | { kind: "done"; history: ChatMessage[] };
/** Why the chat needs the person's own key: none and no free reading here, free reading off or unreachable, used up, full. */
export type NeedsKey = "no-key" | "off" | "used-up" | "full";

/** What the device lends a turn: the read tools' answers (plain lines), and whether account.agent.act is on. */
export interface ChatHands {
  receipts(): Promise<string>;
  meter(): Promise<string>;
  /** AgentZero's mailbox, opened on the device; absent until the mailbox exists. */
  mail?(): Promise<string>;
  /** H-2: the person's own activity, worked out on the device. `text` (to Claude): kind, date, coin, dollars, {{fN}} marks
   *  and a stand-in per payee ("p3"), never a name or an address (activityText strips any that slip); a name the person
   *  typed (`who`) is matched here, on the phone. `facts`: the figures as shown, for the screen only. */
  activity?(q: ActivityAsk): Promise<{ text: string; facts: ChatFact[] }>;
  actOn?: boolean;
  /** The read-only skills (skills.ts): prices, trending, holdings, a dry swap price, services, coins. Each answers plain
   *  lines on the phone (own key and free reading alike); absent: the tool says it can't here. */
  skills?: Partial<SkillHands>;
  /** W7: the tool names this device offers (tools.ts webTools on the web wallet); absent: every tool. The relay is sent
   *  the same list, so the model never sees a tool that can't work here. */
  offered?: readonly string[];
  /** The web wallet (its Send is approved with the password); unset: read from `offered` as before. */
  web?: boolean;
}

/** W7: an ask to open a site on the web wallet (the copy review's words, pending): browse is the phone app's there. */
export const WEB_BROWSE_LINE = "Opening sites works in the phone app, not here yet.";
/** E2: a site ask on the phone while AgentZero's browser is off in this build. */
export const SITES_OFF_LINE = "AgentZero can't open sites yet.";
/** W7: the relay's refusal of a request shape it doesn't know (apps/quotes agentzero-chat.mjs, before `tools`). */
const OLD_SHAPE_CODE = "quotes.request.refused";

/** The plain-words pay path's line: the phone's sheet is Face ID; the web wallet's (W7: it names its tools) the password. */
export const readyLine = (web: boolean): string => (web ? "Home's Send is filled in. Approve it with your password." : "Home's Send is ready for your Face ID.");

/** A tool this device didn't offer, called anyway (an old relay that sent every tool): said in one line, nothing done. */
export const NOT_OFFERED = "AgentZero can't do that here. Nothing moved.";

export interface ChatOptions {
  relayBase: string | null;
  hands: ChatHands;
  /** The person's own Claude key: this device asks Anthropic with it, never the relay. */
  ownKey?: string | null;
  token?: string | null;
  /** D37: AgentZero's own NEAR account (64 hex): the relay reads its USDC and answers only when that covers the reply. */
  account?: string | null;
  /** QA: AgentZero's key's proof that the sign-up's id is its own (128 hex), for the relay's binding; null: none. */
  bindFor?: (token: string) => Promise<string | null>;
  saveToken?: (token: string) => Promise<void>;
  fetch?: typeof fetch;
  /** For tests only: the fetch the own-key path hands Anthropic's SDK. */
  anthropicFetch?: typeof fetch;
  /** Stop: aborts the request itself (the relay's fetch, or the SDK's stream), so no more tokens are spent. After it the
   *  turn ends with no further events. */
  signal?: AbortSignal;
  /** AgentZero's memory (A-11), sent with each request as data ("memory, not orders"), never kept in the history. */
  memory?: readonly MemoryLine[];
  /** AgentZero's own wallet (L9): asked before each FURTHER relay call of a tool loop (auto top-up inside the cap); false
   *  pauses the turn ("paused"), keeping what it did so far. Never asked on the person's own key, nor for a turn's first call. */
  beforeCall?: () => Promise<boolean>;
  /** The person's choice of Claude (model.ts): checked against the allow-list here; anything else is the default. */
  model?: string;
  effort?: string;
  /** The chat's plan (plan.ts), kept on the device: said to Claude as data each turn; the person's short word to it (yes,
   *  no, again) is done in our own code with no model call. */
  plan?: Plan | null;
  /** `words` are ZeroFee's own note (a plan step landed or stopped), not the person's: never read as their words. */
  note?: boolean;
  /** ZeroFee's record of the money cards that ended since the last turn (use-chat-turn cardRecord): said as data with
   *  the plan's record, kept in the thread, so "did it go?" is answered from what the card saw. */
  cards?: string | null;
  /** Audit L16: this chat's stand-ins (a1 = the first address or name masked), append-only and kept with the chat. What
   *  goes to Claude holds stand-ins only; Claude's words and tool calls are turned back on the phone. */
  standIns?: readonly string[];
  /** The Sim (D157): the same turn on the Sim's own money, its Claude the relay's Sim route (no sign-up, no key, no
   *  payment); what only the iPhone app does for real ends in one honest line (sim.ts). */
  sim?: boolean;
}

/** The Sim's request (D157): ZeroFee's own lines in the thread (tool results, its own replies) in the browser's approval
 *  words, never Face ID. The same on every request, so the thread Claude reads never changes under it. */
export const simThread = (ms: readonly ChatMessage[]): ChatMessage[] =>
  ms.map((m) => {
    if (typeof m.content === "string") return m.role === "assistant" ? { ...m, content: simWords(m.content) } : m;
    return { ...m, content: m.content.map((b) => (b.type === "tool_result" && typeof b.content === "string" ? { ...b, content: simWords(b.content) } : b.type === "text" && m.role === "assistant" ? { ...b, text: simWords(b.text) } : b)) as typeof m.content };
  });

/** At most this many model calls in one turn (read tools may loop; a sheet ends it). */
export const MAX_ROUNDS = 5;

const STEP_LINE: Record<string, string> = {
  propose_job: "Setting up a job",
  stop_job: "Getting a job ready to stop",
  propose_payment: "Getting a payment ready",
  read_receipts: "Reading receipts",
  read_meter: "Checking AgentZero's wallet",
  read_mail: "Reading mail",
  read_activity: "Reading your activity",
  browse: "Getting the browser ready",
  propose_act: "Getting it ready",
  remember: "Getting a note ready",
  market_price: "Checking prices",
  market_trending: "Checking what's trending",
  read_holdings: "Reading your wallets",
  quote_dry: "Pricing a swap",
  service_status: "Checking services",
  covered_coins: "Checking coins",
  send: "Getting Send ready",
  swap: "Getting Swap ready",
  move: "Getting Move ready",
  add: "Getting Add ready",
  request: "Getting Request ready",
  trade: "Opening Trade",
  plan: "Planning",
};

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The person's day, on their phone (real-Claude walk, 3 Nov: asked "What did I spend this week?", Claude didn't know
 *  the date, read from the very start and called it "this week"). Said with each request; the prompt itself is fixed. */
export const todayLine = (now: Date = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Today on the person's phone is ${WEEKDAY[now.getDay()]} ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}. A week starts on Monday. For "this week", "this month" or "today", give read_activity the dates.`;
};

/** The phone's own day, "YYYY-MM-DD": the relay says it to Claude as todayLine does (apps/quotes/agentzero-chat.mjs dayLine). */
const phoneDay = (now: Date = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/**
 * Prompt caching (review, 3 Nov: ~88% of a message's cost was input, sent again in full each time). Three
 * breakpoints, the same rule as the relay's (apps/quotes/agentzero-chat.mjs cacheMarks; a test holds them equal):
 *   1. the fixed system prompt (after the tools, which come first): nothing that changes sits before it; the person's
 *      day line is the second system block, after it;
 *   2. the last assistant message (the end of the thread so far), so each new message reads the thread from cache;
 *   3. the request's last message (a tool loop's next round reads this round's).
 * Model-agnostic (a cache is per model by itself). A copy for the request only: the kept history is never changed.
 */
export const CACHE = { type: "ephemeral" as const };
export function cacheMarks(messages: readonly ChatMessage[]): ChatMessage[] {
  const out = messages.map((m) => m);
  const mark = (i: number) => {
    const m = out[i];
    if (!m) return;
    const blocks: Anthropic.ContentBlockParam[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content];
    // the last block that can carry a mark (never a thinking block)
    for (let b = blocks.length - 1; b >= 0; b--) {
      const x = blocks[b]!;
      if (x.type === "thinking" || x.type === "redacted_thinking") continue;
      if (x.type === "text" && !x.text) continue;
      blocks[b] = { ...x, cache_control: CACHE } as Anthropic.ContentBlockParam;
      out[i] = { ...m, content: blocks };
      return;
    }
  };
  let lastAssistant = -1;
  for (let i = out.length - 1; i >= 0; i--) if (out[i]!.role === "assistant") { lastAssistant = i; break; }
  if (lastAssistant >= 0) mark(lastAssistant);
  if (out.length - 1 !== lastAssistant) mark(out.length - 1);
  return out;
}

export const chatRequest = (messages: ChatMessage[], now: Date = new Date(), choice: ClaudeChoice = DEFAULT_CHOICE) => ({
  model: choice.model,
  max_tokens: CHAT_MAX_TOKENS,
  thinking: { type: "adaptive" as const },
  output_config: { effort: choice.effort },
  system: [{ type: "text" as const, text: CHAT_SYSTEM, cache_control: CACHE }, { type: "text" as const, text: todayLine(now) }],
  tools: CHAT_TOOLS as unknown as Anthropic.Tool[],
  messages: cacheMarks(messages),
});

/** The most AgentZero may spend in 24 hours for its own jobs (the funding page's top amount; the account's own band agrees). */
export const POCKET_MAX_USD = Math.max(...POCKET_CHOICES);
/** Said, never proposed, for a payment or a job above it (real-Claude walk, 3 Nov: "$5,000 in 24 hours" got "Sure"). */
export const overLimitLine = (usd: number): string => `That's more than AgentZero can spend: it spends at most $${POCKET_MAX_USD}.00 in 24 hours for its own jobs, so it won't set that up. ${usd > POCKET_MAX_USD ? "For a bigger payment, use Send in Chat. " : ""}Nothing moved.`;
/** What Claude reads in the history for a routine the app showed (real-Claude walk: with no tool for it, Claude later
 *  told the person "I said those were on a sheet, but they weren't"). */
export const ROUTINE_SHOWN = "ZeroFee itself read that as a routine and showed it on a routine sheet (routines need no tool). It starts only on the person's tap.";
/** AgentZero never takes money out of the Safe (its act sheet says "Never your Safe"). */
export const SAFE_LINE = "AgentZero never takes money out of your Safe. Move it yourself in ZeroFee. Nothing moved.";
/** Why words were refused unread, said plainly (stress walk, 3 Nov: a Cyrillic "і" in "kіm.near" read "That request
 *  hides its words"): look-alike letters, hidden characters, or else the guard's own line. */
export const LOOKALIKE_LINE = "That has look-alike letters from another alphabet, so it may not be who you think. AgentZero won't act on it. Nothing moved.";
export const HIDDEN_CHARS_LINE = "That message has hidden characters in it. AgentZero won't act on it. Nothing moved.";
export function hiddenLine(words: string): string {
  if (words.split(/[\s,;:()"'<>]+/).some((w) => /[A-Za-z]/.test(w) && /[Ѐ-ӿͰ-Ͽ]/.test(w))) return LOOKALIKE_LINE;
  if (/[​-‏⁠-⁤﻿‪-‮⁦-⁩]|\udb40[\udc00-\udc7f]/.test(words)) return HIDDEN_CHARS_LINE;
  return HIDES_ITS_WORDS;
}
/** How much conversation goes with a request, as JSON characters (context walk, 3 Nov: the history grew without end;
 *  the free reading refuses a body over 64 KB, and a long thread costs the person every turn). Over it, the oldest whole
 *  turns are set aside down to SET_ASIDE_TO, and the person is told once. */
export const HISTORY_MAX_CHARS = 48_000;
const SET_ASIDE_TO = 32_000;
export const SET_ASIDE_LINE = "This chat is long, so AgentZero set its oldest messages aside. Ask it to remember anything it should keep.";
export const TOO_LONG_LINE = "This chat got too long for Claude, so AgentZero set its older messages aside. Send it again. Nothing moved.";
/** The history kept for a request: whole turns only (a turn starts at the person's own words), newest kept. */
export function trimHistory(h: readonly ChatMessage[], max = HISTORY_MAX_CHARS, to = SET_ASIDE_TO): { kept: ChatMessage[]; dropped: number } {
  const size = (ms: readonly ChatMessage[]) => JSON.stringify(ms).length;
  if (size(h) <= max) return { kept: [...h], dropped: 0 };
  const starts = h.map((m, i) => (m.role === "user" && typeof m.content === "string" ? i : -1)).filter((i) => i > 0);
  for (const i of starts) if (size(h.slice(i)) <= to) return { kept: h.slice(i), dropped: i };
  const last = starts.at(-1);
  return last === undefined ? { kept: [], dropped: h.length } : { kept: h.slice(last), dropped: last };
}
/** A payment needs a payee the chat can name and an amount the person said in dollars. */
/** The browser's own line while mail isn't on (packages/browser agent/phone.ts NO_MAIL_LINE; a test holds them equal). */
export const NO_MAIL_LINE = "AgentZero's email isn't on yet, so it can't sign up with it. Nothing was sent.";
const SIGN_UP = /\b(?:sign(?:ing)?[\s-]?(?:me\s+)?up|register|create\s+(?:an?\s+|my\s+)?account|make\s+(?:an?\s+|my\s+)?account|join)\b/i;
/** AgentZero's own email, as the browser reads it (phone.ts WANTS_OWN_MAIL): "your email", "AgentZero's inbox". */
const OWN_MAIL = /\b(your|agentzero'?s|its own|the agent'?s)\s+(own\s+)?(encrypted\s+|private\s+)?(e-?mail|inbox|mailbox)\b/i;
/** A sign-up that asks for AgentZero's own email (never the person's: "with my email" goes to Claude). */
export const wantsOwnMailSignUp = (words: string): boolean => SIGN_UP.test(words) && OWN_MAIL.test(words);
export const WHO_LINE = "Who should get it? Say their NEAR name (it ends in .near) or paste their address. Nothing moved.";
export const HOW_MUCH_LINE = "How much, in dollars? Say it like $5. Nothing moved.";
export const ONE_AT_A_TIME = "One thing at a time. Ask for the next one after this.";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DOLLAR_WORD = /[$＄]|\b(?:dollars?|dolars?|dollers?|usd|usdc|bucks?)\b|dólar|ดอลลาร์|ڈالر/i;
/** The person said dollars, and if they wrote digits, this amount is among them ("send 5 to kim" says no unit). */
export const dollarsSaid = (words: string, usd: number): boolean => {
  if (!DOLLAR_WORD.test(words)) return false;
  const nums = [...words.replace(/(?<=\d),(?=\d{3}\b)/g, "").matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => Number(m[0]));
  return nums.length === 0 || nums.some((n) => Math.abs(n - usd) < 0.005);
};
/** The tools that would end in money moving: each refusal of one is a receipt. */
const MONEY_TOOLS = new Set(["propose_job", "stop_job", "propose_payment", "propose_act", "send", "swap", "move", "add", "request", "trade"]);
/** Words that ask for something to happen (a routine's "cannot" is said only for these; a question goes to Claude). */
const ASKS_TO_DO = /\b(?:move|pay|send|tell|notify|warn|ping|remind|put|sweep|let me know)\b/i;

type Outcome = { result: string; state: Exclude<StepState, "running">; why?: string; sheet?: ChatSheet; facts?: ChatFact[]; say?: string };
/** The plan as a turn changes it (runTool reads and sets it); `changed` tells chatTurn to hand the device the new one. */
type PlanBox = { plan: Plan | null; changed: boolean };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MARK = /^f\d{1,3}$/;
/** read_activity's ask, checked: a malformed part refuses (the model asks again); nothing else reaches the device. */
export function activityAsk(input: Record<string, unknown>): ActivityAsk | string {
  const q: ActivityAsk = {};
  for (const k of ["from", "to"] as const) {
    const v = input[k];
    if (v === undefined) continue;
    if (typeof v !== "string" || !DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) return "Those dates couldn't be read.";
    q[k] = v;
  }
  if (q.from && q.to && q.from > q.to) return "Those dates couldn't be read.";
  if (input.way !== undefined) {
    if (input.way !== "out" && input.way !== "in" && input.way !== "all") return "That couldn't be read.";
    q.way = input.way;
  }
  if (input.who !== undefined) {
    if (typeof input.who !== "string" || !input.who.trim() || input.who.length > 64 || obfuscated(input.who)) return "That name couldn't be read.";
    q.who = input.who.trim();
  }
  if (input.coin !== undefined) {
    if (typeof input.coin !== "string" || !/^[A-Za-z0-9.$]{1,12}$/.test(input.coin)) return "That coin couldn't be read.";
    q.coin = input.coin;
  }
  return q;
}
/** What Claude reads (QA, H-2): kind, date, coin, dollars and a stand-in per payee ("p3"); the phone keeps p→name. A
 *  NEAR name, an address (NEAR, EVM, Solana, Bitcoin) or an email the device let slip becomes "someone" here, Hidden or
 *  Plain, so none reaches Claude or the relay. At most 6,000 characters (the relay's own limit is 8,000). */
export const activityText = (text: string): string =>
  text
    .replace(/[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}/gi, "someone")
    .replace(/\b[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*\.(?:near|tg|testnet)\b/gi, "someone")
    .replace(/\b0x[0-9a-f]{40}\b/gi, "someone")
    .replace(/\b[0-9a-f]{64}\b/gi, "someone")
    .replace(/\b(?:bc1|tb1)[02-9ac-hj-np-z]{11,71}\b/gi, "someone")
    .replace(/\b[1-9A-HJ-NP-Za-km-z]{25,44}\b/g, "someone")
    .slice(0, 6_000);
const cleanFacts = (facts: unknown): ChatFact[] =>
  Array.isArray(facts)
    ? facts
        .filter((f): f is ChatFact => !!f && typeof f === "object" && typeof f.mark === "string" && MARK.test(f.mark) && typeof f.shown === "string" && Array.isArray(f.rows) && f.rows.every((r: unknown) => typeof r === "string"))
        .slice(0, 50)
        .map((f) => ({ mark: f.mark, shown: f.shown, rows: [...f.rows] }))
    : [];

/** A figure in a skill's answer: a clock time, dollars, a percent, seconds, or an amount of a coin by its ticker. */
const FIGURE = /\b\d{1,2}:\d{2}\s?(?:AM|PM)\b|\$\d[\d,]*(?:\.\d+)?(?:[KMB]\b)?|\b\d[\d,]*(?:\.\d+)?%|\b\d+ s\b|\b\d[\d,]*(?:\.\d+)?\s(?=[A-Z][A-Z0-9]{1,9}\b)[A-Z][A-Z0-9]{1,9}\b/g;
/** The first mark a skill's figures take in a conversation: past any mark already in it, and from f500 up, apart from
 *  read_activity's own count (which starts at f1 on each page). */
export function firstSkillMark(messages: readonly ChatMessage[]): number {
  let n = 499;
  for (const m of JSON.stringify(messages).matchAll(/\{\{f(\d{1,3})\}\}/g)) n = Math.max(n, Number(m[1]));
  return n + 1;
}
/**
 * H-2 for the skills: each figure in a skill's answer becomes a {{fN}} mark and the phone keeps the figure (ChatFact,
 * no rows). In an answer about the person's money the screen shows only the phone's figures ("Not known" for any Claude
 * typed), so a balance, a price or a time read here reaches the screen exactly as read. At most f999.
 */
export function markFigures(text: string, next: () => string | null): { text: string; facts: ChatFact[] } {
  const facts: ChatFact[] = [];
  const out = text.replace(FIGURE, (fig) => {
    const mark = next();
    if (!mark) return fig;
    facts.push({ mark, shown: fig, rows: [] });
    return `{{${mark}}}`;
  });
  return { text: out, facts };
}

const SYMBOL = /^\$?[A-Za-z0-9.]{1,12}$/;
/** market_price's ask, checked: 1 to 5 coin symbols and an optional range; anything else refuses (the model asks again). */
export function priceAsk(input: Record<string, unknown>): PriceAsk | string {
  const coins = input.coins;
  if (!Array.isArray(coins) || coins.length < 1 || coins.length > 5 || !coins.every((c) => typeof c === "string" && SYMBOL.test(c.trim()))) return "Those coins couldn't be read. Name up to 5 by symbol, like SOL.";
  if (input.range !== undefined && input.range !== "7d" && input.range !== "30d") return "The range is 7d or 30d.";
  return { coins: coins.map((c) => String(c).trim()), ...(input.range ? { range: input.range as "7d" | "30d" } : {}) };
}
/** quote_dry's ask, checked: dollars over 0 and at most QUOTE_MAX_USD, two coin symbols. */
export function quoteAsk(input: Record<string, unknown>): QuoteAsk | string {
  const usd = Number(input.usd);
  if (typeof input.usd !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > 10_000) return "That amount couldn't be read. Say it in dollars, up to $10,000.";
  for (const k of ["pay", "get"] as const) if (typeof input[k] !== "string" || !SYMBOL.test(String(input[k]).trim())) return "Those coins couldn't be read. Name them by symbol, like USDC and SOL.";
  return { usd, pay: String(input.pay).trim(), get: String(input.get).trim() };
}

/** The last thing said to the person in the thread (an assistant turn's words), for a yes to it. */
export function lastSaid(messages: readonly ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    return typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  }
  return "";
}

/** The person's own words in this chat, newest last (their last four messages): "sol pls, like 5$", then the address, is one
 *  ask. Only what they typed: never a tool's answer or Claude's words. */
export function personWords(messages: readonly ChatMessage[]): string {
  return messages.filter((m) => m.role === "user" && typeof m.content === "string").slice(-4).map((m) => m.content as string).join("\n");
}

/** Words that make an act AgentZero's own job (its wallet, a job, a rule it keeps); anything else is the person's own ask. */
const JOB_WORDS = /\b(?:agentzero'?s?\s+(?:own\s+)?(?:job|wallet|money)|its own|a job|the job|every\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|keep\s+\$|pocket\s+money|on its own|by itself|automatically)\b/i;
/** Said when 1Click is down and a swap (or a Move through it) was asked; a yes sets "tell me when 1Click is back". */
export const SWAP_DOWN_LINE = "The swap service isn't answering right now, so the swap can't go. Nothing moved. Want me to tell you when it's back?";
export const SWAP_BACK_WORDS = "tell me when the swap service is back";
/** A swap, or a Move between the Safe or a wallet and the SOL or ETH (RH) wallet: both go through 1Click. */
const needsSwapService = (a: HomeSheet["ask"]): boolean => a.kind === "swap" || (a.kind === "move" && [a.from, a.to].some((p) => p === "sol" || p === "hood"));
/** 1Click answering (skills swapsUp), within the core's own wait; null when it can't be read in time. */
async function swapsUpOf(hands: ChatHands): Promise<boolean | null> {
  const f = hands.skills?.swapsUp;
  if (!f) return null;
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([f().catch(() => null), new Promise<null>((r) => (t = setTimeout(() => r(null), LIMITS.core)))]).finally(() => clearTimeout(t));
}

/** What Claude reads back when ZeroFee showed a plan (plan.ts fit): the turn ends; the person's Start or yes runs it. */
export const PLAN_SHOWN = "ZeroFee showed the person the facts and a plan with a Start button (it starts on their Start or yes, one step at a time, each on its own sheet). Say nothing more now.";
/** What Claude reads back when no place had enough and ZeroFee showed Add. */
export const SHORT_SHOWN = "ZeroFee said this to the person and showed Add. Say nothing more now.";
const PLACE_NAMES: Record<string, string> = { safe: "Your Safe", sol: "Your SOL wallet", hood: "Your Robinhood wallet", near: "Your NEAR wallet" };
/** Where a sheet's money comes from (plan.ts sourceOf), for a share. */
const sourceOfAsk = (h: HomeSheet): HomePlace | null => (h.ask.kind === "send" ? (h.ask.wallet ?? (h.ask.coin === "SOL" ? "sol" : h.ask.coin === "ETH" ? "hood" : h.ask.coin === "NEAR" || h.ask.coin === "USDC" ? "near" : null)) : h.ask.kind === "swap" ? (h.ask.wallet ?? null) : h.ask.kind === "move" ? h.ask.from : null);
/** A read that failed once (a timeout, a chunk that didn't load) is asked once more after a moment; then its own failure. */
export async function twice<T>(f: () => Promise<T>, waitMs = 400): Promise<T> {
  try {
    return await f();
  } catch {
    await new Promise((r) => setTimeout(r, waitMs));
    return f();
  }
}
/** What each place holds now (skills balances), asked twice; null when it can't be read (then nothing is blocked). */
async function balancesOf(hands: ChatHands): Promise<Balances | null> {
  const b = hands.skills?.balances;
  return b ? twice(() => b()).catch(() => null) : null;
}
/** A mail's digit runs of 4 or more (a code, even split as "123 456" or "12-34"), blanked before the mail is fenced to
 *  Claude (D86: codes never go to the model; audit L19). Any script's digits; linear (digits and separators don't overlap). */
const CODE_RUN = /\p{Nd}(?:[ \-\u00a0]?\p{Nd}){3,}/gu;
export const blankCodes = (text: string): string => text.replace(CODE_RUN, "••••");

/** One tool call, through existing paths only: reads answer, everything else becomes a sheet. Never a payment. */
async function runTool(name: string, input: Record<string, unknown>, words: string, hands: ChatHands, mark: () => string | null = () => null, asked: string = words, box: PlanBox = { plan: null, changed: false }): Promise<Outcome> {
  const no = (why: string): Outcome => ({ result: why, state: "refused", why });
  const setPlan = (p: Plan | null) => ((box.plan = p), (box.changed = true));
  const fenced = (text: string) => {
    const n = freshNonce();
    return `<data-${n}>\n${text}\n</data-${n}>`;
  };
  if (hands.offered && !hands.offered.includes(name)) return no(NOT_OFFERED);
  switch (name) {
    case "read_receipts":
      return { result: fenced(await hands.receipts()), state: "done" };
    case "read_meter":
      return { result: fenced(await hands.meter()), state: "done" };
    case "read_mail":
      return hands.mail ? { result: fenced(blankCodes(await hands.mail())), state: "done" } : no("No mailbox yet.");
    case "read_activity": {
      if (!hands.activity) return no("Can't read your activity here.");
      const q = activityAsk(input);
      if (typeof q === "string") return no(q);
      const a = await hands.activity(q);
      return { result: fenced(activityText(String(a.text ?? ""))), state: "done", facts: cleanFacts(a.facts) };
    }
    case "market_price":
    case "market_trending":
    case "read_holdings":
    case "quote_dry":
    case "service_status":
    case "covered_coins": {
      const k0 = hands.skills;
      // a read that threw (a timeout, a chunk that didn't load) is asked once more before it's said it couldn't
      const k = k0 ? (Object.fromEntries(Object.entries(k0).map(([n, f]) => [n, typeof f === "function" ? (...a: unknown[]) => twice(() => (f as (...x: unknown[]) => Promise<unknown>)(...a)) : f])) as typeof k0) : k0;
      // every answer through activityText too: no NEAR name, address or email ever reaches Claude from a skill
      const said = (text: string): Outcome => {
        const m = markFigures(activityText(text), mark);
        return { result: fenced(m.text), state: "done", facts: m.facts };
      };
      const cant = no("AgentZero can't read that here.");
      if (name === "market_price") {
        if (!k?.prices) return cant;
        const q = priceAsk(input);
        return typeof q === "string" ? no(q) : said(await k.prices(q).catch(() => "Couldn't get prices right now. Never guess them."));
      }
      if (name === "market_trending") {
        if (!k?.trending) return cant;
        if (input.chain !== "solana" && input.chain !== "near") return no("The chain is solana or near.");
        return said(await k.trending(input.chain).catch(() => "Couldn't get what's trending right now."));
      }
      if (name === "read_holdings") return k?.holdings ? said(await k.holdings().catch(() => "The wallets couldn't be read right now. Never guess.")) : cant;
      if (name === "quote_dry") {
        if (!k?.quote) return cant;
        const q = quoteAsk(input);
        return typeof q === "string" ? no(q) : said(await k.quote(q).catch(() => "Couldn't price that swap right now. Nothing moved."));
      }
      if (name === "service_status") return k?.services ? said(await k.services().catch(() => "The services couldn't be checked right now.")) : cant;
      return k?.coins ? said(await k.coins().catch(() => "The coins couldn't be read right now.")) : cant;
    }
    case "propose_job": {
      const r = checkReading(input, words);
      if (r.kind !== "job") return no(r.kind === "cannot" ? r.line : "That isn't one of AgentZero's jobs.");
      // a job that can't run isn't shown as if it could (keep-read.ts keepRuns), even if the model names it from an older tool list
      if ((r.terms.kind === "keep" && !keepRuns()) || (r.terms.kind === "pay-list" && !payListRuns())) return no(NOT_OFFERED_LINE);
      if (r.terms.kind !== "sign-in" && r.terms.perDayUsd > POCKET_MAX_USD) return no(overLimitLine(r.terms.perDayUsd));
      return { result: "Shown to the person to approve.", state: "done", sheet: { kind: "job", terms: r.terms } };
    }
    case "stop_job": {
      const k = String(input.kind ?? "");
      if (!["copy", "keep", "pay-list", "sign-in"].includes(k)) return no("That isn't one of AgentZero's jobs.");
      return { result: "Shown to the person to stop.", state: "done", sheet: { kind: "stop-job", job: k } };
    }
    case "propose_payment": {
      const to = typeof input.to === "string" ? input.to.trim() : "";
      const usd = Number(input.usd);
      if (!to || to.length > 128 || obfuscated(to)) return no("That payee couldn't be read.");
      if (!Number.isFinite(usd) || usd <= 0 || usd > 1000) return no("That amount couldn't be read.");
      // real-Claude stress walk, 3 Nov: "send 5 to kim" became a $5 sheet for "kim"; "kim.neer" a sheet for a name that
      // can't exist. The payee is a NEAR name or an address, and the amount is one the person said in dollars.
      if (!isNearName(to) && !EVM_ADDRESS.test(to)) return no(to.includes(".") ? `${to} isn't a NEAR name. NEAR names end in .near. Nothing moved.` : WHO_LINE);
      if (!dollarsSaid(words, usd)) return no(HOW_MUCH_LINE);
      if (usd > POCKET_MAX_USD) return no(overLimitLine(usd));
      return { result: "Shown to the person to tap Pay.", state: "done", sheet: { kind: "pay", to, usd: Math.round(usd * 100) / 100 } };
    }
    case "browse": {
      const task = typeof input.task === "string" ? input.task.trim() : "";
      const url = typeof input.url === "string" && /^https:\/\/[^\s]+$/.test(input.url) ? input.url : null;
      if (!task || task.length > 500 || textHides(task)) return no("That task couldn't be read.");
      return { result: "The person starts it in the browser.", state: "done", sheet: { kind: "browse", task, url } };
    }
    case "propose_act": {
      // The person's own move is Home's Move on their Face ID, never one of AgentZero's acts (a phone ask, 3 Nov: a plain
      // $10 move to ETH (RH) became an act, which asked for an account update). An act is only for AgentZero's own job.
      if (!JOB_WORDS.test(asked)) {
        const place = (v: unknown) => (v === "spending" ? "near" : v === "agent" ? undefined : v);
        if (input.kind === "move" || input.kind === "swap") return runTool("move", { from: place(input.from), to: place(input.to), usd: input.usd }, words, hands, mark, asked, box);
        return no(WHO_LINE);
      }
      if (!hands.actOn) return no("AgentZero can't do this yet.");
      const act = String(input.kind ?? "");
      const usd = Number(input.usd);
      if (!["send", "swap", "move", "pay", "trade"].includes(act) || typeof input.from !== "string" || !Number.isFinite(usd) || usd <= 0) return no("That couldn't be read.");
      // real-Claude walk, 3 Nov: "Move $5 from my Safe" became a sheet reading "Move $5.00 from Safe … Never your Safe."
      if (input.from === "safe") return no(SAFE_LINE);
      if (!ACT_PLACES.includes(input.from) || (input.to !== undefined && (typeof input.to !== "string" || !ACT_PLACES.includes(input.to)))) return no("That place couldn't be read. Nothing moved.");
      // Whole cents, at most an act job's day limit: anything else is refused before a sheet (never rounded into one).
      if (Math.round(usd * 100) / 100 !== usd) return no("That amount couldn't be read.");
      if (usd > ACT_MAX_USD) return no(`AgentZero acts up to $${ACT_MAX_USD}.00 at a time.`);
      return { result: "Shown to the person to approve.", state: "done", sheet: { kind: "act", act, from: input.from, to: typeof input.to === "string" ? input.to : null, usd } };
    }
    // Home's own sheets, filled in from the person's own words (asked: this chat's words, newest last). No $50 limit here:
    // that is AgentZero's own jobs' its wallet; these are the person's own sends on Home's sheet, with Home's limits.
    case "send":
    case "swap":
    case "move":
    case "add":
    case "request":
    case "trade": {
      let r: HomeSheet | string;
      if (name === "trade") {
        // the coin by chain and address only (copycats share tickers): Trade's own market search, on the phone
        const w = tradeWant(input, asked);
        if (typeof w === "string") return no(w);
        const find = hands.skills?.find;
        // every chain (the card filters by the chain named): a copy there is told apart from the real one elsewhere
        const found = w.address ? null : find ? await withinOr(find(w.symbol), LIMITS.read * 0.75, "Trade's market", null) : null;
        r = tradeSheet(w, appFound(found));
      } else {
        // a share the person said ("half my SOL", "all of it"): ZeroFee works out the dollars from what's there now
        let ask = input;
        let shareLine = "";
        // "send all my SOL", "swap everything": all of it is a share of 100
        if ((name === "send" || name === "swap") && input.all === true && input.usd === undefined && input.share === undefined) {
          if (!ALL_WORDS.test(asked)) return no(HOW_MUCH_LINE);
          input = { ...input, share: 100 };
        }
        if ((name === "send" || name === "swap") && input.amount !== undefined && input.usd === undefined) {
          // a coin amount the person said ("0.02 SOL", "1 NEAR"): ZeroFee turns it into dollars at the live price
          const amount = Number(input.amount);
          const coin = String((name === "send" ? input.coin : input.from) ?? "");
          if (!coinAmountSaid(asked, amount, coin)) return no(HOW_MUCH_LINE);
          const px = hands.skills?.price ? await twice(() => hands.skills!.price!(coin)).catch(() => null) : null;
          if (!(typeof px === "number" && px > 0)) return no(`AgentZero couldn't get ${coin.toUpperCase()}'s price right now, so it can't work out the dollars. Say it in dollars, like $5. Nothing moved.`);
          const usd = Math.round(amount * px * 100) / 100;
          if (!(usd >= 0.01)) return no(HOW_MUCH_LINE);
          const words2 = `${asked} $${usd.toFixed(2)}`;
          r = name === "send" ? sendSheet({ ...input, usd }, words2) : swapSheet({ ...input, usd }, words2);
          if (typeof r !== "string") r = { ...r, line: r.line.replace(/^(\S+ \$[\d.]+)/, `$1 (${amount} ${coin.toUpperCase()})`) };
        } else if ((name === "send" || name === "swap") && input.share !== undefined && input.usd === undefined) {
          const share = Number(input.share);
          if (!shareSaid(asked, share)) return no(HOW_MUCH_LINE);
          const probe = name === "send" ? sendSheet({ ...input, usd: 1 }, `${asked} $1`) : swapSheet({ ...input, usd: 1 }, `${asked} $1`);
          if (typeof probe === "string") return no(probe);
          const place = sourceOfAsk(probe);
          const bal = place ? await balancesOf(hands) : null;
          const have = place && bal ? bal[place as keyof Balances] : null;
          if (have === null || have === undefined) return no("AgentZero couldn't read that wallet right now, so it can't work out the share. Say it in dollars, like $5. Nothing moved.");
          const usd = shareUsd(have, share);
          if (!(usd >= 0.01)) return no(`${PLACE_NAMES[place!]} is empty, so there's nothing to ${name}. Nothing moved.`);
          ask = { ...input, usd };
          shareLine = share === 100 ? " (all of it)" : share === 50 ? " (half)" : ` (${Math.round(share)}%)`;
          r = name === "send" ? sendSheet(ask, `${asked} $${usd.toFixed(2)}`) : swapSheet(ask, `${asked} $${usd.toFixed(2)}`);
        } else if (name === "move" && typeof input.usd === "number" && !fromSaid(asked)) {
          // no source said: the place that holds it all, from ZeroFee's own read (never Claude's guess)
          const to = typeof input.to === "string" ? (input.to as HomePlace) : null;
          const from = to ? pickSource(to, input.usd, await balancesOf(hands)) : null;
          r = moveSheet(from ? { ...input, from } : input, asked);
        } else if (name === "move" && input.usd === undefined) {
          // everything: Home's Move takes dollars, so ZeroFee reads what's there and passes that
          r = moveSheet(input, asked);
          if (typeof r !== "string" && r.ask.kind === "move" && r.usd === null) {
            const a = r.ask;
            const have = (await balancesOf(hands))?.[a.from as keyof Balances];
            if (typeof have === "number" && have >= 0.01) {
              const usd = Math.floor(have * 100 + 1e-6) / 100;
              // all of it is under Home's least for this move: said now, never a sheet that can't go
              const least = moveLeast(a.from, a.to);
              if (usd < least) return no(`${PLACE_NAMES[a.from]} has $${usd.toFixed(2)}. A move from it to ${PLACE_WORD[a.to]} takes at least $${least.toFixed(2)}, so it can't move now. Nothing moved.`);
              r = { ask: { ...a, usd: usd.toFixed(2) }, usd, line: `Move all of ${PLACE_WORD[a.from]} ($${usd.toFixed(2)}) to ${PLACE_WORD[a.to]}.` };
            }
          }
        } else r = name === "send" ? sendSheet(input, asked) : name === "swap" ? swapSheet(input, asked) : name === "move" ? moveSheet(input, asked) : name === "add" ? addSheet(input) : requestSheet(input, asked);
        if (typeof r !== "string" && shareLine) r = { ...r, line: r.line.replace(/^(\S+ \$[\d.]+)/, `$1${shareLine}`) };
      }
      if (typeof r === "string") return no(r);
      // Know the person's state before acting (product decision, 3 Nov): a send, swap or move is checked against what its wallet holds
      if (name === "send" || name === "swap" || name === "move") {
        const f = fit(r, await balancesOf(hands));
        if (f.kind === "plan") {
          setPlan(f.plan);
          return { result: PLAN_SHOWN, state: "done", sheet: { kind: "plan", plan: f.plan } };
        }
        if (f.kind === "short") return { result: `${f.line} ${SHORT_SHOWN}`, state: "done", sheet: { kind: "home", ...f.add }, say: f.line };
        // a swap, or a move that crosses to a wallet (two legs through 1Click): with 1Click down, no sheet that can't
        // go (real-Claude flow-fail-01); a status read that fails or is slow blocks nothing
        if (needsSwapService(r.ask) && (await swapsUpOf(hands)) === false) return no(SWAP_DOWN_LINE);
      }
      // a plan going: this sheet is its step now (a step in words, or a change of mind on the step it's on)
      const cur = box.plan;
      if (live(cur)) {
        const a = attachSheet(cur, r);
        if (a) {
          setPlan(a.plan);
          return { result: SHOWN, state: "done", sheet: { kind: "home", ...a.sheet } };
        }
        // a plan still waiting for its Start gives way to the new ask (one goal at a time)
        if (cur.state === "proposed") setPlan(dropPlan(cur).plan);
      }
      return { result: SHOWN, state: "done", sheet: { kind: "home", ...r } };
    }
    case "plan": {
      const action = String(input.action ?? "");
      const cur = box.plan;
      const moved = (m: PlanMove | string): Outcome => {
        if (typeof m === "string") return no(m);
        setPlan(m.plan);
        if (m.sheet) return { result: SHOWN, state: "done", sheet: { kind: "home", ...m.sheet }, say: m.line };
        if (m.todo) return { result: `The step now, in the person's words: ${m.todo}. Do it now with its own tool (or answer it in words).`, state: "done" };
        return { result: `${m.line} (said to the person by ZeroFee)`, state: "done", say: m.line };
      };
      if (action === "make") {
        const p = askedPlan(Array.isArray(input.steps) ? (input.steps as unknown[]).map(String) : []);
        if (typeof p === "string") return no(p);
        setPlan(p);
        return { result: `Kept as the plan, in order. Do step 1 now with its own tool: ${p.steps[0]!.line}. ZeroFee carries on with the next after each one lands.`, state: "done" };
      }
      if (!live(cur)) return no("There's no plan in this chat now.");
      if (action === "start") return moved(startPlan(cur));
      if (action === "again") return moved(againPlan(cur));
      if (action === "next") return moved(nextPlan(cur));
      if (action === "drop") return moved(dropPlan(cur));
      return no("That plan step couldn't be read.");
    }
    case "remember": {
      // Only a proposal: the person's Keep stores it (memory.ts). Nothing is written here.
      const why = memoryRefusal(input.kind, input.text, []);
      if (why) return no(why);
      return { result: "Shown to the person; kept only if they tap Keep.", state: "done", sheet: { kind: "memory", memory: input.kind as MemoryKind, text: String(input.text).trim() } };
    }
    default:
      return no("AgentZero can't do that.");
  }
}

/** What each tool waits on, named to the person when it doesn't answer in time (wait.ts). */
const TOOL_SERVICE: Record<string, string> = {
  read_receipts: "AgentZero's receipts",
  read_meter: "AgentZero's wallet",
  read_mail: "AgentZero's mailbox",
  read_activity: "Your Activity",
  read_holdings: "Your wallets",
  market_price: "The price service",
  market_trending: "The price service",
  quote_dry: "NEAR Intents",
  service_status: "The service check",
  covered_coins: "ZeroFee",
  trade: "Trade's market",
};
export const toolService = (name: string): string => TOOL_SERVICE[name] ?? "ZeroFee";
/** A core read (LIMITS.core) or a market or relay read (LIMITS.read); a tool that only fills a sheet in has the core's. */
const MARKET_TOOLS = new Set(["market_price", "market_trending", "quote_dry", "service_status", "trade"]);
export const toolLimit = (name: string): number => (MARKET_TOOLS.has(name) ? LIMITS.read : LIMITS.core);

/** The person's own key: straight to Anthropic from this device. Its code (own-claude.ts: the Anthropic SDK, the key's
 *  header, Anthropic's address) is loaded only when a turn has a key, and only a build with the developer switch has it
 *  at all (own-key.ts: VITE_AGENTZERO_OWN_KEY=1, never the public web): the flags are read inline, as Vite replaces
 *  them, so every other build (the phone's, the Sim, the public site) drops the import and everything behind it (audit, 7 Nov:
 *  the test phone bundle carried own-claude.ts, switched off). The funded-wallet relay path below needs none of it.
 *  A test run (node: no import.meta.env, so no MODE) keeps the path, so a test can hand chatTurn a key. */
type OwnClaude = typeof import("./own-claude.ts");
let ownLoaded: OwnClaude | null = null;
async function ownClaude(): Promise<OwnClaude> {
  if (import.meta.env?.MODE === undefined || (import.meta.env?.VITE_AGENTZERO_OWN_KEY === "1" && import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1")) return (ownLoaded ??= await import("./own-claude.ts"));
  throw new Error("An own Claude key is only in a developer build.");
}
export const ownClientFor = async (key: string, anthropicFetch?: typeof fetch) => (await ownClaude()).ownClientFor(key, anthropicFetch);
/** No key now (removed, or the free reading): the client and the key it held are dropped. */
export const dropOwnClient = (): void => ownLoaded?.dropOwnClient();

/** The choice as the relay's body says it: nothing for the default (a relay from before the choice reads that body as
 *  ever), else both fields (apps/quotes/agentzero-chat.mjs checks them against its own copy of the allow-list). */
export const relayChoice = (c: ClaudeChoice): Partial<ClaudeChoice> => (c.model === DEFAULT_CHOICE.model && c.effort === DEFAULT_CHOICE.effort ? {} : { model: c.model, effort: c.effort });

/** What the relay's closing lines carry besides Claude's events. */
/** What one reply owes (D152), as the relay says it: the phone recomputes the amount from the usage before it pays. */
/** `stopped`: the cost is Stop's estimate (SR3 L9): said as "about". */
/** Product decision, 4 Nov: what the id's whole batch owes (`owedMicros`), its usage summed per model (`byModel`, over `replies`),
 *  what was paid of it, and with a closing line this call's own exact cost (`turnMicros`, for the screen's meter). */
export interface ReplyOwed { owedMicros: number; usage: unknown; model: string; memo: string; reply: string; stopped?: true; byModel?: unknown; replies?: number; paidMicros?: number; turnMicros?: number }
export const owedOf = (z: { owedMicros?: unknown; usage?: unknown; model?: unknown; memo?: unknown; reply?: unknown; stopped?: unknown; byModel?: unknown; replies?: unknown; paidMicros?: unknown; turnUsd?: unknown } | null): ReplyOwed | null =>
  z && Number.isSafeInteger(z.owedMicros) && (z.owedMicros as number) > 0 && typeof z.model === "string" && typeof z.memo === "string" && typeof z.reply === "string"
    ? {
        owedMicros: z.owedMicros as number, usage: z.usage, model: z.model, memo: z.memo, reply: z.reply,
        ...(z.stopped === true ? { stopped: true as const } : {}),
        ...(z.byModel && typeof z.byModel === "object" ? { byModel: z.byModel } : {}),
        ...(Number.isSafeInteger(z.replies) ? { replies: z.replies as number } : {}),
        ...(Number.isSafeInteger(z.paidMicros) ? { paidMicros: z.paidMicros as number } : {}),
        ...(typeof z.turnUsd === "number" && Number.isFinite(z.turnUsd) && z.turnUsd >= 0 ? { turnMicros: Math.round(z.turnUsd * 1e6) } : {}),
      }
    : null;
type RelayExtras = { allowance?: Allowance; paid?: { turnUsd: number; owed?: ReplyOwed }; error?: string };

/** The relay's event stream, read by hand (relay-stream.ts: no SDK), with the relay's extras pulled out. */
async function relayStream(body: ReadableStream<Uint8Array>, extras: RelayExtras): Promise<Stream> {
  return sseStream(body, (event, data) => {
    if (event === "zerofee") {
      try {
        const z = JSON.parse(data) as { allowance?: Allowance; turnUsd?: unknown; owedMicros?: unknown; usage?: unknown; model?: unknown; memo?: unknown; reply?: unknown; byModel?: unknown; replies?: unknown; paidMicros?: unknown };
        extras.allowance = z.allowance;
        if (typeof z.turnUsd === "number" && Number.isFinite(z.turnUsd) && z.turnUsd >= 0) {
          const owed = owedOf(z);
          extras.paid = { turnUsd: z.turnUsd, ...(owed ? { owed } : {}) };
        }
      } catch {
        // an unreadable meter line is no meter
      }
    } else if (event === "zerofee_error") {
      try {
        extras.error = String((JSON.parse(data) as { line?: unknown }).line ?? "Claude didn't answer.");
      } catch {
        extras.error = "Claude didn't answer.";
      }
    }
  });
}

/** D37: AgentZero's own account for the relay's balance read (64 hex only; anything else is not sent). */
const agentHeader = (account: string | null | undefined, bind: string | null): Record<string, string> =>
  account && /^[0-9a-f]{64}$/.test(account) ? { "x-zf-agent-account": account, ...(bind && /^[0-9a-f]{128}$/.test(bind) ? { "x-zf-agent-bind": bind } : {}) } : {};
/** QA (LOW): the relay's agentzero.reply.account-full, in the copywriter's words. */
export const ACCOUNT_FULL_LINE = "AgentZero still has old replies to pay for. Nothing left AgentZero. Chat works again once one is paid.";
/** D37: AgentZero's money couldn't be read on NEAR (the relay's agentzero.reply.unread, or the phone's own read). */
export const UNREAD_LINE = "NEAR didn't answer. Nothing was paid. Try again.";
/** The relay's code when NEAR didn't answer its read of AgentZero's money; asked once more after this wait. */
export const UNREAD_CODE = "agentzero.reply.unread";
export const UNREAD_RETRY_MS = 1_200;
export { CHAT_LINE };
export const NOT_YOURS_LINE = "This phone named the wrong AgentZero wallet. Nothing was paid.";
type Fault = { line: string; retry?: true; fresh?: true; needs?: NeedsKey };
/** The relay's refusal before any stream, by its code first, then its status: every one a line (a Try again where it can
 *  help); `needs`: the screen's own card or line as well (no money: Add money above the box). Exported for the tests. */
export function relayFault(status: number, code: string | undefined): Fault {
  // QA (LOW): two other sign-ups on this AgentZero wallet still have replies to pay for (the relay's words)
  if (code === "agentzero.reply.account-full") return { line: ACCOUNT_FULL_LINE };
  // D37: AgentZero's own money doesn't cover a reply (the old free reading's used-up too): Add money above the box
  if (code === "agentzero.reply.unfunded" || code === "agentzero.allowance.used") return { line: CHAT_LINE.unfunded, needs: "used-up" };
  // held for the last reply's payment, with no figure this phone could pay by
  if (code === "agentzero.reply.unpaid") return { line: CHAT_LINE.stillPaying, retry: true };
  if (code === "agentzero.reply.running" || status === 409) return { line: CHAT_LINE.running, retry: true };
  // QA: the account named isn't the one this id proved (the relay's own words, the copywriter's)
  if (code === "agentzero.reply.account") return { line: NOT_YOURS_LINE, retry: true };
  // D37: the relay couldn't read AgentZero's money on NEAR, so it asked nothing (the copywriter's line)
  if (code === "agentzero.reply.unread") return { line: UNREAD_LINE, retry: true };
  // one sign-up's free reading one day is spent (the relay's audit L17 cap)
  if (code === "agentzero.allowance.today") return { line: "Today's free reading is used up. Try again tomorrow." };
  if (code === "agentzero.model.off") return { line: CHAT_LINE.dayDone };
  if (code === "agentzero.model.unreachable") return { line: "Claude didn't answer.", retry: true };
  if (status === 402) return { line: CHAT_LINE.unfunded, needs: "used-up" };
  if (status === 413) return { line: CHAT_LINE.tooLarge };
  if (status === 429) return { line: "Too many asks just now. Try again in a minute.", retry: true };
  // the relay's secret changed: this sign-in is dead for good; a new one only on the person's tap (QA)
  if (code === "agentzero.signup.again") return { line: CHAT_LINE.signInAgain, retry: true, fresh: true };
  if (status === 401) return { line: CHAT_LINE.signedOut, retry: true };
  // 404: no AgentZero route on this relay; 5xx, or any answer this phone can't read: down (a developer build's key card too)
  return { line: CHAT_LINE.down, retry: true, ...(status === 404 || status >= 500 ? { needs: "off" as const } : {}) };
}

/** The memory's fenced text, the same while the memory is the same (its fence's nonce once per memory, not per request):
 *  a new nonce each request changed the conversation's first message and voided the whole thread's cache. */
let memoKept: { key: string; text: string | null } | null = null;
export function memoryOnce(list: readonly MemoryLine[]): string | null {
  const key = JSON.stringify(list.map((l) => [l.kind, l.text]));
  if (memoKept?.key !== key) memoKept = { key, text: memoryContext(list) };
  return memoKept.text;
}

/** How long before a transient failure is asked once more. */
export const RETRY_MS = 1_200;
/** The own-key path's lines with no status of their own: each says what to do next. */
export const OWN_FAULT = {
  key: "Claude didn't accept your key. Tap Claude ✓ at the top to replace it.",
  offline: "Couldn't reach Claude. Check your connection, then send it again.",
  down: "Claude is down right now. Send it again soon.",
  other: "Claude didn't answer. Send it again.",
} as const;

/**
 * One turn. `history`: what the last turn's "done" returned (or []). Yields ChatEvents; the last is always "done".
 */
export async function* chatTurn(history: ChatMessage[], words: string, o: ChatOptions): AsyncGenerator<ChatEvent, void> {
  // the Sim (D157) never uses a key of anyone's: its Claude is the relay's Sim route
  if (o.sim) o = { ...o, ownKey: null };
  const said = words.trim();
  if (!said) return yield { kind: "done", history };
  // W7: does the relay take the offered tools by name? Until it refuses the shape once in this turn, yes
  const relayTools = { named: true };
  // ZeroFee's own note (a plan step landed or stopped): straight to Claude, never read as the person's words
  const note = o.note === true;
  const box: PlanBox = { plan: live(o.plan) ? o.plan : null, changed: false };
  // Hidden words are refused before anything reads them.
  if (!note && textHides(said)) {
    const line = hiddenLine(said);
    yield { kind: "refused", line };
    yield { kind: "text", delta: line };
    return yield { kind: "done", history };
  }
  // The Sim (D157): what only the iPhone app does for real (a site's sign-up, browsing, mail, AgentZero's jobs), in one
  // honest line from our own code, no model call
  if (o.sim && !note && simReal(said)) {
    yield { kind: "text", delta: SIM_REAL_LINE };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: SIM_REAL_LINE }] };
  }
  // W7, the web wallet: browse isn't offered there (tools.ts WEB_ABSENT), so an ask to open a site is said in one line
  // by our own code (the copy review's words, QA's ruling), no model call and no tool
  // E2 (audit 14), the phone with AgentZero's browser off: one plain line too, never a word about a browser
  if (!note && o.hands.offered && !o.hands.offered.includes("browse") && wantsSite(said)) {
    const line = (o.hands.web ?? true) ? WEB_BROWSE_LINE : SITES_OFF_LINE;
    yield { kind: "text", delta: line };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: line }] };
  }
  // Mail isn't on (M14): a sign-up with AgentZero's own email is said by our own code, in the browser's own words, before
  // anything opens (phone test, 3 Nov: it opened the site, tried, then hung; 100-prompt suite email-02)
  if (!note && wantsOwnMailSignUp(said)) {
    yield { kind: "text", delta: NO_MAIL_LINE };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: NO_MAIL_LINE }] };
  }
  // A payment in plain words is read by our own code only: no model turns words into a payment.
  // It is the person's own send (product decision, 3 Nov): Home's Send, filled in, approved with their Face ID (Home's own limits).
  const once = note ? null : readPayOnce(said);
  const home = once ? sendSheet({ to: once.to, usd: once.usd }, said) : null;
  if (home && typeof home !== "string") {
    yield { kind: "needs-you", why: "home", sheet: { kind: "home", ...home } };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: `${home.line} ${readyLine(o.hands.web ?? !!o.hands.offered)}` }] };
  }
  // A routine moves money on its own later (or tells you): read by our own code only, as in the words box (A-2)
  const routine = once || note ? null : readRoutine(said);
  if (routine?.kind === "routine") {
    yield { kind: "needs-you", why: "routine", sheet: { kind: "routine", terms: routine.terms } };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: ROUTINE_SHOWN }] };
  }
  if (routine?.kind === "cannot" && ASKS_TO_DO.test(said) && !said.includes("?")) {
    yield { kind: "refused", line: routine.line };
    yield { kind: "text", delta: routine.line };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: routine.line }] };
  }
  // "yes" to "Want me to tell you when it's back?" (1Click down): the routine, read by our own code as its words are
  if (!note && quickWord(said) === "yes" && lastSaid(history).includes(SWAP_DOWN_LINE)) {
    const back = readRoutine(SWAP_BACK_WORDS);
    if (back?.kind === "routine") {
      yield { kind: "needs-you", why: "routine", sheet: { kind: "routine", terms: back.terms } };
      return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: ROUTINE_SHOWN }] };
    }
  }
  // The person's short word to a plan (yes, no, again), in our own code: no model call, no guess
  const quick = note ? null : quickPlan(box.plan, said);
  if (quick && !quick.todo) {
    yield { kind: "plan", plan: quick.plan };
    if (quick.line) yield { kind: "say", line: quick.line };
    if (quick.sheet) yield { kind: "needs-you", why: "home", sheet: { kind: "home", ...quick.sheet } };
    return yield { kind: "done", history: [...history, { role: "user", content: said }, { role: "assistant", content: `ZeroFee said: ${quick.line}` }] };
  }
  // the person's own key only where there is a key path at all: a developer build or a test run (ownClaude above; read
  // inline, so every other build drops it). use-chat-turn.ts hands a key only when OWN_KEY_ON, so no build people get
  // ever had a key here: this gate only lets those builds drop the code.
  const own = import.meta.env?.MODE === undefined || (import.meta.env?.VITE_AGENTZERO_OWN_KEY === "1" && import.meta.env?.VITE_ZEROFEE_PUBLIC !== "1") ? o.ownKey?.trim() || null : null;
  const choice = claudeChoice({ model: o.model, effort: o.effort });
  if (!own) dropOwnClient();
  const doFetch = o.fetch ?? fetch;
  let token = o.token ?? null;
  const trimmed = o.sim ? trimHistory(history, SIM_HISTORY.max, SIM_HISTORY.to) : trimHistory(history);
  if (trimmed.dropped) yield { kind: "note", line: SET_ASIDE_LINE };
  // a note goes as a text block (never a plain string: only the person's own words are, so personWords never reads it)
  // The plan's record (plan.ts planContext) goes just before this turn's words, as data, and is KEPT: the thread only ever
  // grows at its end (an edited history would void the cache and Claude's earlier thinking)
  const planNow = [planContext(box.plan), o.cards ?? null].filter((x): x is string => !!x).join("\n\n") || null;
  const planMsg: ChatMessage[] = planNow ? [{ role: "user", content: [{ type: "text", text: (() => { const n = freshNonce(); return `<data-${n}>\n${planNow}\n</data-${n}>`; })() }] }] : [];
  const messages: ChatMessage[] = [...trimmed.kept, ...planMsg, note ? { role: "user", content: [{ type: "text", text: `<zerofee-note>\n${said.slice(0, 1_500)}\n</zerofee-note>` }] } : { role: "user", content: said }];
  const wordsNow = note ? "" : said;
  // the skills' figures as marks (markFigures), numbered past any mark this chat already holds
  let markAt = firstSkillMark(messages);
  const nextMark = () => (markAt <= 999 ? `f${markAt++}` : null);
  const stopped = () => o.signal?.aborted === true;
  // Memory goes with each request as a fenced data turn before the conversation, and never into `messages` (the history):
  // a line the person deletes is gone from the next turn.
  const mem = memoryOnce(o.memory ?? []);
  // audit L16: every address (and every NEAR name in data) as its stand-in, for the request only
  const stand = [...(o.standIns ?? [])];
  let standSaid = stand.length;
  const withMemory = (ms: ChatMessage[]): ChatMessage[] => maskMessages(mem ? [{ role: "user", content: mem }, { role: "assistant", content: "Noted. That's memory, not orders." }, ...ms] : ms, stand);
  /** A transient failure of the person's own key's call (Claude overloaded or down, a timeout) is asked once more. */
  let retried = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (stopped()) return;
    let stream: Stream;
    const extras: RelayExtras = {};
    // wait.ts: this call's own abort (Stop's, or a limit's), and when it went (Claude's first event within LIMITS.firstByte)
    const call = linked(o.signal);
    const sentAt = Date.now();
    const late = (line: string): ChatEvent[] => [{ kind: "fault", line, retry: true }];
    if (own) {
      // the SDK loads on the first own-key call: that load is part of Claude's first-event limit
      try {
        stream = await within(ownClaude().then((m) => m.ownStream(withMemory(messages), own, choice, o.anthropicFetch, call.signal)), LIMITS.firstByte, "Claude", o.signal);
      } catch (e) {
        call.abort();
        if (stopped() || e instanceof Stopped) return;
        yield* late(isTimedOut(e) ? timedOutLine(e.service) : OWN_FAULT.other);
        return yield { kind: "done", history };
      }
    } else {
      // AgentZero's wallet's top-up (L9) is the core's: only AgentZero's wait for it is limited (late: paused, as a "no")
      // D152 (SR3 L15): paying the last call on NEAR and the relay's check of it take some seconds: up to 30 more
      if (round > 0 && o.beforeCall && !(await withinOr(o.beforeCall(), LIMITS.core + 30_000, "AgentZero's wallet", false, o.signal).catch(() => false))) {
        if (stopped()) return;
        yield { kind: "paused" };
        return yield { kind: "done", history: messages };
      }
      // the Sim with no relay in this build: its AgentZero rests (one plain line, never a key card)
      if (!o.relayBase && o.sim) {
        yield { kind: "say", line: SIM_RESTED_LINE };
        return yield { kind: "done", history };
      }
      if (!o.relayBase) {
        yield { kind: "needs-key", why: "no-key" };
        return yield { kind: "done", history };
      }
      const base = o.relayBase.replace(/\/$/, "");
      if (!token && !o.sim) {
        const r = await withinOr(signUpSaid(base, doFetch as never), LIMITS.read + 1_000, "ZeroFee's free reading", null, o.signal).catch(() => null);
        if (stopped()) return;
        if (r === null || !("token" in r)) {
          // crawl S2 (4 Nov): with no key card in a release build, a refused or silent sign-up left the chat blank; it says
          // why under the person's words, the relay's own line when it gave one
          yield { kind: "say", line: r === null ? SIGNUP_UNANSWERED : (r.refused ?? SIGNUP_REFUSED) };
          yield { kind: "needs-key", why: r === null ? "off" : "full" };
          return yield { kind: "done", history };
        }
        const t = r.token;
        token = t;
        // kept for the next turn; a keychain that doesn't answer only means a sign-up again next time
        await withinOr(o.saveToken?.(t), LIMITS.core, "This phone's keychain", undefined, o.signal).catch(() => undefined);
        if (stopped()) return;
      }
      // QA: the proof that this id is AgentZero's own (the core's key signs it; kept by the wallet once made)
      const bind = !o.sim && token && o.account && o.bindFor ? await withinOr(o.bindFor(token), LIMITS.core, "AgentZero's wallet", null, o.signal).catch(() => null) : null;
      if (stopped()) return;
      let res: Response;
      try {
        // the Sim's route takes only the conversation and the day (the relay fixes its Claude, tools and limits)
        const ask = (named = !!o.hands.offered && relayTools.named) => within(o.sim
          ? doFetch(`${base}${SIM_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: simThread(withMemory(messages)), today: phoneDay() }), signal: call.signal })
          : doFetch(`${base}/v0/agentzero/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...agentHeader(o.account, bind) }, body: JSON.stringify({ messages: withMemory(messages), today: phoneDay(), ...relayChoice(choice), ...(named ? { tools: o.hands.offered } : {}) }), signal: call.signal }), LIMITS.firstByte, "Claude", o.signal);
        res = await ask();
        // W7: a relay from before `tools` refuses the shape; the old shape goes once, and the rest of this turn keeps it
        // (runTool still refuses a tool this device didn't offer, so nothing absent can run)
        if (!o.sim && relayTools.named && o.hands.offered && res.status === 400 && (await res.clone().json().catch(() => null) as { code?: string } | null)?.code === OLD_SHAPE_CODE) {
          relayTools.named = false;
          if (stopped()) return;
          res = await ask(false);
        }
        // QA (5 Nov): NEAR didn't answer the relay's read of AgentZero's money (a moment's hiccup; the next
        // try answered, 16 s later, by hand): asked once more here after a short wait, before any words are said
        if (!o.sim && res.status === 503 && (await res.clone().json().catch(() => null) as { code?: string } | null)?.code === UNREAD_CODE) {
          await new Promise((r) => setTimeout(r, UNREAD_RETRY_MS));
          if (stopped()) return;
          res = await ask();
        }
      } catch (e) {
        call.abort();
        if (stopped()) return;
        // no answer at all in time: said by name (a refused or unreachable relay is the key card, as before)
        if (isTimedOut(e)) {
          yield* late(timedOutLine(e.service));
          return yield { kind: "done", history };
        }
        // product decision, 4 Nov: never a hidden key card alone (a release build has none): the line, then the card's event
        if (o.sim) yield { kind: "say", line: SIM_RESTED_LINE };
        else {
          yield { kind: "fault", line: CHAT_LINE.offline, retry: true };
          yield { kind: "needs-key", why: "off" };
        }
        return yield { kind: "done", history };
      }
      if (!res.ok || !res.body) {
        const b = (await withinOr(res.json(), LIMITS.read, "ZeroFee's free reading", null, o.signal).catch(() => null)) as ({ code?: string } & Parameters<typeof owedOf>[0]) | null;
        if (stopped()) return;
        // D37: the last reply is unpaid (no credit): the phone pays it (its own figure) and asks again
        const unpaid = res.status === 402 && b?.code === "agentzero.reply.unpaid" ? owedOf(b) : null;
        if (unpaid) {
          yield { kind: "unpaid", owed: unpaid };
          return yield { kind: "done", history };
        }
        // the Sim: a visitor's free replies used for today (D158), its own line
        if (o.sim && b?.code === SIM_VISITOR_CODE) {
          yield { kind: "say", line: SIM_VISITOR_LINE };
          return yield { kind: "done", history };
        }
        // the Sim: its AgentZero off, the relay's day used, or no Sim route on this relay: the rested line, never a key card
        if (o.sim && (SIM_REST_CODES.includes(String(b?.code)) || res.status === 404 || res.status >= 500)) {
          yield { kind: "say", line: SIM_RESTED_LINE };
          return yield { kind: "done", history };
        }
        // every code a line (product decision, 4 Nov: a 402 this phone didn't know was silence); no money: the line above the box too
        const f = relayFault(res.status, b?.code);
        if (o.sim) {
          yield { kind: "fault", line: f.needs ? "AgentZero couldn't answer that. Send it again." : f.line };
          return yield { kind: "done", history };
        }
        yield { kind: "fault", line: f.line, ...(f.retry ? { retry: true as const } : {}), ...(f.fresh ? { fresh: true as const } : {}) };
        if (f.needs) yield { kind: "needs-key", why: f.needs };
        return yield { kind: "done", history };
      }
      try {
        stream = await within(relayStream(res.body, extras), LIMITS.firstByte, "Claude", o.signal);
      } catch (e) {
        call.abort();
        if (stopped() || e instanceof Stopped) return;
        yield* late(isTimedOut(e) ? timedOutLine(e.service) : "Claude didn't answer.");
        return yield { kind: "done", history };
      }
    }
    let final: Anthropic.Message;
    // Stop mid-stream: the SDK's own abort as well (the relay's body is already cut by the fetch's signal).
    const cut = () => (call.abort(), (stream as unknown as { abort?: () => void }).abort?.());
    o.signal?.addEventListener("abort", cut, { once: true });
    let started = false;
    try {
      // wait.ts: Claude's first event within LIMITS.firstByte of the request, then no silence over LIMITS.gap; over a
      // limit the request is aborted and the line names Claude (never a spinner forever)
      const first = Math.max(100, LIMITS.firstByte - (Date.now() - sentAt));
      // Claude's words with its stand-ins turned back (audit L16), a stand-in split across pieces waiting for the next
      const shown = unmaskStream(stand);
      for await (const ev of paced(stream, { first, gap: LIMITS.gap, service: "Claude", ...(o.signal ? { signal: o.signal } : {}), onLate: cut })) {
        if (stopped()) return;
        started = true;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          const t = shown.next(ev.delta.text);
          if (t) yield { kind: "text", delta: t };
        } else if (ev.type === "content_block_stop") {
          const t = shown.end();
          if (t) yield { kind: "text", delta: t };
        }
        else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
          const b = ev.content_block;
          yield { kind: "step", id: b.id, tool: b.name, line: STEP_LINE[b.name] ?? "Working", state: "running" };
        }
      }
      final = await within(stream.finalMessage(), LIMITS.gap, "Claude", o.signal);
    } catch (e) {
      cut();
      o.signal?.removeEventListener("abort", cut);
      if (stopped() || e instanceof Stopped) return;
      if (isTimedOut(e)) {
        yield* late(timedOutLine(e.service));
        return yield { kind: "done", history };
      }
      // too long for Claude even so: the older half is set aside, so the next send works (never a dead end)
      if (/prompt is too long|too many tokens|context (?:length|window)/i.test(String((e as { message?: unknown } | null)?.message ?? ""))) {
        yield { kind: "fault", line: TOO_LONG_LINE };
        return yield { kind: "done", history: trimHistory(trimmed.kept, 0, Math.floor(JSON.stringify(trimmed.kept).length / 4)).kept };
      }
      if (own && !started && !retried && (await (await ownClaude()).transient(e))) {
        retried = true;
        o.signal?.removeEventListener("abort", cut);
        await new Promise((r) => setTimeout(r, RETRY_MS));
        if (stopped()) return;
        round--;
        continue;
      }
      if (box.changed && box.plan) yield { kind: "plan", plan: box.plan };
      yield { kind: "fault", line: extras.error ?? (own ? await (await ownClaude()).ownFault(e, started, o.anthropicFetch) : "Claude didn't answer."), retry: true };
      return yield { kind: "done", history };
    }
    o.signal?.removeEventListener("abort", cut);
    if (stopped()) return;
    if (extras.allowance) yield { kind: "allowance", usedUsd: extras.allowance.usedUsd, limitUsd: extras.allowance.limitUsd, ...(extras.paid ?? {}) };
    if (extras.error) {
      yield { kind: "fault", line: extras.error, retry: true };
      return yield { kind: "done", history };
    }
    // the chat's stand-ins grew this round: the device keeps them with the chat (one meaning each, for good)
    if (stand.length > standSaid) {
      standSaid = stand.length;
      yield { kind: "stand-ins", list: [...stand] };
    }
    messages.push({ role: "assistant", content: final.content as Anthropic.ContentBlockParam[] });
    if (final.stop_reason === "refusal") {
      yield { kind: "fault", line: "Claude won't help with that." };
      return yield { kind: "done", history: messages };
    }
    const uses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!uses.length || final.stop_reason !== "tool_use") {
      // a step in words answered with no sheet ("tell me what's left"): done, and the plan moves on
      if (note && box.plan && box.plan.made === "asked") {
        const q = wordsDone(box.plan);
        if (q !== box.plan) (box.plan = q), (box.changed = true);
      }
      if (box.changed && box.plan) yield { kind: "plan", plan: box.plan };
      return yield { kind: "done", history: messages };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    let sheet = false;
    /** Why each ask that would move money stopped: said in words when no sheet came (100-prompt suite, 3 Nov: "Send $5
     *  in SOL to 7Hx2…" ended on a bare "Stopped" row, its reason folded away, and the turn over: a dead end). */
    const stoppedWhy: string[] = [];
    // a plan the person asked for is kept before its first step's tool runs, so that step's sheet is the plan's
    const ordered = [...uses.filter((u) => u.name === "plan"), ...uses.filter((u) => u.name !== "plan")];
    /** A tool that didn't answer in time: the turn ends on its line (wait.ts), never on another round. */
    const lateWhy: string[] = [];
    for (const u of ordered) {
      if (stopped()) return;
      // audit L16: Claude's stand-ins back to the real ones, on the phone; the money tools still check them against the
      // person's own words (a stand-in Claude made up resolves to nothing it can use)
      const input = unmaskInput(u.input && typeof u.input === "object" && !Array.isArray(u.input) ? (u.input as Record<string, unknown>) : {}, stand);
      // one sheet a turn (real-Claude stress walk: "pay $5 to kim.near and copy a wallet" gave two at once)
      if (sheet && !READ_TOOLS.includes(u.name)) {
        yield { kind: "step", id: u.id, tool: u.name, line: STEP_LINE[u.name] ?? "Working", state: "refused", why: ONE_AT_A_TIME };
        results.push({ type: "tool_result", tool_use_id: u.id, content: ONE_AT_A_TIME, is_error: true });
        continue;
      }
      // wait.ts: every tool's read within its limit (a sheet's tool reads nothing slow; its sheet is the person's own pace)
      const r = await within(runTool(u.name, input, wordsNow, o.hands, nextMark, personWords(messages), box), toolLimit(u.name), toolService(u.name), o.signal).catch((e): Outcome => {
        if (isTimedOut(e)) {
          lateWhy.push(timedOutLine(e.service));
          return { result: `${e.service} didn't answer in time.`, state: "refused", why: timedOutLine(e.service) };
        }
        return { result: "That didn't work.", state: "refused", why: "That didn't work." };
      });
      if (stopped()) return;
      yield { kind: "step", id: u.id, tool: u.name, line: STEP_LINE[u.name] ?? "Working", state: r.state, ...(r.why ? { why: r.why } : {}) };
      if (r.state === "refused" && MONEY_TOOLS.has(u.name)) {
        yield { kind: "refused", line: r.why ?? r.result };
        stoppedWhy.push(r.why ?? r.result);
      }
      if (r.facts?.length) yield { kind: "facts", facts: r.facts };
      if (box.changed && box.plan) yield { kind: "plan", plan: box.plan };
      box.changed = false;
      if (r.say) yield { kind: "say", line: r.say };
      if (r.sheet) {
        sheet = true;
        yield { kind: "needs-you", why: r.sheet.kind, sheet: r.sheet };
      }
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.result, ...(r.state === "refused" ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    if (lateWhy.length && !sheet) {
      const line = [...new Set(lateWhy)].join(" ");
      yield* late(line);
      messages.push({ role: "assistant", content: line });
      return yield { kind: "done", history: messages };
    }
    // A sheet ends the turn: the person's tap comes next. Only reads (and a plan kept with no sheet) go round again.
    if (sheet || !uses.every((u) => READ_TOOLS.includes(u.name) || u.name === "plan")) {
      // no sheet came: the reason is said, never only a folded "Stopped" (and kept, so Claude knows it was said)
      const why = sheet ? "" : [...new Set(stoppedWhy)].join(" ");
      if (why) {
        yield { kind: "text", delta: why };
        messages.push({ role: "assistant", content: why });
      }
      return yield { kind: "done", history: messages };
    }
  }
  if (box.changed && box.plan) yield { kind: "plan", plan: box.plan };
  yield { kind: "done", history: messages };
}
