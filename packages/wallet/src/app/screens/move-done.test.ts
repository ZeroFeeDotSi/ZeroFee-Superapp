// The test mainnet run (3 NovZ): three Moves landed (the sheet said Done; the Safe and the wallets moved), yet
// AgentZero said "still going after 15 minutes" for each. Root cause: since D137's live sheet, Move stays open after the
// Approve and tells the app that opened it nothing until the person closes it, so AgentZero never started following.
// Now the sheet ends the moment every leg landed. Also: an `all` prefill ({from, to, all: true}) was dropped, so the
// sliders stayed where the money sits and the runner had to drag them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "../../../../trade/src/float-core.ts";
import { everyLanded, legsOf, placesNow, planOf, runOf, today, withLeg, type MoveFollow, type Run } from "./move-split.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const PX = { sol: 150, hood: 3000, bsc: 600 } as const;

async function engine() {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 5, timers: clock.timers, float: { moveMs: 10, timers: clock.timers } }));
  /** A round's 40 ms of the test's own time: the engine's calls answered, then the Sim's steps due by then land in order. */
  const settle = async () => { await clock.quiet(); await clock.advance(40); };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  /** The engine's own timers (its rounds and its follow each second), run by hand: the app runs them while it's open. */
  const ticks: (() => void)[] = [];
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => t, every: (fn) => { ticks.push(fn); return () => undefined; }, rng: () => 0.5 });
  f.start();
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
  /** The sheet's own follow (MoveSheet: spending.activity each second → runOf), on the real engine, until every leg
   *  landed or `rounds` reads went by. */
  const follow = async (fs: MoveFollow[], rounds = 30): Promise<Run[]> => {
    let runs: Run[] = [];
    for (let i = 0; i < rounds; i++) {
      for (const tick of ticks) tick();
      await settle(); await f.refresh(); t += 5_000;
      const now = await rows();
      runs = fs.map((x) => runOf(x, now));
      if (everyLanded(runs, fs.length)) break;
    }
    return runs;
  };
  return { svc, f, follow, rows };
}

test("on the real engine, each of the run's three Moves has every leg land, and the sheet then ends at once: Safe → SOL, the SOL wallet all → Safe, the NEAR wallet all → Safe (control: a leg still on its way or stopped keeps it open)", async () => {
  const e = await engine();
  // move-safe-sol: $3.50 from the Safe to the SOL wallet (the Add, then its leg on)
  const add = await e.svc.call<SpendingActivity>("spending.topUp", { usd: 3.5, legs: [{ network: "sol", usd: 3.5 }] });
  assert.ok("ok" in add, JSON.stringify(add));
  const one = await e.follow([{ leg: { from: "safe", to: "sol", usd: 3.5 }, id: add.ok.id, by: "topup" }]);
  assert.deepEqual(one.map((r) => r.state), ["done"], "Safe → SOL: landed");
  // home-sol: all of the SOL wallet → the Safe (Move's take-out: its move in, then home)
  const home = await e.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "sol", usd: "all" }] });
  assert.ok("ok" in home, JSON.stringify(home));
  const two = await e.follow([{ leg: { from: "sol", to: "safe", usd: 3.4 }, id: home.ok.id, by: "putaway" }]);
  assert.deepEqual(two.map((r) => r.state), ["done"], "SOL → Safe: landed");
  // home-near: the NEAR wallet's cash → the Safe ($20 put there first)
  const fill = await e.svc.call<SpendingActivity>("spending.topUp", { usd: 20 });
  assert.ok("ok" in fill, JSON.stringify(fill));
  await e.follow([{ leg: { from: "safe", to: "near", usd: 20 }, id: fill.ok.id, by: "topup" }]);
  const back = await e.svc.call<SpendingActivity>("spending.putAway", { legs: [{ network: "near", usd: 19 }] });
  assert.ok("ok" in back, JSON.stringify(back));
  const three = await e.follow([{ leg: { from: "near", to: "safe", usd: 19 }, id: back.ok.id, by: "putaway" }]);
  assert.deepEqual(three.map((r) => r.state), ["done"], "NEAR → Safe: landed");
  // the sheet's rule: every leg landed → it ends; anything else keeps it open
  assert.equal(everyLanded(three, 1), true);
  assert.equal(everyLanded([{ leg: { from: "near", to: "safe", usd: 1 }, state: "moving" }], 1), false, "control: still on its way");
  assert.equal(everyLanded([...three, { leg: { from: "sol", to: "safe", usd: 1 }, state: "stopped", note: "x" }], 2), false, "control: a stopped leg keeps the sheet open (its line says where the money is)");
  assert.equal(everyLanded([], 0), false, "control: nothing started, nothing ends");
});

