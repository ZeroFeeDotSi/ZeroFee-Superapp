// AgentZero's saved chats (product decision, 3 Nov), like the Claude app: each chat is kept on this phone
// (the bridge's device.store, the agent app's own names), listed newest first and titled by its first words, opened to
// carry on and deleted with one tap. Each chat keeps its own thread and its own context (the conversation Claude reads);
// only "What AgentZero remembers" (memory.ts) is shared across chats. The long-thread cap (turn.ts trimHistory) runs on
// each chat's own thread. Nothing secret is kept here: the AI key lives in the keychain (device.secret), and anything
// in a chat shaped like a key is taken out before it is saved.
import { LIMITS, within } from "./wait.ts";
import type { Bridge } from "@zerofee/core/bridge";
import type { ChatItem } from "./use-chat-turn.ts";
import type { ChatMessage } from "./turn.ts";
import type { Plan } from "./plan.ts";

/** The list of chats (id, title, when), newest first. */
export const CHATS_KEY = "agentzero.chats";
/** One chat's thread and context. */
export const chatKey = (id: string) => `agentzero.chat.${id}`;
/** The most chats kept: the oldest goes past this. */
export const CHATS_MAX = 30;
/** A title's length: the first words, cut at a word. */
export const TITLE_MAX = 40;
/** A chat's stored size, under the iPhone's 256 KB a value (Bridge.swift maxStored), with room for its JSON. */
export const CHAT_STORE_MAX = 200_000;
/** What a saved chat says where a sheet was: an old sheet is never tapped through later (it asks again). */
export const OLD_SHEET_LINE = "This was a sheet from before. Ask again to see it.";

export interface ChatMeta {
  id: string;
  title: string;
  atMs: number;
}
export interface SavedChat {
  items: ChatItem[];
  history: ChatMessage[];
  /** the chat's plan (plan.ts), so a reload carries on where it was */
  plan?: Plan | null;
  /** audit L16: the chat's stand-ins (standins.ts), so a1 always means the same one */
  standIns?: string[];
}

/** Anything shaped like an AI key (Anthropic's sk-ant-…, an OpenAI-style sk-…): never kept in a chat. */
const KEY_SHAPE = /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g;
export const KEY_REMOVED = "[key removed]";
const scrub = (json: string) => json.replace(KEY_SHAPE, KEY_REMOVED);

