// UI's mainnet rehearsal (3 Nov): a $2 SOL → USDC swap promised "at least 1.4 USDC", the core's floor, never what it
// brings. swapCost: what a Home Swap really brings, from 1Click's own dry quotes of its legs; nothing kept, signed or moved,
// and the person's own addresses never told (stand-ins).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAIN_COIN, FLOAT_USDC } from "./float-moves.ts";
import { STAND_IN } from "./site-add-cost.ts";
import { swapCost } from "./swap-cost.ts";

const SOL = CHAIN_COIN.sol.tokenId;
const PRICES: Record<string, { usd: number; decimals: number }> = { [SOL]: { usd: 150, decimals: 9 } };

/** 1Click, dry: a chain's coin in costs 0.2 % and $0.30 of network fees; the same coin home costs nothing; out to a chain 0.2 % and $0.20. */
function relay() {
  const asked: Record<string, any>[] = [];
  return {
    asked,
    r: {
      quote: async (b: Record<string, any>) => {
        asked.push(b);
        const inUsd = b.originAsset === FLOAT_USDC ? Number(b.amount) / 1e6 : (Number(b.amount) / 1e9) * 150;
        if (b.destinationAsset === FLOAT_USDC) {
          const out = b.originAsset === FLOAT_USDC ? inUsd : inUsd * 0.998 - 0.3;
          return { quote: { amountIn: b.amount, amountOut: String(Math.floor(out * 1e6)) } };
        }
        return { quote: { amountIn: b.amount, amountOut: String(Math.floor(((inUsd * 0.998 - 0.2) / 150) * 1e9)) } };
      },
    } as never,
  };
}

test("SOL wallet → Safe USDC, $2: what it really brings ($1.70, not the floor's $1.40) and its fees, from two dry quotes to stand-ins; nothing else asked (control: $100 brings almost all of it)", async () => {
  const q = relay();
  const two = await swapCost({ relay: q.r, tokenPrice: async (t) => PRICES[t] ?? null, now: () => 0 }, { from: "sol", to: "safe-usdc", usd: "2.00" });
  assert.deepEqual(two, { arrivesUsd: 1.7, feeUsd: 0.3 });
  assert.equal(q.asked.length, 2, "two legs, two dry quotes");
  assert.ok(q.asked.every((b) => b.dry === true), "dry: nothing moves");
  assert.deepEqual(q.asked.map((b) => b.recipient), [STAND_IN.near, STAND_IN.near], "never the person's own addresses");
  assert.deepEqual(q.asked.map((b) => [b.originAsset, b.depositType, b.destinationAsset, b.recipientType]), [[SOL, "ORIGIN_CHAIN", FLOAT_USDC, "CONFIDENTIAL_INTENTS"], [FLOAT_USDC, "CONFIDENTIAL_INTENTS", FLOAT_USDC, "INTENTS"]]);
  const hundred = await swapCost({ relay: relay().r, tokenPrice: async (t) => PRICES[t] ?? null, now: () => 0 }, { from: "sol", to: "safe-usdc", usd: "100.00" });
  assert.ok(hundred.feeUsd / 100 < 0.01, `control: a bigger swap's fees are a small share: ${JSON.stringify(hundred)}`);
});

test("Safe USDC → SOL wallet: two legs, the second to Solana's stand-in; the NEAR wallet's own cash needs no first leg", async () => {
  const q = relay();
  const c = await swapCost({ relay: q.r, tokenPrice: async (t) => PRICES[t] ?? null, now: () => 0 }, { from: "safe-usdc", to: "sol", usd: "10.00" });
  assert.ok(c.arrivesUsd > 9.7 && c.arrivesUsd < 9.8 && c.feeUsd > 0.2 && c.feeUsd < 0.3, JSON.stringify(c));
  assert.equal(q.asked.at(-1)!.recipient, STAND_IN.sol);
  const n = relay();
  await swapCost({ relay: n.r, tokenPrice: async (t) => PRICES[t] ?? null, now: () => 0 }, { from: "near", to: "sol", usd: "10.00" });
  assert.equal(n.asked.length, 1);
});

test("refused before anything is asked: another app, an unknown place, the same place twice, under $2 (control: Home's Swap is asked)", async () => {
  const q = relay();
  const d = { relay: q.r, tokenPrice: async (t: string) => PRICES[t] ?? null, now: () => 0 };
  await assert.rejects(swapCost(d, { from: "sol", to: "safe-usdc", usd: "2.00", app: "trade" }), (e: any) => e.problem?.code === "security.request.not-allowed");
  for (const [from, to, usd] of [["sol", "moon", "2.00"], ["sol", "sol", "2.00"], ["safe-usdc", "safe-near", "2.00"], ["sol", "safe-usdc", "1.99"], ["sol", "safe-usdc", 2]]) {
    await assert.rejects(swapCost(d, { from, to, usd }), (e: any) => e.problem?.code === "security.request.invalid", `${from} ${to} ${usd}`);
  }
  assert.equal(q.asked.length, 0, "nothing asked");
  assert.ok((await swapCost(d, { from: "sol", to: "safe-usdc", usd: "2.00", app: "wallet" })).arrivesUsd > 0, "control");
});