test("the sheet ends itself the moment every leg landed, as a Close would then (\"Moved.\" and the move's id), so the app that opened it hears it (fails on main: Move only told it on the person's Close)", () => {
  const sheet = here("./MoveSheet.tsx");
  assert.match(sheet, /const landedAll = everyLanded\(runs, follow\?\.length \?\? 0\);\n\s+useEffect\(\(\) => \{ if \(landedAll\) close\(\); \}, \[landedAll\]\);/);
  assert.match(sheet, /onDone\(moving\.length \? [^]*?: "Moved\.", follow\?\.\[0\]\?\.id\);/, "Close's own end: the line and the move's id");
});

test("an `all` prefill ({from, to, all: true}) puts the source's slider at $0 and all of it on the target; the run's two cases plan all of it (controls: an amount still sets just that; no amount and no all, nothing set)", () => {
  const now = placesNow({ safeUsd: 15.78, safeMostUsd: 15.78, networks: [{ network: "sol", cashUsd: "3.10", coinsUsd: "0", readyUsd: "3.10" }, { network: "hood", cashUsd: "0", coinsUsd: "0", readyUsd: "0" }], reserveUsd: "61.81" });
  const lead = (p: { from: "near" | "sol" | "safe"; to: "safe" | "sol"; usd?: number; all?: true } | undefined) => { const s = today(now); return p ? withLeg(s, p.from, p.to, p.all ? s[p.from] ?? 0 : p.usd ?? 0) : s; };
  const near = lead({ from: "near", to: "safe", all: true });
  assert.deepEqual([near.near, near.safe], [0, 77.59], "NEAR wallet all → Safe: $0 and $77.59");
  assert.deepEqual(planOf(legsOf(now, near, false), now).putAway?.legs, [{ network: "near", usd: 61.81 }], "all $61.81 home, none left for the slider's fee room");
  const sol = lead({ from: "sol", to: "safe", all: true });
  assert.deepEqual([sol.sol, sol.safe], [0, 18.88]);
  assert.deepEqual(planOf(legsOf(now, sol, false), now).putAway?.legs, [{ network: "sol", usd: "all" }], "the SOL wallet: all");
  assert.deepEqual(lead({ from: "safe", to: "sol", usd: 3.5 }), { ...today(now), safe: 12.28, sol: 6.6 }, "control: an amount sets just that");
  assert.deepEqual(lead(undefined), today(now), "control: nothing filled in, the sliders where the money sits");
  const host = here("../money/MoneyHost.tsx"), money = here("../../../../shell-api/src/money.ts");
  assert.match(host, /ask\.from && ask\.to && \(ask\.all \|\| Number\(ask\.usd\) > 0\) \? \{ prefill: \{ from: ask\.from, to: ask\.to, \.\.\.\(ask\.all \? \{ all: true as const \} : \{ usd: Number\(ask\.usd\) \}\)/, "the host hands `all` on (main dropped it: only an amount was handed on)");
  assert.match(money, /\| \{ kind: "move"; [^}]*all\?: true;/, "MoneyAsk's move carries all");
});
