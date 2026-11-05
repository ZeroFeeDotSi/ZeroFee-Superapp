// The read budget (2 Nov): how many requests the app sends to NEAR's nodes, and how many round trips it waits, for the
// reads behind its screens. FastNear and Intear answer 429 past their limits (the overnight run of 2 Nov: ledger. and
// security.nodes.unreachable all night, and real-money steps failed on them), so every request counts.
//
// Counted on the real RpcChain and NodePace over counting nodes (core testing/rpc-nodes.ts: JSON-RPC from a FakeChain),
// each operation at a new final block, as on NEAR a second later; so what is counted is what goes on the wire after the
// two-node rule, the shared agreed block and NodePace's sharing. Every read is still asked of both nodes at one block:
// each test checks that both nodes got the very same reads. A change that adds a request must raise its budget here,
// on purpose. Before the 2 Nov read-budget work in brackets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { DemoCore } from "@zerofee/core/demo-core";
import { SoftwareKey } from "@zerofee/core/device-key";
import { FakeChain } from "@zerofee/core/testing/fake-chain";
import { rpcNodes, type RpcCount } from "@zerofee/core/testing/rpc-nodes";
import { MemoryVault } from "@zerofee/core/vault";
import { createApis } from "./apis.ts";
import { createLedgerService } from "./ledger.ts";
import type { Balance } from "./types.ts";
import { fakeCore, fakeNear, replayFetch, type Holdings } from "./testing/replay.ts";

/** Node requests (both nodes together) and round trips per operation, cold: a new block, nothing in flight. */
export const READ_BUDGET = {
  /** The first account read of the page (its recovery delay is read once, then kept). */
  accountStateFirst: { rpc: 12, rounds: 3 }, // [14, 3]
  accountState: { rpc: 10, rounds: 2 }, // [12, 3]
  /** Wallet's first balance of the page: whose account it is (the account read above) and every coin. */
  balancesFirst: { rpc: 20, rounds: 4 }, // [22, 5]
  /** Every balance after it (a screen, Spending's Top up, the 30 s poll). */
  balances: { rpc: 8, rounds: 2 }, // [22, 5] (the poll: [14, 3])
  protectionGet: { rpc: 8, rounds: 2 }, // [8, 2]
  /** spending.status's NEAR reads (the core's subwallet.float.balance, .limits and subwallet.list): the first reads
   *  NEAR Intents' salt for the float's sign-in at 1Click; after it the float counts its own moves. */
  spendingStatusFirst: { rpc: 4, rounds: 2 }, // [4, 2]
  spendingStatus: { rpc: 0, rounds: 0 }, // [0, 0]
  /** Private's balance (Home reads it when there is a pocket): its sign-in's salt is kept ten minutes. */
  privateBalance: { rpc: 0, rounds: 0 }, // [4, 2], every time
  /** Home's first load: account.state (the shell's, and Wallet's), the balances, activity, Private and Spending's reads at once. */
  home: { rpc: 14, rounds: 3 }, // [22, 5]
};

// The release build, not short-waits: the core below reads this account as mainnet, where a short-waits build is unknown
// code (audit, 4 Nov: fcd0a8fb). Nothing here waits, so the release's 48-hour recovery delay changes nothing.
const rulesWasm = new Uint8Array(readFileSync(new URL("../../../contracts/account-policy/release/account_policy.wasm", import.meta.url)));
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const WNEAR = "nep141:wrap.near";
const BANDS = [{ up_to: [["near", `5${"0".repeat(24)}`]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }];

const ok = <T>(r: BridgeResult<T>): T => {
  if ("problem" in r) assert.fail(`expected ok, got ${r.problem.code}: ${r.problem.whatHappened}`);
  return r.ok;
};

/** 1Click's account API, for the float's and Private's sign-in (never the real one from a test): an empty balance. */
const realFetch = globalThis.fetch;
const oneClickSignIns: string[] = [];
function stubOneClick() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/auth/authenticate")) return oneClickSignIns.push(url), json({ accessToken: "t" });
    if (url.endsWith("/account/balances")) return json({ balances: [] });
    return new Response("not in this test", { status: 500 });
  }) as typeof fetch;
}

