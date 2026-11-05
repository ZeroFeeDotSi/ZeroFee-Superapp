// The relay's one-time pairing mailbox (pair.mjs; D100, D101): the phone leaves a sealed box, the computer reads it
// once, then it's gone; 10 minutes at most; per-address limits; nothing listed; nothing logged. Hermetic: the relay in
// process, its counters and mailbox in memory (and a recorded Redis for the shared store's commands).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { BOX_MAX, PAIR_GET_MAX, PAIR_POST_MAX, memoryMailbox, pairIdOf, redisMailbox } from "./pair.mjs";

const APP = "zerofee-app://app";
const BASE = "https://relay.example";
const newId = () => randomBytes(16).toString("hex");
const newBox = (n = 1800) => randomBytes(n).toString("base64url").slice(0, n);

function world(opts: { now?: () => number } = {}) {
  const now = opts.now ?? Date.now;
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], counter: memoryCounter(now), pairStore: memoryMailbox(now), now });
  let n = 0;
  // Each POST from its own address unless a test names one (the per-address limit has its own test).
  const post = (id: string, body: unknown, { ip = `10.9.${n >> 8}.${n++ & 255}`, origin = APP as string | null, type = "application/json" } = {}) =>
    relay(new Request(`${BASE}/v0/pair/${id}`, { method: "POST", headers: { "content-type": type, ...(origin ? { origin } : {}) }, body: typeof body === "string" ? body : JSON.stringify(body) }), ip);
  const get = (id: string, ip = "10.0.0.2") => relay(new Request(`${BASE}/v0/pair/${id}`), ip);
  return { relay, post, get };
}

test("the round trip: the phone leaves a box (201), the computer reads it once (200), then it's gone (404)", async () => {
  const w = world();
  const id = newId();
  const box = newBox();
  const put = await w.post(id, { box });
  assert.equal(put.status, 201);
  assert.deepEqual(await put.json(), { stored: true });
  const got = await w.get(id);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("cache-control"), "no-store");
  assert.deepEqual(await got.json(), { box });
  const again = await w.get(id);
  assert.equal(again.status, 404, "read once only");
  assert.equal((await again.json()).code, "pair.mailbox.empty");
  // Vercel's rewritten address reaches the same mailbox.
  const id2 = newId();
  assert.equal((await w.post(id2, { box })).status, 201);
  const viaRewrite = await w.relay(new Request(`${BASE}/api/relay?route=pair&id=${id2}`), "10.0.0.3");
  assert.equal(viaRewrite.status, 200);
  assert.deepEqual(await viaRewrite.json(), { box });
});

test("a mailbox that holds a box is never replaced (409); an empty one is 404", async () => {
  const w = world();
  const id = newId();
  assert.equal((await w.get(id)).status, 404);
  assert.equal((await w.post(id, { box: newBox() })).status, 201);
  const second = await w.post(id, { box: newBox() }, { ip: "10.0.0.9" });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "pair.mailbox.taken");
});

test("10 minutes, then the box is gone", async () => {
  let t = Date.parse("2026-11-03T00:00:00Z");
  const w = world({ now: () => t });
  const id = newId();
  assert.equal((await w.post(id, { box: newBox() })).status, 201);
  t += 10 * 60_000 - 1;
  const late = newId();
  assert.equal((await w.post(late, { box: newBox() })).status, 201);
  t += 1;
  assert.equal((await w.get(id)).status, 404, "expired at 10 minutes");
  assert.equal((await w.get(late)).status, 200, "control: a box inside its 10 minutes reads");
  // An expired mailbox takes a new box.
  assert.equal((await w.post(id, { box: newBox() })).status, 201);
});

