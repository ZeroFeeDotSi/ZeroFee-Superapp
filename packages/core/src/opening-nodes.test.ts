// Finding 23 (4 Nov, real money): an opening read and sent through public NEAR nodes only. One Try again made 15 answers in
// 45 s, all 429, from rpc.mainnet.fastnear.com and rpc.intea.rs, and five funded setup addresses never opened, while
// rpc.mainnet.near.org answered from the same address. Now the opening's own reads and its send go through the relay's
// paid FastNEAR door first (D111: the account's own). Product decision, 4 Nov: NEAR's own node is deprecated (-429 to every call) and
// gone from the stand-ins; dRPC and Intear stand in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NODES, NodePace, RpcChain, askOrderOf, proxyOpening, proxySafe, txHashOf } from "./chain.ts";
import { setNearProxy } from "./near-proxy.ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { serialize } from "./tx-build.ts";
import { signedReleaseTx } from "./tx-borsh.ts";
import { toBase58 } from "@fastnear/utils";
import { sha256 } from "@noble/hashes/sha2.js";

const BLOCK = { hash: "11111111111111111111111111111111", height: 1 };
const SETUP = "a".repeat(64);
const RELAY = "https://relay.example/v0/near";
const busy = () => new Response("busy", { status: 429, headers: { "retry-after": "1" } });
const answer = (v: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", result: v }), { status: 200 });
const view = { amount: "3000000000000000000000000", storage_usage: 182, code_hash: "11111111111111111111111111111111" };

function net(handle: (url: string, method: string, body: any) => Response | Promise<Response>) {
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    asked.push(`${new URL(url).host}${new URL(url).pathname === "/v0/near/send" ? " send" : ""}`);
    return handle(url, body.method, body);
  }) as unknown as typeof fetch;
  return { fetchFn, asked };
}
const done = () => {
  setNearProxy(null);
  proxySafe(null);
};

test("finding 23: with FastNEAR's and Intear's free doors both at 429, the setup address is read via the relay and dRPC", async (t) => {
  t.after(done);
  setNearProxy(RELAY);
  proxyOpening([SETUP, "zf-0123456789.near"]);
  const { fetchFn, asked } = net((url) => (url.startsWith("https://relay.example") || url.includes("near.drpc.org") ? answer(view) : busy()));
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 200);
  assert.equal((await c.account(SETUP, BLOCK))?.balanceYocto, 3n * 10n ** 24n);
  assert.ok(asked.includes("relay.example"), "the account's own read went to the relay's paid door");
  assert.ok(asked.includes("near.drpc.org"), "dRPC agreed with the relay's paid door");
});

test("finding 23: without the relay, Intear stands in last when FastNEAR's free door is busy", async () => {
  const { fetchFn } = net((url) => (url.includes("near.drpc.org") || url.includes("rpc.intea.rs") ? answer(view) : busy()));
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 200);
  assert.equal((await c.account(SETUP, BLOCK))?.balanceYocto, 3n * 10n ** 24n);
  // control: a list of its own (a test's, the copy's) gets no extra operator
  const own = new RpcChain("mainnet", ["https://a.example", "https://b.example"], net((u) => (u.includes("a.example") ? answer(view) : busy())).fetchFn, 200);
  await assert.rejects(own.account(SETUP, BLOCK), (e: any) => e.problem.code === "security.nodes.unreachable");
});

test("finding 23: the opening's ed25519-signed create goes out through the relay's send door, and its outcome is read back by hash", async (t) => {
  t.after(done);
  setNearProxy(RELAY);
  proxyOpening([SETUP]);
  const secret = ed25519.utils.randomSecretKey();
  const unsigned = { signerId: SETUP, publicKey: `ed25519:${toBase58(ed25519.getPublicKey(secret))}`, nonce: 1n, receiverId: "near", blockHash: toBase58(new Uint8Array(32).fill(7)), actions: [{ kind: "transfer" as const, yocto: 1n }] };
  const bytes = serialize(unsigned);
  const signed = signedReleaseTx(bytes, ed25519.sign(sha256(bytes), secret));
  const final = { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [] };
  let sentToNodes = 0;
  const { fetchFn, asked } = net((url, method) => {
    if (url.endsWith("/v0/near/send")) return new Response(JSON.stringify({ sent: true }), { status: 200 });
    if (method === "send_tx") return (sentToNodes++, busy());
    if (method === "tx") return url.startsWith("https://relay.example") || url.includes("near.drpc.org") ? answer(final) : busy();
    return busy();
  });
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 2_000, new NodePace(4, 5, 20, 0));
  assert.deepEqual(await c.send(signed, txHashOf(bytes), SETUP), { status: "done", value: null, partly: false });
  assert.equal(sentToNodes, 0, "the relay took it: no node is sent it again");
  assert.ok(asked.includes("relay.example send"));
});

