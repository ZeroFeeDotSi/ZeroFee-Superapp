import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps, type Bridge } from "@zerofee/core/bridge";
import type { AccountInfo, TxOutcome } from "@zerofee/core/signer";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { sampleEarn } from "./app/demo.ts";
import { createEarnReader } from "./reader.ts";
import { createEarnService } from "./staking.ts";
import { FakeNear, near } from "./testing/fake-near.ts";
import type { Position } from "./types.ts";

const ALICE: AccountInfo = { accountId: "alice.testnet", network: "testnet", keys: [], recovery: null };

/** A core whose account is `account` (none when null), on MockBridge; every method reached is recorded. */
function core(account: AccountInfo | null, waiting: Record<string, string> = {}) {
  const mock = createMockBridge({ latencyMs: 0 });
  const reached: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>) {
      reached.push(method);
      if (method === "account.state") return { ok: (account ? { stage: "ready", account } : { stage: "none" }) as T };
      if (method === "account.waiting.status") return { ok: { state: waiting[String(params?.id)] ?? "unknown" } as T };
      return mock.call<T>(method, params);
    },
    on: (e, h) => mock.on(e, h),
  };
  return { earnBridge: forApps(bridge, "earn"), reached };
}

/** A fake NEAR where Alice has 40 NEAR earning with Allnodes and 5 NEAR ready at Zavodil, as Earn would have kept it. */
async function staked(earnBridge: Bridge) {
  const chain = new FakeNear("testnet");
  const allnodes = chain.addPool("allnodes.poolv1.near", { stake: near(6_380_000) });
  const zavodil = chain.addPool("zavodil.poolv1.near", { stake: near(17_850_000), fee: { numerator: 1, denominator: 100 } });
  chain.accounts.set(ALICE.accountId, { balance: near(10), storageBytes: 1000n });
  allnodes.stakers.set(ALICE.accountId, { staked: near(40), unstaked: 0n, canWithdraw: false });
  zavodil.stakers.set(ALICE.accountId, { staked: 0n, unstaked: near(5), canWithdraw: true });
  const pools = { "allnodes.poolv1.near": { feeAtStake: { numerator: 0, denominator: 100 } }, "zavodil.poolv1.near": { feeAtStake: { numerator: 1, denominator: 100 } } };
  await earnBridge.call("device.store.set", { key: "pools", value: JSON.stringify(pools) });
  return chain;
}

test("reader: earn.positions answers what the Earn app shows, from Earn's own storage, reading only", async () => {
  const { earnBridge, reached } = core(ALICE);
  const chain = await staked(earnBridge);
  const app = createEarnService({ bridge: earnBridge, chain, network: chain });
  const reader = createEarnReader(earnBridge, () => ({ chain, network: chain }));
  reached.length = 0;
  const r = await reader.call<Position[]>("earn.positions");
  assert.ok("ok" in r, "answered");
  assert.deepEqual(new Set(reached), new Set(["account.state", "device.store.get"]), "it only reads the account and Earn's storage");
  const shown = await app.call<Position[]>("earn.positions");
  assert.ok("ok" in shown);
  assert.deepEqual(r.ok, shown.ok, "the same rows as the Earn app");
  assert.deepEqual(r.ok.map((p) => [p.name, p.staked, p.unstaked, p.canWithdraw]), [["Allnodes", "40", "0", false], ["Zavodil", "0", "5", true]]);
});

test("reader: every other method is refused, and nothing is ever signed", async () => {
  const { earnBridge, reached } = core(ALICE);
  const chain = await staked(earnBridge);
  const reader = createEarnReader(earnBridge, () => ({ chain, network: chain }));
  for (const method of ["earn.stake", "earn.unstake", "earn.withdraw", "earn.validators", "earn.history", "tx.request", "device.store.set"]) {
    const r = await reader.call(method, { poolId: "allnodes.poolv1.near", amount: "1" });
    assert.ok("problem" in r && r.problem.code === "security.method.unknown", `${method} refused`);
  }
  assert.ok(!reached.includes("tx.request"));
});

test("reader: no account yet means nothing staked", async () => {
  const { earnBridge } = core(null);
  const r = await createEarnReader(earnBridge, () => assert.fail("no nodes needed")).call<Position[]>("earn.positions");
  assert.deepEqual(r, { ok: [] });
});

test("reader: in the demo, the sample account's positions are the Earn app's, stakes included", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const earnBridge = forApps(mock, "earn");
  const reader = createEarnReader(earnBridge);
  const before = await reader.call<Position[]>("earn.positions");
  assert.ok("ok" in before);
  assert.deepEqual(before.ok.map((p) => [p.name, p.staked, p.unstaked]), [["Allnodes", "50.21", "0"], ["Zavodil", "30.1", "20"]]);
  // Stake through the Earn app's sample: the reader sees it.
  const app = sampleEarn(earnBridge, "zf-sample000001.testnet");
  const out = await app.call<TxOutcome>("earn.stake", { poolId: "allnodes.poolv1.near", amount: "10", feeSeen: { numerator: 0, denominator: 100 } });
  assert.ok("ok" in out && out.ok.status === "done");
  const after = await reader.call<Position[]>("earn.positions");
  assert.ok("ok" in after);
  assert.equal(after.ok.find((p) => p.name === "Allnodes")?.staked, "60.21");
});

test("reader: a held stake that ran since is counted as put in, though the reader can't write that down", async () => {
  const { earnBridge, reached } = core(ALICE, { "held-3": "ran" });
  const chain = await staked(earnBridge);
  chain.pools.get("allnodes.poolv1.near")!.stakers.set(ALICE.accountId, { staked: near(51), unstaked: 0n, canWithdraw: false });
  const held = { id: "held-3", kind: "stake", amount: near(10).toString(), stakedBefore: near(41).toString() };
  const pools = { "allnodes.poolv1.near": { feeAtStake: { numerator: 0, denominator: 100 }, principal: near(40).toString(), held: [held] } };
  await earnBridge.call("device.store.set", { key: "pools", value: JSON.stringify(pools) });
  const reader = createEarnReader(earnBridge, () => ({ chain, network: chain }));
  reached.length = 0;
  for (let i = 0; i < 2; i++) {
    const r = await reader.call<Position[]>("earn.positions");
    assert.ok("ok" in r);
    assert.equal(r.ok[0].earned, "1", "51 staked, 50 put in");
  }
  assert.ok(!reached.includes("device.store.set"), "it never wrote");
});
