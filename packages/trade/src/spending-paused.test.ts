// Spending's engine on and off screen (H23): off screen a step the phone signs waits and Activity says when it finishes;
// back on screen (or after a relaunch) it carries on from the journal; while a move is on its way it's followed every
// second, slower once quiet, and a Top up on its way reads only the float's own count; a Top up spreads by recent use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { PAUSED_NOTE, createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { FOLLOW_MS, bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { createJobRunner, type Job } from "./float-jobs.ts";
import { PRIVATE } from "./float.ts";
import { DEFAULT_SPLIT, splitFromUse } from "./float-view.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(o: { store?: Map<string, unknown>; mock?: ReturnType<typeof createMockBridge>; moveMs?: number } = {}) {
  const mock = o.mock ?? createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: o.moveMs ?? 10 } });
  const asked: string[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => { asked.push(method); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  if (!o.mock) for (const chain of ["sol", "hood"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const store = o.store ?? new Map<string, unknown>();
  const timers: { fn: () => void; ms: number }[] = [];
  const f = createCoreFloat({
    call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); },
    now: () => t, every: (fn, ms) => { timers.push({ fn, ms }); return () => { timers.splice(timers.findIndex((x) => x.fn === fn), 1); }; }, rng: () => 0.5,
  });
  const follow = async () => { timers.find((x) => x.ms === FOLLOW_MS)?.fn(); await settle(); };
  return { f, call, mock, store, asked, follow, later: (ms: number) => { t += ms; } };
}
const activity = async (f: ReturnType<typeof createCoreFloat>) => {
  const svc = createSpendingService({ engine: () => f, call: async <T,>(m: string) => (m === "device.store.get" ? { value: null } : {}) as T });
  const r = await svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in r);
  return r.ok;
};

test("off screen a step the phone signs waits, and Activity says it finishes next time; back on screen it goes", async () => {
  const { f, later, follow } = await setup();
  let stop = f.start();
  f.setCap(100);
  await f.add(200); await settle(); await f.refresh(); await f.traded("sol");
  // the cap's move home waits its private time (D102: the only move the engine plans by itself here)
  const planned = f.snapshot().moves.filter((m) => m.kind === "home" && m.status === "waiting");
  assert.ok(planned.length === 1 && planned.every((m) => !m.paused), "on screen: waiting its private time, not paused");
  stop();                                                              // ZeroFee leaves the screen
  assert.ok(f.snapshot().moves.filter((m) => m.kind === "home" && m.status === "waiting").every((m) => m.paused));
  const row = (await activity(f)).find((a) => a.id === planned[0]!.id)!;
  assert.equal(row.status, "waiting");
  assert.equal(row.note, PAUSED_NOTE, "said plainly, never a row that looks stuck");
  assert.equal(PAUSED_NOTE, "Finishes next time you open ZeroFee");
  assert.equal((await activity(f)).find((a) => a.kind === "top-up")!.status, "done");
  later(PRIVATE.delayMs[1]);
  stop = f.start();                                                    // back on screen: the follow runs what's due
  for (let i = 0; i < 6; i++) await follow();
  await f.refresh();
  assert.ok(f.snapshot().moves.filter((m) => m.kind === "home").every((m) => m.status === "done" && !m.paused), JSON.stringify(f.snapshot().moves));
  stop();
});

test("a Put away cut off by the background (asked, no answer kept) finishes after a relaunch, once, with the same key", async () => {
  const store = new Map<string, unknown>();
  const first = await setup({ store });
  await first.f.add(120); await settle(); await first.f.refresh();
  // the journal as the app left it: the Put away's move home saved as asked, the call cut off before its answer
  const home: Job = { id: "putaway-cut-off-0001", kind: "home", usd: 50, at: 0, state: "asked", asked: true };
  store.set("float.jobs.v1", [home]);
  const again = await setup({ store, mock: first.mock });
  await again.f.refresh();
  assert.equal(again.f.snapshot().moves.find((m) => m.id === home.id)?.paused, true, "before the engine runs: it waits for the app");
  const row = (await activity(again.f)).find((a) => a.id === home.id)!;
  assert.deepEqual([row.kind, row.status, row.shown, row.note], ["put-away", "waiting", true, PAUSED_NOTE]);
  const stop = again.f.start();
  for (let i = 0; i < 6; i++) await again.follow();
  await again.f.refresh();
  const done = again.f.snapshot().moves.filter((m) => m.kind === "home");
  assert.deepEqual(done.map((m) => [m.id, m.status]), [[home.id, "done"]], "asked again with its own key: one move home, none twice");
  assert.equal(again.asked.filter((m) => m === "subwallet.float.home").length, 1);
  stop();
});

