// D134, D137: a screen's read takes the first good answer
// from any node; a 429 is NEAR busy, never down; a failed fetch is not a 429; a node's timeout is under the screen's
// deadline; a read that decides money still needs two nodes. D139: only the Safe's own reads may go to the relay's proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HEDGE_MS, NEAR_PROXY, NODES, NODE_READ_MS, NodePace, RpcChain, proxySafe, proxyTokens } from "./chain.ts";
import { safeOnly, setNearProxy } from "./near-proxy.ts";
import { READ_DEADLINE_MS } from "./read-deadline.ts";

const BLOCK = { hash: "11111111111111111111111111111111", height: 1 };
const A = "https://a.example", B = "https://b.example", C = "https://c.example";
const acct = (amount: string) => new Response(JSON.stringify({ result: { amount, storage_usage: "1", code_hash: "x" } }), { status: 200 });
const busy = () => new Response('{"jsonrpc":"2.0","error":{"code":-429,"message":"Rate limits exceeded"}}', { status: 429 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Fetch = (url: string, init: { body: string }) => Promise<Response>;
const chainOf = (f: Fetch, nodes = [A, B, C]) => new RpcChain("testnet", nodes, f as unknown as typeof fetch, 200, new NodePace(4, 5, 20));

test("D134: a 429 from the first node still shows a balance from the second, with no 'didn't answer' (control: the agreed read fails)", async () => {
  // FastNEAR's place answers 429 for good; the stand-in too (both measured 3 Nov); dRPC's place answers.
  const f: Fetch = async (url) => (url === B ? acct("9") : busy());
  const c = chainOf(f);
  const a = await c.shown().account("safe.near");
  assert.equal(a?.balanceYocto, 9n, "the screen's figure, from the node that answered");
  // control: a read that decides money needs two nodes; with only one answering it is a Problem, said as busy
  await assert.rejects(c.account("safe.near", BLOCK), (e: any) => e.problem.code === "security.nodes.unreachable" && e.problem.fault === "busy");
});

test("D134: the first good answer wins; a slow node is not waited for", async () => {
  const f: Fetch = async (url) => {
    if (url === A) await sleep(400);
    return acct(url === A ? "1" : "2");
  };
  const t = Date.now();
  assert.equal((await chainOf(f, [A, B]).shown().account("x.near"))?.balanceYocto, 2n);
  assert.ok(Date.now() - t < 300, `answered by the fast node in ${Date.now() - t} ms`);
});

test("D134, D6: a spare is asked once neither node has answered in HEDGE_MS; both hanging still answer from it", async () => {
  const asked: string[] = [];
  const f: Fetch = async (url) => {
    asked.push(url);
    if (url !== C) await sleep(5_000);
    return acct("3");
  };
  const t = Date.now();
  assert.equal((await chainOf(f).shown().account("x.near"))?.balanceYocto, 3n);
  assert.ok(Date.now() - t >= HEDGE_MS - 20 && Date.now() - t < HEDGE_MS + 400, `the spare after ~${HEDGE_MS} ms (${Date.now() - t})`);
  assert.deepEqual(asked.slice(0, 3), [A, B, C]);
});

test("D3: every node rate-limited is 'NEAR is busy', never 'down' (control: nodes that are down say down)", async () => {
  await assert.rejects(chainOf(async () => busy()).shown().account("x.near"), (e: any) => e.problem.fault === "busy" && e.problem.whatHappened === "NEAR is busy right now.");
  await assert.rejects(chainOf(async () => new Response("", { status: 503 })).shown().account("x.near"), (e: any) => e.problem.fault === "down");
  await assert.rejects(chainOf(async () => busy()).account("x.near", BLOCK), (e: any) => e.problem.fault === "busy");
});

test("D5: a failed fetch is not a 429: asked again at once on a fresh connection, and no cool-down for the next read", async () => {
  let n = 0;
  const f: Fetch = async (url) => {
    if (url === A && n++ === 0) throw new TypeError("Load failed"); // Wi-Fi to cellular: the old connection is gone
    return acct("4");
  };
  const c = chainOf(f, [A, B]);
  const t = Date.now();
  assert.equal((await c.account("x.near", BLOCK))?.balanceYocto, 4n);
  assert.ok(Date.now() - t < 200, "asked again at once, not after a 1-8 s back-off");
  assert.equal(n, 2, "node A asked twice: the failure, then at once again");
  // control: a real 429 does wait (the pace cools that node)
  let m = 0;
  const g: Fetch = async (url) => (url === A && m++ === 0 ? new Response("busy", { status: 429, headers: { "retry-after": "0" } }) : acct("5"));
  assert.equal((await chainOf(g, [A, B]).account("y.near", BLOCK))?.balanceYocto, 5n);
  assert.equal(m, 2);
});

test("D6: one node's wait is shorter than the screen's deadline, with room for a spare", () => {
  assert.ok(NODE_READ_MS * 2 <= READ_DEADLINE_MS, `${NODE_READ_MS} ms per node, ${READ_DEADLINE_MS} ms on screen`);
  assert.ok(new NodePace().deadlineMs + NODE_READ_MS <= READ_DEADLINE_MS);
});

test("product decision, 3 Nov: a figure is 'agreed' only when a second operator gave the same answer (control: a different one is not)", async () => {
  const same = await chainOf(async (url) => (url === A ? acct("7") : (await sleep(30), acct("7"))), [A, B]).shown();
  await same.account("x.near");
  assert.equal(await same.agreed!(), true);
  const other = chainOf(async (url) => (url === A ? acct("7") : (await sleep(30), acct("1"))), [A, B]).shown();
  assert.equal((await other.account("x.near"))?.balanceYocto, 7n, "the first answer is shown");
  assert.equal(await other.agreed!(), false, "but never as agreed: a lower figure waits");
  // the second node rate-limited: a spare is asked to confirm
  const spared = chainOf(async (url) => (url === B ? busy() : acct("8"))).shown();
  await spared.account("x.near");
  assert.equal(await spared.agreed!(), true);
});

test("D139 privacy split: only the Safe's own reads may go to the relay's proxy (control: the Safe's do)", () => {
  proxySafe("safe.near");
  proxyTokens(["nep141:wrap.near", "nep245:v2_1.omni.hot.tg:56_11111111111111111111"]);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
  const call = (account_id: string, method_name: string, args: unknown) => ({ request_type: "call_function", account_id, method_name, args_base64: b64(args), finality: "final" });
  const POCKET = "a1".repeat(32), FLOAT = "b2".repeat(32), WALLET = "c3".repeat(32);
  for (const other of [POCKET, FLOAT, WALLET, "friend.near"]) {
    assert.equal(safeOnly("query", { request_type: "view_account", account_id: other, finality: "final" }), false, other);
    assert.equal(safeOnly("query", call("intents.near", "mt_tokens_for_owner", { account_id: other })), false, other);
    assert.equal(safeOnly("query", call("usdt.tether-token.near", "ft_balance_of", { account_id: other })), false, other);
    // two of a person's accounts in one read: never, as a coin id (review L1: on its own, no other field beside it) or a key
    assert.equal(safeOnly("query", call("intents.near", "mt_batch_balance_of", { account_id: "safe.near", token_ids: [`nep141:${other}`] })), false, `nep141:${other}`);
    assert.equal(safeOnly("query", call("intents.near", "mt_batch_balance_of", { [other]: 1, account_id: "safe.near" })), false, `${other} as a key`);
    assert.equal(safeOnly("query", call("intents.near", "mt_batch_balance_of", { account_id: "safe.near", also: other })), false, other);
    assert.equal(safeOnly("query", call(other, "anything", { account_id: "safe.near" })), false, `${other} as the contract`);
  }
  assert.equal(safeOnly("query", call("usdt.tether-token.near", "ft_metadata", {})), false, "a coin's own metadata names no Safe");
  // control: the Safe's own reads, and heads, may
  assert.equal(safeOnly("query", { request_type: "view_account", account_id: "safe.near", finality: "final" }), true);
  assert.equal(safeOnly("query", call("intents.near", "mt_tokens_for_owner", { account_id: "safe.near", from_index: "0", limit: 100 })), true);
  assert.equal(safeOnly("query", call("intents.near", "mt_batch_balance_of", { account_id: "safe.near", token_ids: ["nep141:wrap.near", "nep245:v2_1.omni.hot.tg:56_11111111111111111111"] })), true);
  assert.equal(safeOnly("query", call("safe.near", "recovery_status", {})), true);
  assert.equal(safeOnly("block", { finality: "final" }), false, "heads go to the free door (review L2, L4)");
  proxySafe(null);
});

test("D139: the proxy takes FastNEAR's place for the Safe's reads only; the pocket's never reach /v0/near; a 503 rests it", async () => {
  const PROXY = "https://relay.example/v0/near";
  const POCKET = "a1".repeat(32);
  const seen: { url: string; body: any }[] = [];
  let proxyUp = true;
  const f: Fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, body });
    if (url === PROXY && !proxyUp) return new Response('{"code":"quotes.not-configured"}', { status: 503 });
    return acct("6");
  };
  setNearProxy(PROXY);
  proxySafe("safe.near");
  try {
    const c = new RpcChain("mainnet", NODES.mainnet, f as unknown as typeof fetch, 200, new NodePace(4, 5, 20));
    await c.account("safe.near", BLOCK);
    await c.shown().account("safe.near");
    await c.account(POCKET, BLOCK);
    await c.shown().view("intents.near", "mt_tokens_for_owner", { account_id: POCKET });
    const toProxy = seen.filter((s) => s.url === PROXY);
    assert.ok(toProxy.length >= 2, "the Safe's reads went to the proxy");
    assert.ok(toProxy.every((s) => JSON.stringify(s.body).includes("safe.near") && !JSON.stringify(s.body).includes(POCKET)), "no pocket read ever reached /v0/near");
    assert.ok(!seen.some((s) => s.url === "https://rpc.mainnet.fastnear.com" && JSON.stringify(s.body).includes("safe.near")), "the Safe's read went to the proxy instead of FastNEAR's free door");
    assert.ok(seen.some((s) => s.url === "https://rpc.mainnet.fastnear.com" && JSON.stringify(s.body).includes(POCKET)), "the pocket's went straight to FastNEAR");
    // no key yet (503): FastNEAR's free door answers at once, and the proxy is left alone a while
    proxyUp = false;
    seen.length = 0;
    assert.equal((await c.account("safe.near", { ...BLOCK, hash: "22222222222222222222222222222222" }))?.balanceYocto, 6n);
    assert.equal(seen.filter((s) => s.url === PROXY).length, 1);
    seen.length = 0;
    await c.account("safe.near", { ...BLOCK, hash: "33333333333333333333333333333333" });
    assert.equal(seen.filter((s) => s.url === PROXY).length, 0, "rested after its 503");
  } finally {
    setNearProxy(null);
    proxySafe(null);
  }
});

