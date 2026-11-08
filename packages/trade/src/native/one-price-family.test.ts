// D9 (audit 13, 8 Nov): ETH and BTC had two prices. Trade's NEAR Intents list said "ETH · NEAR $2,230.47", "ETH · Ethereum
// $2,347.51", "ETH · Robinhood $2,230.47" while Hot and Home said $2,347.51; "BTC · Bitcoin $80,456.00" beside "BTC · NEAR
// $77,820.22" (the Sim's own list priced NBTC apart). Now one coin on any chain is one price: its family's home coin's
// ledger price (coinPrice), and the Sim's lists read one table (SIM_PRICE). Fails on main: no coinPrice; NBTC at $77,820.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SAMPLE_NEAR_COINS, SIM_PRICE } from "@zerofee/shell-api/mock-float.ts";
import { coinPrice, priceBook } from "./one-price.ts";

async function book() {
  const r = await createMockBridge({ latencyMs: 0 }).call<unknown[]>("ledger.tokens");
  assert.ok("ok" in r);
  return priceBook(r.ok);
}

test("D9: ETH on NEAR, Ethereum and Robinhood is one price, Home's; BTC on Bitcoin and NEAR is one price [before: $2,230.47 and $77,820.22]", async () => {
  const b = await book();
  assert.equal(coinPrice(b, "nep141:aurora", "ETH", 2230.47), 2347.51, "ETH on NEAR");
  assert.equal(coinPrice(b, "nep141:eth.omft.near", "ETH", 2230.47), 2347.51, "ETH on Ethereum");
  assert.equal(coinPrice(b, "nep245:v2_1.omni.hot.tg:46630_11111111111111111111", "ETH", 2230.47), 2347.51, "ETH on Robinhood");
  assert.equal(coinPrice(b, "nep141:nbtc.bridge.near", "BTC", 77820.22), 80456, "BTC on NEAR");
  assert.equal(coinPrice(b, "nep141:nbtc.bridge.near", "NBTC", 77820.22), 80456, "NBTC is BTC");
  assert.equal(coinPrice(b, "nep141:btc.omft.near", "BTC"), 80456, "BTC on Bitcoin");
  assert.equal(b.get("nep141:nbtc.bridge.near"), b.get("nep141:btc.omft.near"), "the Sim's ledger list itself: one BTC price");
});

test("D9 controls: a coin of no family keeps its own price; no ledger price, the market's; no symbol, by id only", async () => {
  const b = await book();
  assert.equal(coinPrice(b, "nep141:token.rhealab.near", "RHEA", 0.9), b.get("nep141:token.rhealab.near"));
  assert.equal(coinPrice(b, "nep141:not-listed.near", "DOPE", 0.42), 0.42);
  assert.equal(coinPrice(new Map(), "nep141:aurora", "ETH", 2230.47), 2230.47, "no ledger price at all: the market's");
  assert.equal(coinPrice(b, "nep141:not-listed.near", undefined, 3), 3);
});

test("D9: the Sim prices each coin from one table (SIM_PRICE): the Safe's list and the NEAR wallet's coins", async () => {
  const b = await book();
  assert.equal(b.get("nep141:eth.omft.near"), SIM_PRICE.ETH);
  assert.equal(b.get("nep141:btc.omft.near"), SIM_PRICE.BTC);
  assert.equal(b.get("nep141:sol.omft.near"), SIM_PRICE.SOL);
  assert.equal(b.get("nep141:wrap.near"), SIM_PRICE.NEAR);
  assert.equal(SAMPLE_NEAR_COINS["nep141:eth.omft.near"]!.usd, SIM_PRICE.ETH, "a NEAR-wallet ETH buy fills at Home's price");
  assert.equal(SAMPLE_NEAR_COINS["nep141:sol.omft.near"]!.usd, SIM_PRICE.SOL);
  assert.equal(SAMPLE_NEAR_COINS["nep141:nbtc.bridge.near"]!.usd, SIM_PRICE.BTC);
  const page = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /onePrice\(book/, "every price on Trade's NEAR Intents tab goes through coinPrice");
});
