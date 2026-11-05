import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { createReadCall, callResultOf } from "./receipts.ts";

const b64 = (v: unknown) => btoa(JSON.stringify(v));

/**
 * A `tx` answer in NEAR's shape for a share paid from a post-quantum account: the account contract's execute, then
 * intents.near's mt_transfer_call (answered by its resolve's receipt), the receiver's mt_on_transfer, the resolve.
 * Built from NEAR's RPC docs: no share has been paid on mainnet yet to record.
 */
function shareTx(o: { kept?: string; refused?: boolean } = {}) {
  const ok = (v: unknown) => ({ SuccessValue: b64(v) });
  return {
    status: ok({ ran: true }),
    receipts_outcome: [
      { id: "R1", outcome: { executor_id: "kid.near", status: ok({ ran: true }), logs: [] } },
      {
        id: "R2",
        outcome: {
          executor_id: "intents.near",
          status: o.refused ? { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "insufficient balance" } } } } } : { SuccessReceiptId: "R4" },
          logs: [],
        },
      },
      ...(o.refused ? [] : [
        { id: "R3", outcome: { executor_id: "trip.near", status: ok([o.kept === "0" ? "30000000" : "0"]), logs: [] } },
        { id: "R4", outcome: { executor_id: "intents.near", status: ok([o.kept ?? "30000000"]), logs: [] } },
      ]),
    ],
  };
}

test("the amount the receiver kept comes from intents.near's resolve, never from the receiver's own answer", () => {
  assert.deepEqual(callResultOf(shareTx()), { kind: "kept", units: 30_000_000n });
  assert.deepEqual(callResultOf(shareTx({ kept: "0" })), { kind: "kept", units: 0n });
  assert.deepEqual(callResultOf(shareTx({ kept: "10000000" })), { kind: "kept", units: 10_000_000n });
  assert.deepEqual(callResultOf(shareTx({ refused: true })), { kind: "failed" });
});

test("a step refused after the contract accepted the request is 'failed', whatever the transaction itself answered", () => {
  // A post-quantum account's mt_transfer, run detached by the account contract: the transaction says ran either way.
  const plain = (status: unknown) => ({
    status: { SuccessValue: b64({ ran: true }) },
    receipts_outcome: [
      { id: "R1", outcome: { executor_id: "kid.near", status: { SuccessValue: b64({ ran: true }) }, logs: [] } },
      { id: "R2", outcome: { executor_id: "intents.near", status, logs: [] } },
    ],
  });
  assert.deepEqual(callResultOf(plain({ SuccessValue: "" })), { kind: "ran" });
  assert.deepEqual(callResultOf(plain({ Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: "insufficient balance" } } } } })), { kind: "failed" });
  assert.equal(callResultOf({}), null, "nothing to read yet");
  assert.equal(callResultOf(null), null);
});

test("a paid transfer stays paid when the receiver's own forward fails after it: the resolve's answer wins", () => {
  const tx = shareTx();
  tx.receipts_outcome.push({ id: "R5", outcome: { executor_id: "intents.near", status: { Failure: { ActionError: { index: 0, kind: {} } } } as any, logs: [] } });
  assert.deepEqual(callResultOf(tx), { kind: "kept", units: 30_000_000n });
  // A look-alike executor's resolve never counts.
  const fake = shareTx();
  fake.receipts_outcome[3].outcome.executor_id = "intents-near.near";
  assert.deepEqual(callResultOf(fake), { kind: "ran" });
});

function nodes(answers: Record<string, unknown | "down">) {
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    asked.push(url);
    const a = answers[url];
    if (a === "down") throw new Error("down");
    assert.deepEqual(JSON.parse(String(init.body)).params, { tx_hash: "tx1", sender_account_id: "kid.near", wait_until: "FINAL" });
    return new Response(JSON.stringify(a === undefined ? { error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } } : { result: a }));
  }) as typeof fetch;
  return { asked, read: createReadCall(fetchFn, ["https://a", "https://b", "https://c"]) };
}

test("two nodes must agree; the third stands in for one that's down; one that hasn't seen it yet is no answer", async () => {
  const agree = nodes({ "https://a": shareTx(), "https://b": shareTx() });
  assert.deepEqual(await agree.read("tx1", "kid.near"), { kind: "kept", units: 30_000_000n });
  assert.deepEqual(agree.asked, ["https://a", "https://b"]);

  const oneDown = nodes({ "https://a": "down", "https://b": shareTx({ kept: "0" }), "https://c": shareTx({ kept: "0" }) });
  assert.deepEqual(await oneDown.read("tx1", "kid.near"), { kind: "kept", units: 0n });

  assert.equal(await nodes({ "https://a": shareTx(), "https://b": "down", "https://c": "down" }).read("tx1", "kid.near"), null);
  assert.equal(await nodes({ "https://a": shareTx(), "https://b": {} }).read("tx1", "kid.near"), null, "a node without the receipts yet");

  await assert.rejects(nodes({ "https://a": shareTx(), "https://b": shareTx({ kept: "0" }) }).read("tx1", "kid.near"), (e) => e instanceof ProblemError && e.problem.code === "ledger.nodes.disagree");
});

test("real-money test, 4 Nov: with FastNEAR at 429, a receipt is read from dRPC and Intear (the app's one order; NEAR's own node is deprecated)", async () => {
  const final = shareTx();
  const fetchFn = (async (url: string) =>
    /fastnear|near\.org/.test(url)
      ? new Response("Rate limit exceeded, retry after 47 seconds", { status: 429 })
      : new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: final }), { status: 200 })) as unknown as typeof fetch;
  assert.deepEqual(await createReadCall(fetchFn)("h", "zf-0000000a04.near"), { kind: "kept", units: 30_000_000n });
});
