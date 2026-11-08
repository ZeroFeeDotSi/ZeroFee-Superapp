// Audit 17's H1 (8 Nov): Trade's NEAR Intents tab listed ETH five times ("ETH · NEAR", "ETH · Ethereum", "ETH ·
// Arbitrum", "ETH · Base", "ETH · Robinhood"), "USDC · Base", "cbBTC · Base", and priced coins "$3.1416". The review's
// ruling: every intents coin the Safe can hold stays (BTC, ZEC, XRP, DOGE), one row per coin, the asset not the rail: no
// chain word, no duplicates, never the Safe's cash; prices to the cent from $1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appCoins } from "./assets.ts";
import { listPrice, price } from "../app/format.ts";

const row = (symbol: string, blockchain: string, assetId = `${blockchain}-${symbol}`) => ({ assetId, symbol, blockchain });
const listed = [
  row("ETH", "eth"), row("ETH", "arb"), row("ETH", "base"), row("ETH", "hood"), row("NEAR", "near"), row("ETH", "near"),
  row("USDC", "base"), row("USDC", "sol"), row("cbBTC", "base"), row("SOL", "sol"), row("BTC", "btc"), row("BNB", "bsc"), row("USDT", "sol"), row("USDT", "near"),
];

test("H1: one row per coin the Safe can hold, every rail (BTC, XRP kept), never a chain variant; no USDC row", () => {
  const shown = appCoins(listed);
  assert.deepEqual(shown.map((r) => `${r.symbol}·${r.blockchain}`), ["NEAR·near", "ETH·near", "cbBTC·base", "SOL·sol", "BTC·btc", "BNB·bsc", "USDT·near"]);
  const symbols = shown.map((r) => r.symbol);
  assert.equal(new Set(symbols).size, symbols.length, "each coin once");
  assert.equal(symbols.filter((x) => x === "BTC").length, 1, "BTC present once (Home's Safe shows Bitcoin)");
  assert.equal(symbols.filter((x) => x === "ETH").length, 1, "ETH once, not five times");
  assert.ok(!symbols.includes("USDC"), "the Safe's cash pays: no row to buy it");
  assert.deepEqual(appCoins([row("ETH", "base"), row("ETH", "arb"), row("ETH", "hood")]).map((r) => r.blockchain), ["hood"], "control: the Robinhood row when NEAR has none");
  assert.deepEqual(appCoins([row("XRP", "xrp")]).map((r) => r.symbol), ["XRP"], "a coin on no app chain stays");
});

test("H1: the app's list goes through it; the row says no chain", () => {
  const data = readFileSync(new URL("./data.ts", import.meta.url), "utf8");
  assert.match(data, /opt\.listed \? appCoins\(r\.filter/);
  const screens = readFileSync(new URL("./NativeScreens.tsx", import.meta.url), "utf8");
  const list = screens.slice(screens.indexOf("export function NativeList"), screens.indexOf("const RANGES"));
  assert.doesNotMatch(list, /chainWords/, "no \"ETH · Base\" words on a row");
  assert.doesNotMatch(list, /\bBase\b|BNB Chain|Arbitrum/, "no rail's name on the list");
});

test("H1: prices to the cent from $1, more digits only under $1", () => {
  assert.equal(price(3.1416), "$3.14");
  assert.equal(listPrice(1.23456), "$1.23");
  assert.equal(price(9.999), "$10.00");
  assert.equal(price(0.000021), "$0.000021", "control: under $1 keeps the rule's decimals");
  assert.equal(price(0.5), "$0.50", "control");
});
