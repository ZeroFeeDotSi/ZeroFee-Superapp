// Finding 3 (4 Nov): Solana's display reads go to ZeroFee's relay (/v0/sol/read, Helius) first and the free nodes after;
// a relay that isn't there, refuses the page or has no key rests and the free nodes answer; a send or a test run never
// goes to it. Answers replayed through fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain } from "./solana.ts";
import { SOL_PROXY, setSolProxy, solProxyFor } from "./sol-proxy.ts";

const RELAY = "https://quotes.example/v0/sol/read";
const WALLET = "GBPDDnczHRaVUgKFXrPhkcRYjyhCb7JsTdaeuJqhpTJJ";  // generated sample

function nodes(answer: (url: string, method: string) => Response) {
  const asked: { url: string; method: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { method } = JSON.parse(String(init.body)) as { method: string };
    asked.push({ url: String(url), method });
    return answer(String(url), method);
  }) as typeof fetch;
  return { asked, restore: () => void ((globalThis.fetch = real), setSolProxy(null)) };
}
const ok = (value: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value } }));

test("finding 3: a balance read asks the relay first, and its answer is the balance", async () => {
  setSolProxy(RELAY);
  const n = nodes((url) => (url === RELAY ? ok(7_000_000) : ok(1)));
  try {
    assert.equal(await new RpcSolChain().balance(WALLET), 7_000_000n);
    assert.deepEqual(n.asked[0], { url: RELAY, method: "getBalance" });
  } finally {
    n.restore();
  }
});

test("finding 3: a relay without its key (503) rests a minute, and the free nodes answer that read and the next", async () => {
  setSolProxy(RELAY);
  const n = nodes((url) => (url === RELAY ? new Response(JSON.stringify({ code: "quotes.not-configured" }), { status: 503 }) : ok(5)));
  try {
    assert.equal(await new RpcSolChain().balance(WALLET), 5n);
    assert.ok(SOL_PROXY.restUntil > Date.now(), "resting");
    n.asked.length = 0;
    assert.equal(await new RpcSolChain().balance(WALLET), 5n);
    assert.ok(!n.asked.some((a) => a.url === RELAY), "not asked while it rests");
  } finally {
    n.restore();
  }
});

test("finding 3: only reads the relay passes on go to it; no relay set, none does", () => {
  setSolProxy(RELAY);
  assert.equal(solProxyFor("getBalance"), RELAY);
  assert.equal(solProxyFor("sendTransaction"), null);
  // phone tests (5 Nov): a trade's test run goes through the paid door too; a send never does
  assert.equal(solProxyFor("simulateTransaction"), RELAY);
  setSolProxy("http://quotes.example/v0/sol/read");
  assert.equal(solProxyFor("getBalance"), null, "only an https relay");
  setSolProxy(null);
  assert.equal(solProxyFor("getBalance"), null);
});
