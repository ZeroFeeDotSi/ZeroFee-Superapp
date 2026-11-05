// The market's fast paths (Fork B, 3 Nov): the New list, the list's batch prices, painting from the device first,
// prefetch, logos that never flash, and the ticks the screens flash from. No network: replayed answers and a moved clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "./index.ts";
import { createPaint, PREFETCH_EVERY_MS, SEEN_FRESH_MS, STALE_SHOW_MS, staleFor } from "./paint.ts";
import { createLogoCache, LOGO_MISS_MS, LOGO_PARALLEL, LOGO_WAIT_MS } from "./logo-cache.ts";
import { createTicks, TICK_MS, tickKey } from "./ticks.ts";
import { fx, replay } from "./testing.ts";
import type { Market } from "./types.ts";

const DOPE = "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump";
const BIRB = "G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG";
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
const tokenPrice = (prices: Record<string, string>) => ({ data: { attributes: { token_prices: prices } } });

test("New: a chain's fresh launches, newest first, each with when its pool was made; asked once in 30 s", async () => {
  const r = replay([["networks/solana/new_pools", fx("new-pools-sol")]]);
  const m = createMarket({ fetch: r.fetch, now: r.now, storage: null });
  const rows = await m.fresh!("sol");
  assert.ok(rows.length > 0 && rows.length <= 20);
  assert.ok(rows.every((x) => typeof x.createdAt === "number" && x.chain === "sol"));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1]!.createdAt! >= rows[i]!.createdAt!, "newest first");
  // control: the spam filter and the money pools are applied as on trending (the raw answer has 20 pools)
  assert.ok(rows.length < fx("new-pools-sol").data.length, "some pools are not coins to show (a money pool, spam)");
  r.clock.t += 20_000;
  await m.fresh!("sol");
  assert.equal(r.count("new_pools"), 1, "cached 30 s");
  r.clock.t += 15_000;
  await m.fresh!("sol");
  assert.equal(r.count("new_pools"), 2, "control: asked again after 30 s");
});

test("prices: up to 30 coins of a chain in one call; a price 100x off the market's own is left out (control: a sane one is kept)", async () => {
  const r = replay([
    ["networks/solana/trending_pools", fx("trending-solana")],
    ["token_price", tokenPrice({ [DOPE]: "0.0034", [BIRB]: "79" })], // BIRB trades near $0.0795: 1,000x off (7.9, 99x, would still pass)
  ]);
  const m = createMarket({ fetch: r.fetch, now: r.now, storage: null });
  await m.trending("sol");
  const p = await m.prices!("sol", [DOPE, BIRB, DOPE, "not an address"]);
  assert.equal(r.count("token_price"), 1, "one call");
  assert.ok(r.calls.find((c) => c.url.includes("token_price"))!.url.endsWith(`${DOPE},${BIRB}`), "each coin once, nothing invalid asked");
  assert.deepEqual(p, { [DOPE]: 0.0034 });
  assert.deepEqual(await m.prices!("sol", []), {}, "nothing asked for, no call");
  assert.equal(r.count("token_price"), 1);
});

/** A market with counted calls (paint's own tests need no GeckoTerminal). */
function fakeMarket(over: Partial<Market> = {}) {
  const calls: string[] = [];
  const m = {
    trending: async (c?: string) => (calls.push(`trending:${c ?? "all"}`), [{ chain: "sol", address: DOPE, symbol: "DOPE", name: "Doge Pepe", priceUsd: 0.0033 }]),
    search: async (q: string) => (calls.push(`search:${q}`), []),
    fresh: async () => (calls.push("fresh"), []),
    coin: async (c: string, a: string) => (calls.push(`coin:${a}`), { chain: c, address: a, symbol: "DOPE", name: "Doge Pepe", decimals: 6, priceUsd: 0.0033 }),
    candles: async (_c: string, a: string, r: string, o?: { warm?: boolean }) => (calls.push(`candles:${a}:${r}${o?.warm ? ":warm" : ""}`), [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }]),
    prices: async (_c: string, addrs: readonly string[]) => (calls.push(`prices:${addrs.length}`), { [DOPE]: 0.0036 }),
    ...over,
  } as unknown as Market;
  return { m, calls };
}

test("paint: the last list is on the device and drawn in the first frame after a reload (control: none before the first answer)", async () => {
  const storage = mem();
  const clock = { t: 1_000_000 };
  const { m } = fakeMarket();
  const a = createPaint(m, { now: () => clock.t, storage });
  assert.equal(a.list({ kind: "trending", chain: "sol" }), undefined, "control: nothing yet");
  await a.loadList({ kind: "trending", chain: "sol" });
  clock.t += 90_000;
  const b = createPaint(m, { now: () => clock.t, storage }); // the page reloaded
  const p = b.list({ kind: "trending", chain: "sol" });
  assert.equal(p?.v[0]?.symbol, "DOPE");
  assert.equal(staleFor(p!.at, clock.t), 90_000, "said as 1 min old");
  assert.equal(staleFor(clock.t - STALE_SHOW_MS + 1, clock.t), null, "under a minute: just now");
  assert.equal(b.list({ kind: "trending", chain: "hood" }), undefined, "another tab's list is its own");
});

