// RECHECK (fix review, e72eddd) of EVM-6. Every EVM buy now keeps ONE later sale's gas (f167429). Variant: the wallet
// already holds another coin (bought earlier, its sale's gas kept then); a second near-all buy of a different coin keeps
// one sale's gas in all, so of the two coins only one can be sold. On BNB Chain the one balance's gas top-up can't reach
// the wallet (BNB float moves are closed until its dust test). Asserts gasguard's rule (every held coin's sale kept);
// FAILS if the second buy spends into the first coin's sale gas.
// (Trade, 28 Oct: the engine now refuses an unpriced buy (RT-2a), so the engine gets the coin's market data, TORCH_META; and
// the other coin held is told to it as the service does, prepare's othersHeld: the engine alone can't see the wallet's coins.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEvmEngine } from "../../evm/engine.ts";
import { makeWorld, TEST_OWNER, TORCH, kyberCapture, TORCH_META } from "../../evm/testing/world.ts";
import { maxBuy } from "../../evm/gasguard.ts";

const ky = kyberCapture(JSON.parse(readFileSync(new URL("../../evm/fixtures/evm-golden.json", import.meta.url), "utf8")));
const PRICE = 2345.57;
const OTHER = "0x1111111111111111111111111111111111111111";

// Trade's note (the fix, 28 Oct): gasguard's maxBuy also adds the chain's margin (2.5 x on Robinhood) and one more trade's
// slack, so the bar above failed with no other coin held as well: the engine's one-coin rule is EVM-6's (f167429), which
// leaves 25,580,136,171,592 wei here where gasguard keeps 108,498,168,000,000. What RT-4 asks is the second coin's sale on
// top of that: a buy with another coin held leaves at least one more sale's gas (approve + swap, as the engine assumes
// it) than the same buy with none. Max is the buy whose size is exact, so it compares them; a dollar buy is checked to
// the $0.01 step it is sized in.
test("RT-4 (EVM-6 variant): a buy while another coin is held keeps that coin's sale gas too", async () => {
  const { APPROVE_GAS_ASSUMED, ASSUMED_SELL_GAS, ceilMul } = await import("../../evm/context.ts");
  const { parseTx } = await import("../../evm/tx.ts");
  const left = async (othersHeld: number, spec: "max" | "near-all") => {
    const x = makeWorld({ ky, chain: "hood" });
    const engine = createEvmEngine({ chain: "hood", owner: TEST_OWNER, nativeUsd: async () => PRICE, meta: async () => TORCH_META as never, rpc: x.rpc, fetch: x.fetch, now: () => 1_800_000_000_000 });
    const opts = othersHeld ? { othersHeld } : undefined;
    let p: any;
    if (spec === "max") p = await engine.prepare("buy", TORCH, { max: true }, opts);
    else {
      const balanceUsd = (Number(x.world.balance) / 1e18) * PRICE;
      for (let cut = 0.01; cut < 2; cut += 0.01) { p = await engine.prepare("buy", TORCH, { usd: balanceUsd - cut }, opts).catch((e) => e); if (!(p instanceof Error)) break; }
      assert.ok(!(p instanceof Error), "some near-all buy is accepted");
    }
    const t = parseTx(p.steps.at(-1)!.tx);
    return { left: x.world.balance - BigInt(p.quote.payRaw), sale: ceilMul((APPROVE_GAS_ASSUMED + ASSUMED_SELL_GAS) * t.maxFeePerGas, 3n, 2n), step: BigInt(Math.ceil((0.01 / PRICE) * 1e18)) };
  };
  const [m0, m1] = [await left(0, "max"), await left(1, "max")];
  assert.ok(m1.left - m0.left >= m1.sale, `Max with another coin held leaves ${m1.left - m0.left} wei more than with none; one sale is ${m1.sale}`);
  const [d0, d1] = [await left(0, "near-all"), await left(1, "near-all")];
  assert.ok(d1.left - d0.left + d1.step >= d1.sale, `a near-all $ buy with another coin held leaves ${d1.left - d0.left} wei more than with none; one sale is ${d1.sale}`);
});
