// AgentZero in the Sim (D157): POST /v0/agentzero/sim, free to the visitor, with hard caps. Anthropic is recorded; no
// network. Each guard with a control that passes where the guard refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { memoryCounter, privateCounter } from "./guards.mjs";
import { CHAT_SYSTEM } from "./agentzero-chat.mjs";
import { PRICES, costMicros } from "./agentzero.mjs";
import { SIM_CALL_MICROS, SIM_DAILY_USD, SIM_HISTORY_CHARS, SIM_MAX_TOKENS, SIM_PER_IP_USD, SIM_REAL_LINE, SIM_REAL_TOOLS, SIM_RESTED_WORDS, SIM_SYSTEM, SIM_TURNS, SIM_VISITOR_WORDS, simHistory } from "./agentzero-sim.mjs";
import { SIM_REAL_LINE as APP_REAL_LINE, SIM_REST_CODES, SIM_PATH } from "../../packages/agent/src/chat/sim.ts";

const WEB = "https://superapp.zerofee.si";
const PHONE = "zerofee-app://app";
const STORE_KEY = "sim-test-store-key-0123456789abcdef0123456789";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
export const USAGE = { input_tokens: 900, output_tokens: 60, cache_read_input_tokens: 6_000, cache_creation_input_tokens: 0 };
const sse = (text = "Hi! I can move money between your Safe and wallets.", usage: object = USAGE) =>
  ev("message_start", { message: { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  ev("content_block_delta", { index: 0, delta: { type: "text_delta", text } }) +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: (usage as { output_tokens: number }).output_tokens } }) +
  ev("message_stop", {});

