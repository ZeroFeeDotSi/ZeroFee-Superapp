// a real-money test, 4 Nov (real money, QA's fetch trace): three pump.fun Adds in a row said "NEAR is busy" for 3 minutes.
// rpc.mainnet.fastnear.com answered 429 ("get a subscription") and rpc.intea.rs 429 ("retry after 47 seconds"), while
// near.drpc.org and NEAR's own node answered. Each money read waited out FastNEAR's 429 (1 s, then 2 s) before a stand-in
// was asked, so the Add's reads ran out of time. Now a 429 hands the read to the next node at once while one is left to
// ask (only the last one waits a 429 out). Product decision, 4 Nov: NEAR's own node is deprecated (-429 to every call) and gone; with
// FastNEAR's free door at 429, dRPC and Intear answer. Still two operators that agree on money. The clock is mocked.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NODES, NodePace, RpcChain, SHOWN_SPARES, proxySafe } from "./chain.ts";
import { setNearProxy } from "./near-proxy.ts";

const BLOCK = { hash: "11111111111111111111111111111111", height: 1 };
const view = { amount: "3000000000000000000000000", storage_usage: 182, code_hash: "11111111111111111111111111111111" };
const answer = (v: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: v }), { status: 200 });
const fastnear429 = () => new Response(JSON.stringify({ error: { code: -429, message: "Rate limits exceeded. For higher rate limits get a subscription at https://fastnear.com" } }), { status: 429 });

/** The real-money test trace's network, as it is today: FastNEAR's free door at 429, dRPC and Intear answering. */
function kPump(final?: unknown) {
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    const host = new URL(url).host;
    asked.push(`${host} ${method}`);
    if (host === "rpc.mainnet.fastnear.com") return fastnear429();
    if (method === "send_tx" || method === "tx") return answer(final);
    if (method === "gas_price") return answer({ gas_price: "100000000" });
    return answer(view);
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

/** Settles `p` with the clock stopped: a read that waits on a timer never settles here. */
async function withoutTheClock<T>(p: Promise<T>): Promise<T | "waited on the clock"> {
  const stuck = new Promise<"waited on the clock">((r) => {
    let turns = 0;
    const turn = () => (++turns > 400 ? r("waited on the clock") : setImmediate(turn));
    setImmediate(turn);
  });
  return Promise.race([p, stuck]);
}

test("real-money test: a money read with FastNEAR at 429 is answered by dRPC and Intear at once, waiting out no 429", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const { fetchFn, asked } = kPump();
  // the real network's pace: two 429 retries per node, 1 s doubling to 8 s (NodePace's own defaults)
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  const got = await withoutTheClock(c.account("zf-0000000a04.near", BLOCK));
  assert.notEqual(got, "waited on the clock", "a 429 was waited out while another node could answer");
  assert.equal((got as { balanceYocto: bigint } | null)?.balanceYocto, 3n * 10n ** 24n);
  assert.ok(asked.some((a) => a.startsWith("rpc.intea.rs")), "Intear stood in for FastNEAR");
  assert.ok(!asked.some((a) => a.startsWith("rpc.mainnet.near.org")), "never NEAR's deprecated node");
});

test("real-money test: the next reads of the Add (gas price, a view) skip FastNEAR's cool-down at once too", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const { fetchFn } = kPump();
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  for (let i = 0; i < 3; i++) {
    const gas = await withoutTheClock(c.gasPrice(BLOCK));
    assert.equal(gas, 100000000n, `read ${i + 1} waited on the clock`);
  }
});

test("real-money test: the Add's send goes to dRPC at once when FastNEAR answers 429, and its outcome is agreed by dRPC and Intear", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const final = { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [] };
  const { fetchFn, asked } = kPump(final);
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  const got = await withoutTheClock(c.send("AAAA", "h", "sw-site-pump-sol.zf-0000000a04.near"));
  assert.notEqual(got, "waited on the clock", "the send waited out a 429 while dRPC could take it");
  assert.deepEqual(got, { status: "done", value: null, partly: false });
  assert.ok(asked.includes("near.drpc.org send_tx"));
});

