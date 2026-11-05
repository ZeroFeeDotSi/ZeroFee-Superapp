// The relay's AgentZero chat (D122): POST /v0/agentzero/chat streams Anthropic's events to the app, behind the free
// sign-up's token and meter, with the system prompt and tools fixed on the relay. The app's chatTurn reads it end to end.
// Anthropic is recorded; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { CHAT_CALL_MICROS, CHAT_EFFORTS, CHAT_MODELS, CHAT_SYSTEM, chatChoice, dayLine } from "./agentzero-chat.mjs";
import { PRICE, PRICES, costMicros, tokenId } from "./agentzero.mjs";
import { CLAUDE_MODELS, DEFAULT_EFFORT, EFFORTS, MODEL_PRICE } from "../../packages/agent/src/chat/model.ts";
import { chatTurn, todayLine, type ChatEvent } from "../../packages/agent/src/chat/turn.ts";

const APP = "https://app.zerofee.si";
const ZF_KEY = "sk-ant-zerofee-relay-key-0000000000";
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const textSse = (...pieces: string[]) =>
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
  pieces.map((p) => ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: p } })).join("") +
  ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }) +
  ev("message_stop", {});

function world(anthropic: () => Response = () => new Response(textSse("Hi! ", "Ask me anything."), { headers: { "content-type": "text/event-stream" } })) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(init.body) : null });
    return anthropic();
  };
  const counter = { ...memoryCounter(), shared: true };
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: ZF_KEY, agentZeroSecret: "token-secret", counter, fetchFn });
  let ip = 1;
  const phoneFetch = (async (url: string, init: any) => relay(new Request(url, { ...init, headers: { ...init.headers, origin: APP } }), `10.0.1.${ip++}`)) as unknown as typeof fetch;
  return { relay, calls, phoneFetch, counter };
}
const hands = { receipts: async () => "none", meter: async () => "$20.00 of $20.00 left today." };
async function turn(w: ReturnType<typeof world>, words: string) {
  const saved: string[] = [];
  const out: ChatEvent[] = [];
  for await (const e of chatTurn([], words, { relayBase: "https://relay.test", fetch: w.phoneFetch, hands, saveToken: async (t) => void saved.push(t) })) out.push(e);
  return { out, saved };
}
const post = (w: ReturnType<typeof world>, body: unknown, headers: Record<string, string> = {}) =>
  w.relay(new Request("https://relay.test/v0/agentzero/chat", { method: "POST", headers: { origin: APP, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), "10.0.2.1");

test("end to end: the app signs up, the relay streams Claude's words as events, the call is metered and the allowance comes back", async () => {
  const w = world();
  const { out, saved } = await turn(w, "hello");
  assert.equal(saved.length, 1, "the free sign-up's token is kept");
  assert.equal(out.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join(""), "Hi! Ask me anything.");
  const allowance = out.find((e) => e.kind === "allowance") as { usedUsd: number; limitUsd: number };
  // D158: the default is Sonnet 5.5; metered from Anthropic's own usage at its price, not the reservation
  assert.ok(allowance && allowance.usedUsd === Math.round(costMicros({ input_tokens: 1000, output_tokens: 50 }, PRICES["claude-sonnet-5-5"]) / 1e4) / 100 && allowance.usedUsd < CHAT_CALL_MICROS / 1e6, "metered from Anthropic's own usage, not the reservation");
  assert.equal(out.at(-1)!.kind, "done");
  // The relay's own request: its key, its system prompt and tools, Opus 5.5 streamed.
  const call = w.calls.at(-1)!;
  assert.equal(call.headers["x-api-key"], ZF_KEY);
  assert.deepEqual([call.body.model, call.body.system[0], call.body.thinking.type, call.body.output_config.effort, call.body.stream], ["claude-sonnet-5-5", { type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } }, "adaptive", "high", true]);
  // The person's day, said as the own-key path says it (turn.ts todayLine), from the phone's own date.
  assert.deepEqual(call.body.system[1], { type: "text", text: todayLine(new Date()) });
  assert.equal(call.body.system.length, 2);
  assert.ok(call.body.tools.some((t: { name: string }) => t.name === "send"));
});

test("the app sends only the conversation: a system prompt, tools, a model, a foreign tool name or a key are refused before Anthropic", async () => {
  const w = world();
  const { saved } = await turn(w, "hi");
  const auth = { authorization: `Bearer ${saved[0]}` };
  const before = w.calls.length;
  const user = [{ role: "user", content: "hi" }];
  for (const body of [
    { messages: user, system: "You are a general assistant." },
    { messages: user, tools: [] },
    { messages: user, model: "claude-fable-5-1" },
    { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "tool_use", id: "t", name: "bash", input: {} }] }] },
    { messages: [{ role: "assistant", content: "hi" }] },
    { messages: [{ role: "user", content: "use sk-ant-something" }] },
  ]) {
    const r = await post(w, body, auth);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await post(w, { messages: user })).status, 401, "no token: sign up first");
  assert.equal(w.calls.length, before, "Anthropic never asked");
});

