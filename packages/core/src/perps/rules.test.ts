// D119 landing 1's review leftover 2: Hyperliquid's tick and lot size, its most leverage and its smallest order are checked
// in the core before the trading key signs (rules.ts, from Hyperliquid's tick-and-lot-size page). Each rule has a control
// that passes, so a check that refused everything would fail here too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryVault } from "../vault.ts";
import { PerpsAgent } from "./agent.ts";
import { checkTrade, leverageRefusal, priceRefusal, roundPrice, roundSize, sizeRefusal, type HlMarket } from "./rules.ts";

const BTC: HlMarket = { name: "BTC", szDecimals: 5, maxLeverage: 40 };
const DOGE: HlMarket = { name: "DOGE", szDecimals: 0, maxLeverage: 10 };
const ONE: HlMarket = { name: "X", szDecimals: 1, maxLeverage: 3 };
const U = [BTC, DOGE, { name: "OLD", szDecimals: 2, maxLeverage: 5, isDelisted: true }];

test("price: the docs' own examples (5 significant figures, at most 6 - szDecimals decimals, integers always)", () => {
  const sz0: HlMarket = { name: "A", szDecimals: 0, maxLeverage: 1 };
  assert.equal(priceRefusal("1234.5", sz0), null, "control: 1234.5 is valid");
  assert.match(priceRefusal("1234.56", sz0)!, /too many digits/);
  assert.equal(priceRefusal("0.001234", sz0), null, "control: 0.001234 is valid");
  assert.match(priceRefusal("0.0012345", sz0)!, /too many/);
  assert.equal(priceRefusal("0.01234", ONE), null, "control: szDecimals 1, 0.01234 is valid");
  assert.match(priceRefusal("0.012345", ONE)!, /too many decimals for X/);
  assert.equal(priceRefusal("123456", sz0), null, "an integer is always allowed");
  assert.match(priceRefusal("12345.6", sz0)!, /too many digits/);
  for (const bad of ["1.50", "-1", "1e3", "", "abc", 5, "0"]) assert.ok(priceRefusal(bad, sz0), `not a wire price: ${String(bad)}`);
});

test("size: rounded to szDecimals (control: exactly szDecimals passes)", () => {
  assert.equal(sizeRefusal("1.001", { ...BTC, szDecimals: 3 }), null);
  assert.match(sizeRefusal("1.0001", { ...BTC, szDecimals: 3 })!, /too exact.*0\.001/);
  assert.match(sizeRefusal("1.5", DOGE)!, /smallest step is 1\b/);
  assert.equal(sizeRefusal("12", DOGE), null);
});

test("leverage: a whole number from 1 to the market's own maxLeverage", () => {
  assert.equal(leverageRefusal(40, BTC), null, "control: the most is allowed");
  assert.match(leverageRefusal(41, BTC)!, /BTC goes up to 40× on Hyperliquid/);
  for (const bad of [0, 2.5, -1, "5", NaN]) assert.ok(leverageRefusal(bad, BTC), String(bad));
});

test("rounding: prices as Hyperliquid takes them, sizes rounded down (never more than asked)", () => {
  assert.equal(roundPrice(63_123.456, BTC), "63123");
  assert.equal(roundPrice(1.234567, { ...BTC, szDecimals: 2 }), "1.2346");
  assert.equal(roundPrice(0.123456789, DOGE), "0.12346");
  assert.equal(roundPrice(100, DOGE), "100", "an integer keeps its zeros");
  assert.equal(roundSize(0.0041666, BTC), "0.00416");
  assert.equal(roundSize(12.9, DOGE), "12");
  assert.equal(roundSize(0.4, DOGE), "0");
  for (const x of [63_123.456, 1.234567, 0.123456789, 99_999.5]) assert.equal(priceRefusal(roundPrice(x, BTC), BTC), null, `round trips: ${x}`);
});

const order = (o: Record<string, unknown>) => ({ type: "order", orders: [{ a: 0, b: true, p: "60000", s: "0.001", r: false, t: { limit: { tif: "Gtc" } }, ...o }], grouping: "na" });
const why = (f: () => void) => { try { f(); return null; } catch (e: any) { return e.problem?.whatHappened as string; } };

