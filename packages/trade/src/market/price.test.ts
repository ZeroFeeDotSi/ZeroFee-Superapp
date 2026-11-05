// The price a trading session's caps are set in: two sources that agree, or none (Security review, item 4).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GtClient } from "./gt.ts";
import { createCheckedPrice, createCorePrice, createNativePrices, createSizingPrice, NATIVE_SPOT_POOLS, ONECLICK_TOKENS_URL, PricesDisagree, SIZING_AGE_MS, SIZING_KEEP_MS, WRAPPED_NATIVE } from "./price.ts";
import { MarketError } from "./gt.ts";

const cg = (sol: number | undefined, ok = true) => (async () => new Response(JSON.stringify(sol === undefined ? {} : { solana: { usd: sol } }), { status: ok ? 200 : 429 })) as unknown as typeof fetch;
const gt = (sol: number | Error): GtClient => ({ get: async () => { if (sol instanceof Error) throw sol; return { data: { attributes: { token_prices: { [WRAPPED_NATIVE.sol]: String(sol) } } } }; } }) as unknown as GtClient;

test("two sources within 3 %: the higher of the two (so the caps in SOL are the smaller)", async () => {
  assert.equal(await createCheckedPrice({ fetch: cg(100), gt: gt(102) })("sol"), 102);
  assert.equal(await createCheckedPrice({ fetch: cg(103), gt: gt(100) })("sol"), 103);
});

test("a price 10x off, or one source alone, sets no session", async () => {
  await assert.rejects(createCheckedPrice({ fetch: cg(10), gt: gt(100) })("sol"), /disagree/);
  await assert.rejects(createCheckedPrice({ fetch: cg(100), gt: gt(104) })("sol"), /disagree/, "just past 3 %");
  await assert.rejects(createCheckedPrice({ fetch: cg(100, false), gt: gt(100) })("sol"));
  await assert.rejects(createCheckedPrice({ fetch: cg(undefined), gt: gt(100) })("sol"));
  await assert.rejects(createCheckedPrice({ fetch: cg(100), gt: gt(new Error("GeckoTerminal is rate-limiting (429)")) })("sol"));
});

// Audit MKT-1: the price that turned a dollar buy into SOL / BNB / ETH was one source's answer, served up to 10 min old.
test("MKT-1: a dollar buy is sized at the checked price, kept 30 s; two sources that disagree size nothing", async () => {
  const clock = { t: 0 };
  let checks = 0, checked: () => Promise<number> = async () => 102;
  const native = async () => { throw new Error("not asked while the check answers"); };
  const sizing = createSizingPrice({ checked: () => (checks++, checked()), native, spot: async () => 102, now: () => clock.t });
  assert.equal(await sizing("sol"), 102);
  clock.t += SIZING_KEEP_MS - 1;
  assert.equal(await sizing("sol"), 102);
  assert.equal(checks, 1, "kept: a quote waits for it at most once");
  clock.t += 2;
  checked = async () => { throw new PricesDisagree(10, 100); };
  await assert.rejects(sizing("sol"), PricesDisagree, "one of them is wrong: neither is used");
});

test("MKT-1: a source down or rate-limited: the other's answer at most a minute old (checked against the chain), never the 10-minute one", async () => {
  const clock = { t: 0 };
  let cgCalls = 0, cgPrice = 100, cgUp = true;
  const fetch = (async () => { cgCalls++; return cgUp ? new Response(JSON.stringify({ solana: { usd: cgPrice } }), { status: 200 }) : new Response("{}", { status: 429 }); }) as unknown as typeof globalThis.fetch;
  const gtDown: GtClient = { get: async () => { throw new MarketError("rate", "GeckoTerminal is rate-limiting (429)"); } };
  const native = createNativePrices({ fetch, now: () => clock.t, gt: gtDown });
  let chainUsd = 100;
  const sizing = createSizingPrice({ checked: async () => { throw new MarketError("rate", "429"); }, native, spot: async () => chainUsd, now: () => clock.t });
  assert.equal(await sizing("sol"), 100);
  // 5 minutes on, the price moved to 140 and CoinGecko answers: the minute-old rule asks again instead of serving $100
  clock.t += 5 * 60_000; cgPrice = 140;
  assert.equal(await native("sol"), 100, "the display price may still serve the old answer while it refreshes");
  await new Promise((r) => setImmediate(r));
  cgPrice = 150; chainUsd = 149;
  clock.t += SIZING_AGE_MS + 1;
  assert.equal(await sizing("sol"), 150, "sizing never takes an answer older than a minute");
  // and with no source answering at all, nothing is sized
  cgUp = false; clock.t += 20 * 60_000;
  await assert.rejects(sizing("sol"));
  assert.ok(cgCalls >= 3);
});

