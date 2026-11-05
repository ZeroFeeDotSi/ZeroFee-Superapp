import { test } from "node:test";
import { sha256 } from "@noble/hashes/sha2.js";
import assert from "node:assert/strict";
import { NODES, NodePace, RpcChain } from "./chain.ts";

const BLOCK = { hash: "11111111111111111111111111111111", height: 1 };
const bytes = (v: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(v)));

/** Two fake nodes: each answers a view with what `answer(node)` says. */
function chain(answer: (node: string, method: string) => unknown, nodes = ["https://a.example", "https://b.example"], confirmMs = 200) {
  const fetchFn = (async (url: string, init: { body: string }) => new Response(JSON.stringify(answer(url, JSON.parse(init.body).method)), { status: 200 })) as unknown as typeof fetch;
  return new RpcChain("testnet", nodes, fetchFn, confirmMs);
}
const panicked = { error: { name: "HANDLER_ERROR", cause: { name: "CONTRACT_EXECUTION_ERROR", info: { vm_error: "wasm execution failed with error: FunctionCallError(HostError(GuestPanic { panic_msg: no }))" } } } };

test("a contract that refuses a view reads as nothing, not as the network being down", async () => {
  assert.equal(await chain(() => panicked).view("junk.near", "ft_metadata", {}, BLOCK), null);
  // Older nodes put the same refusal in `result.error`.
  assert.equal(await chain(() => ({ result: { error: "wasm execution failed with error: FunctionCallError(HostError(GuestPanic))" } })).view("junk.near", "ft_metadata", {}, BLOCK), null);
  // An answer that isn't JSON (or isn't text) is nothing too.
  assert.equal(await chain(() => ({ result: { result: [0xff, 0xfe] } })).view("junk.near", "ft_metadata", {}, BLOCK), null);
  assert.deepEqual(await chain(() => ({ result: { result: bytes({ symbol: "OK" }) } })).view("ok.near", "ft_metadata", {}, BLOCK), { symbol: "OK" });
});

test("nodes that disagree are still a Problem, even when one says the contract refused", async () => {
  await assert.rejects(
    chain((node) => (node.includes("a.example") ? panicked : { result: { result: bytes({ symbol: "OK" }) } })).view("x.near", "ft_metadata", {}, BLOCK),
    (e: any) => e.problem.code === "security.nodes.disagree",
  );
});

/** A final transaction result: accepted at the top, with one later receipt that may have failed. */
const final = (laterFailed: boolean) => ({
  result: {
    status: { SuccessValue: "" },
    transaction: { hash: "h" },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }, { outcome: { status: laterFailed ? { Failure: { ActionError: { kind: "FunctionCallError" } } } : { SuccessValue: "" } } }],
  },
});

test("accepted at the top but a later step failed: the send says so (two nodes agree), never plain done", async () => {
  assert.deepEqual(await chain(() => final(true)).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: true });
  assert.deepEqual(await chain(() => final(false)).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
});

test("a later receipt that deleted a key already gone is not a failed step: finish_recovery's set-up key delete", async () => {
  const gone = { Failure: { ActionError: { index: 0, kind: { DeleteKeyDoesNotExist: { account_id: "a", public_key: "ed25519:x" } } } } };
  const both = { result: { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }, { outcome: { status: gone } }] } };
  assert.deepEqual(await chain(() => both).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
  // Any other failed receipt beside it still counts.
  const mixed = { result: { ...both.result, receipts_outcome: [...both.result.receipts_outcome, { outcome: { status: { Failure: { ActionError: { kind: { DeleteAccountStaking: {} } } } } } }] } };
  assert.deepEqual(await chain(() => mixed).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: true });
});