test("finding 23: a post-quantum signed send never goes to the relay's door (it takes ed25519 only)", async (t) => {
  t.after(done);
  setNearProxy(RELAY);
  proxyOpening(["zf-0123456789.near"]);
  const final = { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [] };
  const { fetchFn, asked } = net((_url, method) => (method === "send_tx" || method === "tx" ? answer(final) : busy()));
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 2_000, new NodePace(4, 5, 20, 0));
  // a made-up signed body whose key type byte is ML-DSA's (2)
  const ml = Buffer.concat([Buffer.from([19, 0, 0, 0]), Buffer.from("zf-0123456789.near."), Buffer.from([2]), Buffer.alloc(200)]).toString("base64");
  await c.send(ml, "h", "zf-0123456789.near");
  assert.ok(!asked.includes("relay.example send"));
});

test("finding 23 (PS-1): a relay that timed out may have sent it, so a node's refusal after that never says 'nothing was sent'", async (t) => {
  t.after(done);
  setNearProxy(RELAY);
  proxyOpening([SETUP]);
  const secret = ed25519.utils.randomSecretKey();
  const bytes = serialize({ signerId: SETUP, publicKey: `ed25519:${toBase58(ed25519.getPublicKey(secret))}`, nonce: 1n, receiverId: "near", blockHash: toBase58(new Uint8Array(32).fill(7)), actions: [{ kind: "transfer" as const, yocto: 1n }] });
  const signed = signedReleaseTx(bytes, ed25519.sign(sha256(bytes), secret));
  const expired = { error: { name: "HANDLER_ERROR", cause: { name: "INVALID_TRANSACTION", info: {} }, data: { TxExecutionError: { InvalidTxError: "Expired" } } } };
  const { fetchFn } = net((url, method) => {
    if (url.endsWith("/v0/near/send")) throw new Error("timed out");
    if (method === "send_tx") return new Response(JSON.stringify(expired), { status: 200 });
    return new Response(JSON.stringify({ error: { name: "UNKNOWN_TRANSACTION" } }), { status: 200 });
  });
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 300, new NodePace(4, 5, 20, 0));
  await assert.rejects(c.send(signed, txHashOf(bytes), SETUP), (e: any) => e.problem.code === "security.send.unconfirmed");
});

test("review (QA): a relay that says 'sent' but no node ever sees it: after a few silent rounds the same bytes go to the nodes, once; control: a hash the nodes know is never re-sent (above)", async (t) => {
  t.after(done);
  setNearProxy(RELAY);
  proxyOpening([SETUP]);
  const secret = ed25519.utils.randomSecretKey();
  const unsigned = { signerId: SETUP, publicKey: `ed25519:${toBase58(ed25519.getPublicKey(secret))}`, nonce: 1n, receiverId: "near", blockHash: toBase58(new Uint8Array(32).fill(7)), actions: [{ kind: "transfer" as const, yocto: 1n }] };
  const bytes = serialize(unsigned);
  const signed = signedReleaseTx(bytes, ed25519.sign(sha256(bytes), secret));
  const final = { status: { SuccessValue: "" }, transaction: { hash: "h" }, receipts_outcome: [] };
  let sentToNodes = 0;
  // the relay "sends" and drops it: the nodes know the hash only once they were sent it themselves
  const { fetchFn } = net((url, method) => {
    if (url.endsWith("/v0/near/send")) return new Response(JSON.stringify({ sent: true }), { status: 200 });
    if (method === "send_tx") return (sentToNodes++, answer({}));
    // a node that never got it says so (NEAR's UNKNOWN_TRANSACTION), until it was sent the bytes itself
    if (method === "tx") return sentToNodes > 0 ? answer(final) : new Response(JSON.stringify({ jsonrpc: "2.0", id: "zf", error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" }, message: "Transaction doesn't exist" } }), { status: 200 });
    return busy();
  });
  const c = new RpcChain("mainnet", NODES.mainnet, fetchFn, 15_000, new NodePace(4, 5, 20, 0));
  assert.deepEqual(await c.send(signed, txHashOf(bytes), SETUP), { status: "done", value: null, partly: false });
  assert.ok(sentToNodes >= 1, "the nodes were sent the same bytes");
  assert.ok(sentToNodes <= askOrderOf(NODES.mainnet).length, "once to each node, not every round");
});
