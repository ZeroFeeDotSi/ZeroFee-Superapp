// AUDIT (money paths, 28 Oct 2026, commit 18ad8d6): property-based test of Trade's one balance (float-core.ts, float.ts,
// float-jobs.ts) against a model of the core's float. Random interleavings of Adds, slider changes, planner rounds,
// "Move more now", Take out (some / all), one wallet's "Move all", fresh wallets, coins held (gas top-ups) and time.
// The model charges 1Click's ~2 % on every move and refuses a move the float can't pay, as the core does
// (security.float.short). Each property asserts the CORRECT behaviour; a failing seed is a finding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { createCoreFloat } from "../../float-core.ts";
import type { FloatChain, Split } from "../../float-view.ts";

import { CHAINS, LAND_MS, PX, model, mulberry32 } from "./model.ts";

async function run(seed: number, steps: number) {
  const rng = mulberry32(seed);
  const clock = { t: 1_800_000_000_000 };
  const { m, call, wallets, total } = model(clock);
  const store = new Map<string, unknown>();
  const f = createCoreFloat({
    offered: () => true, call: call as never, wallets, nativeUsd: async (c) => PX[c],
    get: async (k) => store.get(k), set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    now: () => clock.t, every: (fn) => { timers.push(fn); return () => undefined; }, rng,
  });
  // the app's own timers (ROUND_MS planner rounds, FOLLOW_MS follows), fired by hand; each runs async, so let it finish
  const timers: (() => void)[] = [];
  const settle = async () => { for (let k = 0; k < 50; k++) await new Promise((r) => setImmediate(r)); };
  const tick = async () => { for (const t of timers) t(); await settle(); };
  f.start(); await settle();
  const log: string[] = [];
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;
  let leaving = false;
  for (let i = 0; i < steps; i++) {
    const r = rng();
    try {
      if (r < 0.15) { const usd = Math.round(5 + rng() * 300); log.push(`add ${usd}`); await f.add(usd); }
      else if (r < 0.50) { const dt = Math.floor(rng() * 600_000); clock.t += dt; log.push(`+${dt}ms, timers`); await tick(); }
      else if (r < 0.55) { const c = pick(CHAINS); log.push(`traded(${c})`); await f.traded(c); }
      else if (r < 0.65) { if (leaving && process.env.AUDIT_NO_MOVENOW_WHILE_LEAVING) continue; const c = pick(CHAINS), usd = Math.round(2 + rng() * 100); log.push(`moveNow ${c} ${usd}`); await f.moveNow(c, usd); }
      else if (r < 0.72) { const usd = rng() < 0.5 ? "all" as const : Math.round(5 + rng() * 200); log.push(`takeOut ${usd}`); leaving = true; m.leavingSince = clock.t; await f.takeOut(usd); }
      // D55: an older wallet from before (an earlier slot, replaced words) turns up holding cash: it must drain back, counted
      else if (r < 0.82) { const c = pick(CHAINS), slot = 1 + Math.floor(rng() * 4), k = `${c}:${slot}`; if (!m.wallets.has(k)) { const usd = Math.round(5 + rng() * 60); m.wallets.set(k, { chain: c, slot, usd, coins: 0 }); m.added += usd; log.push(`older ${k} $${usd}`); } }
      else if (r < 0.9) { const w = pick([...m.wallets.values()]); w.coins = rng() < 0.5 || process.env.AUDIT_NO_COINS ? 0 : Math.round(rng() * 50); log.push(`coins ${w.chain}:${w.slot}=${w.coins}`); }
      else { clock.t += LAND_MS + 1; log.push("land"); await f.refresh(); }
    } catch (e) {
      if (!(e instanceof ProblemError)) throw e;
      log.push(`  → ${e.problem.code}`);
    }
    if (leaving && !(await (async () => { const s = f.snapshot(); return s.moves.some((x) => x.kind === "home" && (x.status === "waiting" || x.status === "moving")); })())) { leaving = false; m.leavingSince = undefined; }
  }
  // quiescence: no new operations, time passes, rounds run
  for (let k = 0; k < 60; k++) { clock.t += 120_000; await tick(); }
  clock.t += LAND_MS + 1; await tick(); await f.refresh();
  return { m, f, total, log };
}