test("once it has gone out, nodes that disagree never read as \"nothing was sent\"", async () => {
  // Two of three agree: that is the outcome.
  const three = ["https://a.example", "https://b.example", "https://c.example"];
  assert.deepEqual(await chain((node) => final(node.includes("b.example")), three).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
  // Never two alike: sent, not confirmed yet, with the link.
  await assert.rejects(chain((node) => final(node.includes("a.example"))).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.send.unconfirmed" && /nearblocks/.test(e.problem.more));
  // A node that hasn't got the final result yet is asked again, not counted.
  let calls = 0;
  assert.deepEqual(await chain((_node, method) => (method === "tx" && ++calls <= 2 ? { result: { status: "NotStarted" } } : final(false)), undefined, 5000).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
});

test("a key's fee allowance running out is its own problem, never \"not enough NEAR\"", async () => {
  const refused = { error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION" }, data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: { account_id: "a", allowance: "1", cost: "2", public_key: "ed25519:x" } } } } } } };
  await assert.rejects(chain(() => refused).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.key.allowance" && /NEAR fees are used up/.test(e.problem.whatHappened));
  const broke = { error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION" }, data: { TxExecutionError: { InvalidTxError: { NotEnoughBalance: { signer_id: "a", balance: "1", cost: "2" } } } } } };
  await assert.rejects(chain(() => broke).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.balance.low");
});

test("PS-1: once a node may have taken it, another node's refusal never says 'nothing was sent': it ends in the hash's outcome", async () => {
  // Node a times out (or is down) on the FINAL wait: it may have broadcast. Node b then refuses the same bytes.
  const make = (txAnswer: (node: string) => unknown) => {
    const fetchFn = (async (url: string, init: { body: string }) => {
      const method = JSON.parse(init.body).method;
      if (method === "send_tx" && url.includes("a.example")) throw new Error("timed out");
      if (method === "send_tx") return new Response(JSON.stringify({ error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: {} }, data: { TxExecutionError: { InvalidTxError: "Expired" } } } }), { status: 200 });
      return new Response(JSON.stringify(txAnswer(url)), { status: 200 });
    }) as unknown as typeof fetch;
    return new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 200);
  };
  // Nobody can say yet: "sent, not confirmed yet" with the link (no Try again), never security.send.refused.
  await assert.rejects(make(() => ({ error: { name: "UNKNOWN_TRANSACTION" } })).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.send.unconfirmed" && e.problem.next.kind !== "retry");
  // Our first copy did land: the two nodes' word on the hash is the outcome.
  assert.deepEqual(await make(() => final(false)).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
  // A refusal from the very first node, before anything could have gone out, is still a refusal.
  const refusing = (async (_url: string, init: { body: string }) => new Response(JSON.stringify(JSON.parse(init.body).method === "send_tx" ? { error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: {} }, data: { TxExecutionError: { InvalidTxError: "Expired" } } } } : {}), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(new RpcChain("testnet", ["https://a.example", "https://b.example"], refusing, 200).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.send.refused");
});

test("a transaction the contract refused carries the contract's own words, as both nodes report them", async () => {
  const said = "Smart contract panicked: too many payments in the last 24 hours: try again tomorrow";
  const refused = { result: { status: { Failure: { ActionError: { index: 0, kind: { FunctionCallError: { ExecutionError: said } } } } }, transaction: { hash: "h" }, receipts_outcome: [] } };
  assert.deepEqual(await chain(() => refused).send("AAAA", "h", "alice.testnet"), { status: "failed", value: null, partly: false, failure: said });
  // A failure without the contract's words (a missing key, out of gas): failed, with nothing more.
  const other = { result: { status: { Failure: { InvalidTxError: "InvalidSignature" } }, transaction: { hash: "h" }, receipts_outcome: [] } };
  assert.deepEqual(await chain(() => other).send("AAAA", "h", "alice.testnet"), { status: "failed", value: null, partly: false });
});

test("an answer over 2 MB is refused as it streams, never read whole (audit NF-22)", async () => {
  const { readJson, readText, MAX_RESPONSE_BYTES } = await import("./net.ts");
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({ pull: (c) => ((pulled += 65_536), c.enqueue(new Uint8Array(65_536).fill(32))) });
  await assert.rejects(readText(new Response(endless)), /over/);
  assert.ok(pulled <= MAX_RESPONSE_BYTES + 2 * 65_536, `stopped after ${pulled} bytes`);
  await assert.rejects(readJson(new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } })), /over/, "a stated length over the cap: refused before reading");
  assert.deepEqual(await readJson(new Response(JSON.stringify({ ok: "x".repeat(100_000) }))), { ok: "x".repeat(100_000) });
  // And through a node: one answering 3 MB reads as no answer from it.
  const big = chain(() => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify({ symbol: "x".repeat(3 * 1024 * 1024) }))) } }));
  await assert.rejects(big.view("x.near", "ft_metadata", {}, BLOCK));
});

