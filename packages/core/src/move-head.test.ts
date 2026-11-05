// k-account, Safe → SOL Move on 5071d0a7 (4 Nov, CRAWL.md "## 5071d0a7 Move"): presses 1 and 2 said "NEAR is busy
// right now", the passkey sheet came on press 3. The Safe's own reads go through the relay's paid FastNEAR door (D139), but
// the agreed head (block) and the gas price went only to the free doors (review L2, L4): FastNEAR's free door at 429,
// Intear at 429 ("wait 47 s"), NEAR's own node not answering in time, so the head had one operator and the Move said busy.
// Now, while the Safe is being read through the relay, the relay stands in for FastNEAR's free door on a head or a gas price
// when that door is busy: still two operators that must agree (the relay's FastNEAR and dRPC). The clock never moves here.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NODES, NodePace, RpcChain, proxySafe } from "./chain.ts";
import { setNearProxy } from "./near-proxy.ts";

const SAFE = "zf-k0000000000.near";
const HEAD = { header: { hash: "11111111111111111111111111111111", height: 10 } };
const view = { amount: "3000000000000000000000000", storage_usage: 182, code_hash: "11111111111111111111111111111111" };
const answer = (v: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: v }), { status: 200 });
const fastnear429 = () => new Response(JSON.stringify({ error: { code: -429, message: "Rate limits exceeded." } }), { status: 429 });
const intea429 = () => new Response("Rate limit exceeded, retry after 47 seconds", { status: 429, headers: { "retry-after": "47" } });

function moveNet(relay = true, browser = false) {
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    const host = new URL(url).host;
    asked.push(`${host} ${method}`);
    if (host === "relay.example") return relay ? (method === "gas_price" ? answer({ gas_price: "100000000" }) : method === "block" ? answer(HEAD) : answer(view)) : new Response("resting", { status: 503 });
    if (host === "rpc.mainnet.fastnear.com") {
      if (browser) throw new TypeError("Failed to fetch"); // a browser sees a 429 without CORS headers as a failed fetch (D2)
      return fastnear429();
    }
    if (host === "rpc.intea.rs") return intea429();
    if (host === "rpc.mainnet.near.org") throw new TypeError("Failed to fetch"); // its preflight's 429, or no answer in time
    return method === "gas_price" ? answer({ gas_price: "100000000" }) : method === "block" ? answer(HEAD) : answer(view);
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}

async function withoutTheClock<T>(p: Promise<T>): Promise<T | "waited on the clock"> {
  const stuck = new Promise<"waited on the clock">((r) => {
    let turns = 0;
    const turn = () => (++turns > 400 ? r("waited on the clock") : setImmediate(turn));
    setImmediate(turn);
  });
  return Promise.race([p.catch((e) => Promise.reject(e)), stuck]);
}

const done = () => {
  mock.timers.reset();
  setNearProxy(null);
  proxySafe(null);
};

test("k-account Move, press 1: the agreed head and the gas price are read with FastNEAR's free door and Intear at 429, through the relay", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(done);
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const { fetchFn, asked } = moveNet();
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  // Home read the Safe a moment ago (its balance), through the relay
  assert.equal((await c.account(SAFE, { hash: HEAD.header.hash, height: 10 }))?.balanceYocto, 3n * 10n ** 24n);
  const press = async () => {
    const block = await c.commonBlock();
    return { block, gas: await c.gasPrice(block) };
  };
  const got = await withoutTheClock(press()).catch((e) => `rejected: ${e?.problem?.whatHappened ?? e}`);
  assert.deepEqual(got, { block: { hash: HEAD.header.hash, height: 10 }, gas: 100000000n });
  assert.ok(asked.includes("relay.example block") && asked.includes("near.drpc.org block"), "two operators agreed on the head");
});

test("k-account Move in a browser: FastNEAR's 429 seen as a failed fetch, the head still comes through the relay", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(done);
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const { fetchFn } = moveNet(true, true);
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  await c.account(SAFE, { hash: HEAD.header.hash, height: 10 });
  const got = await withoutTheClock(c.commonBlock()).catch((e) => `rejected: ${e?.problem?.whatHappened ?? e}`);
  assert.deepEqual(got, { hash: HEAD.header.hash, height: 10 });
});

test("control (L2, L4): no Safe read through the relay, no head through it: a head read alone never tells the relay when", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(done);
  setNearProxy("https://relay.example/v0/near");
  const { fetchFn, asked } = moveNet();
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  await withoutTheClock(c.commonBlock()).catch(() => undefined);
  assert.ok(!asked.some((a) => a.startsWith("relay.example")), asked.join(", "));
});

test("control (L2): with FastNEAR's free door answering, the head goes there, never to the relay", async (t) => {
  t.after(done);
  setNearProxy("https://relay.example/v0/near");
  proxySafe(SAFE);
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const { method } = JSON.parse(init.body);
    asked.push(`${new URL(url).host} ${method}`);
    return method === "block" ? answer(HEAD) : answer(view);
  }) as unknown as typeof fetch;
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 60_000, new NodePace());
  await c.account(SAFE, { hash: HEAD.header.hash, height: 10 });
  await c.commonBlock();
  assert.ok(asked.includes("rpc.mainnet.fastnear.com block") && !asked.includes("relay.example block"), asked.join(", "));
});
