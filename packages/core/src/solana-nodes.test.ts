// Review M1 and M2 (3 Nov), the network side: a second, independent test-run node (solanavibestation) that never turns
// one server's full check into a refusal when it can't finish, and the executable read a Jupiter route's programs are
// checked by (two nodes; anything short of both saying "not a program" is a program). Answers replayed through fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcSolChain, SOL_NODES, SOL_SIM_NODES } from "./solana.ts";

const PUBLICNODE = "https://solana-rpc.publicnode.com", VIBE = "https://public.rpc.solanavibestation.com";
const SYSTEM = "11111111111111111111111111111111";
type Answer = (method: string, params: any[]) => unknown;

/** fetch answering each node by its origin; every call is kept. */
function nodes(by: Record<string, Answer>) {
  const asked: { origin: string; method: string; params: any[] }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const origin = new URL(String(url)).origin;
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: any[] };
    asked.push({ origin, method, params });
    const answer = by[origin];
    const body = answer ? answer(method, params) : { jsonrpc: "2.0", id: 1, error: { code: -1, message: "no such node" } };
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { asked, restore: () => void (globalThis.fetch = real) };
}
const ok = (result: unknown) => ({ jsonrpc: "2.0", id: 1, result });
const tooMany = () => ({ jsonrpc: "2.0", id: 1, error: { code: 429, message: "Too many requests" } });
/** A node that runs the test run in full: 5,000 lamports leave. */
const full: Answer = (method) => (method === "getBalance" ? ok({ value: 10_000_000_000 }) : method === "getMultipleAccounts" ? ok({ value: [] }) : ok({ value: { err: null, accounts: [{ lamports: 9_999_995_000, owner: SYSTEM }] } }));

test("M1, phone test, 3 Nov: the test run is asked on three operators, publicnode, solanavibestation, then pocket (it serves it about half the time)", () => {
  assert.deepEqual(SOL_SIM_NODES, [PUBLICNODE, VIBE, "https://solana.api.pocket.network"]);
  assert.deepEqual(SOL_NODES.slice(0, 1), [PUBLICNODE], "the other reads are unchanged");
});

test("M1: the second node answering 429 (as in B36's probe) leaves publicnode's full check: one server, ok", async () => {
  const n = nodes({ [PUBLICNODE]: full, [VIBE]: tooMany });
  try {
    const s = await new RpcSolChain().simulate("AA==", "wallet");
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, false, 1]);
    assert.ok(n.asked.some((a) => a.origin === VIBE && a.method === "simulateTransaction"), "the second node is asked");
  } finally {
    n.restore();
  }
});

test("M1: a second node that answers without the after-state counts as not answering, never as a failed test run", async () => {
  const half: Answer = (method) => (method === "simulateTransaction" ? ok({ value: { err: null, logs: [] } }) : full(method, []));
  let n = nodes({ [PUBLICNODE]: full, [VIBE]: half });
  try {
    const s = await new RpcSolChain().simulate("AA==", "wallet");
    // control: before M1 this was ok:false ("Solana's test run of it didn't go through"), servers 2
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, false, 1]);
    assert.equal(s.lamportsBefore - s.lamportsAfter, 5_000n, "publicnode's figures");
  } finally {
    n.restore();
  }
  // both half: nothing measured, never ok (audit SOL-7)
  n = nodes({ [PUBLICNODE]: half, [VIBE]: half });
  try {
    const s = await new RpcSolChain().simulate("AA==", "wallet");
    assert.deepEqual([s.ok, s.agreed, s.servers], [false, false, 0]);
  } finally {
    n.restore();
  }
});

