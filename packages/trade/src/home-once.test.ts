// QA's real-money lap (5 Nov): a NEAR wallet → Safe move of $2.11 made Hot read $3.43 → $5.53 →
// $3.38 → $1.33: the move home was counted on its way while the NEAR wallet's own read still held it. On the real engine
// (float-core + core spending over the MockBridge), with the NEAR wallet's count behind: the total never goes over what
// there is; once the count shows the money gone, the move counts on its way until it lands. Virtual clock, no wall clock.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
function virtualClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-11-05T08:37:00Z") });
  let on = true;
  void (async () => { while (on) { t.mock.timers.tick(5); await new Promise((r) => setImmediate(r)); } })();
  return { stop: () => { on = false; }, wait: (ms: number) => new Promise((r) => setTimeout(r, ms)) };
}

test("a move home is never counted twice: while the NEAR wallet's read still holds it, it isn't also on its way; once the read shows it gone, it is on its way until it lands (control: the total stays whole, fees only)", async (t) => {
  const clock = virtualClock(t);
  t.after(() => clock.stop());
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 3000, startUsd: 12 } });
  const behind = { on: false, usd: 0, at: "" };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    if (method === "subwallet.float.balance") return behind.on ? { ...r.ok, usd: behind.usd, tokens: undefined, asOfIso: behind.at } : { ...r.ok, asOfIso: new Date(Date.now()).toISOString() };
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => Date.now(), every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ homeProof: true, engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const status = async () => { const r = await svc.call<SpendingStatus>("spending.status", {}); assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
  await clock.wait(1000); await f.refresh();
  const T0 = Number((await status()).totalUsd);
  assert.ok(T0 >= 11.9 && T0 <= 12.01, `the NEAR wallet: $${T0}`);
  // the NEAR wallet's count is behind: it still reads the $12, dated from before
  behind.usd = T0; behind.at = new Date(Date.now() - 1000).toISOString(); behind.on = true;
  const r = await svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "near", usd: 5 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  const seen: number[] = [];
  for (let i = 0; i < 3; i++) { await clock.wait(200); await f.refresh(); seen.push(Number((await status()).totalUsd)); }
  assert.ok(seen.every((x) => x <= T0 + 0.01), `never over what there is, while the read holds it: ${seen.join(", ")} (was ${T0})`);
  // the read catches up: the $5 has left the NEAR wallet, and is on its way home until it lands
  behind.on = false;
  await clock.wait(200); await f.refresh();
  const after = Number((await status()).totalUsd);
  assert.ok(after >= T0 - 5 - 0.01 && after <= T0 + 0.01, `once read gone: counted once ($${after}, was $${T0})`);
});
