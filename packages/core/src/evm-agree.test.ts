// Audit D148 L1 (3 Nov): a trade's two-node test run counted as "agreed" when both nodes merely answered, and the coins it
// brings in were read from the first node's answer only. Now agreed means the same answer on the same block, every coin
// either node saw is counted at the lower of the two (the higher kept for a minimum's floor), and the run is priced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGREE_BPS, RpcEvmChain, sameSimulation } from "./evm.ts";

const WALLET = "0x" + "a".repeat(40);
const COIN = "0x" + "c".repeat(40);
const OTHER = "0x" + "d".repeat(40);
const NATIVE = "0x" + "e".repeat(40);
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + a.replace(/^0x/, "").padStart(64, "0");
const transferIn = (coin: string, amount: bigint) => ({ address: coin, topics: [TRANSFER, pad("0x" + "b".repeat(40)), pad(WALLET)], data: "0x" + amount.toString(16) });

interface Node {
  /** The last call's logs; a function of the gas price the run gave it (0 when unpriced). null: the node is down. */
  logs: unknown[] | null | ((gasprice: bigint) => unknown[]);
  status?: string;
  head?: string;
  /** Refuses the fee fields (a JSON-RPC error), as a node type might. */
  noFees?: boolean;
}
/** Two nodes at u1 and u2. Records each eth_getBalance / eth_simulateV1 block tag and each run's fee fields. */
function nodes(spec: Record<string, Node>) {
  const real = globalThis.fetch;
  const asked: { url: string; method: string; block: unknown; priced?: boolean }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method, params } = JSON.parse(String(init.body));
    const n = spec[url];
    if (n.logs === null) throw new Error("down");
    const reply = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    if (method === "eth_blockNumber") return reply(n.head ?? "0x10");
    if (method === "eth_getBalance") return asked.push({ url, method, block: params[1] }), reply("0x1000");
    const c = params[0].blockStateCalls[0].calls[0];
    asked.push({ url, method, block: params[1], priced: c.maxFeePerGas !== undefined });
    if (n.noFees && c.maxFeePerGas !== undefined) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "unknown field" } }));
    // tx.gasprice as a node sets it: min(cap, base + tip), base 0 here.
    const cap = c.maxFeePerGas ? BigInt(c.maxFeePerGas) : 0n, tip = c.maxPriorityFeePerGas ? BigInt(c.maxPriorityFeePerGas) : 0n;
    const gasprice = cap < tip ? cap : tip;
    const logs = typeof n.logs === "function" ? n.logs(gasprice) : n.logs;
    return reply([{ calls: [{ status: n.status ?? "0x1", ...(logs.length ? { logs } : {}) }] }]);
  }) as typeof fetch;
  return { asked, done: () => (globalThis.fetch = real) };
}
const chain = () => new RpcEvmChain({ hood: ["u1", "u2"], bsc: ["u1", "u2"] } as never);
const call = [{ from: WALLET, to: COIN, value: 0n, data: "0x", gas: 100_000n }];
/** A real trade's call: its own fees, a tip of 0 (as on Robinhood Chain). */
const feeCall = [{ ...call[0], maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 0n }];

test("two nodes that say different things are not agreed (the old code called them agreed); the lower is counted, the higher kept for the floor", async () => {
  const n = nodes({ u1: { logs: [transferIn(COIN, 1_000_000n)] }, u2: { logs: [transferIn(COIN, 500_000n)] } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.ok, true);
    assert.equal(sim.agreed, false, "a 50 % gap is a disagreement");
    assert.equal(sim.coinsIn?.get(COIN), 500_000n);
    assert.equal(sim.coinsInHigh?.get(COIN), 1_000_000n);
  } finally { n.done(); }
});

test("a coin only the second node saw is counted, and the answers don't agree", async () => {
  const n = nodes({ u1: { logs: [transferIn(COIN, 1_000n)] }, u2: { logs: [transferIn(COIN, 1_000n), transferIn(OTHER, 7n)] } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.agreed, false);
    assert.equal(sim.coinsIn?.has(OTHER), true, "never the first node's list alone");
    assert.equal(sim.coinsIn?.get(OTHER), 0n, "the lower: the first node saw none");
  } finally { n.done(); }
});

test("a sale's native coin: two nodes apart are not agreed; the lower is counted, the higher kept for the floor (control: the same amount agrees)", async () => {
  let n = nodes({ u1: { logs: [transferIn(NATIVE, 9_000n)] }, u2: { logs: [transferIn(NATIVE, 8_000n)] } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.agreed, false);
    assert.equal(sim.nativeIn, 8_000n);
    assert.equal(sim.nativeInHigh, 9_000n);
  } finally { n.done(); }
  n = nodes({ u1: { logs: [transferIn(NATIVE, 9_000n)] }, u2: { logs: [transferIn(NATIVE, 9_000n)] } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.agreed, true);
    assert.equal(sim.nativeIn, 9_000n);
  } finally { n.done(); }
});

test("one node runs it, the other reverts: not ok, not agreed", async () => {
  const n = nodes({ u1: { logs: [transferIn(COIN, 1_000n)] }, u2: { logs: [transferIn(COIN, 1_000n)], status: "0x0" } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.ok, false);
    assert.equal(sim.agreed, false);
  } finally { n.done(); }
});

