// A UI re-test (4 Nov, QA): after a Safe → SOL swap, the $3.08 sat in the NEAR wallet for about a minute and
// the SOL wallet showed it only after a reload. Once the swap went, the wallets are read again until a figure moves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { followSwap, LANDING_READ_FOR_MS } from "./swap-follow.ts";

function fakes(statuses: string[]) {
  const calls: string[] = [];
  let row = "on-its-way";
  let changed: (() => void) | undefined;
  let n = 0;
  const bridge = {
    call: async (method: string) => {
      calls.push(method);
      if (method === "spending.activity") return { ok: [{ id: "a1", status: row }] };
      if (method === "spending.status") return { ok: { networks: [{ network: "sol", cashUsd: statuses[Math.min(n++, statuses.length - 1)], coinsUsd: "0.00" }] } };
      return { ok: null };
    },
    on: (_e: string, h: () => void) => { changed = h; return () => { changed = undefined; }; },
  };
  const ticks: (() => void)[] = [];
  const afters: { fn: () => void; ms: number }[] = [];
  const timers = {
    every: (fn: () => void) => { ticks.push(fn); return () => { const i = ticks.indexOf(fn); if (i >= 0) ticks.splice(i, 1); }; },
    after: (fn: () => void, ms: number) => { const a = { fn, ms }; afters.push(a); return () => { const i = afters.indexOf(a); if (i >= 0) afters.splice(i, 1); }; },
  };
  const settle = () => new Promise((r) => setImmediate(r));
  return { bridge, calls, timers, ticks, afters, settle, land: () => { row = "done"; changed?.(); }, status: () => calls.filter((c) => c === "spending.status").length };
}

test("once a swap from the Safe went, the wallets are read again until the SOL wallet's figure moves, then no more", async () => {
  const f = fakes(["0.00", "0.00", "3.08"]);
  followSwap(f.bridge as never, { id: "a1", words: "Swap $3.10 of NEAR for SOL" }, f.timers);
  await f.settle();
  assert.equal(f.status(), 0, "control: nothing read while it is on its way");
  f.land();
  await f.settle();
  assert.equal(f.status(), 1, "read at once when it went");
  for (const tick of [...f.ticks]) tick();
  await f.settle();
  assert.equal(f.status(), 2, "and again a moment later");
  for (const tick of [...f.ticks]) tick();
  await f.settle();
  assert.equal(f.status(), 3, "until the SOL wallet's figure moved");
  assert.equal(f.ticks.length, 0, "then it stops reading");
});

test("the wallets are read again for at most 3 minutes when nothing moves", async () => {
  const f = fakes(["0.00"]);
  followSwap(f.bridge as never, { id: "a1", words: "Swap $3.10 of NEAR for SOL" }, f.timers);
  f.land();
  await f.settle();
  const cap = f.afters.find((a) => a.ms === LANDING_READ_FOR_MS);
  assert.ok(cap, "a 3-minute cap");
  cap!.fn();
  assert.equal(f.ticks.length, 0, "no reads after the cap");
});
