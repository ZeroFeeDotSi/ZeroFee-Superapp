// D140, moves INTO the NEAR wallet (review, 4 Nov: "match each in-flight leg by its own id or tx, never by
// amount"). Two moves in at once, SOL → the NEAR wallet and ETH (RH) → the NEAR wallet, on the real engine (float-core
// + core spending over the MockBridge). 1Click says each landed while the NEAR wallet's own count is still behind (a
// read from before they landed): each move stays counted on its way, by its own job id, until a read of the NEAR wallet
// that began after it landed. The total holds (fees only) at every step, never a dip, never a double. Control: without
// that, the total fell by both moves while the count was behind.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);
/** No wall clock: node's mock timers, turned 5 ms per turn of the event loop (setImmediate stays real), so the mock's
 *  latency and its moves run in virtual time, in the same order every run. */
function virtualClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-11-04T00:00:00Z") });
  let on = true;
  void (async () => { while (on) { t.mock.timers.tick(5); await new Promise((r) => setImmediate(r)); } })();
  return { stop: () => { on = false; }, wait: (ms: number) => new Promise((r) => setTimeout(r, ms)) };
}

async function setup(clock: ReturnType<typeof virtualClock>) {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 30).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 300, startUsd: 5, held } });
  /** The NEAR wallet's count behind: while on, a read answers the figure from before the moves, dated then. */
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
  const step = async () => { await clock.wait(1000); await f.traded("sol"); };
  return { f, svc, behind, status, step };
}

test("D140: two moves into the NEAR wallet at once, landed while its count is behind: the total holds at every step, each move released by its own landing (control: the old count dipped by both)", async (t) => {
  const clock = virtualClock(t);
  t.after(() => clock.stop());
  const s = await setup(clock);
  await s.step();
  const T0 = Number((await s.status()).totalUsd);
  assert.ok(T0 > 90, `the wallets and the NEAR wallet: $${T0}`);
  s.behind.usd = Number((await s.status()).reserveUsd);
  s.behind.at = new Date(Date.now() - 1000).toISOString();
  s.behind.on = true;
  for (const [from, usd, key] of [["sol", 30, "home-move-into-near-sol1"], ["hood", 20, "home-move-into-near-hood1"]] as const) {
    const r = await s.svc.call<SpendingActivity>("spending.move", { from, to: "near", usd, key });
    assert.ok("ok" in r, JSON.stringify(r));
  }
  let landedBehind = false;
  for (let i = 0; i < 8; i++) {
    await s.step();
    const st = await s.status();
    const now = Number(st.totalUsd);
    assert.ok(now >= T0 - 50 * 0.06 && now <= T0 + 0.01, `step ${i}: $${now} of $${T0}: never a dip or a double (fees only)`);
    const rows = await s.svc.call<SpendingActivity[]>("spending.activity", {});
    assert.ok("ok" in rows);
    if (["home-move-into-near-sol1", "home-move-into-near-hood1"].every((id) => rows.ok.find((x) => x.id === id)?.status === "done")) landedBehind = true;
  }
  assert.ok(landedBehind, "control: both moves landed (1Click) while the NEAR wallet's count was still behind");
  // the count catches up: each move is released by a read begun after it landed, and counted once, where it is
  s.behind.on = false;
  for (let i = 0; i < 3; i++) {
    await s.step();
    const now = Number((await s.status()).totalUsd);
    assert.ok(now >= T0 - 50 * 0.06 && now <= T0 + 0.01, `caught up ${i}: $${now} of $${T0}`);
  }
  assert.ok(Number((await s.status()).reserveUsd) > s.behind.usd + 40, "the NEAR wallet has both");
});
