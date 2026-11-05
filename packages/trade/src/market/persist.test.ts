// GeckoTerminal's limit is per IP and doesn't restart with the page, and its 429 has no CORS header, so a browser sees a
// failed fetch. What a person who opens Discover again a minute later must get: the last list, marked with its time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { BLOCK_MS, createGt } from "./gt.ts";
import { fx, replay } from "./testing.ts";

const memoryStorage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size }; };
const blocked = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;

test("a fetch the browser blocked (GeckoTerminal's 429 without CORS headers) backs off, longer each time", async () => {
  const r = replay([]);
  let calls = 0;
  const f = (async () => { calls++; throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  const gt = createGt({ fetch: f, now: r.now, storage: null });
  await assert.rejects(gt.get("a", 1000), (e: any) => e.code === "rate");
  assert.equal(gt.room(), 0, "nobody asks while it waits");
  await assert.rejects(gt.get("b", 1000));
  assert.equal(calls, 1, "the second ask didn't reach the network");
  r.clock.t += BLOCK_MS + 1;
  await assert.rejects(gt.get("c", 1000));
  assert.equal(calls, 2);
  r.clock.t += BLOCK_MS + 1;
  assert.equal(gt.room(), 0, "the second time in a row it waits twice as long");
  r.clock.t += BLOCK_MS;
  assert.ok(gt.room() > 0);
});

test("opening Discover again after the limit: the last trending list, from the device, marked with its time", async () => {
  const storage = memoryStorage();
  const r = replay([["trending_pools", fx("trending-solana")]]);
  const first = createMarket({ fetch: r.fetch, now: r.now, storage });
  const rows = await first.trending("sol");
  assert.ok(rows.length > 5);
  assert.equal(rows.asOf, undefined, "a fresh list has no 'as of'");
  // the page is opened again 70 minutes later, and GeckoTerminal is refusing this IP
  r.clock.t += 70 * 60_000;
  const again = createMarket({ fetch: blocked, now: r.now, storage });
  const shown = await again.trending("sol");
  assert.deepEqual(shown.map((x) => x.address), rows.map((x) => x.address));
  assert.equal(shown.asOf, r.clock.t - 70 * 60_000, "marked with the time the list is from");
});

test("a kept answer dated in the future is never fresh (it would be fresh forever): it's asked again", async () => {
  const storage = memoryStorage();
  let calls = 0;
  const ok = (async () => { calls++; return new Response(JSON.stringify({ data: { n: calls } }), { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
  const t = 1_800_000_000_000;
  const first = createGt({ fetch: ok, now: () => t, storage });
  await first.get("simple/networks/solana/token_price/x", 30_000);
  assert.equal(calls, 1);
  // the same device an hour "earlier" (its clock set back, or an entry written ahead): the kept answer is in its future
  const back = createGt({ fetch: ok, now: () => t - 3_600_000, storage });
  await back.get("simple/networks/solana/token_price/x", 30_000);
  assert.equal(calls, 2, "fetched again, not served from the future-dated entry");
});

test("the call budget survives a reload: a page opened again can't spend what the last one already spent", async () => {
  const storage = memoryStorage();
  const r = replay([["", {}]]);
  const a = createGt({ fetch: r.fetch, now: r.now, storage, budget: { calls: 5, perMs: 60_000 } });
  for (const p of ["1", "2", "3", "4"]) await a.get(p, 0);
  const b = createGt({ fetch: r.fetch, now: r.now, storage, budget: { calls: 5, perMs: 60_000 } });
  assert.equal(b.room(), 1, "four of five calls in this minute were already made");
  r.clock.t += 61_000;
  assert.equal(b.room(), 5);
});

test("a full or blocked storage never breaks the market: it just lives in memory", async () => {
  const r = replay([["trending_pools", fx("trending-solana")]]);
  const broken = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => {} };
  const m = createMarket({ fetch: r.fetch, now: r.now, storage: broken });
  assert.ok((await m.trending("sol")).length > 5);
});

test("no burst: at most 6 calls in any 10 s, however many rows ask at once", async () => {
  const r = replay([["", {}]]);
  const gt = createGt({ fetch: r.fetch, now: r.now, storage: null });
  const asks = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => gt.get(`p${i}`, 0)));
  assert.equal(r.calls.length, 6);
  assert.equal(asks.filter((a) => a.status === "rejected").length, 6, "the rest wait for the next window (or get the last answer)");
  r.clock.t += 10_001;
  assert.equal(gt.room(), 6);
});
