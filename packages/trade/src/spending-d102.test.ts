// D102 (product decision, 2 Nov): the person decides where Spending's money sits. The engine
// never moves money between the networks by itself: no refill, no rebalance. The only moves it still makes by itself are
// gas (a wallet holding coins that can't pay its fee) and the cash above the cap going home, and each is shown and named.
// On the shell's MockBridge (its float answers as the core's), the planner's clock the test's. Each test's control (the
// same steps on the engine from before D102, c8251d34) fails: see the report for the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { PRIVATE } from "./float.ts";
import type { Job } from "./float-jobs.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);

/** A Spending in use (a Top up made: the split key is there), its reserve and each network's wallet as given. */
async function lopsided(o: { reserveUsd: number; solUsd: number; hoodUsd: number; coins?: Partial<Record<"sol" | "hood", number>>; store?: Map<string, unknown> }) {
  const held = { "sw-trade-sol": units("sol", o.solUsd).toString(), "sw-trade-hood": units("hood", o.hoodUsd).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: o.reserveUsd, held } });
  const sent: { method: string; params: Record<string, unknown> }[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (/^subwallet\.float\.(out|in|home)$/.test(method)) sent.push({ method, params });
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const store = o.store ?? new Map<string, unknown>([["float.split.v1", { sol: 40, hood: 25, bsc: 25, reserve: 10 }]]);
  const f = createCoreFloat({
    offered: (c) => c !== "bsc",
    call, on: (e, h) => mock.on(e, h), nativeUsd,
    wallets: async () => (await bridgeWallets(call, nativeUsd)).map((w) => ({ ...w, coinsUsd: o.coins?.[w.chain as "sol" | "hood"] ?? 0 })),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); },
    now: () => t, every: () => () => undefined, rng: () => 0.5,
  });
  // in use and on screen: start() reads the split key (Spending used), as the shell does when the account is home
  const stop = f.start(); await settle();
  const svc = createSpendingService({ engine: () => f as never, call: async () => ({ value: null }) as never });
  const rounds = async (n: number) => { for (let i = 0; i < n; i++) { t += PRIVATE.delayMs[1]; await f.traded("sol"); await settle(); } await f.refresh(); };
  const chains = () => Object.fromEntries(f.snapshot().chains.filter((c) => c.chain !== "bsc").map((c) => [c.chain, Math.round(c.nativeUsd * 100) / 100]));
  const activity = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return r.ok; };
  return { f, sent, store, rounds, chains, activity, setCap: f.setCap, stop };
}

test("D102: a lopsided Spending ($200 on Solana, $0 on Robinhood, $100 in the reserve) stays exactly where the person put it, round after round", async () => {
  const s = await lopsided({ reserveUsd: 100, solUsd: 200, hoodUsd: 0 });
  await s.f.refresh();
  const before = s.chains();
  assert.deepEqual(before, { sol: 200, hood: 0 });
  await s.rounds(6);
  assert.deepEqual(s.sent, [], `nothing was asked of the core: ${JSON.stringify(s.sent)}`);
  assert.deepEqual(s.chains(), before, "every network holds what it held");
  assert.equal(s.f.snapshot().reserveUsd, 100, "the reserve too");
  assert.deepEqual(s.f.snapshot().moves.filter((m) => m.kind === "out" || m.kind === "in"), [], "no move planned, waiting or made");
});

test("D102: a Top up lands in Spending's reserve and stays there; nothing is spread to the networks by itself", async () => {
  const s = await lopsided({ reserveUsd: 0, solUsd: 0, hoodUsd: 0, store: new Map() });
  assert.notEqual(await s.f.add(300), "declined");
  await settle(); await s.f.refresh();
  await s.rounds(6);
  assert.deepEqual(s.sent, [], `no move to a network: ${JSON.stringify(s.sent)}`);
  assert.deepEqual(s.chains(), { sol: 0, hood: 0 });
  assert.equal(s.f.snapshot().reserveUsd, 300, "the Top up is all in Trading's own balance");
});

test("D102: a journal from before keeps no split refill: one still waiting never goes; the person's own and gas still do", async () => {
  const store = new Map<string, unknown>([
    ["float.split.v1", { sol: 40, hood: 25, bsc: 25, reserve: 10 }],
    ["float.jobs.v1", [
      { id: "split-refill-0000001", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: 40, at: 0, state: "planned" },
      { id: "split-rebal-00000001", kind: "in", chain: "hood", wallet: "sw-trade-hood", usd: 20, at: 0, state: "planned" },
      { id: "gas-before-000000001", kind: "out", chain: "hood", wallet: "sw-trade-hood", usd: 2.1, at: 0, state: "planned", why: "gas" },
      { id: "mine-after-000000001", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: 5, at: 0, state: "planned", asked: true },
      { id: "mine-in-flight-00001", kind: "out", chain: "sol", wallet: "sw-trade-sol", usd: 7, at: 0, state: "asked" },
    ] satisfies Job[]],
  ]);
  const s = await lopsided({ reserveUsd: 100, solUsd: 0, hoodUsd: 40, store });
  await s.rounds(3);
  const keys = s.sent.map((x) => x.params.key);
  assert.ok(!keys.includes("split-refill-0000001") && !keys.includes("split-rebal-00000001"), `an unmarked planned move never went: ${JSON.stringify(keys)}`);
  assert.ok(keys.includes("gas-before-000000001"), "the gas did");
  assert.ok(keys.includes("mine-after-000000001"), "a move marked as the person's did");
  assert.ok(keys.includes("mine-in-flight-00001"), "one already asked finishes with its key");
  // never dropped without a word (review M2): a person's own move from before D102 was unmarked too; its row says where
  const rows = await s.activity();
  for (const id of ["split-refill-0000001", "split-rebal-00000001"]) {
    const r = rows.find((a) => a.id === id);
    assert.ok(r && r.shown && r.status === "refused" && /in your NEAR wallet/.test(r.note ?? ""), JSON.stringify(r));
  }
});

