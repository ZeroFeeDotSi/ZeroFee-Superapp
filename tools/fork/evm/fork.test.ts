// The mainnet copy's pure parts (no node is asked: unit tests never touch the network).
import assert from "node:assert/strict";
import test from "node:test";
import { FORK, forkUrl, getPoolData, richest, transferData, units } from "./fork.ts";
import { EVM_CHAIN_ID, EVM_NODES } from "../../../packages/core/src/evm.ts";

test("each copy keeps its chain's own id and forks one of the core's own nodes, on loopback", () => {
  for (const chain of ["bsc", "hood"] as const) {
    assert.equal(FORK[chain].chainId, EVM_CHAIN_ID[chain]);
    assert.ok(EVM_NODES[chain].includes(FORK[chain].upstream), `${chain} upstream is one of EVM_NODES`);
    assert.match(forkUrl(chain), /^http:\/\/127\.0\.0\.1:\d+$/);
  }
  assert.equal(forkUrl("bsc"), "http://127.0.0.1:8545");
  assert.equal(forkUrl("hood"), "http://127.0.0.1:8546");
  // control: the BNB node that keeps no past state is not the one forked
  assert.notEqual(FORK.bsc.upstream, "https://bsc-dataseed.bnbchain.org");
});

test("units: a decimal amount as the coin's raw integer", () => {
  assert.equal(units("10000", 6), 10_000_000_000n);
  assert.equal(units("12.5", 18), 12_500_000_000_000_000_000n);
  assert.equal(units("0.000001", 6), 1n);
  assert.throws(() => units("0.0000001", 6));
  assert.throws(() => units("1e3", 18));
});

test("richest: the holder with the most, of those holding enough; none when nobody does", () => {
  const held = [{ holder: "0xa", balance: 5n }, { holder: "0xb", balance: 50n }, { holder: "0xc", balance: 20n }];
  assert.equal(richest(held, 10n), "0xb");
  assert.equal(richest(held, 51n), null);
  assert.equal(richest([], 1n), null);
});

test("calldata: getPool and transfer in their ABI shape", () => {
  const pool = getPoolData("0x55d398326f99059ff775485246999027b3197955", FORK.bsc.wrapped, 500);
  assert.equal(pool.slice(0, 10), "0x1698ee82");
  assert.equal(pool.length, 10 + 3 * 64);
  assert.ok(pool.endsWith("1f4"));
  const t = transferData("0x9858effd232b4033e47d90003d41ec34ecaeda94", 1n);
  assert.equal(t, `0xa9059cbb${"0".repeat(24)}9858effd232b4033e47d90003d41ec34ecaeda94${"0".repeat(63)}1`);
});
