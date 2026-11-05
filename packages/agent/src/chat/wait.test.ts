// AgentZero never hangs (wait.ts): every wait of its own ends within its limit on a plain line naming what didn't answer,
// and the turn ends ("done"), so the composer is free again. Each limit has a control: the same wait answering in time
// goes through as before. Limits are shrunk here (LIMITS is the one place they live); the real values are pinned first.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, Stopped, TimedOut, isTimedOut, paced, timedOutLine, within, withinOr } from "./wait.ts";
import { chatStore } from "./chats.ts";
import { memoryStore } from "../zero/memory.ts";
import { RETRY_MS, chatTurn, toolLimit, toolService, type ChatEvent, type ChatHands, type ChatOptions } from "./turn.ts";

const OWN = "sk-ant-own-test-key-3333333333333333";
const REAL = { ...LIMITS };
const FAST = { core: 120, read: 120, firstByte: 150, gap: 150 };
beforeEach(() => Object.assign(LIMITS, FAST));
afterEach(() => Object.assign(LIMITS, REAL));

const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
const start = () => ev("message_start", { message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
const end = (stop: string) => ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } }) + ev("message_stop", {});
const textSse = (t: string) => start() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } }) + ev("content_block_stop", { index: 0 }) + end("end_turn");
const toolSse = (name: string, input: object = {}) => start() + ev("content_block_start", { index: 0, content_block: { type: "tool_use", id: "tu_1", name, input: {} } }) + ev("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }) + ev("content_block_stop", { index: 0 }) + end("tool_use");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const enc = new TextEncoder();

/** A body that sends `head`, then (after `stallMs`, or never) the rest; it ends when the request is aborted. */
function stalled(head: string, rest: string | null, stallMs: number, signal?: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(c) {
      signal?.addEventListener("abort", () => { try { c.error(new DOMException("aborted", "AbortError")); } catch { /* closed */ } });
      if (head) c.enqueue(enc.encode(head));
      if (rest === null) return;
      await sleep(stallMs);
      if (signal?.aborted) return;
      c.enqueue(enc.encode(rest));
      c.close();
    },
  });
}
/** Anthropic as a fetch: each answer is an SSE body, a status, a hang (never answers until aborted), or a stall. */
type Answer = string | { status: number; body?: object } | "hang" | { head: string; rest: string | null; stallMs: number } | { delayMs: number; sse: string };
function anthropic(answers: Answer[]) {
  let calls = 0;
  const f = (async (_u: unknown, init: RequestInit = {}) => {
    calls++;
    const a = answers.shift() ?? textSse("");
    const signal = init.signal ?? undefined;
    if (a === "hang") return new Promise((_, no) => signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError"))));
    if (typeof a === "string") return new Response(a, { headers: { "content-type": "text/event-stream" } });
    if ("delayMs" in a) {
      await new Promise((r, no) => { const t = setTimeout(r, a.delayMs); signal?.addEventListener("abort", () => (clearTimeout(t), no(new DOMException("aborted", "AbortError")))); });
      return new Response(a.sse, { headers: { "content-type": "text/event-stream" } });
    }
    if ("head" in a) return new Response(stalled(a.head, a.rest, a.stallMs, signal), { headers: { "content-type": "text/event-stream" } });
    return new Response(JSON.stringify(a.body ?? { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls: () => calls };
}
const hands = (over: Partial<ChatHands> = {}): ChatHands => ({ receipts: async () => "none", meter: async () => "$1.00 of $1.00 left today.", ...over });
async function run(words: string, o: Partial<ChatOptions>) {
  const out: ChatEvent[] = [];
  const t0 = Date.now();
  for await (const e of chatTurn([], words, { relayBase: null, hands: hands(), ...o })) out.push(e);
  return { out, ms: Date.now() - t0, faults: out.filter((e) => e.kind === "fault").map((e) => (e as { line: string }).line), text: out.filter((e) => e.kind === "text").map((e) => (e as { delta: string }).delta).join("") };
}
/** The suite's own claim check (tools/agentzero-suite/run.mjs CLAIM): money said to have gone. */
const CLAIM = /\bI(?:'ve| have)? (?:just |now )?(?:sent|paid|moved|transferred|swapped|bought|sold)\b|\b(?:payment|transfer|money|it) (?:was |has been )(?:sent|paid)\b|\b(?:sent|paid) successfully\b/i;

test("the real limits: core and market reads 8 s, Claude's first event 30 s, a gap mid-stream 45 s", () => {
  assert.deepEqual(REAL, { core: 8_000, read: 8_000, firstByte: 30_000, gap: 45_000 });
});

test("within: a late answer is a TimedOut naming the service; an answer in time goes through (control); Stop ends the wait at once", async () => {
  const late = await within(sleep(300).then(() => 1), 50, "NEAR").catch((e) => e);
  assert.ok(isTimedOut(late) && late.service === "NEAR");
  assert.equal(timedOutLine("NEAR"), "NEAR didn't answer in time. Nothing moved. Try again.");
  assert.equal(await within(sleep(10).then(() => 2), 200, "NEAR"), 2, "control: in time");
  const ac = new AbortController();
  const t0 = Date.now();
  const p = within(new Promise(() => undefined), 5_000, "NEAR", ac.signal).catch((e) => e);
  ac.abort();
  assert.ok((await p) instanceof Stopped);
  assert.ok(Date.now() - t0 < 100);
  assert.equal(await withinOr(new Promise(() => undefined), 30, "x", "fallback"), "fallback");
  assert.equal(await withinOr(Promise.reject(new Error("boom")), 30, "x", "fallback"), "fallback");
});

test("paced: a stream that goes silent mid-way throws TimedOut and aborts its request; a steady one runs to the end (control)", async () => {
  let cut = 0;
  async function* src(stallAt: number) { for (let i = 0; i < 4; i++) { if (i === stallAt) await new Promise(() => undefined); else await sleep(10); yield i; } }
  const got: number[] = [];
  const e = await (async () => { for await (const x of paced(src(2), { first: 100, gap: 60, service: "Claude", onLate: () => cut++ })) got.push(x); })().catch((x) => x);
  assert.ok(e instanceof TimedOut);
  assert.deepEqual(got, [0, 1]);
  assert.equal(cut, 1);
  const all: number[] = [];
  for await (const x of paced(src(-1), { first: 100, gap: 60, service: "Claude" })) all.push(x);
  assert.deepEqual(all, [0, 1, 2, 3], "control");
});

test("own key: Claude never answering ends on 'Claude didn't answer in time' within its limit; answering in time is a reply (control)", async () => {
  const r = await run("hi", { ownKey: OWN, anthropicFetch: anthropic(["hang"]).f });
  assert.deepEqual(r.faults, [timedOutLine("Claude")]);
  assert.equal(r.out.at(-1)!.kind, "done");
  assert.ok(r.ms < FAST.firstByte + 1_000, `${r.ms} ms`);
  const c = await run("hi", { ownKey: OWN, anthropicFetch: anthropic([{ delayMs: 40, sse: textSse("Hello.") }]).f });
  assert.equal(c.text, "Hello.");
  assert.deepEqual(c.faults, []);
});

test("own key: the network dropping mid-stream (silence after the first words) ends on the gap limit; a short pause is fine (control)", async () => {
  const head = start() + ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) + ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Half " } });
  const rest = ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "done." } }) + ev("content_block_stop", { index: 0 }) + end("end_turn");
  const r = await run("hi", { ownKey: OWN, anthropicFetch: anthropic([{ head, rest: null, stallMs: 0 }]).f });
  assert.deepEqual(r.faults, [timedOutLine("Claude")]);
  assert.equal(r.out.at(-1)!.kind, "done");
  assert.ok(r.ms < FAST.firstByte + FAST.gap + 1_000, `${r.ms} ms`);
  assert.doesNotMatch(r.faults.join(" "), CLAIM);
  const c = await run("hi", { ownKey: OWN, anthropicFetch: anthropic([{ head, rest, stallMs: 40 }]).f });
  assert.equal(c.text, "Half done.");
  assert.deepEqual(c.faults, []);
});

test("own key: Anthropic 529 overloaded is asked once more (main's one retry), then said by name, never a wait; overloaded once then an answer is a reply (control)", async () => {
  const r = await run("hi", { ownKey: OWN, anthropicFetch: anthropic([{ status: 529 }, { status: 529 }]).f });
  assert.equal(r.faults.length, 1);
  assert.match(r.faults[0]!, /Claude is down right now|Claude didn't answer/);
  assert.equal(r.out.at(-1)!.kind, "done");
  assert.ok(r.ms < RETRY_MS + 1_000, `${r.ms} ms`);
  const c = await run("hi", { ownKey: OWN, anthropicFetch: anthropic([{ status: 529 }, textSse("Hello.")]).f });
  assert.equal(c.text, "Hello.");
  assert.deepEqual(c.faults, []);
});

test("relay: no answer at all ends on 'Claude didn't answer in time'; a 404 or 5xx is the key card at once, never a wait", async () => {
  const hang = (async (u: string, init: RequestInit) => (String(u).endsWith("/signup") ? new Response(JSON.stringify({ token: "az1.t" })) : new Promise((_, no) => init.signal?.addEventListener("abort", () => no(new DOMException("aborted", "AbortError")))))) as never;
  const r = await run("hi", { relayBase: "https://relay.test", token: "az1.t", fetch: hang });
  assert.deepEqual(r.faults, [timedOutLine("Claude")]);
  assert.ok(r.ms < FAST.firstByte + 1_000);
  for (const status of [404, 500, 503]) {
    const f = (async () => new Response("{}", { status })) as never;
    const x = await run("hi", { relayBase: "https://relay.test", token: "az1.t", fetch: f });
    // product decision, 4 Nov: in words at once (a release build has no key card), then the card's event for a developer build
    assert.deepEqual(x.out.map((e) => e.kind), ["fault", "needs-key", "done"], `status ${status}`);
  }
  // the relay's sign-up never answering: the key card, within the read limit
  const signup = (async (_u: string, init: RequestInit) => new Promise((_, no) => init.signal?.addEventListener("abort", () => no(new Error("aborted"))))) as never;
  const s = await run("hi", { relayBase: "https://relay.test", fetch: signup });
  // crawl S2: it says so under the words (a release build has no key card), then the card's event as before
  assert.deepEqual(s.out.map((e) => e.kind), ["say", "needs-key", "done"]);
  // a sign-up the relay refused (the per-address cap): its own line, never a blank chat
  const capped = (async () => new Response(JSON.stringify({ code: "quotes.rate.limited", whatHappened: "Too many sign-ups from here today." }), { status: 429 })) as never;
  const c429 = await run("hi", { relayBase: "https://relay.test", fetch: capped });
  assert.deepEqual(c429.out.map((e) => e.kind), ["say", "needs-key", "done"]);
  assert.equal((c429.out[0] as { line?: string }).line, "Too many sign-ups from here today.");
  assert.ok(s.ms < FAST.read + 1_000 + 1_000);
});

test("a read tool that hangs, answers after the limit, throws or answers garbage: a plain line within its limit, the turn over, nothing claimed; in time it's read (control)", async () => {
  const modes: Record<string, () => Promise<string>> = {
    hang: () => new Promise(() => undefined),
    slow: () => sleep(20_000).then(() => "late"),
    throws: () => Promise.reject(new Error("boom")),
    garbage: async () => ({ not: "a line" }) as never,
  };
  for (const [mode, meter] of Object.entries(modes)) {
    const a = anthropic([toolSse("read_meter"), textSse("You have $1.00 left.")]);
    const r = await run("how much is left?", { ownKey: OWN, anthropicFetch: a.f, hands: hands({ meter }) });
    assert.equal(r.out.at(-1)!.kind, "done", mode);
    assert.ok(r.ms < FAST.core + 1_000, `${mode}: ${r.ms} ms`);
    const step = r.out.filter((e) => e.kind === "step").at(-1) as { state: string } | undefined;
    if (mode === "hang" || mode === "slow") {
      assert.deepEqual(r.faults, [timedOutLine(toolService("read_meter"))], mode);
      assert.equal(step?.state, "refused");
      assert.equal(a.calls(), 1, "no second Claude call after a read timed out");
    }
    if (mode === "throws") assert.equal(step?.state, "refused");
    assert.doesNotMatch(r.faults.join(" "), CLAIM, mode);
  }
  const ok = await run("how much is left?", { ownKey: OWN, anthropicFetch: anthropic([toolSse("read_meter"), textSse("You have $1.00 left.")]).f, hands: hands({ meter: async () => (await sleep(20), "$1.00 of $1.00 left today.") }) });
  assert.equal(ok.text, "You have $1.00 left.");
  assert.deepEqual(ok.faults, []);
});

test("every market read has its limit; Trade's coin search that never answers still fills the sheet in, within the read limit", async () => {
  for (const [tool, input, skill] of [["market_price", { coins: ["SOL"] }, "prices"], ["market_trending", { chain: "solana" }, "trending"], ["quote_dry", { usd: 5, pay: "USDC", get: "SOL" }, "quote"], ["service_status", {}, "services"], ["covered_coins", {}, "coins"], ["read_holdings", {}, "holdings"]] as const) {
    const r = await run("check", { ownKey: OWN, anthropicFetch: anthropic([toolSse(tool, input), textSse("x")]).f, hands: hands({ skills: { [skill]: () => new Promise(() => undefined) } as never }) });
    assert.equal(r.out.at(-1)!.kind, "done", tool);
    assert.ok(r.ms < toolLimit(tool) + 1_000, `${tool}: ${r.ms} ms`);
    assert.deepEqual(r.faults, [timedOutLine(toolService(tool))], tool);
  }
  const t = await run("buy $5 of BONK on Solana", { ownKey: OWN, anthropicFetch: anthropic([toolSse("trade", { side: "buy", symbol: "BONK", chain: "sol", usd: 5 })]).f, hands: hands({ skills: { find: () => new Promise(() => undefined) } as never }) });
  assert.equal(t.out.at(-1)!.kind, "done");
  assert.ok(t.ms < LIMITS.read + 1_000, `${t.ms} ms`);
});

test("Stop during a hang ends the turn at once with no events after it (no limit to wait out)", async () => {
  const ac = new AbortController();
  const out: ChatEvent[] = [];
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 30);
  for await (const e of chatTurn([], "hi", { relayBase: null, hands: hands(), ownKey: OWN, anthropicFetch: anthropic(["hang"]).f, signal: ac.signal })) out.push(e);
  assert.deepEqual(out, []);
  assert.ok(Date.now() - t0 < FAST.firstByte, "ended by Stop, not by the limit");
  // a read tool hanging: Stop ends it too
  const ac2 = new AbortController();
  const out2: ChatEvent[] = [];
  setTimeout(() => ac2.abort(), 60);
  const t1 = Date.now();
  for await (const e of chatTurn([], "hi", { relayBase: null, hands: hands({ meter: () => new Promise(() => undefined) }), ownKey: OWN, anthropicFetch: anthropic([toolSse("read_meter")]).f, signal: ac2.signal })) out2.push(e);
  assert.ok(Date.now() - t1 < FAST.core, "Stop, not the limit");
  assert.ok(!out2.some((e) => e.kind === "fault" || e.kind === "done"));
});

test("a timeout leaves the history valid for the next turn (every tool call has its result)", async () => {
  const r = await run("how much?", { ownKey: OWN, anthropicFetch: anthropic([toolSse("read_meter")]).f, hands: hands({ meter: () => new Promise(() => undefined) }) });
  const h = (r.out.at(-1) as { history: { role: string; content: unknown }[] }).history;
  const uses = h.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b: { type?: string }) => b.type === "tool_use").length;
  const results = h.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b: { type?: string }) => b.type === "tool_result").length;
  assert.equal(uses, results);
  assert.equal(h.at(-1)!.role, "assistant");
});