test("only a mailbox id of 32 lowercase hex, only {box} of base64url up to 4 KB, JSON only", async () => {
  const w = world();
  for (const bad of ["ABCDEF0123456789abcdef0123456789", "abc", "0".repeat(33), "0".repeat(31) + "g", ""]) {
    assert.equal((await w.post(bad, { box: "abc" })).status, 404, bad);
    assert.equal((await w.get(bad)).status, 404, bad);
  }
  // Nothing lists mailboxes.
  for (const path of ["/v0/pair", "/v0/pair/", "/api/relay?route=pair"]) assert.equal((await w.relay(new Request(`${BASE}${path}`), "10.0.0.4")).status, 404, path);
  const id = newId();
  assert.equal((await w.post(id, { box: "has space" })).status, 400);
  assert.equal((await w.post(id, { box: "a+b/c=" })).status, 400, "base64url only");
  assert.equal((await w.post(id, { box: "" })).status, 400);
  assert.equal((await w.post(id, { box: 5 })).status, 400);
  assert.equal((await w.post(id, { box: "abc", extra: 1 })).status, 400, "only {box}");
  assert.equal((await w.post(id, ["abc"])).status, 400);
  assert.equal((await w.post(id, "{not json")).status, 400);
  assert.equal((await w.post(id, { box: "abc" }, { type: "text/plain" })).status, 415);
  assert.equal((await w.post(id, { box: "a".repeat(BOX_MAX + 1) })).status, 400, "a box over 4 KB");
  assert.equal((await w.post(id, { box: "a".repeat(BOX_MAX + 100) })).status, 413, "over the body cap");
  // A chunked body with no content-length is cut off at the cap too.
  const big = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`{"box":"${"a".repeat(BOX_MAX * 3)}"}`)); c.close(); } });
  const chunked = await w.relay(new Request(`${BASE}/v0/pair/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: big, duplex: "half" } as RequestInit), "10.0.0.5");
  assert.equal(chunked.status, 413);
  assert.equal((await w.post(id, { box: "a".repeat(BOX_MAX) })).status, 201, "control: a 4 KB box fits");
  // Another method: nothing here.
  assert.equal((await w.relay(new Request(`${BASE}/v0/pair/${newId()}`, { method: "PUT", body: "x" }), "10.0.0.6")).status, 404);
  // Another site's page: refused by the relay's origin check, like every route.
  assert.equal((await w.post(newId(), { box: "abc" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await w.post(newId(), { box: "abc" }, { origin: null })).status, 201, "control: no origin (the computer's own fetch)");
});

test("per address: 10 POSTs and 120 GETs every 10 minutes; another address has its own count", async () => {
  let t = Date.parse("2026-11-03T00:00:00Z");
  const w = world({ now: () => t });
  for (let i = 0; i < PAIR_POST_MAX; i++) assert.equal((await w.post(newId(), { box: "abc" }, { ip: "10.1.0.1" })).status, 201, `post ${i}`);
  assert.equal((await w.post(newId(), { box: "abc" }, { ip: "10.1.0.1" })).status, 429);
  assert.equal((await w.post(newId(), { box: "abc" }, { ip: "10.1.0.2" })).status, 201, "another address");
  for (let i = 0; i < PAIR_GET_MAX; i++) assert.equal((await w.get(newId(), "10.2.0.1")).status, 404, `get ${i}`);
  assert.equal((await w.get(newId(), "10.2.0.1")).status, 429);
  t += 10 * 60_000;
  assert.equal((await w.get(newId(), "10.2.0.1")).status, 404, "a new window");
  assert.equal((await w.post(newId(), { box: "abc" }, { ip: "10.1.0.1" })).status, 201, "a new window");
});

test("nothing logged: no box and no id reach the console", async () => {
  const lines: string[] = [];
  const saved = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    const w = world();
    const id = newId();
    const box = newBox();
    await w.post(id, { box });
    await w.post(id, { box });
    await w.get(id);
    await w.get(id);
    await w.post("bad", { box });
  } finally {
    Object.assign(console, saved);
  }
  assert.deepEqual(lines, []);
});

test("the shared store: SET … EX 600 NX and GETDEL, under the id's hash (never the id); a failing Redis is a 503", async () => {
  const sent: unknown[][] = [];
  const kv = new Map<string, string>();
  const fetchFn = async (_url: string, init: { body: string }) => {
    const cmd = JSON.parse(init.body) as string[];
    sent.push(cmd);
    if (cmd[0] === "SET") return Response.json({ result: kv.has(cmd[1]!) ? null : (kv.set(cmd[1]!, cmd[2]!), "OK") });
    if (cmd[0] === "GETDEL") {
      const v = kv.get(cmd[1]!) ?? null;
      kv.delete(cmd[1]!);
      return Response.json({ result: v });
    }
    return new Response("no", { status: 400 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: [APP], counter: memoryCounter(), pairStore: redisMailbox({ url: "https://redis.example", token: "t", fetchFn: fetchFn as never }) });
  const id = newId();
  const box = newBox(100);
  const post = () => relay(new Request(`${BASE}/v0/pair/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ box }) }), "10.0.0.1");
  assert.equal((await post()).status, 201);
  assert.equal((await post()).status, 409);
  assert.deepEqual(await (await relay(new Request(`${BASE}/v0/pair/${id}`), "10.0.0.1")).json(), { box });
  assert.equal((await relay(new Request(`${BASE}/v0/pair/${id}`), "10.0.0.1")).status, 404);
  assert.deepEqual(sent[0]!.slice(0, 1).concat(sent[0]!.slice(2)), ["SET", box, "EX", "600", "NX"]);
  assert.equal(sent[2]![0], "GETDEL");
  assert.match(String(sent[0]![1]), /^pair:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(sent).includes(id), "the store never holds the id itself");
  const down = createRelay({ key: "k", secret: "s", origins: [APP], counter: memoryCounter(), pairStore: redisMailbox({ url: "https://redis.example", token: "t", fetchFn: (async () => new Response("down", { status: 500 })) as never }) });
  assert.equal((await down(new Request(`${BASE}/v0/pair/${id}`), "10.0.0.1")).status, 503);
});

test("pairIdOf: only the pair routes, the id only when well formed", () => {
  const u = (s: string) => new URL(s, BASE);
  const id = newId();
  assert.equal(pairIdOf(u(`/v0/pair/${id}`)), id);
  assert.equal(pairIdOf(u(`/api/relay?route=pair&id=${id}`)), id);
  assert.equal(pairIdOf(u(`/v0/pair/${id}/x`)), null);
  assert.equal(pairIdOf(u(`/v0/quote`)), undefined);
  assert.equal(pairIdOf(u(`/v0/pairs/${id}`)), undefined);
});
