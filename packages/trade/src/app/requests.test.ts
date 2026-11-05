// Home V4's rows ask Trade for a chain's market or a held coin's page; the request is read strictly (review, 3 Nov):
// a chain Home has, an address valid for that chain, anything else the market.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coinAddressOk, readRequest, rowLine } from "./requests.ts";

test("market:<chain> opens that chain's market for sol, hood, near and bsc; any other chain is the whole market", () => {
  for (const c of ["sol", "hood", "near", "bsc"]) assert.deepEqual(readRequest(`market:${c}`), { market: c });
  for (const t of ["market:eth", "market:base", "market:", "market:SOL", "market:sol:extra"]) assert.deepEqual(readRequest(t), { market: "all" }, t);
});

test("coin:<chain>:<address> opens the coin only with an address valid for that chain; anything else is the market, never an error", () => {
  const ok: [string, string][] = [
    ["coin:sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:BONK", "sol"],
    ["coin:hood:0x5a3e00000000000000000000000000000000ab12", "hood"],
    ["coin:near:token.v2.ref-finance.near:REF", "near"],
    ["coin:near:nep141:token.v2.ref-finance.near", "near"],
  ];
  for (const [t, chain] of ok) { const r = readRequest(t); assert.ok("coin" in r && r.coin.chain === chain, t); }
  assert.deepEqual(readRequest("coin:sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:BONK"), { coin: { chain: "sol", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "BONK" } });
  for (const t of [
    "coin:sol:0x5a3e00000000000000000000000000000000ab12",          // an EVM address on Solana
    "coin:hood:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",      // a Solana mint on Robinhood
    "coin:sol:0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl",                   // not base58
    "coin:near:Not_A_Name!",
    "coin:eth:0x5a3e00000000000000000000000000000000ab12",          // a chain Home doesn't have
    "coin:bsc:0x5a3e00000000000000000000000000000000AB12",          // BNB while it is closed (review L8)
    "coin:sol:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263:<script>",
    "coin:", "javascript:alert(1)", "", "home",
  ]) assert.deepEqual(readRequest(t), { market: "all" }, t);
});

test("control: the address check is each chain's own", () => {
  assert.equal(coinAddressOk("sol", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), true);
  assert.equal(coinAddressOk("hood", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), false);
  assert.equal(coinAddressOk("hood", "0x5a3e00000000000000000000000000000000ab12"), true);
  assert.equal(coinAddressOk("near", "kim.near"), true);
});

test("the row's line over its market: its own coin and dollars; NEAR's is cash plus NEAR coins, as Home's NEAR row; not read is \"updating…\", never $0", () => {
  const snap = { loaded: true, reserveUsd: 37.9, chains: [{ chain: "sol", nativeUsd: 119.37, nativeAmount: "1.174086" }, { chain: "hood", nativeUsd: 28.17, nativeAmount: "0.012" }] };
  assert.equal(rowLine("sol", snap, 0), "Your SOL: $119.37 (1.1740 SOL)");
  assert.equal(rowLine("hood", snap, 0), "Your ETH on Robinhood: $28.17 (0.012 ETH)");
  assert.equal(rowLine("near", snap, 2.1), "Your NEAR row: $40.00", "$37.90 of cash and $2.10 of NEAR coins (review M4)");
  assert.equal(rowLine("near", snap, null), "Your NEAR row: updating…", "its coins not read yet");
  assert.equal(rowLine("sol", { ...snap, unread: true }, 0), "Your SOL: updating…", "unread (review M4)");
  assert.equal(rowLine("sol", { ...snap, loaded: false }, 0), "Your SOL: updating…");
});