test("MKT-1 (UI): with one market source down, the other is used only within 5 % of the chain's own price; else nothing is sized", async () => {
  const down = async () => { throw new MarketError("rate", "429"); };
  const sized = (one: number, own: number | undefined) => createSizingPrice({ checked: down, native: async () => one, spot: async () => own, now: () => 0 })("sol");
  assert.equal(await sized(100, 102), 102, "within 5 %: the higher of the two");
  assert.equal(await sized(104, 100), 104);
  await assert.rejects(sized(100, 106), PricesDisagree, "one source 6 % from the chain: one of them is wrong");
  await assert.rejects(sized(1000, 100), PricesDisagree, "a source 10x off");
  await assert.rejects(sized(100, undefined), /no chain price/, "no chain price to check it against: nothing is sized");
  // the pools are the chains' deep native / dollar pools (read against CoinGecko on 28 Oct 2026)
  for (const c of ["sol", "bsc", "hood"] as const) { assert.equal(NATIVE_SPOT_POOLS[c]!.coin.address, WRAPPED_NATIVE[c]); assert.equal(NATIVE_SPOT_POOLS[c]!.quote.kind, "stable"); }
});

// Audit R-2: CoinGecko and GeckoTerminal both came through the one relay, so a relay that forged both agreed with itself
// and sized every trade. A trade is now sized in the core's own price (1Click, asked directly), with a second witness.
test("R-2: a relay that forges both market sources alike doesn't size a trade; the core's own price does, the chain agreeing", async () => {
  const forged = async () => 200;                                     // CoinGecko and GeckoTerminal at 2x, from the one relay
  const sized = (core: number | null, own: number | undefined, checked: () => Promise<number> = forged) =>
    createSizingPrice({ checked, native: async () => 200, spot: async () => own, now: () => 0, core: async () => core })("sol");
  assert.equal(await sized(100, 100.5), 100, "sized in the core's price; the chain is its witness");
  assert.equal(await sized(100, undefined, async () => 101), 100, "the relay agreeing within 3 % is a witness too: the core's price");
  await assert.rejects(sized(100, undefined), PricesDisagree, "the core and the relay disagree, no chain to settle it: nothing is sized");
  await assert.rejects(sized(null, 100), PricesDisagree, "no core price: the relay only as far as the chain agrees");
  assert.equal(await sized(null, 199), 200, "no core price: the relay within 5 % of the chain");
  await assert.rejects(sized(null, undefined), /no chain or core price/, "the relay alone never sizes a trade");
});

test("R-2: the core's price is 1Click's token list asked directly, at most 15 minutes old by its own stamp", async () => {
  const asked: string[] = [];
  const at = (iso: string) => (async (u: string) => { asked.push(String(u)); return new Response(JSON.stringify([{ assetId: "nep141:sol.omft.near", price: 151.5, priceUpdatedAt: iso }]), { status: 200 }); }) as unknown as typeof fetch;
  const t = Date.parse("2026-10-29T00:10:00Z");
  assert.equal(await createCorePrice({ fetch: at("2026-10-29T00:05:00Z"), now: () => t })("sol"), 151.5);
  assert.equal(await createCorePrice({ fetch: at("2026-10-28T23:50:00Z"), now: () => t })("sol"), null, "older than 15 minutes");
  assert.equal(await createCorePrice({ fetch: at("2026-10-29T00:05:00Z"), now: () => t })("bsc"), null, "not in the list");
  assert.ok(asked.every((u) => u === ONECLICK_TOKENS_URL), "never the relay");
});
