import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps, type Bridge } from "@zerofee/core/bridge";
import type { Problem } from "@zerofee/core/problem";
import type { AccountInfo, TxOutcome, TxRequest } from "@zerofee/core/signer";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createEarnService, reminderId } from "./staking.ts";
import { FakeNear, NEAR, near } from "./testing/fake-near.ts";
import type { HistoryItem, Position, Validators } from "./types.ts";

const ME = { testnet: "zf-sample000001.testnet", mainnet: "zf-sample000001.near" } as const;

/** Earn on a fake NEAR, with MockBridge as the core. Every tx.request is recorded; `answer` can replace any core method. */
function setup(network: "testnet" | "mainnet" = "testnet") {
  const chain = new FakeNear(network);
  // Ten big validators (skipped as the biggest), then the ones the rules decide between.
  for (let i = 1; i <= 10; i++) chain.addPool(`big${i}.poolv1.near`, { stake: near(40_000_000 + i) });
  chain.addPool("allnodes.poolv1.near", { stake: near(6_380_000) });
  chain.addPool("autostake.poolv1.near", { stake: near(1_460_000) });
  chain.addPool("zavodil.poolv1.near", { stake: near(17_850_000), fee: { numerator: 1, denominator: 100 }, growth: 0.0531 });
  chain.addPool("kiln.poolv1.near", { fee: { numerator: 99, denominator: 100 } });
  chain.addPool("legends.poolv1.near", { paused: true });
  chain.addPool("custom.near", { codeHash: "SomeOtherCode1111111111111111111111111111111" });
  chain.addPool("global.poolv1.near", { globalCode: "SomeGlobalCode111111111111111111111111111111" });
  chain.addPool("slow.poolv1.near", { uptime: 0.9 });
  chain.addPool("dropped.poolv1.near");
  chain.kickedOut = ["dropped.poolv1.near"];
  chain.accounts.set(ME[network], { balance: near(120), storageBytes: 1000n }); // 0.01 NEAR of storage

  const mock = createMockBridge({ latencyMs: 0 });
  const sent: TxRequest[] = [];
  const answer: Record<string, (p: Record<string, unknown>) => unknown> = {};
  const account: AccountInfo = { accountId: ME[network], network, keys: [], recovery: null };
  answer["account.state"] = () => ({ stage: "ready", account });
  const core: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      if (method === "tx.request") sent.push((params as { request: TxRequest }).request);
      if (answer[method]) return { ok: (await answer[method](params ?? {})) as T };
      return mock.call<T>(method, params);
    },
    on: (e, h) => mock.on(e, h),
  };
  const clock = { ms: 1_800_000_000_000 };
  const earn = createEarnService({ bridge: forApps(core, "earn"), chain, network: chain, now: () => clock.ms });
  const ok = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
    const r = await earn.call<T>(method, params);
    if ("problem" in r) assert.fail(`${method}: ${r.problem.code} ${r.problem.whatHappened}`);
    return r.ok;
  };
  const problem = async (method: string, params?: Record<string, unknown>): Promise<Problem> => {
    const r = await earn.call(method, params);
    if (!("problem" in r)) assert.fail(`${method} should have been refused`);
    return r.problem;
  };
  return { chain, earn, sent, answer, ok, problem, clock };
}

const ZERO = { numerator: 0, denominator: 100 };

