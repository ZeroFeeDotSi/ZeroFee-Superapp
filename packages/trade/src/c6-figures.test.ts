// Sim test, MUST 1 (c): the Sell button said "$12.43" and the receipt and Activity "$12.42": the booking read the
// market's price a second time, and the button left the network fee in. One flow, one price (the quote's), one figure
// (what comes back, trade-usd.ts tradeUsd), one rounding (core cents.ts). No network, no wall clock: the clock moves only when the service waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { cents, flowCents } from "@zerofee/core/cents";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, type TradeRecord } from "./service.ts";
import { createDemoEngine, resetSampleWallets } from "./demo-engine.ts";
import { boughtLineOf } from "./bought-line.ts";
import { tradeUsd } from "./trade-usd.ts";
import { usd } from "./app/format.ts";

async function run(marketUsd: number) {
  resetSampleWallets();
  const clock = { t: 1_700_000_000_000 };
  const owner = "C6figuresSampleOwner11111111111111111111111";
  // the quote's price: the Sim's $101.75; the market read beside it: `marketUsd` (the crawl's SOL wallet said $95.19)
  const engine = createDemoEngine({ chain: "sol", owner, nativeUsd: async () => 101.75, meta: async () => ({ symbol: "BONK", decimals: 5, priceUsd: 0.0000247 }), now: () => clock.t, moved: async () => 2_000_000_000n });
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => marketUsd, meta: async () => ({ symbol: "BONK", priceUsd: 0.0000247 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const settle = async (r: TradeRecord) => { for (let i = 0; i < 400 && !r.costs; i++) { clock.t += 50; await new Promise((x) => setImmediate(x)); } return r; };
  const buy = await settle(await svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 25 })));
  const sq = await svc.quote("sell", "sol", "BONKmint", { fraction: 0.5 });
  const sold = await settle(await svc.trade(sq));
  return { buy, sq, sold };
}

test("c6 MUST 1 (c): Sell's button, its receipt and Activity say one cent figure, at the quote's own price; Buy's $25 receipt is $25.00 (control: the one rule rounds half up, never a float's ...4999 a cent off)", async () => {
  const { buy, sq, sold } = await run(95.19);
  assert.ok(sold.costs, "the fill was booked");
  const button = usd(tradeUsd({ kind: "sell", amountUsd: sq.quote.getUsd, quote: sq.quote }));
  const receipt = usd(tradeUsd(sold));
  assert.equal(receipt, button, "Sell's button and its receipt");
  assert.match(boughtLineOf(sold), new RegExp(`for (about )?\\${button.replace(".", "\\.")}`), "Activity's line says the button's figure");
  assert.equal(usd(cents(buy.amountUsd)), "$25.00", "Buy $25 lands as $25.00");
  // control: the rule itself
  assert.equal(cents(6.859999999), 6.86);
  assert.equal(cents(1.005), 1.01, "a float's 1.00499999 is still a cent up");
  assert.equal(flowCents("6.85", 6.8599), "6.85", "the typed figure is the flow's");
  assert.equal(flowCents(null, 6.8599), "6.86");
});
