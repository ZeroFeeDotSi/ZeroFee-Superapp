// AgentZero in the Sim (D157, product decision, 3 Nov):
// POST /v0/agentzero/sim {messages, today?} → text/event-stream, the same stream as /v0/agentzero/chat.
//
// The Sim is ZeroFee on pretend money in a browser tab (superapp.zerofee.si). Its AgentZero runs the REAL brain (the
// app's chatTurn, its prompt, plans and tools); its tools act on the Sim's own sample money in the tab. This route is
// that brain's Claude, on ZeroFee's own key, free to the visitor, with hard caps, all fixed here whatever the body says:
//   - the web app's own origins only (never the iPhone's: the phone is real money and has its own route);
//   - Claude Sonnet 5.5 at effort low, SIM_MAX_TOKENS out, the cached system prompt (the chat's own, then the Sim's line)
//     and the Sim's tool list (the chat's own minus anything that acts in the real world): the body names none of these;
//   - the conversation as the body sends it, cut to its last SIM_TURNS turns and SIM_HISTORY_CHARS characters;
//   - per visitor (the caller's address, keyed by its HMAC in the private store): SIM_PER_MINUTE asks a minute and
//     AGENTZERO_SIM_PER_IP_USD (SIM_PER_IP_USD) of measured cost a UTC day (D158), its network SIM_PER_NETWORK_USD (audit
//     #8); relay-wide AGENTZERO_SIM_DAILY_USD, its last fifth only for a light network
//     (SIM_DAILY_USD) a UTC day. Each call's most is reserved on both first, Anthropic's own usage at the published
//     price settled after (costMicros, as D152);
//   - only on the private store (AGENTZERO_STORE_KEY: every key an HMAC, every value a number). Without it the route is
//     off: 503 agentzero.sim.off. The relay's day spent: 429 agentzero.sim.rested (the Sim says it has rested for today).
//     A visitor's day spent: 429 agentzero.sim.visitor (the Sim says their free replies are used for today).
// Nothing is kept but those counts. No sign-up, no token, no payment.
import { addressBucket, networkBucket } from "./guards.mjs";
import { READS_RESERVE_SHARE } from "./read-limits.mjs";
import { CACHE, CHAT_SYSTEM, cacheMarks, chatTools, cleanMessages, dayLine, streamTurn } from "./agentzero-chat.mjs";
import { costMicros, PRICES, readCapped } from "./agentzero.mjs";

export const SIM_MODEL = "claude-sonnet-5-5";
export const SIM_EFFORT = "low";
export const SIM_MAX_TOKENS = 800;
/**
 * D158: a visitor's day, in dollars of measured cost (AGENTZERO_SIM_PER_IP_USD), inside the relay's day. Product decision, 3 Nov
 * (ledger row 3): under $1 per IP, always; QA 5 Nov: $0.90. A value of $1 or more from the env is ignored.
 */
export const SIM_PER_IP_USD = 0.9;
/** The per-IP day is held under this, whatever the env says. */
export const SIM_PER_IP_CEILING_USD = 1;
/**
 * Audit #8: a network's day (networkBucket: an IPv6 /48, an IPv4 address as is), so one holder of many /64s can't rest
 * the Sim for everyone; and the relay's day keeps a reserve (READS_RESERVE_SHARE of it) only for a visitor whose network
 * has spent no more than one visitor's day (SIM_PER_IP_USD) today.
 */
export const SIM_PER_NETWORK_USD = 3;
export const SIM_PER_MINUTE = 6;
/**
 * The relay's day for the Sim, of measured cost (AGENTZERO_SIM_DAILY_USD raises it). QA 5 Nov: $2 with the
 * env unset, never more: the Sim runs on the operator's AgentZero key, whose whole budget is about $17.
 */
