// The free nodes as they behaved on 25 Oct 2026: one refuses reads of more than 10 accounts, one answers 429, one is slow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSolEngine } from "./engine.ts";
import { createSolRpc } from "./rpc.ts";
import { replay, TEST_OWNER } from "./testing/replay.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a node that rate-limits rests: the next calls go to the others first, and it comes back later", async () => {
  const clock = { t: 0 };
  const asked: string[] = [];
  const f = (async (url: string) => { asked.push(url); return url === "https://a" ? json({}, 429) : json({ jsonrpc: "2.0", id: 1, result: url }); }) as unknown as typeof fetch;
  const rpc = createSolRpc({ nodes: ["https://a", "https://b", "https://c"], fetch: f, now: () => clock.t });
  assert.equal(await rpc.call("getSlot"), "https://b", "a answered 429, so b answered");
  asked.length = 0;
  assert.equal(await rpc.call("getSlot"), "https://b");
  assert.deepEqual(asked, ["https://b"], "a is resting, so it isn't asked first");
  const raced = await rpc.askNodes("getSlot", [], 2);
  assert.deepEqual(raced.map((r) => r.node).sort(), ["https://b", "https://c"], "a race uses the two healthy nodes");
  clock.t += 16_000;
  asked.length = 0;
  await rpc.call("getSlot");
  assert.equal(asked[0], "https://a", "after its rest it is first again");
});

test("a chain's own answer (a JSON-RPC error) is not a node failure: the node keeps its place", async () => {
  const clock = { t: 0 };
  const f = (async (url: string) => (url === "https://a" ? json({ jsonrpc: "2.0", id: 1, error: { message: "Invalid param" } }) : json({ jsonrpc: "2.0", id: 1, result: "b" }))) as unknown as typeof fetch;
  const rpc = createSolRpc({ nodes: ["https://a", "https://b"], fetch: f, now: () => clock.t });
  await rpc.call("getSlot");
  const raced = await rpc.askNodes("getSlot", [], 1);
  assert.equal(raced[0]!.node, "https://a");
});

test("a node that never answers is given up on after the timeout and rests", async () => {
  const f = (async (url: string, init: RequestInit) => (url === "https://slow" ? new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))) : json({ jsonrpc: "2.0", id: 1, result: "fast" }))) as unknown as typeof fetch;
  const rpc = createSolRpc({ nodes: ["https://slow", "https://fast"], fetch: f, timeoutMs: 50 });
  assert.equal(await rpc.call("getSlot"), "fast");
  assert.equal((await rpc.askNodes("getSlot", [], 1))[0]!.node, "https://fast");
});

test("reads of more than 10 accounts go out in chunks of 10, so a node with that limit still answers all of them", async () => {
  const fixture = replay({ rows: {} });
  const sizes: number[] = [];
  const limited = {
    ...fixture,
    askNodes: async (m: string, p: unknown[], n?: number, o?: { until?: (a: any) => boolean }) => {
      if (m === "getMultipleAccounts") { sizes.push((p[0] as string[]).length); if ((p[0] as string[]).length > 10) return [{ ok: false as const, error: "HTTP 403 A maximum of 10 accounts is allowed" }]; }
      return fixture.askNodes(m, p, n, o);
    },
  };
  // a coin with no curve and no canonical pool: discovery reads the 12 derived CP-Swap pools
  const engine = createSolEngine({ rpc: limited, owner: TEST_OWNER, solUsd: async () => 100, now: () => 0 });
  assert.equal(await engine.tryDirect("buy", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", { usd: 1 }), undefined);
  assert.ok(sizes.every((n) => n <= 10), `read sizes ${sizes.join(", ")}`);
  assert.ok(sizes.includes(10) && sizes.includes(2), "the 12 pools as 10 + 2");
});

// 3 Nov, measured on mainnet: publicnode answers getTokenAccountsByOwner 403 "Indexed requests require a personal token"
// after ~3.2 s, Pocket 400 "not available"; only vibestation serves it, so held coins arrived 1-4 s late on every read.
test("a node that refuses a METHOD is asked that method last for 30 min, even after it answers other calls well; other methods keep their order (controls)", async () => {
  const clock = { t: 1_000 };
  const asked: string[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body));
    asked.push(`${url}:${method}`);
    if (method === "getTokenAccountsByOwner" && url === "https://pub") return new Response("Indexed requests require a personal token. Get one at: https://www.allnodes.com/publicnode", { status: 403 });
    if (method === "getTokenAccountsByOwner" && url === "https://pocket") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "getTokenAccountsByOwner is not available" } }), { status: 400 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: url }), { status: 200 });
  }) as unknown as typeof fetch;
  const rpc = createSolRpc({ nodes: ["https://pub", "https://pocket", "https://vibe"], fetch: f, now: () => clock.t });
  assert.equal(await rpc.call("getTokenAccountsByOwner", []), "https://vibe");
  assert.equal(await rpc.call("getBalance", []), "https://pub", "control: publicnode still first for what it serves");
  asked.length = 0;
  assert.equal(await rpc.call("getTokenAccountsByOwner", []), "https://vibe");
  assert.deepEqual(asked, ["https://vibe:getTokenAccountsByOwner"], "straight to the node that serves it, after a good getBalance from the others");
  clock.t += 30 * 60_000 + 1;
  asked.length = 0;
  await rpc.call("getTokenAccountsByOwner", []);
  assert.equal(asked[0], "https://pub:getTokenAccountsByOwner", "after 30 min it is asked again in its place");
});

test("publicnode's 403 for more than 10 accounts rests the node as before, never the whole method for 30 min (control)", async () => {
  const clock = { t: 1_000 };
  let big = true;
  const f = (async (url: string) => (url === "https://pub" && big ? new Response("A maximum of 10 accounts is allowed", { status: 403 }) : new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: url }), { status: 200 }))) as unknown as typeof fetch;
  const rpc = createSolRpc({ nodes: ["https://pub", "https://other"], fetch: f, now: () => clock.t });
  assert.equal(await rpc.call("getMultipleAccounts", []), "https://other");
  big = false;
  clock.t += 120_001;   // past the node's own rest
  assert.equal(await rpc.call("getMultipleAccounts", []), "https://pub", "the method isn't held against it for 30 min");
});
