// Audit fixes: production origins, no upstream text to clients, market miss caps, a Redis that fails closed, no IPs or queries in logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore: plain JS
import * as relayMod from "./relay.mjs";
// @ts-ignore: plain JS
import { redisCounter, memoryCounter } from "./guards.mjs";

const { createRelay } = relayMod as any;
const KEY = "partner-key-SECRET-1234567890";
const HERE = import.meta.dirname;

test("origins: production drops the localhost origins, dev and preview keep them", () => {
  const appOrigins = (relayMod as any).appOrigins;
  assert.equal(typeof appOrigins, "function");
  const prod = appOrigins({ VERCEL_ENV: "production" });
  assert.ok(prod.includes("zerofee-app://app"));
  assert.ok(!prod.some((o: string) => o.includes("localhost")));
  assert.ok(appOrigins({ VERCEL_ENV: "preview" }).some((o: string) => o.includes("localhost")));
  assert.ok(appOrigins({}).some((o: string) => o.includes("localhost")));
});

test("origins: the Chrome extension's pinned page origin is the app's own, in production too (row 35); another extension isn't", async () => {
  const appOrigins = (relayMod as any).appOrigins;
  const pinned = readFileSync(join(HERE, "../extension/src/extension-id.ts"), "utf8").match(/EXTENSION_ID: string = "([a-p]{32})"/)?.[1];
  assert.ok(pinned, "the extension's pinned id");
  assert.equal((relayMod as any).EXTENSION_ORIGIN, `chrome-extension://${pinned}`);
  for (const env of [{ VERCEL_ENV: "production" }, {}]) assert.ok(appOrigins(env).includes(`chrome-extension://${pinned}`));
  const relay = createRelay({ key: KEY, secret: "s", origins: appOrigins({ VERCEL_ENV: "production" }), fetchFn: async () => new Response("{}") });
  const pre = (origin: string) => relay(new Request("https://q.example/v0/near", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } }), "203.0.113.9");
  const ok = await pre(`chrome-extension://${pinned}`);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), `chrome-extension://${pinned}`);
  // control: any other extension is refused, as before
  assert.equal((await pre("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).status, 403);
});

test("upstream errors: a 1Click or market error body is never passed to the client", async () => {
  const leak = "UPSTREAM-DETAIL-internal-stack-trace";
  const fetchFn = async () => new Response(JSON.stringify({ message: leak }), { status: 400 });
  const relay = createRelay({ key: KEY, secret: "s", origins: ["https://a.example"], fetchFn, market: { cg: { key: "cg-key-0123456789" } } });
  const status = await relay(new Request(`https://q.example/v0/status?depositAddress=${"ab".repeat(32)}`), "203.0.113.1");
  const st = await status.text();
  assert.ok(!st.includes(leak), st);
  assert.ok(status.status >= 400);
  const mk = await relay(new Request("https://q.example/v0/market/cg/simple/price?ids=solana&vs_currencies=usd"), "203.0.113.1");
  const mt = await mk.text();
  assert.ok(!mt.includes(leak), mt);
  assert.ok(mk.status >= 400);
});

test("market: a cache miss counts against a per-address cap, cache hits do not (product decision, 4 Nov: the app's origin gets 200 a minute, any other caller 40)", async () => {
  let calls = 0;
  const fetchFn = async () => (calls++, new Response("{}", { status: 200 }));
  // the app's own origin (a read with no Origin has its own, smaller share: audit-l13.test.ts)
  const relay = createRelay({ key: KEY, secret: "s", origins: ["https://a.example"], fetchFn, market: { cg: { key: "cg-key-0123456789" }, dailyCalls: 100000 } });
  const app = (url: string) => new Request(url, { headers: { origin: "https://a.example" } });
  const codes: number[] = [];
  for (let i = 0; i < 230; i++) codes.push((await relay(app(`https://q.example/v0/market/cg/simple/price?ids=c${i}&vs_currencies=usd`), "203.0.113.9")).status);
  assert.ok(calls <= 200, `${calls} upstream calls from one app address in a minute`);
  assert.ok(codes.includes(429));
  const other = calls;
  for (let i = 0; i < 80; i++) await relay(new Request(`https://q.example/v0/market/cg/simple/price?ids=o${i}&vs_currencies=usd`), "203.0.113.11");
  assert.ok(calls - other <= 40, `control: ${calls - other} upstream calls from a no-Origin caller's address`);
  assert.equal((await relay(app("https://q.example/v0/market/cg/simple/price?ids=other&vs_currencies=usd"), "203.0.113.10")).status, 200);
  const before = calls;
  for (let i = 0; i < 5; i++) await relay(app("https://q.example/v0/market/cg/simple/price?ids=other&vs_currencies=usd"), "203.0.113.10");
  assert.equal(calls, before);
});

test("guard: a failing Redis fails closed (503 rate guard unavailable), never falls back to memory", async () => {
  const counter = redisCounter({ url: "https://redis.example", token: "t", fetchFn: async () => new Response("no", { status: 500 }) });
  await assert.rejects(() => counter.hit("k", 1000));
  const relay = createRelay({ key: KEY, secret: "s", origins: [], counter, fetchFn: async () => new Response("{}") });
  const r = await relay(new Request(`https://q.example/v0/status?depositAddress=${"ab".repeat(32)}`), "203.0.113.1");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "rate guard unavailable");
  const m = await relay(new Request("https://q.example/v0/market/cg/simple/price?ids=a"), "203.0.113.1");
  assert.equal(m.status, 503);
  assert.equal(await memoryCounter().hit("k", 1000), 1);
});

