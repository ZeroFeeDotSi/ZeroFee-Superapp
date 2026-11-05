// RpcEvmChain.simulate against two stand-in nodes (review M6, 3 Nov): coins from both nodes, the run's fee fields, and
// the gas the last call used. No network: fetch is replaced for each test and answers by node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVM_NODES, RpcEvmChain, type EvmCall } from "./evm.ts";

const A = "https://node-a.example", B = "https://node-b.example";
const chain = () => new RpcEvmChain({ ...EVM_NODES, eth: [A, B] });
const WALLET = "0x" + "11".repeat(20), ROUTER = "0x" + "22".repeat(20), POOL = "0x" + "33".repeat(20);
const COIN_X = "0x" + "aa".repeat(20), COIN_Y = "0x" + "bb".repeat(20);
const NATIVE = "0x" + "ee".repeat(20);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + a.slice(2).padStart(64, "0");
const transfer = (coin: string, from: string, to: string, amount: bigint) => ({ address: coin, topics: [TRANSFER, pad(from), pad(to)], data: "0x" + amount.toString(16).padStart(64, "0") });

type Call = { status?: string; gasUsed?: string; logs?: unknown[] };
/** Each node's answer to eth_simulateV1 (null: the node fails); every body sent, by node. */
function nodes(answers: { a: Call[] | null; b: Call[] | null }) {
  const asked: { node: string; method: string; params: any[] }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const node = String(url) === A ? "a" : String(url) === B ? "b" : assert.fail(`asked an unlisted node ${url}`);
    asked.push({ node, method, params });
    const calls = answers[node as "a" | "b"];
    const reply = (body: object) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }));
    if (calls === null) return reply({ error: { code: -32000, message: "down" } });
    if (method === "eth_getBalance") return reply({ result: "0xde0b6b3a7640000" });
    if (method === "eth_simulateV1") return reply({ result: [{ calls: calls.map((c) => ({ status: "0x1", logs: [], ...c })) }] });
    return assert.fail(`unexpected ${method}`);
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}

const buy: EvmCall = { from: WALLET, to: ROUTER, value: 10n ** 16n, data: "0x", gas: 300_000n };
const gotX = transfer(COIN_X, POOL, WALLET, 1000n);
const yLeaves = transfer(COIN_Y, WALLET, POOL, 500n);

test("M6: a coin only the second node sees leaving is in coinsIn, below 0, and agreed is false; both seeing it, agreed is true", async () => {
  let n = nodes({ a: [{ logs: [gotX] }], b: [{ logs: [gotX, yLeaves] }] });
  try {
    const sim = await chain().simulate("eth", [buy]);
    assert.equal(sim.coinsIn?.get(COIN_Y), -500n, "the second node's coin leaving is kept, at its lower value");
    assert.equal(sim.coinsIn?.get(COIN_X), 1000n);
    assert.equal(sim.ok, true);
    assert.equal(sim.agreed, false, "the two nodes' coin sets differ");
  } finally {
    n.restore();
  }
  // Control: both nodes see the same coins move the same way.
  n = nodes({ a: [{ logs: [gotX, yLeaves] }], b: [{ logs: [gotX, yLeaves] }] });
  try {
    const sim = await chain().simulate("eth", [buy]);
    assert.equal(sim.agreed, true);
    assert.deepEqual([...sim.coinsIn!].sort(), [[COIN_X, 1000n], [COIN_Y, -500n]]);
  } finally {
    n.restore();
  }
});

test("M6: gasUsed is the last call's, the higher of the two nodes' answers", async () => {
  // The earlier call used more gas than either answer for the last: only the last counts.
  let n = nodes({ a: [{ gasUsed: "0x100000" }, { gasUsed: "0x5208" }], b: [{ gasUsed: "0x100000" }, { gasUsed: "0x5346" }] });
  try {
    assert.equal((await chain().simulate("eth", [buy, buy])).gasUsed, 21_318n);
  } finally {
    n.restore();
  }
  n = nodes({ a: [{ gasUsed: "0x5346" }], b: [{ gasUsed: "0x5208" }] });
  try {
    assert.equal((await chain().simulate("eth", [buy])).gasUsed, 21_318n, "the higher, whichever node says it");
  } finally {
    n.restore();
  }
  // Control: one node answers, its figure; neither says, absent.
  n = nodes({ a: null, b: [{ gasUsed: "0x5208" }] });
  try {
    assert.equal((await chain().simulate("eth", [buy])).gasUsed, 21_000n);
  } finally {
    n.restore();
  }
  n = nodes({ a: [{}], b: [{ gasUsed: "nonsense" }] });
  try {
    assert.equal((await chain().simulate("eth", [buy])).gasUsed, undefined);
  } finally {
    n.restore();
  }
});
