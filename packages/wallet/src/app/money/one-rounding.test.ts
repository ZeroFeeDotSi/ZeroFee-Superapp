import { test } from "node:test";
import assert from "node:assert/strict";
import { swapCost } from "@zerofee/core/swap-cost";
import { sentUsd } from "../activity-rows.ts";

// the audit's S5 + S6 (7 Nov): one rounding rule. Swap's two figures were each rounded on their own (at a half cent "about
// $4.85" + "about $0.16" = $5.01 of a $5.00 swap); Activity's Send figure rounded half up while the Face ID sheet rounds
// down (a 4.995 payout: $5.00 in Activity, $4.99 on the sheet). Swap: the fee is the rest of the figure; Send: cents down.
const relay = (out: number) => ({ quote: async (b: Record<string, unknown>) => ({ quote: { amountIn: b.amount, amountOut: String(out) } }) }) as never;

test("the audit's S5: Swap's arrives + fee always add up to the figure: the fee is the figure less what arrives, in cents", async () => {
  const half = await swapCost({ relay: relay(4_845_000), now: () => 0 }, { from: "near", to: "safe-usdc", usd: "5.00" });
  assert.deepEqual(half, { arrivesUsd: 4.85, feeUsd: 0.15 }, "4.845 arrives: $4.85 and $0.15, never $4.85 + $0.16");
  assert.equal(Math.round((half.arrivesUsd + half.feeUsd) * 100) / 100, 5);
  for (const out of [4_835_000, 4_875_000, 4_885_000, 4_999_999, 4_000_001]) {
    const c = await swapCost({ relay: relay(out), now: () => 0 }, { from: "near", to: "safe-usdc", usd: "5.00" });
    assert.equal(Math.round((c.arrivesUsd + c.feeUsd) * 100) / 100, 5, `${out}: the two figures are the $5.00`);
    assert.ok(Math.abs(c.arrivesUsd - out / 1e6) <= 0.005 + 1e-9, "what arrives, to the cent");
  }
});

test("the audit's S6: Activity's Send figure rounds down like the Face ID sheet, for any coin (control: a dollar coin as before)", () => {
  const tokens = new Map([["nep141:wrap.near", { symbol: "NEAR", decimals: 24, priceUsd: "4.995" }], ["usdc", { symbol: "USDC", decimals: 6, priceUsd: "1" }]]) as never;
  assert.equal(sentUsd({ id: "a", kind: "send", status: "done", from: "near", amount: "1" } as never, tokens), "$4.99", "4.995 of NEAR: $4.99, the sheet's figure");
  assert.equal(sentUsd({ id: "b", kind: "send", status: "done", from: "usdc", amount: "4.995" } as never, tokens), "$4.99", "control: USDC, cents down");
  assert.equal(sentUsd({ id: "c", kind: "send", status: "done", from: "near", amount: "0.001" } as never, tokens), undefined, "under a cent: no figure");
});
