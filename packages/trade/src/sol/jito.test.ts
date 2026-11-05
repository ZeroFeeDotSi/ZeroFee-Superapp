// Send speed A2a: the same signed bytes to Jito's fixed host, no tip; never the send's verdict, never a throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JITO_URL, jitoSender } from "./jito.ts";
import { createSolChain } from "./chain.ts";
import { signedTx } from "./testing/signed-tx.ts";

test("Jito gets exactly the signed bytes, at its one fixed host, as sendTransaction base64", async () => {
  const asked: [string, any][] = [];
  await jitoSender((async (u: string, init: RequestInit) => { asked.push([u, JSON.parse(String(init.body))]); return new Response("{}"); }) as never)("AQID");
  assert.deepEqual(asked, [[JITO_URL, { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AQID", { encoding: "base64" }] }]]);
  assert.equal(new URL(JITO_URL).host, "mainnet.block-engine.jito.wtf");
});

test("Jito down, or refusing: nothing thrown", async () => {
  await jitoSender((async () => { throw new Error("offline"); }) as never)("AQID");
  await jitoSender((async () => new Response("no", { status: 429 })) as never)("AQID");
});

test("a Solana send: the nodes decide; Jito gets the same bytes beside them and its failure changes nothing", async () => {
  const { signed, owner: OWNER } = signedTx();
  const toJito: string[] = [];
  const rpc = { call: async () => null, askNodes: async () => [{ ok: true, value: "x", node: "n1" }, { ok: false, error: "down", node: "n2" }] } as never;
  const chain = createSolChain({ rpc, owner: OWNER, solUsd: async () => 150, meta: async () => undefined, alsoSend: async (tx) => { toJito.push(tx); throw new Error("jito down"); } } as never);
  const hash = await chain.send(signed);
  assert.equal(typeof hash, "string");
  assert.deepEqual(toJito, [signed]);
  const refused = createSolChain({ rpc: { call: async () => null, askNodes: async () => [{ ok: false, error: "down", node: "n1" }] } as never, owner: OWNER, solUsd: async () => 150, meta: async () => undefined, alsoSend: async () => {} } as never);
  await assert.rejects(refused.send(signed), /No Solana node took the transaction/, "Jito never stands in for the nodes");
});
