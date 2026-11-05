// The mainnet copy's seam (product decision, 4 Nov; fork.ts): VITE_FORK=1 points each chain the copy has at this Mac's node from one
// fixed table, loopback only, both node slots answered by that one node; a chain the copy lacks gets no node; 1Click's
// cross-chain legs are refused with one line. Off (every build but the copy's, and node here): every list is its real
// operators, the very array written, and nothing of the copy's runs. Unit tests: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COPY, FORK, FORK_CROSS_CHAIN, LOOPBACK_NODE, forkTable, onCopy } from "./fork.ts";
import { SOL_INDEXED_NODES, SOL_NODES, SOL_READ_SPARES, SOL_SIM_NODES } from "./solana.ts";
import { EVM_NODES, EVM_READ_SPARES } from "./evm.ts";
import { NEAR_MAINNET_NODES, NODES, RpcChain, SHOWN_SPARES } from "./chain.ts";
import { GNOSIS_NODES } from "./gnosis-pay.ts";
import { bandPriceChain } from "./demo-core.ts";

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the fixed table: Solana 8899, BNB 8545, Robinhood 8546, NEAR 3030, Jupiter's stand-in 8897, each on this Mac", () => {
  assert.deepEqual(forkTable(), { sol: "http://127.0.0.1:8899", bsc: "http://127.0.0.1:8545", hood: "http://127.0.0.1:8546", near: "http://127.0.0.1:3030", jup: "http://127.0.0.1:8897" });
  for (const url of Object.values(forkTable())) assert.match(url, LOOPBACK_NODE);
  // control: nothing else is loopback
  for (const bad of ["https://127.0.0.1:8899", "http://10.0.0.2:8899", "http://127.0.0.1.evil.com:8899", "http://localhost:8899/x", "http://[::1]:8899", "http://0.0.0.0:8899"]) assert.doesNotMatch(bad, LOOPBACK_NODE, bad);
  assert.match("http://localhost:8899", LOOPBACK_NODE);
});

