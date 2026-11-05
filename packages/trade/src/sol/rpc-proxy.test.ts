// Finding 3 (4 Nov): Trade's Solana reads ask ZeroFee's relay (/v0/sol/read) first on the real nodes, never for a send;
// a relay that rests is passed over, and a test's own nodes never see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { setSolProxy } from "@zerofee/core/sol-proxy";
/** A wallet the relay reads (base58): a read of something that is no address skips the relay (relay-shape.test.ts). */
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample
import { createSolRpc, SOL_NODES } from "./rpc.ts";

const RELAY = "https://quotes.example/v0/sol/read";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("finding 3: a read goes to the relay first; a send goes to the free nodes only", async () => {
  setSolProxy(RELAY);
  try {
    const asked: string[] = [];
    const f = (async (url: string) => (asked.push(url), json({ jsonrpc: "2.0", id: 1, result: url }))) as unknown as typeof fetch;
    const rpc = createSolRpc({ fetch: f, now: () => 1_000_000 });
    assert.equal(await rpc.call("getBalance", [WALLET]), RELAY);
    asked.length = 0;
    assert.equal(await rpc.call("sendTransaction", ["AA=="]), SOL_NODES[0]);
    assert.ok(!asked.includes(RELAY), "a send never goes to the read relay");
  } finally {
    setSolProxy(null);
  }
});

test("finding 3: a relay that isn't deployed (404) rests, and the free nodes answer; a test's own nodes never ask it", async () => {
  setSolProxy(RELAY);
  try {
    const asked: string[] = [];
    const f = (async (url: string) => (asked.push(url), url === RELAY ? json({}, 404) : json({ jsonrpc: "2.0", id: 1, result: url }))) as unknown as typeof fetch;
    const rpc = createSolRpc({ fetch: f, now: () => Date.now() });
    assert.equal(await rpc.call("getSlot"), SOL_NODES[0]);
    asked.length = 0;
    await rpc.call("getSlot");
    assert.ok(!asked.includes(RELAY), "resting after its 404");
    const own = createSolRpc({ nodes: ["https://a", "https://b"], fetch: f });
    asked.length = 0;
    await own.call("getSlot");
    assert.ok(!asked.includes(RELAY));
  } finally {
    setSolProxy(null);
  }
});

test("product decision, 4 Nov: a relay 429 is asked once more before the free nodes, and answering it is first again (control: a second 429 goes to the free nodes)", async () => {
  setSolProxy(RELAY);
  try {
    const asked: string[] = [];
    let busy = 1;
    const f = (async (url: string) => (asked.push(url), url === RELAY && busy-- > 0 ? json({}, 429) : json({ jsonrpc: "2.0", id: 1, result: url }))) as unknown as typeof fetch;
    const rpc = createSolRpc({ fetch: f, now: () => Date.now() });
    assert.equal(await rpc.call("getLatestBlockhash"), RELAY, "the paid door's second answer, not a free node's");
    assert.deepEqual(asked, [RELAY, RELAY]);
    asked.length = 0;
    assert.equal(await rpc.call("getBalance", [WALLET]), RELAY, "it answered, so it is first again");
    busy = 2;
    asked.length = 0;
    assert.equal(await rpc.call("getBalance", [WALLET]), SOL_NODES[0], "control: twice busy, a free node answers");
    assert.deepEqual(asked, [RELAY, RELAY, SOL_NODES[0]]);
  } finally {
    setSolProxy(null);
  }
});
