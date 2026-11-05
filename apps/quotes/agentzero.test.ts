// AgentZero's rule box on the relay, end to end (D82): the phone's readJob → the relay (createRelay) →
// Anthropic's SDK, streaming → a recorded Anthropic answer. Free sign-ups, the allowance metered per sign-up, the
// person's own key passed on and never kept, Opus 5.5 at effort medium with adaptive thinking, faults named. The relay
// signs nothing and holds no wallet key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { ALLOWANCE_USD, MAX_CALL_MICROS, RULE_MODEL, TOKEN_DAILY_USD, cleanReading, costMicros, datedId, issueToken, ruleRequest, signedUpAt, tokenId } from "./agentzero.mjs";
import { askWithOwnKey, checkReading, OwnKeyError, readJob, ruleRequest as phoneRuleRequest, signUp } from "../../packages/agent/src/zero/rulebox.ts";

const APP = "zerofee-app://app";
const BASE = "https://relay.example";
const ZF_KEY = "sk-ant-zerofee-test-key-0000000000";
const OWN_KEY = "sk-ant-own-test-key-1111111111111111";
const LEADER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const READING = { job: "copy", leader: LEADER, per_trade_usd: 5, per_day_usd: 20, sell_at_pct: 50, keep_usd: null, people: [] };
const WORDS = `Copy ${LEADER} on pump.fun: $5 a trade, $20 a day, sells at +50%.`;

/** Anthropic's streamed answer, recorded in shape: message_start, a thinking block, the JSON text, the usage. */
function sse(reading: unknown, { stop = "end_turn", input = 412, output = 180 } = {}) {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const text = JSON.stringify(reading);
  return [
    ev("message_start", { message: { id: "msg_rec", type: "message", role: "assistant", model: RULE_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 1 } } }),
    ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
    ev("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } }),
    ev("content_block_stop", { index: 0 }),
    ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
    ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: text.slice(0, 20) } }),
    ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: text.slice(20) } }),
    ev("content_block_stop", { index: 1 }),
    ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: output } }),
    ev("message_stop", {}),
  ].join("");
}

type Call = { url: string; headers: Record<string, string>; body: any };
/** The relay with Anthropic recorded; the phone's fetch reaches it in process, as the app's origin. */
function world(anthropic: (c: Call) => Response | Promise<Response> = () => new Response(sse(READING), { headers: { "content-type": "text/event-stream" } }), opts: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    const h = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const c: Call = { url: String(input instanceof Request ? input.url : input), headers: Object.fromEntries(h.entries()), body: init.body ? JSON.parse(init.body) : null };
    calls.push(c);
    return anthropic(c);
  };
  // The shared store (Redis in production): free reading refuses to meter in one instance's memory (review M2).
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: ZF_KEY, agentZeroSecret: "token-secret", counter: { ...memoryCounter(), shared: true }, fetchFn, ...opts });
  let ip = 1;
  /** Everything the phone ever sent to ZeroFee's relay: its headers and body, as text. */
  const toRelay: string[] = [];
  const phoneFetch = async (url: string, init: any) => {
    toRelay.push(`${url} ${JSON.stringify(init.headers ?? {})} ${String(init.body ?? "")}`);
    return relay(new Request(url, { ...init, headers: { ...init.headers, origin: APP } }), `10.0.0.${opts.sameIp ? 1 : ip++}`);
  };
  return { relay, calls, phoneFetch, toRelay };
}

test("end to end, free reading: the phone signs up, Claude Opus 5.5 reads the words (effort medium, adaptive thinking, streamed), the sheet's terms come back, the call is metered", async () => {
  const w = world();
  const saved: string[] = [];
  const res = await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never, saveToken: async (t) => void saved.push(t) });
  assert.equal(res.fault, null);
  assert.equal(res.paidBy, "allowance");
  assert.deepEqual((res.reading as { terms: unknown }).terms, { kind: "copy", leader: LEADER, site: "pump.fun", perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50 });
  assert.equal(saved.length, 1);
  assert.match(saved[0], /^az1\./);
  assert.equal(w.calls.length, 1);
  const c = w.calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.headers["x-api-key"], ZF_KEY);
  assert.equal(c.body.model, "claude-opus-5-5");
  assert.equal(c.body.stream, true);
  assert.deepEqual(c.body.thinking, { type: "adaptive" });
  assert.equal(c.body.output_config.effort, "medium");
  assert.equal(c.body.output_config.format.type, "json_schema");
  assert.equal(c.body.fallbacks, undefined, "Opus 5.5 only: no fallback model");
  assert.match(c.body.messages[0].content, /^<words>\n/);
  // 412 in × $4/M + 180 out × $20/M = $0.005248: metered, shown rounded up to the cent.
  assert.equal(costMicros({ input_tokens: 412, output_tokens: 180 }), 5248);
  assert.deepEqual(res.allowance, { usedUsd: 0.01, limitUsd: ALLOWANCE_USD });
});

