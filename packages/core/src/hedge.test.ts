// D134, D10: Solana's and the EVM chains' wallet reads ask the next node when the first fails or is slow, not after its
// 8 s timeout ("Solana didn't answer").
import { test } from "node:test";
import assert from "node:assert/strict";
import { hedged } from "./hedge.ts";
import { RpcSolChain } from "./solana.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("D10: a failed first node asks the next at once; a slow one after hedgeMs; the first answer wins", async () => {
  const asked: string[] = [];
  const t = Date.now();
  assert.equal(await hedged(["a", "b"], async (u) => (asked.push(u), u === "a" ? Promise.reject(new Error("429")) : "B"), 300), "B");
  assert.ok(Date.now() - t < 100, "at once after the failure, not after the hedge");
  const t2 = Date.now();
  assert.equal(await hedged(["a", "b"], async (u) => (u === "a" ? (await sleep(2_000), "A") : "B"), 50), "B");
  assert.ok(Date.now() - t2 < 500, "the slow first node isn't waited for");
  // control: a fast first node is the only one asked
  const only: string[] = [];
  assert.equal(await hedged(["a", "b"], async (u) => (only.push(u), "A"), 50), "A");
  await sleep(80);
  assert.deepEqual(only, ["a"]);
  await assert.rejects(hedged(["a", "b"], async () => Promise.reject(new Error("down")), 10), /down/);
});

test("D10: Solana's balance read stands in at once for a node that refuses (control: the old order waited for its failure first)", async () => {
  const asked: string[] = [];
  const fetchFn = (async (url: string) => {
    asked.push(url);
    if (url.includes("first")) await sleep(5_000);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { value: 42 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const real = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    const sol = new RpcSolChain(["https://first.example", "https://second.example"]);
    const t = Date.now();
    assert.equal(await sol.balance("11111111111111111111111111111111"), 42n);
    assert.ok(Date.now() - t < 1_500, `answered by the second node in ${Date.now() - t} ms, not after the first's timeout`);
  } finally {
    globalThis.fetch = real;
  }
});
