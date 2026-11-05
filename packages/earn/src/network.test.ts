import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { RpcNetwork } from "./network.ts";

/** Two fake nodes: each answers from its own table of method → result (or error). */
function nodes(a: Record<string, unknown>, b: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body));
    const table = String(url).includes("one") ? a : b;
    const key = method === "block" && params.block_id !== undefined ? `block:${params.block_id}` : method;
    const answer = table[key];
    if (answer === "down") throw new Error("connection refused");
    const body = answer instanceof Error ? { error: { name: "HANDLER_ERROR", cause: { name: answer.message } } } : { result: answer };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const netOf = (a: Record<string, unknown>, b: Record<string, unknown>) => new RpcNetwork("mainnet", ["https://one.example", "https://two.example"], nodes(a, b));
const net = netOf;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ProblemError ? e.problem.code : String(e);
  }
  return "no problem";
};

const validator = (id: string, stake: string, done: number, due: number) => ({ account_id: id, stake, num_produced_blocks: done, num_expected_blocks: due, num_produced_chunks: 10, num_expected_chunks: 10 });

test("the validator set needs both nodes to agree on the epoch, the stakes and who was dropped", async () => {
  const set = { epoch_start_height: 100, prev_epoch_kickout: [{ account_id: "gone.poolv1.near" }], current_validators: [validator("a.poolv1.near", "5", 99, 100)] };
  // The set is asked for by the epoch of a final block both nodes hold.
  const head = { header: { hash: "f", height: 150, epoch_id: "e1", timestamp_nanosec: "1" } };
  const net = (a: Record<string, unknown>, b: Record<string, unknown>) => netOf({ block: head, "block:150": head, ...a }, { block: head, "block:150": head, ...b });
  const ok = await net({ validators: set }, { validators: { ...set, current_validators: [validator("a.poolv1.near", "5", 98, 100)] } }).validators();
  assert.deepEqual(ok, { epochStartHeight: 100, validators: [{ accountId: "a.poolv1.near", stakeYocto: 5n, uptime: 0.98 }], kickedOut: ["gone.poolv1.near"] }, "the lower count of the two");
  assert.equal(await code(net({ validators: set }, { validators: { ...set, epoch_start_height: 200 } }).validators()), "earn.nodes.disagree");
  assert.equal(await code(net({ validators: set }, { validators: { ...set, current_validators: [validator("a.poolv1.near", "6", 99, 100)] } }).validators()), "earn.nodes.disagree");
  assert.equal(await code(net({ validators: set }, { validators: { ...set, prev_epoch_kickout: [] } }).validators()), "earn.nodes.disagree");
  assert.equal(await code(net({ validators: set }, { validators: "down" }).validators()), "earn.nodes.unreachable");
});

test("a block is only trusted under the same hash on both nodes; one either node dropped is gone", async () => {
  const header = (hash: string) => ({ header: { hash, height: 7, timestamp_nanosec: "1000" } });
  assert.deepEqual(await net({ "block:7": header("x") }, { "block:7": header("x") }).blockAt(7), { hash: "x", height: 7, timestampNs: 1000n });
  assert.equal(await code(net({ "block:7": header("x") }, { "block:7": header("y") }).blockAt(7)), "earn.nodes.disagree");
  assert.equal(await net({ "block:7": header("x") }, { "block:7": new Error("UNKNOWN_BLOCK") }).blockAt(7), null);
});

test("the newest final block both nodes hold", async () => {
  const at = (h: number) => ({ header: { hash: `b${h}`, height: h, timestamp_nanosec: String(h) } });
  const n = net({ block: at(12), "block:10": at(10) }, { block: at(10), "block:10": at(10) });
  assert.deepEqual(await n.blockAt("final"), { hash: "b10", height: 10, timestampNs: 10n });
});

test("the epoch length must match", async () => {
  assert.equal(await net({ EXPERIMENTAL_protocol_config: { epoch_length: 43200 } }, { EXPERIMENTAL_protocol_config: { epoch_length: 43200 } }).epochLength(), 43200);
  assert.equal(await code(net({ EXPERIMENTAL_protocol_config: { epoch_length: 43200 } }, { EXPERIMENTAL_protocol_config: { epoch_length: 100 } }).epochLength()), "earn.nodes.disagree");
});

test("real-money test, 4 Nov: with FastNEAR at 429, Earn's reads are answered by dRPC and Intear (the app's one order; NEAR's own node is deprecated)", async () => {
  const fetchFn = (async (url: string | URL | Request) =>
    /fastnear|near\.org/.test(String(url))
      ? new Response("Rate limit exceeded, retry after 47 seconds", { status: 429 })
      : new Response(JSON.stringify({ result: { epoch_length: 43200 } }), { status: 200 })) as typeof fetch;
  assert.equal(await new RpcNetwork("mainnet", undefined, fetchFn).epochLength(), 43200);
});
