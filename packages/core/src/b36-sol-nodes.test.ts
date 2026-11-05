// B36 (product decision, 3 Nov, F: a $1.27 Trade buy raised the full sheet with "Only one network server could check this").
// Join tests on the RECORDED answers of the core's two Solana nodes (testing/fixtures/b36-sol-nodes.json: one live
// Jupiter buy for a large public wallet, read only), replayed through fetch:
// - publicnode refuses an account read of more than 10 ("A maximum of 10 accounts is allowed"), which dropped its whole
//   answer; pocket.network refuses simulateTransaction (-32602). Together: no node, `ok: false`.
// - a matched pair (both nodes, the same coins) that still read `agreed: false` because publicnode's answer was dropped.
// - two nodes 21 slots apart, 0.028 % apart on a coin: read again by the coverage audit (3 Nov) as the pool moving between
//   them; agreed now within 1 %, with a 2 % control that is a real disagreement.
// Each case has a control that fails on the code before B36.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RpcSolChain, SOL_ACCOUNTS_PER_READ, SOL_NODES, SOL_SIM_NODES } from "./solana.ts";

type Rpc = { jsonrpc: "2.0"; id: number; result?: unknown; error?: unknown };
interface NodeRec { getBalance: Rpc; getMultipleAccountsOver10: Rpc | null; accounts: Record<string, unknown>; simulateTransaction: Rpc }
const F = JSON.parse(readFileSync(new URL("./testing/fixtures/b36-sol-nodes.json", import.meta.url), "utf8")) as { wallet: string; cases: Record<string, { watch: string[]; nodes: Record<string, NodeRec> }> };
const PUBLICNODE = "https://solana-rpc.publicnode.com", POCKET = "https://solana.api.pocket.network";

/** fetch replaying one recorded case: each node answers as it did; an account read of more than 10 gets the node's own
 *  refusal when it refused one; any other read is served from what that node returned, in the order asked. */
function replay(name: string) {
  const c = F.cases[name]!;
  const asked: { host: string; method: string; n?: number }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const host = new URL(String(url)).host;
    const rec = c.nodes[host];
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    const send = (body: unknown) => new Response(JSON.stringify(body));
    if (!rec) return send({ jsonrpc: "2.0", id: 1, error: { code: -1, message: "no recording" } });
    if (method === "getMultipleAccounts") {
      const keys = params[0] as string[];
      asked.push({ host, method, n: keys.length });
      if (keys.length > 10 && rec.getMultipleAccountsOver10) return send(rec.getMultipleAccountsOver10);
      return send({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: keys.map((k) => rec.accounts[k] ?? null) } });
    }
    asked.push({ host, method });
    if (method === "getBalance") return send(rec.getBalance);
    if (method === "simulateTransaction") return send(rec.simulateTransaction);
    return send({ jsonrpc: "2.0", id: 1, error: { code: -1, message: `not recorded: ${method}` } });
  }) as typeof fetch;
  return { c, asked, restore: () => (globalThis.fetch = real) };
}
const both = () => new RpcSolChain(SOL_NODES, [PUBLICNODE, POCKET]);

test("B36 (d), review M1, phone test, 3 Nov: the test run is asked on three operators, publicnode, solanavibestation, then pocket.network (it serves the test run about half the time); reads stay on both", () => {
  // control: the list before M1 ([publicnode] alone, one server's check for every caller) fails here
  assert.deepEqual(SOL_SIM_NODES, [PUBLICNODE, "https://public.rpc.solanavibestation.com", POCKET]);
  assert.notDeepEqual([PUBLICNODE], SOL_SIM_NODES);
  assert.ok(SOL_NODES.includes(POCKET), "pocket.network still answers the other reads");
  assert.equal(SOL_ACCOUNTS_PER_READ, 10);
});

test("B36 recorded: pocket.network refuses the test run (-32602) and publicnode refuses a 16-account read; batched by 10, publicnode's full answer is one server's check, ok", async () => {
  const { c, asked, restore } = replay("pocketRefusesTestRun");
  try {
    assert.equal(c.watch.length, 16);
    const s = await new RpcSolChain().simulate("AA==", F.wallet, c.watch);
    assert.equal(s.ok, true, "control: the code before B36 read this as ok:false (both answers dropped)");
    assert.equal(s.servers, 1);
    assert.equal(s.agreed, false, "one server is never 'agreed'");
    assert.ok(asked.filter((a) => a.method === "getMultipleAccounts").every((a) => (a.n ?? 0) <= 10), "never more than 10 accounts in one read");
    // pocket is asked (a third sim node, 3 Nov) and refuses here as recorded: its refusal is no answer, never a disagreement
    assert.ok(s.tokens?.some((t) => t.after > t.before), "the wallet's coin coming in is read");
    // the same answers on both nodes as before B36's pairing: still one server (pocket refused), never a disagreement
    const s2 = await both().simulate("AA==", F.wallet, c.watch);
    assert.equal(s2.servers, 1);
    assert.equal(s2.ok, true);
  } finally {
    restore();
  }
});

