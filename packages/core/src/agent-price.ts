// What one AgentZero reply costs, exactly (D152, product decision, 3 Nov: "compute exactly their API costs, we charge nothing on
// top"): Anthropic's own usage for the reply × the model's published price, with no markup and no flat price. ONE table:
// the chat's model picker shows it (packages/agent chat/model.ts MODEL_PRICE is this one), the phone pays by it
// (agent-pay.ts), and the relay's own copy (apps/quotes/agentzero.mjs PRICES, costMicros) is held equal to it by a test.
// Its own small module, so screens and the relay's tests read it without the core's chain code.

/** Dollars per million tokens, as Anthropic publishes them. */
export const REPLY_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
} as const;
export type PricedModel = keyof typeof REPLY_PRICES;

/** Anthropic's four counts for one reply. */
export interface ReplyUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** The most one reply may cost before the phone refuses to pay it (D152 SR3 M6: a relay that lies about usage is bounded
 *  by this and the month's cap). An honest reply's most is about $0.15 (the relay's own reservation). */
export const REPLY_CAP_MICROS = 250_000;
/** D37 (QA 4 Nov: a $0 wallet got replies on credit): no credit. Anything unpaid (1 micro-dollar or more) is paid at once,
 *  and the relay holds the next reply until it is. The relay's copy is apps/quotes/agentzero-pay.mjs SETTLE_AT_MICROS
 *  (a test holds them equal). */
export const SETTLE_AT_MICROS = 1;
/** D37: prepaid only. A message goes only when AgentZero's own USDC covers the most one reply can cost: the relay's
 *  reservation, apps/quotes/agentzero-chat.mjs CHAT_CALL_MICROS (~$0.15; a test holds them equal). The relay checks the
 *  same on chain before Claude is asked. */
export const REPLY_HOLD_MICROS = 152_000;
/** The most one payment may be before the phone refuses it: one reply (an older relay's batch: under $0.25, then one). */
export const BATCH_CAP_MICROS = SETTLE_AT_MICROS + REPLY_CAP_MICROS;
/** The most output one reply can have: the relay's own max_tokens (apps/quotes/agentzero-chat.mjs CHAT_MAX_TOKENS, thinking
 *  included), held equal by a test; a reply said to have more is refused. */
export const REPLY_MAX_OUTPUT = 4_000;

const count = (v: unknown): number | null => (v === undefined || v === null ? 0 : Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/**
 * The reply's exact cost in micro-dollars (USDC's smallest unit): the relay's costMicros, the same rounding (up, once,
 * on the sum). Null for an unknown model or a count that isn't a whole number of tokens.
 */
export function replyMicros(usage: unknown, model: unknown): number | null {
  if (typeof model !== "string" || !Object.hasOwn(REPLY_PRICES, model)) return null;
  const p = REPLY_PRICES[model as PricedModel];
  const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, unknown>;
  const i = count(u.input_tokens), o = count(u.output_tokens), r = count(u.cache_read_input_tokens), w = count(u.cache_creation_input_tokens);
  if (i === null || o === null || r === null || w === null || o > REPLY_MAX_OUTPUT) return null;
  return Math.ceil(i * p.input + o * p.output + r * p.cacheRead + w * p.cacheWrite);
}

/**
 * A batch's exact cost (product decision, 4 Nov): its usage summed per model (`byModel`, model → Anthropic's four counts) × each
 * model's price, over `replies` replies (each at most REPLY_MAX_OUTPUT out). Null for an unknown model, a count that
 * isn't a whole number of tokens, or more output than that many replies can have.
 */
export function batchMicros(byModel: unknown, replies: unknown): number | null {
  if (!byModel || typeof byModel !== "object" || Array.isArray(byModel)) return null;
  const n = Number.isSafeInteger(replies) && (replies as number) >= 1 ? (replies as number) : 1;
  let sum = 0;
  for (const [model, usage] of Object.entries(byModel as Record<string, unknown>)) {
    if (typeof model !== "string" || !Object.hasOwn(REPLY_PRICES, model)) return null;
    const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, unknown>;
    const p = REPLY_PRICES[model as PricedModel];
    const i = count(u.input_tokens), o = count(u.output_tokens), r = count(u.cache_read_input_tokens), w = count(u.cache_creation_input_tokens);
    if (i === null || o === null || r === null || w === null || o > REPLY_MAX_OUTPUT * n) return null;
    sum += Math.ceil(i * p.input + o * p.output + r * p.cacheRead + w * p.cacheWrite);
  }
  return sum;
}

/** A cost as people read it, to the hundredth of a cent where it matters: "$0.0123"; never "$0.00" for something paid. */
export function replyCost(micros: number): string {
  if (!(micros > 0)) return "$0";
  const usd = micros / 1e6;
  if (usd < 0.0001) return "under $0.0001";
  return usd >= 0.1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}
