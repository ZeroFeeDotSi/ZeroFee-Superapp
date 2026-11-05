// Every free node scored (data stream, product decision, 3 Nov): a 429
// rests that node and the next answers, never an error; a slow node gives its place; a node that refuses a kind of read
// isn't asked it again for a while; Solana's indexed read goes first to the node that serves it. No network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEALTH, NodeHealth, outcomeOf, REFUSED_MS, REST_FIRST_MS, scored } from "./node-health.ts";
import { RpcSolChain, SOL_INDEXED_NODES, SOL_NODES } from "./solana.ts";
import { EVM_NODES, RpcEvmChain } from "./evm.ts";

const A = "https://a.example", B = "https://b.example", C = "https://c.example";

test("rank: the configured order while nothing is known; a busy node rests (2 s doubling) and the next answers first", () => {
  let t = 0;
  const h = new NodeHealth(() => t);
  assert.deepEqual(h.rank([A, B, C]), [A, B, C], "unknown: as configured");
  h.note(A, "busy");
  assert.deepEqual(h.rank([A, B, C]), [B, C, A], "a 429: last, still asked last (never dropped)");
  t += REST_FIRST_MS + 1;
  assert.deepEqual(h.rank([A, B, C]), [A, B, C], "rested: back in its place");
  h.note(A, "busy"); h.note(A, "busy");
  t += REST_FIRST_MS * 2 + 1;
  assert.deepEqual(h.rank([A, B, C]), [B, C, A], "two in a row: rests twice as long");
  h.note(A, "ok", 50);
  assert.deepEqual(h.rank([A, B, C]), [A, B, C], "an answer ends the rest");
});

test("rank: a node clearly slower than the best gives up its place; a small difference keeps the configured order", () => {
  const h = new NodeHealth(() => 0);
  h.note(A, "ok", 2_500); h.note(B, "ok", 300);
  assert.deepEqual(h.rank([A, B, C]), [B, C, A], "rpc.mainnet.near.org-like 2.5 s goes after dRPC's 0.3 s (C unknown keeps its place)");
  let t = 0;
  const later = new NodeHealth(() => t);
  later.note(A, "ok", 2_500); later.note(B, "ok", 300);
  t += 61_000;
  assert.deepEqual(later.rank([A, B]), [A, B], "a latency not refreshed in a minute is forgotten: A is measured again");
  const g = new NodeHealth(() => 0);
  g.note(A, "ok", 200); g.note(B, "ok", 120);
  assert.deepEqual(g.rank([A, B]), [A, B], "control: 80 ms apart keeps the order (FastNEAR first)");
});

test("rank: a refusal is per kind of read and lasts 30 minutes; resting nodes come back soonest first", () => {
  let t = 0;
  const h = new NodeHealth(() => t);
  h.note(A, "refused", 10, "getTokenAccountsByOwner");
  assert.deepEqual(h.rank([A, B], "getTokenAccountsByOwner"), [B, A]);
  assert.deepEqual(h.rank([A, B], "getBalance"), [A, B], "another read: A still first");
  t += REFUSED_MS + 1;
  assert.deepEqual(h.rank([A, B], "getTokenAccountsByOwner"), [A, B], "after 30 minutes it is asked again");
  h.note(A, "down"); h.note(A, "down"); h.note(B, "down");
  assert.deepEqual(h.rank([A, B, C]), [C, B, A], "B back sooner than A");
  const g = new NodeHealth(() => 0);
  g.note(A, "refused", 10, "getTokenAccountsByOwner");
  assert.deepEqual(g.serving([A, B], "getTokenAccountsByOwner"), [B], "a hedged read never waits on a node that will say no");
  g.note(B, "refused", 10, "getTokenAccountsByOwner");
  assert.deepEqual(g.serving([A, B], "getTokenAccountsByOwner"), [A, B], "control: every node refuses, all are still asked");
});