test("on the copy: the chain's node in every slot (two slots, one node); a chain it lacks has none; a table off this Mac throws", () => {
  const t = forkTable();
  const sol2 = "http://localhost:8899", near2 = "http://localhost:3030";
  assert.deepEqual(onCopy("sol", ["https://a", "https://b", "https://c"], t), [t.sol, sol2, t.sol], "three slots, one node under its two names");
  assert.deepEqual(onCopy("near", ["https://a", "https://b", "https://c"], t), [t.near, near2, t.near]);
  // the NEAR reader's two-node rule takes the copy's slots (two names, one node)
  assert.doesNotThrow(() => new RpcChain("mainnet", onCopy("near", NEAR_MAINNET_NODES, t)));
  assert.deepEqual(onCopy("sol", ["https://a", "https://b"], { ...t, sol: "http://localhost:8899" }), ["http://localhost:8899", "http://127.0.0.1:8899"]);
  assert.deepEqual(onCopy("bsc", ["https://a"], t), [t.bsc]);
  // the EVM reader asks nodes.slice(0, 2) and needs two answers: both slots are the copy's anvil
  assert.deepEqual(onCopy("bsc", ["https://bsc-dataseed.bnbchain.org", "https://bsc-rpc.publicnode.com"], t), ["http://127.0.0.1:8545", "http://localhost:8545"]);
  assert.deepEqual(onCopy("hood", ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.drpc.org"], t), ["http://127.0.0.1:8546", "http://localhost:8546"]);
  assert.deepEqual(onCopy("hood", ["https://a"], t), [t.hood]);
  assert.deepEqual(onCopy(null, ["https://mainnet.base.org"], t), [], "no copy of the chain: no node at all");
  assert.throws(() => onCopy("sol", ["https://a"], { ...t, sol: "http://10.0.0.2:8899" }), /on this Mac/);
  assert.throws(() => onCopy("sol", ["https://a"], { ...t, sol: "https://solana-rpc.publicnode.com" }), /on this Mac/);
  // control: off the copy, the very array written
  const list = ["https://a", "https://b"];
  assert.equal(onCopy("sol", list, null), list);
  assert.equal(onCopy(null, list, null), list);
});

test("off the copy (node, every release build): the flag is off and every node list is its real operators", async () => {
  assert.equal(FORK, false);
  assert.equal(COPY, null);
  for (const list of [SOL_NODES, SOL_READ_SPARES, SOL_INDEXED_NODES, SOL_SIM_NODES, NODES.mainnet, NODES.testnet, SHOWN_SPARES, GNOSIS_NODES, ...Object.values(EVM_NODES), ...Object.values(EVM_READ_SPARES)]) {
    // SHOWN_SPARES may be empty (product decision, 4 Nov: NEAR's own node is deprecated; dRPC and Intear are the stand-ins)
    assert.ok((list!.length > 0 || list === SHOWN_SPARES) && list!.every((u) => u.startsWith("https://")), JSON.stringify(list));
  }
  assert.equal(NODES.mainnet, NEAR_MAINNET_NODES);
  const { JUP } = await import("../../trade/src/sol/jupiter.ts");
  assert.equal(JUP, "https://lite-api.jup.ag/swap/v1", "Jupiter's own API");
});

test("every node list is written through onCopy, the one override point (control: NEAR testnet is not copied)", () => {
  const solana = src("./solana.ts"), evm = src("./evm.ts"), chain = src("./chain.ts"), gnosis = src("./gnosis-pay.ts");
  for (const name of ["SOL_NODES", "SOL_READ_SPARES", "SOL_INDEXED_NODES", "SOL_SIM_NODES"]) assert.match(solana, new RegExp(`export const ${name} = onCopy\\("sol", \\[`), name);
  assert.match(evm, /bsc: onCopy\("bsc", \["https:\/\/bsc-dataseed\.bnbchain\.org"/);
  assert.match(evm, /hood: onCopy\("hood", \["https:\/\/rpc\.mainnet\.chain\.robinhood\.com"/);
  for (const c of ["eth", "base", "gnosis", "arb"]) assert.match(evm, new RegExp(`  ${c}: onCopy\\(null, \\[`), c);
  assert.match(evm, /bsc: onCopy\("bsc", \["https:\/\/rpc-bsc\.48\.club"/);
  assert.match(chain, /mainnet: onCopy\("near", NEAR_MAINNET_NODES\),/);
  assert.match(chain, /export const SHOWN_SPARES = onCopy\("near", \[/);
  assert.match(chain, /testnet: \["https:\/\/test\.rpc\.fastnear\.com"/, "control: testnet as written");
  assert.match(gnosis, /export const GNOSIS_NODES = onCopy\(null, \[/);
  const trade = (f: string) => readFileSync(new URL(`../../trade/src/${f}`, import.meta.url), "utf8");
  assert.match(trade("sol/rpc.ts"), /export const SOL_NODES = onCopy\("sol", \[/);
  assert.match(trade("evm/chains.ts"), /return onCopy\(chain, REAL_NODES\[chain\]\.map\(\(n\) => n\.url\)\)/);
  assert.match(trade("evm/chains.ts"), /logNodes: onCopy\("hood", \["https:\/\/rpc\.mainnet\.chain\.robinhood\.com"\]\)/);
  assert.match(trade("sol/jupiter.ts"), /export const JUP = `\$\{onCopy\("jup", \["https:\/\/lite-api\.jup\.ag"\]\)\[0\]\}\/swap\/v1`;/);
  assert.match(trade("market/near.ts"), /export const NEAR_RPC_HOSTS: readonly string\[\] = onCopy\("near", \[/);
  for (const c of ["sol", "bsc", "hood"]) assert.match(trade("market/ws-hosts.ts"), new RegExp(`  ${c}: onCopy\\(null, \\["wss://`), `${c}: no live feed on the copy`);
  assert.match(readFileSync(new URL("../../earn/src/network.ts", import.meta.url), "utf8"), /mainnet: onCopy\("near", \["https:\/\/archival-rpc\.mainnet\.fastnear\.com"/);
});

test("1Click can't be copied: every cross-chain leg is refused on the copy with one line, nothing moved", () => {
  assert.deepEqual(FORK_CROSS_CHAIN, { code: "security.copy.no-cross-chain", whatHappened: "This copy can't move money between chains. Nothing moved.", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } });
  const gate = /if \(FORK\) throw new ProblemError\(FORK_CROSS_CHAIN\);/;
  // the core's own 1Click quote, and the relay's quote, generate-intent and submit-intent (one post)
  assert.match(src("./intents.ts"), new RegExp(`export const oneClickQuote: OneClickQuoter = async \\(request\\) => \\{\\n  //[^\\n]*\\n  ${gate.source}`));
  assert.match(src("./demo-core.ts"), new RegExp(`const post = async \\(path: string, body: unknown\\): Promise<any> => \\{\\n    //[^\\n]*\\n    ${gate.source}`));
  // Wallet's ledger: a quote, a bridge deposit address, an intent to sign, its submit
  const apis = readFileSync(new URL("../../wallet/src/apis.ts", import.meta.url), "utf8");
  for (const m of ["depositAddress\\(accountId, bridgeChain, mode\\)", "quote\\(request, via\\)", "generateIntent\\(via, signerId, depositAddress\\)", "submitIntent\\(via, signedData\\)"]) {
    assert.match(apis, new RegExp(`async ${m} \\{\\n    //[^\\n]*\\n    ${gate.source}`), m);
  }
  // control: a status read is not gated (it asks, moves nothing)
  assert.doesNotMatch(apis, new RegExp(`async status\\(depositAddress, via, tag\\) \\{\\n    //[^\\n]*\\n    ${gate.source}`));
});

test("set-up's band prices: on the copy, real NEAR mainnet read-only (its node can't hold Ref's state); off it, the account's own chain", () => {
  const copyChain = new RpcChain("mainnet", ["http://127.0.0.1:3030", "http://localhost:3030"]);
  const onIt = bandPriceChain(copyChain, true);
  assert.notEqual(onIt, copyChain);
  assert.ok(onIt instanceof RpcChain && onIt.network === "mainnet");
  assert.deepEqual((onIt as unknown as { nodes: string[] }).nodes, NEAR_MAINNET_NODES, "mainnet's own operators, not the copy's node");
  // controls: without the flag the prices read this.chain; testnet is never sent to mainnet
  assert.equal(bandPriceChain(copyChain, false), copyChain);
  assert.equal(bandPriceChain(copyChain), copyChain, "the build flag is off under node");
  const testnet = new RpcChain("testnet");
  assert.equal(bandPriceChain(testnet, true), testnet);
  assert.match(src("./demo-core.ts"), /const priceChain = bandPriceChain\(options\.chain\);\n    this\.prices = options\.prices \?\? \(\(\) => bandPrices\(priceChain\)\);/);
});