test("B36 recorded: a matched pair (both nodes, the same coins at 13 accounts) reads agreed:true", async () => {
  const { c, restore } = replay("matchedPair");
  try {
    assert.equal(c.watch.length, 13);
    const s = await both().simulate("AA==", F.wallet, c.watch);
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, true, 2], "control: the code before B36 read agreed:false (publicnode's 13-account read refused)");
  } finally {
    restore();
  }
});

test("B36 recorded, read again (coverage audit, 3 Nov): two nodes 21 slots apart, the same coin before, 36,010,000,000 vs 36,020,000,000 in (0.028 %): the pool moved between them, as MPLX's; they agree, held to the fewer. The same recording with one node 2 % apart is a disagreement, never one server's ok", async () => {
  let mint = "";
  const { c, restore } = replay("coinsDisagree");
  try {
    // control: with no coin named as what the trade pays, every coin must agree exactly: a disagreement, as recorded
    const exact = await both().simulate("AA==", F.wallet, c.watch);
    assert.deepEqual([exact.ok, exact.agreed, exact.servers], [true, false, 2]);
    mint = exact.tokens!.find((t) => t.before === 834_694_675_459_207_006n)!.mint;
    const s = await both().simulate("AA==", F.wallet, c.watch, { received: [mint] });
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, true, 2]);
    const coin = s.tokens!.find((t) => t.before === 834_694_675_459_207_006n)!;
    assert.equal(coin.after - coin.before, 36_010_000_000n, "held to the fewer in");
    const [a, b] = Object.values(c.nodes).map((n) => JSON.stringify(n.simulateTransaction));
    assert.notEqual(a, b, "control: the two recorded answers do differ");
  } finally {
    restore();
  }
  // control: pocket's answer moved to 2 % more coin in: a real disagreement
  const pocket = F.cases.coinsDisagree!.nodes[new URL(POCKET).host]!;
  const saved = JSON.stringify(pocket.simulateTransaction);
  const acc = (pocket.simulateTransaction.result as { value: { accounts: { data: [string, string] }[] } }).value.accounts[5]!;
  const bytes = Buffer.from(acc.data[0], "base64");
  bytes.writeBigUInt64LE(834_694_675_459_207_006n + (36_010_000_000n * 102n) / 100n, 64);
  acc.data[0] = bytes.toString("base64");
  const r = replay("coinsDisagree");
  try {
    const s = await both().simulate("AA==", F.wallet, r.c.watch, { received: [mint] });
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, false, 2], "2 % apart: not agreed, the sheet asks");
  } finally {
    r.restore();
    pocket.simulateTransaction = JSON.parse(saved);
  }
});

test("B36 boundary (QA): a node whose answer is an error body never counts as answering; only a full, readable test run does", async () => {
  const real = globalThis.fetch;
  const A = "https://a.example", B = "https://b.example";
  const bodies: Record<string, (method: string) => unknown> = {};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body)) as { method: string };
    return new Response(JSON.stringify(bodies[new URL(String(url)).origin]!(method)));
  }) as typeof fetch;
  const fine = (method: string) => ({ jsonrpc: "2.0", id: 1, result: method === "getBalance" ? { value: 10_000_000_000 } : method === "getMultipleAccounts" ? { value: [] } : { value: { err: null, accounts: [{ lamports: 9_999_995_000, owner: "11111111111111111111111111111111" }] } } });
  const refuses = () => ({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "simulateTransaction is not served by this endpoint" } });
  try {
    const chain = new RpcSolChain([A, B], [A, B]);
    bodies[A] = fine;
    bodies[B] = refuses;
    const one = await chain.simulate("AA==", "wallet");
    assert.deepEqual([one.ok, one.agreed, one.servers], [true, false, 1], "B's error body is not an answer");
    bodies[A] = refuses;
    const none = await chain.simulate("AA==", "wallet");
    assert.deepEqual([none.ok, none.servers], [false, 0], "two error bodies: nobody answered, never ok");
    // a test run that ran and failed is an answer, and never ok
    bodies[A] = (m) => (m === "simulateTransaction" ? { jsonrpc: "2.0", id: 1, result: { value: { err: { InstructionError: [0, "Custom"] }, accounts: [{ lamports: 1, owner: "11111111111111111111111111111111" }] } } } : fine(m));
    const failed = await chain.simulate("AA==", "wallet");
    assert.deepEqual([failed.ok, failed.servers], [false, 1]);
    // control: both fine is two servers that agree
    bodies[A] = fine;
    bodies[B] = fine;
    const two = await chain.simulate("AA==", "wallet");
    assert.deepEqual([two.ok, two.agreed, two.servers], [true, true, 2]);
  } finally {
    globalThis.fetch = real;
  }
});
