// RECHECK (fix review, e72eddd) of MKT-1. Buys are now sized by market.sizingUsd (market/price.ts createSizingPrice:
// CoinGecko and GeckoTerminal within 3 %, at most a minute old; or one source within 5 % of a deep pool read on chain).
// (1) The original PoC re-aimed at sizingUsd (what runtime.ts hands the engines) — expected to pass.
// (2) Variant: the EVM engine memoises that price (evm/context.ts:182 priceFor, PRICE_TTL_MS 30 s + PRICE_SWR_MS 10 min,
//     stale-while-revalidate), so a BNB / Robinhood dollar buy is sized at an answer up to 10.5 minutes old, and keeps
//     being sized at it while sizingUsd refuses (the sources disagree). Asserts the correct behaviour; FAILS today.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarket } from "../../market/index.ts";
import { replay } from "../../market/testing.ts";
import { createSizingPrice, PricesDisagree } from "../../market/price.ts";
import { newMemo, priceFor } from "../../evm/context.ts";
import { payOf } from "../../sol/context.ts";

const WSOL = "So11111111111111111111111111111111111111112";
const routes = (cgUsd: number, gtUsd: number): [string, unknown][] => [
  ["api.coingecko.com/api/v3/simple/price", { solana: { usd: cgUsd }, binancecoin: { usd: 600 }, ethereum: { usd: 3000 } }],
  ["simple/networks/solana/token_price", { data: { attributes: { token_prices: { [WSOL]: String(gtUsd) } } } }],
];

test("MKT-1 re-aimed: sources 10x apart: the sizing price refuses; \"Buy $10\" is never sized at the outlier", async () => {
  const r = replay(routes(15, 150));
  const m = createMarket({ fetch: r.fetch, now: r.now, screenWaitMs: 0, storage: null });
  const used = await m.sizingUsd("sol").then((v) => v, () => "refused" as const);
  assert.equal(used, "refused");
});

test("MKT-1 variant: one source down and no chain price: nothing is sized", async () => {
  const s = createSizingPrice({ checked: async () => { throw new Error("CoinGecko 503"); }, native: async () => 15, spot: async () => undefined, now: () => 0 });
  await assert.rejects(s("sol"));
});

test("MKT-1 variant: one source down, the other 10x off the deep pool on chain: refused", async () => {
  const s = createSizingPrice({ checked: async () => { throw new Error("CoinGecko 503"); }, native: async () => 15, spot: async () => 150, now: () => 0 });
  await assert.rejects(s("sol"), (e) => e instanceof PricesDisagree);
  const pay = payOf("buy", { usd: 10 }, { bal: 100n * 10n ** 9n, held: 0n, solUsd: await s("sol").catch(() => 150), rentNew: 0n, wsolRent: 0n, symbol: "X" });
  assert.ok((Number(pay) / 1e9) * 150 <= 10.3);
});

test("RT-3 (MKT-1 variant): an EVM dollar buy is never sized at a price older than a minute, nor one the sizing price now refuses", async () => {
  let t = 0, answer: () => Promise<number> = async () => 100;
  const c = { now: () => t, m: newMemo(), chain: "bsc", d: { nativeUsd: () => answer() } } as never;
  assert.equal(await priceFor(c), 100);
  t += 9 * 60_000;                                        // nine minutes later BNB is $130, or the sources now disagree
  answer = async () => { throw new PricesDisagree(130, 100); };
  const v = await priceFor(c).then((x) => x, () => "refused" as const);
  assert.equal(v, "refused", `a 9-minute-old $${String(v)} still sizes the buy while the sizing price refuses`);
});