test("followed every second while a Top up is on its way (the float's own count only), slower once quiet, nothing asked idle", async () => {
  let credited = 0, t = 0;
  const asked: string[] = [];
  const call: CoreFloatDeps["call"] = async (method) => {
    asked.push(method);
    if (method === "ledger.toTrading") return { id: "mv-x", status: "moving" } as never;    // the ledger: on its way
    if (method === "subwallet.create") return { id: "sw-trade-near" } as never;
    if (method === "subwallet.float.balance") return { tokens: [], usd: credited, asOfIso: new Date(0).toISOString() } as never;
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 } as never;
    throw new Error("unexpected " + method);
  };
  const timers: { fn: () => void; ms: number }[] = [];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => { asked.push("wallets"); return []; }, get: async () => undefined, set: async () => {}, now: () => t, every: (fn, ms) => { timers.push({ fn, ms }); return () => undefined; } });
  const follow = async () => { timers.find((x) => x.ms === FOLLOW_MS)!.fn(); await settle(); };
  const stop = f.start();
  await settle();
  asked.length = 0;
  for (let i = 0; i < 3; i++) await follow();
  assert.deepEqual(asked, [], "idle: no call at all");
  await f.add(100); await settle();
  asked.length = 0;
  await follow();
  assert.deepEqual(asked, ["subwallet.float.balance"], "on its way: the float's own count each second, no chain reads");
  credited = 100; t += 1_000;
  await follow();
  assert.ok(asked.includes("wallets"), "it landed in the count: everything read once");
  assert.equal(f.snapshot().totalUsd, 100);
  t += 10 * 60_000;                                                    // quiet a long while: every 10 s now
  await follow(); asked.length = 0;
  await follow();
  assert.deepEqual(asked, [], "within the slower gap nothing is asked");
  t += 10_000;
  await follow();
  assert.deepEqual(asked, ["subwallet.float.balance"], "then asked again");
  stop();
});

test("a Top up spreads by recent use: the network traded on gets most, the other still a working balance", () => {
  assert.deepEqual(splitFromUse(DEFAULT_SPLIT, {}), DEFAULT_SPLIT, "no trades yet: the default");
  const s = splitFromUse(DEFAULT_SPLIT, { hood: 9, sol: 1 });
  assert.equal(s.sol + s.hood + s.bsc + s.reserve, 100);
  assert.equal(s.reserve, DEFAULT_SPLIT.reserve);
  assert.ok(s.hood > s.sol && s.sol >= Math.floor(DEFAULT_SPLIT.sol / 3), JSON.stringify(s));
  assert.ok(s.bsc >= Math.floor(DEFAULT_SPLIT.bsc / 3), "unused: a third of its default still");
});

test("D102: a Top up never spreads by itself, whatever the network traded on lately; the split is only kept as \"Spending in use\"", async () => {
  const store = new Map<string, unknown>();
  const { f } = await setup({ store });
  for (let i = 0; i < 5; i++) await f.traded("hood");
  await f.add(300); await settle(); await f.refresh(); await f.traded("hood");
  assert.deepEqual(f.snapshot().moves.filter((m) => m.kind === "out"), [], "nothing goes out to a network");
  assert.ok(store.get("float.split.v1"), "kept: Spending is in use (the cap is planned)");
});

test("the job runner says when a tick changed something, and when the step under way has finished", async () => {
  let saved: Job[] = [{ id: "follow-only-job-0001", kind: "out", chain: "sol", slot: 0, usd: 5, at: 0, state: "moving", moveId: "m1" }];
  let status: "pending" | "done" = "pending";
  const r = createJobRunner({
    out: async () => ({ id: "m1", status: "pending" }), in: async () => ({ id: "m1", status: "pending" }), home: async () => ({ id: "m1", status: "pending" }),
    move: async () => ({ id: "m1", status }), toRaw: async () => "1", load: async () => saved, save: async (j) => { saved = j; }, now: () => 1, newId: () => "x".repeat(16),
  });
  assert.equal(await r.tick(), false, "still on its way: nothing changed");
  status = "done";
  const t = r.tick();
  await r.idle();
  assert.equal(await t, true, "landed: changed");
  assert.equal(saved[0]!.state, "done");
});

test("the shell's host pauses the engine while the page is hidden and starts it again when it's back; settle answers", async () => {
  const { forApps } = await import("@zerofee/core/bridge");
  const { hostSpending } = await import("./spending-host.ts");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 5, startUsd: 50 } });
  let rounds = 0;
  const spy = { call: (m: string, p?: Record<string, unknown>) => { if (m === "subwallet.float.limits") rounds++; return mock.call(m, p); }, on: mock.on } as Parameters<typeof forApps>[0];
  const handlers = new Set<() => void>();
  const doc = { visibilityState: "hidden", addEventListener: (_: string, h: () => void) => handlers.add(h), removeEventListener: (_: string, h: () => void) => handlers.delete(h) };
  (globalThis as { document?: unknown }).document = doc;
  try {
    // the page's own rest listener (shell-api rest.ts, installed once at boot, as main.tsx does): the engine's round
    // waits on it (heat, 3 Nov); it is the page's, not the engine's, so it is the baseline here
    const { install } = await import("@zerofee/shell-api/rest.ts");
    install();
    const base = handlers.size;
    const trade = forApps(spy, "trade");
    const spending = hostSpending(() => trade, () => trade);
    const stop = spending.start();
    await settle();
    assert.equal(rounds, 0, "hidden: the engine doesn't start");
    doc.visibilityState = "visible"; handlers.forEach((h) => h());
    await settle();
    assert.ok(rounds > 0, "visible: it runs");
    doc.visibilityState = "hidden"; handlers.forEach((h) => h());
    await spending.settle();
    await settle();
    const seen = rounds;
    await settle();
    assert.equal(rounds, seen, "hidden again: paused, nothing new asked");
    stop();
    assert.equal(handlers.size, base, "stopped: no listener of the engine's left");
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});