/** A ready mainnet account with today's contract, USDC and wNEAR inside intents.near; the core and the ledger on the counting nodes, one pace. */
async function world() {
  stubOneClick();
  const fake = new FakeChain("testnet");
  fake.fund("bob.testnet", SoftwareKey.generate().publicKey, 0n);
  const vault = new MemoryVault();
  const maker = new DemoCore({ chain: fake, vault, policyWasm: async () => rulesWasm, recoveryDelaySeconds: 48 * 3600, createAccount: async (id, pk) => fake.fund(id, pk), prices: async () => ({ near: 4 }), protection: BANDS, watchIntervalMs: 60_000, indexRetryMs: 1 });
  approveAll(maker);
  const { accountId } = ok(await maker.call<{ accountId: string }>("account.create"));
  const { words } = ok(await maker.call<{ words: string[] }>("recovery.words"));
  ok(await maker.call("recovery.confirm", { positions: [1, 2, 3], words: words.slice(0, 3) }));
  maker.close();
  fakeNear(accountId, { ledger: { [USDC]: "8490000", [WNEAR]: "1000000000000000000000000" } }, {}, fake);
  fake.views.set("intents.near current_salt", () => "0a1b2c3d");
  const nodes = rpcNodes(fake);
  const pace = nodes.pace();
  const core = new DemoCore({ chain: nodes.chain("mainnet", pace), vault, policyWasm: async () => rulesWasm, prices: async () => ({ near: 4 }), watchIntervalMs: 60_000, indexRetryMs: 1 });
  approveAll(core);
  // The ledger's own storage, as the shell's device service keeps it; everything else goes to the core.
  const kept = new Map<string, string>();
  const wallet: Bridge = {
    call: async <T>(method: string, p: Record<string, unknown> = {}) => {
      if (method === "device.store.get") return { ok: { value: kept.get(String(p.key)) ?? null } as T };
      if (method === "device.store.set") return (p.value === null ? kept.delete(String(p.key)) : kept.set(String(p.key), String(p.value))), { ok: { ok: true } as T };
      return core.call<T>(method, p);
    },
    on: (e, h) => core.on(e, h),
  };
  const ledger = createLedgerService({ bridge: wallet, chain: nodes.chain("mainnet", pace), apis: createApis(replayFetch()) });
  return { fake, nodes, core, ledger, accountId };
}

function approveAll(core: DemoCore) {
  core.on<{ id: string }>("approval.needed", ({ id }) => void core.call("approval.answer", { id, approve: true }));
}

/** One operation at a new final block, on idle nodes (the agreed block kept a second has gone). */
async function measure(nodes: ReturnType<typeof rpcNodes>, go: () => Promise<unknown>): Promise<RpcCount> {
  await new Promise((r) => setTimeout(r, 1_050));
  nodes.newBlock();
  nodes.reset();
  await go();
  const c = nodes.count();
  if (process.env.READ_BUDGET_TRACE) console.log(`${c.total} requests, ${c.rounds} round trips\n  ${c.asked.join("\n  ")}`);
  return c;
}

/** The two-node rule, as counted: each node got exactly the same reads (none asked of one node alone). */
function bothNodes(c: RpcCount, what: string) {
  const [a, b] = Object.keys(c.perNode).sort();
  const of = (host: string) => c.asked.filter((x) => x.startsWith(`${host} `)).map((x) => x.slice(host.length + 1)).sort();
  if (c.total === 0) return;
  assert.equal(Object.keys(c.perNode).length, 2, `${what}: asked of ${Object.keys(c.perNode).join(", ")}`);
  assert.deepEqual(of(a), of(b), `${what}: both nodes get every read`);
}

/** READ_BUDGET_REPORT=1: print each operation's figures instead of checking them (to measure another build). */
function within(c: RpcCount, budget: { rpc: number; rounds: number }, what: string) {
  if (process.env.READ_BUDGET_REPORT) return void console.log(`${what}: ${c.total} node requests, ${c.rounds} round trips (budget ${budget.rpc}, ${budget.rounds})`);
  bothNodes(c, what);
  assert.ok(c.total <= budget.rpc, `${what}: ${c.total} node requests (budget ${budget.rpc})\n  ${c.asked.join("\n  ")}`);
  assert.ok(c.rounds <= budget.rounds, `${what}: ${c.rounds} round trips (budget ${budget.rounds})`);
}

