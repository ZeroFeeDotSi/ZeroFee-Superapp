// Prompt caching (review, 3 Nov: no cache_control anywhere; ~88% of a message's cost was input sent again in
// full) and one kept client per key (speed worker, 3 Nov). No network: Anthropic's stream is recorded in shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheMarks as relayMarks, chatRequest as relayRequest, chatTools as relayTools } from "../../../../apps/quotes/agentzero-chat.mjs";
import { JOB_SCHEMA as RELAY_JOB_SCHEMA } from "../../../../apps/quotes/agentzero.mjs";
import { CHAT_SYSTEM } from "./tools.ts";
import { cacheMarks, chatRequest, chatTurn, dropOwnClient, memoryOnce, ownClientFor, todayLine, type ChatEvent, type ChatMessage } from "./turn.ts";
import { memoryContext, type MemoryLine } from "../zero/memory.ts";

const CC = { type: "ephemeral" };
/** Every cache mark in a request, in render order (tools, system, messages): where each one is. */
function marks(req: { tools: unknown[]; system: unknown[]; messages: ChatMessage[] }): string[] {
  const out: string[] = [];
  req.tools.forEach((t, i) => (t as { cache_control?: unknown }).cache_control && out.push(`tools[${i}]`));
  req.system.forEach((s, i) => (s as { cache_control?: unknown }).cache_control && out.push(`system[${i}]`));
  req.messages.forEach((m, i) => Array.isArray(m.content) && m.content.forEach((b, j) => (b as { cache_control?: unknown }).cache_control && out.push(`messages[${i}][${j}]`)));
  return out;
}
/** What sits before the first mark (the tools, then system up to it): it must be the same on every request. */
function beforeFirstMark(req: { tools: unknown[]; system: { text: string; cache_control?: unknown }[] }): string {
  const at = req.system.findIndex((s) => s.cache_control);
  return JSON.stringify(req.tools) + JSON.stringify(req.system.slice(0, at + 1));
}
/** Anything that changes per request or per person: a date, a time, a nonce'd fence, a memory line, an id. */
const VOLATILE = /\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b|<data-[0-9a-f]+>|What the person asked AgentZero to remember|\bmsg_|\btoolu_/;

const HISTORY: ChatMessage[] = [
  { role: "user", content: "What's in my wallets?" },
  { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig" }, { type: "tool_use", id: "t1", name: "read_holdings", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "<data-ab>Your Safe: $25.00</data-ab>" }] },
  { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "sig2" }, { type: "text", text: "Your Safe has {{f500}}." }] },
  { role: "user", content: "Send $5 to kim.near" },
];

test("breakpoint 1 ends the fixed system prompt (after the tools); the day line is after it; nothing volatile before it (control: a day line inside it is caught)", () => {
  const req = chatRequest(HISTORY, new Date(2026, 10, 3, 9, 41)) as unknown as Parameters<typeof marks>[0] & Parameters<typeof beforeFirstMark>[0];
  assert.deepEqual(req.system.map((s) => !!s.cache_control), [true, false]);
  assert.equal(req.system[0]!.text, CHAT_SYSTEM);
  assert.equal(req.system[1]!.text, todayLine(new Date(2026, 10, 3, 9, 41)));
  assert.doesNotMatch(beforeFirstMark(req), VOLATILE);
  // the prefix is byte-identical on another day, another conversation (the tools in a fixed order)
  const other = chatRequest([{ role: "user", content: "hi" }], new Date(2027, 0, 9, 23, 5)) as unknown as typeof req;
  assert.equal(beforeFirstMark(other), beforeFirstMark(req));
  // control: the check fails when the day line is moved before the mark
  const bad = { ...req, system: [{ type: "text", text: `${CHAT_SYSTEM}\n${todayLine(new Date(2026, 10, 3))}`, cache_control: CC }] };
  assert.match(beforeFirstMark(bad), VOLATILE);
  assert.ok(marks(req).length <= 4, "at most four breakpoints");
});

