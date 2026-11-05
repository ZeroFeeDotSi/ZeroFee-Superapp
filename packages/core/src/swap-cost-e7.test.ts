// Swap directions (5 Nov): the Safe's NEAR → the Safe's USDC (E7, swap-corridor.ts route "safe") was listed in Home's
// Swap but its price was refused here ("from and to are two places", said under the amount as the sheet's own line).
// It is now priced as it runs: the Add into the NEAR wallet's confidential USDC, then home to the Safe. Each failure path
// has its control. Nothing is signed or moved: dry quotes to stand-ins only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_USDC } from "./float-moves.ts";
import { STAND_IN } from "./site-add-cost.ts";
import { swapCost } from "./swap-cost.ts";

const WNEAR = "nep141:wrap.near";
const PRICES: Record<string, { usd: number; decimals: number }> = { [WNEAR]: { usd: 4, decimals: 24 } };
const price = async (t: string) => PRICES[t] ?? null;

/** 1Click, dry: NEAR in costs 0.2 % and $0.05; USDC home costs nothing. `fail`: what the n-th quote does instead. */
function relay(fail?: { at: number; how: "down" | "refused" | "short" }, delayMs = 0) {
  const asked: Record<string, any>[] = [];
  return {
    asked,
    r: {
      quote: async (b: Record<string, any>) => {
        asked.push(b);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (fail && asked.length === fail.at) {
          if (fail.how === "down") throw new Error("fetch failed");
          if (fail.how === "refused") throw { refused: true };
          return { quote: { amountIn: "1", amountOut: "1" } };   // a price for another amount than asked
        }
        if (b.originAsset === WNEAR) {
          const inUsd = (Number(BigInt(b.amount) / 10n ** 18n) / 1e6) * 4;
          return { quote: { amountIn: b.amount, amountOut: String(Math.floor((inUsd * 0.998 - 0.05) * 1e6)) } };
        }
        return { quote: { amountIn: b.amount, amountOut: b.amount } };
      },
    } as never,
  };
}
const deps = (r: { r: never }) => ({ relay: r.r, tokenPrice: price, now: () => 0 });

test("the Safe's NEAR → the Safe's USDC, $10: priced from E7's two legs (NEAR into the NEAR wallet's confidential USDC, then home), stand-ins only (control: before the fix this pair was refused with nothing asked)", async () => {
  const q = relay();
  const c = await swapCost(deps(q), { from: "safe-near", to: "safe-usdc", usd: "10.00" });
  assert.ok(c.arrivesUsd > 9.9 && c.arrivesUsd < 9.95 && c.feeUsd > 0.05 && c.feeUsd < 0.1, JSON.stringify(c));
  assert.equal(q.asked.length, 2, "two legs, two dry quotes");
  assert.ok(q.asked.every((b) => b.dry === true), "dry: nothing moves");
  assert.deepEqual(q.asked.map((b) => [b.originAsset, b.depositType, b.destinationAsset, b.recipientType]), [[WNEAR, "ORIGIN_CHAIN", FLOAT_USDC, "CONFIDENTIAL_INTENTS"], [FLOAT_USDC, "CONFIDENTIAL_INTENTS", FLOAT_USDC, "INTENTS"]], "through NEAR Confidential, then home");
  assert.deepEqual(q.asked.map((b) => b.recipient), [STAND_IN.near, STAND_IN.near], "never the person's own addresses");
});

test("still refused, nothing asked: the Safe's USDC → the Safe's NEAR (no route lands NEAR in the Safe), the same place twice (control: the Safe's NEAR → USDC is asked)", async () => {
  const q = relay();
  for (const [from, to] of [["safe-usdc", "safe-near"], ["safe-near", "safe-near"], ["safe-usdc", "safe-usdc"]]) {
    await assert.rejects(swapCost(deps(q), { from, to, usd: "10.00" }), (e: any) => e.problem?.code === "security.request.invalid", `${from} → ${to}`);
  }
  assert.equal(q.asked.length, 0, "nothing asked");
  assert.ok((await swapCost(deps(q), { from: "safe-near", to: "safe-usdc", usd: "10.00" })).arrivesUsd > 0, "control");
});

test("dead node: 1Click unreachable on either leg says 1Click by name and gives no half price (control: the same pair with 1Click up is priced)", async () => {
  for (const at of [1, 2]) {
    const q = relay({ at, how: "down" });
    await assert.rejects(swapCost(deps(q), { from: "safe-near", to: "safe-usdc", usd: "10.00" }), (e: any) => e.problem?.code === "security.partner.unreachable" && /NEAR Intents/.test(JSON.stringify(e.problem)), `leg ${at}`);
  }
  assert.ok((await swapCost(deps(relay()), { from: "safe-near", to: "safe-usdc", usd: "10.00" })).arrivesUsd > 0, "control");
});

test("refund path: 1Click refuses the quote → 'Nothing moved.', never a price; a price for another amount is refused too (control: the asked amount is priced)", async () => {
  await assert.rejects(swapCost(deps(relay({ at: 1, how: "refused" })), { from: "safe-near", to: "safe-usdc", usd: "10.00" }), (e: any) => /Nothing moved/.test(e.problem?.more ?? e.problem?.whatHappened ?? ""));
  await assert.rejects(swapCost(deps(relay({ at: 1, how: "short" })), { from: "safe-near", to: "safe-usdc", usd: "10.00" }), (e: any) => /Nothing moved/.test(e.problem?.more ?? e.problem?.whatHappened ?? ""));
  assert.ok((await swapCost(deps(relay()), { from: "safe-near", to: "safe-usdc", usd: "10.00" })).feeUsd >= 0, "control");
});

test("no NEAR price read (price service down): 1Click named, never a guessed price (control: with the price it is priced)", async () => {
  await assert.rejects(swapCost({ relay: relay().r, tokenPrice: async () => null, now: () => 0 }, { from: "safe-near", to: "safe-usdc", usd: "10.00" }), (e: any) => e.problem?.code === "security.partner.unreachable");
  assert.ok((await swapCost(deps(relay()), { from: "safe-near", to: "safe-usdc", usd: "10.00" })).arrivesUsd > 0, "control");
});

test("timing (mock 1Click at 120 ms a quote): the price is on the sheet in under 400 ms, the two legs asked one after the other (control: from the NEAR wallet's cash it is one quote)", async () => {
  const q = relay(undefined, 120);
  const t0 = performance.now();
  await swapCost(deps(q), { from: "safe-near", to: "safe-usdc", usd: "10.00" });
  const ms = performance.now() - t0;
  console.log(`E7 price, mock 1Click 120 ms/quote: ${ms.toFixed(0)} ms`);
  assert.ok(ms >= 230 && ms < 400, `${ms} ms`);
  const n = relay(undefined, 120);
  await swapCost(deps(n), { from: "near", to: "safe-usdc", usd: "10.00" });
  assert.equal(n.asked.length, 1, "control: the NEAR wallet's cash needs no first leg");
});