test("the account, the balances, Protection, Spending and Home's first load stay within their node requests and round trips", async () => {
  const { nodes, core, ledger } = await world();
  try {
    within(await measure(nodes, () => core.call("account.state")), READ_BUDGET.accountStateFirst, "account.state, first");
    within(await measure(nodes, () => core.call("account.state")), READ_BUDGET.accountState, "account.state");
    let rows: Balance[] = [];
    within(await measure(nodes, async () => (rows = ok(await ledger.call<Balance[]>("ledger.balances")))), READ_BUDGET.balancesFirst, "ledger.balances, first");
    assert.deepEqual(rows.map((r) => `${r.symbol} ${r.amount} ${r.held}`).sort(), ["NEAR 1 ledger", "NEAR 9.939999 account", "USDC 8.49 ledger"]);
    within(await measure(nodes, async () => (rows = ok(await ledger.call<Balance[]>("ledger.balances")))), READ_BUDGET.balances, "ledger.balances");
    assert.equal(rows.length, 3, "the same coins, read again");
    within(await measure(nodes, async () => ok(await core.call("account.protection.get"))), READ_BUDGET.protectionGet, "account.protection.get");
    const spending = () => Promise.all([core.call("subwallet.float.balance"), core.call("subwallet.float.limits"), core.call("subwallet.list")]);
    within(await measure(nodes, spending), READ_BUDGET.spendingStatusFirst, "spending.status's reads, first");
    within(await measure(nodes, spending), READ_BUDGET.spendingStatus, "spending.status's reads");
    // Private's pocket: its balance is read with its own sign-in at 1Click, which carries NEAR Intents' salt.
    ok(await core.call("subwallet.create", { kind: "private", chain: "near" }));
    const pocket = () => core.call("subwallet.private.balances").then(ok);
    await pocket();
    const signIns = oneClickSignIns.length;
    within(await measure(nodes, pocket), READ_BUDGET.privateBalance, "Private's balance");
    assert.equal(oneClickSignIns.length, signIns + 1, "each read still signs in at 1Click");
    const home = () => Promise.all([core.call("account.state"), ledger.call("ledger.balances"), ledger.call("ledger.activity", { limit: 50 }), ledger.call("ledger.private"), core.call("account.state"), spending()]);
    within(await measure(nodes, home), READ_BUDGET.home, "Home's first load");
  } finally {
    core.close();
    globalThis.fetch = realFetch;
  }
});

// What the budget rests on, one part at a time (the ledger alone, a stand-in core).

function ledgerOn(holdings: Holdings, clock: { ms: number }) {
  const fake = fakeNear("kid.near", holdings);
  const nodes = rpcNodes(fake, { roundMs: 1 });
  const pace = nodes.pace();
  const core = fakeCore({ accountId: "kid.near" });
  const ledger = createLedgerService({ bridge: core, chain: nodes.chain("mainnet", pace), apis: createApis(replayFetch()), now: () => clock.ms });
  const read = async () => {
    // a later final block: the agreed one is dropped (as a send drops it), so the next read is at the new head
    pace.forgetHeads();
    nodes.newBlock();
    nodes.reset();
    const rows = ok(await ledger.call<Balance[]>("ledger.balances"));
    return { rows, asked: nodes.count().asked };
  };
  return { ledger, read };
}
const asks = (asked: string[], what: string) => asked.filter((x) => x.endsWith(what)).length;

test("a coin straight on the account that it never held is read on the first read, then every two minutes; one it holds, every time", async () => {
  const clock = { ms: Date.parse("2026-11-02T08:00:00Z") };
  const holdings: Holdings = { ledger: { [USDC]: "1000000" }, account: {} };
  const { ledger, read } = ledgerOn(holdings, clock);
  assert.equal(asks((await read()).asked, "ft_balance_of"), 6, "all three, on both nodes");
  clock.ms += 30_000;
  assert.equal(asks((await read()).asked, "ft_balance_of"), 0, "never held: not read 30 s later");
  holdings.account![USDC] = "5000000";
  clock.ms += 90_000;
  const first = await read();
  assert.equal(asks(first.asked, "ft_balance_of"), 6, "two minutes on: read again");
  assert.ok(first.rows.some((r) => r.symbol === "USDC" && r.held === "account" && r.amount === "5"), "the first USDC on the account shows");
  clock.ms += 30_000;
  const next = await read();
  assert.deepEqual(next.asked.filter((x) => x.endsWith("ft_balance_of")).map((x) => x.split(" ")[2]).sort(), ["17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"], "held once: USDC every time, the others not");
  holdings.account![USDC] = "0";
  clock.ms += 30_000;
  assert.equal(asks((await read()).asked, "ft_balance_of"), 2, "spent to nothing: still read, it may come back");
  // Receive's NEAR address shown: every coin straight on the account is read each time for half an hour.
  ok(await ledger.call("ledger.depositAddress", { chain: "near" }));
  clock.ms += 10_000;
  assert.equal(asks((await read()).asked, "ft_balance_of"), 6, "after Receive on NEAR: all three");
  clock.ms += 31 * 60_000;
  await read();
  clock.ms += 30_000;
  assert.equal(asks((await read()).asked, "ft_balance_of"), 2, "half an hour on: back to the coins it held");
});