test("paint: an answer served from GeckoTerminal's old copy (asOf) isn't kept as new", async () => {
  const storage = mem();
  const { m } = fakeMarket({ trending: async () => Object.assign([{ chain: "sol", address: DOPE, symbol: "OLD", name: "x" }], { asOf: 5 }) as never });
  const p = createPaint(m, { now: () => 1e6, storage });
  await p.loadList({ kind: "trending", chain: "all" });
  assert.equal(p.list({ kind: "trending", chain: "all" }), undefined);
});

test("paint: ?demo's recorded market never writes to the device (control: the live market does)", async () => {
  for (const recorded of [true, false]) {
    const storage = mem();
    const { m } = fakeMarket({ recorded } as never);
    const p = createPaint(m, { now: () => 1e6, storage });
    await p.loadList({ kind: "trending", chain: "sol" });
    await p.loadCoin("sol", DOPE);
    assert.equal(storage.m.size > 0, !recorded, recorded ? "sample data stays in memory" : "control: kept on the device");
    assert.ok(p.list({ kind: "trending", chain: "sol" }), "painted either way in this page");
  }
});

test("prefetch: a pressed row asks for its page and its first chart once in 15 s; the page then paints them at once", async () => {
  const clock = { t: 1e6 };
  const { m, calls } = fakeMarket();
  const p = createPaint(m, { now: () => clock.t, storage: null });
  p.prefetch({ chain: "sol", address: DOPE });
  p.prefetch({ chain: "sol", address: DOPE });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [`coin:${DOPE}`, `candles:${DOPE}:1D`]);
  assert.equal(p.coin("sol", DOPE)?.v.symbol, "DOPE", "the page's details are there before it opens");
  assert.equal(p.chart("sol", DOPE, "1D")?.v.length, 1);
  clock.t += PREFETCH_EVERY_MS;
  p.prefetch({ chain: "sol", address: DOPE });
  assert.equal(calls.length, 4, "control: asked again after 15 s");
});

test("product decision, 4 Nov (charts instant): a row on screen warms only its first chart, in the background lane, once a minute; a press still asks for everything", async () => {
  const clock = { t: 1e6 };
  const { m, calls } = fakeMarket();
  const p = createPaint(m, { now: () => clock.t, storage: null });
  p.prefetch({ chain: "sol", address: DOPE }, { seen: true });
  p.prefetch({ chain: "sol", address: DOPE }, { seen: true });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [`candles:${DOPE}:1D:warm`]);
  assert.equal(p.chart("sol", DOPE, "1D")?.v.length, 1, "the page opens on a drawn chart");
  p.prefetch({ chain: "sol", address: DOPE });
  assert.deepEqual(calls.slice(1), [`coin:${DOPE}`, `candles:${DOPE}:1D`], "control: a press asks for the page and the chart");
  clock.t += SEEN_FRESH_MS;
  p.prefetch({ chain: "sol", address: DOPE }, { seen: true });
  assert.equal(calls.length, 4, "a minute on: warmed again");
});

test("an open coin page warms its other ranges in the background, skipping any the device has fresh", async () => {
  const clock = { t: 1e6 };
  const { m, calls } = fakeMarket();
  const p = createPaint(m, { now: () => clock.t, storage: null });
  await p.loadChart("sol", DOPE, "1D");
  p.warmRanges("sol", DOPE, ["1H", "1D", "1W", "1M", "1Y", "ALL"]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [`candles:${DOPE}:1D`, ...["1H", "1W", "1M", "1Y", "ALL"].map((r) => `candles:${DOPE}:${r}:warm`)]);
  for (const r of ["1H", "1W", "1M", "1Y", "ALL"] as const) assert.ok(p.chart("sol", DOPE, r), `${r} draws at once`);
  const { m: rec, calls: none } = fakeMarket({ recorded: true } as never);
  createPaint(rec, { now: () => 1, storage: null }).warmRanges("sol", DOPE, ["1W"]);
  assert.deepEqual(none, [], "control: recorded prices (?demo) never warm");
});

test("prefetch never throws when the market fails", async () => {
  const { m } = fakeMarket({ coin: async () => { throw new Error("down"); }, candles: async () => { throw new Error("down"); } });
  const p = createPaint(m, { now: () => 1, storage: null });
  p.prefetch({ chain: "sol", address: DOPE });
  await new Promise((r) => setImmediate(r));
  assert.equal(p.coin("sol", DOPE), undefined);
});

