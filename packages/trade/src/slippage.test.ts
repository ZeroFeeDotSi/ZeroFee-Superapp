// Slippage: what the market data alone may widen (audit NF-15), and what Trade's own measurements still may.
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoSlippageBps, MARKET_WIDEN_MAX_BPS, MAX_SLIPPAGE_BPS, MEASURED_MARGIN_BPS, MoveSamples, volatileSlippageBps, WATCHED_MS } from "./slippage.ts";
import * as S from "./slippage.ts";

const deep = () => autoSlippageBps({ liquidityUsd: 10_000_000, tradeUsd: 100 });

test("NF-15: market data from the relay alone can't widen a deep pool's slippage to the 20 % ceiling", () => {
  const honest = volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000 });
  const lied = volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000, change24hPct: 400, moveBps: 800 });
  assert.equal(honest, 150);
  assert.ok(lied <= 500, `the same $10M pool, with change24hPct 400 and moveBps60s 800 in the market answer: ${lied} bps floor`);
  assert.equal(lied, MARKET_WIDEN_MAX_BPS);
});

// Audit finding 2 (4 Nov): Trade's own quotes over the last 90 s widened the floor freely, to the 19 % ceiling: anyone who
// moved a thin pool for 90 s widened the next buyer's floor, then sandwiched it. Those moves may now narrow the floor, never
// widen it past the pool-size default.
test("finding 2: Trade's own recent quotes never widen the floor past the pool-size default; re-quotes widen as before", () => {
  assert.equal(volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000, ownMoveBps: 300 }), 150, "a deep pool keeps its 1.5 %");
  assert.equal(volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000, ownMoveBps: 2_000 }), 150, "a pool moved 20 % for 90 s: still 1.5 %, not 19 %");
  assert.equal(volatileSlippageBps({ baseBps: 800, liquidityUsd: 20_000, ownMoveBps: 2_000 }), 800, "a thin pool keeps its tier");
  assert.equal(volatileSlippageBps({ baseBps: 1500, liquidityUsd: 10_000, watched: true, impactPct: 0.4, ownMoveBps: 40 }), 300 + MEASURED_MARGIN_BPS, "they still narrow it");
  assert.equal(MAX_SLIPPAGE_BPS, 1_900, "under 20 %: a session trade's minimum stays at least 80 % of what it gets");
  assert.equal(volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000, change24hPct: 40 }), 200, "a 40 % day: 200 bps, under the cap");
  assert.equal(volatileSlippageBps({ baseBps: deep(), liquidityUsd: 10_000_000, moveBps: 800, widen: 1.5 }), 600);
});

// Audit MKT-2: Auto slippage came from the market data's liquidity figure and its tiers, neither of them measured.
test("MKT-2: a pool listed thinner than its own impact shows is priced by the impact; with no figure, as before", () => {
  // MONEYBIZ: listed at $1, a $2.50 buy moves it 0.08 %: a pool of about $6k, not one the trade is 250,000 % of
  assert.equal(autoSlippageBps({ liquidityUsd: 1, tradeUsd: 2.5 }), MAX_SLIPPAGE_BPS, "the listed figure alone");
  assert.ok(autoSlippageBps({ liquidityUsd: 1, tradeUsd: 2.5, impactPct: 0.0826 }) < 1600);
  // a real thin pool stays thin: the figure is never lowered, and a deep listing isn't narrowed past its tier
  assert.equal(autoSlippageBps({ liquidityUsd: 10_000_000, tradeUsd: 10, impactPct: 0.0002 }), autoSlippageBps({ liquidityUsd: 10_000_000, tradeUsd: 10 }));
  assert.equal(autoSlippageBps({ tradeUsd: 1, impactPct: 0.0316 }), autoSlippageBps({ tradeUsd: 1 }) + 6, "no figure: unknown depth, as before (306)");
});

test("MKT-2: once Trade has watched the coin, the base is no wider than what it measured (impact, its own moves) and the margin", () => {
  const thin = { baseBps: 1500, liquidityUsd: 10_000 };
  assert.equal(volatileSlippageBps({ ...thin }), 1500, "not watched yet: the tiers, so the first quote fills");
  assert.equal(volatileSlippageBps({ ...thin, watched: true, impactPct: 0.4, ownMoveBps: 40 }), 300 + MEASURED_MARGIN_BPS, "quiet and small: the floor and the margin");
  assert.equal(volatileSlippageBps({ ...thin, watched: true, impactPct: 2, ownMoveBps: 40 }), 500 + MEASURED_MARGIN_BPS, "its own impact (2 % -> 500)");
  assert.equal(volatileSlippageBps({ ...thin, watched: true, ownMoveBps: 800 }), 1500, "a coin moving fast gets its tier's room back, no more (finding 2)");
  assert.equal(volatileSlippageBps({ baseBps: 150, liquidityUsd: 10_000_000, watched: true, ownMoveBps: 0 }), 150, "never wider than the tiers either");
});

test("MKT-2: watched = three of Trade's own quotes spanning 20 s", () => {
  const m = new MoveSamples();
  m.note("X", 0, 1); m.note("X", 10_000, 1.01);
  assert.equal(m.watched("X", 10_000), false);
  m.note("X", WATCHED_MS, 1.02);
  assert.equal(m.watched("X", WATCHED_MS), true);
  assert.equal(m.watched("X", 200_000), false, "samples over 90 s old don't count");
});

test("finding 2: a quote wider than 5 %, or a buy over 15 % impact, needs the person's approval on a sheet (a silent trade doesn't sign it)", () => {
  type Q = { side: "buy" | "sell"; slippageBps: number; priceImpactPct?: number; needsApproval?: string };
  const need = (q: Q): string | undefined => (S as unknown as { approvalNeeded(q: Q): string | undefined }).approvalNeeded(q);
  const k = S as unknown as Record<string, number>;
  assert.equal(k.SILENT_MAX_SLIPPAGE_BPS, 500);
  assert.equal(k.SILENT_MAX_IMPACT_PCT, 15);
  assert.equal(need({ side: "buy", slippageBps: 500, priceImpactPct: 2 }), undefined);
  assert.equal(need({ side: "buy", slippageBps: 1500, priceImpactPct: 2 }), "wide-slippage", "a pool under $15k's 15 %");
  assert.equal(need({ side: "sell", slippageBps: 1900 }), "wide-slippage");
  assert.equal(need({ side: "buy", slippageBps: 300, priceImpactPct: 16 }), "high-impact");
  assert.equal(need({ side: "sell", slippageBps: 300, priceImpactPct: 40 }), undefined, "a sale's impact doesn't stop it; its floor still must be tight");
  assert.equal(need({ side: "buy", slippageBps: 300, priceImpactPct: 1, needsApproval: "unpriced" }), "unpriced", "the route's own reason stands");
});
