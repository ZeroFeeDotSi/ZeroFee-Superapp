import { test } from "node:test";
import assert from "node:assert/strict";
import { Catalogue, priceText, routeOf } from "./catalogue.ts";
import { RECORDED } from "./testing/replay.ts";

const cat = new Catalogue(RECORDED.tokens.tokens, RECORDED.supported.response.result.tokens);

test("how each kind of coin leaves the ledger", () => {
  assert.equal(routeOf("nep141:wrap.near"), "near");
  assert.equal(routeOf("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), "near");
  assert.equal(routeOf("nep141:sol.omft.near"), "poa");
  assert.equal(routeOf("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"), "poa");
  assert.equal(routeOf("nep245:v2_1.omni.hot.tg:56_11111111111111111111"), "hot");
  assert.equal(routeOf("nep141:abs.omdep.near"), "omni");
  assert.equal(routeOf("nep141:aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near"), "omni");
  assert.equal(routeOf("1cs_v1:btc:native:coin"), "other");
});

test("coins carry 1Click's symbol, decimals and price, and the bridged flag", () => {
  const usdc = cat.coin("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1")!;
  assert.deepEqual([usdc.symbol, usdc.decimals, usdc.chain, usdc.bridged, usdc.name], ["USDC", 6, "near", false, "USD Coin"]);
  const near = cat.coin("nep141:wrap.near")!;
  assert.deepEqual([near.symbol, near.bridged], ["NEAR", false], "wrapped NEAR is shown as NEAR");
  const sol = cat.coin("nep141:sol.omft.near")!;
  assert.deepEqual([sol.symbol, sol.decimals, sol.chain, sol.bridged, sol.route], ["SOL", 9, "sol", true, "poa"]);
  assert.equal(sol.bridge?.chain, "sol:mainnet", "SOL arrives on Solana (not the Aptos row the bridge also lists)");
  assert.equal(sol.bridge?.minDeposit, 1_250_000n);
  assert.ok(Number(sol.priceUsd) > 0);
  const bnb = cat.coin("nep245:v2_1.omni.hot.tg:56_11111111111111111111")!;
  assert.deepEqual([bnb.chain, bnb.bridged, bnb.route, bnb.bridge?.chain], ["bsc", true, "hot", "eth:56"]);
});

test("the Send-from list: NEAR first, then the common networks, each with its own coin and minimum", () => {
  const chains = cat.chains();
  assert.deepEqual(chains.slice(0, 4).map((c) => c.id), ["near", "eth", "base", "sol"]);
  const byId = Object.fromEntries(chains.map((c) => [c.id, c]));
  const { coins: nearCoins, ...near } = byId.near;
  assert.deepEqual(near, { id: "near", name: "NEAR", icon: "near", nativeSymbol: "NEAR" });
  assert.ok(nearCoins.includes("near") && nearCoins.includes("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"));
  const { coins: solCoins, ...sol } = byId.sol;
  assert.deepEqual(sol, { id: "sol", name: "Solana", icon: "sol", nativeSymbol: "SOL", minDeposit: "0.00125" });
  assert.ok(solCoins.includes("nep141:sol.omft.near") && solCoins.includes("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"));
  assert.ok(!solCoins.includes("nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"), "only coins the bridge credits on Solana");
  assert.equal(byId.hood.name, "Robinhood Chain");
  assert.equal(byId.hood.nativeSymbol, "ETH");
  assert.equal(cat.network("hood")?.bridgeChain, "eth:4663");
  assert.equal(byId.bsc.nativeSymbol, "BNB");
  assert.equal(cat.network("stellar")?.bridgeChain, "stellar:mainnet");
});

test("a network shows only if it has a real name and the bridge takes its own coin there", () => {
  const ids = new Set(cat.chains().map((c) => c.id));
  assert.ok(!ids.has("qtc") && !ids.has("adi"), "no network shown by a code");
  assert.ok(!ids.has("abs"), "Abstract has no deposit route on the bridge");
  for (const c of cat.chains()) assert.ok(c.name && c.icon && c.nativeSymbol, c.id);
});

test("ledger.tokens is 1Click's whole list, in Pay's Token shape", () => {
  const tokens = cat.tokens();
  assert.equal(tokens.length, RECORDED.tokens.tokens.length);
  const sol = tokens.find((t) => t.assetId === "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near")!;
  assert.deepEqual(Object.keys(sol).sort(), ["assetId", "chain", "contract", "decimals", "icon", "name", "priceUsd", "symbol"]);
  assert.equal(sol.contract, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  assert.equal(tokens.find((t) => t.assetId === "nep141:sol.omft.near")!.contract, null);
});

test("a price is always a plain decimal, never in exponent form, and nothing when it isn't a positive number", () => {
  assert.equal(String(1e-7), "1e-7", "what String() would have given");
  assert.equal(priceText(1e-7), "0.0000001");
  assert.equal(priceText(104_211.5), "104211.5");
  assert.equal(priceText(1), "1");
  for (const bad of [0, -1, Number.NaN, Infinity, 1e-13, "3", null, undefined, 1e22]) assert.equal(priceText(bad), undefined, String(bad));
});

test("W-5: a /tokens row with bad decimals or a field of the wrong type is dropped; a bad bridge row gives no bridge", () => {
  const good = { assetId: "nep141:good.near", decimals: 6, blockchain: "near", symbol: "GOOD", price: 1 };
  const bad: unknown[] = [
    { ...good, assetId: "nep141:huge.near", decimals: 1_000_000 },
    { ...good, assetId: "nep141:minus.near", decimals: -1 },
    { ...good, assetId: "nep141:over.near", decimals: 31 },
    { ...good, assetId: "nep141:half.near", decimals: 2.5 },
    { ...good, assetId: "nep141:text.near", decimals: "6" },
    { ...good, assetId: "nep141:nosymbol.near", symbol: 5 },
    { ...good, assetId: "nep141:emptysymbol.near", symbol: "" },
    { ...good, assetId: "nep141:contract.near", contractAddress: { evil: true } },
    { ...good, assetId: "nep141:chain.near", blockchain: 3 },
    { ...good, assetId: 7 },
    null,
    "nep141:string.near",
  ];
  let c: Catalogue | undefined;
  assert.doesNotThrow(() => (c = new Catalogue([good, ...bad] as never, [])));
  assert.deepEqual([...c!.coins.keys()], ["nep141:good.near"], "only the good row is kept");
  // NEAR's own coins use 24 decimals: still a coin
  assert.equal(new Catalogue([{ ...good, decimals: 24 }] as never, []).coin("nep141:good.near")?.decimals, 24);
  // the bridge's amounts must be whole numbers: a row that isn't gives the coin no bridge (so nothing goes out by it)
  const sol = RECORDED.tokens.tokens.find((t: { assetId: string }) => t.assetId === "nep141:sol.omft.near")!;
  const row = RECORDED.supported.response.result.tokens.find((r: { intents_token_id: string; defuse_asset_identifier: string }) => r.intents_token_id === "nep141:sol.omft.near" && r.defuse_asset_identifier.startsWith("sol:mainnet"))!;
  for (const broken of [{ withdrawal_fee: "-1" }, { withdrawal_fee: "1e9" }, { min_withdrawal_amount: "abc" }, { min_deposit_amount: 5 }, { withdrawal_fee: "1".repeat(60) }]) {
    let cc: Catalogue | undefined;
    assert.doesNotThrow(() => (cc = new Catalogue([sol], [{ ...row, ...broken }] as never)), JSON.stringify(broken));
    assert.equal(cc!.coin("nep141:sol.omft.near")?.bridge, undefined, JSON.stringify(broken));
  }
  assert.ok(new Catalogue([sol], [row]).coin("nep141:sol.omft.near")?.bridge, "control: the real row gives a bridge");
});