test("review M1: the person's own move is never shrunk by another move of theirs, nor a site's Add or gas", async () => {
  const { createJobRunner } = await import("./float-jobs.ts");
  let saved: Job[] = [
    { id: "mine-queued-0000001", kind: "out", chain: "sol", usd: 5, at: 0, state: "planned", asked: true },
    { id: "site-ready-00000001", kind: "out", chain: "sol", wallet: "sw-site-pump-sol", usd: 9.8, at: 0, state: "planned", why: "ready" },
    { id: "gas-queued-00000001", kind: "out", chain: "sol", usd: 2.1, at: 0, state: "planned", why: "gas" },
  ];
  const r = createJobRunner({ out: async () => ({ id: "m", status: "pending" }), in: async () => ({ id: "m", status: "pending" }), home: async () => ({ id: "m", status: "pending" }), move: async () => ({ id: "m", status: "pending" }), toRaw: async () => "1", load: async () => saved, save: async (j) => { saved = j; }, now: () => 0, newId: () => "x".repeat(16) });
  await r.shrink("sol", 10);
  assert.deepEqual(saved.map((j) => [j.id, j.usd]), [["mine-queued-0000001", 5], ["site-ready-00000001", 9.8], ["gas-queued-00000001", 2.1]]);
});

test("review L1: two rounds that both plan the cash above the cap plan one move home, never two", async () => {
  const { createJobRunner } = await import("./float-jobs.ts");
  let saved: Job[] = [];
  let n = 0;
  const r = createJobRunner({ out: async () => ({ id: "m", status: "pending" }), in: async () => ({ id: "m", status: "pending" }), home: async () => ({ id: "m", status: "pending" }), move: async () => ({ id: "m", status: "pending" }), toRaw: async () => "1", load: async () => saved, save: async (j) => { saved = j; }, now: () => 0, newId: () => `home-job-${String(++n).padStart(8, "0")}` });
  // both rounds read "no move home open" before either planned (a cap change and the timer at once)
  const [a, b] = await Promise.all([r.home(30, "over-cap", 0), r.home(30, "over-cap", 0)]);
  assert.equal(saved.filter((j) => j.kind === "home").length, 1, JSON.stringify(saved));
  assert.equal(a.id, b.id, "the second is the first");
});

test("D102: gas still happens by itself, and it is shown and named: \"$2.10 kept for fees on Robinhood Chain\"", async () => {
  // Robinhood holds $40 of a coin and no ETH to sell it with
  const s = await lopsided({ reserveUsd: 100, solUsd: 0, hoodUsd: 0, coins: { hood: 40 } });
  await s.rounds(3);
  const gas = s.sent.filter((x) => x.method === "subwallet.float.out");
  assert.deepEqual(gas.map((x) => [x.params.chain, x.params.to]), [["hood", "sw-trade-hood"]], "one gas move, to the wallet holding the coin");
  assert.equal(s.sent.length, 1, "and nothing else");
  const row = (await s.activity()).find((a) => a.kind === "gas");
  assert.ok(row, "gas is a row of Activity");
  assert.equal(row.shown, true, "shown, not behind the scenes");
  assert.equal(row.words, "Kept for fees on Robinhood Chain");
});

test("D102: the cash above the cap still goes home by itself, shown and named, and it never lands on another network", async () => {
  const s = await lopsided({ reserveUsd: 20, solUsd: 120, hoodUsd: 0 });
  s.setCap(100);
  await s.rounds(8);
  assert.ok(!s.sent.some((x) => x.method === "subwallet.float.out"), `nothing goes out to a network: ${JSON.stringify(s.sent)}`);
  assert.ok(s.sent.some((x) => x.method === "subwallet.float.home"), `the cash above the cap went home: ${JSON.stringify(s.f.snapshot().moves)} ${JSON.stringify(s.sent)}`);
  assert.equal(s.chains().hood, 0, "Robinhood never got any");
  const rows = (await s.activity()).filter((a) => a.kind === "over-cap");
  assert.ok(rows.length >= 1 && rows.every((a) => a.shown), JSON.stringify(rows));
  assert.ok(rows.some((a) => a.words.endsWith("back to your Safe, over your limit")), JSON.stringify(rows.map((a) => a.words)));
});

test("D102: lowering the cap while on screen plans the cash above it at once, shown on Home's on-its-way list, not at the next 2-minute round", async () => {
  const s = await lopsided({ reserveUsd: 80, solUsd: 0, hoodUsd: 0 });
  await s.f.refresh();
  s.setCap(50);
  for (let i = 0; i < 5; i++) await settle();
  const home = s.f.snapshot().moves.find((m) => m.kind === "home" && m.why === "over-cap");
  assert.ok(home, `planned at once: ${JSON.stringify(s.f.snapshot().moves)}`);
  const svc = createSpendingService({ engine: () => s.f as never, call: async () => ({ value: null }) as never });
  const st = await svc.call<{ onItsWay: SpendingActivity[] }>("spending.status", {});
  assert.ok("ok" in st && st.ok.onItsWay.some((m) => m.kind === "over-cap" && m.words === `$${home.usd.toFixed(2)} back to your Safe, over your limit`), JSON.stringify(st));
  s.stop();
});

test("review L4: a sale's own fee move is gas, so Activity says \"kept for fees\", never a move the person asked for", async () => {
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("./app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /floatView\.moveNow\(fc, GAS_USD, \{ \.\.\.\(wallet \? \{ wallet \} : \{\}\), why: "gas" \}\)/);
});