test("outcomeOf: 429 and rate-limit errors are busy; 5xx down; key/plan/method refusals refused; a chain's own error is an answer", () => {
  assert.equal(outcomeOf(429), "busy");
  assert.equal(outcomeOf(200, '{"code":-32005,"message":"rate limit"}'), "busy");
  assert.equal(outcomeOf(503), "down");
  assert.equal(outcomeOf(403, '{"code":-32602,"message":"Request blocked"}'), "refused");
  assert.equal(outcomeOf(200, '{"code":-32602,"message":"Indexed requests require a personal token."}'), "refused");
  assert.equal(outcomeOf(400, '{"code":-32602,"message":"getTokenAccountsByOwner is not available"}'), "refused");
  assert.equal(outcomeOf(200), "ok");
  assert.equal(outcomeOf(200, '{"code":-32002,"message":"Transaction simulation failed"}'), "ok", "the chain said no: the node answered");
});

test("scored: time and outcome per call; a failed fetch or a timeout counts, the answer passes through", async () => {
  let t = 0;
  const h = new NodeHealth(() => t);
  const ok = await scored(A, "m", async () => new Response('{"result":1}'), (r) => r.json(), h);
  assert.deepEqual(ok, { result: 1 });
  await assert.rejects(scored(B, "m", async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, (r) => r.json(), h));
  await assert.rejects(scored(C, "m", async () => new Response('{"error":{"message":"Too many requests"}}', { status: 429 }), (r) => r.json(), h), /HTTP 429/, "a 429 is no answer");
  assert.deepEqual(h.rank([B, C, A]), [A, B, C], "the two that failed rest; the one that answered leads");
});

function fakeFetch(answer: (host: string, method: string) => Response) {
  const asked: { host: string; method: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const host = new URL(String(url)).host;
    const { method } = JSON.parse(String(init.body)) as { method: string };
    asked.push({ host, method });
    return answer(host, method);
  }) as typeof fetch;
  return { asked, done: () => void (globalThis.fetch = real) };
}

test("Solana: the indexed read (a site wallet's coins) goes first to solanavibestation, which serves it; a refusal elsewhere is learnt", async () => {
  HEALTH.reset();
  const vibes = new URL(SOL_INDEXED_NODES[0]!).host;
  const f = fakeFetch((host, method) => (host === vibes ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: [] } })) : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Indexed requests require a personal token" } }), { status: method === "getTokenAccountsByOwner" ? 403 : 200 })));
  try {
    assert.deepEqual(await new RpcSolChain().tokenAccounts("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), []);
    assert.equal(f.asked[0]!.host, vibes, "asked first");
    assert.ok(f.asked.every((a) => a.host === vibes), "answered at once: no other node asked");
  } finally { f.done(); HEALTH.reset(); }
  // control: the old order (publicnode first) is refused on both of the two configured nodes
  const g = fakeFetch((host) => (host === vibes ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ error: { code: -32602, message: "Request blocked" } }), { status: 403 })));
  try {
    await assert.rejects(new RpcSolChain(SOL_NODES.slice()).tokenAccounts("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), "the two configured nodes alone can't read it");
  } finally { g.done(); HEALTH.reset(); }
});

test("Solana and BNB display reads: a node answering 429 is skipped next time, and a spare answers; never an error", async () => {
  HEALTH.reset();
  const first = new URL(SOL_NODES[0]!).host;
  const f = fakeFetch((host) => (host === first ? new Response('{"error":"Too many requests"}', { status: 429 }) : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 7 } }))));
  try {
    const sol = new RpcSolChain();
    assert.equal(await sol.balance("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), 7n);
    const before = f.asked.length;
    assert.equal(await sol.balance("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"), 7n);
    assert.ok(f.asked.slice(before).every((a) => a.host !== first), "the busy node rests: not asked again at once");
  } finally { f.done(); HEALTH.reset(); }
  const bnb = new URL(EVM_NODES.bsc[0]!).host, second = new URL(EVM_NODES.bsc[1]!).host;
  const g = fakeFetch((host) => (host === bnb || host === second ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" }))));
  try {
    assert.equal(await new RpcEvmChain().read("bsc", "eth_getBalance", ["0x000000000000000000000000000000000000dEaD", "latest"]), "0x1", "both configured nodes down: a read spare answers");
  } finally { g.done(); HEALTH.reset(); }
});
