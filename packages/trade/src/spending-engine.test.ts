// Spending's engine (D52, D55): Trade's planner with the cap, gas, older wallets draining back, Make ready, a failed leg
// said honestly, and a relaunch that carries on. On the shell's MockBridge (its float answers as the core's), the
// planner's clock the test's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "./float-core.ts";
import { PRIVATE } from "./float.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const settle = () => new Promise((r) => setTimeout(r, 40));
const nativeUsd = async (c: keyof typeof PX) => PX[c];

async function setup(o: { refuse?: string; wallets?: CoreFloatDeps["wallets"]; store?: Map<string, unknown>; mock?: ReturnType<typeof createMockBridge> } = {}) {
  const mock = o.mock ?? createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (o.refuse && method === o.refuse) throw new ProblemError({ code: "security.subwallet.refused", whatHappened: "1Click's quote didn't check out.", money: { state: "safe", where: "in Spending" }, next: { kind: "nothing", label: "OK" } });
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  if (!o.mock) {
    for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  }
  let t = 1_000_000;
  const store = o.store ?? new Map<string, unknown>();
  const f = createCoreFloat({
    call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: o.wallets ?? (() => bridgeWallets(call, nativeUsd)),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); },
    now: () => t, every: () => () => undefined, rng: () => 0.5,
  });
  return { f, call, mock, store, later: (ms: number) => { t += ms; } };
}
const open = (f: ReturnType<typeof createCoreFloat>) => f.snapshot().moves.filter((m) => m.status === "waiting" || m.status === "moving");

test("the cap: cash above it goes home by itself, and nothing goes out to a network meanwhile (D102)", async () => {
  const { f } = await setup();
  f.setCap(100);
  await f.add(300); await settle(); await f.refresh();
  await f.traded("sol");
  const planned = open(f);
  const home = planned.find((m) => m.kind === "home");
  assert.ok(home && home.why === "over-cap", "an automatic put-away, marked as the engine's");
  assert.equal(home.usd, 200);
  assert.equal(planned.filter((m) => m.kind === "out").length, 0, "no network is filled by itself");
});

test("above the cap coins are never sold: only the cash there is goes home", async () => {
  let coins = 0;
  const { f, call, later: tickBy } = await setup({ wallets: async () => (await bridgeWallets(call, nativeUsd)).map((w) => (w.chain === "sol" && w.current ? { ...w, coinsUsd: coins } : w)) });
  const tick = () => tickBy(PRIVATE.delayMs[1]);
  await f.add(60); await settle(); await f.refresh();
  await f.moveNow("sol", 30); await f.moveNow("hood", 20);
  for (let i = 0; i < 3; i++) { tick(); await f.traded("sol"); await settle(); }   // the person's moves land
  coins = 600;                                                        // a buy that grew: Spending is $660 against a $500 cap
  f.setCap(500);
  await f.traded("hood");
  const home = open(f).find((m) => m.kind === "home");
  assert.ok(home, "the cash goes home");
  assert.ok(home.usd <= 60, `never more than the cash: ${home.usd}`);
  const back = open(f).filter((m) => m.kind === "in" && m.why === "over-cap");
  const sol = f.snapshot().chains.find((c) => c.chain === "sol")!;
  for (const m of back) assert.ok(m.usd <= f.snapshot().chains.find((c) => c.chain === m.chain)!.nativeUsd - 0.3 + 1e-9, `a fee reserve stays on ${m.chain}: ${m.usd}`);
  assert.ok(back.filter((m) => m.chain === "sol").every((m) => m.usd <= sol.nativeUsd - 1 + 1e-9), "Solana keeps its $1");
  assert.equal(sol.coinsUsd, 600, "nothing is sold for it");
});