test("the allowance is per sign-up: used up → 402, the phone reads the words itself and says why; another sign-up is metered apart", async () => {
  const w = world(() => new Response(sse(READING, { input: 40_000, output: 20_000 }), { headers: { "content-type": "text/event-stream" } }), { agentZeroAllowanceUsd: 0.5 });
  let token: string | null = null;
  const o = () => ({ relayBase: BASE, fetch: w.phoneFetch as never, token, saveToken: async (t: string) => void (token = t) });
  // 40k × 4 + 20k × 20 = $0.56: the first reading passes the $0.50 allowance.
  const first = await readJob(WORDS, o());
  assert.equal(first.paidBy, "allowance");
  assert.deepEqual(first.allowance, { usedUsd: 0.56, limitUsd: 0.5 });
  const second = await readJob(WORDS, o());
  assert.equal(second.paidBy, null);
  assert.equal(second.fault?.service, "Claude");
  assert.match(second.fault?.line ?? "", /^Your free Claude reading is used up\. AgentZero read your words on this device\. Add your own Claude key/);
  assert.equal(second.reading.kind, "job", "the phone's own reader still answers with the sheet");
  assert.equal(w.calls.length, 1, "Anthropic is not asked past the allowance");
  // Control: a fresh sign-up has its own allowance.
  token = null;
  assert.equal((await readJob(WORDS, o())).paidBy, "allowance");
  assert.equal(w.calls.length, 2);
});

test("F1, own key (a developer build only, chat/own-key.ts): the phone asks Anthropic itself (Opus 5.5, the same request as the relay's), never ZeroFee's relay; a refused key is named. Every other build: the key is never used", async () => {
  const w = world();
  const direct: Call[] = [];
  const anthropicFetch = (async (input: any, init: any = {}) => {
    direct.push({ url: String(input instanceof Request ? input.url : input), headers: Object.fromEntries(new Headers(init.headers).entries()), body: JSON.parse(init.body) });
    return new Response(sse(READING), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  // the own-key ask itself, as a developer build makes it
  const reading = await askWithOwnKey(WORDS, OWN_KEY, anthropicFetch);
  assert.deepEqual((checkReading(reading, WORDS) as { terms: unknown }).terms, { kind: "copy", leader: LEADER, site: "pump.fun", perTradeUsd: 5, perDayUsd: 20, sellAtPct: 50 });
  assert.equal(direct.length, 1);
  assert.equal(direct[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(direct[0].headers["x-api-key"], OWN_KEY);
  assert.equal(direct[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  const { stream, ...sent } = direct[0].body;
  assert.equal(stream, true);
  assert.deepEqual(sent, JSON.parse(JSON.stringify(ruleRequest(WORDS))), "one request on both paths");
  const refused = (async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;
  await assert.rejects(askWithOwnKey(WORDS, OWN_KEY, refused), (e: any) => e instanceof OwnKeyError && e.why === "refused");
  assert.equal(w.toRelay.length, 0, "ZeroFee's relay is not asked at all");
  // every build people get (the switch off, as here under node): a saved key is never used; Anthropic is never asked
  const res = await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never, ownKey: OWN_KEY, token: issueToken("token-secret"), anthropicFetch });
  assert.notEqual(res.paidBy, "own-key");
  assert.equal(direct.length, 1, "no second direct call");
  assert.ok(w.toRelay.every((r) => !r.includes(OWN_KEY)), "the key never goes to the relay either");
});

test("F1: no request the phone sends to ZeroFee's relay ever carries a Claude key; the relay refuses one wherever it is", async () => {
  const w = world();
  await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never });
  await readJob("pay $5 to kim.near", { relayBase: BASE, fetch: w.phoneFetch as never });
  assert.ok(w.toRelay.length >= 2, "the control: the free path did reach the relay");
  assert.ok(w.toRelay.every((r) => !/sk-ant-|x-claude-key|x-api-key/i.test(r)), w.toRelay.join("\n"));
  const token = issueToken("token-secret");
  const send = (headers: Record<string, string>, words = WORDS) => w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify({ words }) }), `10.9.9.${Math.floor(Math.random() * 200)}`);
  const before = w.calls.length;
  for (const [headers, words] of [[{ "x-claude-key": OWN_KEY }, WORDS], [{ "x-api-key": OWN_KEY }, WORDS], [{ "x-anything": `Bearer ${OWN_KEY}` }, WORDS], [{}, `keep $20 in spending ${OWN_KEY}`]] as const) {
    const r = await send(headers, words);
    const text = await r.text();
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(text).code, "agentzero.key.refused");
    assert.ok(!text.includes(OWN_KEY));
  }
  // In the address too (review L-c).
  const inUrl = await w.relay(new Request(`${BASE}/v0/agentzero/job?k=${OWN_KEY}`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ words: WORDS }) }), "10.9.7.7");
  assert.equal(inUrl.status, 400);
  assert.equal(w.calls.length, before, "nothing was forwarded to Anthropic");
  // A malformed escape in the address (no key in it) is answered, never a 500.
  const bad = await w.relay(new Request(`${BASE}/v0/agentzero/job?x=%`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ words: WORDS }) }), "10.9.6.6");
  assert.ok(bad.status < 500, String(bad.status));
  // The browser can't even send one: the relay's CORS allows no key header.
  const pre = await w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "OPTIONS", headers: { origin: APP, "access-control-request-headers": "x-claude-key" } }), "10.9.8.7");
  assert.ok(!/x-claude-key/i.test(pre.headers.get("access-control-allow-headers") ?? ""));
});

