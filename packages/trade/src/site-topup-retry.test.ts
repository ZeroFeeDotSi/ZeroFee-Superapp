// QA's rules for a site Add's retry (5 Nov; k-agentzero: the first tap died with "NEAR is busy right now"):
// the move's key is the dedupe, so a Try again after the first attempt went is that same move, never a second one (rules
// a, d); the sheet's Try again (rule c) is SiteMoney's (site-retry.test.ts). Spending's real engine and service on the
// shell's MockBridge, as site-topup-row.test.ts. With a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(moveMs: number) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs } });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const site = (await call("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" })) as { id: string };
  let t = 1_000_000;
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ now: () => t, engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  return { f, svc, site, mock };
}


const KEY = "sitetopupretrykey01";
test("rules a and d: a Try again with the move's own key after the first attempt went is that same move, one movement (control: a new key is a second move)", async () => {
  const s = await setup(10);
  const adds = () => s.f.snapshot().moves.filter((m: { kind: string; ready?: unknown }) => m.kind === "add" && m.ready).length;
  const first = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: KEY });
  assert.ok("ok" in first, JSON.stringify(first));
  const again = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: KEY });
  assert.ok("ok" in again, JSON.stringify(again));
  assert.equal(again.ok.id, first.ok.id, "the same move answered again");
  assert.equal(adds(), 1, "one movement");
  // control: another key is another move
  const other = await s.svc.call<SpendingActivity>("spending.topUp", { usd: "10", ready: s.site.id, key: `${KEY}x` });
  assert.ok("ok" in other, JSON.stringify(other));
  assert.notEqual(other.ok.id, first.ok.id);
  assert.equal(adds(), 2);
});
