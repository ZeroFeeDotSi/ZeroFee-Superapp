// Phone test, 5 Nov ("GeckoTerminal is busy since …"): the relay's check pinged only the keyless public GeckoTerminal
// from Vercel's shared addresses, which 429s on its own, and said "busy" while the paid door the app reads through
// answered. Now market data is said by the doors the app uses: up when either answers, down only when every door
// failed, never busy or slow. Each case has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, PAID_MARKET_FRESH_MS, createRelay, marketSays } from "./relay.mjs";

const GT_KEY = "gt-key-SECRET-0987654321";
const isPaid = (u: string) => u.startsWith("https://pro-api.coingecko.com/") || u.startsWith("https://api.coingecko.com/");
const isPublic = (u: string) => u.startsWith("https://api.geckoterminal.com/");

function setup(o: { paid?: (u: string) => Response | Promise<Response>; pub?: () => Response | Promise<Response>; key?: boolean; now?: () => number }) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (isPaid(url)) return o.paid ? o.paid(url) : new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (isPublic(url)) return o.pub ? o.pub() : new Response("{}", { status: 200 });
    if (url.includes("fastnear") || url.includes("near.drpc")) return new Response(JSON.stringify({ result: { sync_info: { latest_block_time: new Date((o.now ?? (() => 1_000_000))()).toISOString() } } }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const relay = createRelay({ key: "partner-key-SECRET-1234567890", secret: "s", origins: [...APP_ORIGINS], market: o.key === false ? {} : { gt: { key: GT_KEY }, cg: { key: "cg-key-SECRET-1" } }, fetchFn, now: o.now ?? (() => 1_000_000) });
  const health = async () => {
    const r = await relay(new Request("https://quotes.example/v0/health"), "203.0.113.7");
    const text = await r.text();
    return { services: JSON.parse(text).services as Record<string, string>, text };
  };
  const read = (path: string) => relay(new Request(`https://quotes.example${path}`, { headers: { origin: "zerofee-app://app" } }), "203.0.113.9");
  return { sent, health, read };
}

const dead = () => { throw new TypeError("fetch failed"); };

test("the bug: the public door 429s from Vercel's address while the paid door answers: up, never busy (control: both fail is down)", async () => {
  const bug = setup({ pub: () => new Response("{}", { status: 429 }) });
  const h = await bug.health();
  assert.equal(h.services.gecko, "up");
  assert.ok(bug.sent.some((s) => isPaid(s.url) && new Headers(s.init.headers).get("x-cg-pro-api-key") === GT_KEY), "the paid door is pinged, with its key in a header");
  assert.ok(!bug.sent.some((s) => s.url.includes(GT_KEY)), "the key is never in a URL");
  assert.ok(!h.text.includes(GT_KEY), "the key is never in the answer");
  const control = setup({ paid: dead, pub: () => new Response("{}", { status: 429 }) });
  assert.equal((await control.health()).services.gecko, "down");
});

test("a dead or slow paid door that the public door covers says nothing (control: the public door dead too is down)", async () => {
  for (const paid of [dead, () => { throw new DOMException("timed out", "TimeoutError"); }, () => new Response("{}", { status: 429 }), () => new Response("{}", { status: 503 })]) {
    assert.equal((await setup({ paid }).health()).services.gecko, "up");
    assert.equal((await setup({ paid, pub: dead }).health()).services.gecko, "down");
  }
});

test("a refused key (401/403) is the paid door failing, not up (control: a 200 is up)", async () => {
  assert.equal((await setup({ paid: () => new Response("{}", { status: 403 }), pub: dead }).health()).services.gecko, "down");
  assert.equal((await setup({ paid: () => new Response("{}", { status: 200 }), pub: dead }).health()).services.gecko, "up");
});

test("a real market read stands for the paid ping for 5 min: no extra CoinGecko call; after that it is pinged again", async () => {
  let t = 1_000_000;
  let paidStatus = 429;
  const s = setup({ paid: (u) => new Response(JSON.stringify({ data: [] }), { status: u.includes("/onchain/networks?page=1") ? 200 : paidStatus }), pub: dead, now: () => t });
  await (await s.read("/v0/market/gt/networks/solana/trending_pools?page=1")).text();
  const before = s.sent.filter((x) => isPaid(x.url)).length;
  assert.equal((await s.health()).services.gecko, "down", "the paid door's own last answer (a 429) with the public door dead: down");
  assert.equal(s.sent.filter((x) => isPaid(x.url)).length, before, "no ping: the read's answer stood for it");
  // control: past the fresh time (and past the check's minute) the paid door is pinged again, and it answers
  t += PAID_MARKET_FRESH_MS + 61_000;
  await s.health();
  await new Promise((r) => setImmediate(r));
  assert.equal((await s.health()).services.gecko, "up");
  assert.ok(s.sent.filter((x) => isPaid(x.url)).length > before, "pinged once the read was old");
});

test("no key on this relay: the public door's 429 or slowness from a shared address says nothing; only down is down", async () => {
  assert.equal((await setup({ key: false, pub: () => new Response("{}", { status: 429 }) }).health()).services.gecko, "up");
  assert.equal((await setup({ key: false, pub: () => new Response("{}", { status: 503 }) }).health()).services.gecko, "down");
});

test("marketSays never says busy or slow", () => {
  const states = [undefined, "up", "busy", "slow", "down"];
  for (const a of states) for (const b of states.slice(1)) assert.ok(["up", "down"].includes(marketSays(a, b)), `${a}+${b}`);
});