test("breakpoints 2 and 3: the end of the thread (the last assistant message, never a thinking block) and the last message; the kept history is never changed", () => {
  const frozen = JSON.stringify(HISTORY);
  const req = chatRequest(HISTORY) as unknown as Parameters<typeof marks>[0];
  assert.deepEqual(marks(req), ["system[0]", "messages[3][1]", "messages[4][0]"]);
  assert.deepEqual(req.messages[4], { role: "user", content: [{ type: "text", text: "Send $5 to kim.near", cache_control: CC }] });
  assert.equal(JSON.stringify(HISTORY), frozen, "a copy for the request only");
  // a tool loop's next round: the last assistant message is the tool call, the last message its results
  const loop = [...HISTORY, { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "send", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "Shown." }] }] as ChatMessage[];
  assert.deepEqual(marks(chatRequest(loop) as never), ["system[0]", "messages[5][0]", "messages[6][0]"]);
  // the first message of a chat: one mark on it (no thread yet)
  assert.deepEqual(marks(chatRequest([{ role: "user", content: "hi" }]) as never), ["system[0]", "messages[0][0]"]);
  // control: a thread whose last assistant message is only thinking gets no mark there (never on a thinking block)
  const onlyThinking = [{ role: "user", content: "hi" }, { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }] }, { role: "user", content: "and?" }] as ChatMessage[];
  assert.deepEqual(marks(chatRequest(onlyThinking) as never), ["system[0]", "messages[2][0]"]);
});

test("the relay places the same marks, word for word (the free reading caches as the own key does)", () => {
  for (const ms of [HISTORY, [{ role: "user", content: "hi" }] as ChatMessage[]]) assert.deepEqual(relayMarks(ms), cacheMarks(ms));
  const r = relayRequest(HISTORY, "claude-opus-5-5", "medium", relayTools(RELAY_JOB_SCHEMA), "Today is a day.");
  assert.deepEqual(r.system[0], { type: "text", text: CHAT_SYSTEM, cache_control: CC });
  assert.equal(r.system[1].cache_control, undefined);
  assert.deepEqual(r.messages, cacheMarks(HISTORY));
});

test("memory sits in a stable place: the same memory is the same text every turn (control: a fresh fence each call would change it)", () => {
  const mem: MemoryLine[] = [{ kind: "payee", text: "kim.near is my sister", atMs: 1 } as MemoryLine];
  assert.equal(memoryOnce(mem), memoryOnce(mem));
  assert.notEqual(memoryContext(mem), memoryContext(mem), "control: the raw fence is new each call");
  const changed = [...mem, { kind: "rule", text: "never more than $20", atMs: 2 } as MemoryLine];
  assert.notEqual(memoryOnce(changed), memoryOnce(mem));
});

// ── two real turns, recorded: turn 2's request starts with turn 1's, byte for byte, up to the thread's end ─────────
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const textSse = (t: string) =>
  ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) +
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }) + ev("message_stop", {});
/** A message as the API renders it: a string is one text block; a cache mark is no part of the text. */
const strip = (ms: ChatMessage[]): unknown => JSON.parse(JSON.stringify(ms.map((m) => ({ ...m, content: typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content })), (k, v) => (k === "cache_control" ? undefined : v)));

test("append-only: with memory, turn 2's messages begin with all of turn 1's request, so the thread is read from cache (control: with a fresh memory fence it would not)", async () => {
  const bodies: { messages: ChatMessage[] }[] = [];
  const f = (async (_u: unknown, init: { body?: string } = {}) => (bodies.push(JSON.parse(init.body ?? "{}")), new Response(textSse("Hi."), { headers: { "content-type": "text/event-stream" } }))) as typeof fetch;
  const memory = [{ kind: "fact", text: "I like round numbers", atMs: 1 } as MemoryLine];
  const run = async (h: ChatMessage[], w: string) => {
    const out: ChatEvent[] = [];
    for await (const e of chatTurn(h, w, { relayBase: null, ownKey: "sk-ant-own-test-key-4444444444444444", anthropicFetch: f, memory, hands: { receipts: async () => "", meter: async () => "" } })) out.push(e);
    return (out.at(-1) as { history: ChatMessage[] }).history;
  };
  const h1 = await run([], "hello");
  await run(h1, "and now?");
  const [a, b] = [strip(bodies[0]!.messages) as unknown[], strip(bodies[1]!.messages) as unknown[]];
  assert.deepEqual(b.slice(0, a.length), a, "turn 1's request is the start of turn 2's");
  // control: the same with a memory fence made fresh per request would differ at the first message
  assert.notDeepEqual(memoryContext(memory), memoryContext(memory));
});

test("one client per key, in memory only: the same key reuses it; another key or no key drops it (control: a new key is a new client)", async () => {
  const f = (async () => new Response("")) as unknown as typeof fetch;
  const a = await ownClientFor("sk-ant-key-a-55555555555555555", f);
  assert.equal(await ownClientFor("sk-ant-key-a-55555555555555555", f), a);
  const b = await ownClientFor("sk-ant-key-b-55555555555555555", f);
  assert.notEqual(b, a);
  assert.notEqual(await ownClientFor("sk-ant-key-a-55555555555555555", f), a, "the old key's client was dropped, not kept");
  dropOwnClient();
  assert.notEqual(await ownClientFor("sk-ant-key-a-55555555555555555", f), a);
});
