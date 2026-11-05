// D134, D137 at the ledger: Home's Safe (ledger.balances { shown: true }) is the first node's answer, so a 429 from
// FastNEAR (and from the stand-in, as measured 3 Nov) still shows the balance from dRPC, with no "didn't answer". A
// read that decides money (no `shown`: Spending's Top up, the vault gate, Pay) still needs two nodes. Product decision, 3 Nov: a
// figure is marked `agreed` only once a second operator gave the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BridgeResult } from "@zerofee/core/bridge";
import { NodePace, RpcChain } from "@zerofee/core/chain";
import { rpcNodes } from "@zerofee/core/testing/rpc-nodes";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import type { Balance } from "./types.ts";
import { fakeCore, fakeNear, replayFetch } from "./testing/replay.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ledgerWith(rateLimited: (host: string) => boolean) {
  const fake = fakeNear("safe.near", { ledger: { [USDC]: "2500000" } });
  const nodes = rpcNodes(fake, { roundMs: 1 });
  const asked: string[] = [];
  const fetchFn = (async (url: string, init: { body: string }) => {
    const host = new URL(url).host;
    asked.push(host);
    if (rateLimited(host)) return new Response('{"jsonrpc":"2.0","error":{"code":-429,"message":"Rate limits exceeded"}}', { status: 429 });
    return nodes.fetchFn(url, init);
  }) as unknown as typeof fetch;
  const chain = new RpcChain("mainnet", nodes.urls, fetchFn, 1_000, new NodePace(4, 5, 20));
  const core = fakeCore({ accountId: "safe.near" });
  const ledger = createLedgerService({ bridge: core, chain, apis: createApis(replayFetch()) });
  return { ledger, hosts: nodes.urls.map((u) => new URL(u).host), asked };
}

test("D134: a 429 from FastNEAR (and the stand-in) still shows the Safe from dRPC, no 'didn't answer' (control: a money read needs two nodes)", async () => {
  let hosts: string[] = [];
  const { ledger, hosts: h } = ledgerWith((host) => host === hosts[0] || host === hosts[2]);
  hosts = h;
  const shown = (await ledger.call<Balance[]>("ledger.balances", { shown: true })) as BridgeResult<Balance[]>;
  assert.ok("ok" in shown, `the Safe shows: ${"problem" in shown ? shown.problem.whatHappened : ""}`);
  assert.equal(shown.ok.find((b) => b.tokenId === USDC)?.amount, "2.5");
  assert.equal(shown.ok[0].agreed, undefined, "one node's answer: never marked agreed");
  // control: a read that decides money (no `shown`) still needs two nodes, and says NEAR is busy, never down
  const money = await ledger.call<Balance[]>("ledger.balances");
  assert.ok("problem" in money, "two nodes are needed to decide money");
  assert.match(money.problem.whatHappened, /busy/);
});

test("product decision, 3 Nov: the Safe's figure comes back `agreed` once a second operator confirmed it, and Home is told", async () => {
  const { ledger } = ledgerWith(() => false);
  let told = 0;
  const off = ledger.on("ledger.balancesAgreed", () => told++);
  const first = await ledger.call<Balance[]>("ledger.balances", { shown: true });
  assert.ok("ok" in first);
  for (let i = 0; i < 50 && told === 0; i++) await sleep(10);
  assert.equal(told, 1, "Home is told to read again");
  const again = await ledger.call<Balance[]>("ledger.balances", { shown: true });
  assert.ok("ok" in again && again.ok.every((b) => b.agreed === true), "the same rows, now marked agreed");
  // every money read is agreed by construction
  const money = await ledger.call<Balance[]>("ledger.balances");
  assert.ok("ok" in money && money.ok.every((b) => b.agreed === true));
  off();
});

test("one node's word never spares a money read: after a screen's read, the agreed read still reads the coins on the account (control: a second agreed read may skip them)", async () => {
  const fake = fakeNear("safe.near", { ledger: { [USDC]: "2500000" } });
  const nodes = rpcNodes(fake, { roundMs: 1 });
  const chain = new RpcChain("mainnet", nodes.urls, nodes.fetchFn, 1_000, new NodePace(4, 5, 20));
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: "safe.near" }), chain, apis: createApis(replayFetch()) });
  const ft = () => nodes.count().asked.filter((a) => a.includes("ft_balance_of")).length;
  assert.ok("ok" in (await ledger.call("ledger.balances", { shown: true })));
  nodes.newBlock();
  nodes.reset();
  assert.ok("ok" in (await ledger.call("ledger.balances")));
  assert.equal(ft(), 6, "the three coins on the account, on both nodes, though the screen's read just looked");
  nodes.newBlock();
  nodes.reset();
  assert.ok("ok" in (await ledger.call("ledger.balances")));
  assert.equal(ft(), 0, "control: an agreed read a moment after an agreed read skips coins never held (UNHELD_RECHECK_MS)");
});

