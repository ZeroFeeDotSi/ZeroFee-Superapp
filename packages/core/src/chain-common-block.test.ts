// commonBlock's fast path (speed, 2 Nov): two nodes already on the same final block agree without a third read; any
// other answer is checked as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NodePace, RpcChain } from "./chain.ts";

const head = (hash: string, height: number) => ({ result: { header: { hash, height } } });
const NODES = ["https://a.example", "https://b.example"];

test("two nodes on the same final block (height and hash) agree at once: no third read", async () => {
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    asked.push(`${url} ${JSON.parse(init.body).method}`);
    return new Response(JSON.stringify(head("H1", 7)), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await new RpcChain("testnet", NODES, fetchFn).commonBlock(), { hash: "H1", height: 7 });
  assert.equal(asked.length, 2, asked.join("\n"));
});

test("the agreed block is shared for a second, by callers at once and just after; a send or a second later reads it again", async () => {
  let asked = 0;
  // Both nodes give the same head each round (round = each pair of asks).
  const twin = (async () => {
    asked++;
    const round = Math.ceil(asked / 2);
    await new Promise((r) => setTimeout(r, 5));
    return new Response(JSON.stringify(head(`R${round}`, 7 + round)), { status: 200 });
  }) as unknown as typeof fetch;
  const pace = new NodePace();
  const chain = new RpcChain("testnet", ["https://c.example", "https://d.example"], twin, 200, pace);
  const [a, b] = await Promise.all([chain.commonBlock(), chain.commonBlock()]);
  assert.deepEqual(a, b);
  assert.deepEqual(await chain.commonBlock(), a, "kept just after");
  assert.equal(asked, 2, "one pair of heads for all three");
  pace.forgetHeads();
  assert.notDeepEqual(await chain.commonBlock(), a, "a send drops it");
  assert.equal(asked, 4);
  await new Promise((r) => setTimeout(r, 1_050));
  await chain.commonBlock();
  assert.equal(asked, 6, "older than a second: read again");
});

test("the same height under two hashes is still a disagreement", async () => {
  const split = (async (url: string) => new Response(JSON.stringify(head(url.includes("a.") ? "H1" : "H2", 7)), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(new RpcChain("testnet", NODES, split).commonBlock(), (e: any) => e.problem.code === "security.nodes.disagree");
});

test("different heights: the newer node is still asked for the older one's block, and must hold it", async () => {
  const asked: string[] = [];
  const apart = (forked: boolean) => (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    asked.push(`${url} ${body.method}`);
    if (body.params?.block_id === 7) return new Response(JSON.stringify(head(forked ? "X" : "H1", 7)), { status: 200 });
    return new Response(JSON.stringify(url.includes("a.") ? head("H1", 7) : head("H2", 8)), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await new RpcChain("testnet", NODES, apart(false)).commonBlock(), { hash: "H1", height: 7 });
  assert.equal(asked.length, 3);
  await assert.rejects(new RpcChain("testnet", NODES, apart(true)).commonBlock(), (e: any) => e.problem.code === "security.nodes.disagree");
});

test("different heights and the newer node stops answering: a third node stands in, and must hold the older one's block", async () => {
  const THREE = ["https://a.example", "https://b.example", "https://c.example"];
  const asked: string[] = [];
  const down = (standHash: string | null) => (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    asked.push(`${url} ${body.params?.block_id ?? "final"}`);
    if (body.params?.block_id === 7) {
      if (url.includes("b.")) return new Response("", { status: 503 });
      return standHash ? new Response(JSON.stringify(head(standHash, 7)), { status: 200 }) : new Response("", { status: 503 });
    }
    return new Response(JSON.stringify(url.includes("a.") ? head("H1", 7) : head("H2", 8)), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await new RpcChain("testnet", THREE, down("H1")).commonBlock(), { hash: "H1", height: 7 });
  assert.ok(asked.includes("https://c.example 7"), asked.join("\n"));
  await assert.rejects(new RpcChain("testnet", THREE, down("X")).commonBlock(), (e: any) => e.problem.code === "security.nodes.disagree", "another hash there: a disagreement");
  await assert.rejects(new RpcChain("testnet", THREE, down(null)).commonBlock(), (e: any) => e.problem.code === "security.nodes.unreachable", "no node holds it: unreachable, never agreed");
  await assert.rejects(new RpcChain("testnet", NODES, down("H1")).commonBlock(), (e: any) => e.problem.code === "security.nodes.unreachable", "two nodes only: no stand-in");
});
