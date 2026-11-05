// B33 (product decision, 2 Nov; QA: two watch-only walks crashed in pastTransactions):
// the account's history is FastNEAR's index, not NEAR's nodes. A failure there is named as FastNEAR's history (D88),
// logged as it was, never a gate: a batch that fails keeps what was read, a malformed row is skipped, and keys come
// from the nodes' own list when the history can't answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RpcChain } from "./chain.ts";
import { ProblemError } from "./problem.ts";

const ACCOUNT = "alice.near";
const hashes = Array.from({ length: 25 }, (_, i) => `tx${i}`);
const listed = { account_txs: hashes.map((h, i) => ({ transaction_hash: h, is_signer: true, tx_block_timestamp: String((1_700_000_000_000 + i) * 1_000_000) })) };
const row = (h: string) => ({ transaction: { hash: h, signer_id: ACCOUNT, public_key: "ed25519:AAAA", receiver_id: ACCOUNT, actions: [] }, execution_outcome: { block_timestamp: Number(listed.account_txs.find((t) => t.transaction_hash === h)!.tx_block_timestamp) }, receipts: [] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** FastNEAR's index as this test wants it: the list, then each batch of 20 by its first hash. */
function index(batch: (first: string, hashes: string[]) => Response | Promise<Response>, list: () => Response | Promise<Response> = () => json(listed)) {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/v0/account")) return list();
    if (u.endsWith("/v0/transactions")) {
      const want: string[] = JSON.parse(String(init?.body)).tx_hashes;
      return batch(want[0]!, want);
    }
    // NEAR's nodes (the key list fallback): one ed25519 key and one ML-DSA handle
    const body = JSON.parse(String(init?.body));
    if (body.method === "block") return json({ result: { header: { hash: "B1", height: 10 } } });
    if (body.method === "query") return json({ result: { keys: [{ public_key: "ed25519:Full1", access_key: { nonce: 1, permission: "FullAccess" } }, { public_key: "ml-dsa-65:Hash1", access_key: { nonce: 1, permission: "FullAccess" } }] } });
    return json({ error: { name: "HANDLER_ERROR", cause: { name: "OTHER" } } });
  }) as typeof fetch;
}
const chain = (f: typeof fetch) => new RpcChain("mainnet", ["https://a.example", "https://b.example"], f, 200);

test("the whole history: 25 rows in two batches, newest first, not partial (the control)", async () => {
  const past = await chain(index((_, want) => json({ transactions: want.map(row) }))).pastTransactions(ACCOUNT, 200);
  assert.equal(past.length, 25);
  assert.equal(past.partial, undefined);
  assert.equal(past[0]!.hash, "tx24");
});

for (const [name, fail] of [
  ["a 404", () => json({}, 404)],
  ["a 429", () => json({ error: "too many requests" }, 429)],
  ["a timeout", () => Promise.reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))],
  ["an unreadable answer", () => new Response("<html>bad gateway</html>", { status: 200 })],
] as const) {
  test(`B33: ${name} on the second batch keeps the first batch's 20 rows, marked partial, never "NEAR didn't answer"`, async () => {
    const past = await chain(index((first, want) => (first === "tx20" ? fail() : json({ transactions: want.map(row) })))).pastTransactions(ACCOUNT, 200);
    assert.equal(past.length, 20, "the rows read before it stand");
    assert.equal(past.partial, true);
  });
}

test("B33: one malformed row is skipped, the others stand", async () => {
  const past = await chain(index((_, want) => json({ transactions: [...want.map(row), { transaction: { hash: "BAD", signer_id: ACCOUNT }, execution_outcome: { block_timestamp: "not a number" } }] }))).pastTransactions(ACCOUNT, 200);
  assert.equal(past.length, 25);
  assert.equal(past.partial, true);
});

test("B33: the list itself failing is FastNEAR's history, by name (D88), never NEAR's nodes", async () => {
  const c = chain(index(() => json({ transactions: [] }), () => json({}, 503)));
  await assert.rejects(c.pastTransactions(ACCOUNT, 50), (e: unknown) => e instanceof ProblemError && e.problem.code === "security.history.unreachable" && e.problem.whatHappened === "FastNEAR's history didn't answer." && !/NEAR didn't answer/.test(e.problem.whatHappened));
});

test("B33 review M2: a 200 that isn't the list is FastNEAR failing, never an empty history; a batch without rows is a gap", async () => {
  await assert.rejects(chain(index(() => json({ transactions: [] }), () => json({ error: "maintenance" }))).pastTransactions(ACCOUNT, 50), (e: unknown) => e instanceof ProblemError && e.problem.code === "security.history.unreachable");
  const keys = await chain(index(() => json({ transactions: [] }), () => json({ error: "maintenance" }))).keysFromHistory(ACCOUNT);
  assert.deepEqual(keys, ["ed25519:Full1"], "and keysFromHistory takes the nodes' list");
  const past = await chain(index((first, want) => (first === "tx20" ? json({ error: "busy" }) : json({ transactions: want.map(row) })))).pastTransactions(ACCOUNT, 200);
  assert.deepEqual([past.length, past.partial], [20, true]);
});

test("B33: keys from the history fall back to the nodes' own list when the history can't answer (never a gate)", async () => {
  const keys = await chain(index(() => json({ transactions: [] }), () => json({}, 404))).keysFromHistory(ACCOUNT);
  assert.deepEqual(keys, ["ed25519:Full1"], "the full keys the list carries; an ML-DSA handle is not a full key");
  // the control: with the history answering, its add-key is found
  const added = (h: string) => ({ ...row(h), transaction: { ...row(h).transaction, actions: [{ AddKey: { public_key: "ed25519:FromHistory", access_key: { nonce: 0, permission: "FullAccess" } } }] } });
  const fromHistory = await chain(index((_, want) => json({ transactions: want.map(added) }))).keysFromHistory(ACCOUNT);
  assert.ok(fromHistory.includes("ed25519:FromHistory"), JSON.stringify(fromHistory));
});
