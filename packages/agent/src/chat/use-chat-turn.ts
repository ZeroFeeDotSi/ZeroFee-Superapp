// useChatTurn(bridge): the AgentZero app's chat in one hook (D122), for UI's Claude-app-style screen. It keeps the
// conversation, runs chatTurn with this device's own key or the free reading, and hands the screen a plain list of what
// happened: the person's words, AgentZero's words as they stream, step cards (running → done/refused), sheets to tap,
// and faults. The read tools answer from AgentZero's own engine (receipts, the day's its wallet); nothing here pays.
//
//   const chat = useChatTurn(agentBridge);   // the AGENT app's bridge (forApps(…, "agent"))
//   chat.send("copy this wallet …");          // chat.items: ChatItem[]; chat.busy; chat.allowance
//   // a needs-you item: show its sheet; the person's tap goes through the existing path (job sheet, pay sheet, …)
import { OWN_KEY_ON } from "./own-key.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReplyOwed } from "./turn.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { AGENT_ACT } from "@zerofee/core/agent-route";
import { zeroEngine } from "../zero/engine.ts";
import { receiptTime } from "../zero/receipts.ts";
import { memoryStore } from "../zero/memory.ts";
import { chatStore, newChatId, type ChatMeta } from "./chats.ts";
import { DEFAULT_CHOICE, modelStore } from "./model.ts";
import type { SkillHands } from "./skills.ts";
import { webTools } from "./tools.ts";
import { LIMITS, Stopped, isTimedOut, timedOutLine, within, withinOr } from "./wait.ts";
import { chatTurn, type ChatEvent, type ChatFact, type ChatHands, type ChatMessage, type ChatSheet, type NeedsKey, type StepState } from "./turn.ts";
import { dropPlan, live, reopened, type Plan, type PlanTag, type StepEnd, type TaggedSheet } from "./plan.ts";
import { planRunner, type PlanRunner, type RunnerMove } from "./plan-runner.ts";

/** Where the free sign-up's token and the person's own key live on this device (the AgentZero app's own names). */
export const CHAT_SECRETS = { ownKey: "agentzero.claude-key", token: "agentzero.token" } as const;

export type ChatItem =
  /** `id`: made on this phone at the tap (sendId): the screen keys the bubble by it, and the same words sent again
   *  (Try again, a held reply paid and asked again) reuse it, so one tap is one bubble (product decision, 4 Nov). */
  | { kind: "you"; text: string; id?: string }
  | { kind: "agent"; text: string }
  | { kind: "step"; id: string; tool: string; line: string; state: StepState; why?: string }
  /** `stale`: a newer card took its place (a change of mind, a plan that moved on or was dropped): no Open on it.
   *  `card`/`was`: a money card's own id and what it saw (opened, went or closed, the move's id), kept with the chat so a
   *  restored card and Claude's record say what happened, never "nothing moved" unread. */
  | { kind: "needs-you"; sheet: ChatSheet; stale?: true; card?: string; was?: CardWas }
  /** A money card from before (a reload): its line and what it saw; the screen reads Activity for what became of it. */
  | { kind: "old-sheet"; line: string; was: CardWas }
  /** A line from ZeroFee itself about a plan or a check (plan.ts): our code's words, never Claude's. */
  | { kind: "say"; line: string }
  | { kind: "fault"; line: string; retry?: true; fresh?: true }
  /** No key and no free reading: the screen shows its key card (never a fault line). */
  | { kind: "needs-key"; why: NeedsKey }
  /** A line from ZeroFee itself (the key card's "Claude is ready"). */
  | { kind: "note"; line: string }
  /** H-2: read_activity's figures; the screen shows each in place of its {{fN}} mark in the agent's words. */
  | { kind: "facts"; facts: ChatFact[] }
  /** The person's Stop ended the turn (the request itself was aborted: no more tokens). */
  | { kind: "stopped" }
  /** AgentZero's own wallet (D152): what one paid call cost, exactly (Anthropic's price), as the relay counted it. */
  | { kind: "cost"; turnUsd: number }
  /** D152: the relay held a reply until the last one is paid (the phone pays it and asks again); a stopped reply's cost
   *  is said here, as an estimate (SR3 L9). */
  | { kind: "unpaid"; stopped?: true; turnUsd?: number }
  /** AgentZero's own wallet (L9): a tool loop paused for want of money. */
  | { kind: "paused" };

