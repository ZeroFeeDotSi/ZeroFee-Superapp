// The test web sale on Robinhood Chain (3 Nov): "It sets a network fee limit far above what its test run used. Nothing
// was signed." A sale's swap carried KyberSwap's gas figure x2 (or a pool's x1.6, at least 250,000), and the core refuses
// any limit over twice its own test run's use, or that use + 100,000 when more (review M6, subwallets.ts signEvm). The
// limit now comes from the sale's own test run (fitGas), so it always sits inside that bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fitGas, gasUsedOf } from "./aggregator.ts";
import { directSwapGas } from "./direct.ts";
import { createEvmEngine } from "./engine.ts";
import { makeWorld, TEST_OWNER, TORCH, kyberCapture, TORCH_META } from "./testing/world.ts";
import { parseTx } from "./tx.ts";

/** The core's bound (review M6), as subwallets.ts signEvm has it. */
const coreBound = (used: bigint) => (used * 2n > used + 100_000n ? used * 2n : used + 100_000n);

test("fitGas: 40 % over what the test run used, at least 60,000 over, always inside the core's bound", () => {
  for (const used of [21_000n, 60_000n, 100_000n, 150_000n, 196_608n, 400_000n, 1_200_000n, 5_000_000n]) {
    const g = fitGas(used);
    assert.ok(g >= (used * 13n) / 10n, `${used}: room for a block that costs a little more`);
    assert.ok(g <= coreBound(used), `${used}: ${g} inside the core's bound ${coreBound(used)}`);
  }
  assert.equal(fitGas(196_608n), 275_252n);
  assert.equal(fitGas(100_000n), 160_000n, "the flat 60,000 when 40 % is less");
  // control: the old sale sizing (KyberSwap's figure x2, at least 250,000) was outside the bound for a light swap
  assert.ok(250_000n > coreBound(120_000n), "the old floor alone broke the bound for a 120,000 swap");
});

test("gasUsedOf: only a run that went through and said its use", () => {
  assert.equal(gasUsedOf({ status: "0x1", gasUsed: "0x30000" }), 196_608n);
  assert.equal(gasUsedOf({ status: "0x0", gasUsed: "0x30000" }), undefined, "a reverted run sizes nothing");
  assert.equal(gasUsedOf({ status: "0x1" }), undefined);
  assert.equal(gasUsedOf(undefined), undefined);
});

test("a Robinhood Chain sale's swap is sized from its own test run, inside the core's bound (control: the run's use is what sizes it)", async () => {
  const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));
  for (const used of [0x30000n, 0x60000n]) {
    const x = makeWorld({ ky, tokenBal: 10n ** 18n, simulate: (calls) => calls.map(() => ({ status: "0x1", gasUsed: "0x" + used.toString(16), returnData: "0x" + "00".repeat(31) + "01", logs: [] })) });
    const engine = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => 2345.57, meta: async () => TORCH_META as never, rpc: x.rpc, fetch: x.fetch, now: () => 1_800_000_000_000 });
    const p = await engine.prepare("sell", TORCH, { fraction: 1 });
    const swap = parseTx(p.steps.at(-1)!.tx);
    assert.ok(swap.gas <= coreBound(used), `${swap.gas} inside the core's bound for a run that used ${used}`);
    assert.ok(swap.gas >= used, `${swap.gas} covers the run's ${used}`);
  }
});

test("phone test, 5 Nov: a direct Robinhood sale with its approvals in place is sized from the node's estimate, never the v4 quoter's figure (the old limit, 941,713 for a 180,000 swap, was past the core's bound)", () => {
  // TORCH, sell half (fixtures/evm-golden.json): the node's estimate 0x2bf20 = 180,000; Uniswap v4's quoter 0x8c3ba = 574,394,
  // which Trade's quote pads by 150,000 (direct.ts quote())
  const est = 180_000n, quoter = 574_394n + 150_000n;
  // the old sizing: max(estimate, quoter's figure) + 30 %
  const old = (quoter * 13n + 9n) / 10n > (est * 13n + 9n) / 10n ? (quoter * 13n + 9n) / 10n : (est * 13n + 9n) / 10n;
  assert.equal(old, 941_713n, "the limit the old code set");
  assert.ok(old > coreBound(est), "control: the old limit is refused by the core's bound, even at the estimate's own use");
  const now = directSwapGas(est, quoter);
  assert.equal(now, fitGas(est));
  assert.equal(now, 252_000n);
  // inside the bound for any run that uses at least 70 % of the estimate (a node's estimate is at or above its use)
  for (const used of [126_000n, 150_000n, 180_000n]) assert.ok(now <= coreBound(used), `${now} inside the bound for ${used} used`);
  assert.ok(now >= est, "covers the estimate");
  // control: no estimate is the pool's figure x1.6, at least 250,000, until the trade's own run sizes it (buildDirect)
  assert.equal(directSwapGas(undefined, 100_000n), 250_000n);
  assert.equal(directSwapGas(undefined, quoter), 1_159_031n);
});

/** The old direct sizing: the estimate + 30 %, never under the pool's padded figure + 30 %. */
const oldSizing = (est: bigint, quoter: bigint) => { const g = (est * 13n + 9n) / 10n, f = (quoter * 13n + 9n) / 10n; return f > g ? f : g; };

test("rule 3, 5 Nov: a direct BUY on each route is sized from the node's estimate, inside the core's bound, whatever the pool's quoted figure (control: the old floor at the v4 quoter's padded figure is past the bound)", () => {
  // [route, an estimate fixtures/evm-golden.json answered for it, the pool's padded figure the old engine floored at
  // (its signed limit / 1.3)]; the golden test (golden.test.ts) checks the built buys carry exactly fitGas of an answered estimate
  const routes: [string, bigint, bigint][] = [
    ["Uniswap v4, TORCH $5", 573_367n, 614_210n],
    ["Uniswap v3, PRIORS $5", 208_002n, 223_565n],
    ["PancakeSwap v3, AKE $5", 151_754n, 189_525n],
    ["PancakeSwap v2, TART $5", 168_660n, 0n],
  ];
  for (const [route, est, floor] of routes) {
    const now = directSwapGas(est, floor);
    assert.equal(now, fitGas(est), `${route}: the estimate sizes it, never the pool's figure`);
    assert.ok(now <= coreBound(est), `${route}: ${now} inside the core's bound for ${est}`);
    assert.ok(now >= (est * 13n) / 10n, `${route}: room over the estimate`);
  }
  // control: a v4 buy whose node estimate is 180,000 beside the v4 quoter's figure (574,394 + Trade's 150,000), as on the
  // sale: the old floor put it at 941,713, past the bound (refused); now 252,000, inside it
  assert.equal(oldSizing(180_000n, 724_394n), 941_713n);
  assert.ok(oldSizing(180_000n, 724_394n) > coreBound(180_000n));
  assert.equal(directSwapGas(180_000n, 724_394n), 252_000n);
});