test("mainnet 2 Nov (m-cap): Spending's cash is SOL and ETH on its networks, $0.95 in the reserve: over the cap, the spare cash comes back (fee reserves kept), then goes home", async () => {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 49.5).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0.95, held } });
  const store = new Map<string, unknown>([["float.split.v1", { sol: 40, hood: 25, bsc: 25, reserve: 10 }]]);   // Spending in use
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await raw("subwallet.create", { kind: "trade", chain });
  const { f, later } = await setup({ mock, store });
  await f.refresh();
  const before = f.snapshot().totalUsd;
  assert.ok(before > 110 && before < 111, `${before}`);
  const cap = Math.floor(before - 6);
  f.setCap(cap);
  const stop = f.start(); await settle();                              // its first round
  const planned = open(f);
  const home = planned.find((m) => m.kind === "home" && m.why === "over-cap");
  assert.ok(home, `the automatic Put away is planned: ${JSON.stringify(planned)}`);
  const back = planned.filter((m) => m.kind === "in");
  assert.ok(back.length >= 1 && back.every((m) => m.why === "over-cap"), "the networks' cash comes back for it");
  assert.ok(!planned.some((m) => m.kind === "out"), "nothing goes out meanwhile");
  assert.ok(back.reduce((n, m) => n + m.usd, 0) >= (home.usd - 0.95) * 1.02, "enough for the move home and its fee");
  for (let i = 0; i < 6; i++) { later(PRIVATE.delayMs[1]); await f.traded("hood"); await settle(); }
  await f.refresh();
  const s = f.snapshot();
  const done = s.moves.find((m) => m.id === home.id)!;
  assert.equal(done.status, "done", JSON.stringify(done));
  assert.equal(done.where, "main", "it reached the Safe");
  assert.ok(s.totalUsd <= cap + 5.01, `Trading is under the cap (with the $5 slack): ${s.totalUsd} vs ${cap}`);
  for (const c of s.chains.filter((x) => x.chain !== "bsc")) assert.ok(c.nativeUsd >= (c.chain === "sol" ? 1 : 0.3) - 0.01, `${c.chain} keeps its fee reserve: ${c.nativeUsd}`);
  stop();
});

test("review 2 Nov: a Buy sheet opened while the cap's move back waits its time keeps that wallet whole; the cash comes from another network", async () => {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 49.5).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0.95, held } });
  const store = new Map<string, unknown>([["float.split.v1", { sol: 40, hood: 25, bsc: 25, reserve: 10 }]]);
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await raw("subwallet.create", { kind: "trade", chain });
  const { f, later } = await setup({ mock, store });
  await f.refresh();
  f.setCap(Math.floor(f.snapshot().totalUsd - 6));
  const stop = f.start(); await settle();
  const first = open(f).filter((m) => m.kind === "in" && m.why === "over-cap");
  assert.ok(first.some((m) => m.chain === "sol"), `the fullest network's cash is planned to come back: ${JSON.stringify(first)}`);
  const release = f.keep("sol");                                       // the person opens a Buy sheet on Solana meanwhile
  for (let i = 0; i < 6; i++) { later(PRIVATE.delayMs[1]); await f.traded("hood"); await settle(); }
  await f.refresh();
  const s = f.snapshot();
  assert.ok(!s.moves.some((m) => m.kind === "in" && m.chain === "sol" && m.status !== "waiting"), `nothing left Solana while its sheet was open: ${JSON.stringify(s.moves)}`);
  assert.equal(s.chains.find((c) => c.chain === "sol")!.nativeUsd, 60, "the Solana wallet is whole");
  const home = s.moves.find((m) => m.kind === "home" && m.why === "over-cap" && m.status === "done");
  assert.ok(home, `the cap's cash still went home: ${JSON.stringify(s.moves)}`);
  assert.ok(s.moves.some((m) => m.kind === "in" && m.chain === "hood" && m.why === "over-cap" && m.status === "done"), "from Robinhood Chain instead");
  release(); stop();
});