test("the coins inside intents.near: their amounts are asked beside the list (one round trip), and a list that changed is asked again for exactly what it lists", async () => {
  const clock = { ms: Date.parse("2026-11-02T08:00:00Z") };
  const holdings: Holdings = { ledger: { [USDC]: "1000000" } };
  const { read } = ledgerOn(holdings, clock);
  const first = await read();
  assert.equal(asks(first.asked, "mt_batch_balance_of"), 2, "nothing seen yet: the list, then its amounts");
  clock.ms += 30_000;
  const again = await read();
  assert.equal(asks(again.asked, "mt_tokens_for_owner"), 2);
  assert.equal(asks(again.asked, "mt_batch_balance_of"), 2, "the same list: its amounts were asked beside it, once");
  holdings.ledger![WNEAR] = "2000000000000000000000000";
  clock.ms += 30_000;
  const grown = await read();
  assert.equal(asks(grown.asked, "mt_batch_balance_of"), 4, "a new coin: the guess and the list's own amounts");
  assert.deepEqual(grown.rows.filter((r) => r.held === "ledger").map((r) => [r.symbol, r.amount]).sort(), [["NEAR", "2"], ["USDC", "1"]]);
  delete holdings.ledger![USDC];
  clock.ms += 30_000;
  const shrunk = await read();
  assert.deepEqual(shrunk.rows.filter((r) => r.held === "ledger").map((r) => r.symbol), ["NEAR"], "a coin gone from the list is gone from the rows");
});

test("a coin 1Click doesn't list is named from its own ft_metadata once, on two nodes, and kept", async () => {
  const clock = { ms: Date.parse("2026-11-02T08:00:00Z") };
  const holdings: Holdings = { ledger: { "nep141:junk.near": "1234" } };
  const { read } = ledgerOn(holdings, clock);
  const first = await read();
  assert.equal(asks(first.asked, "ft_metadata"), 2);
  assert.equal(first.rows.find((r) => r.tokenId === "nep141:junk.near")?.listed, false);
  clock.ms += 30_000;
  assert.equal(asks((await read()).asked, "ft_metadata"), 0, "its name and decimals never change: not asked again");
});

test("screens asking at once share one balance read; the account is asked of the core once a minute", async () => {
  const clock = { ms: Date.parse("2026-11-02T08:00:00Z") };
  const fake = fakeNear("kid.near", { ledger: { [USDC]: "1000000" } });
  const nodes = rpcNodes(fake, { roundMs: 1 });
  const core = fakeCore({ accountId: "kid.near" });
  let states = 0;
  const counted: Bridge = { call: (m, p) => ((states += m === "account.state" ? 1 : 0), core.call(m, p)), on: core.on };
  const ledger = createLedgerService({ bridge: counted, chain: nodes.chain("mainnet"), apis: createApis(replayFetch()), now: () => clock.ms });
  nodes.newBlock();
  nodes.reset();
  const all = await Promise.all([ledger.call<Balance[]>("ledger.balances"), ledger.call<Balance[]>("ledger.balances"), ledger.call<Balance[]>("ledger.balances")]);
  all.forEach((r) => assert.ok("ok" in r && r.ok.length === 1));
  assert.equal(asks(nodes.count().asked, "mt_tokens_for_owner"), 2, "one read, on two nodes, for all three");
  assert.equal(states, 1);
  clock.ms += 30_000;
  ok(await ledger.call("ledger.balances"));
  assert.equal(states, 1, "half a minute on: the same account");
  clock.ms += 31_000;
  ok(await ledger.call("ledger.balances"));
  assert.equal(states, 2, "a minute on: asked again");
});