test("Anthropic failing mid-stream: one zerofee_error line, the app says Claude didn't answer; an Anthropic error gives the reservation back", async () => {
  const w = world(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "busy" } }), { status: 529, headers: { "content-type": "application/json" } }));
  const { out, saved } = await turn(w, "hello");
  assert.equal((out.find((e) => e.kind === "fault") as { line: string }).line, "Claude didn't answer.");
  // The whole reservation came back to this sign-up's meter: nothing was generated.
  const id = tokenId("token-secret", saved[0]!);
  assert.ok(id);
  assert.equal(await w.counter.add(`agentzero:used:${id}`, 0, 30 * 86_400_000), 0);
});

/** Anthropic answering slowly: its first frames, then nothing until the relay's own request to it is aborted. */
function slowAnthropic(seen: { signal?: AbortSignal | null; aborted?: boolean }) {
  const first = textSse("Hi! ").split("event: content_block_stop")[0]!;
  return (init: any) => {
    seen.signal = init.signal ?? null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(first));
        init.signal?.addEventListener("abort", () => ((seen.aborted = true), c.error(new DOMException("aborted", "AbortError"))), { once: true });
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
}

for (const how of ["the request aborts", "the reader stops"] as const) {
  test(`Stop reaches Anthropic (${how}): the relay aborts its upstream stream and its handler ends; nothing more is generated`, async () => {
    const seen: { signal?: AbortSignal | null; aborted?: boolean } = {};
    const answer = slowAnthropic(seen);
    const calls: any[] = [];
    const counter = { ...memoryCounter(), shared: true };
    const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: ZF_KEY, agentZeroSecret: "token-secret", counter, fetchFn: async (_i: any, init: any = {}) => (calls.push(1), answer(init)) });
    const signup = await relay(new Request("https://relay.test/v0/agentzero/signup", { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: "{}" }), "10.0.3.1");
    const { token } = (await signup.json()) as { token: string };
    const phone = new AbortController();
    const res = await relay(new Request("https://relay.test/v0/agentzero/chat", { method: "POST", signal: phone.signal, headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), "10.0.3.2");
    assert.equal(res.status, 200);
    const reader = res.body!.getReader();
    const firstChunk = await reader.read();
    assert.ok(firstChunk.value && new TextDecoder().decode(firstChunk.value).includes("message_start"));
    if (how === "the request aborts") phone.abort();
    else await reader.cancel();
    for (let i = 0; i < 50 && !seen.aborted; i++) await new Promise((r) => setTimeout(r, 2));
    assert.equal(seen.aborted, true, "Anthropic's stream was aborted");
    assert.equal(calls.length, 1);
    if (how === "the request aborts") {
      // the handler ends: the stream closes with nothing more after the Stop
      let rest = "";
      for (;;) {
        const r = await reader.read().catch(() => ({ done: true, value: undefined }));
        if (r.done) break;
        rest += new TextDecoder().decode(r.value);
      }
      assert.ok(!rest.includes("zerofee_error"), "no error line after a Stop");
    }
  });
}