test("M1: two full answers must agree: the same is agreed, a different amount out is a disagreement", async () => {
  let n = nodes({ [PUBLICNODE]: full, [VIBE]: full });
  try {
    const s = await new RpcSolChain().simulate("AA==", "wallet");
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, true, 2]);
  } finally {
    n.restore();
  }
  const more: Answer = (method) => (method === "simulateTransaction" ? ok({ value: { err: null, accounts: [{ lamports: 5_000_000_000, owner: SYSTEM }] } }) : full(method, []));
  n = nodes({ [PUBLICNODE]: full, [VIBE]: more });
  try {
    const s = await new RpcSolChain().simulate("AA==", "wallet");
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, false, 2], "the two servers don't agree");
    assert.equal(s.lamportsBefore - s.lamportsAfter, 5_000_000_000n, "the worse of the two");
  } finally {
    n.restore();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// M2: executable, on both nodes.

const A = "https://a.example", B = "https://b.example";
/** A node's account answers: per key, null (no account), or an account with that executable flag. */
const accounts = (flags: Record<string, boolean | null>): Answer => (method, params) => {
  if (method !== "getMultipleAccounts") return { jsonrpc: "2.0", id: 1, error: { code: -1, message: "not asked here" } };
  return ok({ context: { slot: 1 }, value: (params[0] as string[]).map((k) => (flags[k] === undefined || flags[k] === null ? null : { executable: flags[k], owner: SYSTEM, lamports: 1, data: ["", "base64"] })) });
};

test("M2: an account is not a program only when both nodes say so (or that it doesn't exist yet); anything else is a program", async () => {
  const keys = ["pool", "vault", "newAccount", "prog", "split", "absent"];
  const n = nodes({
    [A]: accounts({ pool: false, vault: false, newAccount: null, prog: true, split: false }),
    [B]: accounts({ pool: false, vault: false, newAccount: null, prog: true, split: true }),
  });
  try {
    const said = await new RpcSolChain([A, B]).executable(keys);
    assert.deepEqual(said, [false, false, false, true, true, false]);
    const reads = n.asked.filter((a) => a.method === "getMultipleAccounts");
    assert.equal(reads.length, 2, "one read on each node");
    assert.ok(reads.every((r) => r.params[1]?.dataSlice?.length === 0), "the flags only, no data");
  } finally {
    n.restore();
  }
});

test("M2: a node that doesn't answer (asked twice) fails the read, never a plain account; one answering without the flag makes the key a program", async () => {
  let n = nodes({ [A]: accounts({ pool: false }), [B]: tooMany });
  try {
    await assert.rejects(new RpcSolChain([A, B]).executable(["pool"]), "QA's re-test: said as can't check, not as an unknown app");
  } finally {
    n.restore();
  }
  n = nodes({ [A]: accounts({ pool: false }), [B]: () => ok({ value: [{ owner: SYSTEM, lamports: 1 }] }) });
  try {
    assert.deepEqual(await new RpcSolChain([A, B]).executable(["pool"]), [true], "no executable flag");
  } finally {
    n.restore();
  }
  n = nodes({ [A]: accounts({ pool: false }), [B]: () => ok({ value: [] }) });
  try {
    await assert.rejects(new RpcSolChain([A, B]).executable(["pool"]), "a short answer");
  } finally {
    n.restore();
  }
  // one node configured: never "both"
  n = nodes({ [A]: accounts({ pool: false }) });
  try {
    await assert.rejects(new RpcSolChain([A]).executable(["pool"]));
  } finally {
    n.restore();
  }
});

test("M2: a route's many accounts are read 10 at a time, in order; no keys asks nothing", async () => {
  const keys = Array.from({ length: 23 }, (_, i) => `k${i}`);
  const flags = Object.fromEntries(keys.map((k, i) => [k, i === 17]));
  const n = nodes({ [A]: accounts(flags), [B]: accounts(flags) });
  try {
    const said = await new RpcSolChain([A, B]).executable(keys);
    assert.deepEqual(said, keys.map((_, i) => i === 17));
    assert.ok(n.asked.every((a) => (a.params[0] as string[]).length <= 10));
    n.asked.length = 0;
    assert.deepEqual(await new RpcSolChain([A, B]).executable([]), []);
    assert.equal(n.asked.length, 0);
  } finally {
    n.restore();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The test real-money run (4 Nov): a sale ~1 s after its buy landed was refused, "Solana's test run of it didn't go
// through": a sim node that hadn't reached the buy's slot ran the sale on the balance from before it (no coins). With
// minSlot, every read of the run is at or after the landed slot; a node behind it is asked again until it is there.

const LANDED = 1_000;
const minOf = (params: any[]): number | undefined => params.find((x) => x && typeof x === "object" && !Array.isArray(x) && "minContextSlot" in x)?.minContextSlot;
/** A node at slot `start` that moves one slot each time it is asked. Asked for a slot it hasn't reached: -32016 (as the
 *  real nodes answer, probed 4 Nov). Before LANDED its state is the one from before the buy: the sale fails. */
function lagging(start: number): Answer {
  let slot = start;
  return (method, params) => {
    const now = slot++;
    const min = minOf(params);
    if (min !== undefined && now < min) return { jsonrpc: "2.0", id: 1, error: { code: -32016, message: "Minimum context slot has not been reached", data: { contextSlot: now } } };
    if (now >= LANDED) return full(method, params);
    return method === "simulateTransaction" ? ok({ value: { err: { InstructionError: [2, { Custom: 1 }] }, accounts: [{ lamports: 10_000_000_000, owner: SYSTEM }] } }) : full(method, params);
  };
}
const quick = () => new RpcSolChain(SOL_NODES, SOL_SIM_NODES, 120, 150, 1);

test("4 Nov: with a landed trade's slot, every read of the test run on every sim node asks for state at or after it (control: none without it)", async () => {
  let n = nodes({ [PUBLICNODE]: full, [VIBE]: full });
  try {
    await quick().simulate("AA==", "wallet", ["coinAccount"], { minSlot: LANDED });
    const runs = n.asked.filter((a) => ["getBalance", "getMultipleAccounts", "simulateTransaction"].includes(a.method));
    for (const origin of [PUBLICNODE, VIBE]) for (const method of ["getBalance", "getMultipleAccounts", "simulateTransaction"]) assert.ok(runs.some((a) => a.origin === origin && a.method === method), `${origin} ${method} asked`);
    assert.ok(runs.every((a) => minOf(a.params) === LANDED), "minContextSlot on each");
  } finally {
    n.restore();
  }
  n = nodes({ [PUBLICNODE]: full, [VIBE]: full });
  try {
    await quick().simulate("AA==", "wallet", ["coinAccount"]);
    assert.ok(n.asked.length > 0 && n.asked.every((a) => minOf(a.params) === undefined), "control: no landed trade, nothing changes");
  } finally {
    n.restore();
  }
});

test("4 Nov: a sim node behind the landed slot isn't used until it catches up: the sale runs on the state after the buy, on two nodes (control: without the slot it ran on the old state and failed)", async () => {
  // publicnode is past the buy; solanavibestation is 3 slots behind and catches up as it is asked again
  let n = nodes({ [PUBLICNODE]: lagging(LANDED + 5), [VIBE]: lagging(LANDED - 3) });
  try {
    const s = await quick().simulate("AA==", "wallet", [], { minSlot: LANDED });
    assert.deepEqual([s.ok, s.agreed, s.servers], [true, true, 2], "both nodes, on the state after the buy");
    assert.ok(n.asked.filter((a) => a.origin === VIBE && a.method === "simulateTransaction").length >= 2, "the node behind was asked again");
  } finally {
    n.restore();
  }
  // control: the same nodes, no slot: the node behind runs it on the old balance, and the test run didn't go through
  n = nodes({ [PUBLICNODE]: lagging(LANDED + 5), [VIBE]: lagging(LANDED - 3) });
  try {
    const s = await quick().simulate("AA==", "wallet");
    assert.equal(s.ok, false, "the owner's refusal");
  } finally {
    n.restore();
  }
});

test("4 Nov: a sim node still behind after its tries counts as not answering, never as its old state; the two-node rule stands", async () => {
  const stuck: Answer = (method, params) => (minOf(params) !== undefined ? { jsonrpc: "2.0", id: 1, error: { code: -32016, message: "Minimum context slot has not been reached" } } : lagging(0)(method, params));
  const n = nodes({ [PUBLICNODE]: full, [VIBE]: stuck });
  try {
    const s = await quick().simulate("AA==", "wallet", [], { minSlot: LANDED });
    // one full answer: "checked by one server", not agreed (a sale still needs two that agree: solCheck), never a failed run
    assert.deepEqual([s.ok, s.agreed, s.servers, s.behind], [true, false, 1, undefined], "a node answered: the slot is a real one");
    const tries = n.asked.filter((a) => a.origin === VIBE && a.method === "simulateTransaction").length;
    assert.ok(tries >= 2 && tries <= 1 + 6 + 2 * 7, `asked again a bounded number of times (${tries})`);
  } finally {
    n.restore();
  }
});

test("a code review: no node answered and one was still behind the slot: said (behind), so the caller drops the slot; never a pass", async () => {
  const stuck: Answer = () => ({ jsonrpc: "2.0", id: 1, error: { code: -32016, message: "Minimum context slot has not been reached" } });
  const n = nodes({ [PUBLICNODE]: stuck, [VIBE]: stuck });
  try {
    const s = await quick().simulate("AA==", "wallet", [], { minSlot: 900_000_000_000 });
    assert.deepEqual([s.ok, s.agreed, s.servers, s.behind], [false, false, 0, true]);
  } finally {
    n.restore();
  }
});