test("FI-2: a global contract's code, read on two nodes, is its sha256; none published is null; two different copies are a Problem", async () => {
  const code = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const hex = Array.from(sha256(code), (b) => b.toString(16).padStart(2, "0")).join("");
  const published = (c: Uint8Array) => ({ result: { code_base64: Buffer.from(c).toString("base64"), block_height: 1, block_hash: BLOCK.hash } });
  assert.equal(await chain(() => published(code)).globalContractSha256("3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz", BLOCK), hex);
  assert.equal(await chain(() => ({ error: { name: "HANDLER_ERROR", cause: { name: "NO_GLOBAL_CONTRACT_CODE", info: {} } } })).globalContractSha256("3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz", BLOCK), null);
  await assert.rejects(
    chain((node) => published(node.includes("a.example") ? code : new Uint8Array([1]))).globalContractSha256("3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz", BLOCK),
    (e: any) => e.problem.code === "security.nodes.disagree",
  );
});

// Grade 1 Nov, D2: our own burst of reads made a node answer 429 and the app said "We can't reach the network".
const acct = (amount: string) => new Response(JSON.stringify({ result: { amount, storage_usage: "1", code_hash: "x" } }), { status: 200 });

test("D2: the same pinned read asked at once is asked once, and kept a moment", async () => {
  let asked = 0;
  const fetchFn = (async () => {
    asked++;
    await new Promise((r) => setTimeout(r, 20));
    return acct("1");
  }) as unknown as typeof fetch;
  const c = new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 200, new NodePace());
  await Promise.all([c.account("x.testnet", BLOCK), c.account("x.testnet", BLOCK), c.account("x.testnet", BLOCK)]);
  assert.equal(asked, 2, "one read per node, not three");
  await c.account("x.testnet", BLOCK);
  assert.equal(asked, 2, "kept: pinned to a block, it can't change");
});

test("D2: a 429 is waited out and asked again on the same node, not called the network being down", async () => {
  let first = true;
  const fetchFn = (async (url: string) => {
    if (url.includes("a.example") && first) {
      first = false;
      return new Response("busy", { status: 429, headers: { "retry-after": "0" } });
    }
    return acct("7");
  }) as unknown as typeof fetch;
  const c = new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 200, new NodePace(4, 5, 20));
  assert.equal((await c.account("x.testnet", BLOCK))?.balanceYocto, 7n);
});

test("D2: a failed fetch (how a 429 without CORS looks to a page) is retried; one that never answers is a Problem, logged", async () => {
  let tries = 0;
  const flaky = (async (url: string) => {
    if (url.includes("a.example") && tries++ < 1) throw new TypeError("Failed to fetch");
    return acct("3");
  }) as unknown as typeof fetch;
  assert.equal((await new RpcChain("testnet", ["https://a.example", "https://b.example"], flaky, 200, new NodePace(4, 5, 20)).account("x.testnet", BLOCK))?.balanceYocto, 3n);
  const dead = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  await assert.rejects(new RpcChain("testnet", ["https://a.example", "https://b.example"], dead, 200, new NodePace(4, 5, 20)).account("y.testnet", BLOCK), (e: any) => e.problem.code === "security.nodes.unreachable");
  const log = (globalThis as { __zfNetLog?: { what: string; detail?: string }[] }).__zfNetLog ?? [];
  assert.ok(log.some((l) => l.what === "fetch failed" && /Failed to fetch/.test(l.detail ?? "")), "the real exception is in the dev log");
});

test("D2: no more than four reads at once go to one node", async () => {
  let now = 0;
  let most = 0;
  const fetchFn = (async () => {
    most = Math.max(most, ++now);
    await new Promise((r) => setTimeout(r, 10));
    now--;
    return acct("1");
  }) as unknown as typeof fetch;
  const c = new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 200, new NodePace());
  await Promise.all(Array.from({ length: 12 }, (_, i) => c.account(`n${i}.testnet`, BLOCK)));
  assert.ok(most <= 8, `two nodes × four at most, saw ${most}`);
});