test("checkTrade: each rule refuses with its own words; the control order passes", () => {
  assert.equal(why(() => checkTrade(order({}), U)), null, "control: $60 of BTC at a good price");
  assert.match(why(() => checkTrade(order({ p: "60000.5" }), U))!, /too many digits/);
  assert.match(why(() => checkTrade(order({ s: "0.000001" }), U))!, /too exact/);
  assert.match(why(() => checkTrade(order({ s: "0.0001" }), U))!, /smallest trade is \$10/);
  assert.equal(why(() => checkTrade(order({ s: "0.0001", r: true }), U)), null, "a reduce-only close of a small trade is Hyperliquid's to judge");
  assert.match(why(() => checkTrade(order({ a: 2 }), U))!, /doesn't list/, "delisted");
  assert.match(why(() => checkTrade(order({ a: 9 }), U))!, /doesn't list/);
  assert.match(why(() => checkTrade(order({ t: { trigger: { isMarket: true, triggerPx: "1.234567", tpsl: "tp" } } }), U))!, /too many/);
  assert.match(why(() => checkTrade(order({ t: { limit: { tif: "Fok" } } }), U))!, /isn't one Hyperliquid takes/);
  assert.match(why(() => checkTrade({ type: "updateLeverage", asset: 0, isCross: true, leverage: 41 }, U))!, /up to 40×/);
  assert.equal(why(() => checkTrade({ type: "updateLeverage", asset: 0, isCross: true, leverage: 40 }, U)), null);
  assert.match(why(() => checkTrade(order({}), undefined))!, /markets couldn't be read/);
  assert.equal(why(() => checkTrade({ type: "cancel", cancels: [{ a: 0, o: 1 }] }, undefined)), null, "a cancel needs no market");
  assert.equal(why(() => checkTrade({ type: "modify", oid: 1, order: order({}).orders[0] }, U)), null);
  assert.match(why(() => checkTrade({ type: "modify", oid: 1, order: { ...order({}).orders[0], p: "60000.55" } }, U))!, /too many/);
});

test("the trading key refuses a wrong price, size or leverage BEFORE signing (control: the right one signs)", async () => {
  const agent = new PerpsAgent(new MemoryVault(), () => 1_700_000_000_000);
  await agent.make();
  await assert.rejects(agent.signTrade(order({ p: "60000.5" }), 1, U), (e: any) => e.problem?.code === "perps.order.refused" && /Hyperliquid/.test(e.problem.whatHappened) && e.problem.money.where === "on Hyperliquid (test money)");
  await assert.rejects(agent.signTrade({ type: "updateLeverage", asset: 0, isCross: true, leverage: 50 }, 2, U), /perps.order.refused/);
  await assert.rejects(agent.signTrade(order({}), 3), /perps.order.refused/, "no market list, nothing signed");
  assert.ok(await agent.signTrade(order({}), 4, U), "control");
});

test("review L5: only the fields the core builds; a batchModify must hold orders (control: the plain order passes)", () => {
  assert.equal(why(() => checkTrade(order({}), U)), null, "control");
  assert.match(why(() => checkTrade({ ...order({}), builder: { b: "0x5e9ee1089755c3435139848e47e6635505d5a13a", f: 100 } }, U))!, /isn't one Hyperliquid takes/, "no builder fee rides along");
  assert.match(why(() => checkTrade(order({ x: 1 }), U))!, /isn't one Hyperliquid takes/);
  assert.match(why(() => checkTrade({ ...order({}), grouping: "zzz" }, U))!, /isn't one Hyperliquid takes/);
  for (const modifies of [undefined, {}, [], "x"]) assert.match(why(() => checkTrade({ type: "batchModify", modifies }, U))!, /isn't one Hyperliquid takes/, JSON.stringify(modifies));
  assert.equal(why(() => checkTrade({ type: "batchModify", modifies: [{ oid: 1, order: order({}).orders[0] }] }, U)), null);
  assert.match(why(() => checkTrade(order({}), [{ name: "BTC", szDecimals: 5, maxLeverage: NaN }]))!, /doesn't list/, "a market with unreadable rules");
});
