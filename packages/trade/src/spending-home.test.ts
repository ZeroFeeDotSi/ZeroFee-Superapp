// Spending's cash home from its chain wallets (mainnet 2 Nov: m-cap and journey-05): a reserve under $2,
// cash as SOL and ETH on the networks, then Put away all, or the cap. The engine runs on its own timers (start()), on a
// fake clock that the test advances a second at a time; the MockBridge's float answers as the core's. Each case must
// land within the private wait plus settlement, and a move in the core refused for a while (the quote relay's status bug)
// must go once the refusal clears, not after a 30-minute back-off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { bridgeWallets, createCoreFloat, ROUND_MS, type CoreFloatDeps } from "./float-core.ts";
import { PRIVATE } from "./float.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);
const pause = (ms = 3) => new Promise((r) => setTimeout(r, ms));
const RELAY_DOWN = { code: "security.subwallet.refused", whatHappened: "We can't reach the quote server to check this payment, so we stopped.", money: { state: "safe", where: "in Spending" }, next: { kind: "nothing", label: "OK" } } as const;

async function world(o: { refuseInUntil?: number; split?: Record<string, number> } = {}) {
  const held = { "sw-trade-sol": units("sol", 77.84).toString(), "sw-trade-hood": units("hood", 37.04).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 1, float: { moveMs: 2, startUsd: 0.92, held } });
  let t = 1_000_000;
  const start = t;
  const calls: string[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.in") { calls.push(`${t - start}`); if (o.refuseInUntil !== undefined && t - start < o.refuseInUntil) throw new ProblemError(RELAY_DOWN as never); }
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const store = new Map<string, unknown>([["float.split.v1", o.split ?? { sol: 40, hood: 25, bsc: 25, reserve: 10 }]]);   // Spending in use
  // the engine's own timers, on the test's clock
  const timers: { fn: () => void; ms: number; next: number }[] = [];
  const f = createCoreFloat({
    call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); },
    now: () => t, rng: () => 0.5,
    every: (fn, ms) => { const x = { fn, ms, next: t + ms }; timers.push(x); return () => { timers.splice(timers.indexOf(x), 1); }; },
  });
  /** The clock a second at a time, each timer fired when due, the mock's moves given real milliseconds to settle. */
  async function run(ms: number, until?: () => boolean): Promise<number> {
    const end = t + ms;
    while (t < end) {
      t += 1000;
      for (const x of [...timers]) if (x.next <= t) { x.next = t + x.ms; x.fn(); }
      await pause();
      if (until?.()) break;
    }
    return t - start;
  }
  return { f, run, calls, elapsed: () => t - start };
}

test("mainnet 2 Nov (journey-05): Put away all with $0.92 in the reserve and the cash on Solana and Robinhood Chain lands in the Safe within settlement", async () => {
  const { f, run } = await world();
  await f.refresh();
  const stop = f.start(); await run(5_000);
  const row = await f.takeOut("all");
  const home = () => f.snapshot().moves.find((m) => m.id === row.id)!;
  const took = await run(25 * 60_000, () => home().status === "done" || home().status === "failed");
  const end = home();
  assert.equal(end.status, "done", `${JSON.stringify(end)} · ${JSON.stringify(f.snapshot().moves)}`);
  assert.ok(end.usd > 110, `the networks' cash went home too: $${end.usd}`);
  assert.ok(took < 5 * 60_000, `no private wait on the person's own Put away: ${took / 1000} s`);
  stop();
});

test("mainnet 2 Nov (m-cap): over the cap with $0.92 in the reserve, the networks' cash comes back and goes home within the private wait plus settlement", async () => {
  const { f, run } = await world();
  await f.refresh();
  const cap = Math.floor(f.snapshot().totalUsd - 6);
  f.setCap(cap);
  const stop = f.start();
  const done = () => f.snapshot().moves.find((m) => m.kind === "home" && m.why === "over-cap" && m.status === "done");
  const took = await run(30 * 60_000, () => !!done());
  assert.ok(done(), JSON.stringify(f.snapshot().moves));
  assert.ok(took <= PRIVATE.delayMs[1] + ROUND_MS + 2 * 60_000, `within the private wait, a round and settlement: ${took / 1000} s`);
  assert.ok(f.snapshot().totalUsd <= cap + 5.01, `${f.snapshot().totalUsd} vs ${cap}`);
  stop();
});

test("mainnet 2 Nov: a move in the core refused for 20 minutes (the quote relay's status bug) goes home within minutes once the refusal clears, not after a 30-minute back-off", async () => {
  const blocked = 20 * 60_000;
  const { f, run, calls } = await world({ refuseInUntil: blocked, split: { sol: 67, hood: 33, bsc: 0, reserve: 0 } });
  await f.refresh();
  const cap = Math.floor(f.snapshot().totalUsd - 6);
  f.setCap(cap);
  const stop = f.start();
  const done = () => f.snapshot().moves.find((m) => m.kind === "home" && m.why === "over-cap" && m.status === "done");
  const took = await run(60 * 60_000, () => !!done());
  assert.ok(done(), JSON.stringify(f.snapshot().moves));
  assert.ok(took <= blocked + PRIVATE.delayMs[1] + 2 * ROUND_MS + 2 * 60_000, `once it clears, within the private wait and a round or two: ${took / 1000} s (asked at ${calls.join(", ")})`);
  // while refused it doesn't ask every round (each a failed row): at most one ask a few minutes, backing off
  const during = calls.filter((c) => Number(c) < blocked).length;
  assert.ok(during <= 8, `asked ${during} times in the 20 minutes it was refused: ${calls.join(", ")}`);
  stop();
});

test("mainnet 2 Nov: Put away all asked while the networks' moves in are refused says so, then a Put away all after it clears goes", async () => {
  const blocked = 3 * 60_000;
  const { f, run } = await world({ refuseInUntil: blocked });
  await f.refresh();
  const stop = f.start(); await run(5_000);
  const first = await f.takeOut("all");
  const row = (id: string) => f.snapshot().moves.find((m) => m.id === id)!;
  await run(5 * 60_000, () => row(first.id).status !== "waiting" && row(first.id).status !== "moving");
  assert.notEqual(row(first.id).status, "moving", `it ended, and said where the money is: ${JSON.stringify(row(first.id))}`);
  await run(blocked);
  const again = await f.takeOut("all");
  await run(10 * 60_000, () => row(again.id).status === "done");
  assert.equal(row(again.id).status, "done", JSON.stringify(f.snapshot().moves));
  assert.ok(row(again.id).usd > 110, `$${row(again.id).usd}`);
  stop();
});