/** The free reading's relay, from the build (https, or a local http one); null when there is none. */
export const relayBase = (): string | null => {
  const raw = import.meta.env?.VITE_ZEROFEE_RELAY;
  try {
    const u = raw ? new URL(raw) : null;
    const local = u?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u && (u.protocol === "https:" || local) && !u.username && !u.password ? u.href.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};

/** read_meter's answer (real-Claude walk, 3 Nov: off read "$0.00 of $0.00 left today", and Claude told the person it
 *  had no money of its own). Jobs' its wallet, off or what is left; then (QA 4 Nov: "nothing has been charged… AgentZero
 *  is off" beside a $0.030 meter) what AgentZero's thinking really cost and paid today, `thinking` (thinkingLine). */
export function meterLine(st: { limitUsd: number; spentUsd: number } | null, thinking?: string | null): string {
  // where it is on screen: the menu, top left, "Jobs and limits" (QA 5 Nov: a screen named with no way to it)
  const jobs = !st || !(st.limitUsd > 0)
    ? "AgentZero's wallet for jobs (not its thinking): off. The person funds it in the menu, top left, under Jobs and limits."
    : `AgentZero's wallet for jobs (not its thinking): $${Math.max(0, st.limitUsd - st.spentUsd).toFixed(2)} of $${st.limitUsd.toFixed(2)} left. Never say it as a price per day.`;
  // the thinking first: "what did my last message cost?" is answered from it (QA, 5 Nov: no figure was said)
  return thinking ? `${thinking}\n${jobs}` : jobs;
}

/** What AgentZero's own thinking cost today, from its wallet's meter (the screen's own figures): each reply is paid from
 *  AgentZero's wallet right after it (D37). Read by read_meter so Claude never says nothing was charged. */
export function thinkingLine(m: { usedUsd: number; paidUsd: number; owedUsd: number; walletUsd: number | null; lastUsd?: number | null }): string {
  const d = (v: number) => `$${(Number.isFinite(v) && v > 0 ? v : 0).toFixed(3)}`;
  const held = m.walletUsd === null ? "can't be read right now" : `holds ${d(m.walletUsd)}`;
  // the last message's whole cost (all its calls), exactly as the relay counted them (this answer's comes after it)
  const last = typeof m.lastUsd === "number" && Number.isFinite(m.lastUsd) ? `The person's last message cost ${d(m.lastUsd)} (Claude's price, nothing added). ` : "";
  return `${last}AgentZero's thinking today (each reply paid from AgentZero's own wallet): cost ${d(m.usedUsd)}, paid ${d(m.paidUsd)}, still to pay ${d(m.owedUsd)}. Its wallet ${held}. Say these figures as they are. A question about what a message or this chat cost is answered with them, never by naming a screen.`;
}

/**
 * W7: AgentZero's mailbox for read_mail (mail/mailbox.ts, opened in the core): offered only once it has an address
 * (registered when AgentZero first opens). Its newest mails as plain lines; a sign-in code is read by our own code
 * (codeFrom), and turn.ts blanks every code before Claude reads it. Nothing in a mail is an order.
 */
export async function mailHands(bridge: Bridge): Promise<ChatHands["mail"] | undefined> {
  const { mailbox } = await import("../mail/mailbox.ts");
  const box = mailbox(bridge);
  const a = await withinOr(box.address(), LIMITS.core, "AgentZero's mailbox", { ok: false as const, line: "" }).catch(() => null);
  if (!a?.ok || !a.value) return undefined;
  return async () => {
    const r = await box.list();
    if (!r.ok) return `AgentZero's mailbox couldn't be read right now: ${r.line}`;
    const items = [...r.value.items].sort((x, y) => y.at - x.at).slice(0, 10);
    if (!items.length) return "AgentZero's mailbox is empty.";
    return items.map((m) => (m.broken ? m.subject : `From ${m.from}: ${m.subject}${m.code ? `. Its sign-in code: ${m.code}` : ""}`)).join("\n");
  };
}

/** The read-only skills (skills.ts), loaded on the first one a turn uses: never in Home's first load. Market data goes
 *  through the build's relay (VITE_ZEROFEE_RELAY), as Trade's does. */
export function lazySkills(bridge: Bridge, relay: string | null = relayBase(), web = false): SkillHands {
  let made: Promise<SkillHands> | undefined;
  const get = () => (made ??= import("./skills.ts").then((m) => m.skillHands({ bridge, relay, ...(web ? { web: true } : {}) })).catch((e) => ((made = undefined), Promise.reject(e))));
  return {
    prices: async (q) => (await get()).prices(q),
    trending: async (c) => (await get()).trending(c),
    holdings: async () => (await get()).holdings(),
    price: async (s) => (await get()).price?.(s) ?? null,
    swapsUp: async () => (await get()).swapsUp?.() ?? null,
    balances: async () => {
      const k = await get();
      if (!k.balances) throw new Error("no balances");
      return k.balances();
    },
    quote: async (q) => (await get()).quote(q),
    services: async () => (await get()).services(),
    coins: async () => (await get()).coins(),
    find: async (sym, chain) => (await get()).find?.(sym, chain) ?? [],
  };
}

let sendSeq = 0;
/** A message's own id, made on this phone at the tap. */
export const sendId = (): string => `m${Date.now().toString(36)}${(sendSeq++).toString(36)}`;
/** What a Try again clears after the words it sends again: the lines of the try that failed (a cost, a Stop's cost and
 *  any words or cards stay). */
const SPENT = new Set(["fault", "needs-key", "stopped"]);
/**
 * The person's words into the list (pure): a new bubble, or, for words already there by their id (Try again; a held
 * reply asked again), none: the failed try's lines after that bubble go, so the answer comes under it.
 */
export function addWords(items: ChatItem[], text: string, id: string): ChatItem[] {
  const at = items.findIndex((i) => i.kind === "you" && i.id === id);
  if (at < 0) return [...items, { kind: "you", text, id }];
  return [...items.slice(0, at + 1), ...items.slice(at + 1).filter((i) => !SPENT.has(i.kind) && !(i.kind === "unpaid" && !i.stopped))];
}

/** Folds one event into the screen's list (pure: the hook and its tests use the same fold). */
export function foldChat(items: ChatItem[], e: ChatEvent): ChatItem[] {
  if (e.kind === "text") {
    const last = items.at(-1);
    return last?.kind === "agent" ? [...items.slice(0, -1), { kind: "agent", text: last.text + e.delta }] : [...items, { kind: "agent", text: e.delta }];
  }
  if (e.kind === "step") {
    const at = items.findIndex((i) => i.kind === "step" && i.id === e.id);
    const step: ChatItem = { kind: "step", id: e.id, tool: e.tool, line: e.line, state: e.state, ...(e.why ? { why: e.why } : {}) };
    return at >= 0 ? items.map((i, n) => (n === at ? step : i)) : [...items, step];
  }
  if (e.kind === "needs-you") return [...supersede(items, e.sheet), { kind: "needs-you", sheet: e.sheet, ...(e.sheet.kind === "home" ? { card: newCardId() } : {}) }];
  if (e.kind === "say") return [...items, { kind: "say", line: e.line }];
  if (e.kind === "plan") return planMoved(items, e.plan);
  if (e.kind === "fault") return [...items, { kind: "fault", line: e.line, ...(e.retry ? { retry: true as const } : {}), ...(e.fresh ? { fresh: true as const } : {}) }];
  if (e.kind === "needs-key") return [...items, { kind: "needs-key", why: e.why }];
  if (e.kind === "facts") return [...items, { kind: "facts", facts: e.facts }];
  if (e.kind === "note") return [...items, { kind: "note", line: e.line }];
  if (e.kind === "paused") return [...items, { kind: "paused" }];
  return items;
}

const tagOf = (s: ChatSheet): PlanTag | null => (s.kind === "home" && s.plan ? s.plan : null);
const MONEY_KINDS = new Set(["send", "swap", "move"]);
/** Never two cards for one goal (product decision, 3 Nov): a new card for a plan's step replaces that step's older card; a new send,
 *  swap or move outside a plan replaces an older one of the same kind. A card already opened keeps its own state (the
 *  MoneyCard shows Open only while it's untouched or closed). */
export function supersede(items: ChatItem[], next: ChatSheet): ChatItem[] {
  if (next.kind !== "home") return items;
  const t = tagOf(next);
  return items.map((i) => {
    if (i.kind !== "needs-you" || i.stale || i.sheet.kind !== "home") return i;
    const u = tagOf(i.sheet);
    const same = t ? !!u && u.id === t.id && u.step === t.step : !u && i.sheet.ask.kind === next.ask.kind && MONEY_KINDS.has(next.ask.kind);
    return same ? { ...i, stale: true } : i;
  });
}
/** A plan that started, ended or was dropped: its Start card is spent; a dropped plan's step cards are stale. */
export function planMoved(items: ChatItem[], p: Plan): ChatItem[] {
  return items.map((i) => {
    if (i.kind !== "needs-you" || i.stale) return i;
    if (i.sheet.kind === "plan" && i.sheet.plan.id === p.id && p.state !== "proposed") return { ...i, stale: true };
    if (i.sheet.kind === "plan-late" && i.sheet.plan === p.id && !p.late) return { ...i, stale: true };
    if (p.state === "dropped" && tagOf(i.sheet)?.id === p.id) return { ...i, stale: true };
    return i;
  });
}

/** What Claude is told when a step of an asked plan landed, or a step stopped (a note, never the person's words). */
export function noteFor(p: Plan, step: number, end: StepEnd, todo: string | undefined): string | null {
  const line = p.steps[step]?.line ?? "";
  if (todo) return `Step ${step + 1} (${line}) ${end.kind === "landed" ? "landed" : "went"}, by ZeroFee's own read of Activity. The plan's next step, in the person's words: ${todo}. Do it now with its own tool, or answer it in words if it asks for no money.`;
  if (end.kind === "stopped" || end.kind === "came-back") return `Step ${step + 1} (${line}) ${end.kind === "stopped" ? `stopped${"why" in end && end.why ? `: ${end.why}` : ""}` : "came back to the person"}. ZeroFee already told the person and that nothing else moved. Re-read what's needed and offer the shortest fix in one or two plain lines. Don't open that step again unless they say so.`;
  return null;
}

/** A runner's move into the chat's list: the plan, ZeroFee's line, the step's card, or the late card. */
export function foldRunner(items: ChatItem[], m: RunnerMove): ChatItem[] {
  let y = foldChat(items, { kind: "plan", plan: m.plan });
  if (m.line) y = foldChat(y, { kind: "say", line: m.line });
  if (m.sheet) y = foldChat(y, { kind: "needs-you", why: "home", sheet: { kind: "home", ...m.sheet } });
  if (m.late) y = foldChat(y, { kind: "needs-you", why: "plan-late", sheet: { kind: "plan-late", plan: m.plan.id } });
  return y;
}
/** A chat opened again: the card of a step shown and never opened goes back on screen (a saved chat keeps no card). */
export function resumeItems(items: ChatItem[], p: Plan | null): ChatItem[] {
  const s = p && live(p) ? p.steps[p.at] : null;
  if (!p || !s?.sheet || s.status !== "shown") return items;
  const sheet: TaggedSheet = { ...s.sheet, plan: { id: p.id, step: p.at } };
  return foldChat(items, { kind: "needs-you", why: "home", sheet: { kind: "home", ...sheet } });
}

/** One runner per bridge, for the app's life (it outlives the chat screen): its moves go to the chat on screen, or,
 *  with none on screen, straight into that chat's saved state. */
const runners = new WeakMap<Bridge, { runner: PlanRunner; sinks: Map<string, (m: RunnerMove) => void> }>();
export function runnerFor(bridge: Bridge, skills: Pick<SkillHands, "balances">, store: ReturnType<typeof chatStore>) {
  let r = runners.get(bridge);
  if (r) return r;
  const sinks = new Map<string, (m: RunnerMove) => void>();
  const runner = planRunner({
    balances: async () => (skills.balances ? skills.balances() : null),
    apply: (chatId, m) => {
      const sink = sinks.get(chatId);
      if (sink) return sink(m);
      void store.load(chatId).then((c) => c && store.save(chatId, { ...c, items: foldRunner(c.items, m), plan: live(m.plan) ? m.plan : null })).catch(() => undefined);
    },
  });
  r = { runner, sinks };
  runners.set(bridge, r);
  return r;
}

/** What a money card saw: when it opened, whether Home's sheet said it went or closed, the move's id; `told`: said to
 *  Claude in ZeroFee's record already. */
export interface CardWas { opened?: number; went?: boolean; closed?: boolean; movementId?: string; told?: boolean; /** the card read it landed, by Activity */ landed?: boolean }
let cardSeq = 0;
const newCardId = () => `k${Date.now().toString(36)}${(cardSeq++).toString(36)}`;
/** A card's news into the list (pure). */
export function cardSaw(items: ChatItem[], card: string, e: { kind: "opened" } | { kind: "ended"; went: boolean; movementId?: string } | { kind: "landed" }, now: number = Date.now()): ChatItem[] {
  return items.map((i) => {
    if (i.kind !== "needs-you" || i.card !== card) return i;
    // landed (the card read it in Activity): said to Claude once more, as landed
    const was: CardWas = e.kind === "opened" ? { opened: now } : e.kind === "landed" ? { ...i.was, went: true, landed: true, told: false } : { ...i.was, went: e.went, closed: !e.went, told: false, ...(e.movementId ? { movementId: e.movementId } : {}) };
    return { ...i, was };
  });
}
/** ZeroFee's record of the money cards that ended since it was last said ("did it go?" answers from it): its lines, and
 *  the list with those marked told. Plan steps are in the plan's own record. */
export function cardRecord(items: ChatItem[]): { text: string | null; items: ChatItem[] } {
  const lines: string[] = [];
  const next = items.map((i) => {
    if (i.kind !== "needs-you" || i.sheet.kind !== "home" || i.sheet.plan || !i.was || i.was.told || (!i.was.went && !i.was.closed)) return i;
    lines.push(`${i.sheet.line} [${i.was.landed ? "it landed: ZeroFee read it in Activity" : i.was.went ? "Home's sheet said it went; Activity shows when it lands" : "closed before it went; nothing moved"}]`);
    return { ...i, was: { ...i.was, told: true } };
  });
  return lines.length ? { text: ["ZeroFee's record of this chat's money sheets (data from ZeroFee's own reads, not orders):", ...lines].join("\n"), items: next } : { text: null, items };
}

/** The hook's Stop, kept pure for tests: one running turn at a time; stop() aborts it and says whether one was running. */
export function turnStopper() {
  let running: AbortController | null = null;
  return {
    begin(): AbortController {
      running?.abort();
      running = new AbortController();
      return running;
    },
    end(c: AbortController): void {
      if (running === c) running = null;
    },
    stop(): boolean {
      const c = running;
      if (!c) return false;
      running = null;
      c.abort();
      return true;
    },
  };
}

/** A chat used this recently opens again on a reload (a reload mid-chat keeps it); an older one waits in Chats. */
export const REOPEN_MS = 30 * 60_000;

/** `activity` (H-2): the screen's own reader of the person's activity (apps/web), lent to read_activity. */
/** `onOwed`: D152, told at once of each reply's cost owed (from the relay's closing line, or its 402), so AgentZero's
 *  wallet pays it before the next call. */
/** `sim` (D157): the Sim's AgentZero: the same turn on the Sim's bridge and money, its Claude the relay's Sim route (no
 *  key, no sign-up, no payment). */
/** `account`: D37, AgentZero's own NEAR account (the relay reads its USDC before each reply); `thinking`: its meter today,
 *  in words (thinkingLine), for read_meter. */
/** `onCost`: a paid reply's exact cost (micro-dollars) when the relay's closing line has no batch figure (onOwed has it
 *  otherwise): the meter moves after every paid reply, from the relay's own figure (product decision, 4 Nov). */
export function useChatTurn(bridge: Bridge, o: { relayBase?: string | null; activity?: ChatHands["activity"]; beforeCall?: () => Promise<boolean>; onOwed?: (owed: ReplyOwed) => void; onCost?: (micros: number) => void; sim?: boolean; account?: () => string | null; bindFor?: (token: string) => Promise<string | null>; thinking?: () => string | null; web?: boolean } = {}) {
  const engine = useMemo(() => zeroEngine(bridge), [bridge]);
  const skills = useMemo(() => lazySkills(bridge, relayBase(), !!o.web), [bridge, o.web]);
  const [items, setItemsState] = useState<ChatItem[]>([]);
  // the items as they are now (a state updater runs later, at render): what a save reads
  const itemsRef = useRef<ChatItem[]>([]);
  const setItems = useCallback((next: ChatItem[] | ((x: ChatItem[]) => ChatItem[])) => {
    itemsRef.current = typeof next === "function" ? next(itemsRef.current) : next;
    setItemsState(itemsRef.current);
  }, []);
  const [busy, setBusy] = useState(false);
  const [allowance, setAllowance] = useState<{ usedUsd: number; limitUsd: number } | null>(null);
  /** How the last turn reached Claude: the person's own key, AgentZero's paid reading (credit) or the free reading. */
  const [via, setVia] = useState<"own" | "paid" | "free" | null>(null);
  // each chat keeps its own context: the thread Claude reads is this chat's only (memory is shared, read per turn)
  const history = useRef<ChatMessage[]>([]);
  // each chat's plan (plan.ts): kept with the chat, sent with each turn, moved on by each step's end
  const plan = useRef<Plan | null>(null);
  // audit L16: this chat's stand-ins (a1, a2…), kept with it so each always means the same address or name
  const standIns = useRef<string[]>([]);
  const busyRef = useRef(false);
  const stopper = useMemo(() => turnStopper(), []);
  const store = useMemo(() => chatStore(bridge), [bridge]);
  const models = useMemo(() => modelStore(bridge), [bridge]);
  const chatId = useRef(newChatId());
  const [current, setCurrent] = useState(chatId.current);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const save = useCallback(async (id: string) => {
    if (id !== chatId.current) return;
    const list = await store.save(id, { items: itemsRef.current, history: history.current, plan: plan.current, standIns: standIns.current }).catch(() => null);
    if (list) setChats(list);
  }, [store]);
  // the plan runner outlives this screen; while this chat is on screen, its moves come here
  const runner = useMemo(() => runnerFor(bridge, skills, store), [bridge, skills, store]);
  useEffect(() => {
    const id = current;
    const sink = (m: RunnerMove) => {
      if (chatId.current !== id) return;
      plan.current = live(m.plan) ? m.plan : null;
      setItems((x) => foldRunner(x, m));
      void save(id);
    };
    runner.sinks.set(id, sink);
    return () => void (runner.sinks.get(id) === sink && runner.sinks.delete(id));
  }, [runner, current, setItems, save]);
  /** A chat's plan as it is now: the runner's while it waits (newer than the saved copy), else the saved one. */
  const planOf = useCallback((id: string, saved: Plan | null | undefined): Plan | null => {
    const p = runner.runner.plan(id) ?? (saved ? reopened(saved) : null);
    runner.runner.resume(id, p);
    return p;
  }, [runner]);
  // the saved chats, read once; the newest opens again if it was used a moment ago (a reload)
  useEffect(() => {
    let live = true;
    void store.list().then(async (list) => {
      if (!live) return;
      setChats(list);
      const last = list[0];
      if (!last || Date.now() - last.atMs > REOPEN_MS || itemsRef.current.length) return;
      const c = await store.load(last.id);
      if (!live || !c || itemsRef.current.length) return;
      chatId.current = last.id;
      setCurrent(last.id);
      history.current = c.history;
      standIns.current = c.standIns ?? [];
      plan.current = planOf(last.id, c.plan);
      setItems(resumeItems(c.items, plan.current));
    }, () => undefined);
    return () => void (live = false);
  }, [store, setItems, planOf]);
  const secret = useCallback(
    async (key: string) => {
      // wait.ts: the keychain within the core's limit (late: the turn says so, never a silent switch to the free reading)
      const r = await within(bridge.call<{ value: string | null }>("device.secret.get", { key }), LIMITS.core, "This phone's keychain");
      return "ok" in r ? (r.ok?.value ?? null) : null;
    },
    [bridge],
  );
  const run = useCallback(
    async (words: string, note = false, youId?: string) => {
      const said_ = words.trim();
      if (!said_ || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      if (!note) setItems((x) => addWords(x, said_, youId ?? sendId()));
      // the money cards that ended since the last turn, said to Claude once (as data, kept in the thread)
      const rec = cardRecord(itemsRef.current);
      const cards = rec.text;
      if (cards) setItems(rec.items);
      // the chat this turn belongs to: a turn still answering after the person opened another chat writes nothing there
      const id = chatId.current;
      const here = () => chatId.current === id;
      const ctrl = stopper.begin();
      const relay = o.relayBase === undefined ? relayBase() : o.relayBase;
      // this turn still counts (no Stop, no other chat): a turn Stop let go of writes nothing more (wait.ts, no-hang)
      const mine = () => here() && !ctrl.signal.aborted;
      try {
        // the person's choice of Claude (model.ts): known once read or set here, else read beside the key (no wait of its own)
        // wait.ts: the saved choice within the core's limit; late reads as the default, as an unreadable one does
        // the reads before a turn go at once (one limit's wait at most, never three in a row): the key, the choice, memory
        const memoryRead = withinOr(memoryStore(bridge).list(), LIMITS.core, "AgentZero's memory", [] as Awaited<ReturnType<ReturnType<typeof memoryStore>["list"]>>, ctrl.signal).catch(() => []);
        // the own key only in a developer build (own-key.ts): every other build thinks on AgentZero's funded wallet alone
        const [ownKey, choice, , mail] = await Promise.all([OWN_KEY_ON && !o.sim ? secret(CHAT_SECRETS.ownKey) : null, models.known() ?? withinOr(models.get(), LIMITS.core, "This phone's store", DEFAULT_CHOICE, ctrl.signal), memoryRead, o.sim ? undefined : mailHands(bridge).catch(() => undefined)]);
        // the person's own key goes straight to Anthropic; without one, the relay's allowance event says which reading
        if (ownKey) setVia("own");
        for await (const e of chatTurn(history.current, said_, {
          relayBase: relay,
          ownKey,
          token: relay && !o.sim ? await secret(CHAT_SECRETS.token) : null,
          ...(o.account && !o.sim ? { account: o.account(), ...(o.bindFor ? { bindFor: o.bindFor } : {}) } : {}),
          ...(o.sim ? { sim: true } : {}),
          saveToken: async (token) => void (await bridge.call("device.secret.set", { key: CHAT_SECRETS.token, value: token })),
          signal: ctrl.signal,
          model: choice.model,
          effort: choice.effort,
          plan: plan.current,
          ...(note ? { note: true } : {}),
          ...(cards ? { cards } : {}),
          standIns: standIns.current,
          ...(o.beforeCall ? { beforeCall: o.beforeCall } : {}),
          // A-11: the memory the person can see and delete, read fresh for each turn (data, never orders).
          memory: await memoryRead,
          hands: {
            receipts: async () => {
              await engine.refresh();
              const now = Date.now();
              const rs = engine.snapshot().receipts.slice(0, 10);
              return rs.length ? rs.map((r) => `${receiptTime(r.atIso, now)}: ${r.title} (${r.state})`).join("\n") : "No receipts yet.";
            },
            meter: async () => {
              await engine.refresh();
              return meterLine(engine.snapshot().state, o.thinking?.() ?? null);
            },
            ...(o.activity ? { activity: o.activity } : {}),
            actOn: AGENT_ACT,
            skills,
            ...(mail ? { mail } : {}),
            // W7: the web wallet offers only the tools that work there (tools.ts webTools)
            ...(o.web ? { offered: webTools(!!mail) } : {}),
          },
        })) {
          if (e.kind === "allowance") {
            setAllowance({ usedUsd: e.usedUsd, limitUsd: e.limitUsd });
            setVia(e.turnUsd !== undefined ? "paid" : "free");
            // D152: what this call owes goes to the wallet at once (it pays before the next call)
            if (e.owed) o.onOwed?.(e.owed);
            else if (e.turnUsd !== undefined && e.turnUsd > 0) o.onCost?.(Math.round(e.turnUsd * 1e6));
            // each paid call's exact cost, kept with the chat (the screen's "This reply cost …")
            if (e.turnUsd !== undefined && here()) setItems((x) => [...x, { kind: "cost", turnUsd: e.turnUsd! }]);
          }
          else if (e.kind === "unpaid") {
            o.onOwed?.(e.owed);
            if (here()) setItems((x) => [...x, { kind: "unpaid", ...(e.owed.stopped ? { stopped: true as const, turnUsd: e.owed.owedMicros / 1e6 } : {}) }]);
          }
          else if (e.kind === "refused") void engine.refused(e.line, said_).catch(() => undefined);
          else if (!mine()) continue;
          else if (e.kind === "done") history.current = e.history;
          else if (e.kind === "stand-ins") standIns.current = e.list;
          else if (e.kind === "plan") {
            plan.current = live(e.plan) ? e.plan : null;
            // a plan dropped or done in a turn: the runner stops waiting for it
            if (!live(e.plan)) runner.runner.stop(id);
            setItems((x) => foldChat(x, e));
          }
          else setItems((x) => foldChat(x, e));
        }
      } catch (e) {
        // a wait of AgentZero's own that ran out before the turn began (the keychain): said by name, the box free again
        // Stop during those reads: the Stop line is already there, nothing more to say
        if (e instanceof Stopped || ctrl.signal.aborted) return;
        if (!isTimedOut(e)) throw e;
        if (mine()) setItems((x) => [...x, { kind: "fault", line: timedOutLine(e.service) }]);
      } finally {
        // a turn Stop already let go of: Send is someone else's now (the next turn's), so this one frees nothing
        const released = ctrl.signal.aborted;
        stopper.end(ctrl);
        if (here() && !released) {
          busyRef.current = false;
          setBusy(false);
          void save(id);
        }
      }
    },
    [bridge, engine, skills, models, o.relayBase, o.activity, o.beforeCall, o.onOwed, o.onCost, o.sim, secret, stopper, save, setItems],
  );
  /** `id`: the message's own id (sendId): the same id again sends the same bubble's words again, never a second bubble. */
  const send = useCallback((words: string, id?: string) => run(words, false, id), [run]);
  /**
   * A plan step's sheet ended (its MoneyCard read it from Activity): the plan moves on in our own code: the next step's
   * card, or why it paused. An asked plan's next step in words, or a step that stopped, goes to Claude as ZeroFee's own
   * note (never the person's words), once per end, never in a loop and never while a turn is running.
   */
  const stepEnded = useCallback((tag: PlanTag, end: StepEnd) => {
    const p = plan.current;
    if (!p || p.id !== tag.id) return;
    // went or landed with a sheet step next: the runner waits for the money, then opens it (it says so itself)
    const m = runner.runner.ended(chatId.current, p, tag, end);
    if (!m) return;
    plan.current = live(m.plan) ? m.plan : null;
    setItems((x) => {
      let y = foldChat(x, { kind: "plan", plan: m.plan });
      if (m.line) y = foldChat(y, { kind: "say", line: m.line });
      if (m.sheet) y = foldChat(y, { kind: "needs-you", why: "home", sheet: { kind: "home", ...m.sheet } });
      return y;
    });
    const n = noteFor(m.plan, tag.step, end, m.todo);
    if (n && !busyRef.current) void run(n, true);
    else void save(chatId.current);
  }, [run, save, setItems, runner]);
  /** A money card's news (opened; Home's sheet went or closed, with the move's id), kept with the chat. */
  const cardSawIt = useCallback((card: string, e: { kind: "opened" } | { kind: "ended"; went: boolean; movementId?: string } | { kind: "landed" }) => {
    setItems((x) => cardSaw(x, card, e));
    void save(chatId.current);
  }, [setItems, save]);
  /** The late card's Check again, and Stop the plan. */
  const planCheck = useCallback(() => {
    if (plan.current) runner.runner.check(chatId.current, plan.current);
  }, [runner]);
  const planStop = useCallback(() => {
    const p = plan.current;
    runner.runner.stop(chatId.current);
    if (!p) return;
    const d = dropPlan(p);
    plan.current = null;
    setItems((x) => foldRunner(x, { plan: d.plan, line: d.line }));
    void save(chatId.current);
  }, [runner, setItems, save]);
  /** Stop: aborts the turn's request (relay or own key) and says "Stopped." The history keeps only finished turns. */
  const stop = useCallback(() => {
    if (!stopper.stop()) return;
    setItems((x) => [...x, { kind: "stopped" }]);
    // Stop always frees Send at once, even while a wait the turn can't abort (a core read) is still out
    busyRef.current = false;
    setBusy(false);
    void save(chatId.current);
  }, [stopper, setItems, save]);
  /** Leaves this chat (kept in Chats) for another: a running turn stops first. */
  const switchTo = useCallback((id: string, c: { items: ChatItem[]; history: ChatMessage[]; plan?: Plan | null; standIns?: string[] }) => {
    stopper.stop();
    busyRef.current = false;
    setBusy(false);
    // the chat left is kept as it stands (a turn stopped by the switch keeps the person's words)
    const left = chatId.current;
    if (left !== id) void store.save(left, { items: itemsRef.current, history: history.current, plan: plan.current, standIns: standIns.current }).then(setChats, () => undefined);
    chatId.current = id;
    setCurrent(id);
    history.current = c.history;
    standIns.current = c.standIns ?? [];
    plan.current = planOf(id, c.plan);
    setItems(resumeItems(c.items, plan.current));
  }, [stopper, setItems, store, planOf]);
  /** New chat: an empty thread with no context; the one left stays in Chats. */
  const newChat = useCallback(() => switchTo(newChatId(), { items: [], history: [] }), [switchTo]);
  const clear = newChat;
  /** Opens a saved chat to carry on: its own thread and context come back. */
  const open = useCallback(async (id: string) => {
    if (id === chatId.current) return true;
    const c = await store.load(id).catch(() => null);
    if (!c) return false;
    switchTo(id, c);
    return true;
  }, [store, switchTo]);
  /** Deletes a saved chat from this phone; deleting the open one starts a new chat. */
  const remove = useCallback(async (id: string) => {
    const list = await store.remove(id).catch(() => null);
    if (list) setChats(list);
    if (id === chatId.current) newChat();
  }, [store, newChat]);
  /** ZeroFee's own line into the thread (the key card's "Claude is ready"). */
  const note = useCallback((line: string) => setItems((x) => [...x, { kind: "note", line }]), [setItems]);
  return { items, busy, allowance, via, send, stop, clear, note, chats, current, newChat, open, remove, stepEnded, planCheck, planStop, cardSaw: cardSawIt };
}
