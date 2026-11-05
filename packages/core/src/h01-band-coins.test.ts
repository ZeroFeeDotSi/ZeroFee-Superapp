// H01 (JOURNEY-HOLES.md, 1 Nov 2026): protection priced only NEAR, USDC and USDT, so a move of any other coin (wNEAR in
// the ledger, SOL, ETH...) never fit a band and took the strictest one, and a 1Click-priced move of it was refused at any
// size. The core now writes a dollar limit for every coin it can price, up to the contract's 32 (demo-core.ts BAND_COINS).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAND_COINS, BAND_MAX_COINS, bandCoins, bandPrices, contractBands, defaultBands } from "./demo-core.ts";
import type { Chain } from "./chain.ts";

const SOL = "nep141:sol.omft.near";
const limitOf = (bands: any[], coin: string) => {
  const hit = (bands[0].up_to as [string, string][]).find(([c]) => c === coin);
  return hit ? BigInt(hit[1]) : undefined;
};

test("H01: a new mainnet account's $500 band lists every coin the core prices, at most the contract's 32, each id at most 128 characters", () => {
  const coins = Object.fromEntries(BAND_COINS.filter((c) => c.kind === "market").map((c) => [c.id, c.floorUsd! * 1.25]));
  const bands = contractBands(defaultBands("mainnet"), { near: 4.4, coins }, "mainnet") as any[];
  const listed = bands[0].up_to as [string, string][];
  assert.equal(listed.length, BAND_MAX_COINS, "NEAR, USDC, USDT and all 29 others");
  assert.equal(new Set(listed.map(([c]) => c)).size, listed.length, "no coin twice");
  assert.ok(listed.every(([c, a]) => c.length > 0 && c.length <= 128 && /^\d{1,40}$/.test(a) && BigInt(a) > 0n));
  assert.ok(!listed.some(([c]) => c.includes("hot.tg:56_")), "no BNB until its route is proven (H04)");
  assert.equal(bands[1].up_to, null, "the last band is still unlimited");
});

test("H01: wNEAR counts as NEAR, a stablecoin anywhere at $1, a market coin at its price: $500 of SOL at $100 is 5 SOL", () => {
  const bands = contractBands(defaultBands("mainnet"), { near: 2.5, coins: { [SOL]: 100 } }, "mainnet") as any[];
  assert.equal(limitOf(bands, "nep141:wrap.near"), limitOf(bands, "near"));
  assert.equal(limitOf(bands, "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"), 500_000_000n, "USDC on Solana: $500 in 6 decimals");
  assert.equal(limitOf(bands, SOL), 5_000_000_000n, "5 SOL in lamports");
  assert.equal(limitOf(bands, "nep141:eth.omft.near"), undefined, "a market coin with no fresh price is not written (it waits, as before)");
});

test("H01 / NF-09: one bad market price can't inflate a coin's limit: it is written at no less than its floor", () => {
  const bad = contractBands(defaultBands("mainnet"), { near: 2.5, coins: { [SOL]: 0.5 } }, "mainnet") as any[];
  const floor = BAND_COINS.find((c) => c.id === SOL)!.floorUsd!;
  assert.equal(limitOf(bad, SOL), (500n * 10n ** 9n * 1_000_000n) / BigInt(Math.round(floor * 1e6)), "at the floor, not $0.50");
  assert.ok(limitOf(bad, SOL)! <= 7n * 10n ** 9n, "at most about $660 of SOL at today's price, never 1,000 SOL");
  const tiny = contractBands(defaultBands("mainnet"), { near: 2.5, coins: { [SOL]: 0.001 } }, "mainnet") as any[];
  assert.equal(limitOf(tiny, SOL), undefined, "a price under a cent is a wrong answer: not written");
});

test("H01: testnet writes NEAR only (the ids are mainnet's)", () => {
  const bands = contractBands(defaultBands("testnet"), { near: 3, coins: { [SOL]: 100 } }, "testnet") as any[];
  assert.deepEqual(bands[0].up_to.map(([c]: [string]) => c), ["near"]);
});

test("H01: bandCoins says which coins an account's rules count (the Protection screen's 'count every coin')", () => {
  const old = [{ up_to: [["near", "1"], ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "1"], ["nep141:usdt.tether-token.near", "1"]], level: "FaceId" }, { up_to: null, level: "FaceId" }];
  assert.equal(bandCoins(old).length, 3);
  assert.ok(!bandCoins(old).includes("nep141:wrap.near"));
  assert.ok(bandCoins(contractBands(defaultBands("mainnet"), { near: 3 }, "mainnet")).includes("nep141:wrap.near"));
  assert.deepEqual(bandCoins("nonsense"), []);
});

test("H01: the contract's own test (contracts/account-policy/tests/h01_band_coins.rs) runs on exactly what contractBands writes", () => {
  const prices = { near: 2.5, coins: Object.fromEntries(BAND_COINS.filter((c) => c.kind === "market").map((c) => [c.id, c.id === SOL ? 100 : c.floorUsd! * 1.25])) };
  const fixture = JSON.parse(readFileSync(new URL("../../../contracts/account-policy/tests/fixtures/h01-bands.json", import.meta.url), "utf8"));
  assert.deepEqual(fixture, contractBands(defaultBands("mainnet"), prices, "mainnet"));
});

/** A mainnet chain whose Ref pool says NEAR is about $4.67, and 1Click's list as given. */
async function pricedWith(list: unknown[]) {
  const chain = {
    network: "mainnet",
    commonBlock: async () => ({ hash: "h", height: 1 }),
    view: async () => ({ token_account_ids: ["wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"], amounts: [String(236_000n * 10n ** 24n), String(1_103_000n * 1_000_000n)] }),
  } as unknown as Chain;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(list))) as typeof fetch;
  try {
    return await bandPrices(chain);
  } finally {
    globalThis.fetch = real;
  }
}
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

test("H01: bandPrices takes a market coin's price only when 1Click updated it in the last 15 minutes and its decimals are the ones written", async () => {
  const p = await pricedWith([
    { assetId: "nep141:wrap.near", price: 4.7, priceUpdatedAt: at(1), decimals: 24 },
    { assetId: SOL, price: 95, priceUpdatedAt: at(2), decimals: 9 },
    { assetId: "nep141:eth.omft.near", price: 2269, priceUpdatedAt: at(30), decimals: 18 },
    { assetId: "nep141:btc.omft.near", price: 77978, priceUpdatedAt: at(1), decimals: 18 },
  ]);
  assert.equal(p.near, 4.7);
  assert.deepEqual(p.coins, { [SOL]: 95 }, "ETH is stale, BTC's decimals changed: neither is written");
});
