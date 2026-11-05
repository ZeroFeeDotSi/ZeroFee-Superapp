// Which Claude the AgentZero chat runs, chosen by the person (product decision, 3 Nov: "allow people to select which Claude model
// they are running. Sonnet with a meter for effort, and Opus. Only those for now."). Kept on this device (device.store),
// never with the key (device.secret) and never in a chat's own storage. Only the two ids below are ever sent: anything
// else read from the store, or handed in, falls back to the default (DEFAULT_CHOICE: Sonnet 5.5, D158).
// The relay keeps its own copy of this list and these prices (apps/quotes/agentzero-chat.mjs CHAT_MODELS, agentzero.mjs
// PRICES); apps/quotes/agentzero-chat.test.ts holds them equal.
import { REPLY_PRICES } from "@zerofee/core/agent-price";
import type { Bridge } from "@zerofee/core/bridge";

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5"] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];
/** The meter's three steps (the API has more; the chat offers only these). */
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];
export interface ClaudeChoice {
  model: ClaudeModel;
  effort: Effort;
}

/** Each model's own API default: Opus 5.5 medium, Sonnet 5.5 high. */
export const DEFAULT_EFFORT: Record<ClaudeModel, Effort> = { "claude-opus-5-5": "medium", "claude-sonnet-5-5": "high" };
/** D158 (product decision, 4 Nov): Sonnet 5.5 is AgentZero's chat default everywhere, the real app and the Sim, at its own API default
 *  effort; the person can still pick Opus 5.5. The relay's chat route answers a body with no choice the same way
 *  (apps/quotes/agentzero.mjs CHAT_DEFAULT; agentzero-chat.test.ts holds them equal). */
export const DEFAULT_CHOICE: ClaudeChoice = { model: "claude-sonnet-5-5", effort: DEFAULT_EFFORT["claude-sonnet-5-5"] };

const isModel = (x: unknown): x is ClaudeModel => typeof x === "string" && (CLAUDE_MODELS as readonly string[]).includes(x);
const isEffort = (x: unknown): x is Effort => typeof x === "string" && (EFFORTS as readonly string[]).includes(x);

/** Any value, checked against the allow-list: an unknown model is the default choice; an unknown effort is the model's own. */
export function claudeChoice(x: unknown): ClaudeChoice {
  const o = x && typeof x === "object" ? (x as { model?: unknown; effort?: unknown }) : {};
  if (!isModel(o.model)) return { ...DEFAULT_CHOICE };
  return { model: o.model, effort: isEffort(o.effort) ? o.effort : DEFAULT_EFFORT[o.model] };
}

/** Dollars per million tokens (Anthropic's price list): the one table the phone also pays each reply by (D152,
 *  @zerofee/core agent-price.ts REPLY_PRICES). */
export const MODEL_PRICE: Record<ClaudeModel, { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number }> = REPLY_PRICES;
/** One chat message, measured (3 Nov): about 7,300 tokens in, 170 out, none of it cached yet (a first message alone is
 *  5,303 in, measured on both models the same day). `cachedIn`: how many of the tokens in are cache reads. */
export const TYPICAL_MESSAGE = { input: 7_300, output: 170, cachedIn: 0 };
/** What one typical message costs on a model, in dollars. */
export function messageUsd(model: ClaudeModel, t = TYPICAL_MESSAGE): number {
  const p = MODEL_PRICE[model];
  return ((t.input - t.cachedIn) * p.input + t.cachedIn * p.cacheRead + t.output * p.output) / 1e6;
}
/** "About 3½¢ a message.": to the nearest half cent (at least ½¢), so Sonnet's half of Opus still reads as half. */
export function aboutLine(usd: number): string {
  const halves = Math.max(1, Math.round(usd * 200));
  const whole = Math.floor(halves / 2);
  return `About ${whole ? String(whole) : ""}${halves % 2 ? "½" : ""}¢ a message.`;
}

/** QA's real test (5 Nov): "About 1½¢" was shown, 2.2¢ was paid: a message is often two calls (a tool round,
 *  the context read again). The figure said before a message is the most it usually costs, never the typical one. */
export const MESSAGE_CALLS = 2;
export const messageUpperUsd = (model: ClaudeModel): number => MESSAGE_CALLS * messageUsd(model);
/** "One message costs up to 3½¢." (the copywriter): rounded UP to the half cent, so it never undershoots. */
export function upToLine(usd: number): string {
  const halves = Math.max(1, Math.ceil(Math.round(usd * 2e6) / 1e4));
  const whole = Math.floor(halves / 2);
  return `One message costs up to ${whole ? String(whole) : ""}${halves % 2 ? "½" : ""}¢.`;
}

/** What the Model section shows for each choice. */
export const MODEL_WORDS: Record<ClaudeModel, { name: string; chip: string; line: string }> = {
  "claude-opus-5-5": { name: "Claude Opus 5.5", chip: "Opus", line: "Most capable." },
  "claude-sonnet-5-5": { name: "Claude Sonnet 5.5", chip: "Sonnet", line: "Faster and cheaper." },
};
export const EFFORT_WORDS: Record<Effort, { name: string; line: string }> = {
  low: { name: "Low", line: "Quicker, shorter answers." },
  medium: { name: "Medium", line: "Balanced." },
  high: { name: "High", line: "Thinks harder, costs more." },
};

/** Where the choice lives on this device (device.store; the key is device.secret's "agentzero.claude-key"). */
export const MODEL_KEY = "agentzero.model";

/** The last choice read or written per bridge: a send reads it without waiting once it's known. */
const known = new WeakMap<Bridge, ClaudeChoice>();

export function modelStore(bridge: Bridge) {
  return {
    /** The choice as last known here, or undefined before the first read. */
    known: (): ClaudeChoice | undefined => known.get(bridge),
    /** The saved choice, checked; the default when none is saved or it can't be read. */
    async get(): Promise<ClaudeChoice> {
      const have = known.get(bridge);
      if (have) return have;
      let raw: unknown = null;
      try {
        const r = await bridge.call<{ value: string | null }>("device.store.get", { key: MODEL_KEY });
        const v = "ok" in r ? (r.ok?.value ?? null) : null;
        raw = v ? JSON.parse(v) : null;
      } catch {
        raw = null;
      }
      const c = claudeChoice(raw);
      if (!known.has(bridge)) known.set(bridge, c);
      return known.get(bridge)!;
    },
    /** Saves the choice (checked first: only the allow-list is ever written). */
    async set(choice: ClaudeChoice): Promise<ClaudeChoice> {
      const c = claudeChoice(choice);
      known.set(bridge, c);
      await bridge.call("device.store.set", { key: MODEL_KEY, value: JSON.stringify(c) });
      return c;
    },
  };
}