test("the meter: the most a call can cost is reserved first, so calls in parallel can't pass the allowance; an answered error gives it back; no shared store, no free reading", async () => {
  const slow = world(async () => (await new Promise((r) => setTimeout(r, 20)), new Response(sse(READING), { headers: { "content-type": "text/event-stream" } })), { agentZeroAllowanceUsd: (MAX_CALL_MICROS * 2.5) / 1e6 });
  const token = issueToken("token-secret");
  const one = () => readJob(WORDS, { relayBase: BASE, fetch: slow.phoneFetch as never, token });
  const results = await Promise.all([one(), one(), one(), one(), one()]);
  assert.equal(results.filter((r) => r.paidBy === "allowance").length, 2, "only what the allowance can cover at the most runs at once");
  assert.equal(slow.calls.length, 2);
  // An error Anthropic answered: nothing generated, the reservation comes back.
  const err = world(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json" } }), { agentZeroAllowanceUsd: (MAX_CALL_MICROS * 1.5) / 1e6 });
  const t2 = issueToken("token-secret");
  for (let i = 0; i < 3; i++) await readJob(WORDS, { relayBase: BASE, fetch: err.phoneFetch as never, token: t2 });
  assert.equal(err.calls.length, 3, "each errored call gave its reservation back");
  const local = createRelay({ key: "k", secret: "s", origins: [APP], anthropicKey: ZF_KEY, agentZeroSecret: "token-secret", counter: memoryCounter(), fetchFn: async () => assert.fail("never asked") });
  const r = await local(new Request(`${BASE}/v0/agentzero/signup`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: "{}" }), "10.4.4.4");
  assert.equal((await r.json()).code, "agentzero.model.off");
});

test("no token, a forged token, or no sign-up secret: nothing reaches Anthropic on ZeroFee's key", async () => {
  const w = world();
  const ask = (headers: Record<string, string>) => w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", ...headers }, body: JSON.stringify({ words: WORDS }) }), "10.7.7.7");
  assert.equal((await ask({})).status, 401);
  assert.equal((await ask({ authorization: `Bearer ${issueToken("another-secret")}` })).status, 401);
  assert.equal(w.calls.length, 0);
  assert.equal(tokenId("token-secret", issueToken("token-secret", "AAAAAAAAAAAAAAAAAAAAAA")), "AAAAAAAAAAAAAAAAAAAAAA");
  const off = world(undefined, { agentZeroSecret: undefined });
  assert.equal(await signUp(BASE, off.phoneFetch as never), "refused");
});

test("sign-ups: 3 a day per address; the app's origin only", async () => {
  const w = world(undefined, { sameIp: true });
  for (let i = 0; i < 3; i++) assert.match(String(await signUp(BASE, w.phoneFetch as never)), /^az1\./);
  assert.equal(await signUp(BASE, w.phoneFetch as never), "refused");
  const full = await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never });
  assert.match(full.fault?.line ?? "", /^Free Claude reading is full for today\. AgentZero read your words on this device\./);
  const r = await w.relay(new Request(`${BASE}/v0/agentzero/signup`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }), "10.6.6.6");
  assert.equal(r.status, 403);
});

