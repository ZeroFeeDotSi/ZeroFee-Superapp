// Finding 18 (real money, 4 Nov, zf-0000000a02.near): a $6 Move Safe → SOL. The Safe paid 1Click
// (HC3VmfBx…), 1Click took it and its status said SUCCESS, yet the row said "Leaving your Safe" for over eight
// minutes and the SOL leg never went: Wallet follows the Add's quote from the page that paid it, and that follow was gone.
// The core keeps every Add it quoted and follows it on each balance read, so the row ends from the core's own record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { ADD_CORE_AFTER_MS, ADD_CORE_EVERY_MS, bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const DEP = "4cb9371d628e1ad751552fce130b05d2c3804c95d464bc885a60f678b4a38f73";
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const core = { status: "pending" as string | null, asked: 0 };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.addStatus") {
      core.asked++;
      assert.equal(params.depositAddress, DEP, "asked by the deposit address the Safe paid");
      return (core.status ? { status: core.status } : null) as never;
    }
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    // Wallet's answer to the Move: paid, on its way, by this deposit address; its own follow then never ends (no `on`)
    return (method === "ledger.toTrading" ? { ...r.ok, status: "moving", depositAddress: DEP } : r.ok) as never;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const row = async (id: string) => {
    const r = await svc.call<SpendingActivity[]>("spending.activity", {});
    assert.ok("ok" in r);
    return r.ok.find((a) => a.id === id);
  };
  return { f, svc, core, row, later: (ms: number) => { t += ms; } };
}

test("finding 18: a Move whose Wallet follow is gone ends from the core's own record of its Add, a minute in", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  await s.f.refresh();
  assert.equal((await s.row(r.ok.id))?.status, "on-its-way");
  assert.equal(s.core.asked, 0, "not asked in its first minute: Wallet's own follow usually ends it");
  s.later(ADD_CORE_AFTER_MS); await s.f.refresh();
  assert.equal(s.core.asked, 1);
  assert.equal((await s.row(r.ok.id))?.status, "on-its-way", "the core still waits on 1Click: so does the row");
  s.later(1_000); await s.f.refresh();
  assert.equal(s.core.asked, 1, `asked at most every ${ADD_CORE_EVERY_MS} ms`);
  s.core.status = "done";
  s.later(ADD_CORE_EVERY_MS); await s.f.refresh();
  s.later(1_000); await s.f.refresh();
  assert.equal((await s.row(r.ok.id))?.status, "done", "1Click said SUCCESS to the core: the row ends, never \"Leaving your Safe\" for good");
  const asked = s.core.asked;
  s.later(ADD_CORE_EVERY_MS); await s.f.refresh();
  assert.equal(s.core.asked, asked, "an ended Add is never asked again");
});

test("finding 18: a refund the core saw says where the money is; an address the core doesn't know changes nothing", async () => {
  const s = await setup();
  const r = await s.svc.call<SpendingActivity>("spending.topUp", { usd: 6, legs: [{ network: "sol", usd: 6 }] });
  assert.ok("ok" in r);
  s.core.status = null;
  s.later(ADD_CORE_AFTER_MS); await s.f.refresh();
  assert.equal((await s.row(r.ok.id))?.status, "on-its-way", "control: no record, no change");
  s.core.status = "refunded";
  s.later(ADD_CORE_EVERY_MS); await s.f.refresh();
  const row = await s.row(r.ok.id);
  assert.equal(row?.status, "refunded");
  assert.match(row?.note ?? "", /sent it back to your NEAR wallet/);
});