test("review M1: the reviewer's probe. Confirmed at 2.5, then the other nodes say 0.000001: the next screen read is never marked agreed (control: the money read says they disagree)", async () => {
  // node A (first to answer) still says 2.5 USDC; the other operators change their answer
  const fast = fakeNear("safe.near", { ledger: { [USDC]: "2500000" } });
  const otherHoldings = { ledger: { [USDC]: "2500000" } as Record<string, string> };
  const others = fakeNear("safe.near", otherHoldings);
  const a = rpcNodes(fast, { roundMs: 1 });
  const b = rpcNodes(others, { roundMs: 40 });
  const urls = [a.urls[0], b.urls[1], b.urls[2]];
  const fetchFn = ((url: string, init: { body: string }) => (new URL(url).host === new URL(a.urls[0]).host ? a.fetchFn(url, init as never) : b.fetchFn(url, init as never))) as unknown as typeof fetch;
  const chain = new RpcChain("mainnet", urls, fetchFn, 1_000, new NodePace(4, 5, 20));
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: "safe.near" }), chain, apis: createApis(replayFetch()) });
  let agreedTold = 0;
  let unconfirmed = 0;
  ledger.on("ledger.balancesAgreed", () => agreedTold++);
  ledger.on("ledger.balancesUnconfirmed", () => unconfirmed++);
  const usdc = (r: BridgeResult<Balance[]>) => ("ok" in r ? r.ok.find((x) => x.tokenId === USDC && x.held === "ledger") : undefined);
  assert.equal(usdc(await ledger.call<Balance[]>("ledger.balances", { shown: true }))?.amount, "2.5");
  for (let i = 0; i < 100 && agreedTold === 0; i++) await sleep(10);
  assert.equal(agreedTold, 1, "the first read was confirmed by a second operator");
  otherHoldings.ledger[USDC] = "1"; // money left the Safe: the other operators now say 0.000001
  await sleep(1_100); // past the screen read's one-second share
  const next = usdc(await ledger.call<Balance[]>("ledger.balances", { shown: true }));
  assert.equal(next?.amount, "2.5", "node A still answers first with the old figure");
  assert.notEqual(next?.agreed, true, "but it is never marked agreed: the second operator said less");
  for (let i = 0; i < 100 && unconfirmed === 0; i++) await sleep(10);
  assert.equal(unconfirmed, 1, "and Home is told to settle it on two nodes");
  // control: a money read at this moment says the nodes disagree
  const money = await ledger.call<Balance[]>("ledger.balances");
  assert.ok("problem" in money && /didn't agree|disagree/i.test(`${money.problem.code} ${money.problem.whatHappened}`), "problem" in money ? money.problem.code : "ok");
});

test("review L5: after a move of this phone's, the Safe's screen read starts fresh at the nodes too (control: two reads at once share one)", async () => {
  const fake = fakeNear("safe.near", { ledger: { [USDC]: "2500000" } });
  const nodes = rpcNodes(fake, { roundMs: 30 });
  const chain = new RpcChain("mainnet", nodes.urls, nodes.fetchFn, 1_000, new NodePace(4, 5, 20));
  const ledger = createLedgerService({ bridge: fakeCore({ accountId: "safe.near" }), chain, apis: createApis(replayFetch()) });
  const lists = () => nodes.count().asked.filter((a) => a.includes("mt_tokens_for_owner")).length;
  // control: two screen reads at once are one read (each node asked at most once)
  nodes.reset();
  await Promise.all([ledger.call("ledger.balances", { shown: true }), ledger.call("ledger.balances", { shown: true })]);
  const once = lists();
  assert.ok(once >= 1 && once <= 2, `${once}`);
  // a move between them (here one the ledger refuses at once: a change all the same), then a read: asked anew
  await new Promise((r) => setTimeout(r, 1_100)); // past the one-second share
  nodes.reset();
  const before = ledger.call("ledger.balances", { shown: true });
  await ledger.call("ledger.transfer", { to: "nobody", amount: "0" });
  await Promise.all([before, ledger.call("ledger.balances", { shown: true })]);
  assert.ok(lists() >= 2 * once, `the read after the move was asked of the nodes again (${lists()} list reads, ${once} for one)`);
});
