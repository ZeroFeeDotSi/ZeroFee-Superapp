// ?demo's one balance adds up: money added to Trading lands in the sample wallets the engines trade from, so the Trading
// total is the sample's own money plus what was added, less fees, and a buy can spend what the float moved in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SAMPLE_OPENING } from "./demo-engine.ts";
import { forApps } from "@zerofee/core/bridge";
import { resetSampleWallets } from "./demo-engine.ts";
import { createTradeRuntime } from "./runtime.ts";

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test("?demo: $500 added moves into the sample wallets the engines trade from; the Trading total moves only by fees", async () => {
  resetSampleWallets();
  // the float priced as ?demo's recorded market prices (UI 987a9a0), as the shell's ?demo passes them
  const recorded: Record<string, number> = { sol: 101.67, hood: 2347.2, bsc: 744.17 };
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10, priceUsd: (c) => recorded[c]! } });
  const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade");
  const rt = createTradeRuntime(bridge);
  await rt.float.refresh();
  const before = rt.float.snapshot();
  const solBefore = before.chains.find((c) => c.chain === "sol")!.nativeUsd;
  assert.ok(solBefore > 100, `the sample's own SOL: ${solBefore}`);
  await rt.float.add(500); await settle(); await rt.float.refresh();
  assert.equal(rt.float.snapshot().reserveUsd, 500);
  await rt.float.moveNow("sol", 200); await settle(); await rt.float.traded("sol"); await settle();
  const after = rt.float.snapshot();
  const sol = after.chains.find((c) => c.chain === "sol")!;
  assert.ok(Math.abs(sol.nativeUsd - (solBefore + 200)) < 1, `the sample wallet got the float's $200: ${solBefore} → ${sol.nativeUsd}`);
  const sum = after.reserveUsd + after.chains.reduce((n, c) => n + c.nativeUsd, 0);
  assert.ok(Math.abs(after.totalUsd - sum) < 0.05, `${after.totalUsd} = ${sum}`);
  // only the move's fee left (MockBridge's 2 % of $200)
  assert.ok(Math.abs(after.totalUsd - (before.totalUsd + 500 - 4)) < 0.5, `${before.totalUsd} + 500 − 4 → ${after.totalUsd}`);
  // and the engine can spend it: a buy bigger than the sample's own SOL goes through
  const w = (await rt.svc.wallets()).find((x) => x.chain === "sol")!;
  assert.ok(w.nativeUsd > solBefore + 150, `${w.nativeUsd}`);
});

// Trade's Add pays from Private (the product's HARD RULE, NEAR Confidential; fix/move-private c1db2f3a3): the Safe's held
// route (a big Add waiting in Waiting) is never Trade's any more. These two replace the held-Add pair.
test("?demo&hold: Trade's Add pays from Private, so the Safe's hold never stands in its way; it counts once in Trading (control: before it, nothing counted)", async () => {
  resetSampleWallets();
  const { setAppRuntime } = await import("./runtime.ts");
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, holdSeconds: 1, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10 } });
  const rt = setAppRuntime(createTradeRuntime(forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade")));
  await rt.float.refresh();
  const before = rt.float.snapshot().totalUsd;
  assert.equal(rt.float.snapshot().moves.filter((m) => m.kind === "add").length, 0, "control: no Add yet");
  const r = await rt.float.add(25);
  assert.ok(r !== "declined" && !r.held, "not held: it went from Private");
  await settle(); await rt.float.refresh();
  const [add] = rt.float.snapshot().moves.filter((m) => m.kind === "add");
  // paid straight to its wallet (Private's payment): on its way, or already there
  assert.ok((add!.status === "moving" && add!.where === "in-flight") || (add!.status === "done" && add!.where === "chain"), `${add!.status} ${add!.where}`);
  const total = rt.float.snapshot().totalUsd;
  assert.ok(total > before + 24 && total <= before + 25.01, `counted once, less fees: ${before} → ${total}`);
});

test("?demo Take out: what the float moved comes home (sample wallets that start with nothing); with nothing to move, one Problem", async () => {
  resetSampleWallets();
  const { setAppRuntime } = await import("./runtime.ts");
  const { ProblemError } = await import("@zerofee/core/problem");
  const recorded: Record<string, number> = { sol: 101.67, hood: 2347.2, bsc: 744.17 };
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { moveMs: 10, priceUsd: (c) => recorded[c]! } });
  const rt = setAppRuntime(createTradeRuntime(forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade")));
  await rt.float.refresh();
  const sampleOwn = rt.float.snapshot().totalUsd;
  await assert.rejects(rt.float.takeOut("all"), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.float.nothing-to-take-out");
  await rt.float.add(100); await settle(); await rt.float.refresh();
  await rt.float.moveNow("sol", 40); await settle(); await rt.float.refresh();
  const row = await rt.float.takeOut("all");
  assert.ok(row.usd > 95, `the row says what's going home: $${row.usd}`);
  for (let i = 0; i < 6; i++) { await settle(); await rt.float.traded("sol").catch(() => undefined); }
  await rt.float.refresh();
  const s = rt.float.snapshot();
  assert.ok(s.moves.some((m) => m.kind === "home" && m.status === "done" && m.where === "main"), JSON.stringify(s.moves.map((m) => [m.kind, m.status, m.usd])));
  assert.ok(!s.moves.some((m) => m.status === "failed"), "no failed rows");
  assert.ok(Math.abs(s.totalUsd - sampleOwn) < 1, `back to the sample's own money: ${s.totalUsd} vs ${sampleOwn}`);
});

test("?demo: money moved to Robinhood is Robinhood's, never BNB's (their sample wallets share one EVM address)", async () => {
  resetSampleWallets();
  const recorded: Record<string, number> = { sol: 101.67, hood: 2347.2, bsc: 744.17 };
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 5, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING, moveMs: 10, priceUsd: (c) => recorded[c]! } });
  const rt = createTradeRuntime(forApps({ call: (m: string, p?: Record<string, unknown>) => mock.call(m, p), on: mock.on } as typeof mock, "trade"));
  await rt.float.refresh();
  const usdOf = async (c: string) => (await rt.svc.wallets()).find((x) => x.chain === c)!.nativeUsd;
  const hood = await usdOf("hood");
  await rt.float.add(100); await settle(); await rt.float.refresh();
  await rt.float.moveNow("hood", 50); await settle(); await rt.float.traded("hood"); await settle();
  assert.ok(Math.abs((await usdOf("hood")) - (hood + 50)) < 1.5, "Robinhood got it");
  // H04: BNB isn't offered until its route is proven: Trade has no BNB wallet to credit at all, and none in the total
  assert.equal((await rt.svc.wallets()).find((x) => x.chain === "bsc"), undefined);
  assert.equal(rt.float.snapshot().chains.find((c) => c.chain === "bsc")?.closed, true);
});