test("logging: no console output and no ip fields anywhere in apps/quotes", () => {
  const files = [...readdirSync(HERE).filter((f) => /\.mjs$/.test(f)), ...readdirSync(join(HERE, "api")).map((f) => `api/${f}`)];
  assert.ok(files.length >= 5);
  for (const f of files) {
    const src = readFileSync(join(HERE, f), "utf8");
    assert.ok(!/console\.(log|info|warn|error|debug)/.test(src), `${f} logs`);
    assert.ok(!/\bip:\s|"ip"|\.ip\b/.test(src.replace(/\/\/.*$/gm, "")), `${f} keeps an ip field`);
  }
});

test("product decision, 4 Nov (Home lost every $ price for 19 min): the app's address has a day for real use, and a kept price is served, even past its time, before any limit says no (control: another caller's day, and nothing kept)", async () => {
  let t = Date.UTC(2026, 10, 4, 12);
  let missesToday = 1;
  let up = true;
  let calls = 0;
  const counter = { hit: async (key: string) => (key.startsWith("rate:market-miss-day:") ? missesToday : 1) };
  const fetchFn = async () => (calls++, up ? new Response('{"near":{"usd":2}}', { status: 200 }) : new Response("{}", { status: 500 }));
  const relay = createRelay({ key: KEY, secret: "s", origins: ["https://a.example"], fetchFn, counter, now: () => t, market: { cg: { key: "cg-key-0123456789" }, dailyCalls: 100000 } });
  const price = (origin = "https://a.example", ids = "near") => relay(new Request(`https://q.example/v0/market/cg/simple/price?ids=${ids}&vs_currencies=usd`, { headers: origin ? { origin } : {} }), "203.0.113.9");
  missesToday = 3_001;
  assert.equal((await price()).status, 200, "past the old 3,000 a day, the app's phones behind one address still read");
  assert.equal((await price("", "x")).status, 429, "control: a caller with no Origin (a script) keeps its 3,000");
  // its time (30 s) is over, and this address is past even the app's day: the kept price, not "Try again tomorrow"
  t += 60_000;
  missesToday = 40_001;
  const before = calls;
  const kept = await price();
  assert.equal(kept.status, 200);
  assert.equal(await kept.text(), '{"near":{"usd":2}}');
  assert.equal(kept.headers.get("cache-control"), "no-store", "a stale answer is never kept at the edge");
  assert.equal(calls, before, "nothing asked upstream");
  assert.equal((await price("https://a.example", "never-kept")).status, 429, "control: nothing kept, the cap still answers");
  // the source failing: the kept price too
  missesToday = 1;
  up = false;
  assert.equal((await price()).status, 200, "CoinGecko failing: the kept price");
  t += 16 * 60_000;
  assert.equal((await price()).status, 502, "control: kept longer than 15 min ago, the failure is said");
});