test("validators: one picked by the rules, two more, each fee read now; rates come separately, then with the list", async () => {
  const { ok } = setup();
  const first = await ok<Validators>("earn.validators");
  assert.equal(first.picked?.rate, null, "the list doesn't wait for a measurement");
  assert.deepEqual(await ok("earn.rate", { poolId: "allnodes.poolv1.near" }), { rate: { percent: "5.37", days: 0.6 } });
  await ok("earn.rate", { poolId: "zavodil.poolv1.near" });
  const v = await ok<Validators>("earn.validators");
  assert.equal(v.picked?.poolId, "allnodes.poolv1.near", "lowest fee, then most work done, then most stake");
  assert.deepEqual(v.others.map((o) => o.poolId), ["autostake.poolv1.near", "zavodil.poolv1.near"]);
  // Skipped: the ten biggest, a 99% fee, paused, not the standard code, behind on its work, dropped last epoch.
  assert.equal(v.picked?.feePercent, "0");
  assert.equal(v.picked?.rate?.percent, "5.37");
  assert.equal(v.others[1].rate?.percent, "5.31");
  assert.equal(v.picked?.rate?.days, 0.6, "about two epochs (all ordinary nodes keep), without archival nodes");
  assert.deepEqual(v.idle, { account: "119.94", accountWrapped: "0", ledger: "0", total: "119.94", reserve: "0.05" });
  assert.equal(v.wait.epochHours, 6.9);
  assert.equal(v.wait.minHours, 20.6);
  assert.equal(v.wait.maxHours, 27.5);
});

test("validators: a fee raised since the last visit drops the pool from the list at once", async () => {
  const { chain, ok } = setup();
  await ok("earn.validators");
  chain.pools.get("allnodes.poolv1.near")!.fee = { numerator: 20, denominator: 100 };
  const v = await ok<Validators>("earn.validators");
  assert.equal(v.picked?.poolId, "autostake.poolv1.near");
});

test("stake from NEAR in the account: one approval, deposit_and_stake with the exact amount", async () => {
  const { ok, sent } = setup();
  const outcome = await ok<TxOutcome>("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  assert.equal(outcome.status, "done");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    receiverId: "allnodes.poolv1.near",
    actions: [{ kind: "call", method: "deposit_and_stake", args: {}, depositYocto: (50n * NEAR).toString(), gas: "125000000000000" }],
    why: "Stake 50 NEAR with Allnodes",
    from: "earn",
  });
});

