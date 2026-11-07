// Speed (the test real-money run, 3 Nov): the core's test run waited for the slower of two simulation nodes (0.72 s
// against 0.29 s) on every trade. Trade's own buy may be checked by one server (B36), so its test run stops waiting a
// short grace after the first full answer; everything else (a sale, a site's request) still waits for both nodes,
// which must agree. Timers here are the grace only (0 ms), never the wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain, SIM_RETRIES, SIM_SALE_GRACE_MS } from "./solana.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { POCKET_COIN, buy, pocketNode, sell } from "./testing/pocket-tx.ts";
import { MemoryVault } from "./vault.ts";

const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

/** Node a answers at once; node b only when `release()` is called. */
function nodes() {
  const real = globalThis.fetch;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    if (String(url).includes("b.example")) await held;
    const result = method === "getBalance" ? { value: 10_000_000 } : { value: { err: null, accounts: [{ lamports: 9_000_000, owner: "11111111111111111111111111111111" }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return { release, restore: () => (globalThis.fetch = real) };
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("firstFull: the first full answer and a 0 ms grace decide, as one server (control: without it, the slow node is waited for)", async () => {
  const n = nodes();
  try {
    const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"], 0);
    const s = await chain.simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.ok, true);
    assert.equal(s.servers, 1, "one server's answer: B36's rule decides what it may sign");
    assert.equal(s.agreed, false, "never 'agreed' on one answer");
    assert.equal(s.lamportsAfter, 9_000_000n);
    // control: the same nodes without firstFull wait for node b
    let done = false;
    const both = chain.simulate("AA==", WALLET).then((r) => ((done = true), r));
    await tick();
    assert.equal(done, false, "waits for the second node");
    n.release();
    const r = await both;
    assert.equal(r.servers, 2);
    assert.equal(r.agreed, true);
  } finally { n.restore(); }
});

test("firstFull: a second node within the grace still counts (two that agree say so)", async () => {
  const n = nodes();
  n.release();
  try {
    const s = await new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"], 1_000).simulate("AA==", WALLET, [], { firstFull: true });
    assert.equal(s.servers, 2);
    assert.equal(s.agreed, true);
  } finally { n.restore(); }
});

test("graceMs (Trade's own sale): a second node a moment after the first still counts as two that agree (control: the buy's grace decides on one)", async () => {
  const n = nodes();
  try {
    const chain = new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"], 0);
    const sale = chain.simulate("AA==", WALLET, [], { firstFull: true, graceMs: 60_000 });
    await tick();
    n.release();
    const s = await sale;
    assert.deepEqual([s.servers, s.agreed], [2, true]);
  } finally { n.restore(); }
  const m = nodes();
  try {
    const s = await new RpcSolChain(["https://a.example", "https://b.example"], ["https://a.example", "https://b.example"], 0).simulate("AA==", WALLET, [], { firstFull: true });
    assert.deepEqual([s.servers, s.agreed], [1, false], "control: no graceMs, the 0 ms grace decides on one");
  } finally { m.release(); m.restore(); }
});

/** Trade's wallet on a node that records whether each test run was asked with firstFull. */
async function core() {
  const node = pocketNode();
  const asked: (boolean | number)[] = [];
  const sol = {
    blockhashValid: (b: string) => node.blockhashValid(b),
    lookupTables: (k: string[]) => node.lookupTables(k),
    simulate: (tx: string, wallet: string, watch?: string[], o?: { firstFull?: boolean; graceMs?: number }) => (asked.push(o?.firstFull === true ? o.graceMs ?? true : false), node.simulate(tx, wallet, watch)),
    executable: async (k: string[]) => k.map(() => false),
    mintDecimals: async () => 6,
  } as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, usdPrice: async (c) => (c === "sol" ? 150 : null), marketPrice: async () => 20, approve: async () => false, emit: () => {} });
  const t = await w.create("trade", "sol");
  return { w, t, asked };
}

test("Trade's own buy asks for firstFull, its own sale for firstFull with the longer sale grace (the crawl, 4 Nov): its preflight and its tap (control: the same buy and sale from no app wait for both)", async () => {
  const s = await core();
  await s.w.preflight(s.t.id, buy(s.t.address, 10), "trade");
  await s.w.signTx(s.t.id, buy(s.t.address, 11), "", undefined, "Trade", undefined, "trade").catch(() => undefined);
  assert.deepEqual(s.asked, [true, true], "Trade's own buy: preflight and tap");
  s.asked.length = 0;
  await s.w.preflight(s.t.id, sell(s.t.address, POCKET_COIN, 20), "trade");
  await s.w.signTx(s.t.id, sell(s.t.address, POCKET_COIN, 21), "", undefined, "Trade", undefined, "trade").catch(() => undefined);
  assert.deepEqual(s.asked, [SIM_SALE_GRACE_MS, SIM_SALE_GRACE_MS], "Trade's own sale: a second node only within the sale grace");
  s.asked.length = 0;
  await s.w.signTx(s.t.id, sell(s.t.address, POCKET_COIN, 22), "", undefined, "Trade", undefined, undefined).catch(() => undefined);
  assert.deepEqual(s.asked, [false], "the same sale from no app: both nodes");
  s.asked.length = 0;
  await s.w.signTx(s.t.id, buy(s.t.address, 13), "", undefined, "Trade", undefined, undefined).catch(() => undefined);
  assert.deepEqual(s.asked, [false], "the same buy from no app (ZeroFee's own screens): both nodes");
});

// The phone test, 3 Nov: every Solana sale asked the sheet ("Only one server could test it"): the second node
// answered 429. A sale still needs two full answers that agree; a third node, and one more try per node, bring the second.
function three(answers: Record<string, (n: number) => "full" | "busy" | "other">) {
  const real = globalThis.fetch;
  const count: Record<string, number> = {};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const host = new URL(String(url)).host;
    const { method } = JSON.parse(String(init.body));
    // each try asks getBalance and the test run at once: a try is counted by its getBalance
    if (method === "getBalance") count[host] = (count[host] ?? 0) + 1;
    const how = answers[host]!(count[host] ?? 1);
    if (how === "busy") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 429, message: "Too many requests" } }));
    const result = method === "getBalance" ? { value: 10_000_000 } : { value: { err: null, accounts: [{ lamports: how === "other" ? 5_000_000 : 21_000_000, owner: "11111111111111111111111111111111" }] } };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  }) as typeof fetch;
  return { count, restore: () => (globalThis.fetch = real) };
}
const sim3 = () => new RpcSolChain(["https://a.example"], ["https://a.example", "https://b.example", "https://c.example"], 0, 0);