/** A chat's title: its first words, plain and short ("What did I spend this week?"). */
export function chatTitle(items: readonly ChatItem[]): string {
  const first = items.find((i): i is Extract<ChatItem, { kind: "you" }> => i.kind === "you");
  const words = (first?.text ?? "").replace(KEY_SHAPE, KEY_REMOVED).replace(/\s+/g, " ").trim();
  if (!words) return "New chat";
  if (words.length <= TITLE_MAX) return words;
  const cut = words.slice(0, TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : TITLE_MAX).trimEnd()}…`;
}

/** The items as they are kept: a sheet becomes a plain line (never Reviewed later), the key card is not kept. */
export function keptItems(items: readonly ChatItem[]): ChatItem[] {
  // a plan step's card keeps its own line (ZeroFee's, plan.ts): never "nothing moved" for a step that may have gone
  // a plain money card keeps what it saw: the screen says what became of it from Activity (never "nothing moved" unread);
  // any other sheet is a line that claims nothing about money
  return items.flatMap((i): ChatItem[] => (i.kind === "needs-key" ? [] : i.kind === "needs-you" ? [i.sheet.kind === "home" && i.sheet.plan ? { kind: "say", line: i.sheet.line } : i.sheet.kind === "plan" ? { kind: "say", line: `Plan: ${i.sheet.plan.steps.map((x, n) => `${n + 1}) ${x.line}`).join(" ")}` } : i.sheet.kind === "home" && MONEY_ASKS.has(i.sheet.ask.kind) ? { kind: "old-sheet", line: i.sheet.line, was: i.was ?? {} } : { kind: "say", line: OLD_SHEET_LINE }] : [i]));
}

/** A saved chat as JSON, scrubbed of key shapes and brought under the store's size: oldest items and turns go first. */
export function chatJson(c: SavedChat, max = CHAT_STORE_MAX): string {
  let items = keptItems(c.items);
  let history = c.history;
  const plan = c.plan ?? null;
  const standIns = c.standIns ?? [];
  let json = scrub(JSON.stringify({ items, history, plan, standIns }));
  while (json.length > max && (items.length > 1 || history.length > 0)) {
    if (history.length) {
      // a turn starts at the person's own words (as turn.ts trimHistory keeps it): drop whole turns from the front
      const next = history.findIndex((m, n) => n > 0 && m.role === "user" && typeof m.content === "string");
      history = next > 0 ? history.slice(next) : [];
    }
    if (items.length > 1) items = items.slice(Math.ceil(items.length / 4));
    json = scrub(JSON.stringify({ items, history, plan, standIns }));
  }
  return json;
}

const ITEM_KINDS = new Set(["you", "agent", "step", "fault", "note", "facts", "stopped", "say", "old-sheet"]);
/** The cards whose money can move once opened (an Add or a Request waits for someone else's money). */
const MONEY_ASKS = new Set(["send", "swap", "move", "trade"]);
const STEP_STATUS = new Set(["waiting", "shown", "open", "landed", "went", "closed", "stopped", "came-back", "held", "unknown", "skipped", "done"]);
const PLAN_STATE = new Set(["proposed", "running", "paused", "done", "dropped"]);
/** A kept plan, read strictly: a wrong shape is no plan (never guessed). Its sheets were checked when it was made. */
export function readPlan(x: unknown): Plan | null {
  const p = x as Plan | null;
  if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.goal !== "string" || !Array.isArray(p.steps) || !p.steps.length || p.steps.length > 6) return null;
  if (!PLAN_STATE.has(p.state) || (p.made !== "zerofee" && p.made !== "asked") || !Number.isInteger(p.at) || p.at < 0 || p.at >= p.steps.length) return null;
  const ok = p.steps.every((s) => !!s && typeof s.line === "string" && STEP_STATUS.has(s.status) && (s.sheet === undefined || (!!s.sheet && typeof s.sheet === "object" && typeof s.sheet.line === "string" && !!s.sheet.ask && typeof s.sheet.ask === "object")));
  return ok ? p : null;
}
/** A stored chat, read strictly (anything else is dropped, never guessed). */
export function readChat(raw: string | null): SavedChat | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as { items?: unknown; history?: unknown; plan?: unknown; standIns?: unknown };
    if (!x || !Array.isArray(x.items) || !Array.isArray(x.history)) return null;
    const items = x.items.filter((i): i is ChatItem => !!i && typeof i === "object" && ITEM_KINDS.has((i as { kind?: string }).kind ?? "") && ((i as { kind?: string }).kind !== "old-sheet" || (typeof (i as { line?: unknown }).line === "string" && !!(i as { was?: unknown }).was && typeof (i as { was?: unknown }).was === "object")));
    const history = x.history.filter((m): m is ChatMessage => !!m && typeof m === "object" && ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant"));
    const plan = readPlan(x.plan);
    const standIns = Array.isArray(x.standIns) && x.standIns.length <= 999 && x.standIns.every((v) => typeof v === "string" && v.length <= 128) ? (x.standIns as string[]) : undefined;
    return { items, history, ...(plan ? { plan } : {}), ...(standIns ? { standIns } : {}) };
  } catch {
    return null;
  }
}

/** The list, read strictly, newest first. */
export function readChats(raw: string | null): ChatMeta[] {
  if (!raw) return [];
  try {
    const x = JSON.parse(raw) as unknown;
    if (!Array.isArray(x)) return [];
    return x
      .filter((c): c is ChatMeta => !!c && typeof c === "object" && typeof (c as ChatMeta).id === "string" && /^[a-z0-9-]{1,40}$/.test((c as ChatMeta).id) && typeof (c as ChatMeta).title === "string" && Number.isFinite((c as ChatMeta).atMs))
      .sort((a, b) => b.atMs - a.atMs)
      .slice(0, CHATS_MAX);
  } catch {
    return [];
  }
}

/** A fresh chat id (lower case, the store's names: a–z, 0–9, dashes). */
let seq = 0;
export const newChatId = (nowMs: number = Date.now()) => `c-${nowMs.toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The phone's chats, on the agent app's own store. */
export function chatStore(bridge: Bridge, now: () => number = Date.now) {
  const get = async (key: string) => {
    // wait.ts: a read within the core's limit; late throws (never read as "no chats", so nothing is overwritten). Writes
    // are not timed out: a late write landing after a newer one would undo it.
    const r = await within(bridge.call<{ value: string | null }>("device.store.get", { key }), LIMITS.core, "This phone's store");
    return "ok" in r ? (r.ok?.value ?? null) : null;
  };
  const set = async (key: string, value: string | null) => void (await bridge.call("device.store.set", { key, value }));
  const list = async () => readChats(await get(CHATS_KEY));
  // one write at a time: two saves at once (the chat left, the chat opened) never lose each other's line in the list
  let last: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = last.then(fn, fn);
    last = run.catch(() => undefined);
    return run;
  };
  return {
    list,
    async load(id: string): Promise<SavedChat | null> {
      return readChat(await get(chatKey(id)));
    },
    /** Saves a chat with at least one message of the person's; puts it first in the list. Returns the new list. */
    save: (id: string, c: SavedChat): Promise<ChatMeta[]> => serial(async () => {
      const chats = await list();
      if (!c.items.some((i) => i.kind === "you")) return chats;
      await set(chatKey(id), chatJson(c));
      const next = [{ id, title: chatTitle(c.items), atMs: now() }, ...chats.filter((m) => m.id !== id)];
      for (const old of next.slice(CHATS_MAX)) await set(chatKey(old.id), null);
      await set(CHATS_KEY, JSON.stringify(next.slice(0, CHATS_MAX)));
      return next.slice(0, CHATS_MAX);
    }),
    remove: (id: string): Promise<ChatMeta[]> => serial(async () => {
      const next = (await list()).filter((m) => m.id !== id);
      await set(chatKey(id), null);
      await set(CHATS_KEY, JSON.stringify(next));
      return next;
    }),
  };
}
