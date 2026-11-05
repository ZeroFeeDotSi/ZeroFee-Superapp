// Send speed A1: the relay's paid node as one more door; only its answer of this very signature counts, and anything else
// leaves the public nodes' answer standing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELAY_SEND_PATH, relaySender } from "./relay-send.ts";
import { createSolChain } from "./chain.ts";
import { signedTx } from "./testing/signed-tx.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

test("no relay in the build, or not https: no relay door at all", () => {
  assert.equal(relaySender(undefined), undefined);
  assert.equal(relaySender("http://relay.example"), undefined);
  assert.equal(typeof relaySender("https://relay.example/"), "function");
});

test("it sends {tx} only, to the one route; true only for this transaction's own signature", async () => {
  const asked: [string, unknown][] = [];
  const send = relaySender("https://relay.example/", (async (u: string, init: RequestInit) => { asked.push([u, JSON.parse(String(init.body))]); return json({ signature: "SIG" }); }) as never)!;
  assert.equal(await send("AQID", "SIG"), true);
  assert.deepEqual(asked, [[`https://relay.example${RELAY_SEND_PATH}`, { tx: "AQID" }]]);
  assert.equal(await send("AQID", "OTHER"), false, "another signature is no proof");
});

test("503 (not set up), a limit, a broken answer, no answer: false, never a throw", async () => {
  for (const f of [async () => json({ error: "not set up" }, 503), async () => json({ error: "slow down" }, 429), async () => new Response("<html>"), async () => { throw new Error("offline"); }]) {
    assert.equal(await relaySender("https://relay.example", f as never)!("AQID", "SIG"), false);
  }
});

test("the send: public nodes first; with none taking it, the relay's own signature counts; neither, it isn't sent", async () => {
  const { signed, hash, owner } = signedTx();
  const nodes = (ok: boolean) => ({ call: async () => null, askNodes: async () => [{ ok, ...(ok ? { value: hash } : { error: "down" }), node: "n1" }] }) as never;
  const base = { owner, solUsd: async () => 150, meta: async () => undefined };
  // the nodes took it: sent, without waiting on a relay that never answers
  assert.equal(await createSolChain({ ...base, rpc: nodes(true), relaySend: () => new Promise<boolean>(() => {}) } as never).send(signed), hash);
  assert.equal(await createSolChain({ ...base, rpc: nodes(false), relaySend: async (_tx, h) => h === hash } as never).send(signed), hash);
  await assert.rejects(createSolChain({ ...base, rpc: nodes(false), relaySend: async () => false } as never).send(signed), /No Solana node took the transaction/);
  await assert.rejects(createSolChain({ ...base, rpc: nodes(false), relaySend: async () => { throw new Error("x"); } } as never).send(signed), /No Solana node took the transaction/);
});

test("the relay and Jito get a transaction's first send only: three rebroadcasts, one relay POST and one Jito call", async () => {
  const { signed, hash, owner } = signedTx();
  let relay = 0, jito = 0, nodes = 0;
  const chain = createSolChain({ owner, solUsd: async () => 150, meta: async () => undefined,
    rpc: { call: async () => null, askNodes: async () => { nodes++; return [{ ok: true, value: hash, node: "n1" }]; } } as never,
    relaySend: async () => { relay++; return true; }, alsoSend: async () => { jito++; } } as never);
  for (let i = 0; i < 4; i++) await chain.send(signed);
  assert.deepEqual([relay, jito, nodes], [1, 1, 4], "the public nodes every time; the relay and Jito once");
});
