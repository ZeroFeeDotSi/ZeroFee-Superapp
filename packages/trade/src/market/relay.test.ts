// The market relay: the key's server is asked first, path and query as they are; the public API answers when it can't.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RELAY_BUDGET, RELAY_BURST, createMarket } from "./index.ts";
import { CG_BASE, createRelayFetch, relayBase, relayUrl } from "./relay.ts";
import { GT_BASE } from "./gt.ts";
import { CG_PRICE_URL } from "./price.ts";
import { fx } from "./testing.ts";

const R = "https://zerofee-quotes.vercel.app";
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the market relay", () => {
  it("only an https base (or http on this machine), with no user, query or fragment", () => {
    assert.equal(relayBase(`${R}/`), R);
    assert.equal(relayBase("http://localhost:3000"), "http://localhost:3000");
    for (const bad of [undefined, "", "  ", "http://zerofee-quotes.vercel.app", "ftp://x", "https://u:p@x.app", "https://x.app/?k=1", "https://x.app/#a", "not a url", "javascript:alert(1)"]) assert.equal(relayBase(bad), undefined, String(bad));
  });
  it("GeckoTerminal and CoinGecko URLs move to /v0/market/gt and /v0/market/cg, path and query unchanged; any other URL stays", () => {
    assert.equal(relayUrl(R, `${GT_BASE}/networks/solana/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`), `${R}/v0/market/gt/networks/solana/trending_pools?include=base_token%2Cquote_token%2Cdex&page=1`);
    assert.equal(relayUrl(R, CG_PRICE_URL), `${R}/v0/market/cg/simple/price?ids=solana,binancecoin,ethereum,near&vs_currencies=usd`);
    assert.ok(CG_PRICE_URL.startsWith(`${CG_BASE}/`));
    assert.equal(relayUrl(R, "https://api.mainnet-beta.solana.com"), undefined);
    assert.equal(relayUrl(R, "https://api.geckoterminal.com.evil.app/api/v2/x"), undefined);
  });
  it("the relay's answer is used, a 404 included; unreachable, 5xx, 401, 403 or 429 (the relay's limit or the key's: product decision, 4 Nov, no blockers from us) → the public URL; the market's own timeout isn't asked twice", async () => {
    const asked: string[] = [];
    const reply = new Map<string, () => Response>();
    const f = (async (u: RequestInfo | URL) => { const s = String(u); asked.push(s); const r = [...reply].find(([k]) => s.startsWith(k)); return r ? r[1]() : answer(200, { from: "public" }); }) as typeof fetch;
    const rf = createRelayFetch(R, f);
    const gt = `${GT_BASE}/networks/solana/tokens/x`;
    reply.set(`${R}/`, () => answer(200, { from: "relay" }));
    assert.deepEqual(await (await rf(gt)).json(), { from: "relay" });
    reply.set(`${R}/`, () => answer(404)); assert.equal((await rf(gt)).status, 404, "404 is the market's own answer");
    for (const status of [500, 502, 503, 401, 403, 429]) { asked.length = 0; reply.set(`${R}/`, () => answer(status)); assert.deepEqual(await (await rf(gt)).json(), { from: "public" }, String(status)); assert.deepEqual(asked, [`${R}/v0/market/gt/networks/solana/tokens/x`, gt]); }
    reply.set(`${R}/`, () => { throw new TypeError("Failed to fetch"); });
    assert.deepEqual(await (await rf(gt)).json(), { from: "public" }, "unreachable");
    asked.length = 0;
    reply.set(`${R}/`, () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    await assert.rejects(rf(gt), (e: Error) => e.name === "AbortError");
    assert.equal(asked.length, 1);
    asked.length = 0;
    await rf("https://api.mainnet-beta.solana.com");
    assert.deepEqual(asked, ["https://api.mainnet-beta.solana.com"], "not a market URL: untouched");
  });
  it("a device stays under the relay's app limit per address (200 misses a minute), so our own budget never holds the paid door back", () => {
    assert.ok(RELAY_BUDGET.calls <= 200 && RELAY_BUDGET.perMs === 60_000, "under the relay's app limit per address (MARKET_MISS_APP_MAX)");
    assert.ok(RELAY_BURST.calls * (RELAY_BUDGET.perMs / RELAY_BURST.perMs) >= RELAY_BUDGET.calls, "the 10 s cap doesn't make the minute unreachable");
  });
  it("a market with a relay asks it for lists, coins and native prices; without one (or a bad one) it asks the public API", async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL) => {
      const s = String(u); seen.push(s);
      if (s.includes("/cg/") || s.startsWith(CG_BASE)) return answer(200, fx("cg-simple-price"));
      return answer(200, fx("trending-solana"));
    }) as typeof fetch;
    const m = createMarket({ fetch: f, relay: R, storage: null, now: () => Date.parse("2026-10-26T03:00:00Z") });
    assert.ok((await m.trending("sol")).length > 0);
    assert.equal(await m.nativeUsd("sol"), 101.67);
    assert.ok(seen.length >= 2 && seen.every((u) => u.startsWith(`${R}/v0/market/`)), seen.join(" "));
    for (const relay of [undefined, "http://zerofee-quotes.vercel.app"]) {
      seen.length = 0;
      await createMarket({ fetch: f, relay, storage: null, now: () => Date.parse("2026-10-26T03:00:00Z") }).trending("sol");
      assert.ok(seen.length > 0 && seen.every((u) => u.startsWith(GT_BASE)), `${relay}: ${seen.join(" ")}`);
    }
  });
});
