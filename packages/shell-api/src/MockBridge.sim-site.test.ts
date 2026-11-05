// Sim's sample sites (SimSite.tsx): a buy moves the site wallet's sample SOL into a sample coin, a sell brings it back,
// within the one cap with no sheet (D143's hot key); over the cap refused; an empty wallet says so (control); only the
// Browser may ask; the coin shows in the wallet's own coins (subwallet.coins).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const coin = { token: "sim-pebble", symbol: "PEBL", name: "Pebble", priceUsd: 0.0004 };

test("buy then sell on a sample site, on the site wallet's sample money, no sheet; the coin shows in its coins", async () => {
  const mock = createMockBridge({ latencyMs: 0, float: { held: { "sw-site-pump-sol": String(100_000_000) } } }); // 0.1 SOL = $15
  let sheets = 0;
  mock.on("approval.needed", () => sheets++);
  const buy = await mock.call<{ status: string; usd: number }>("sim.site.trade", { app: "social", site: "pump", side: "buy", coin, usd: 5 });
  assert.ok("ok" in buy && buy.ok.status === "done", JSON.stringify(buy));
  const coins = await mock.call<{ symbol: string; usd: number | null }[]>("subwallet.coins", { id: "sw-site-pump-sol" });
  assert.ok("ok" in coins && coins.ok.some((c) => c.symbol === "PEBL" && c.usd === 5), JSON.stringify(coins));
  const sol = "ok" in coins ? coins.ok.find((c) => c.symbol === "SOL")!.usd : null;
  assert.equal(sol, 10, "$15 less the $5 bought");
  const sell = await mock.call<{ status: string; usd: number }>("sim.site.trade", { app: "social", site: "pump", side: "sell", coin });
  assert.ok("ok" in sell && sell.ok.status === "done" && sell.ok.usd === 5);
  assert.equal(sheets, 0, "within the cap: no sheet");
});

test("controls: an empty wallet says so, over the cap is refused, only the Browser asks, only sample coins", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const short = await mock.call<{ status: string }>("sim.site.trade", { app: "social", site: "gmgn", side: "buy", coin, usd: 5 });
  assert.ok("ok" in short && short.ok.status === "short");
  assert.ok("problem" in (await mock.call("sim.site.trade", { app: "social", site: "pump", side: "buy", coin, usd: 150 })));
  assert.ok("problem" in (await mock.call("sim.site.trade", { app: "trade", site: "pump", side: "buy", coin, usd: 5 })));
  assert.ok("problem" in (await mock.call("sim.site.trade", { app: "social", site: "pump", side: "buy", coin: { ...coin, token: "So11111111111111111111111111111111111111112" }, usd: 5 })));
  const none = await mock.call<{ status: string }>("sim.site.trade", { app: "social", site: "pump", side: "sell", coin });
  assert.ok("ok" in none && none.ok.status === "none");
});

test("finding 63: a site wallet's SOL is valued at the bridge's one SOL price, the price its Add bought at", async () => {
  // $3.00 of SOL at the recorded $101.67 (the sample's price): the wallet reads $3.00, never $4.43 (the old fixed $150)
  const lamports = Math.round((3 / 101.67) * 1e9);
  const mock = createMockBridge({ latencyMs: 0, float: { priceUsd: (c) => ({ sol: 101.67, bsc: 744.17, hood: 2347.2 })[c], held: { "sw-site-pump-sol": String(lamports) } } });
  // the sample wallet is made on its first use (a sample buy); that buy spends at the same price: $1 takes $1 of the SOL
  const buy = await mock.call<{ status: string }>("sim.site.trade", { app: "social", site: "pump", side: "buy", coin, usd: 1 });
  assert.ok("ok" in buy && buy.ok.status === "done", JSON.stringify(buy));
  const after = await mock.call<{ symbol: string; usd: number | null }[]>("subwallet.coins", { id: "sw-site-pump-sol" });
  assert.equal("ok" in after ? after.ok.find((c) => c.symbol === "SOL")!.usd : null, 2);
  // control: a bridge given no price keeps the float's own default, $150
  const plain = createMockBridge({ latencyMs: 0, float: { held: { "sw-site-pump-sol": String(1e9 + Math.round(1e9 / 150)) } } });
  await plain.call("sim.site.trade", { app: "social", site: "pump", side: "buy", coin, usd: 1 });
  const p = await plain.call<{ symbol: string; usd: number | null }[]>("subwallet.coins", { id: "sw-site-pump-sol" });
  assert.equal("ok" in p ? p.ok.find((c) => c.symbol === "SOL")!.usd : null, 150);
});