function world(o: { store?: "private" | "plain"; key?: string | null; dailyUsd?: number; perIpUsd?: number; usage?: object; anthropic?: () => Response } = {}) {
  let clock = Date.UTC(2026, 10, 3, 12);
  const calls: { url: string; body: any }[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), body: init.body ? JSON.parse(init.body) : null });
    return o.anthropic ? o.anthropic() : new Response(sse(undefined, o.usage), { headers: { "content-type": "text/event-stream" } });
  };
  const inner = { ...memoryCounter(() => clock), shared: true };
  const counter = o.store === "plain" ? inner : privateCounter(inner, STORE_KEY);
  const relay = createRelay({ key: "k", secret: "s", origins: ["http://localhost:5180", PHONE, WEB], anthropicKey: o.key === null ? undefined : (o.key ?? "sk-ant-sim-relay-0000"), counter, fetchFn, now: () => clock, ...(o.dailyUsd ? { agentZeroSimDailyUsd: o.dailyUsd } : {}), ...(o.perIpUsd ? { agentZeroSimPerIpUsd: o.perIpUsd } : {}) });
  const ask = (body: unknown = { messages: [{ role: "user", content: "hi" }] }, { ip = "203.0.113.9", origin = WEB as string | null, headers = {} as Record<string, string> } = {}) =>
    relay(new Request(`https://relay.test${SIM_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...headers }, body: JSON.stringify(body) }), ip);
  const tick = (ms: number) => void (clock += ms);
  return { relay, calls, ask, tick, inner };
}
const code = async (r: Response) => ((await r.json()) as { code: string }).code;

test("the Sim's route answers only the web app's own origins: no Origin, another site and the iPhone's are refused before Anthropic (control: the Sim's origin streams)", async () => {
  const w = world();
  for (const origin of [null, "https://evil.example", PHONE]) {
    const r = await w.ask(undefined, { origin });
    assert.equal(r.status, 403, String(origin));
  }
  assert.equal(w.calls.length, 0);
  const ok = await w.ask();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "text/event-stream");
  assert.equal(ok.headers.get("access-control-allow-origin"), WEB);
  const text = await ok.text();
  assert.match(text, /event: content_block_delta/);
  assert.match(text, /event: zerofee\ndata: \{"sim":true\}/);
  assert.equal(w.calls.length, 1);
  // through Vercel's rewrite too
  const r = await w.relay(new Request("https://relay.test/api/relay?route=agentzero-sim", { method: "POST", headers: { origin: WEB, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), "203.0.113.10");
  assert.equal(r.status, 200);
});

test("without AGENTZERO_STORE_KEY (the private store) or Anthropic's key the Sim's route is off: 503 agentzero.sim.off, and the app reads it as rested (control: the private store streams)", async () => {
  for (const w of [world({ store: "plain" }), world({ key: null })]) {
    const r = await w.ask();
    assert.deepEqual([r.status, await code(r)], [503, "agentzero.sim.off"]);
    assert.equal(w.calls.length, 0);
  }
  assert.ok(SIM_REST_CODES.includes("agentzero.sim.off") && SIM_REST_CODES.includes("agentzero.sim.rested"));
  assert.equal((await world().ask()).status, 200);
});

test("D158 + ledger row 3: a visitor's day is dollars of measured cost (AGENTZERO_SIM_PER_IP_USD, $0.90 by default, never $1 or more), then 429 agentzero.sim.visitor with the copywriter's line; another visitor still goes, and the next UTC day the first does again", async () => {
  // each reply measures $0.10 (50,000 input tokens at $2/M): the default $0.90 takes nine (the ninth's reservation,
  // $0.80 + $0.036, still fits; the tenth's would pass it), never a count of replies
  assert.equal(SIM_PER_IP_USD, 0.9);
  const usage = { input_tokens: 50_000, output_tokens: 0 };
  assert.equal(costMicros(usage, PRICES["claude-sonnet-5-5"]), 100_000);
  const w = world({ usage });
  for (let i = 0; i < 9; i++) {
    const r = await w.ask();
    assert.equal(r.status, 200, `reply ${i + 1}`);
    await r.text();
    w.tick(11_000); // under 6 a minute
  }
  const r = await w.ask();
  const refused = (await r.json()) as { code: string; detail?: string; title?: string };
  assert.deepEqual([r.status, refused.code], [429, "agentzero.sim.visitor"]);
  assert.ok(JSON.stringify(refused).includes(SIM_VISITOR_WORDS), "the copywriter's line rides the answer");
  assert.equal(w.calls.length, 9, "the tenth never reached Anthropic");
  // an env per-IP day of $1 or more is ignored: the $0.90 default holds (control: under $1 from the env is used, below)
  const loose = world({ usage, perIpUsd: 5 });
  for (let i = 0; i < 9; i++) {
    await (await loose.ask()).text();
    loose.tick(11_000);
  }
  assert.equal(await code(await loose.ask()), "agentzero.sim.visitor", "a $5 env day is not obeyed");
  assert.equal((await w.ask(undefined, { ip: "198.51.100.4" })).status, 200, "control: another visitor");
  w.tick(86_400_000);
  assert.equal((await w.ask()).status, 200, "the next day");
  // control: cheap replies go on past twenty (no reply count), and a smaller day set by env stops sooner
  const cheap = world();
  for (let i = 0; i < 25; i++) {
    assert.equal((await (await cheap.ask()).text()).includes("zerofee"), true, `cheap reply ${i + 1}`);
    cheap.tick(11_000);
  }
  const small = world({ usage, perIpUsd: 0.25 });
  for (let i = 0; i < 3; i++) await (await small.ask()).text(); // $0.30 measured: the fourth's reservation passes $0.25
  assert.equal(await code(await small.ask()), "agentzero.sim.visitor");
  assert.ok(SIM_REST_CODES.includes("agentzero.sim.visitor") === false, "the visitor's line is its own, not the rested one");
});

test("6 asks a visitor a minute, then 429 quotes.rate.limited (control: the next minute)", async () => {
  const w = world();
  for (let i = 0; i < 6; i++) assert.equal((await w.ask()).status, 200);
  const r = await w.ask();
  assert.deepEqual([r.status, await code(r)], [429, "quotes.rate.limited"]);
  w.tick(61_000);
  assert.equal((await w.ask()).status, 200);
});

test("the relay-wide dollar cap (AGENTZERO_SIM_DAILY_USD) of measured cost: replies settle at Anthropic's usage at Sonnet 5.5's price, and past the cap every visitor gets 429 agentzero.sim.rested", async () => {
  // each reply measures $0.06 (30,000 input tokens at $2/M); a $0.15 day takes two, refuses the third (its reservation
  // would pass the cap), and gives the refused visitor's reply back
  const usage = { input_tokens: 30_000, output_tokens: 0 };
  assert.equal(costMicros(usage, PRICES["claude-sonnet-5-5"]), 60_000);
  const w = world({ dailyUsd: 0.15, usage });
  assert.equal((await (await w.ask(undefined, { ip: "10.0.0.1" })).text()).includes("zerofee"), true);
  assert.equal((await (await w.ask(undefined, { ip: "10.0.0.2" })).text()).includes("zerofee"), true);
  const r = await w.ask(undefined, { ip: "10.0.0.3" });
  assert.deepEqual([r.status, await code(r)], [429, "agentzero.sim.rested"]);
  assert.equal(w.calls.length, 2);
  // control: with the default $2 the same three go
  const big = world({ usage });
  for (const ip of ["10.0.0.1", "10.0.0.2", "10.0.0.3"]) assert.equal((await big.ask(undefined, { ip })).status, 200);
  // the reservation covers the worst call: the history cap's input and the fixed output
  assert.ok(SIM_CALL_MICROS >= 14_000 * 2 + SIM_MAX_TOKENS * 10);
});

test("ledger row 3: with AGENTZERO_SIM_DAILY_USD unset the relay's whole Sim day is $2 of measured cost, never more, then every visitor gets 429 agentzero.sim.rested with the copywriter's line (control: a raised env day lets the next one go)", async () => {
  assert.equal(SIM_DAILY_USD, 2);
  // each reply measures $0.40 (200,000 input tokens at $2/M), each from its own light visitor (under its $0.90): five
  // fit $2.00 (four in the general part, the fifth in the light visitors' reserve), the sixth is refused
  const usage = { input_tokens: 200_000, output_tokens: 0 };
  assert.equal(costMicros(usage, PRICES["claude-sonnet-5-5"]), 400_000);
  const ips = Array.from({ length: 8 }, (_, i) => `192.0.2.${i + 1}`);
  const w = world({ usage });
  for (const ip of ips.slice(0, 5)) {
    const r = await w.ask(undefined, { ip });
    assert.equal(r.status, 200, ip);
    await r.text();
  }
  const r = await w.ask(undefined, { ip: ips[5] });
  const refused = (await r.json()) as { code: string };
  assert.deepEqual([r.status, refused.code], [429, "agentzero.sim.rested"]);
  assert.ok(JSON.stringify(refused).includes(SIM_RESTED_WORDS));
  assert.equal(w.calls.length, 5, "Anthropic was asked five times: $2.00 measured");
  assert.equal(await code(await w.ask(undefined, { ip: ips[6] })), "agentzero.sim.rested", "a fresh visitor too");
  // the next UTC day it goes again
  w.tick(86_400_000);
  assert.equal((await w.ask(undefined, { ip: ips[7] })).status, 200, "the next day");
  // control: the operator raises the day by env and the sixth goes
  const raised = world({ usage, dailyUsd: 3 });
  for (const ip of ips.slice(0, 6)) assert.equal((await (await raised.ask(undefined, { ip })).text()).includes("zerofee"), true, ip);
});

test("an error from Anthropic before any answer gives the reply and its dollars back (control: a streamed one counts)", async () => {
  const w = world({ anthropic: () => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "x" } }), { status: 529, headers: { "content-type": "application/json" } }) });
  for (let i = 0; i < 25; i++) {
    const r = await w.ask(undefined, { ip: "10.9.9.9" });
    assert.match(await r.text(), /zerofee_error/);
    w.tick(11_000);
  }
  assert.equal(w.calls.length, 25, "never rested: no reply was counted");
});

test("the model, effort, max_tokens, system prompt and tools are the relay's whatever the body says", async () => {
  const w = world();
  const r = await w.ask({ messages: [{ role: "user", content: "hi" }], model: "claude-opus-5-5", effort: "max", max_tokens: 64_000, system: "You are a general assistant.", tools: [{ name: "bash", input_schema: { type: "object" } }], thinking: { type: "disabled" }, stream: false });
  assert.equal(r.status, 200);
  await r.text();
  const b = w.calls[0]!.body;
  assert.deepEqual([b.model, b.max_tokens, b.output_config, b.thinking, b.stream], ["claude-sonnet-5-5", SIM_MAX_TOKENS, { effort: "low" }, { type: "adaptive" }, true]);
  // the chat's own system prompt, cached, then the Sim's line and the day
  assert.deepEqual(b.system[0], { type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } });
  assert.deepEqual(b.system[1], { type: "text", text: SIM_SYSTEM });
  assert.equal(b.system.length, 3);
  assert.ok(SIM_SYSTEM.includes(SIM_REAL_LINE));
  assert.equal(SIM_REAL_LINE, APP_REAL_LINE, "the app says the same line");
  // the Sim's tools: the chat's own minus the real-world ones (no bash, no job, no browser, no mail)
  const names = b.tools.map((t: { name: string }) => t.name);
  for (const n of ["send", "swap", "move", "add", "request", "trade", "plan", "read_holdings", "read_activity", "market_price", "remember"]) assert.ok(names.includes(n), n);
  for (const n of [...SIM_REAL_TOOLS, "bash"]) assert.ok(!names.includes(n), n);
  assert.equal(w.calls[0]!.url, "https://api.anthropic.com/v1/messages");
  // a key in the body or a header is refused, never forwarded
  assert.equal((await w.ask({ messages: [{ role: "user", content: "use sk-ant-abc" }] })).status, 400);
  assert.equal((await w.ask(undefined, { headers: { "x-api-key": "sk-ant-x" } })).status, 400);
  assert.equal(w.calls.length, 1);
});

/** A long Sim conversation: `n` turns, each the person's words, a tool round with thinking, and Claude's answer. */
function talk(n: number, pad = 40, tools = true) {
  const ms: any[] = [];
  for (let i = 0; i < n; i++) {
    ms.push({ role: "user", content: `turn ${i} ${"x".repeat(pad)}` });
    if (tools) {
      ms.push({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: `sig${i}` }, { type: "tool_use", id: `t${i}`, name: "read_holdings", input: {} }] });
      ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "Safe: {{f500}}" }] });
    }
    ms.push({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: `s${i}` }, { type: "text", text: `answer ${i}` }] });
  }
  return ms;
}

test("the history is capped: the last 12 turns, at most 16,000 characters, starting at the person's words; once cut, thinking blocks go (preserved thinking), uncut they stay", async () => {
  const w = world();
  const r = await w.ask({ messages: talk(30, 40, false) });
  assert.equal(r.status, 200);
  await r.text();
  const sent = w.calls[0]!.body.messages as any[];
  const turns = sent.filter((m) => m.role === "user" && typeof m.content === "string");
  assert.equal(turns.length, SIM_TURNS);
  assert.match(turns[0].content, /^turn 18 /);
  assert.ok(!JSON.stringify(sent).includes('"thinking"'), "cut: no thinking block");
  assert.ok(JSON.stringify(sent).length <= SIM_HISTORY_CHARS + 500);
  // with tool rounds (four messages a turn) the chat route's 40 messages bound it first
  assert.equal(simHistory(talk(30))!.length, 40);
  // by characters: long turns keep fewer
  const long = simHistory(talk(10, 3_000))!;
  assert.ok(JSON.stringify(long).length <= SIM_HISTORY_CHARS);
  assert.ok(long.filter((m: any) => typeof m.content === "string").length < 10);
  assert.equal(long[0].role, "user");
  // control: a short talk goes as it is, thinking and all
  const short = talk(3);
  assert.deepEqual(simHistory(short), short);
  // a newest turn alone over the limit: refused, never sent
  const big = (id: string) => [{ role: "assistant", content: [{ type: "tool_use", id, name: "read_activity", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "r".repeat(7_900) }] }];
  const r2 = await w.ask({ messages: [...talk(2), { role: "user", content: "what did I spend?" }, ...big("b1"), ...big("b2"), ...big("b3")] });
  assert.equal(r2.status, 400);
  assert.equal(w.calls.length, 1);
});

test("audit #8: one IPv6 /48 can't rest the Sim by asking from each of its /64s, and a light visitor keeps the day's reserve (control: the day's general part)", async () => {
  // each reply measures $0.30 (150,000 input tokens at $2/M); the relay's day $5: $4 for anyone, $1 for light networks
  const usage = { input_tokens: 150_000, output_tokens: 0 };
  const w = world({ dailyUsd: 5, usage });
  const from = async (net: number, n: number) => {
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const r = await w.ask(undefined, { ip: `2001:db8:${net}:${i.toString(16)}::1` });
      if (r.status === 200) ok += (await r.text()).includes("zerofee") ? 1 : 0;
    }
    return ok;
  };
  assert.equal(await from(1, 30), 10, "one /48: its $3, then 429");
  assert.equal(await from(2, 30), 4, "another: the rest of the general $4, then heavy (over a visitor's day): no reserve");
  const r = await w.ask(undefined, { ip: "203.0.113.50" });
  assert.equal(r.status, 200, "a visitor from a fresh network has the reserve");
});