test("livePrices: one call per chain; a row with a new price gets it, the others keep theirs; a failed read changes nothing", async () => {
  const { m, calls } = fakeMarket();
  const p = createPaint(m, { now: () => 1, storage: null });
  const rows = [{ chain: "sol" as const, address: DOPE, symbol: "DOPE", name: "", priceUsd: 0.0033 }, { chain: "sol" as const, address: BIRB, symbol: "BIRB", name: "", priceUsd: 0.08 }, { chain: "hood" as const, address: "0x" + "1".repeat(40), symbol: "H", name: "", priceUsd: 1 }];
  const got = await p.livePrices(rows);
  assert.deepEqual(calls, ["prices:2", "prices:1"]);
  assert.deepEqual(got.map((r) => r.priceUsd), [0.0036, 0.08, 1]);
  const { m: down } = fakeMarket({ prices: async () => { throw new Error("busy"); } });
  assert.deepEqual((await createPaint(down, { now: () => 1, storage: null }).livePrices(rows)).map((r) => r.priceUsd), [0.0033, 0.08, 1]);
});

test("ticks: no flash for a first price or the same price; up, then down; gone after 2.4 s", () => {
  const clock = { t: 0 };
  const timers: { f: () => void; at: number }[] = [];
  const t = createTicks({ now: () => clock.t, setTimer: (f, ms) => { const x = { f, at: clock.t + ms }; timers.push(x); return x; }, clearTimer: (x) => { const i = timers.indexOf(x as never); if (i >= 0) timers.splice(i, 1); } });
  const k = tickKey("hood", "0xABC");
  assert.equal(k, "hood:0xabc", "an EVM address in any case is one coin");
  let told = 0;
  t.subscribe(k, () => told++);
  t.note(k, 1);
  assert.equal(t.get(k), null, "a first price is no move");
  t.note(k, 1.00001);
  assert.equal(t.get(k), null, "a hundredth of a percent is rounding, not a move");
  t.note(k, 1.1);
  assert.equal(t.get(k), "up");
  t.note(k, 1.05);
  assert.equal(t.get(k), "down");
  assert.equal(timers.length, 1, "one timer per coin");
  clock.t += TICK_MS;
  timers.shift()!.f();
  assert.equal(t.get(k), null);
  assert.equal(told, 3, "told on each start and at the end");
  t.note(k, Number.NaN); t.note(k, -1); t.note(k, undefined);
  assert.equal(t.get(k), null, "nothing that isn't a price moves it");
});

test("logos: decoded once and remembered on the device; a miss draws the monogram at once for 6 hours, then is tried again (control: a hit stays)", async () => {
  const storage = mem();
  const clock = { t: 1e9 };
  const loads: string[] = [];
  const load = async (u: string) => (loads.push(u), u.includes("good"));
  const a = createLogoCache({ load, now: () => clock.t, storage, timeout: () => new Promise(() => {}) });
  assert.equal(a.state("https://r/good"), undefined);
  await a.preload(["https://r/good", "https://r/bad", "https://r/good", undefined, "data:image/png;base64,x"]);
  assert.deepEqual(loads, ["https://r/good", "https://r/bad"], "each https url once; a data: picture needs no load");
  assert.equal(a.state("https://r/good"), "ok");
  assert.equal(a.state("https://r/bad"), "none");
  await new Promise((r) => setTimeout(r, 550)); // kept to the device (it writes at most every half second)
  const b = createLogoCache({ load, now: () => clock.t, storage, timeout: () => new Promise(() => {}) }); // reloaded
  assert.equal(b.state("https://r/bad"), "none", "the monogram from the first frame, no broken image");
  clock.t += LOGO_MISS_MS;
  const c = createLogoCache({ load, now: () => clock.t, storage, timeout: () => new Promise(() => {}) });
  assert.equal(c.state("https://r/bad"), undefined, "a miss is tried again after 6 hours");
  assert.equal(c.state("https://r/good"), "ok", "control: a hit is kept");
});

test("logos: at most 6 at once; a slow one is none for now and not remembered", async () => {
  let running = 0, most = 0;
  const gates: (() => void)[] = [];
  const load = (u: string) => new Promise<boolean>((res) => { running++; most = Math.max(most, running); gates.push(() => { running--; res(!u.includes("slow")); }); });
  let fire: () => void = () => {};
  const slow = new Promise<void>((r) => (fire = r));
  const lc = createLogoCache({ load, storage: null, timeout: (ms) => (assert.equal(ms, LOGO_WAIT_MS), slow) });
  const urls = Array.from({ length: 10 }, (_, i) => `https://r/${i}`).concat("https://r/slow");
  const done = lc.preload(urls);
  await new Promise((r) => setImmediate(r));
  assert.equal(most, LOGO_PARALLEL);
  assert.equal(lc.state("https://r/0"), "loading");
  fire(); // every load still running counts as slow now
  await done;
  assert.equal(lc.state("https://r/slow"), undefined, "not remembered: tried again on the next paint");
  for (const g of gates.splice(0)) g();
});
