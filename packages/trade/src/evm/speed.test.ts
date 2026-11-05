// What a quote costs, the old engine's speed tests with their numbers. The fee case is the old engine's live finding: one
// BNB Chain node (rpc-bsc.48.club) answered eth_gasPrice / eth_maxPriorityFeePerGas with 1 gwei where five said 0.05 gwei,
// and a single read of it made a $7 buy from a $7.10 wallet "not enough for the fee".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLASSIC, refuses } from "./chains.ts";
import { paidPrice } from "./context.ts";
import { createEvmEngine } from "./engine.ts";
import type { NodeAnswer } from "./rpc.ts";
import { makeWorld, TEST_OWNER, type World, kyberCapture } from "./testing/world.ts";
import { parseTx } from "./tx.ts";
const ky = kyberCapture(JSON.parse(readFileSync(new URL("./fixtures/evm-golden.json", import.meta.url), "utf8")));

const DEP = CLASSIC.bsc;
const TOKEN = "0x" + "ab".repeat(20), PAIR = "0x" + "cd".repeat(20);
const BNB_USD = 600;
const gwei = (n: number) => BigInt(Math.round(n * 1e9));
const NODES = [{ url: "https://rpc-bsc.48.club", v: gwei(1) }, { url: "https://bsc-dataseed.bnbchain.org", v: gwei(0.05) }, { url: "https://bsc-dataseed1.defibit.io", v: gwei(0.05) }];

function setup(o: Partial<World> = {}, nodes: { url: string; v: bigint; tip?: bigint }[] = NODES) {
  const x = makeWorld({ ky, chain: "bsc", symbol: "TST", balance: 10n ** 17n, baseFee: 0n, gasPrice: gwei(0.05), tip: gwei(0.05), v2: { pair: PAIR, token: TOKEN, rToken: 5_000_000n * 10n ** 18n, rWeth: 2_000n * 10n ** 18n },
    extra: (m, p) => (m === "eth_call" && p[0]?.from ? "0x" : undefined), ...o });
  // three nodes that disagree on the fee: the outlier answers first
  const fee: string[] = [];
  const askNodes = x.rpc.askNodes;
  x.rpc.askNodes = async (m, p, max = 2, opts) => {
    if (m !== "eth_gasPrice" && m !== "eth_maxPriorityFeePerGas") return askNodes(m, p, max, opts);
    const out: NodeAnswer[] = [];
    for (const n of nodes.slice(0, max)) { fee.push(`${m} ${n.url}`); const a: NodeAnswer = { ok: true, value: "0x" + (m === "eth_maxPriorityFeePerGas" ? n.tip ?? n.v : n.v).toString(16), node: n.url }; out.push(a); if (opts?.until?.(a)) break; }
    return out;
  };
  const clock = { t: 1_800_000_000_000 };
  const engine = createEvmEngine({ chain: "bsc", owner: TEST_OWNER, nativeUsd: async () => BNB_USD, rpc: x.rpc, fetch: x.fetch, now: () => clock.t });
  return { ...x, engine, clock, fee };
}

test("FIXED: with the outlier answering first, a $7 buy from a $7.10 wallet is quoted every time, and the fee line is the same $0.0x each time", async () => {
  const s = setup({ balance: 11_833_333_333_333_333n });
  const fees: number[] = [];
  for (let i = 0; i < 6; i++) { fees.push((await s.engine.prepare("buy", TOKEN, { usd: 7 })).quote.feeUsd); s.clock.t += 2_500; }
  assert.equal(new Set(fees).size, 1);
  assert.ok(fees[0]! < 0.02 && fees[0]! > 0, `fee ${fees[0]}`);
});

test("BNB Chain reports a base fee of 0 but enforces a minimum gas price: the fee cap is never under the nodes' own gas price (+ 20 %)", async () => {
  const s = setup({}, NODES.slice(1).map((n) => ({ ...n, tip: 0n })));
  const t = parseTx((await s.engine.prepare("buy", TOKEN, { usd: 5 })).steps[0]!.tx);
  assert.ok(t.maxFeePerGas >= (gwei(0.05) * 6n) / 5n, `cap ${t.maxFeePerGas}`);
  assert.equal(t.maxPriorityFeePerGas, 0n);
});

