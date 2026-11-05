// Independent audit PoCs (network + supply chain, branch audit-network 4c347b9), against apps/quotes/relay.mjs and logo.mjs at 18ad8d6,
// copied as they are (only the import path changed).
// Each NF test FAILS on the audited commit and should pass after the fix; each control passes today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
// @ts-ignore: plain JS
import { APP_ORIGINS, createRelay } from "./relay.mjs";

const CG_KEY = "cg-owner-paid-key-0123456789";

/** Upstreams: every logo source says "none"; CoinGecko answers 404 for a token's info and 200 for simple/price. */
function upstream() {
  const cgCalls: string[] = [];
  const fetchFn = async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    if (url.startsWith("https://pro-api.coingecko.com/") || url.startsWith("https://api.coingecko.com/")) {
      if (h.get("x-cg-pro-api-key") === CG_KEY || h.get("x-cg-demo-api-key") === CG_KEY) cgCalls.push(url);
      return url.includes("/simple/price") ? new Response("{}", { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchFn, cgCalls };
}

const bscAddr = () => `0x${randomBytes(20).toString("hex")}`;

test("NF-07: the logo route spends the operator's CoinGecko key inside the same budget as the market routes", async () => {
  const u = upstream();
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: u.fetchFn, market: { gt: { key: CG_KEY }, cg: { key: CG_KEY }, dailyCalls: 1 } });
  // The day's budget (here 1 call) is spent by one market read; the next market read is refused.
  assert.equal((await relay(new Request("https://q.example/v0/market/cg/simple/price?ids=solana&vs_currencies=usd"), "203.0.113.1")).status, 200);
  assert.equal((await relay(new Request("https://q.example/v0/market/cg/simple/price?ids=bitcoin&vs_currencies=usd"), "203.0.113.1")).status, 503);
  const spentBefore = u.cgCalls.length;
  // Fresh addresses never hit a cache (relay or CDN); no Origin header is needed.
  for (let i = 0; i < 25; i++) await relay(new Request(`https://q.example/v0/market/logo?c=bsc&a=${bscAddr()}`), `198.51.100.${i}`);
  const overBudget = u.cgCalls.length - spentBefore;
  assert.equal(overBudget, 0, `25 logo requests made ${overBudget} keyed CoinGecko calls after the day's budget was spent`);
});

test("control NF-07: market reads past the budget make no CoinGecko call", async () => {
  const u = upstream();
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn: u.fetchFn, market: { cg: { key: CG_KEY }, dailyCalls: 1 } });
  for (let i = 0; i < 10; i++) await relay(new Request(`https://q.example/v0/market/cg/simple/price?ids=c${i}&vs_currencies=usd`), "203.0.113.1");
  assert.equal(u.cgCalls.length, 1);
});

/** The smallest well-formed legacy transaction: one (garbage) signature, one key, a blockhash, no instructions. */
function junkTx(): string {
  return Buffer.concat([Buffer.from([1]), randomBytes(64), Buffer.from([1, 0, 0, 1]), randomBytes(32), randomBytes(32), Buffer.from([0])]).toString("base64");
}

test("NF-08: /v0/sol/send has a relay-wide cap, so many addresses can't spend the Helius key without limit", async () => {
  let heliusCalls = 0;
  const fetchFn = async (url: string) => {
    if (url.startsWith("https://mainnet.helius-rpc.com/")) heliusCalls++;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32003, message: "Transaction signature verification failure" } }));
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, helius: "helius-key-0000", fetchFn });
  const statuses = new Map<number, number>();
  // 100 addresses (a small botnet or one IPv6 /64), 10 sends each in the same minute, no Origin header (a script, not the app).
  for (let ip = 0; ip < 100; ip++) {
    for (let i = 0; i < 10; i++) {
      const r = await relay(new Request("https://q.example/v0/sol/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: junkTx() }) }), `2001:db8::${ip.toString(16)}`);
      statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    }
  }
  assert.ok(heliusCalls <= 300, `one minute: ${heliusCalls} Helius sendTransaction calls for junk-signed transactions (answers: ${JSON.stringify([...statuses])})`);
});
