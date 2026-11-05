// Test (5 Nov, Sell): one sale read "Sell $12.43 of JEANPHIL" on the button, "$12.42" on the receipt
// and "$12.43" in Activity. The receipt took the proceeds less the fee at a price read again after the fill; the button
// and Activity took the coins' part. Now one figure (trade-usd.ts), booked from the same amountOut the button was quoted
// on, at the quote's own price. Controls: the old receipt formula on the same fill gives the other cent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "./service.ts";
import { tradeUsd } from "./trade-usd.ts";
import { tradeCard } from "./app/job-cards.ts";
import { boughtLineOf } from "./bought-line.ts";
import { landedDetail } from "./app/landed-detail.ts";
import { usd } from "./app/format.ts";
import { rawToUsd } from "./slippage.ts";
import type { ChainEngine, Fill, Prepared } from "./types.ts";

// a sale of 2,515 coins for 0.1243 SOL at $100: $12.43, quoted; the fee 20,000 lamports ($0.002)
const GET_RAW = "124300000", FEE_RAW = "20000";
function sale(px: { now: number }) {
  let n = 0;
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const p: Prepared = { key: `k${++n}`, at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "JEANPHIL", decimals: 6, payRaw: "2515000000", payUsd: 12.47, getRaw: GET_RAW, getUsd: 12.43, getMinRaw: "120000000", feeRaw: FEE_RAW, feeUsd: 0.002, route: "pump.fun", slippageBps: 300, expiresAt: 1_700_000_020_000 } };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { return `hash-${atob(tx)}`; },
    async status() { return "confirmed"; },
    // SOL's price moves a little between the quote and the fill (the crawl's case)
    async fill(p, hash): Promise<Fill> { px.now = 99.95; return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: FEE_RAW }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    async transfer() { throw new Error("not here"); },
    poolChanged() {},
  };
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }) as never, "trade");
  const clock = { t: 1_700_000_000_000 };
  return createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => px.now, meta: async () => ({ symbol: "JEANPHIL", priceUsd: 0.005 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; } });
}

test("test: a sale's button, receipt, Activity row, task line and one-line say one figure, to the cent (control: the old receipt's formula gives $12.42)", async () => {
  const px = { now: 100 };
  const svc = sale(px);
  const p = await svc.quote("sell", "sol", "JEANmint", { fraction: 0.5 });
  const button = usd(p.quote.getUsd);
  const rec = await svc.trade(p);
  assert.equal(rec.status, "done");
  assert.equal(button, "$12.43");
  assert.equal(usd(tradeUsd(rec)), button, "the receipt (TradeSheet's done moment)");
  assert.equal(usd(tradeCard(rec).usd!), button, "Activity's row");
  assert.equal(boughtLineOf(rec), `Sold JEANPHIL for ${button}`);
  assert.equal(landedDetail("0.81 s", rec, "Solana"), `Landed in 0.81 s · ${button}`);
  // the fee is its own line, never folded into the figure
  assert.ok(rec.costs && rec.costs.feeUsd > 0);
  // control: the old receipt figure, the proceeds at the moved price less the fee, is the other cent the crawl saw
  const old = rawToUsd(GET_RAW, 9, px.now) - rawToUsd(FEE_RAW, 9, px.now);
  assert.equal(usd(old), "$12.42");
  assert.notEqual(usd(old), button);
});

test("test: the sale's receipt takes the one figure; a buy's keeps every cent out (its extra named on the task)", () => {
  const sheet = readFileSync(new URL("./app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /usd: rec\.costs \? usd\(side === "sell" \? tradeUsd\(rec\) : rec\.amountUsd\) : heroOf\(\)/);
  // control: the old receipt line read the in-all figure for both sides
  assert.doesNotMatch(sheet, /usd: rec\.costs \? usd\(rec\.amountUsd\) : heroOf\(\)/);
  assert.equal(tradeUsd({ kind: "fund", amountUsd: 5, costs: { coinUsd: 4, feeUsd: 1 } }), 5, "control: a move keeps its own figure");
  assert.equal(tradeUsd({ kind: "sell", amountUsd: 12.4 }), 12.4, "control: before the chain's figure is booked, the record's");
});