test("the gas price and tip are the median of three nodes, and two that agree end the wait", async () => {
  const s = setup();
  const t = parseTx((await s.engine.prepare("buy", TOKEN, { usd: 5 })).steps[0]!.tx);
  assert.equal(t.maxPriorityFeePerGas, (gwei(0.05) * 6n + 4n) / 5n, "0.05 gwei + 20 %, never the outlier's 1 gwei");
  assert.ok(s.fee.length <= 6);
  assert.equal(new Set(s.fee.map((f) => f.split(" ")[1])).size, 3);
});

test("the fee line is this transaction's gas x what the chain charges (base fee + tip, capped)", () => {
  assert.equal(paidPrice({ maxFeePerGas: 100n, maxPriorityFeePerGas: 7n }, 20n), 27n);
  assert.equal(paidPrice({ maxFeePerGas: 25n, maxPriorityFeePerGas: 7n }, 20n), 25n);
});

test("v2: warm() reads the pool, decimals, fee, balance, nonce and one gas estimate; then amount changes cost no node call but the one proof, and no KyberSwap call", async () => {
  const s = setup();
  await s.engine.warm(TOKEN);
  assert.equal(s.calls.filter((c) => c.method === "eth_estimateGas").length, 1, "one per route, once");
  s.calls.length = 0;
  for (const usd of [5, 7, 9, 12]) { assert.equal((await s.engine.prepare("buy", TOKEN, { usd })).quote.route, "PancakeSwap v2"); s.clock.t += 300; }
  // the port proves the exact steps by simulation at most every 4 s (the old engine sent a presigned transaction unproven): that is the one call
  assert.deepEqual(s.calls.map((c) => [c.method, c.params[0]?.to]), [["eth_call", DEP.v2Router]]);
  assert.ok(s.calls[0]!.params[0].from, "a simulation from the wallet");
  assert.deepEqual(s.fetched, []);
});

test("v2: 5 s later one more amount change reads the reserves, the balance and the nonce in ONE round trip (and proves the swap again), never estimating gas or asking for fees", async () => {
  const s = setup();
  await s.engine.warm(TOKEN);
  s.clock.t += 5_000;
  s.calls.length = 0;
  await s.engine.prepare("buy", TOKEN, { usd: 8 });
  assert.deepEqual(s.calls.map((c) => c.method).sort(), ["eth_call", "eth_call", "eth_getBalance", "eth_getTransactionCount"]);
  assert.ok(s.calls.some((c) => c.method === "eth_call" && c.params[0].to === PAIR), "the reserves");
});

test("v2: the quote is local maths and a local transaction once warm: a new amount inside the windows asks no node and no KyberSwap at all", async () => {
  const s = setup();
  await s.engine.warm(TOKEN);
  await s.engine.prepare("buy", TOKEN, { usd: 5 });                    // the first quote's one proof
  s.calls.length = 0;
  s.clock.t += 300;
  const p = await s.engine.prepare("buy", TOKEN, { usd: 6 });
  assert.deepEqual(s.calls, [], "the reserves, the wallet, the fee, the gas and the proof all come from memory");
  assert.deepEqual(s.fetched, []);
  assert.deepEqual(p.steps.map((x) => x.id), ["swap"]);
});

test("the quote path never asks Robinhood's publicnode for eth_getBalance / eth_getLogs, drpc for eth_getLogs, or BNB Chain's publicnode for receipts", () => {
  assert.equal(refuses("hood", "https://robinhood-rpc.publicnode.com", "eth_getBalance"), true);
  assert.equal(refuses("hood", "https://robinhood-rpc.publicnode.com", "eth_getLogs"), true);
  assert.equal(refuses("hood", "https://robinhood.drpc.org", "eth_getLogs"), true);
  assert.equal(refuses("hood", "https://robinhood.drpc.org", "eth_getBalance"), false);
  assert.equal(refuses("bsc", "https://robinhood-rpc.publicnode.com", "eth_getBalance"), false);
  assert.equal(refuses("bsc", "https://bsc-rpc.publicnode.com", "eth_getTransactionReceipt"), true);
});
