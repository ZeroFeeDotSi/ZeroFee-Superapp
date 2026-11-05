// Trade on Robinhood Chain through ZeroFee's relay (/v0/rh/rpc, Alchemy): a call asks the door first and the free nodes
// after on a failure, a 429 or a 503; a send's race includes it; BNB Chain, a test's own nodes and eth_getLogs never go to
// it. Answers replayed through a fetch stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOOD_PROXY, setHoodProxy } from "@zerofee/core/hood-proxy";
import { createEvmRpc } from "./rpc.ts";
import { NODES } from "./chains.ts";

const DOOR = "https://quotes.example/v0/rh/rpc";
const FREE = NODES.hood.map((n) => n.url);

function fetchOf(answer: (url: string, method: string) => Response) {
  const asked: { url: string; method: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body)) as { method: string };
    asked.push({ url: String(url), method });
    return answer(String(url), method);
  }) as typeof fetch;
  return { asked, f };
}
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));

test("rh door: Trade's call asks the door first, and its answer is the answer", async () => {
  setHoodProxy(DOOR);
  try {
    const { asked, f } = fetchOf((url) => ok(url === DOOR ? "0x10" : "0x1"));
    assert.equal(await createEvmRpc({ chain: "hood", fetch: f }).call("eth_blockNumber"), "0x10");
    assert.deepEqual(asked.map((a) => a.url), [DOOR]);
  } finally {
    setHoodProxy(null);
  }
});

test("rh door: a 503 (no key) rests the door, a 429 doesn't; each falls back to the free nodes for that call", async () => {
  for (const [status, rests] of [[503, true], [429, false]] as const) {
    setHoodProxy(DOOR);
    try {
      const { asked, f } = fetchOf((url) => (url === DOOR ? new Response("{}", { status }) : ok("0x2")));
      assert.equal(await createEvmRpc({ chain: "hood", fetch: f }).call("eth_getBalance", ["0x1111111111111111111111111111111111111111", "latest"]), "0x2");
      assert.equal(asked[0]!.url, DOOR);
      assert.ok(FREE.includes(asked[1]!.url));
      assert.equal(HOOD_PROXY.restUntil > Date.now(), rests);
    } finally {
      setHoodProxy(null);
    }
  }
});

test("rh door: a send's race asks the door and every free node", async () => {
  setHoodProxy(DOOR);
  try {
    const { asked, f } = fetchOf(() => ok(`0x${"ab".repeat(32)}`));
    await createEvmRpc({ chain: "hood", fetch: f }).askNodes("eth_sendRawTransaction", ["0x02"], Number.POSITIVE_INFINITY);
    assert.equal(asked[0]!.url, DOOR);
    assert.deepEqual(new Set(asked.map((a) => a.url)), new Set([DOOR, ...FREE]));
  } finally {
    setHoodProxy(null);
  }
});

test("rh door: controls: unset, BNB Chain, a test's own nodes and eth_getLogs never go to the door", async () => {
  const { asked, f } = fetchOf(() => ok("0x1"));
  await createEvmRpc({ chain: "hood", fetch: f }).call("eth_blockNumber");
  setHoodProxy(DOOR);
  try {
    await createEvmRpc({ chain: "bsc", fetch: f }).call("eth_blockNumber");
    await createEvmRpc({ chain: "hood", nodes: ["https://node.example"], fetch: f }).call("eth_blockNumber");
    await createEvmRpc({ chain: "hood", fetch: f }).call("eth_getLogs", [{}]);
    assert.ok(!asked.some((a) => a.url === DOOR));
  } finally {
    setHoodProxy(null);
  }
});
