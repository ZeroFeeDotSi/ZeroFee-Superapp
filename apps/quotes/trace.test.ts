// The test flight recorder's relay routes (trace.mjs): the app's origins write sealed batches, only the read token
// reads them, a trimmed list keeps its numbers, and every refusal has its control. Hermetic: the relay in process, its
// counters and trace lists in memory (and a recorded Redis for the shared store's commands).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRelay } from "./relay.mjs";
import { memoryCounter, privateCounter } from "./guards.mjs";
import { TRACE_BODY_MAX, TRACE_KEEP, TRACE_POST_MAX, memoryTraces, redisTraces, tokenMatches, traceIdOf } from "./trace.mjs";

const APP = "zerofee-app://app";
const LAPTOP = "https://laptop.example";
const BASE = "https://relay.example";
const TOKEN = "t".repeat(20) + randomBytes(16).toString("hex");
const newId = () => randomBytes(16).toString("hex");
const newBox = (n = 600) => randomBytes(n).toString("base64url").slice(0, n);

function world(opts: { now?: () => number; readToken?: string | undefined } = {}) {
  const now = opts.now ?? Date.now;
  const relay = createRelay({ key: "k", secret: "s", origins: [APP, LAPTOP], counter: memoryCounter(now), traceStore: memoryTraces(now), traceReadToken: "readToken" in opts ? opts.readToken : TOKEN, now });
  let n = 0;
  const post = (id: string, body: string, { ip = `10.9.${n >> 8}.${n++ & 255}`, origin = APP as string | null, type = "text/plain" } = {}) =>
    relay(new Request(`${BASE}/v0/trace/${id}`, { method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body }), ip);
  const get = (id: string, from = 0, { token = TOKEN as string | null, ip = "10.0.0.2" } = {}) =>
    relay(new Request(`${BASE}/v0/trace/${id}?from=${from}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), ip);
  return { relay, post, get };
}

test("the round trip: the app's origins append sealed batches (201), the reader reads them from an index (200)", async () => {
  const w = world();
  const id = newId();
  const boxes = [newBox(), newBox(), newBox()];
  for (const [i, b] of boxes.entries()) {
    const r = await w.post(id, b, { origin: i === 2 ? LAPTOP : APP });
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { n: i + 1 });
  }
  const all = await w.get(id);
  assert.equal(all.status, 200);
  assert.equal(all.headers.get("cache-control"), "no-store");
  assert.deepEqual(await all.json(), { from: 0, next: 3, items: boxes });
  assert.deepEqual(await (await w.get(id, 2)).json(), { from: 2, next: 3, items: [boxes[2]] }, "from an index");
  assert.deepEqual(await (await w.get(id, 99)).json(), { from: 3, next: 3, items: [] }, "past the end: nothing, and where the end is");
  // Vercel's rewritten address reaches the same trace.
  const viaRewrite = await w.relay(new Request(`${BASE}/api/relay?route=trace&id=${id}&from=1`, { headers: { authorization: `Bearer ${TOKEN}` } }), "10.0.0.3");
  assert.deepEqual((await viaRewrite.json()).items, boxes.slice(1));
  // another trace is its own
  assert.deepEqual((await (await w.get(newId())).json()).items, []);
});

test("controls: a wrong origin is 403, no origin is 403, the right origin writes", async () => {
  const w = world();
  const id = newId();
  const wrong = await w.post(id, newBox(), { origin: "https://evil.example" });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).code, "quotes.origin.refused");
  assert.equal((await w.post(id, newBox(), { origin: null })).status, 403, "a script with no origin can't write");
  assert.deepEqual((await (await w.get(id)).json()).items, [], "nothing stored by either");
  assert.equal((await w.post(id, newBox())).status, 201, "control: the app's origin writes");
});

test("controls: no token or a wrong one reads nothing (404); the token reads", async () => {
  const w = world();
  const id = newId();
  assert.equal((await w.post(id, newBox())).status, 201);
  for (const token of [null, "wrong-token-wrong-token", TOKEN.slice(0, -1), `${TOKEN}x`]) {
    const r = await w.get(id, 0, { token });
    assert.equal(r.status, 404, String(token));
    assert.equal((await r.json()).items, undefined, "never the batches");
  }
  const basic = await w.relay(new Request(`${BASE}/v0/trace/${id}`, { headers: { authorization: `Basic ${TOKEN}` } }), "10.0.0.4");
  assert.equal(basic.status, 404, "only a Bearer token");
  assert.equal((await w.get(id)).status, 200, "control: the token reads");
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches("Bearer ", TOKEN), false);
});

test("controls: a body over 64 KB is 413, not base64url is 400, not text is 415; a 64 KB one is taken", async () => {
  const w = world();
  const id = newId();
  const big = await w.post(id, "A".repeat(TRACE_BODY_MAX + 1));
  assert.equal(big.status, 413);
  for (const bad of ["abc+def", "abc/def", "abc=", "", "{\"box\":\"abc\"}", "abc def"]) assert.equal((await w.post(id, bad)).status, 400, bad);
  assert.equal((await w.post(id, newBox(), { type: "application/json" })).status, 415);
  assert.deepEqual((await (await w.get(id)).json()).items, [], "none of them stored");
  assert.equal((await w.post(id, "A".repeat(TRACE_BODY_MAX))).status, 201, "control: exactly 64 KB is taken");
});

test("controls: a bad id is 404 both ways; a good one isn't", async () => {
  const w = world();
  for (const bad of ["ABCDEF0123456789abcdef0123456789", "abc", "0".repeat(33), "0".repeat(31) + "g", ""]) {
    assert.equal((await w.post(bad, newBox())).status, 404, bad);
    assert.equal((await w.get(bad)).status, 404, bad);
  }
  assert.equal(traceIdOf(new URL(`${BASE}/v0/quote`)), undefined, "not a trace route");
  assert.equal(traceIdOf(new URL(`${BASE}/v0/trace`)), null);
  const id = newId();
  assert.equal(traceIdOf(new URL(`${BASE}/v0/trace/${id}`)), id, "control");
  assert.equal((await w.get(id, 0)).status, 200, "control: a good id reads");
  assert.equal((await w.relay(new Request(`${BASE}/v0/trace/${id}?from=-1`, { headers: { authorization: `Bearer ${TOKEN}` } }), "10.0.0.5")).status, 400, "from is a whole number");
});

test("off without TRACE_READ_TOKEN: both routes are the plain 404 (control: with it, they answer)", async () => {
  for (const readToken of [undefined, "", "short"]) {
    const w = world({ readToken });
    const id = newId();
    assert.equal((await w.post(id, newBox())).status, 404);
    assert.equal((await w.get(id, 0, { token: readToken || null })).status, 404);
  }
  assert.equal((await world().post(newId(), newBox())).status, 201);
});

test("120 POSTs a minute per address, then 429; another address still writes", async () => {
  let t = Date.parse("2026-11-04T00:00:00Z");
  const w = world({ now: () => t });
  const id = newId();
  for (let i = 0; i < TRACE_POST_MAX; i++) assert.equal((await w.post(id, newBox(40), { ip: "10.1.1.1" })).status, 201, `post ${i}`);
  assert.equal((await w.post(id, newBox(40), { ip: "10.1.1.1" })).status, 429);
  assert.equal((await w.post(id, newBox(40), { ip: "10.2.2.2" })).status, 201, "control: another address");
  t += 60_000;
  assert.equal((await w.post(id, newBox(40), { ip: "10.1.1.1" })).status, 201, "control: the next minute");
});

test("the list keeps the last 5,000 and its numbers; 24 h after the last batch it's gone", async () => {
  let t = Date.parse("2026-11-04T00:00:00Z");
  const store = memoryTraces(() => t);
  const key = "k";
  for (let i = 0; i < TRACE_KEEP + 7; i++) await store.push(key, `b${i}`, TRACE_KEEP, 86_400);
  const first = await store.read(key, 0, 3);
  assert.deepEqual(first, { from: 7, next: TRACE_KEEP + 7, items: ["b7", "b8", "b9"] }, "trimmed: the oldest kept is number 7");
  assert.deepEqual((await store.read(key, TRACE_KEEP + 6, 10)).items, [`b${TRACE_KEEP + 6}`]);
  t += 86_400_000 - 1;
  assert.equal((await store.read(key, 0, 1)).items.length, 1, "control: inside 24 h");
  t += 1;
  assert.deepEqual(await store.read(key, 0, 1), { from: 0, next: 0, items: [] });
});

test("in the shared store: one script each way, the key the HMAC of the id under the store key (never the id)", async () => {
  const sent: unknown[][] = [];
  const fetchFn = async (_url: string, init: { body: string }) => {
    const args = JSON.parse(init.body) as unknown[];
    sent.push(args);
    const result = String(args[1]).includes("RPUSH") ? 4 : [3, 4, ["sealed"]];
    return new Response(JSON.stringify({ result }), { status: 200 });
  };
  const counter = privateCounter(memoryCounter(), "s".repeat(40));
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], counter, traceStore: redisTraces({ url: "https://redis.example", token: "rt", fetchFn: fetchFn as never }), traceReadToken: TOKEN });
  const id = newId();
  const put = await relay(new Request(`${BASE}/v0/trace/${id}`, { method: "POST", headers: { origin: APP, "content-type": "text/plain" }, body: "c2VhbGVk" }), "10.0.0.1");
  assert.equal(put.status, 201);
  const got = await relay(new Request(`${BASE}/v0/trace/${id}?from=3`, { headers: { authorization: `Bearer ${TOKEN}` } }), "10.0.0.1");
  assert.deepEqual(await got.json(), { from: 3, next: 4, items: ["sealed"] });
  assert.equal(sent.length, 2);
  const [push, read] = sent;
  assert.equal(push![0], "EVAL");
  assert.match(String(push![1]), /RPUSH[\s\S]*LTRIM[\s\S]*EXPIRE/);
  assert.equal(push![3], counter.keyOf(`trace:${id}`));
  assert.deepEqual(push!.slice(5), ["c2VhbGVk", String(TRACE_KEEP), "86400"]);
  assert.equal(read![3], counter.keyOf(`trace:${id}`));
  assert.ok(!JSON.stringify(sent).includes(id), "the id itself never reaches the store");
});