test("review 2 Nov: the cap's move back keeps the wallet's fee reserve AND room for that move's own network fee, coins held or not", async () => {
  const held = { "sw-trade-sol": units("sol", 60).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0.95, held } });
  const store = new Map<string, unknown>([["float.split.v1", { sol: 40, hood: 25, bsc: 25, reserve: 10 }]]);
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await raw("subwallet.create", { kind: "trade", chain });
  const { f } = await setup({ mock, store, wallets: async () => (await bridgeWallets(raw, nativeUsd)).map((w) => (w.chain === "sol" && w.current ? { ...w, coinsUsd: 5 } : w)) });
  await f.refresh();
  f.setCap(1);                                                          // everything over it: the most Solana can give is asked
  const stop = f.start(); await settle();
  const back = open(f).filter((m) => m.kind === "in" && m.why === "over-cap" && m.chain === "sol");
  assert.equal(back.length, 1, JSON.stringify(open(f)));
  // $60 less the $1 fee reserve less the move's own fee room (2% capped at $0.50)
  assert.equal(back[0]!.usd, 58.5);
  stop();
});

test("mainnet 2 Nov (m-put-away): Put away $3 with $0.95 in the reserve brings the rest back from a network first, and goes", async () => {
  const held = { "sw-trade-sol": units("sol", 60).toString(), "sw-trade-hood": units("hood", 49.5).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0.95, held } });
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await raw("subwallet.create", { kind: "trade", chain });
  const { f } = await setup({ mock });
  await f.refresh();
  const row = await f.takeOut(3);
  for (let i = 0; i < 4; i++) { await settle(); await f.traded("sol"); }
  const end = f.snapshot().moves.find((m) => m.id === row.id)!;
  assert.equal(end.status, "done", JSON.stringify(end));
  assert.ok(end.usd >= 2.9, `about $3 went home: ${end.usd}`);
});

test("a Put away whose cash can't come back from the networks says why, and how much can go home now", async () => {
  const held = { "sw-trade-sol": units("sol", 60).toString() };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0.95, held } });
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await raw("subwallet.create", { kind: "trade", chain });
  const { f } = await setup({ mock, refuse: "subwallet.float.in" });
  await f.refresh();
  const row = await f.takeOut(3);
  for (let i = 0; i < 3; i++) { await settle(); await f.traded("sol"); }
  const end = f.snapshot().moves.find((m) => m.id === row.id)!;
  assert.equal(end.status, "failed");
  assert.match(end.note ?? "", /from Solana didn't come back \(1Click's quote didn't check out\.\)/);
  assert.match(end.note ?? "", /\$0\.95 can go back to your Safe now \(\$2\.00 at least\)/);
  assert.match(end.note ?? "", /· it's still in your SOL wallet ·/, "the Solana part never left its wallet (product decision, 5 Nov)");
  assert.match(end.note ?? "", /the rest is in your NEAR wallet$/);
});

test("gas: a wallet holding coins but short of its fee gets a top-up first, marked gas", async () => {
  const { f, call } = await setup({ wallets: async () => (await bridgeWallets(call, nativeUsd)).map((w) => (w.chain === "hood" ? { ...w, nativeUsd: 0, coinsUsd: 40 } : w)) });
  await f.add(100); await settle(); await f.refresh();
  await f.traded("sol");
  const gas = open(f).find((m) => m.why === "gas");
  assert.ok(gas && gas.chain === "hood" && gas.kind === "out" && gas.usd >= 2, JSON.stringify(open(f)));
});

test("Put away keeps a wallet's fee reserve while it holds coins, so they can still be sold (H22)", async () => {
  const { f, call } = await setup({ wallets: async () => (await bridgeWallets(call, nativeUsd)).map((w) => (w.chain === "sol" && w.current ? { ...w, nativeUsd: 20, movableUsd: 20, coinsUsd: 40 } : w)) });
  await f.refresh();
  assert.equal(f.snapshot().takeableUsd, 19, "the $1 Solana keeps for fees stays");
});

test("a relaunch mid-round carries on: the planned moves are read back and go when due", async () => {
  const store = new Map<string, unknown>();
  const { f, mock } = await setup({ store });
  f.setCap(100);
  await f.add(300); await settle(); await f.refresh(); await f.traded("sol");
  const waiting = open(f).filter((m) => m.kind === "home").map((m) => m.id).sort();
  assert.equal(waiting.length, 1, "the cap's move home waits its private time");
  const again = await setup({ store, mock });
  again.f.setCap(100);
  await again.f.refresh();
  assert.deepEqual(open(again.f).filter((m) => m.kind === "home").map((m) => m.id).sort(), waiting, "the same move, never twice");
  again.later(PRIVATE.delayMs[1]); await again.f.traded("hood"); await settle(); await again.f.traded("hood"); await settle(); await again.f.refresh();
  const s = again.f.snapshot();
  assert.equal(s.moves.find((m) => m.id === waiting[0])!.status, "done", "it went");
  assert.equal(s.moves.filter((m) => m.kind === "home").length, 1, "once");
});