test("product decision, 4 Nov (was review M2): /v0/near saying 'limited' (429) is asked twice more (~0.6 s), then FastNEAR's free door answers; the next read goes there at once (control: an answering proxy is used)", async () => {
  const PROXY = "https://relay.example/v0/near";
  const asked: string[] = [];
  let limited = true;
  const f: Fetch = async (url) => {
    asked.push(url);
    if (url === PROXY && limited) return new Response('{"code":"quotes.rate.limited"}', { status: 429 });
    return acct("6");
  };
  setNearProxy(PROXY);
  proxySafe("safe.near");
  try {
    const c = new RpcChain("mainnet", NODES.mainnet, f as unknown as typeof fetch, 200, new NodePace(4, 5, 20));
    const t = Date.now();
    assert.equal((await c.account("safe.near", BLOCK))?.balanceYocto, 6n);
    assert.ok(Date.now() - t < 1_500, `answered in ${Date.now() - t} ms, by the free door, after the paid door twice more`);
    assert.equal(asked.filter((u) => u === PROXY).length, 3, "the paid door: once, then twice again with a pause");
    assert.ok(asked.includes("https://rpc.mainnet.fastnear.com"), "FastNEAR's free door answered");
    // the next read doesn't wait for the proxy's cool-down either
    asked.length = 0;
    const t2 = Date.now();
    await c.shown().account("safe.near");
    assert.ok(Date.now() - t2 < 200 && asked.includes("https://rpc.mainnet.fastnear.com"));
    // control: once it answers again (its 5 s rest over, set by hand: no clock waits), the proxy is used
    limited = false;
    NEAR_PROXY.restUntil = 0;
    await new Promise((r) => setTimeout(r, 30));
    asked.length = 0;
    await c.account("safe.near", { ...BLOCK, hash: "44444444444444444444444444444444" });
    assert.ok(asked.includes(PROXY), asked.join(" "));
  } finally {
    setNearProxy(null);
    proxySafe(null);
  }
});

test("review L4: a relay that lies can't block a Send: FastNEAR's free door and dRPC agree (control: two real nodes that disagree still stop it)", async () => {
  const PROXY = "https://relay.example/v0/near";
  const f: Fetch = async (url) => (url === PROXY ? acct("1") : acct("6"));
  setNearProxy(PROXY);
  proxySafe("safe.near");
  try {
    const c = new RpcChain("mainnet", NODES.mainnet, f as unknown as typeof fetch, 200, new NodePace(4, 5, 20));
    assert.equal((await c.account("safe.near", BLOCK))?.balanceYocto, 6n, "the relay said 1; FastNEAR itself and dRPC say 6");
  } finally {
    setNearProxy(null);
    proxySafe(null);
  }
  // control: no relay, FastNEAR says 1 and dRPC 6: a disagreement, nothing agreed
  const g: Fetch = async (url) => (url.includes("fastnear") ? acct("1") : acct("6"));
  const d = new RpcChain("mainnet", NODES.mainnet, g as unknown as typeof fetch, 200, new NodePace(4, 5, 20));
  await assert.rejects(d.account("safe.near", { ...BLOCK, hash: "55555555555555555555555555555555" }), (e: any) => e.problem.code === "security.nodes.disagree");
});