test("one answer without its transfer logs is not agreed, and counts 0 there", async () => {
  const n = nodes({ u1: { logs: [transferIn(COIN, 1_000n), transferIn(NATIVE, 50n)] }, u2: { logs: [] } });
  try {
    const sim = await chain().simulate("hood", call);
    assert.equal(sim.ok, true);
    assert.equal(sim.agreed, false);
    assert.equal(sim.coinsIn?.get(COIN), 0n);
    assert.equal(sim.nativeIn, 0n);
  } finally { n.done(); }
});

test("both nodes run on one block, the lower head of the two; the balance is read there too (control: no block, latest)", async () => {
  const n = nodes({ u1: { logs: [transferIn(COIN, 1_000n)], head: "0x20" }, u2: { logs: [transferIn(COIN, 1_000n)], head: "0x1f" } });
  try {
    const c = chain();
    const head = await c.head("hood");
    assert.equal(head, 0x1fn);
    const sim = await c.simulate("hood", call, head);
    assert.equal(sim.agreed, true);
    assert.deepEqual(new Set(n.asked.map((a) => a.block)), new Set(["0x1f"]), "every read on block 0x1f");
    n.asked.length = 0;
    await c.simulate("hood", call);
    assert.deepEqual(new Set(n.asked.map((a) => a.block)), new Set(["latest"]));
  } finally { n.done(); }
});

test("head: null unless both nodes answer", async () => {
  const n = nodes({ u1: { logs: [], head: "0x20" }, u2: { logs: null } });
  try {
    assert.equal(await chain().head("hood"), null);
  } finally { n.done(); }
});

test("control: two nodes with the same answer agree, a hair apart now doesn't (one block, exact), one node silent never does", async () => {
  let n = nodes({ u1: { logs: [transferIn(COIN, 1_000_000n)] }, u2: { logs: [transferIn(COIN, 1_000_000n)] } });
  try {
    assert.equal((await chain().simulate("hood", call)).agreed, true);
  } finally { n.done(); }
  n = nodes({ u1: { logs: [transferIn(COIN, 1_000_000n)] }, u2: { logs: [transferIn(COIN, 999_500n)] } });
  try {
    assert.equal((await chain().simulate("hood", call)).agreed, false, "at one block honest nodes match exactly");
  } finally { n.done(); }
  n = nodes({ u1: { logs: [transferIn(COIN, 1_000_000n)] }, u2: { logs: null } });
  try {
    assert.equal((await chain().simulate("hood", call)).agreed, false, "one answer is not an agreement");
  } finally { n.done(); }
});

// A coin that takes 30 % only when tx.gasprice > 0 (audit D148 L1c).
const taxing = (gasprice: bigint) => [transferIn(COIN, gasprice > 0n ? 700_000n : 1_000_000n)];

test("L1c: a coin that taxes only when gasprice > 0 shows its tax in the priced run, even with a tip of 0 (control: the old unpriced run looked clean)", async () => {
  let n = nodes({ u1: { logs: taxing }, u2: { logs: taxing } });
  try {
    const sim = await chain().simulate("hood", feeCall);
    assert.equal(sim.coinsIn?.get(COIN), 700_000n, "the tax shows");
    assert.ok(n.asked.filter((a) => a.method === "eth_simulateV1").every((a) => a.priced));
  } finally { n.done(); }
  n = nodes({ u1: { logs: taxing }, u2: { logs: taxing } });
  try {
    const old = await chain().simulate("hood", call);
    assert.equal(old.agreed, true);
    assert.equal(old.coinsIn?.get(COIN), 1_000_000n, "control: unpriced, the tax hides");
  } finally { n.done(); }
});

test("L1c: a node that refuses the fee fields runs it unpriced; the two then differ on a taxing coin, so it isn't agreed", async () => {
  const n = nodes({ u1: { logs: taxing }, u2: { logs: taxing, noFees: true } });
  try {
    const sim = await chain().simulate("hood", feeCall);
    assert.equal(sim.ok, true, "the refusing node still answered, unpriced");
    assert.equal(sim.agreed, false);
    assert.equal(sim.coinsIn?.get(COIN), 700_000n);
    assert.deepEqual(n.asked.filter((a) => a.url === "u2" && a.method === "eth_simulateV1").map((a) => a.priced), [true, false]);
  } finally { n.done(); }
});

test("sameSimulation: outcome, coins and amounts, exactly (AGREE_BPS 0)", () => {
  const m = (e: [string, bigint][]) => new Map(e);
  const a = { ok: true, nativeIn: 1_000n, coins: m([[COIN, 10_000n]]) };
  assert.equal(AGREE_BPS, 0n);
  assert.equal(sameSimulation(a, { ...a }), true);
  assert.equal(sameSimulation(a, { ...a, ok: false }), false, "one ran, one reverted");
  assert.equal(sameSimulation(a, { ...a, nativeIn: 999n }), false);
  assert.equal(sameSimulation(a, { ...a, coins: m([[COIN, 9_999n]]) }), false, "a hair apart");
  assert.equal(sameSimulation(a, { ...a, coins: m([[COIN, -10_000n]]) }), false, "in on one, out on the other");
  assert.equal(sameSimulation(a, { ...a, coins: m([]) }), false, "a coin one node didn't see");
  assert.equal(sameSimulation({ ok: true, nativeIn: 0n, coins: m([]) }, { ok: true, nativeIn: 0n, coins: m([]) }), true, "nothing moves on both");
});
