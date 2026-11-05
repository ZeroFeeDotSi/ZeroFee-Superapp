// AUDIT (money paths, 28 Oct 2026, commit 18ad8d6): deterministic PoCs for Trade's one balance (float-core.ts,
// float-jobs.ts) against the model of the core's float (model.ts: it refuses what the core refuses: a move under $2, a
// move the float or the wallet can't pay). Each test asserts the CORRECT behaviour and FAILS on the audited commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoreFloat } from "../../float-core.ts";
import { PX, model } from "./model.ts";

function world(setup: (m: ReturnType<typeof model>["m"]) => void, begun = false) {
  const clock = { t: 1_800_000_000_000 };
  const md = model(clock);
  setup(md.m);
  const store = new Map<string, unknown>();
  // Spending in use (a Top up was made before): its rounds may plan
  if (begun) store.set("float.split.v1", true);
  const timers: (() => void)[] = [];
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = createCoreFloat({
    call: md.call as never, wallets: md.wallets, nativeUsd: async (c) => PX[c],
    get: async (k) => store.get(k), set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    now: () => clock.t, every: (fn) => { timers.push(fn); return () => undefined; }, rng,
  });
  const settle = async () => { for (let k = 0; k < 50; k++) await new Promise((r) => setImmediate(r)); };
  /** Time passes and the app's own timers fire (planner round every 2 min, follow every 3 s). */
  const pass = async (ms: number, rounds = 1) => { for (let i = 0; i < rounds; i++) { clock.t += ms; for (const t of timers) t(); await settle(); } };
  return { ...md, f, clock, settle, pass };
}

// ---- AUD-TRD-2: the gas top-up is exactly the core's $2 floor in dollars, turned into coin units by rounding DOWN
// (float-core toRaw: floor((usd / px) * 1e9)). At the same price the core reads it back as $1.999998, under its $2 floor,
// and refuses it (security.request.not-allowed). The planner plans it again every round: the gas never arrives.
test("AUD-TRD-2: a wallet holding coins but short of gas gets its top-up (it isn't refused as under $2)", async () => {
  const w = world((m) => { m.float = 100; m.added = 100; const s = m.wallets.get("sol:0")!; s.usd = 0.5; s.coins = 30; });
  w.f.start(); await w.settle();
  await w.pass(120_000, 10);
  const under = w.m.refusals.filter((r) => r.code === "security.request.not-allowed");
  assert.equal(under.length, 0, `${under.length} top-ups refused as under $2 (first asked $${under[0]?.usd})`);
  assert.ok(w.m.wallets.get("sol:0")!.usd >= 2, `the wallet holding $30 of coins still has $${w.m.wallets.get("sol:0")!.usd} of SOL for gas`);
});

// ---- AUD-TRD-4: after "Use a fresh wallet" (or the automatic rotation after 20 trades), the planner still counts the
// chain's money across every wallet but sends each move IN from the ACTIVE (new, empty) wallet: the core refuses it,
// the planner asks again every round, and the excess on the old wallet never comes back to the reserve.
// D55: no rotation any more; the same holds for an older wallet (an earlier slot, replaced words) beside the current one.
test("AUD-TRD-4: money on an older wallet comes back from the wallet that holds it, never asked of the empty current one", async () => {
  const w = world((m) => { m.float = 0; m.added = 400; m.wallets.set("sol:1", { chain: "sol", slot: 1, usd: 400, coins: 0 }); }, true);
  w.f.start(); await w.settle();
  await w.pass(120_000, 15);
  const wrong = w.m.refusals.filter((r) => r.kind === "in");
  assert.equal(wrong.length, 0, `${wrong.length} moves in asked an empty wallet (the current one) for money it never held`);
  assert.ok(w.m.wallets.get("sol:1")!.usd < 1, `the older Solana wallet still holds $${w.m.wallets.get("sol:1")!.usd.toFixed(2)}: it drains all of its own coin back`);
});

// ---- AUD-TRD-5 (Low): "Move more now" asks for min(amount, reserve) with no room for the move's own ~2 % fee and
// without counting other chains' moves still waiting on the same reserve: the core refuses it (security.float.short).
test("AUD-TRD-5: 'Move more now' never asks for more than the reserve can pay, its fee included", async () => {
  const w = world((m) => { m.float = 50; m.added = 50; });
  w.f.start(); await w.settle();
  await w.f.moveNow("sol", 80).catch(() => undefined);
  const short = w.m.refusals.filter((r) => r.code === "security.float.short");
  assert.equal(short.length, 0, `refused: asked $${short[0]?.usd} with $${short[0]?.float} in the reserve and a 2 % fee on top`);
});