test("N2: one budget for every caller: at most `total` requests at once across every node and every chain", async () => {
  let now = 0;
  let most = 0;
  const fetchFn = (async () => {
    most = Math.max(most, ++now);
    await new Promise((r) => setTimeout(r, 10));
    now--;
    return acct("1");
  }) as unknown as typeof fetch;
  const pace = new NodePace(4, 5, 20, 2, 5);
  // Two chains (the account's and the ledger's) on three nodes, sharing one pace.
  const a = new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 200, pace);
  const b = new RpcChain("testnet", ["https://c.example", "https://b.example"], fetchFn, 200, pace);
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).account(`t${i}.testnet`, BLOCK)));
  assert.ok(most <= 5, `five at most across everything, saw ${most}`);
  assert.equal(pace.inUse, 0);
});

test("N2: a read that can't start in time (a node busy or cooling down) gives up that node; nothing queues for ever", async () => {
  let release = () => {};
  const stuck = new Promise<void>((r) => (release = r));
  const fetchFn = (async (url: string) => {
    if (url.includes("a.example")) await stuck;
    return acct("4");
  }) as unknown as typeof fetch;
  // One slot per node; node a's slot is held by a read that never ends. Each read must start within 40 ms.
  const pace = new NodePace(1, 5, 20, 2, 8, 40);
  const c = new RpcChain("testnet", ["https://a.example", "https://b.example", "https://c.example"], fetchFn, 60_000, pace);
  void c.account("first.testnet", BLOCK).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 5));
  const t = Date.now();
  // Node a can't start it: c stands in, so the read is answered by b and c.
  assert.equal((await c.account("second.testnet", BLOCK))?.balanceYocto, 4n);
  assert.ok(Date.now() - t < 1000, "answered by the stand-in, not after the stuck read");
  // A node cooling down after a 429 for longer than the deadline is given up at once too.
  let n = 0;
  const busy = (async (url: string) => {
    if (url.includes("a.example")) {
      n++;
      return new Response("busy", { status: 429, headers: { "retry-after": "30" } });
    }
    return acct("5");
  }) as unknown as typeof fetch;
  const d = new RpcChain("testnet", ["https://a.example", "https://b.example", "https://c.example"], busy, 60_000, new NodePace(4, 5, 60_000, 2, 8, 40));
  const t2 = Date.now();
  assert.equal((await d.account("third.testnet", BLOCK))?.balanceYocto, 5n);
  assert.ok(Date.now() - t2 < 1000 && n === 1, `asked node a once (${n}), then the stand-in, in ${Date.now() - t2} ms`);
  release();
});

test("D2: NEAR's own rpc.*.near.org is no longer a node (it 429s a browser's preflight); three operators each", () => {
  for (const list of Object.values(NODES)) {
    assert.equal(list.some((u) => /rpc\.(testnet|mainnet)\.near\.org/.test(u)), false);
    assert.equal(new Set(list.map((u) => new URL(u).host.split(".").slice(-2).join("."))).size, 3);
  }
});

test("QA's MUST (5 Nov, a site's Add): a send that timed out after the bytes went and lands later is ONE movement, its outcome, never a refusal that could offer a second signature (control: no node ever has it, still on its way, no Try again)", async () => {
  // node a times out on the FINAL wait after the request went; node b is down. The tx is unknown on the first round of
  // reads by its hash and final on the next, as a first attempt that lands after NEAR was busy
  const make = (landsOnRound: number) => {
    let reads = 0;
    const fetchFn = (async (url: string, init: { body: string }) => {
      const method = JSON.parse(init.body).method;
      if (method === "send_tx") throw new Error(url.includes("a.example") ? "timed out" : "connection reset");
      reads += 1;
      return new Response(JSON.stringify(Math.ceil(reads / 2) >= landsOnRound ? final(false) : { error: { name: "UNKNOWN_TRANSACTION" } }), { status: 200 });
    }) as unknown as typeof fetch;
    return new RpcChain("testnet", ["https://a.example", "https://b.example"], fetchFn, 4000);
  };
  assert.deepEqual(await make(2).send("AAAA", "h", "alice.testnet"), { status: "done", value: null, partly: false });
  await assert.rejects(new RpcChain("testnet", ["https://a.example", "https://b.example"], (async (_u: string, init: { body: string }) => {
    if (JSON.parse(init.body).method === "send_tx") throw new Error("timed out");
    return new Response(JSON.stringify({ error: { name: "UNKNOWN_TRANSACTION" } }), { status: 200 });
  }) as unknown as typeof fetch, 200).send("AAAA", "h", "alice.testnet"), (e: any) => e.problem.code === "security.send.unconfirmed" && e.problem.next.kind !== "retry");
});