test("a failed leg is said honestly: refused, where the money stayed, and shown in Activity", async () => {
  const { f } = await setup({ refuse: "subwallet.float.out" });
  await f.add(200); await settle(); await f.refresh();
  await f.moveNow("sol", 50).catch(() => undefined); await settle(); await f.refresh();
  const failed = f.snapshot().moves.find((m) => m.kind === "out" && m.status === "failed");
  assert.ok(failed && failed.stayed && /in your NEAR wallet/.test(failed.note ?? ""), JSON.stringify(failed));
  const svc = createSpendingService({ engine: () => f, call: async <T,>(m: string) => (m === "device.store.get" ? { value: null } : {}) as T });
  const r = await svc.call<SpendingActivity[]>("spending.activity", {});
  assert.ok("ok" in r);
  const row = r.ok.find((a) => a.id === failed.id)!;
  assert.equal(row.status, "refused");
  assert.equal(row.shown, true, "a move that failed is shown");
  assert.equal(row.words, "Moving $50.00 to Solana", "named by its network");
  assert.match(row.note ?? "", /quote didn't check out/);
  const topUp = r.ok.find((a) => a.kind === "top-up")!;
  assert.equal(topUp.shown, true);
});

// ── One wallet per chain (D55, D56): the migration loses nothing; Make ready; an export changes nothing ─────────────

/** What a wallet holds of its chain's coin, in smallest units, for $usd at the mock's prices. */
const units = (chain: "sol" | "hood", usd: number) => (chain === "sol" ? BigInt(Math.round((usd / PX.sol) * 1e9)) : BigInt(Math.round((usd / PX.hood) * 1e9)) * 10n ** 9n);

test("D55 migration: older wallets drain to Spending with moves in only, gas only to the one holding coins, a legacy job settles with its key; totals before = after + fees; Put away brings it home", async () => {
  // Before D55 (the fixture of the plan): Solana slots 0–3 (slot 2 holds a coin and can't pay its fee, slot 3's key was
  // exported), slot 4 with a move in already asked by the old journal; the old apps wallet on Solana with SOL and a coin;
  // Robinhood's slot 0 from replaced words, and the new words' wallet beside it.
  const held: Record<string, string> = {
    "sw-trade-sol": units("sol", 30).toString(), "sw-trade-sol-1": units("sol", 15).toString(), "sw-trade-sol-2": units("sol", 0.2).toString(),
    "sw-trade-sol-3": units("sol", 15).toString(), "sw-trade-sol-4": units("sol", 15).toString(), "sw-browser-sol": units("sol", 15).toString(),
    "sw-trade-hood": units("hood", 15).toString(),
  };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 10, held } });
  const sent: Record<string, unknown>[] = [];
  const raw: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.out" || method === "subwallet.float.in") sent.push({ method, ...params }); return raw(method, params); };
  for (const slot of [0, 1, 2, 3, 4]) await raw("subwallet.create", { kind: "trade", chain: "sol", slot });
  await raw("subwallet.create", { kind: "browser", chain: "sol" });
  for (const slot of [0, 1]) await raw("subwallet.create", { kind: "trade", chain: "hood", slot });
  const COINS: Record<string, number> = { "sw-trade-sol-2": 30, "sw-browser-sol": 5 };
  // the core's marks (MockBridge keeps none of them): slot 3's key shown; Robinhood's slot 0 from the old words, its
  // new words' wallet the current one
  const wallets = async () => (await bridgeWallets(raw, nativeUsd)).map((w) => ({
    ...w, coinsUsd: COINS[w.id] ?? 0,
    ...(w.id === "sw-trade-sol-3" ? { keyExported: true } : {}),
    ...(w.id === "sw-trade-hood" ? { current: false, oldWords: true } : w.id === "sw-trade-hood-1" ? { current: true } : {}),
  }));
  const LEGACY = "legacy-asked-in-slot4";
  const store = new Map<string, unknown>([["float.jobs.v1", [{ id: LEGACY, kind: "in", chain: "sol", slot: 4, usd: 15, all: true, at: 0, state: "asked", asked: true }]]]);
  let t = 1_000_000;
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets, get: async (k) => store.get(k), set: async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); }, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  /** Everything the person has in Spending, in dollars: the reserve, every wallet's own coin and its coins. */
  const total = async () => {
    const b = await raw<{ usd: number }>("subwallet.float.balance", {});
    let n = b.usd;
    for (const w of await wallets()) n += w.nativeUsd + w.coinsUsd;
    return n;
  };
  /** What 1Click and the bridges took (the mock's 2 % a move): what each move sent less what it brings. */
  const fees = async () => (await raw<{ kind: string; status: string; sent: { tokenId: string; amount: string }; expected: { tokenId: string; amount: string } }[]>("subwallet.float.moves", {}))
    .reduce((n, m) => n + (m.kind === "in" ? Number(m.sent.amount) / (m.sent.tokenId.includes("sol") ? 1e9 / PX.sol : 1e18 / PX.hood) - Number(m.expected.amount) / 1e6 : m.kind === "out" ? Number(m.sent.amount) / 1e6 - Number(m.expected.amount) / (m.expected.tokenId.includes("sol") ? 1e9 / PX.sol : 1e18 / PX.hood) : 0), 0);
  await f.refresh();
  const before = await total();
  // rounds: each older wallet's move back, the gas, the legacy job, each landing in turn (one move per chain at a time)
  for (let i = 0; i < 12; i++) { t += PRIVATE.delayMs[1]; await f.traded("sol"); await settle(); }
  await f.refresh();
  const s = f.snapshot();
  for (const chain of ["sol", "hood"] as const) assert.equal(s.chains.find((c) => c.chain === chain)!.wallets.filter((w) => w.current).length, 1, `${chain}: one current wallet`);
  const outs = sent.filter((x) => x.method === "subwallet.float.out");
  assert.deepEqual(outs.map((x) => [x.to, x.slot]), [["sw-trade-sol-2", undefined]], "the only move out: gas, to the older wallet holding a coin; nothing ever goes wallet to wallet or into another older wallet");
  const ins = sent.filter((x) => x.method === "subwallet.float.in");
  assert.deepEqual([...new Set(ins.map((x) => (x.from ?? `slot ${x.slot}`) as string))].sort(), ["slot 4", "sw-browser-sol", "sw-trade-hood", "sw-trade-sol-1", "sw-trade-sol-3"].sort(), "every older wallet with $2 or more drains back; the current ones and the one under its fee reserve don't");
  assert.ok(ins.filter((x) => x.slot === 4).every((x) => x.key === LEGACY && x.amount === "all"), "the legacy job is sent again with its saved key and slot");
  const jobs = store.get("float.jobs.v1") as { id: string; state: string }[];
  assert.equal(jobs.find((j) => j.id === LEGACY)?.state, "done", "and settles");
  const after = await total(), paid = await fees();
  assert.ok(Math.abs(before - (after + paid)) < 0.05, `nothing lost: before $${before.toFixed(2)} = after $${after.toFixed(2)} + fees $${paid.toFixed(2)}`);
  assert.ok(s.chains.find((c) => c.chain === "sol")!.wallets.find((w) => w.id === "sw-browser-sol")!.nativeUsd >= 0.99, "the old apps wallet keeps its fee reserve while it holds a coin");
  // Put away: everything that can move comes home (coin holders keep their fee reserve, so their coins can be sold)
  await f.takeOut("all");
  for (let i = 0; i < 12; i++) { t += 1_000; await f.traded("hood").catch(() => undefined); await settle(); }
  await f.refresh();
  const end = f.snapshot();
  assert.ok(end.reserveUsd < 0.01, `the reserve went home: ${end.reserveUsd}`);
  const left = end.chains.flatMap((c) => c.wallets).filter((w) => w.nativeUsd >= 0.01);
  assert.ok(left.every((w) => (COINS[w.id] ?? 0) > 0 && w.nativeUsd <= 1.01 + 2.2), `cash left only where coins need their fee: ${JSON.stringify(left.map((w) => [w.id, w.nativeUsd]))}`);
  assert.ok(end.moves.some((m) => m.kind === "home" && m.status === "done"), "home, done");
});