export const SIM_DAILY_USD = 2;
export const SIM_TURNS = 12;
export const SIM_HISTORY_CHARS = 16_000;
/** The chat route's own most messages in one request (agentzero-chat.mjs cleanMessages). */
const SIM_MESSAGES = 40;
/** The body: the history as the tab keeps it (the route cuts it), its memory and the day. */
export const SIM_BODY_MAX = 65_536;
export const SIM_OFF = "agentzero.sim.off";
export const SIM_RESTED = "agentzero.sim.rested";
export const SIM_VISITOR = "agentzero.sim.visitor";
/** The copywriter's lines after a cap, the app's sim.ts SIM_VISITOR_LINE
 *  and SIM_RESTED_LINE; a test holds them equal. */
export const SIM_VISITOR_WORDS = "You used up today's free AgentZero replies here. Come back tomorrow, or use the ZeroFee iPhone app.";
export const SIM_RESTED_WORDS = "AgentZero is off in the Sim right now. Use it in the ZeroFee iPhone app.";
/** The one line the Sim says for anything that acts in the real world (the app's sim.ts SIM_REAL_LINE; a test holds them equal). */
export const SIM_REAL_LINE = "This is the Sim. On the iPhone app it does this for real.";
/**
 * The tools that act in the real world, left out of the Sim's list: AgentZero's jobs (copying a wallet on pump.fun,
 * keeping money ready, paying a list, signing in to sites) and stopping one, its own wallet's acts, its mail, its
 * receipts and pocket money (its real jobs' records), and the browser.
 */
export const SIM_REAL_TOOLS = ["propose_job", "stop_job", "propose_act", "read_mail", "read_receipts", "read_meter", "browse"];
/**
 * The Sim's approval in the browser's words (the app's packages/agent sim.ts simWords; a test holds them equal): a
 * browser tab has no Face ID, the Sim's sheet has an Approve button.
 */