test("Claude down, refusing or unreadable: the phone names Claude and reads the words itself; AgentZero's free reading down is named apart", async () => {
  for (const answer of [() => { throw new TypeError("fetch failed"); }, () => new Response("{}", { status: 529 }), () => new Response(sse(READING, { stop: "refusal" }), { headers: { "content-type": "text/event-stream" } }), () => new Response(sse("not a reading"), { headers: { "content-type": "text/event-stream" } })]) {
    const w = world(answer as never);
    const res = await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never });
    assert.equal(res.fault?.line, "Claude didn't answer. AgentZero read your words on this device.");
    assert.equal(res.reading.kind, "job");
  }
  const dead = await readJob(WORDS, { relayBase: BASE, fetch: (async () => { throw new TypeError("offline"); }) as never });
  assert.equal(dead.fault?.service, "AgentZero's free reading");
  const pay = await readJob("pay $5 to kim.near", { relayBase: BASE, fetch: (async () => assert.fail("a payment never goes to a model")) as never });
  assert.equal(pay.reading.kind, "pay");
});

test("refused shapes never reach Anthropic: too many words, other fields, a body too big (chunked too)", async () => {
  const w = world();
  const token = issueToken("token-secret");
  const post = (body: BodyInit, extra: RequestInit = {}) => w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body, ...extra } as RequestInit), `10.5.5.${Math.floor(Math.random() * 200)}`);
  for (const body of ["{}", JSON.stringify({ words: "" }), JSON.stringify({ words: "x".repeat(501) }), JSON.stringify({ words: "hi", to: "drainer.near" }), "not json"]) assert.ok((await post(body)).status >= 400, body);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"words":"${"y".repeat(5000)}"}`)); c.close(); } });
  assert.equal((await post(stream, { duplex: "half" } as RequestInit)).status, 413);
  assert.equal(w.calls.length, 0);
});

test("the relay-wide day stops ZeroFee's key before Anthropic: by calls, and by dollars", async () => {
  const w = world(undefined, { agentZeroDaily: 1 });
  assert.equal((await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never })).paidBy, "allowance");
  const capped = await readJob(WORDS, { relayBase: BASE, fetch: w.phoneFetch as never });
  assert.equal(capped.fault?.service, "Claude");
  assert.equal(w.calls.length, 1);
  const usd = world(undefined, { agentZeroDailyUsd: (MAX_CALL_MICROS * 1.5) / 1e6 });
  await Promise.all([1, 2, 3].map(() => readJob(WORDS, { relayBase: BASE, fetch: usd.phoneFetch as never })));
  assert.equal(usd.calls.length, 1, "the day's dollars, reserved at the most a call can cost");
});

test("nothing is logged: the words and the keys never reach the console", async () => {
  const seen: string[] = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug };
  for (const k of Object.keys(orig) as (keyof typeof orig)[]) console[k] = (...a: unknown[]) => void seen.push(a.map(String).join(" "));
  try {
    await readJob("secret words kim.near keep $5 in spending", { relayBase: BASE, fetch: world().phoneFetch as never });
    await readJob("secret words kim.near keep $5 in spending", { relayBase: BASE, fetch: world(() => { throw new Error("down"); }).phoneFetch as never, ownKey: OWN_KEY, anthropicFetch: (async () => { throw new Error("down"); }) as typeof fetch });
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(!seen.some((s) => s.includes("secret words") || s.includes(OWN_KEY) || s.includes(ZF_KEY)), seen.join("\n"));
});

test("cleanReading keeps the schema's fields with their own types only; the request is Opus 5.5's", () => {
  assert.equal(cleanReading({ job: "pay-everyone" }), null);
  assert.deepEqual(cleanReading({ job: "pay-list", people: ["kim.near", 7, "x".repeat(70)], per_day_usd: -1, leader: { a: 1 } }), { job: "pay-list", leader: null, per_trade_usd: null, per_day_usd: null, sell_at_pct: null, keep_usd: null, people: ["kim.near"] });
  const r = ruleRequest("w");
  assert.equal(r.model, "claude-opus-5-5");
  assert.deepEqual(JSON.parse(JSON.stringify(phoneRuleRequest("w"))), JSON.parse(JSON.stringify(r)), "the phone's own-key request is the relay's");
  assert.equal(r.output_config.effort, "medium");
});

// Audit L17: the free pool can't be drained by stockpiled tokens, one token's day, or a caller with no app Origin.
test("product decision, 4 Nov: a token's free reading renews by itself, never ending after 30 days (the sign-up hour stays in the id)", async () => {
  const day = 86_400_000;
  const at = Date.UTC(2026, 10, 3, 12);
  const id = datedId(at);
  assert.match(issueToken("token-secret", id), /^az1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/, "the core's own check of the shape still holds");
  assert.equal(signedUpAt(id, at), Math.floor(at / 3_600_000) * 3_600_000);
  assert.equal(signedUpAt("AAAAAAAAAAAAAAAAAAAAAA", at), null);
  // an older random id that happens to start with the mark reads as a far future hour, so it is an older id
  const marked = Buffer.alloc(16, 0xff);
  marked[0] = 0xa2;
  assert.equal(signedUpAt(marked.toString("base64url"), at), null);
  // end to end: a sign-up's token reads on day 1 (control), 31 days on and 61 days on
  let clock = at;
  const w = world(undefined, { now: () => clock });
  const token = String(await signUp(BASE, w.phoneFetch as never));
  const ask = () => w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ words: WORDS }) }), "10.8.0.1");
  for (const d of [1, 31, 61]) {
    clock = at + d * day;
    const r = await ask();
    assert.equal(r.status, 200, `day ${d}`);
  }
  assert.equal(w.calls.length, 3, "each day's reading reached Anthropic");
  // an older id with no sign-up hour reads past the old end too
  clock = Date.UTC(2027, 0, 10);
  const old = issueToken("token-secret", "AAAAAAAAAAAAAAAAAAAAAA");
  const r = await w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${old}` }, body: JSON.stringify({ words: WORDS }) }), "10.8.0.2");
  assert.equal(r.status, 200);
});