test("D55 Make ready: Spending's cash goes to Solana's current wallet now, marked ready and shown; short cash says Top up", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 30 } });
  const outs: Record<string, unknown>[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.out") outs.push(params); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  await call("subwallet.create", { chain: "sol" });
  await call("subwallet.create", { kind: "trade", chain: "sol", slot: 1 });
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f, call: async <T,>(m: string) => (m === "device.store.get" ? { value: null } : {}) as T });
  const r = await svc.call<SpendingActivity>("spending.makeReady", { network: "sol", usd: 10 });
  assert.ok("ok" in r && r.ok.kind === "ready" && r.ok.shown, JSON.stringify(r));
  assert.deepEqual(outs.map((o) => o.to), ["sw-trade-sol"], "to the current Solana wallet, never an older one");
  await settle(); await f.refresh();
  const done = (await svc.call<SpendingActivity[]>("spending.activity", {}));
  assert.ok("ok" in done && done.ok.some((a) => a.kind === "ready" && a.words === "Made $10.00 ready on Solana"), JSON.stringify(done));
  const short = await svc.call("spending.makeReady", { network: "sol", usd: 100 });
  assert.ok("problem" in short && short.problem.code === "spending.ready.short");
});

test("D56: an exported key changes nothing: the wallet stays current, nothing drains from it, and the person's next move goes to it", async () => {
  const { f, call, later } = await setup();
  const listed = await call<{ id: string; chain: string }[]>("subwallet.list", {});
  const sol = listed.find((w) => w.chain === "sol")!;
  await call("subwallet.export", { id: sol.id });
  await f.add(300); await settle(); await f.refresh();
  await f.moveNow("sol", 100); later(PRIVATE.delayMs[1]); await settle(); await f.traded("sol"); await settle(); await f.traded("sol"); await f.refresh();
  const w = f.snapshot().chains.find((c) => c.chain === "sol")!.wallets.find((x) => x.id === sol.id)!;
  assert.deepEqual([w.current, w.keyExported], [true, true]);
  assert.ok(w.nativeUsd > 50, `filled as before: $${w.nativeUsd}`);
  assert.ok(!f.snapshot().moves.some((m) => m.kind === "in" && m.why === "older"), "never drained as if it were an older wallet");
});

