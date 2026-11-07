// The Sim's slow chain (demo-engine.ts SimTradeMode): walks reach the "not confirmed yet" card, its end on landing and its
// proven expiry. Only a VITE_SIM_TRADE_MODES=1 build reads the switch; every other build has none of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoEngine, readSimTradeMode, resetSampleWallets, SIM_MODES, SIM_RESOLVE_MS, simTradeMode, type SimTradeMode } from "./demo-engine.ts";

const OWNER = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";
function engine(mode: SimTradeMode | undefined) {
  resetSampleWallets();
  const clock = { t: 1_800_000_000_000 };
  const e = createDemoEngine({ chain: "sol", owner: OWNER, nativeUsd: async () => 100, meta: async () => ({ symbol: "WIF", priceUsd: 1, decimals: 6 }), now: () => clock.t, mode: () => mode });
  return { e, clock };
}

test("control: with no mode a sample trade confirms in 0.4 s, and recheck says the same", async () => {
  const { e, clock } = engine(undefined);
  const h = await e.send(btoa("sample-sol-1"));
  clock.t += 500;
  assert.equal(await e.status(h), "confirmed");
  assert.equal(await e.recheck!(h), "confirmed");
});

test("late: the tap's status never confirms; the re-check finds it landed only after SIM_RESOLVE_MS", async () => {
  const { e, clock } = engine("late");
  const h = await e.send(btoa("sample-sol-1"));
  clock.t += 80_000;
  assert.equal(await e.status(h), "pending");
  assert.equal(await e.recheck!(h), "pending");
  clock.t += SIM_RESOLVE_MS;
  assert.equal(await e.status(h), "pending", "the hot path still hears nothing");
  assert.equal(await e.recheck!(h), "confirmed");
});

test("absent: the re-check proves it never landed (expired) after SIM_RESOLVE_MS", async () => {
  const { e, clock } = engine("absent");
  const h = await e.send(btoa("sample-sol-1"));
  clock.t += 50_000;
  assert.equal(await e.recheck!(h), "pending");
  clock.t += SIM_RESOLVE_MS;
  assert.equal(await e.recheck!(h), "expired");
});

test("the switch is read only in a SIM_MODES build: off (every other build), a set localStorage changes nothing", () => {
  const g = globalThis as { localStorage?: unknown };
  const had = g.localStorage;
  g.localStorage = { getItem: (k: string) => (k === "zf.sim.trade" ? "late" : null) };
  try {
    assert.equal(SIM_MODES, false, "no VITE_SIM_TRADE_MODES here (node, and every build but the walk's)");
    assert.equal(simTradeMode(), undefined, "the engine's read is the module-level no-op");
    assert.equal(readSimTradeMode(), "late", "control: the reader a SIM_MODES build uses reads it");
  } finally { g.localStorage = had; }
});
