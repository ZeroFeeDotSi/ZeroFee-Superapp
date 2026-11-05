// RECHECK (fix review, e72eddd) of EVM-4. The fix (evm/aggregator.ts:80-89, 168-171) measures the route's impact at
// "our own price" (the coin's market price, meta.priceUsd) and refuses past 20 %; "you get" is never above it. Variants:
// (a) the same 90 % theft on a coin with no market price yet (a coin pasted minutes after launch): nothing independent is
// left, so the route sets the quote, "you get" and the floor again; (b) a route that keeps 18 % (inside the 20 % band).
// Each asserts the correct behaviour; a failure means the theft still goes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEvmEngine } from "../../evm/engine.ts";
import { makeWorld, TEST_OWNER, TORCH, TORCH_META, kyberCapture, type World } from "../../evm/testing/world.ts";

const ky = kyberCapture(JSON.parse(readFileSync(new URL("../../evm/fixtures/evm-golden.json", import.meta.url), "utf8")));
const PRICE = 2345.57;
function setup(w: Partial<World>, meta?: object) {
  const x = makeWorld({ ky, chain: "hood", ...w });
  return createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => PRICE, ...(meta ? { meta: async () => meta as never } : {}), rpc: x.rpc, fetch: x.fetch, now: () => 1_800_000_000_000 });
}

test("RT-2a (EVM-4 variant): with no market price for the coin, a route that keeps 90 % is refused or its quote says so", async () => {
  const fair = await setup({}, TORCH_META).prepare("buy", TORCH, { usd: 5 });   // (Trade: the control has a market price: with none and no pool, RT-2a's fix refuses every buy)
  const robbed = await setup({ outScale: 10 }).prepare("buy", TORCH, { usd: 5 }).catch((e) => e);
  if (robbed instanceof Error) return;
  assert.ok(robbed.quote.getUsd < 1, `no market price: the sheet says you get about $${robbed.quote.getUsd.toFixed(2)} for $5; the floor is ${robbed.quote.getMinRaw} raw against a fair ${fair.quote.getRaw}`);
});

test("RT-2b (EVM-4 variant): a route that keeps 18 % (inside the 20 % band) at least says so on the quote", async () => {
  const fair = await setup({}, TORCH_META).prepare("buy", TORCH, { usd: 5 });   // (Trade: the control has a market price: with none and no pool, RT-2a's fix refuses every buy)
  const coinUsd = 5 / (Number(fair.quote.getRaw) / 1e18);
  const r = await setup({ outScale: 82 }, { priceUsd: coinUsd, liquidityUsd: 500_000 }).prepare("buy", TORCH, { usd: 5 }).catch((e) => e);
  if (r instanceof Error) return;
  assert.ok(r.quote.getUsd <= 5 * 0.83, `an 18 % theft shows "you get about $${r.quote.getUsd.toFixed(2)}"`);
});