const SEEDS = Number(process.env.AUDIT_SEEDS ?? 60);

test("AUD-PROP-1: the reserve is never promised twice: Trade never asks the core for a move the float can't pay", async () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { m, log } = await run(seed, 40);
    const short = m.refusals.filter((x) => x.code === "security.float.short");
    if (short.length) bad.push(`seed ${seed}: ${short.length} refused short (first: ${short[0]!.kind} $${short[0]!.usd.toFixed(2)} with $${short[0]!.float.toFixed(2)} in the float) after: ${log.slice(-6).join(" | ")}`);
  }
  assert.equal(bad.length, 0, `${bad.length}/${SEEDS} runs asked for more than the float held:\n${bad.slice(0, 5).join("\n")}`);
});

test("AUD-PROP-2: never stuck: at quiescence every move has ended, and what the screen says is in Trading is what the model holds", async () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { m, f, total } = await run(seed, 40);
    const s = f.snapshot();
    const open = s.moves.filter((x) => x.kind !== "add" && (x.status === "waiting" || x.status === "moving"));
    const pending = [...m.moves.values()].filter((x) => x.status === "pending");
    const coins = [...m.wallets.values()].reduce((n, w) => n + w.coins, 0);
    const drift = Math.abs(s.totalUsd - (total() + coins));
    if (open.length || pending.length || drift > 0.1) bad.push(`seed ${seed}: open ${open.length}, pending ${pending.length}, screen $${s.totalUsd} vs held $${(total() + coins).toFixed(2)}`);
  }
  assert.equal(bad.length, 0, `${bad.length}/${SEEDS}:\n${bad.slice(0, 5).join("\n")}`);
});

test("AUD-PROP-3: money is conserved: everything added is in Trading, at home, or went on fees (to the cent)", async () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { m, total } = await run(seed, 40);
    const gap = m.added - (total() + m.main + m.fees + [...m.moves.values()].filter((x) => x.status === "pending" && x.kind === "home").reduce((n, x) => n + x.usd, 0));
    if (Math.abs(gap) > 0.01) bad.push(`seed ${seed}: gap $${gap.toFixed(4)}`);
  }
  assert.equal(bad.length, 0, bad.slice(0, 5).join("\n"));
});

test("AUD-PROP-4: while a Take out is bringing Trading home, nothing is sent back out to the chains", async () => {
  const bad: string[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    const { m, log } = await run(seed, 40);
    if (m.outWhileLeaving) bad.push(`seed ${seed}: ${m.outWhileLeaving} move(s) out during a Take out; ${log.filter((l) => /takeOut|moveNow|homeWallet/.test(l)).slice(-4).join(" | ")}`);
  }
  assert.equal(bad.length, 0, `${bad.length}/${SEEDS}:\n${bad.slice(0, 5).join("\n")}`);
});

// AUDIT_DEBUG_SEED=n prints one run's operations, the core's refusals and the jobs left open (for triage only).
if (process.env.AUDIT_DEBUG_SEED) {
  test(`debug seed ${process.env.AUDIT_DEBUG_SEED}`, async () => {
    const { m, f, log } = await run(Number(process.env.AUDIT_DEBUG_SEED), 40);
    console.log(log.join("\n"));
    console.log("refusals", JSON.stringify(m.refusals.filter((x) => x.code !== "security.request.not-allowed")));
    console.log("open", JSON.stringify(f.snapshot().moves.filter((x) => x.status === "waiting" || x.status === "moving")));
    console.log("moves", JSON.stringify([...m.moves.values()].map((x) => [x.kind, x.chain, x.usd.toFixed(2), x.status])));
  });
}
