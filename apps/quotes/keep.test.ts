// The sealed keep's bounds (keep.mjs; security review of 7ccf644a, MUST 2): anyone can make keys, so the keep lives in
// its own store (losing or filling it fails /v0/keep alone), every keep expires about 400 days after its last use, and
// the relay takes at most so many new ids a day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createRelay } from "./relay.mjs";
import { memoryCounter } from "./guards.mjs";
import { KEEP_TTL_S, createKeep, keepMessage, memoryKeep, redisKeep } from "./keep.mjs";

const BASE = "https://relay.example";
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function keyPair() {
  const secret = ed25519.utils.randomSecretKey();
  return { secret, id: hex(ed25519.getPublicKey(secret)) };
}

function request(k: { secret: Uint8Array; id: string }, op: "put" | "get", sealed = "c2VhbGVk", t = Date.now()) {
  const sig = hex(ed25519.sign(keepMessage(op, k.id, t, op === "put" ? sealed : ""), k.secret));
  return new Request(`${BASE}/v0/keep/${k.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, t, sig, ...(op === "put" ? { sealed } : {}) }) });
}

const tools = {
  answer: ({ status, body }: { status: number; body: unknown }) => new Response(JSON.stringify(body), { status }),
  problem: (status: number, code: string, whatHappened: string) => ({ status, body: { code, whatHappened } }),
};

test("each put sets about 400 days, and each get refreshes it (the keep's own Redis: SET … EX, GETEX … EX)", async () => {
  const sent: string[][] = [];
  const store = redisKeep({ url: "https://keep.example", token: "t", fetchFn: async (_u: string, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as string[];
    sent.push(args);
    const result = args[0] === "GETEX" ? "c2VhbGVk" : args.includes("XX") ? null : "OK";
    return new Response(JSON.stringify({ result }));
  } });
  const keep = createKeep({ store, counter: memoryCounter() });
  const k = keyPair();
  assert.equal((await keep(request(k, "put"), k.id, "10.0.0.1", tools)).status, 200);
  assert.equal((await keep(request(k, "get"), k.id, "10.0.0.1", tools)).status, 200);
  const ttl = String(KEEP_TTL_S);
  assert.ok(KEEP_TTL_S >= 390 * 86_400 && KEEP_TTL_S <= 410 * 86_400);
  assert.ok(sent.some((a) => a[0] === "SET" && a.includes("NX") && a.includes("EX") && a.includes(ttl)), "a new keep has its time");
  assert.ok(sent.some((a) => a[0] === "GETEX" && a.includes("EX") && a.includes(ttl)), "a read refreshes it");
  assert.ok(!sent.some((a) => a[0] === "SET" && !a.includes("EX")), "never a keep without an end");
});

test("a keep nobody uses for its whole time is gone", async () => {
  let t = Date.now();
  const now = () => t;
  const keep = createKeep({ store: memoryKeep(now), counter: memoryCounter(now), now });
  const k = keyPair();
  assert.equal((await keep(request(k, "put", "c2VhbGVk", t), k.id, "10.0.0.1", tools)).status, 200);
  t += (KEEP_TTL_S - 10) * 1000;
  assert.equal((await keep(request(k, "get", "", t), k.id, "10.0.0.1", tools)).status, 200, "a read before the end keeps it");
  t += (KEEP_TTL_S - 10) * 1000;
  assert.equal((await keep(request(k, "get", "", t), k.id, "10.0.0.1", tools)).status, 200, "and it was refreshed");
  t += (KEEP_TTL_S + 10) * 1000;
  assert.equal((await keep(request(k, "get", "", t), k.id, "10.0.0.1", tools)).status, 404);
});

test("at most so many new ids a day across the relay; replacing an existing keep still works", async () => {
  const keep = createKeep({ store: memoryKeep(), counter: memoryCounter(), newPerDay: 2 });
  const a = keyPair(), b = keyPair(), c = keyPair();
  assert.equal((await keep(request(a, "put"), a.id, "10.0.0.1", tools)).status, 200);
  assert.equal((await keep(request(b, "put"), b.id, "10.0.0.2", tools)).status, 200);
  const third = await keep(request(c, "put"), c.id, "10.0.0.3", tools);
  assert.equal(third.status, 503);
  assert.equal(((await third.json()) as { code: string }).code, "keep.full");
  assert.equal((await keep(request(a, "put", "bmV3"), a.id, "10.0.0.1", tools)).status, 200, "an existing keep is replaced");
});

test("a keep store that fails answers /v0/keep 503 and no other route; with no store the keep is off", async () => {
  const broken = { replace: async () => { throw Object.assign(new Error("down"), { guardUnavailable: true }); }, add: async () => { throw Object.assign(new Error("down"), { guardUnavailable: true }); }, get: async () => { throw Object.assign(new Error("down"), { guardUnavailable: true }); } };
  const relay = createRelay({ key: "k", secret: "s", origins: [], counter: memoryCounter(), keepStore: broken });
  const k = keyPair();
  assert.equal((await relay(request(k, "put"), "10.0.0.1")).status, 503);
  const pair = await relay(new Request(`${BASE}/v0/pair/${"ab".repeat(16)}`), "10.0.0.1");
  assert.equal(pair.status, 404, "the pairing mailbox still answers");
  const off = createRelay({ key: "k", secret: "s", origins: [], counter: memoryCounter(), keepStore: null });
  const r = await off(request(k, "put"), "10.0.0.1");
  assert.equal(r.status, 503);
  assert.equal(((await r.json()) as { code: string }).code, "keep.off");
});

test("the deployed relay gives the keep its own Redis only, never the shared store, and never memory", () => {
  const api = readFileSync(new URL("./api/relay.mjs", import.meta.url), "utf8");
  const line = api.split("\n").find((l) => l.trim().startsWith("keepStore:")) ?? "";
  assert.match(line, /env\.KEEP_REDIS_URL && env\.KEEP_REDIS_TOKEN && env\.KEEP_REDIS_URL !== storeUrl \? redisKeep\(\{ url: env\.KEEP_REDIS_URL, token: env\.KEEP_REDIS_TOKEN \}\) : null/);
  assert.doesNotMatch(line, /memoryKeep|redisKeep\(redis\)/);
});