test("a sale: the second node busy, the third answers in full: two that agree (control: two nodes only, one busy, is one server)", async () => {
  const n = three({ "a.example": () => "full", "b.example": () => "busy", "c.example": () => "full" });
  try {
    const s = await sim3().simulate("AA==", WALLET);
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, true, 2]);
    assert.equal(s.lamportsAfter, 21_000_000n, "a sale's SOL back");
    const two = await new RpcSolChain(["https://a.example"], ["https://a.example", "https://b.example"], 0, 0).simulate("AA==", WALLET);
    assert.deepEqual([two.agreed, two.servers], [false, 1], "control: the run's case before the third node");
  } finally { n.restore(); }
});

test("a node busy once answers on its next try; one busy on every try is no answer", async () => {
  const n = three({ "a.example": () => "full", "b.example": (k) => (k === 1 ? "busy" : "full"), "c.example": () => "busy" });
  try {
    const s = await sim3().simulate("AA==", WALLET);
    assert.deepEqual([s.agreed, s.servers], [true, 2]);
    assert.equal(n.count["b.example"], 2, "b asked twice");
  } finally { n.restore(); }
  // one busy twice is no answer: a and that node alone are one server
  const m = three({ "a.example": () => "full", "b.example": () => "busy", "c.example": () => "busy" });
  try {
    const s = await sim3().simulate("AA==", WALLET);
    assert.deepEqual([s.agreed, s.servers], [false, 1]);
    assert.equal(m.count["b.example"], 1 + SIM_RETRIES, "b asked 1 + SIM_RETRIES times");
  } finally { m.restore(); }
});

test("the first two full answers decide: a third that disagrees with the first is a disagreement, never outvoted (control: two that agree)", async () => {
  const n = three({ "a.example": () => "full", "b.example": () => "busy", "c.example": () => "other" });
  try {
    const s = await sim3().simulate("AA==", WALLET);
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, false, 2], "two full answers far apart: not agreed, the sheet asks");
  } finally { n.restore(); }
});