test("stake refuses before anything is signed: fee changed, unknown code, paused, off the list", async () => {
  const { chain, problem, sent } = setup();
  chain.pools.get("allnodes.poolv1.near")!.fee = { numerator: 5, denominator: 100 };
  const fee = await problem("earn.stake", { poolId: "allnodes.poolv1.near", amount: "1", feeSeen: ZERO });
  assert.equal(fee.code, "earn.pool.fee-changed");
  assert.match(fee.whatHappened, /from 0% to 5%/);
  assert.equal((await problem("earn.stake", { poolId: "custom.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.unknown-code");
  assert.equal((await problem("earn.stake", { poolId: "global.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.unknown-code", "the code it really runs, a global contract included");
  const paused = await problem("earn.stake", { poolId: "legends.poolv1.near", amount: "1", feeSeen: ZERO });
  assert.equal(paused.code, "earn.pool.paused");
  assert.deepEqual(paused.money, { state: "safe", where: "in your Safe" });
  assert.equal((await problem("earn.stake", { poolId: "dropped.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.left-list");
  assert.equal((await problem("earn.stake", { poolId: "slow.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.left-list");
  assert.equal(sent.length, 0);
});

test("a pool with the standard code but an access key left on it is never suggested or staked with (its owner could redeploy it)", async () => {
  const { chain, ok, problem, sent } = setup();
  const fullKey = { handle: "ed25519:Owner1111111111111111111111111111111111111", nonce: 1n, permission: { kind: "full" as const } };
  // A 0% fee and more stake than the others, so lowest fee, then most stake, puts it at the top.
  chain.addPool("trap.poolv1.near", { stake: near(9_000_000), keys: [fullKey] });
  chain.addPool("split.poolv1.near", { stake: near(8_000_000), keysDisagree: true });
  const v = await ok<Validators>("earn.validators");
  const listed = [v.picked?.poolId, ...v.others.map((o) => o.poolId)];
  assert.ok(!listed.includes("trap.poolv1.near"), `a pool with a full-access key was suggested: ${listed.join(", ")}`);
  assert.ok(!listed.includes("split.poolv1.near"), "keys the two nodes disagree on count as not standard");
  assert.equal(v.picked?.poolId, "allnodes.poolv1.near");
  assert.equal((await ok<{ eligible: boolean }>("earn.pool", { poolId: "trap.poolv1.near" })).eligible, false);
  assert.equal((await problem("earn.stake", { poolId: "trap.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.unknown-code");
  assert.ok((await problem("earn.stake", { poolId: "split.poolv1.near", amount: "1", feeSeen: ZERO })).code, "a disagreement on its keys refuses the stake");
  // A function-call key can't deploy code, but the rule is no keys at all.
  chain.pools.get("trap.poolv1.near")!.keys = [{ ...fullKey, permission: { kind: "function-call", receiverId: "trap.poolv1.near", methods: [], allowanceYocto: null } }];
  assert.equal((await problem("earn.stake", { poolId: "trap.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.unknown-code");
  // With no keys it is a standard pool; a key added after the list is caught again right before the stake is built.
  chain.pools.get("trap.poolv1.near")!.keys = [];
  assert.equal((await ok<Validators>("earn.validators")).picked?.poolId, "trap.poolv1.near");
  chain.pools.get("trap.poolv1.near")!.keys = [fullKey];
  assert.equal((await problem("earn.stake", { poolId: "trap.poolv1.near", amount: "1", feeSeen: ZERO })).code, "earn.pool.unknown-code");
  assert.equal(sent.length, 0, "nothing was signed");
});

test("stake checks the amount: a plain decimal, no more than there is, and 0.05 NEAR left for fees", async () => {
  const { problem, sent } = setup();
  const at = (amount: string) => problem("earn.stake", { poolId: "allnodes.poolv1.near", amount, feeSeen: ZERO });
  assert.equal((await at("abc")).code, "earn.amount.invalid");
  assert.equal((await at("0")).code, "earn.amount.invalid");
  assert.equal((await at("1e3")).code, "earn.amount.invalid");
  assert.equal((await at("121")).code, "earn.amount.too-much");
  const fees = await at("119.97");
  assert.equal(fees.code, "earn.amount.keep-for-fees");
  assert.match(fees.whatHappened, /0\.05 NEAR/);
  assert.equal(sent.length, 0);
});

test("stake waits for the backup words, as every signature does", async () => {
  const { answer, problem } = setup();
  answer["account.state"] = () => ({ stage: "needs-backup", account: { accountId: ME.testnet, network: "testnet", keys: [], recovery: null } });
  assert.equal((await problem("earn.stake", { poolId: "allnodes.poolv1.near", amount: "1", feeSeen: ZERO })).code, "security.backup.needed");
});

test("stake on mainnet takes the account's NEAR, then its wNEAR, then the ledger's, in ONE approval", async () => {
  const { chain, ok, sent } = setup("mainnet");
  chain.accounts.set(ME.mainnet, { balance: near(10.06), storageBytes: 1000n }); // 10 NEAR to stake after storage and the reserve
  chain.wrapped.set(ME.mainnet, near(5));
  chain.ledger.set(ME.mainnet, near(100));
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "40", feeSeen: ZERO });
  assert.equal(sent.length, 1, "one approval");
  const r = sent[0];
  assert.equal(r.receiverId, "intents.near", "the account already holds wNEAR, so wrap.near needs no storage deposit");
  assert.deepEqual(r.actions, [{ kind: "call", method: "ft_withdraw", args: { token: "wrap.near", receiver_id: ME.mainnet, amount: (25n * NEAR).toString() }, depositYocto: "1", gas: "60000000000000" }]);
  assert.deepEqual(r.then, [
    { receiverId: "wrap.near", actions: [{ kind: "call", method: "near_withdraw", args: { amount: (30n * NEAR).toString() }, depositYocto: "1", gas: "10000000000000" }] },
    { receiverId: "allnodes.poolv1.near", actions: [{ kind: "call", method: "deposit_and_stake", args: {}, depositYocto: (40n * NEAR).toString(), gas: "100000000000000" }] },
  ]);
});

test("stake from the ledger alone registers wrap.near first, still in one approval", async () => {
  const { chain, ok, sent } = setup("mainnet");
  chain.accounts.set(ME.mainnet, { balance: near(0.06), storageBytes: 1000n });
  chain.ledger.set(ME.mainnet, near(100));
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "20", feeSeen: ZERO });
  const r = sent[0];
  assert.equal(r.receiverId, "wrap.near");
  assert.equal(r.actions[0].kind === "call" && r.actions[0].method, "storage_deposit");
  assert.deepEqual(r.then?.map((g) => g.receiverId), ["intents.near", "wrap.near", "allnodes.poolv1.near"]);
});

test("a ledger stake that stops part way says where the NEAR is now", async () => {
  const { chain, answer, ok } = setup("mainnet");
  chain.accounts.set(ME.mainnet, { balance: near(0.06), storageBytes: 1000n });
  chain.wrapRegistered.add(ME.mainnet);
  chain.ledger.set(ME.mainnet, near(100));
  answer["tx.request"] = () => {
    // The ledger step worked, the next one didn't: the wNEAR is now in the account.
    chain.ledger.set(ME.mainnet, near(80));
    chain.wrapped.set(ME.mainnet, near(20));
    return { status: "problem", problem: { code: "security.send.failed", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "retry", label: "Try again" } } };
  };
  const outcome = await ok<TxOutcome>("earn.stake", { poolId: "allnodes.poolv1.near", amount: "20", feeSeen: ZERO });
  assert.equal(outcome.status, "problem");
  assert.equal(outcome.status === "problem" && outcome.problem.code, "earn.route.out-of-ledger");
});

test("saying no on the sheet comes back as declined, not as a Problem", async () => {
  const { answer, ok } = setup();
  answer["tx.request"] = () => ({ status: "declined" });
  assert.deepEqual(await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "1", feeSeen: ZERO }), { status: "declined" });
});

test("unstake: the wait is worked out from the epoch, and the time is shown", async () => {
  const { chain, ok, sent } = setup();
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: near(50), unstaked: 0n, canWithdraw: false });
  const r = await ok<{ outcome: TxOutcome; readyAtIso: string }>("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "20" });
  assert.deepEqual(sent[0].actions, [{ kind: "call", method: "unstake", args: { amount: (20n * NEAR).toString() }, depositYocto: "0", gas: "125000000000000" }]);
  // Half way through the epoch: ready at the start of the epoch four on, 3.5 epochs from now.
  const expected = Number(chain.tsOf(chain.startHeight + 4 * chain.length) / 1_000_000n);
  assert.ok(Math.abs(Date.parse(r.readyAtIso) - expected) < 1000, r.readyAtIso);
  assert.equal((await ok<{ outcome: TxOutcome }>("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "all", restartWait: true })).outcome.status, "done");
  assert.deepEqual(sent[1].actions[0], { kind: "call", method: "unstake_all", args: {}, depositYocto: "0", gas: "125000000000000" });
});

test("unstaking more would restart the wait, so it's refused unless the person asks for it", async () => {
  const { chain, problem, sent } = setup();
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  pool.stakers.set(ME.testnet, { staked: near(50), unstaked: near(10), canWithdraw: false });
  const waiting = await problem("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "5" });
  assert.equal(waiting.code, "earn.unstake.restarts-wait");
  assert.equal(waiting.next.kind, "wait");
  pool.stakers.set(ME.testnet, { staked: near(50), unstaked: near(10), canWithdraw: true });
  const ready = await problem("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "5" });
  assert.deepEqual(ready.next, { kind: "open", label: "Bring it home first", screen: "withdraw" });
  assert.equal((await problem("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "60" })).code, "earn.amount.more-than-staked");
  assert.equal((await problem("earn.unstake", { poolId: "zavodil.poolv1.near", amount: "1" })).code, "earn.unstake.nothing");
  assert.equal(sent.length, 0);
});

test("withdraw: not ready says when; a pool without the NEAR yet waits an epoch; ready brings it home", async () => {
  const { chain, ok, problem, sent } = setup();
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  pool.stakers.set(ME.testnet, { staked: near(30), unstaked: near(20), canWithdraw: false });
  const early = await problem("earn.withdraw", { poolId: "allnodes.poolv1.near" });
  assert.equal(early.code, "earn.unstake.not-ready");
  assert.equal(early.money.state, "on-the-way");
  assert.ok(early.next.kind === "wait" && early.next.untilIso);

  pool.stakers.set(ME.testnet, { staked: near(30), unstaked: near(20), canWithdraw: true });
  pool.liquid = near(5);
  assert.equal((await problem("earn.withdraw", { poolId: "allnodes.poolv1.near" })).code, "earn.withdraw.pool-short");

  pool.liquid = near(500);
  await ok("earn.withdraw", { poolId: "allnodes.poolv1.near" });
  assert.deepEqual(sent[0].actions, [{ kind: "call", method: "withdraw", args: { amount: (20n * NEAR).toString() }, depositYocto: "0", gas: "125000000000000" }]);
  assert.equal((await problem("earn.withdraw", { poolId: "zavodil.poolv1.near" })).code, "earn.withdraw.nothing");
});

test("withdraw on into NEAR Intents is one approval: withdraw, then near_deposit and ft_transfer_call", async () => {
  const { chain, ok, sent } = setup("mainnet");
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  pool.stakers.set(ME.mainnet, { staked: 0n, unstaked: near(20), canWithdraw: true });
  pool.liquid = near(500);
  chain.wrapRegistered.add(ME.mainnet);
  await ok("earn.withdraw", { poolId: "allnodes.poolv1.near", toLedger: true });
  const twenty = (20n * NEAR).toString();
  assert.deepEqual(sent[0].then, [
    {
      receiverId: "wrap.near",
      actions: [
        { kind: "call", method: "near_deposit", args: {}, depositYocto: twenty, gas: "10000000000000" },
        { kind: "call", method: "ft_transfer_call", args: { receiver_id: "intents.near", amount: twenty, msg: "" }, depositYocto: "1", gas: "60000000000000" },
      ],
    },
  ]);
});

test("positions: what is staked where, with an alert when the fee rose or the validator stopped earning", async () => {
  const { chain, ok, clock } = setup();
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  await ok("earn.stake", { poolId: "zavodil.poolv1.near", amount: "30", feeSeen: { numerator: 1, denominator: 100 } });
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: near(50), unstaked: 0n, canWithdraw: false });
  chain.pools.get("zavodil.poolv1.near")!.stakers.set(ME.testnet, { staked: near(30), unstaked: 0n, canWithdraw: false });

  let rows = await ok<Position[]>("earn.positions");
  assert.deepEqual(rows.map((r) => [r.poolId, r.staked, r.alert?.code]), [["allnodes.poolv1.near", "50", undefined], ["zavodil.poolv1.near", "30", undefined]]);

  chain.pools.get("allnodes.poolv1.near")!.fee = { numerator: 10, denominator: 100 };
  chain.kickedOut = ["zavodil.poolv1.near"];
  clock.ms += 61_000; // the validator set is read again after a minute; fees are read on every call
  rows = await ok<Position[]>("earn.positions");
  assert.equal(rows[0].alert?.code, "earn.pool.fee-raised");
  assert.match(rows[0].alert!.whatHappened, /from 0% to 10%/);
  assert.equal(rows[1].alert?.code, "earn.pool.out-of-set");
});

test("positions: NEAR asked back outside Earn gets the latest time it can be ready, marked as an estimate", async () => {
  const { chain, ok } = setup();
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "1", feeSeen: ZERO });
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: 0n, unstaked: near(1), canWithdraw: false });
  const [row] = await ok<Position[]>("earn.positions");
  assert.equal(row.readyIsEstimate, true);
  assert.ok(Date.parse(row.readyAtIso!) > Number(chain.tsOf(chain.height) / 1_000_000n));
});

test("two nodes that disagree stop everything, in Earn's words", async () => {
  const { chain, problem } = setup();
  chain.disagree = true;
  const p = await problem("earn.validators");
  assert.equal(p.code, "earn.nodes.disagree");
  assert.deepEqual(p.money, { state: "safe", where: "in your Safe" });
});

test("an unknown method and a bad pool name are Problems, never thrown errors", async () => {
  const { problem } = setup();
  assert.equal((await problem("earn.nope")).code, "security.method.unknown");
  assert.equal((await problem("earn.stake", { poolId: "NOT A NAME", amount: "1", feeSeen: ZERO })).code, "earn.unexpected");
});

test("earned so far: the stake now, less what was put in; unstaking takes its share of both", async () => {
  const { chain, ok } = setup();
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  pool.stakers.set(ME.testnet, { staked: near(51), unstaked: 0n, canWithdraw: false }); // it earned 1 NEAR
  assert.equal((await ok<Position[]>("earn.positions"))[0].earned, "1");
  await ok("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "25.5" }); // half of it
  pool.stakers.set(ME.testnet, { staked: near(25.5), unstaked: near(25.5), canWithdraw: false });
  assert.equal((await ok<Position[]>("earn.positions"))[0].earned, "0.5", "half the earnings stay with the half still in");
});

test("a stake the account's protection holds is on hold, never done, and isn't counted as staked (D17)", async () => {
  const { answer, ok } = setup();
  answer["tx.request"] = () => ({ status: "waiting", txHash: "h", explorerUrl: "https://testnet.nearblocks.io/txns/h", id: "held-1", readyAtIso: "2026-10-26T12:00:00.000Z", needsSecondDevice: false });
  const outcome = await ok<TxOutcome>("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  assert.equal(outcome.status, "waiting", "passed on as is, for useShell().showWaiting");
  const [item] = await ok<{ kind: string; status: string; amount: string }[]>("earn.history");
  assert.deepEqual([item.kind, item.status, item.amount], ["stake", "on-hold", "50"]);
});

/** Earn with 50 NEAR staked at Allnodes through it, then `held` asked for and held; `state` is what the core says of it. */
async function heldThen(held: { method: "earn.stake" | "earn.unstake"; amount: string }) {
  const t = setup();
  const pool = t.chain.pools.get("allnodes.poolv1.near")!;
  await t.ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  pool.stakers.set(ME.testnet, { staked: near(51), unstaked: 0n, canWithdraw: false }); // it earned 1 NEAR
  t.answer["tx.request"] = () => ({ status: "waiting", txHash: "h", explorerUrl: "https://testnet.nearblocks.io/txns/h", id: "held-7", readyAtIso: "2026-10-26T12:00:00.000Z", needsSecondDevice: false });
  await t.ok(held.method, { poolId: "allnodes.poolv1.near", amount: held.amount, feeSeen: ZERO });
  const state = { now: "waiting" as string };
  t.answer["account.waiting.status"] = (p) => (p.id === "held-7" ? { state: state.now } : { state: "unknown" });
  return { ...t, pool, state };
}

test("a held stake that runs later counts as put in: earnings don't jump by the stake (D17)", async () => {
  const { ok, pool, state } = await heldThen({ method: "earn.stake", amount: "10" });
  let [row] = await ok<Position[]>("earn.positions");
  assert.equal(row.earned, "1", "while it waits, nothing changed");
  assert.equal((await ok<HistoryItem[]>("earn.history"))[0].status, "on-hold");
  state.now = "ran";
  pool.stakers.set(ME.testnet, { staked: near(61), unstaked: 0n, canWithdraw: false });
  [row] = await ok<Position[]>("earn.positions");
  assert.equal(row.earned, "1", "the 10 NEAR it put in isn't counted as earned");
  const [item] = await ok<HistoryItem[]>("earn.history");
  assert.deepEqual([item.kind, item.status, item.amount, item.heldId], ["stake", "done", "10", "held-7"]);
});

test("a held stake that is cancelled says so, and changes nothing", async () => {
  const { ok, state } = await heldThen({ method: "earn.stake", amount: "10" });
  state.now = "cancelled";
  const [item] = await ok<HistoryItem[]>("earn.history");
  assert.equal(item.status, "cancelled");
  assert.equal((await ok<Position[]>("earn.positions"))[0].earned, "1");
});

test("a held unstake is on hold in history; when it runs, its share of what was put in leaves with it", async () => {
  const { ok, pool, state } = await heldThen({ method: "earn.unstake", amount: "25.5" });
  const [item] = await ok<HistoryItem[]>("earn.history");
  assert.deepEqual([item.kind, item.status, item.amount], ["unstake", "on-hold", "25.5"]);
  state.now = "ran";
  pool.stakers.set(ME.testnet, { staked: near(25.5), unstaked: near(25.5), canWithdraw: false });
  assert.equal((await ok<Position[]>("earn.positions"))[0].earned, "0.5", "half the earnings stay with the half still in");
  assert.equal((await ok<HistoryItem[]>("earn.history"))[0].status, "done");
});

test("a held request whose status can't be read stays on hold, never done", async () => {
  const { ok, answer } = await heldThen({ method: "earn.stake", amount: "10" });
  delete answer["account.waiting.status"]; // MockBridge doesn't know the method: a Problem
  assert.equal((await ok<HistoryItem[]>("earn.history"))[0].status, "on-hold");
});

test("history: what Earn asked for, newest first; nothing for a declined request", async () => {
  const { chain, answer, ok } = setup();
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: near(50), unstaked: 0n, canWithdraw: false });
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "50", feeSeen: ZERO });
  await ok("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "20" });
  answer["tx.request"] = () => ({ status: "declined" });
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "1", feeSeen: ZERO });
  const items = await ok<{ kind: string; status: string; readyAtIso?: string }[]>("earn.history");
  assert.deepEqual(items.map((i) => [i.kind, i.status]), [["unstake", "done"], ["stake", "done"]]);
  assert.ok(items[0].readyAtIso);
});

test("the few yocto a pool's rounding leaves unstaked after a stake are nothing on its way back (seen on testnet)", async () => {
  const { chain, ok, sent } = setup();
  await ok("earn.stake", { poolId: "allnodes.poolv1.near", amount: "0.25", feeSeen: ZERO });
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: near(0.25) - 2n, unstaked: 2n, canWithdraw: true });
  const [row] = await ok<Position[]>("earn.positions");
  assert.equal(row.unstaked, "0", "no \"on its way back\" row for dust");
  const { outcome } = await ok<{ outcome: TxOutcome }>("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "all" });
  assert.equal(outcome.status, "done", "the unstake isn't refused as restarting a wait");
  assert.equal(sent.at(-1)?.actions[0].kind === "call" && sent.at(-1)?.actions[0].method, "unstake_all");
});

test("rate (c): each measurement is kept, the next starts where it ended, and the rate grows toward 30 days", async () => {
  const { chain, clock, ok } = setup();
  const pool = { poolId: "allnodes.poolv1.near" };
  const rate = async () => (await ok<{ rate: { percent: string; days: number } }>("earn.rate", pool)).rate;
  const later = (blocks: number) => {
    chain.height += blocks;
    chain.startHeight = chain.height - 21_600; // half way through the epoch, as the head always is in one
    clock.ms += 7 * 3600_000; // past the 6 hours a rate is kept
  };
  assert.deepEqual(await rate(), { percent: "5.37", days: 0.6 }, "first: the two epochs the nodes keep");
  later(43_200); // one epoch on, while the nodes still hold where the last window ended
  assert.deepEqual(await rate(), { percent: "5.37", days: 0.9 }, "the new window starts where the last ended: no gap, no overlap");
  later(43_200 * 30); // about nine days, and the nodes no longer hold it
  chain.keepsFrom = chain.height - 2 * 43_200;
  assert.deepEqual(await rate(), { percent: "5.37", days: 1.4 }, "across the two epochs they do hold, added to what was kept");
  later(43_200 * 110); // about 31 days on: every kept window is older than 30 days and drops out
  chain.keepsFrom = chain.height - 2 * 43_200;
  assert.deepEqual(await rate(), { percent: "5.37", days: 0.6 });
});

test("rate (c): kept windows that can't be read, or claim more growth than a measurement accepts, are never used", async () => {
  const { answer, ok } = setup();
  const t = 1_790_000_000_000_000_000n;
  const day = 86_400_000_000_000n;
  const bad = {
    "allnodes.poolv1.near": [
      { fromHeight: 2, toHeight: 1, fromNs: String(t), toNs: String(t + day), growth: 1.0001 }, // backwards
      { fromHeight: 1, toHeight: 2, fromNs: "x", toNs: String(t + day), growth: 1.0001 }, // not a time
      { fromHeight: 10, toHeight: 20, fromNs: String(t), toNs: String(t + day), growth: 2 }, // 100% in a day
      { nonsense: true },
    ],
  };
  answer["device.store.get"] = (p) => ({ value: p.key === "rate-windows" ? JSON.stringify(bad) : null });
  const { rate } = await ok<{ rate: { percent: string; days: number } | null }>("earn.rate", { poolId: "allnodes.poolv1.near" });
  assert.deepEqual(rate, { percent: "5.37", days: 0.6 }, "a fresh measurement; nothing unreadable is added to it");
});

test("Earn's own words on the sheet keep at most 4 decimals, rounded down; the core's lines carry the exact amount", async () => {
  const { chain, ok, sent } = setup();
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  pool.stakers.set(ME.testnet, { staked: 0n, unstaked: near(100.66572) + 175205746778953n, canWithdraw: true });
  pool.liquid = near(500);
  await ok("earn.withdraw", { poolId: "allnodes.poolv1.near" });
  assert.equal(sent.at(-1)?.why, "Bring 100.6657 NEAR home from Allnodes");
  const action = sent.at(-1)?.actions[0];
  assert.equal(action?.kind === "call" && action.args.amount, (near(100.66572) + 175205746778953n).toString(), "the exact amount moves");
});

test("on the phone, an unstake sets one reminder for when it's ready; bringing it home cancels it", async () => {
  const { chain, answer, ok } = setup();
  const pool = chain.pools.get("allnodes.poolv1.near")!;
  pool.stakers.set(ME.testnet, { staked: near(50), unstaked: 0n, canWithdraw: false });
  const asked: Record<string, unknown>[] = [];
  answer["device.notify.schedule"] = (p) => (asked.push(p), { ok: true });
  answer["device.notify.cancel"] = (p) => (asked.push({ cancel: p.id }), { ok: true });
  const r = await ok<{ readyAtIso: string; reminder?: boolean }>("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "20.5" });
  assert.equal(r.reminder, true);
  const id = reminderId("allnodes.poolv1.near");
  assert.match(id, /^[a-z0-9][a-z0-9._-]{0,63}$/, "the host's id rule");
  // Security audit 11 (4 Nov): the lock screen never says how much or from which pool.
  assert.deepEqual(asked[0], { id, title: "Ready to bring home", body: "Your NEAR is ready to bring home.", atIso: r.readyAtIso, app: "earn" });
  assert.doesNotMatch(String(asked[0]!.body), /\d|Allnodes/);
  pool.stakers.set(ME.testnet, { staked: near(29.5), unstaked: near(20.5), canWithdraw: true });
  pool.liquid = near(500);
  await ok("earn.withdraw", { poolId: "allnodes.poolv1.near" });
  assert.deepEqual(asked.at(-1), { cancel: id });
});

test("without a phone to remind (the browser), the unstake still goes and says no reminder", async () => {
  const { chain, ok } = setup(); // MockBridge has no device.notify: like the browser, it answers a Problem
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ME.testnet, { staked: near(50), unstaked: 0n, canWithdraw: false });
  const r = await ok<{ outcome: TxOutcome; reminder?: boolean }>("earn.unstake", { poolId: "allnodes.poolv1.near", amount: "all" });
  assert.equal(r.outcome.status, "done");
  assert.equal(r.reminder, false);
});