test("mainnet 2 Nov: a fresh account (no chain wallet made yet), a Top up, then the person's moves fill Solana and Robinhood: the first move out makes the chain's wallet", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const { f, call, later } = await setup({ mock });
  assert.ok(!(await call<{ chain: string }[]>("subwallet.list", {})).some((w) => w.chain === "hood"), "no Robinhood wallet before");
  await f.add(300); await settle(); await f.refresh();
  await f.moveNow("sol", 100); await f.moveNow("hood", 80);
  for (let i = 0; i < 4; i++) { await f.traded("sol"); later(PRIVATE.delayMs[1]); await f.traded("sol"); await settle(); }
  await f.refresh();
  const s = f.snapshot();
  assert.ok(!s.moves.some((m) => m.status === "failed"), JSON.stringify(s.moves.filter((m) => m.status === "failed").map((m) => m.note)));
  for (const chain of ["sol", "hood"] as const) assert.ok(s.chains.find((c) => c.chain === chain)!.nativeUsd > 20, `${chain} filled: ${JSON.stringify(s.chains.map((c) => [c.chain, c.nativeUsd]))}`);
  assert.equal((await call<{ chain: string; current?: boolean }[]>("subwallet.list", {})).filter((w) => w.chain === "hood" && w.current).length, 1, "Robinhood's wallet was made, once, as the current one");
});