const SIM_APPROVAL = [
  [/Only (their|your) Face ID moves it/g, "Only $1 approval moves it"],
  [/ready for your Face ID/g, "ready for you to approve"],
  [/tap Open, then Face ID/g, "tap Open, then Approve"],
  [/you approve each with Face ID/g, "you approve each one"],
  [/(approves?|approved) (it )?(?:with|on) (?:their |your |the person's )?Face ID/g, "$1 it"],
  [/(?:with|on) (?:their |your |the person's )?Face ID/g, "with an approval"],
  [/(the person's|their|your) Face ID/g, "$1 approval"],
  [/\bFace ID\b/g, "an approval"],
];
export const simWords = (text) => SIM_APPROVAL.reduce((t, [re, to]) => t.replace(re, to), text);
/** The Sim's tools: the chat's own, in the chat's own order, minus the real-world ones, their words the browser's. */
export const simTools = (jobSchema) => chatTools(jobSchema).filter((t) => !SIM_REAL_TOOLS.includes(t.name)).map((t) => ({ ...t, description: simWords(t.description) }));
/** Said after the chat's own system prompt (its cache mark stays on that one): what the Sim is and its one honest line. */
export const SIM_SYSTEM = [
  "This is the Sim: ZeroFee on pretend money, in a browser tab. Everything here is sample money; nothing real moves.",
  "In the Sim, send, swap, move, add, request and trade open the Sim's own sheets on its pretend money, and read_holdings and read_activity read its pretend money. Use them exactly as in the app.",
  "In the Sim, AgentZero has no wallet of its own and its thinking is free: never mention paying for replies.",
  "In the Sim there is no Face ID: it runs in a browser tab, and the person approves each money step on the Sim's sheet with its Approve button. Never say Face ID; say they approve it.",
  `What only the iPhone app does for real: AgentZero's jobs (copying a wallet on pump.fun, keeping money ready, paying a list of people, signing in to sites), its email, signing up anywhere, browsing a website, and AgentZero's own wallet. Asked for any of those, reply with exactly this one line and nothing else: "${SIM_REAL_LINE}"`,
].join("\n");

/** The Messages request, built here only: the model, effort, max_tokens, system prompt and tools are the route's own. */
export const simRequest = (messages, tools, day = dayLine(undefined)) => ({
  model: SIM_MODEL,
  max_tokens: SIM_MAX_TOKENS,
  thinking: { type: "adaptive" },
  output_config: { effort: SIM_EFFORT },
  system: [{ type: "text", text: CHAT_SYSTEM, cache_control: CACHE }, { type: "text", text: SIM_SYSTEM }, { type: "text", text: day }],
  tools,
  messages: cacheMarks(messages),
});

/** A turn starts at the person's own words (a user message whose content is a plain string). */
const startsTurn = (m) => m && m.role === "user" && typeof m.content === "string";
const noThinking = (m) => (typeof m.content === "string" ? m : { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") });
/**
 * The history the Sim sends Claude: its last SIM_TURNS turns, then the oldest dropped until it is SIM_HISTORY_CHARS
 * characters or fewer (as JSON) and 40 messages or fewer, always starting at the person's own words. When anything was cut, every thinking block
 * goes too (preserved thinking: a block made with the whole history present is refused once its earlier messages are
 * gone; text and tool calls stay). Null when even the newest turn alone is over the limit.
 */
export function simHistory(messages) {
  const starts = messages.map((m, i) => (startsTurn(m) ? i : -1)).filter((i) => i >= 0);
  if (!starts.length) return null;
  let at = starts.length > SIM_TURNS ? starts[starts.length - SIM_TURNS] : 0;
  const fits = (from) => messages.length - from <= SIM_MESSAGES && JSON.stringify(messages.slice(from).map(noThinking)).length <= SIM_HISTORY_CHARS;
  for (const s of starts) {
    if (s < at) continue;
    at = s;
    if (fits(s)) break;
  }
  if (!fits(at)) return null;
  const kept = messages.slice(at);
  if (at === 0 && JSON.stringify(kept).length <= SIM_HISTORY_CHARS) return kept;
  return kept.map(noThinking).filter((m) => typeof m.content === "string" || m.content.length > 0);
}
/** The most one Sim call can cost, reserved before Anthropic is asked: ~14k tokens in at Sonnet 5.5's $2/M (the prompt,
 *  the tools and 16k characters of history), SIM_MAX_TOKENS out at $10/M. */
export const SIM_CALL_MICROS = 14_000 * PRICES[SIM_MODEL].input + SIM_MAX_TOKENS * PRICES[SIM_MODEL].output;
const DAY_MS = 86_400_000;
const ANY_KEY = /sk-ant-/i;

/**
 * The route. `counter`: the relay's store (the Sim runs only when it is the private one); `client()`: the relay's own
 * Anthropic client; `origins`: the web app's own origins. Called with the relay's helpers ({answer, problem, stream}).
 */
export function simRoute({ anthropicKey, counter, client, origins, jobSchema, dailyUsd, perIpUsd, now = Date.now }) {
  const tools = simTools(jobSchema);
  const daily = Math.round((Number(dailyUsd) > 0 ? Number(dailyUsd) : SIM_DAILY_USD) * 1e6);
  const perIp = Math.round((Number(perIpUsd) > 0 && Number(perIpUsd) < SIM_PER_IP_CEILING_USD ? Number(perIpUsd) : SIM_PER_IP_USD) * 1e6);
  const perNetwork = Math.max(perIp, SIM_PER_NETWORK_USD * 1e6);
  const general = Math.floor(daily * (1 - READS_RESERVE_SHARE));
  const price = PRICES[SIM_MODEL];
  const day = () => Math.floor(now() / DAY_MS);
  return async function sim(request, ip, { answer, problem, stream }) {
    const origin = request.headers.get("origin");
    if (!origin || !origins.includes(origin)) return answer(problem(403, "quotes.origin.refused", "Only the ZeroFee Sim can use the Sim's AgentZero."));
    if (request.method !== "POST") return answer(problem(404, "quotes.route.unknown", "There's nothing here."));
    if (!anthropicKey || counter?.private !== true) return answer(problem(503, SIM_OFF, SIM_RESTED_WORDS));
    // a Claude key never comes through ZeroFee, in any header or in the address
    if (ANY_KEY.test(request.url)) return answer(problem(400, "agentzero.key.refused", "ZeroFee's server never takes a Claude key."));
    for (const [name, value] of request.headers) if (name === "x-api-key" || name === "x-claude-key" || ANY_KEY.test(value)) return answer(problem(400, "agentzero.key.refused", "ZeroFee's server never takes a Claude key."));
    const caller = addressBucket(ip);
    if ((await counter.hit(`sim:minute:${caller}`, 60_000)) > SIM_PER_MINUTE) return answer(problem(429, "quotes.rate.limited", "Too many asks just now. Try again in a minute."));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return answer(problem(415, "quotes.request.refused", "Send a JSON body."));
    if (Number(request.headers.get("content-length") ?? 0) > SIM_BODY_MAX) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    const text = await readCapped(request, SIM_BODY_MAX).catch(() => null);
    if (text === null) return answer(problem(413, "quotes.request.too-large", "That request is too large."));
    if (ANY_KEY.test(text)) return answer(problem(400, "agentzero.key.refused", "ZeroFee's server never takes a Claude key."));
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    // only the conversation and the day are read; a model, effort, max_tokens, system or tools in the body are ignored
    const given = body && typeof body === "object" && !Array.isArray(body) && Array.isArray(body.messages) && body.messages.length <= 400 ? body.messages : null;
    const cut = given ? simHistory(given) : null;
    const messages = cut ? cleanMessages(cut) : null;
    if (!messages) return answer(problem(400, "quotes.request.refused", "That conversation couldn't be read."));
    // the caller's dollars today, then the relay's; the call's most is reserved on both before Anthropic is asked
    const d = day();
    const mine = `sim:usd:${caller}:${d}`;
    if ((await counter.add(mine, SIM_CALL_MICROS, DAY_MS)) > perIp) {
      await counter.add(mine, -SIM_CALL_MICROS, DAY_MS);
      return answer(problem(429, SIM_VISITOR, SIM_VISITOR_WORDS));
    }
    const net = `sim:usd-net:${networkBucket(ip)}:${d}`;
    const netNow = await counter.add(net, SIM_CALL_MICROS, DAY_MS);
    if (netNow > perNetwork) {
      await Promise.all([counter.add(net, -SIM_CALL_MICROS, DAY_MS), counter.add(mine, -SIM_CALL_MICROS, DAY_MS)]);
      return answer(problem(429, SIM_VISITOR, SIM_VISITOR_WORDS));
    }
    // the relay's day: its general part for anyone, then its reserve only for a light network (audit #8)
    const light = netNow - SIM_CALL_MICROS <= perIp;
    let spent = `sim:usd:${d}`;
    if ((await counter.add(spent, SIM_CALL_MICROS, DAY_MS)) > general) {
      await counter.add(spent, -SIM_CALL_MICROS, DAY_MS);
      spent = `sim:usd:${d}:reserve`;
      const inReserve = light && (await counter.add(spent, SIM_CALL_MICROS, DAY_MS)) <= daily - general;
      if (!inReserve) {
        await Promise.all([light ? counter.add(spent, -SIM_CALL_MICROS, DAY_MS) : null, counter.add(net, -SIM_CALL_MICROS, DAY_MS), counter.add(mine, -SIM_CALL_MICROS, DAY_MS)]);
        return answer(problem(429, SIM_RESTED, SIM_RESTED_WORDS));
      }
    }
    let settled = false;
    // Anthropic's own usage replaces the reservation, once; an error before any answer gives the reply back
    const settle = async (usage) => {
      if (settled) return { used: 0, extra: {} };
      settled = true;
      if (usage === 0) await Promise.all([counter.add(spent, -SIM_CALL_MICROS, DAY_MS), counter.add(mine, -SIM_CALL_MICROS, DAY_MS), counter.add(net, -SIM_CALL_MICROS, DAY_MS)]);
      else if (usage) {
        const back = costMicros(usage, price) - SIM_CALL_MICROS;
        await Promise.all([counter.add(spent, back, DAY_MS), counter.add(mine, back, DAY_MS), counter.add(net, back, DAY_MS)]);
      }
      return { used: 0, extra: {} };
    };
    return streamTurn({ request, stream, client, upstream: simRequest(messages, tools, dayLine(typeof body.today === "string" ? body.today : undefined, now())), settle, paid: false, price, model: SIM_MODEL, closing: () => ({ sim: true }) });
  };
}
