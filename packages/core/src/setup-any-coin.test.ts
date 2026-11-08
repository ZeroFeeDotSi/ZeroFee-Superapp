// D155 (product decision, 3 Nov; amends D115): set-up takes money from any chain NEAR Intents supports, each chain's own coin,
// into the person's own NEAR account through NEAR Confidential: the same one-time address as Home's Add, then on as NEAR to
// the account being opened. On in the test proof build; public builds keep NEAR, SOL and ETH (RH) until each passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FUND_ANY, FUND_COINS, FUND_LIKELY, fundOffered } from "./fund-start.ts";
import { SETUP_COINS, setupCoin } from "./setup-coins.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the coins: every chain's own coin NEAR Intents lists with no memo, the likely ones first, then by name; public builds keep NEAR, SOL and Robinhood (control: off, none of the others)", () => {
  const on = fundOffered(true), off = fundOffered(false);
  assert.deepEqual(on.slice(0, 5).map((c) => c.id), ["near", "btc", "eth", "sol", "bsc"], "the likely ones first, in FUND_LIKELY's order");
  assert.deepEqual(FUND_LIKELY, ["near", "btc", "eth", "sol", "bsc"]);
  const rest = on.slice(5).map((c) => c.name);
  assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b)), "then by name");
  for (const id of ["btc", "doge", "ltc", "zec", "tron", "sui", "cardano", "base-eth", "arb-eth", "op", "pol", "avax", "hood-eth"]) assert.ok(on.some((c) => c.id === id), id);
  assert.ok(!on.some((c) => c.token), "never a token (USDC, USDT): a chain's own coin only");
  assert.ok(!on.some((c) => /xrp|stellar|ton/.test(c.chain)), "no chain that needs a memo");
  assert.deepEqual(off.map((c) => c.id).sort(), ["hood-eth", "near", "sol"], "control: the public build keeps the three proven ones");
  // each set-up coin is one tile, its id its chain's (ETH on Ethereum, Base and Arbitrum keep their tiles)
  assert.equal(FUND_ANY.filter((c) => c.assetId === "nep141:eth.omft.near").length, 1);
  assert.equal(new Set(FUND_ANY.map((c) => c.id)).size, FUND_ANY.length, "every id once");
  // the old list stays the words' wallets' networks (the tools' refund check reads it); the rest is FUND_ANY's
  assert.deepEqual([...new Set(FUND_COINS.map((c) => c.chain))].sort(), ["arb", "base", "eth", "hood", "near", "sol"]);
});

test("each set-up coin: 1Click's own coin on its chain (no contract), its decimals, and its deposit address's shape (controls: an EVM address isn't Bitcoin's; a Bitcoin one isn't Tron's)", () => {
  const btc = setupCoin("btc")!;
  assert.deepEqual([btc.tokenId, btc.decimals, btc.symbol], ["nep141:btc.omft.near", 8, "BTC"]);
  assert.ok(btc.address.test("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq") && btc.address.test("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"));
  assert.ok(!btc.address.test("0x" + "ab".repeat(20)), "control");
  assert.ok(setupCoin("tron")!.address.test("TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH") && !setupCoin("tron")!.address.test("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"));
  assert.ok(setupCoin("doge")!.address.test("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L"));
  assert.equal(setupCoin("xrp"), undefined, "XRP needs a memo");
  for (const c of SETUP_COINS) assert.match(c.tokenId, /^(nep141:[a-z0-9]+\.omft\.near|nep245:v2_1\.omni\.hot\.tg:\d+_1{20})$/, `${c.chain}: a chain's own coin, never a token`);
});

test("the switch is the test proof build (VITE_HOME_PROOF=1), as Home's money paths; the core takes a set-up coin only through the private route", () => {
  assert.match(here("./fund-every-chain.ts"), /export const FUND_EVERY_CHAIN: boolean = HOME_PROOF;/);
  const core = here("./demo-core.ts");
  assert.match(core, /if \(coin\.chain !== "sol" && coin\.chain !== "hood" && !setupCoin\(coin\.chain\)\) throw new ProblemError\(securityProblems\.fundCoinUnknown\(\)\);/);
  assert.match(core, /coins: fundOffered\(\)\.filter\(\(c\) => c\.id === "near" \|\| swaps\)/, "control: a browser (no words before the account, K-2) still opens with NEAR alone");
  // the relay takes each set-up coin as itself into a confidential balance (apps/quotes relay.mjs SAME_COIN_FROM_CHAINS)
  const relay = here("../../../apps/quotes/relay.mjs");
  for (const c of SETUP_COINS.filter((x) => x.tokenId.startsWith("nep141:"))) assert.ok(relay.includes(`"${c.tokenId}"`), `the relay takes ${c.chain}`);
});
