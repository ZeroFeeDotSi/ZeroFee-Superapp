// QA's laps (5 Nov): Swap's Safe NEAR → Safe USDC refused at its price twice ("1Click said no.
// Nothing moved."), the same day as the Send to a NEAR account. 1Click's own answer, read with dry quotes: no quote takes
// a coin in from the NEAR chain itself or pays one out there. Said by NEAR Intents' name, where the money is, what to tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAIN_COIN, FLOAT_USDC } from "./float-moves.ts";
import { swapCost } from "./swap-cost.ts";
import { nearWalletRefused, safeSwapRefused, nearChainCoin, touchesNearChain, upstreamRefused } from "./near-chain-refused.ts";

const SOL = CHAIN_COIN.sol.tokenId;
const WNEAR = "nep141:wrap.near";
const PRICES: Record<string, { usd: number; decimals: number }> = { [SOL]: { usd: 150, decimals: 9 }, [WNEAR]: { usd: 4, decimals: 24 } };
/** As demo-core's relay client throws the relay's 400. */
const upstream = () => Object.assign(new Error("1Click didn't take that request."), { refused: true, code: "quotes.upstream.refused" });
/** 1Click as read on 5 Nov: a leg in from NEAR's own chain refused; everything else quoted. */
function relay(refuseNear = true) {
  return {
    quote: async (b: Record<string, any>) => {
      if (refuseNear && touchesNearChain(b)) throw upstream();
      return { quote: { amountIn: b.amount, amountOut: b.destinationAsset === FLOAT_USDC ? "2000000" : "13000000" } };
    },
  } as never;
}
const cost = (r: never, from: string, to: string) => swapCost({ relay: r, tokenPrice: async (t) => PRICES[t] ?? null, now: () => 0 }, { from, to, usd: "2.10" });

test("the NEAR chain's own coins: wNEAR and NEAR's USDC are, coins NEAR Intents carries for other chains are not", () => {
  assert.ok(nearChainCoin(WNEAR) && nearChainCoin(FLOAT_USDC));
  assert.ok(!nearChainCoin(SOL) && !nearChainCoin("nep141:hood.omft.near") && !nearChainCoin("nep245:v2_1.omni.hot.tg:56_11111111111111111111"));
  assert.ok(touchesNearChain({ depositType: "ORIGIN_CHAIN", originAsset: WNEAR }), "in from NEAR's chain");
  assert.ok(touchesNearChain({ recipientType: "DESTINATION_CHAIN", destinationAsset: WNEAR }), "out to a NEAR account");
  assert.ok(!touchesNearChain({ depositType: "ORIGIN_CHAIN", originAsset: SOL, recipientType: "CONFIDENTIAL_INTENTS", destinationAsset: FLOAT_USDC }), "control: in from Solana");
  assert.ok(!touchesNearChain({ depositType: "CONFIDENTIAL_INTENTS", originAsset: FLOAT_USDC, recipientType: "INTENTS", destinationAsset: FLOAT_USDC }), "control: inside NEAR Intents");
  assert.ok(upstreamRefused(upstream()) && !upstreamRefused(new Error("x")) && !upstreamRefused(null));
});

// The Safe's NEAR leg in (wNEAR from NEAR's chain) is the one leg every Safe NEAR swap starts with: → Safe USDC (main's
// new direction) and → a wallet's coin alike; here through the one both this branch and main price.
test("Swap from the Safe's NEAR refused at its price is NEAR Intents', by name, the Safe named, a next tap; never \"1Click said no\" (controls: SOL wallet → Safe USDC still priced; another refusal keeps its line)", async () => {
  await assert.rejects(cost(relay(), "safe-near", "sol"), (e: any) => e.problem.code === "security.subwallet.refused" && e.problem.more === safeSwapRefused(2.1));
  assert.equal(safeSwapRefused(2.1), "NEAR Intents said no to this swap, so nothing moved. The $2.10 is still in your Safe. Try again in a few minutes.");
  assert.equal(nearWalletRefused(20), "NEAR Intents said no to this move, so nothing moved. The $20.00 is still in your NEAR wallet. Try again in a few minutes.");
  assert.ok(safeSwapRefused(99_999.99).length <= 140, "the Swap sheet says a `more` of 140 or fewer");
  assert.doesNotMatch(safeSwapRefused(1) + nearWalletRefused(1), /1Click/);
  assert.deepEqual(await cost(relay(), "sol", "safe-usdc"), { arrivesUsd: 2, feeUsd: 0.1 }, "control: a coin in from Solana quotes");
  const other = { quote: async () => { throw Object.assign(new Error("no"), { refused: true, code: "quotes.request.refused" }); } } as never;
  await assert.rejects(cost(other, "safe-near", "sol"),(e: any) => e.problem.more === "NEAR Intents said no. Nothing moved.", "control: the relay's own refusal keeps its own line");
});