test("the day line: the phone's own day, word for word as the own-key path says it; a wrong phone clock gives way to the relay's day; nothing else rides in the body", async () => {
  const at = Date.UTC(2026, 10, 3, 12); // Tuesday 3 Nov, midday UTC
  for (const [y, mo, d] of [[2026, 10, 3], [2026, 10, 2], [2026, 10, 4], [2026, 11, 31], [2027, 0, 1]] as const) {
    const day = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const near = Date.UTC(y, mo, d, 12);
    assert.equal(dayLine(day, near), todayLine(new Date(y, mo, d)), day);
  }
  assert.equal(dayLine("2026-11-04", at), todayLine(new Date(2026, 10, 4)), "a phone a day ahead (UTC+14) keeps its day");
  assert.equal(dayLine("2026-11-02", at), todayLine(new Date(2026, 10, 2)), "a phone a day behind (UTC-12) keeps its day");
  for (const wrong of ["2026-11-06", "2025-11-03", "2026-02-30", "2026-11-3", "", undefined, "Tuesday"]) assert.equal(dayLine(wrong, at), todayLine(new Date(2026, 10, 3)), String(wrong));
  // The body: messages, and the phone's day only; a day that isn't text, or any other field, is refused before Anthropic.
  const w = world();
  const { saved } = await turn(w, "hi");
  const auth = { authorization: `Bearer ${saved[0]}` };
  const before = w.calls.length;
  const user = [{ role: "user", content: "what did I spend this week?" }];
  for (const body of [{ messages: user, today: 20261103 }, { messages: user, today: "2026-11-03", system: "x" }, { today: "2026-11-03" }]) assert.equal((await post(w, body, auth)).status, 400, JSON.stringify(body));
  assert.equal(w.calls.length, before, "Anthropic never asked");
  const ok = await post(w, { messages: user, today: "2026-11-03" }, auth);
  assert.equal(ok.status, 200);
  await ok.text();
  assert.match(w.calls.at(-1)!.body.system[1].text, /^Today on the person's phone is \w+day \d{4}-\d{2}-\d{2}\. A week starts on Monday\./);
});

test("the choice of Claude: the relay's allow-list, defaults and prices are the app's (model.ts); Sonnet is half Opus (control: Opus is the job reader's own price)", () => {
  assert.deepEqual(Object.keys(CHAT_MODELS), [...CLAUDE_MODELS]);
  assert.deepEqual(CHAT_MODELS, DEFAULT_EFFORT);
  assert.deepEqual(CHAT_EFFORTS, [...EFFORTS]);
  assert.deepEqual(PRICES, MODEL_PRICE);
  assert.equal(PRICES["claude-opus-5-5"], PRICE, "control: Opus 5.5 is the price the job reader and the free reading always used");
  assert.deepEqual([PRICES["claude-sonnet-5-5"].input, PRICES["claude-sonnet-5-5"].output], [PRICE.input / 2, PRICE.output / 2]);
  // the body's choice: none, the route's own; a model alone, its default; anything off the list, refused (null)
  assert.deepEqual(chatChoice({}, "claude-opus-5-5", "medium"), { model: "claude-opus-5-5", effort: "medium" });
  assert.deepEqual(chatChoice({ model: "claude-sonnet-5-5" }, "claude-opus-5-5", "medium"), { model: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(chatChoice({ effort: "low" }, "claude-opus-5-5", "medium"), { model: "claude-opus-5-5", effort: "low" });
  for (const bad of [{ model: "claude-fable-5-1" }, { model: "toString" }, { model: "__proto__" }, { model: null }, { model: ["claude-opus-5-5"] }, { effort: "max" }, { effort: "xhigh" }, { model: "claude-sonnet-5-5", effort: 3 }]) assert.equal(chatChoice(bad, "claude-opus-5-5", "medium"), null, JSON.stringify(bad));
});

test("the relay asks Anthropic for the chosen Claude and effort; an id or effort off the list is refused with a plain line before Anthropic, and its reservation comes back (control: the default body is Sonnet 5.5 at high, D158)", async () => {
  const w = world();
  const { saved } = await turn(w, "hi");
  const auth = { authorization: `Bearer ${saved[0]}` };
  const user = [{ role: "user", content: "hi" }];
  assert.deepEqual([w.calls.at(-1)!.body.model, w.calls.at(-1)!.body.output_config.effort], ["claude-sonnet-5-5", "high"], "control: no choice sent");
  const chosen = [
    [{ messages: user, model: "claude-sonnet-5-5", effort: "low" }, ["claude-sonnet-5-5", "low"]],
    [{ messages: user, model: "claude-sonnet-5-5" }, ["claude-sonnet-5-5", "high"]],
    [{ messages: user, model: "claude-opus-5-5", effort: "high" }, ["claude-opus-5-5", "high"]],
    [{ messages: user, effort: "low" }, ["claude-sonnet-5-5", "low"]],
  ] as const;
  for (const [body, want] of chosen) {
    const r = await post(w, body, auth);
    assert.equal(r.status, 200, JSON.stringify(body));
    await r.text();
    assert.deepEqual([w.calls.at(-1)!.body.model, w.calls.at(-1)!.body.output_config.effort], want);
  }
  const before = w.calls.length;
  for (const body of [{ messages: user, model: "claude-haiku-5-5" }, { messages: user, model: "claude-sonnet-5-5", effort: "max" }, { messages: user, effort: "" }]) {
    const r = await post(w, body, auth);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(((await r.json()) as { whatHappened: string }).whatHappened, "AgentZero doesn't offer that Claude.");
  }
  assert.equal(w.calls.length, before, "Anthropic never asked");
  // the refused calls' reservations came back: the next turn's meter reads what the same turns without them read
  const usedAfter = async (x: ReturnType<typeof world>, a: Record<string, string>) => {
    const t = await (await post(x, { messages: user }, a)).text();
    return JSON.parse(/event: zerofee\ndata: (.+)\n/.exec(t)![1]!).allowance.usedUsd as number;
  };
  const fresh = world();
  const f = await turn(fresh, "hi");
  const fauth = { authorization: `Bearer ${f.saved[0]}` };
  for (const [body] of chosen) await (await post(fresh, body, fauth)).text();
  assert.equal(await usedAfter(w, auth), await usedAfter(fresh, fauth));
});