test("the phone's store read for chats and memory: late throws within the core's limit (never read as empty, so never overwritten); in time it reads (control)", async () => {
  const store = (hang: boolean) => ({ call: async (m: string) => (hang && m === "device.store.get" ? new Promise(() => undefined) : m === "device.store.get" ? { ok: { value: null } } : { ok: {} }), on: () => () => undefined }) as never;
  for (const read of [() => chatStore(store(true)).list(), () => memoryStore(store(true)).list()]) {
    const t0 = Date.now();
    const e = await read().catch((x) => x);
    assert.ok(isTimedOut(e), String(e));
    assert.ok(Date.now() - t0 < LIMITS.core + 1_000);
  }
  assert.deepEqual(await chatStore(store(false)).list(), [], "control");
  assert.deepEqual(await memoryStore(store(false)).list(), [], "control");
});

test("before a turn, the saved choice of Claude is read within the core's limit (late = the default); control: the old unbounded read is caught", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./use-chat-turn.ts", import.meta.url), "utf8");
  const bounded = /models\.known\(\) \?\? withinOr\(models\.get\(\), LIMITS\.core, "This phone's store", DEFAULT_CHOICE/;
  assert.match(src, bounded);
  assert.doesNotMatch("models.known() ?? models.get()]);", bounded, "control");
  const late = await withinOr(new Promise(() => undefined), 30, "This phone's store", "default");
  assert.equal(late, "default");
});