test("control: with only one node left to ask, its 429 is still waited out (never 'busy' while a node can answer)", async () => {
  let n = 0;
  const fetchFn = (async () => (++n === 1 ? new Response("busy", { status: 429, headers: { "retry-after": "0.001" } }) : answer({ gas_price: "7" }))) as unknown as typeof fetch;
  const c = new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 60_000, new NodePace(4, 1, 2, 2, 8, 5_000));
  assert.equal(await c.gasPrice(BLOCK), 7n);
});

test("k-account, Safe → SOL Move (13:11:30): every read before the passkey sheet answers at once with FastNEAR at 429 and the relay resting", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    mock.timers.reset();
    setNearProxy(null);
    proxySafe(null);
  });
  const SAFE = "zf-k0000000000.near";
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const { method, params } = JSON.parse(init.body);
    const host = new URL(url).host;
    asked.push(`${host} ${method}`);
    if (host === "relay.example") return new Response("resting", { status: 503 });
    if (host === "rpc.mainnet.fastnear.com") return fastnear429();
    if (method === "block") return answer({ header: { hash: "11111111111111111111111111111111", height: host === "near.drpc.org" ? 11 : 10 } });
    if (method === "gas_price") return answer({ gas_price: "100000000" });
    if (params?.request_type === "view_access_key") return answer({ nonce: 7, permission: "FullAccess" });
    if (params?.request_type === "view_access_key_list") return answer({ keys: [] });
    if (params?.request_type === "call_function") return answer({ result: [...new TextEncoder().encode('"5"')], logs: [] });
    return answer(view);
  }) as unknown as typeof fetch;
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  const reads = async () => {
    const block = await c.commonBlock();
    const [acct, key, keys, gas, bal] = await Promise.all([
      c.account(SAFE, block),
      c.accessKey(SAFE, "ed25519:11111111111111111111111111111111", block),
      c.accessKeys(SAFE, block),
      c.gasPrice(block),
      c.view("intents.near", "mt_balance_of", { account_id: SAFE, token_id: "nep141:wrap.near" }, block),
    ]);
    return { acct, key, keys, gas, bal };
  };
  const got = await withoutTheClock(reads());
  assert.notEqual(got, "waited on the clock", "a read before the sheet waited out a 429 while another node could answer");
  const r = got as Awaited<ReturnType<typeof reads>>;
  assert.equal(r.acct?.balanceYocto, 3n * 10n ** 24n);
  assert.equal(r.gas, 100000000n);
  assert.equal(r.bal, "5");
  assert.ok(r.key, "the Safe's key was read, so the sheet can open");
});

test("the phone's core may reach every NEAR node the reader asks (CoreContext.coreHosts)", () => {
  const swift = readFileSync(new URL("../../../apps/ios/ZeroFee/CoreContext.swift", import.meta.url), "utf8");
  const listed = new Set([...swift.slice(swift.indexOf("static let coreHosts")).split("]")[0].matchAll(/"([a-z0-9.-]+)"/g)].map((m) => m[1]));
  for (const url of [...NODES.mainnet, ...NODES.testnet, ...SHOWN_SPARES]) assert.ok(listed.has(new URL(url).hostname), `${new URL(url).hostname} is missing from coreHosts`);
});

test("UI test, Home's Swap: the Safe's deposit to NEAR Intents goes out and is confirmed at once with FastNEAR at 429 and the relay resting", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    mock.timers.reset();
    setNearProxy(null);
    proxySafe(null);
  });
  const SAFE = "zf-sample0000000.near";
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const final = { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [] };
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const host = new URL(url).host;
    asked.push(host);
    if (host === "relay.example") return new Response("resting", { status: 503 });
    if (host === "rpc.mainnet.fastnear.com") return fastnear429();
    void init;
    return answer(final);
  }) as unknown as typeof fetch;
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  const got = await withoutTheClock(c.send("AAAA", "h", SAFE));
  assert.notEqual(got, "waited on the clock", "the Swap's send or its outcome waited out a 429 while another node could answer");
  assert.deepEqual(got, { status: "done", value: null, partly: false });
});
