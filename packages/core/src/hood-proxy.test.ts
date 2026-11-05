// Robinhood Chain through ZeroFee's relay (/v0/rh/rpc, Alchemy): the core asks the door first in Robinhood's own node's
// slot and that node after on a failure, a 429 or a 503; a send goes through it too; a door without its key rests and the
// free nodes answer; a method it doesn't pass on, BNB Chain and an unset door never go to it. Answers replayed through fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVM_NODES, RpcEvmChain } from "./evm.ts";
import { HOOD_PROXY, hoodNodes, setHoodProxy } from "./hood-proxy.ts";

const DOOR = "https://quotes.example/v0/rh/rpc";
const [PUBLIC, DRPC] = EVM_NODES.hood as [string, string];
const WALLET = "0x1111111111111111111111111111111111111111";

function nodes(answer: (url: string, method: string) => Response) {
  const asked: { url: string; method: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body)) as { method: string };
    asked.push({ url: String(url), method });
    return answer(String(url), method);
  }) as typeof fetch;
  return { asked, restore: () => void ((globalThis.fetch = real), setHoodProxy(null)) };
}
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
const problem = (status: number) => new Response(JSON.stringify({ code: "quotes.not-configured", whatHappened: "x", money: { state: "not-involved" } }), { status });

test("rh door: a nonce read asks the relay's door first in Robinhood's node's slot, and dRPC as the second operator", async () => {
  setHoodProxy(DOOR);
  const n = nodes(() => ok("0x5"));
  try {
    assert.equal(await new RpcEvmChain().nonce("hood", WALLET), 5);
    const urls = n.asked.map((a) => a.url).sort();
    assert.deepEqual(urls, [DOOR, DRPC].sort(), "the door takes the public node's slot; dRPC still checks it");
    assert.ok(!urls.includes(PUBLIC), "the public node isn't asked while the door answers");
  } finally {
    n.restore();
  }
});

test("rh door: a send goes through the door first", async () => {
  setHoodProxy(DOOR);
  const n = nodes(() => ok(`0x${"ab".repeat(32)}`));
  try {
    await new RpcEvmChain().send("hood", Buffer.from("02f8", "hex").toString("base64")).catch(() => undefined);
    assert.ok(n.asked.some((a) => a.url === DOOR && a.method === "eth_sendRawTransaction"));
  } finally {
    n.restore();
  }
});

test("rh door: no key (503) rests the door a minute; the public node answers that read and the next goes straight to it", async () => {
  setHoodProxy(DOOR);
  const n = nodes((url) => (url === DOOR ? problem(503) : ok("0x7")));
  try {
    const chain = new RpcEvmChain();
    assert.equal(await chain.nonce("hood", WALLET), 7);
    assert.ok(HOOD_PROXY.restUntil > Date.now(), "resting");
    assert.ok(n.asked.some((a) => a.url === PUBLIC), "fell back to the public node");
    n.asked.length = 0;
    assert.equal(await chain.nonce("hood", WALLET), 7);
    assert.ok(!n.asked.some((a) => a.url === DOOR), "a resting door isn't asked");
  } finally {
    n.restore();
  }
});

test("rh door: a 429 and a dead relay fall back to the public node for that read, without resting the door", async () => {
  for (const door of [() => problem(429), () => { throw new TypeError("fetch failed"); }]) {
    setHoodProxy(DOOR);
    const n = nodes((url) => (url === DOOR ? door() : ok("0x9")));
    try {
      assert.equal(await new RpcEvmChain().nonce("hood", WALLET), 9);
      assert.ok(n.asked.some((a) => a.url === PUBLIC));
      assert.equal(HOOD_PROXY.restUntil, 0);
    } finally {
      n.restore();
    }
  }
});

test("rh door: a JSON-RPC error from the door is the chain's answer, not a reason to ask the public node", async () => {
  setHoodProxy(DOOR);
  const n = nodes((url) => (url === DOOR ? new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted" } })) : ok("0x1")));
  try {
    await assert.rejects(new RpcEvmChain().tokenBalance("hood", WALLET, WALLET));
    assert.ok(!n.asked.some((a) => a.url === PUBLIC));
  } finally {
    n.restore();
  }
});

test("rh door: controls: unset, BNB Chain and eth_getLogs never go to the door", async () => {
  const n = nodes(() => ok("0x3"));
  try {
    assert.equal(await new RpcEvmChain().nonce("hood", WALLET), 3);
    assert.ok(!n.asked.some((a) => a.url === DOOR), "unset: straight to the nodes");
    setHoodProxy(DOOR);
    n.asked.length = 0;
    await new RpcEvmChain().nonce("bsc", WALLET);
    assert.ok(!n.asked.some((a) => a.url === DOOR), "BNB Chain never");
    assert.deepEqual(hoodNodes([PUBLIC], "eth_getLogs"), [PUBLIC]);
    assert.deepEqual(hoodNodes([PUBLIC, DRPC], "eth_call"), [DOOR, PUBLIC, DRPC], "one list a node of the person's own can be put ahead of");
    setHoodProxy("http://quotes.example/v0/rh/rpc");
    assert.equal(HOOD_PROXY.url, null, "never a plain-http door");
  } finally {
    n.restore();
  }
});