test("audit L17: one token's free reading is capped a UTC day; another token, or the next day, reads (controls)", async () => {
  assert.equal(TOKEN_DAILY_USD, 0.5);
  let clock = Date.UTC(2026, 10, 3, 1);
  const w = world(undefined, { now: () => clock, agentZeroAllowanceUsd: 10, agentZeroTokenDailyUsd: (MAX_CALL_MICROS + 1_000) / 1e6 });
  const ask = (token: string) => w.relay(new Request(`${BASE}/v0/agentzero/job`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ words: WORDS }) }), "10.8.1.1");
  const a = issueToken("token-secret", datedId(clock));
  assert.equal((await ask(a)).status, 200);
  const capped = await ask(a);
  assert.equal(capped.status, 429);
  assert.equal((await capped.json()).code, "agentzero.allowance.today");
  assert.equal(w.calls.length, 1, "the capped call never reached Anthropic");
  assert.equal((await ask(issueToken("token-secret", datedId(clock)))).status, 200, "another token reads");
  clock += 86_400_000;
  assert.equal((await ask(a)).status, 200, "the next day the same token reads again");
  // the chat route has the same cap
  const chat = (token: string) => w.relay(new Request(`${BASE}/v0/agentzero/chat`, { method: "POST", headers: { origin: APP, "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), "10.8.1.2");
  const c = await chat(a);
  assert.equal(c.status, 429);
  assert.equal((await c.json()).code, "agentzero.allowance.today");
});

test("audit L17: sign-up and chat with no Origin, or one that isn't the app's, are refused before anything else", async () => {
  const w = world();
  const token = issueToken("token-secret");
  for (const origin of [null, "https://evil.example"]) {
    const headers = (extra: Record<string, string> = {}) => ({ "content-type": "application/json", ...(origin ? { origin } : {}), ...extra });
    const s = await w.relay(new Request(`${BASE}/v0/agentzero/signup`, { method: "POST", headers: headers(), body: "{}" }), "10.8.2.1");
    assert.equal(s.status, 403, `sign-up, origin ${origin}`);
    const c = await w.relay(new Request(`${BASE}/v0/agentzero/chat`, { method: "POST", headers: headers({ authorization: `Bearer ${token}` }), body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), "10.8.2.2");
    assert.equal(c.status, 403, `chat, origin ${origin}`);
  }
  assert.equal(w.calls.length, 0);
  // control: the app's own origin signs up
  assert.match(String(await signUp(BASE, w.phoneFetch as never)), /^az1\./);
});
