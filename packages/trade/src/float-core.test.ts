// FloatView on the shell's MockBridge (its float answers as the core's will, mock-float.ts): Add → the reserve → the
// chains fill to the sliders in private rounds → Take out brings everything home. The planner's clock is the test's;
// MockBridge's moves take a few real milliseconds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { AFTER_LANDING_MS, FOLLOW_MS, bridgeWallets, createCoreFloat, moveAnswer, type CoreFloatDeps } from "./float-core.ts";
import { PRIVATE } from "./float.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;               // MockBridge's sample prices
const settle = () => new Promise((r) => setTimeout(r, 40));

test("speed (D145): a refresh reads the balances beside the kept Adds and the journal, never after them; it still ends only once the Adds are in (control)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0 } });
  const asked: string[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => { asked.push(method); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({
    offered: () => true, call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    // the phone's store answers slowly (the kept Adds, the journal)
    get: async () => { await held; return undefined; }, set: async () => {},
    now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5,
  });
  let done = false;
  const r = f.refresh().then(() => { done = true; });
  await settle();
  assert.ok(asked.includes("subwallet.float.balance") && asked.includes("subwallet.list"), `the balances were asked while the store was still out: ${asked.join(", ")}`);
  assert.equal(done, false, "control: the refresh ends only once the kept Adds are read");
  release();
  await r;
  assert.equal(done, true);
});

async function setup(startUsd = 0, made = true) {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  if (made) for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const store = new Map<string, unknown>();
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({
    offered: () => true, // these tests drive all three chains, BNB included (its code paths stay tested until it opens)
    call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); },
    now: () => t, every: () => () => undefined, rng: () => 0.5,
  });
  return { f, call, store, later: (ms: number) => { t += ms; } };
}

test("Add $1,000: it reaches the reserve and stays there (D102); the person's own moves fill Solana and Robinhood, and only fees leave", async () => {
  const { f, later } = await setup();
  const stop = f.start();
  assert.notEqual(await f.add(1000), "declined");
  await settle();
  await f.refresh();
  assert.equal(f.snapshot().reserveUsd, 1000, "the Add landed in the Trading balance");
  assert.deepEqual(f.snapshot().moves.filter((m) => m.kind === "add").map((m) => [m.status, m.where]), [["done", "reserve"]], "its row followed the movement to done");
  later(PRIVATE.delayMs[1]); await f.traded("sol").catch(() => undefined);
  assert.deepEqual(f.snapshot().moves.filter((m) => m.kind === "out"), [], "D102: nothing goes to a network by itself");
  await f.moveNow("sol", 400); await f.moveNow("hood", 250);
  await settle(); await f.traded("hood"); await settle(); await f.refresh();
  const s = f.snapshot();
  assert.ok(Math.abs(s.chains[0]!.nativeUsd - 400) < 1 && Math.abs(s.chains[1]!.nativeUsd - 250) < 1, JSON.stringify(s.chains.map((c) => [c.chain, c.nativeUsd])));
  assert.equal(Math.round(s.chains[2]!.nativeUsd), 0, "BNB Chain got nothing: the person didn't move any there");
  assert.ok(s.moves.filter((m) => m.kind === "out").every((m) => m.status === "done" && m.where === "chain" && m.why === "asked"));
  assert.ok(s.totalUsd > 970 && s.totalUsd <= 1000, `only fees left: ${s.totalUsd}`);
  assert.equal(s.chains[0]!.readyUsd, Math.floor((s.chains[0]!.nativeUsd - 1) * 100) / 100, "Solana keeps $1 for its fees");
  stop();
});

test("Take out: every wallet comes back to the reserve, then the reserve goes home; the Trading total ends at 0", async () => {
  const { f } = await setup();
  await f.add(300); await settle(); await f.refresh();
  await f.moveNow("sol", 150); await f.moveNow("hood", 80); await settle(); await f.traded("sol"); await settle(); await f.refresh();
  assert.ok(f.snapshot().chains.some((c) => c.nativeUsd > 50));
  await f.takeOut("all");
  await settle(); await f.refresh(); await f.traded("sol").catch(() => undefined); await settle(); await f.traded("sol").catch(() => undefined); await settle(); await f.refresh();
  const s = f.snapshot();
  assert.ok(s.chains.every((c) => c.nativeUsd < 0.01), JSON.stringify(s.chains.map((c) => c.nativeUsd)));
  assert.ok(s.moves.some((m) => m.kind === "home" && m.status === "done" && m.where === "main"));
  assert.ok(s.totalUsd < 0.01, `${s.totalUsd}`);
});

test("D55: an older wallet's own coin drains back to the reserve (never wallet to wallet), at the short end of the wait; the current one is filled from there", async () => {
  const { f, call } = await setup(0);
  // an older Solana wallet (slot 2, from before) holding $40 of SOL: its move back is an "in" from it, by id
  await call("subwallet.create", { kind: "trade", chain: "sol", slot: 2 });
  const sent: Record<string, unknown>[] = [];
  const wallets = async () => (await bridgeWallets(call, async (c) => PX[c])).map((w) => (w.id === "sw-trade-sol-2" ? { ...w, nativeUsd: 40, movableUsd: 40 } : w));
  const g = createCoreFloat({ offered: () => true, call: async (m, p) => { if (m.startsWith("subwallet.float.") && m !== "subwallet.float.balance" && m !== "subwallet.float.limits") sent.push({ m, ...p }); return call(m, p); }, nativeUsd: async (c) => PX[c], wallets, get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0 });
  await g.refresh();
  const sol = g.snapshot().chains.find((c) => c.chain === "sol")!;
  assert.deepEqual(sol.wallets.map((w) => [w.id, w.current]), [["sw-trade-sol", true], ["sw-trade-sol-2", false]]);
  await g.traded("sol");
  const drain = g.snapshot().moves.filter((m) => m.kind === "in");
  assert.deepEqual(drain.map((m) => [m.chain, m.usd, m.why]), [["sol", 40, "older"]], "planned before anything else, even before a Top up");
  assert.ok(drain[0]!.at >= 20_000 && drain[0]!.at <= 45_000, `the short end of the private wait: ${drain[0]!.at}`);
  assert.ok(!sent.some((x) => x.m === "subwallet.float.out" && x.to === "sw-trade-sol-2"), "an older wallet is never filled");
});

test("the float's count shows an Add one status read after the ledger says it landed: meanwhile it stays on its way and in the total, never missing", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  let stale = true;                                                    // the core hasn't read 1Click's status yet
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.balance" && stale) return { tokens: [], usd: 0, asOfIso: new Date(0).toISOString() };
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => Date.now(), every: () => () => undefined, rng: () => 0.5 });
  await f.add(250); await settle(); await f.refresh();
  const mid = f.snapshot();
  assert.deepEqual(mid.moves.map((m) => [m.kind, m.status]), [["add", "moving"]], "landed on the ledger, not yet in the float's count");
  assert.equal(mid.totalUsd, 250, "and still counted");
  stale = false;
  await f.refresh();
  const end = f.snapshot();
  assert.deepEqual(end.moves.map((m) => [m.kind, m.status, m.where]), [["add", "done", "reserve"]]);
  assert.equal(end.totalUsd, 250, "counted once, by the float now");
});

test("before the person uses Spending (no Top up), money already there stays put; after a Top up too (D102)", async () => {
  const { f, later } = await setup(300);
  await f.refresh();
  assert.equal(f.snapshot().reserveUsd, 300);
  await f.traded("sol"); later(PRIVATE.delayMs[1]); await f.traded("sol");
  assert.deepEqual(f.snapshot().moves, [], "nothing planned, nothing moved");
  await f.add(20); await settle(); await f.refresh(); await f.traded("sol"); later(PRIVATE.delayMs[1]); await f.traded("sol");
  assert.ok(!f.snapshot().moves.some((m) => m.kind === "out" || m.kind === "in"), "a Top up starts no move to a network");
});

test("the Trading total counts the coins held, as Positions and Wallet's \"In trading\" do; the planner spreads only the money", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 100 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const f = createCoreFloat({ offered: () => true, call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 50, coinsUsd: 25 }], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
  await f.refresh();
  const s = f.snapshot();
  assert.equal(s.totalUsd, 175, "$100 reserve + $50 on Solana + $25 of coins");
  assert.equal(s.chains[0]!.coinsUsd, 25);
  assert.equal(s.chains[0]!.targetUsd, 60, "40 of 90 of the $150 of money, the coins left out");
});

test("an Add the account's protection holds (D17) waits in the main balance: not counted in Trading, its hold handed to the Waiting screen", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 30, float: { moveMs: 10 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  const r = await f.add(40);
  assert.ok(r !== "declined" && r.held && r.held.id, "the hold, for showWaiting");
  await settle(); await f.refresh();
  const s = f.snapshot();
  assert.deepEqual(s.moves.map((m) => [m.kind, m.status, m.where]), [["add", "waiting", "main"]]);
  assert.equal(s.totalUsd, 0, "still the main balance's");
});

test("an Add's row reaches the screens at once, before the balance read after it comes back (set-up's You're set reads it)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, holdSeconds: 30, float: { moveMs: 10 } });
  let gate: Promise<void> | undefined;
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.balance" && gate) await gate;
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  const heard: number[] = [];
  f.subscribe(() => heard.push(f.snapshot().moves.length));
  gate = new Promise<void>(() => {});                                  // the balance read never comes back
  await f.add(40);
  await settle();
  assert.deepEqual(heard, [1], "told once, with the held Add's row");
});

test("open moves are followed every few seconds, with no trade or 2-minute round: a Take out settles, and its row is what the sheet promised", async () => {
  // the move takes 400 ms of real time, well past the Take out's own return (10 ms raced it on a loaded box: the row had
  // already settled to what arrived)
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 400, startUsd: 120 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const timers: { fn: () => void; ms: number }[] = [];
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: (fn, ms) => { timers.push({ fn, ms }); return () => undefined; } });
  f.start();
  await settle(); await f.refresh();
  const promised = f.snapshot().takeableUsd;
  assert.equal(promised, 120);
  const row = await f.takeOut("all");
  // once sent, the row says what reaches the Safe (the mock's 2 % fee off), the figure the ledger records when it lands
  // (review, 1 Nov: one Put away read $481.06 here and $355.50 in the ledger)
  assert.equal(row.usd, Math.round(promised * 0.98 * 100) / 100, "the row says what arrives, as the ledger will");
  const follow = timers.find((t) => t.ms === FOLLOW_MS)!;
  for (let i = 0; i < 40 && !f.snapshot().moves.some((m) => m.kind === "home" && m.status === "done"); i++) { follow.fn(); await settle(); }
  const s = f.snapshot();
  assert.deepEqual(s.moves.filter((m) => m.kind === "home").map((m) => [m.status, m.where]), [["done", "main"]]);
  assert.equal(s.totalUsd, 0);
});

test("a total read right after a Take out lands (Wallet's \"in all\") doesn't still count it on its way: the refresh asks where the move is", async () => {
  // the move takes 400 ms of real time, past the Take out's own return (10 ms raced it under the full suite's load)
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 400, startUsd: 80 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const f = createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  await f.takeOut("all");                                                 // asked: on its way
  assert.equal(f.snapshot().totalUsd, 78.4, "on its way, still Trading's: what will arrive (the 2 % fee off)");
  await new Promise((r) => setTimeout(r, 600));                           // the mock lands it (main credited); no tick, no round
  await f.refresh();
  assert.equal(f.snapshot().totalUsd, 0, "landed: counted once, in main");
});

test("the float's count shows an Add before the ledger says it landed: counted once, never a number the float doesn't hold", async () => {
  let credited = 0;
  const call: CoreFloatDeps["call"] = async (method) => {
    if (method === "ledger.toTrading") return { id: "mv-x", status: "moving" };      // the ledger: still on its way
    if (method === "subwallet.create") return { id: "sw-trade-near" };              // Trading's balance wallet, before the Add
    if (method === "subwallet.float.balance") return { tokens: [], usd: credited, asOfIso: new Date(0).toISOString() };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    if (method === "subwallet.float.moves") return [];
    throw new Error("unexpected " + method);
  };
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  await f.add(15);
  await f.refresh();
  assert.equal(f.snapshot().totalUsd, 15, "on its way: counted");
  credited = 15;                                                         // the float's count has it; the ledger hasn't said
  await f.refresh();
  assert.equal(f.snapshot().totalUsd, 15, "in the float now: counted once, not $30");
  assert.equal(f.snapshot().loaded, true);
});

test("a move that lands between the balance read and the status check is counted where it arrived at once: no gap", async () => {
  let onChain = 0, status: "pending" | "done" = "pending";
  const call: CoreFloatDeps["call"] = async (method) => {
    if (method === "subwallet.float.balance") return { tokens: [], usd: 60 - (status === "done" || onChain ? 40 : 0), asOfIso: new Date(0).toISOString() };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    if (method === "subwallet.create") return { id: "sw-trade-sol" };              // the chain's wallet, made before its first move
    if (method === "subwallet.float.out") return { id: "fm-1", status: "pending" };
    if (method === "subwallet.float.move") { onChain = 40; status = "done"; return { id: "fm-1", status }; }   // lands as it's asked
    throw new Error("unexpected " + method);
  };
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: onChain, coinsUsd: 0 }], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  await f.moveNow("sol", 40);                                            // its own refresh sees it land mid-read
  const s = f.snapshot();
  assert.equal(s.chains[0]!.nativeUsd, 40, "on Solana the moment it lands");
  assert.equal(s.totalUsd, 60, "counted once");
});

test("a finished Take out's row says what reached the main balance (the core's expected amount), the figure Wallet shows", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 50 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  await f.takeOut("all");
  await settle(); await f.refresh();
  assert.deepEqual(f.snapshot().moves.filter((m) => m.kind === "home").map((m) => [m.status, m.usd]), [["done", 49]], "$50 sent, $49 arrived (the mock's 2 %)");
});

test("while a Take out brings everything home, the planner sends nothing out to the chains, even a round that began before it", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 40, startUsd: 200 } });
  const outs: string[] = [];
  // a gate on the planner's balance read: the round is held mid-plan while the Take out starts, then let go
  let hold: Promise<void> | undefined, release = () => {};
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.out") outs.push(String(params.chain));
    if (method === "subwallet.float.limits" && hold) await hold;
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) { const r = await mock.call<any>("subwallet.create", { kind: "trade", chain }); assert.ok("ok" in r); }
  let t = 0;
  // Spending in use (a Top up was made before): rounds may plan
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: () => bridgeWallets(call, async () => 100), get: async (k) => (k === "float.split.v1" ? true : undefined), set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  f.start();
  await settle();
  hold = new Promise<void>((r) => { release = r; });
  const planning = f.traded("sol");                                     // a round starts and waits in its read…
  await settle();
  hold = undefined;
  const leaving = f.takeOut("all");                                     // …a Take out begins meanwhile…
  await settle();
  release();                                                            // …then the round goes on to plan
  await planning; await leaving;
  t += PRIVATE.delayMs[1] + 1;
  for (let i = 0; i < 4; i++) { await f.traded("sol").catch(() => undefined); await settle(); }
  assert.deepEqual(outs, [], "nothing went out to a chain during the Take out");
  const s = f.snapshot();
  assert.ok(s.moves.some((m) => m.kind === "home"), JSON.stringify(s.moves.map((m) => [m.kind, m.status])));
  assert.ok(!s.moves.some((m) => m.kind === "out"), "no move out was even planned");
});

test("Take out Some uses the reserve first and brings back from the chains only what's short, so nothing goes back out after", async () => {
  const sent: string[] = [];
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 30 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.in") sent.push(`in:${params.chain}:${params.amount}`); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 80, coinsUsd: 0 }, { id: "sw-trade-hood", chain: "hood", current: true, nativeUsd: 40, coinsUsd: 0 }], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  await f.takeOut(20);                                                    // the reserve's $30 covers it
  assert.deepEqual(sent, [], "nothing pulled back from a chain");
  await f.takeOut(50);                                                    // $30 from the reserve, the $20 short from the biggest chain
  assert.equal(sent.length, 1);
  assert.match(sent[0]!, /^in:sol:\d+$/, "only Solana, and not \"all\"");
});

test("gas first: a wallet holding coins that can't pay to sell them gets $2.10 from the reserve (room over the fee guard's $2: AUD-TRD-2), to that very wallet, within 20-45 s; none if the reserve can't pay", async () => {
  const planned: { chain: string; to: string; amount: string }[] = [];
  const mk = (reserveUsd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: reserveUsd } });
    const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.out") planned.push({ chain: String(params.chain), to: String(params.to), amount: String(params.amount) }); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
    return { mock, call };
  };
  let t = 0;
  const { mock, call } = mk(50);
  for (const slot of [0, 1]) { const r = await mock.call<any>("subwallet.create", { kind: "trade", chain: "sol", slot }); assert.ok("ok" in r); }
  // Solana's slot 1 holds $30 of a coin and $0.20 of SOL: it couldn't pay a sale's fee
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 0, coinsUsd: 0 }, { id: "sw-trade-sol-1", chain: "sol", current: false, nativeUsd: 0.2, coinsUsd: 30 }], get: async () => undefined, set: async () => {}, now: () => t, every: () => () => undefined, rng: () => 0.5 });
  await f.traded("sol");
  const gas = f.snapshot().moves.filter((m) => m.kind === "out");
  assert.deepEqual(gas.map((m) => [m.chain, m.usd, m.status]), [["sol", 2.1, "waiting"]]);
  assert.ok(gas[0]!.at >= 20_000 && gas[0]!.at <= 45_000, `${gas[0]!.at}`);
  t = 46_000;
  await f.traded("sol");
  assert.deepEqual(planned.map((p) => [p.chain, p.to]), [["sol", "sw-trade-sol-1"]], "to the wallet that holds the coin (an older one), not the current one");
  // a reserve under $2: nothing planned (the Buy sheet's Move more / Add is the way)
  planned.length = 0;
  const poor = mk(1);
  const g = createCoreFloat({ call: poor.call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 0.2, coinsUsd: 30 }], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
  await g.traded("sol");
  assert.deepEqual(g.snapshot().moves.filter((m) => m.kind === "out"), []);
});

test("security review 2 Nov (Low): no gas to an older wallet whose key was shown, as to a replaced words' one; the current one, its key shown, still gets it (D56)", async () => {
  const run = async (ws: { id: string; current: boolean; keyExported?: boolean; oldWords?: boolean; nativeUsd: number; coinsUsd: number }[]) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 50 } });
    const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
    for (const slot of [0, 1]) await call("subwallet.create", { kind: "trade", chain: "sol", slot });
    const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => ws.map((w) => ({ ...w, chain: "sol" as const })), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
    await f.traded("sol");
    return f.snapshot().moves.filter((m) => m.kind === "out").map((m) => m.wallet ?? "current");
  };
  const holder = { id: "sw-trade-sol-1", current: false, nativeUsd: 0.2, coinsUsd: 30 };
  const full = { id: "sw-trade-sol", current: true, nativeUsd: 50, coinsUsd: 0 };
  assert.equal((await run([full, holder])).length, 1, "the control: an older wallet holding a coin gets its gas");
  assert.deepEqual(await run([full, { ...holder, keyExported: true }]), [], "its key shown: none");
  assert.deepEqual(await run([full, { ...holder, oldWords: true }]), [], "replaced words: none, as before");
  assert.equal((await run([{ id: "sw-trade-sol", current: true, keyExported: true, nativeUsd: 0.2, coinsUsd: 30 }])).length, 1, "D56: the current one, its key shown, gets its gas");
});

test("a wallet made from replaced backup words (subwallet.list oldWords, Security 39119dc) says so on its view; the others don't", async () => {
  const call = (async (method: string) => {
    if (method === "subwallet.list") return [{ id: "w0", kind: "trade", chain: "sol", address: "SoLOld11111111111111111111111111111111111", oldWords: true, current: false }, { id: "w1", kind: "trade", chain: "sol", address: "SoLNew11111111111111111111111111111111111", current: true }];
    if (method === "subwallet.balances") return [{ token: "native", decimals: 9, amount: "100000000" }];
    return {};
  }) as CoreFloatDeps["call"];
  const ws = await bridgeWallets(call, async () => 150);
  assert.deepEqual(ws.map((w) => [w.id, w.current, !!w.oldWords]), [["w0", false, true], ["w1", true, false]]);
  const f = createCoreFloat({ call: async (m) => (m === "subwallet.float.balance" ? { usd: 0 } : m === "subwallet.float.limits" ? { movesLeftToday: 20 } : []) as never, nativeUsd: async () => 150, wallets: async () => ws, get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  const sol = f.snapshot().chains.find((c) => c.chain === "sol")!;
  assert.deepEqual(sol.wallets.map((w) => [w.id, w.current, w.oldWords ?? false]), [["w0", false, true], ["w1", true, false]], "replaced words' wallet: an older one (D55)");
});

test("audit 2 Nov: a wallet that holds its coin while there is no price is no figure, never $0; Spending keeps the wallets it last read", async () => {
  let held = "100000000";                                              // 0.1 SOL
  const call = (async (method: string) => {
    if (method === "subwallet.list") return [{ id: "w0", kind: "trade", chain: "sol", slot: 0, address: "SoLOld11111111111111111111111111111111111" }];
    if (method === "subwallet.balances") return [{ token: "native", decimals: 9, amount: held }];
    if (method === "subwallet.float.balance") return { usd: 0 };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    return [];
  }) as CoreFloatDeps["call"];
  let price: number | null = 150;
  const nativeUsd = async () => { if (price === null) throw new Error("CoinGecko and GeckoTerminal both down"); return price; };
  await assert.doesNotReject(bridgeWallets(call, nativeUsd));
  const f = createCoreFloat({ call, nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.nativeUsd, 15);
  price = null;
  assert.equal((await bridgeWallets(call, nativeUsd))[0]!.unread, true, "no price: that wallet is unread, never $0");
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.nativeUsd, 15, "the last figure stands, not $0");
  assert.equal(f.snapshot().totalUsd, 15);
  // an empty wallet needs no price to be worth $0
  held = "0";
  assert.equal((await bridgeWallets(call, nativeUsd))[0]!.nativeUsd, 0);
});

test("journey 6: an app closed mid-Add lists it again when it opens, and an Add that finished meanwhile settles once (the ledger's record)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const store = new Map<string, unknown>();
  const make = () => createCoreFloat({ call, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); }, now: () => Date.now(), every: () => () => undefined });
  const first = make();
  await first.refresh();
  const r = await first.add(40);
  assert.ok(r !== "declined");
  await settle();
  // the app goes away here (its events are no longer heard) and comes back: a new float on the same device store
  const again = make();
  await again.refresh(); await settle(); await again.refresh();
  const rows = again.snapshot().moves.filter((m) => m.kind === "add");
  assert.deepEqual(rows.map((m) => [m.id, m.usd]), [[r.id, 40]], "the Add is listed again, once");
  assert.equal(rows[0]!.status, "done", "the ledger says it finished: done, not stuck on its way");
  assert.ok(Math.abs(again.snapshot().totalUsd - 40 * 0.98) < 1, `${again.snapshot().totalUsd}`);
});

test("an Add paid with another main-balance coin asks the ledger for that much of it (tokenId), USDC as before (Security fd3620a)", async () => {
  const asked: Record<string, unknown>[] = [];
  const call = (async (method: string, params: Record<string, unknown>) => {
    if (method === "ledger.toTrading") { asked.push(params); return { id: `mv-${asked.length}`, status: "moving" }; }
    if (method === "subwallet.float.balance") return { usd: 0 };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    return [];
  }) as CoreFloatDeps["call"];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  const near = await f.add(25, { tokenId: "nep141:wrap.near", amount: "5.643349", symbol: "NEAR" });
  await f.add(10);
  assert.deepEqual(asked, [
    { amount: "5.643349", tokenId: "nep141:wrap.near", label: "Move 5.643349 NEAR to your NEAR wallet" },
    { amount: "10.00", label: "Move $10.00 to your NEAR wallet" },
  ]);
  assert.ok(near !== "declined" && near.usd === 25, "the row says what it's worth in dollars");
});

test("D146: an Add Spending was asked for by another app names that app to the ledger (`for`), so the Safe's sheet is that app's; Trade's own names none (control)", async () => {
  const asked: Record<string, unknown>[] = [];
  const call = (async (method: string, params: Record<string, unknown>) => {
    if (method === "ledger.toTrading") { asked.push(params); return { id: `mv-${asked.length}`, status: "moving" }; }
    if (method === "subwallet.float.balance") return { usd: 0 };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    return [];
  }) as CoreFloatDeps["call"];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.add(10, undefined, undefined, undefined, undefined, "browser");
  await f.add(10);
  assert.equal(asked[0]!.for, "browser");
  assert.equal("for" in asked[1]!, false, "control: Trade's own Add names no other app");
});

test("H04: by default BNB is not offered: not in the total, Take out or the planner, and its wallet can't be moved, said before anything is asked", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 100 } });
  const asked: string[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => { asked.push(method); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const wallets = async () => [{ id: "sw-trade-sol", chain: "sol" as const, current: true, nativeUsd: 50, coinsUsd: 0 }, { id: "sw-trade-bsc", chain: "bsc" as const, current: true, nativeUsd: 30, coinsUsd: 5 }];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets, get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
  await f.refresh();
  const s = f.snapshot();
  assert.equal(s.totalUsd, 150, "$100 reserve + $50 on Solana; BNB's $35 is not counted");
  assert.equal(s.takeableUsd, 150);
  assert.equal(s.chains.find((c) => c.chain === "bsc")!.closed, true, "listed as closed (Trading wallets says it plainly)");
  assert.equal(s.chains.find((c) => c.chain === "bsc")!.nativeUsd, 30, "its money is still shown where it is, never hidden");
  asked.length = 0;
});

test("H44: an Add under $2 is refused before any call to the core or the ledger (so before any Face ID)", async () => {
  const calls: string[] = [];
  const call = (async (method: string) => { calls.push(method); return method === "subwallet.float.balance" ? { usd: 0 } : []; }) as CoreFloatDeps["call"];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  calls.length = 0;
  await assert.rejects(f.add(1.99), (e: any) => e?.problem?.code === "trade.float.add-small");
  await assert.rejects(f.add(1.5, { tokenId: "nep141:wrap.near", amount: "0.3", symbol: "NEAR" }), (e: any) => e?.problem?.code === "trade.float.add-small");
  await assert.rejects(f.add(Number.NaN), (e: any) => e?.problem?.code === "trade.float.add-small");
  assert.deepEqual(calls, [], "nothing was asked of the core");
});

test("Trading's own balance wallet (trade/near) is made before its first Add, once; nothing else makes it (UI, 28 Oct)", async () => {
  const order: string[] = [];
  const call = (async (method: string, params: Record<string, unknown>) => {
    if (method === "subwallet.create") { order.push(`create:${params.kind}/${params.chain}`); return { id: "sw-trade-near" }; }
    if (method === "ledger.toTrading") { order.push("toTrading"); return { id: `mv-${order.length}`, status: "moving" }; }
    if (method === "subwallet.float.balance") return { usd: 0 };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20 };
    return [];
  }) as CoreFloatDeps["call"];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.add(15); await f.add(10);
  assert.deepEqual(order, ["create:trade/near", "toTrading", "toTrading"]);
});

test("re-walk.3: \"Move $8 more\" with $8.06 in the reserve goes (capped to leave its fee), never refused for want of the fee", async () => {
  const { f } = await setup(8.06);
  await f.refresh();
  const r = await f.moveNow("sol", 8);
  assert.ok(r.usd <= 8.06 / 1.02, `asked $${r.usd} of $8.06`);
  for (let i = 0; i < 6; i++) { await settle(); await f.refresh(); }
  const m = f.snapshot().moves.find((x) => x.id === r.id)!;
  assert.notEqual(m.status, "failed", JSON.stringify(m));
  assert.equal(m.status, "done");
});

test("re-walk.2: a chain the core doesn't move money to yet is closed; one refusal teaches it too", async () => {
  const outs: string[] = [];
  let open: string[] | undefined = ["sol", "hood"];
  const call = (async (method: string, params: Record<string, unknown>) => {
    if (method === "subwallet.float.balance") return { usd: 100 };
    if (method === "subwallet.float.limits") return { movesLeftToday: 20, ...(open ? { open } : {}) };
    if (method === "subwallet.float.out") {
      outs.push(String(params.chain));
      if (params.chain === "bsc") throw new ProblemError({ code: "security.subwallet.refused", whatHappened: "Moves to and from BNB Chain open after their own test.", money: { state: "safe", where: "in Trading" }, next: { kind: "nothing", label: "OK" } });
      return { id: `m-${outs.length}`, kind: "out", chain: params.chain, status: "pending" };
    }
    return [];
  }) as CoreFloatDeps["call"];
  const mk = () => createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => (["sol", "hood", "bsc"] as const).map((chain) => ({ id: `sw-trade-${chain}`, chain, current: true, nativeUsd: 0, coinsUsd: 0 })), get: async (k) => (k === "float.split.v1" ? { sol: 40, hood: 25, bsc: 25, reserve: 10 } : undefined), set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5, rules: () => ({ jitter: 0, delayMs: [0, 0], firstFundingMs: [0, 0] }) });
  // the core says which chains are open: BNB is closed, and nothing goes anywhere by itself (D102)
  const a = mk(); a.start(); await settle(); await a.traded("sol"); await settle();
  assert.deepEqual(outs, [], "D102: no move out by itself");
  const bsc = a.snapshot().chains.find((c) => c.chain === "bsc")!;
  assert.equal(bsc.closed, true);
  assert.equal(bsc.targetUsd, 0);
  // no open list from the core: the person's move to BNB is refused once, and that teaches it
  open = undefined; outs.length = 0;
  const b = mk(); b.start(); await settle();
  await b.moveNow("bsc", 10).catch(() => undefined); await settle(); await b.traded("sol"); await settle(); await b.traded("sol"); await settle();
  assert.ok(outs.filter((c) => c === "bsc").length <= 1, `BNB asked ${outs.filter((c) => c === "bsc").length} times`);
  assert.equal(b.snapshot().chains.find((c) => c.chain === "bsc")!.closed, true);
});

test("AUD-TRD-6: a move in that ended counts what 1Click says settled, else its guaranteed minimum; one still open counts nothing", () => {
  const usdc = (n: number) => String(Math.round(n * 1e6));
  assert.equal(moveAnswer({ id: "a", kind: "in", status: "done", expected: { tokenId: "usdc", amount: usdc(9.7) }, settled: { amountOut: usdc(9.85) } }).arrivedUsd, 9.85, "what settled (Security 8e67e16)");
  assert.equal(moveAnswer({ id: "b", kind: "in", status: "done", expected: { tokenId: "usdc", amount: usdc(9.7) } }).arrivedUsd, 9.7, "a core before it: the minimum");
  assert.equal(moveAnswer({ id: "c", kind: "in", status: "pending", expected: { tokenId: "usdc", amount: usdc(9.7) } }).arrivedUsd, undefined);
  assert.equal(moveAnswer({ id: "d", kind: "out", status: "done", expected: { tokenId: "sol", amount: "100000000" }, settled: { amountOut: "100000000" } }).arrivedUsd, undefined, "a move out lands the chain's coin, not dollars");
  assert.equal(moveAnswer({ id: "e", kind: "in", status: "done", expected: { tokenId: "usdc", amount: "0" } }).arrivedUsd, undefined, "never a $0 move home");
});

test("a sale's own fee (the sheet's Move now with a wallet) goes to the wallet that sells, an older one included; without one, the current wallet", async () => {
  const sent: [string, string][] = [];
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 50 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.out") sent.push([String(params.chain), String(params.to)]); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const slot of [0, 1]) { const r = await mock.call<any>("subwallet.create", { kind: "trade", chain: "sol", slot }); assert.ok("ok" in r); }
  // slot 0 is the current wallet; slot 1, an older one, still holds the coin being sold
  const timers: (() => void)[] = [];
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 5, coinsUsd: 0 }, { id: "sw-trade-sol-1", chain: "sol", current: false, nativeUsd: 0, coinsUsd: 30 }], get: async () => undefined, set: async () => {}, now: () => 0, every: (fn) => { timers.push(fn); return () => undefined; } });
  f.start(); await settle();
  await f.moveNow("sol", 2.1, { wallet: "sw-trade-sol-1" });
  await new Promise((r) => setTimeout(r, 40));                                    // one move at a time on a chain: the first lands
  await f.moveNow("sol", 2.1);
  for (const t of timers) t();                                                    // the next round asks it
  await settle();
  assert.deepEqual(sent.slice(-2), [["sol", "sw-trade-sol-1"], ["sol", "sw-trade-sol"]]);
});

test("AUD-TRD-7: Move more now during a Take out is refused in words (it would send the money straight back out); a sale's own fee still goes", async () => {
  const outs: string[] = [];
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 40, startUsd: 100 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { if (method === "subwallet.float.out") outs.push(String(params.to)); const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  const r0 = await mock.call<any>("subwallet.create", { kind: "trade", chain: "sol" }); assert.ok("ok" in r0);
  const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [{ id: "sw-trade-sol", chain: "sol", current: true, nativeUsd: 0, coinsUsd: 30 }], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  void f.takeOut("all");
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.moveNow("sol", 20), (e: unknown) => e instanceof ProblemError && e.problem.code === "trade.float.taking-out");
  assert.deepEqual(outs, [], "nothing went out");
  const fee = await f.moveNow("sol", 2.1, { wallet: "sw-trade-sol" }).catch((e: unknown) => e);
  assert.ok(!(fee instanceof ProblemError && fee.problem.code === "trade.float.taking-out"), "a sale's own fee isn't refused for the Take out");
});

// Re-walk.1: Take out said "There's nothing in Trading to take out" beside $1.00 in Trading (under the core's $2 floor).
test("Take out under the $2 floor says what is there and when it goes, never 'nothing'; truly nothing is still 'nothing'", async () => {
  const at = async (startUsd: number) => {
    const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd } });
    const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
    const f = createCoreFloat({ call, nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
    await f.refresh();
    return f.takeOut("all").then(() => undefined, (e: unknown) => (e instanceof ProblemError ? e.problem : undefined));
  };
  const one = await at(1);
  assert.equal(one?.code, "trade.float.under-floor");
  assert.equal(one?.whatHappened, "$1.00 is too little to move on its own.");
  assert.equal(one?.more, "Under $2, it goes back to your Safe with your next move.");
  assert.equal((await at(0))?.code, "trade.float.nothing-to-take-out");
});

// Re-walk, 10.3: after "Move $9 more to Robinhood" the planner pulled $4.97 back within 30 s, the Buy sheet still open.
test("D102: a person's money on a network is never pulled back by itself: not after 15 minutes, a trade there, or a Buy sheet closing", async () => {
  const { model, PX } = await import("./audit/float/model.ts");
  const world = async () => {
    const clock = { t: 1_800_000_000_000 };
    const md = model(clock);
    md.m.float = 20; md.m.added = 220; md.m.wallets.get("sol:0")!.usd = 200;       // Solana far over what a split would give it
    const timers: (() => void)[] = [];
    const store = new Map<string, unknown>();
    const f = createCoreFloat({ call: md.call as never, wallets: md.wallets, nativeUsd: async (c) => PX[c], get: async (k) => store.get(k), set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))), now: () => clock.t, every: (fn) => { timers.push(fn); return () => undefined; }, rng: () => 0.5 });
    store.set("float.split.v1", true);                                // Spending in use: rounds may plan
    const start = async () => { f.start(); await settle(); };
    const ins = () => [...md.m.moves.values()].filter((x) => x.kind === "in" && x.chain === "sol").length;
    const pass = async (ms: number) => { clock.t += ms; for (const t of timers) t(); await settle(); };
    return { f, ins, pass, start };
  };
  const a = await world();
  await a.f.moveNow("sol", 5); await a.start();
  for (let i = 0; i < 6; i++) await a.pass(120_000);
  assert.equal(a.ins(), 0, "held for 15 minutes");
  await a.f.traded("sol");
  for (let i = 0; i < 6; i++) await a.pass(120_000);
  assert.equal(a.ins(), 0, "after a trade there, still where the person put it");
  const b = await world();
  const release = b.f.keep("sol"); await b.start();
  for (let i = 0; i < 4; i++) await b.pass(120_000);
  assert.equal(b.ins(), 0, "nothing pulled back while the sheet is open");
  release();
  for (let i = 0; i < 6; i++) await b.pass(120_000);
  assert.equal(b.ins(), 0, "closed: still where the person put it");
});

// Audit F-1: a float restored into a new browser starts from 1Click's own count; with 1Click not answering, the core says
// "unread". The snapshot says so (the screens: "Your Trading balance can't be read right now"), never $0, never empty.
test("F-1: a float the core can't read says it can't be read, never $0; once a read lands, the figure", async () => {
  let reply: Record<string, unknown> = { tokens: [], usd: 0, asOfIso: new Date(0).toISOString(), unread: true };
  const call = (async (m: string) => (m === "subwallet.float.balance" ? reply : m === "subwallet.float.limits" ? { movesLeftToday: 20 } : [])) as CoreFloatDeps["call"];
  const f = createCoreFloat({ call, nativeUsd: async () => 150, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  assert.equal(f.snapshot().unread, true);
  assert.equal(f.snapshot().loaded, false, "not a figure: nothing reads it as empty");
  reply = { tokens: [], usd: 42, asOfIso: new Date(0).toISOString() };
  await f.refresh();
  assert.equal(f.snapshot().unread, undefined);
  assert.equal(f.snapshot().totalUsd, 42);
  // a later failed read keeps the last figure (fix review RT-7), and doesn't say "unread"
  reply = { tokens: [], usd: 0, unread: true };
  await f.refresh();
  assert.deepEqual([f.snapshot().unread, f.snapshot().totalUsd], [undefined, 42]);
});

test("F-1: Home and Take out say the float can't be read, in the one set of words", async () => {
  const { readFileSync } = await import("node:fs");
  const { UNREAD_WORDS } = await import("./float-view.ts");
  assert.equal(UNREAD_WORDS, "Your NEAR wallet didn't load right now");
  for (const f of ["Home.tsx", "AddTakeOut.tsx"]) assert.match(readFileSync(new URL(`./app/screens/${f}`, import.meta.url), "utf8"), /snap\.unread[\s\S]{0,200}UNREAD_WORDS/, f);
});

test("a Top up on a fresh account (no trading wallet made yet, Trade never opened): the person's move to Robinhood makes its wallet and fills it", async () => {
  const { f, call, later } = await setup(0, false);
  const before = (await call<any[]>("subwallet.list", { kind: "trade" })).filter((w) => w.chain === "hood");
  assert.equal(before.length, 0, "control: no Robinhood Chain trading wallet yet (the sample has Solana's)");
  const stop = f.start();
  assert.notEqual(await f.add(1000), "declined");
  await settle();
  await f.refresh();
  await f.moveNow("hood", 250);
  for (let i = 0; i < 4; i++) { later(10 * 60_000); await f.traded("sol").catch(() => undefined); await settle(); await f.refresh(); }
  const failed = f.snapshot().moves.filter((m) => m.kind === "out" && m.status === "failed");
  assert.deepEqual(failed, [], "no move out failed");
  const hood = f.snapshot().chains.find((c) => c.chain === "hood") as any;
  assert.ok(hood && hood.nativeUsd > 200, `Robinhood Chain got what was moved (${JSON.stringify(hood)})`);
  stop();
});

test("a Top up that ends other than done says where its money is, never a bare failed (mainnet 2 Nov, m-refund: 1Click refunded a late $3 into Spending's cash and the row said failed with no words)", async () => {
  // the core's own answers (MockBridge), but the Add is the ledger's: it goes on its way, and its end comes as the
  // ledger's movementUpdated, as on mainnet (ledger.ts trackQuote: REFUNDED → "refunded", FAILED → "problem")
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0 } });
  const heard = new Map<string, (p: any) => void>();
  let n = 0;
  const kept: any[] = [];
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "ledger.toTrading") return { id: `trading:tx${++n}`, status: "moving" } as never;
    if (method === "ledger.activity") return kept as never;
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  const store = new Map<string, unknown>();
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const make = () => createCoreFloat({
    offered: () => true, call, on: (e, h) => { heard.set(e, h); return () => undefined; }, nativeUsd, wallets: () => bridgeWallets(call, nativeUsd),
    get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); }, now: () => 1_000_000, every: () => () => undefined, rng: () => 0.5,
  });
  const f = make();
  const end = (id: string, movement: Record<string, unknown>) => heard.get("ledger.movementUpdated")!({ movement: { id, ...movement } });
  const row = (id: string) => f.snapshot().moves.find((m) => m.id === id)!;
  const a = await f.add(3) as any, b = await f.add(3) as any, c = await f.add(3) as any, e = await f.add(3) as any;
  assert.deepEqual([a.status, b.status, c.status, e.status], ["moving", "moving", "moving", "moving"], "control: each on its way first");
  end(a.id, { status: "refunded", depositAddress: "1".repeat(64) });
  end(b.id, { status: "problem", problem: { code: "ledger.convert.failed" }, depositAddress: "2".repeat(64) });
  end(c.id, { status: "problem", problem: { code: "ledger.send.failed" } });
  end(e.id, { status: "problem", problem: { code: "ledger.hold.cancelled" } });
  await settle();
  assert.deepEqual([row(a.id).status, row(a.id).where], ["refunded", "reserve"], "1Click's refund is in Trading's cash (the Add quote's refund address), not the Safe");
  assert.match(row(a.id).note!, /sent it back to your NEAR wallet/);
  assert.deepEqual([row(b.id).status, row(b.id).where], ["failed", "in-flight"]);
  assert.equal(row(b.id).note, "NEAR Intents didn't finish this. It's either in your NEAR wallet or still with NEAR Intents.", "where to look, never a promise");
  assert.deepEqual([row(c.id).status, row(c.id).stayed, row(c.id).note], ["failed", true, "It didn't go through, so the money never left your Safe"]);
  assert.deepEqual([row(e.id).status, row(e.id).stayed], ["failed", true]);
  assert.match(row(e.id).note!, /stayed in your Safe/);
  // and through Spending (packages/core spending.ts), as Activity reads it
  const { createSpendingService } = await import("@zerofee/core/spending");
  const svc = createSpendingService({ engine: () => f as never, call: async (m: string) => (m === "device.store.get" ? { value: null } : { ok: true }) as never });
  const rows = await svc.call<any[]>("spending.activity", {});
  assert.ok("ok" in rows);
  const byId = new Map(rows.ok.map((r: any) => [r.id, r]));
  assert.deepEqual([byId.get(a.id).status, byId.get(b.id).status, byId.get(c.id).status, byId.get(e.id).status], ["refunded", "failed", "refused", "refused"]);
  for (const id of [a.id, b.id, c.id, e.id]) assert.ok((byId.get(id).note ?? "").length > 10, `${id} says where its money is`);

  // a row kept on the phone before this fix ("failed", no words) is read against the ledger again on the next start
  store.set("float.adds.v1", [{ r: { id: "trading:old", kind: "add", usd: 3, status: "failed", where: "main", at: 999_000 }, base: 0 }]);
  kept.push({ id: "trading:old", status: "refunded", depositAddress: "6".repeat(64) });
  const g = make();
  await g.refresh();
  const old = g.snapshot().moves.find((m) => m.id === "trading:old")!;
  assert.deepEqual([old.status, old.where], ["refunded", "reserve"]);
  assert.match(old.note!, /back to your NEAR wallet/);
});

test("Social trading's Add: a Top up for a site's own wallet goes on to that wallet the moment it is in Trading (D137: no gap, no trim), within what the reserve holds, once, and the planner spreads nothing first", async () => {
  const { f, call, store, later } = await setup();
  const site = await call<{ id: string }>("subwallet.create", { kind: "site", chain: "sol", siteId: "pump" });
  const stop = f.start();
  const r = await f.add(10, undefined, { wallet: site.id, name: "pump.fun" });
  assert.notEqual(r, "declined");
  await settle();
  await f.refresh(); await f.refresh();                                     // D137: landed, so it goes on now
  void later;
  const s = f.snapshot();
  const add = s.moves.find((m) => m.kind === "add")!;
  assert.deepEqual([add.status, add.ready?.wallet, add.ready?.sent], ["done", site.id, true]);
  const out = s.moves.filter((m) => m.kind === "out");
  assert.deepEqual(out.map((m) => [m.chain, m.why, m.wallet]), [["sol", "ready", site.id]], "one move, to the site's wallet, nothing spread by the planner first");
  assert.ok(out[0]!.usd < 10 && out[0]!.usd >= 9.5, `within what the reserve holds with the move's fee room: ${out[0]!.usd}`);
  // kept with the row: a restart reading it back never asks again
  assert.ok(JSON.stringify(store.get("float.adds.v1")).includes('"sent":true'));
  await f.refresh(); await f.traded("hood").catch(() => undefined);
  assert.equal(f.snapshot().moves.filter((m) => m.kind === "out" && m.wallet === site.id).length, 1, "once");
  // control: a plain Top up goes to no site's wallet
  await f.add(10); await settle(); await f.refresh();
  assert.equal(f.snapshot().moves.filter((m) => m.kind === "out" && m.wallet === site.id).length, 1);
  stop();
});

test("Home V4: each chain says its own coin as the chain has it (\"1.42\" SOL), every wallet summed, rounded down, through Spending's status", async () => {
  const { coinAmount } = await import("./float-core.ts");
  assert.equal(coinAmount(1_420_000_000n, 9), "1.42");
  assert.equal(coinAmount(12_000_000_000_000_000n, 18), "0.012");
  assert.equal(coinAmount(1n, 9), "0", "under a millionth: rounded down, never a digit it doesn't hold");
  assert.equal(coinAmount(0n, 18), "0");
  // §0 proof row: each chain read from its own wallet, never another's (Solana's SOL, Robinhood's ETH)
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, held: { "sw-trade-sol": "1420000000", "sw-trade-hood": "12000000000000000" } } });
  const call: CoreFloatDeps["call"] = async (m, p) => { const r = await mock.call<any>(m, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood"]) await call("subwallet.create", { kind: "trade", chain });
  const f = createCoreFloat({ offered: () => true, call, nativeUsd: async (c) => PX[c], wallets: () => bridgeWallets(call, async (c) => PX[c]), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });
  await f.refresh();
  const sol = f.snapshot().chains.find((c) => c.chain === "sol")!;
  assert.equal(sol.nativeAmount, "1.42");
  assert.equal(f.snapshot().chains.find((c) => c.chain === "hood")!.nativeAmount, "0.012", "Robinhood's from Robinhood's wallet");
  const { createSpendingService } = await import("@zerofee/core/spending");
  const svc = createSpendingService({ engine: () => f as never, call: async () => ({ value: null }) as never });
  const st = await svc.call<{ networks: { network: string; nativeAmount?: string }[]; reserveUsd?: string }>("spending.status", {});
  assert.ok("ok" in st);
  assert.equal(st.ok.networks.find((n) => n.network === "sol")!.nativeAmount, "1.42");
  assert.equal(st.ok.reserveUsd, "0.00", "the NEAR row's own figure: Trading's balance on NEAR, nothing on its way in it");
});

test("Home speed (3 Nov): refreshes asked at once share one run and ONE run behind it, which starts after the change a caller made; a screen's read joins the run under way", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0 } });
  let usd = 10, reads = 0;
  const call: CoreFloatDeps["call"] = async (method, params) => {
    if (method === "subwallet.float.balance") {
      reads++;
      const was = usd;                                                  // what the float held when the read began
      await new Promise((r) => setTimeout(r, 20));
      return { usd: was, asOfIso: new Date(0).toISOString() } as never;
    }
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok;
  };
  const f = createCoreFloat({ offered: () => true, call, nativeUsd: async (c) => PX[c], wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined, rng: () => 0.5 });
  const first = f.refresh();
  while (reads === 0) await new Promise((r) => setTimeout(r, 1));
  usd = 20;                                                             // money moved after the first read began
  const joined = f.refresh({ join: true });
  const behind = [f.refresh(), f.refresh(), f.refresh()];
  await joined;
  assert.equal(f.snapshot().reserveUsd, 10, "a screen's read joined the run under way: answered with its figure, never waiting for the run behind it");
  await Promise.all([first, ...behind]);
  assert.equal(reads, 2, "four refreshes asked during a run: one run behind it, not four");
  assert.equal(f.snapshot().reserveUsd, 20, "the run behind it began after the change, so its callers see it");
});

test("k-trade crawl (4 Nov): a wallet whose balance read fails is no figure, never $0; a read that answers is its figure (control)", async () => {
  const list = [{ id: "trade-sol-1", kind: "trade", chain: "sol", current: true, address: "So1" }];
  const failing = (async (m: string) => { if (m === "subwallet.list") return list; throw new Error("429"); }) as never;
  assert.deepEqual((await bridgeWallets(failing, async () => 150)).map((w) => [w.id, w.unread, w.nativeUsd]), [["trade-sol-1", true, 0]], "its own read failed: unread");
  const answering = (async (m: string) => (m === "subwallet.list" ? list : [{ token: "native", decimals: 9, amount: "25600000" }])) as never;
  const [w] = await bridgeWallets(answering, async () => 150);
  assert.equal(w!.nativeUsd, 3.84);
});

// A test run (4 Nov): Home said "SOL wallet $0.00" 40 s after load over a funded SOL wallet while Trade's
// header read it right: bridgeWallets read every wallet in one Promise.all, so one failed read (another chain's node, a
// price) failed them all, and the engine, with no wallets yet, counted each chain at $0.
const LIVE = [
  { id: "trade-sol", kind: "trade", chain: "sol", current: true, address: "4evu965G3hf2AxLWjBUh2SZ415VapgP8DnDiNUR1biVs" },
  { id: "trade-hood", kind: "trade", chain: "hood", current: true, address: "0x0000000000000000000000000000000000000001" },
];
const live = (o: { sol?: () => unknown; hood?: () => unknown; float?: () => unknown }) => (async (m: string, p: { id?: string }) => {
  if (m === "subwallet.list") return LIVE;
  if (m === "subwallet.balances") return (p.id === "trade-sol" ? o.sol : o.hood)?.() ?? [{ token: "native", decimals: 18, amount: "0" }];
  if (m === "subwallet.float.balance") return o.float ? o.float() : { usd: 0.11 };
  if (m === "subwallet.float.limits") return { movesLeftToday: 20 };
  return [];
}) as CoreFloatDeps["call"];
const SOL_BAL = () => [{ token: "native", decimals: 9, amount: "50000000" }];      // a sample balance: 0.05 SOL
const engine = (call: CoreFloatDeps["call"], px: (c: string) => Promise<number> = async (c) => (c === "sol" ? 97 : 3000)) =>
  createCoreFloat({ offered: () => true, call, nativeUsd: px as never, wallets: () => bridgeWallets(call, px as never), get: async () => undefined, set: async () => {}, now: () => 0, every: () => () => undefined });

test("QA (4 Nov): another chain's failed read never sinks the SOL figure: SOL is read, the failed chain is unread", async () => {
  const f = engine(live({ sol: SOL_BAL, hood: () => { throw new Error("Robinhood Chain's node: 429"); } }));
  await f.refresh();
  const sol = f.snapshot().chains.find((c) => c.chain === "sol")!, hood = f.snapshot().chains.find((c) => c.chain === "hood")!;
  assert.equal(sol.nativeUsd, 4.85);
  assert.equal(sol.unread, undefined);
  assert.equal(hood.unread, true, "its read failed and none came before: unread, never $0");
});

test("QA (4 Nov): a failed SOL read is unread, never $0.00, and a later failure keeps the last figure", async () => {
  let fail = true;
  const f = engine(live({ sol: () => { if (fail) throw new Error("both Solana nodes busy"); return SOL_BAL(); } }));
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.unread, true);
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.wallets.length, 0, "the planner never sees it as an empty wallet");
  fail = false;
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.nativeUsd, 4.85, "control: an answered read is its figure");
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.unread, undefined);
  fail = true;
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.nativeUsd, 4.85, "the last figure stands");
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.unread, undefined);
});

test("QA (4 Nov): the NEAR wallet's read failing (a 429 on NEAR) leaves SOL's figure read", async () => {
  const f = engine(live({ sol: SOL_BAL, float: () => { throw new Error("NEAR: 429"); } }));
  await f.refresh();
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.nativeUsd, 4.85);
  assert.equal(f.snapshot().chains.find((c) => c.chain === "sol")!.unread, undefined);
  assert.equal(f.snapshot().unread, true, "the NEAR wallet's own figure is the unread one");
});

test("QA (4 Nov): no wallets answer at all before the first read: every chain unread; the price failing is unread too", async () => {
  const none = engine((async (m: string) => { if (m === "subwallet.list") throw new Error("busy"); return m === "subwallet.float.balance" ? { usd: 0 } : { movesLeftToday: 20 }; }) as never);
  await none.refresh();
  assert.ok(none.snapshot().chains.every((c) => c.unread), "never read: unread, never $0");
  const nopx = engine(live({ sol: SOL_BAL }), async (c) => { if (c === "sol") throw new Error("CoinGecko 429"); return 3000; });
  await nopx.refresh();
  assert.equal(nopx.snapshot().chains.find((c) => c.chain === "sol")!.unread, true);
  assert.equal(nopx.snapshot().chains.find((c) => c.chain === "hood")!.unread, undefined, "an empty wallet needs no price");
});

test("the crawl (4 Nov, Trade's header $5.63 for 6 min over $7.60): after a trade the wallets are read again 3 s and 10 s later, once each (control: before those, no read)", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10, startUsd: 0 } });
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  await call("subwallet.create", { kind: "trade", chain: "sol" });
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  let reads = 0;
  const timers: { ms: number; fn: () => void; on: boolean }[] = [];
  const f = createCoreFloat({
    offered: () => true, call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => (reads++, bridgeWallets(call, nativeUsd)),
    get: async () => undefined, set: async () => {}, rng: () => 0.5, now: () => 1_000_000,
    every: (fn, ms) => { const t = { ms, fn, on: true }; timers.push(t); return () => { t.on = false; }; },
  });
  await f.traded("sol");
  await settle();
  const after = reads;
  const due = timers.filter((t) => t.on && AFTER_LANDING_MS.includes(t.ms));
  assert.deepEqual(due.map((t) => t.ms).sort((a, b) => a - b), [3_000, 10_000], "two reads set, 3 s and 10 s on");
  assert.equal(reads, after, "control: none before they are due");
  for (const t of due) { t.fn(); t.fn(); }
  await settle();
  assert.equal(reads, after + 2, "each read once, then stopped");
  assert.ok(due.every((t) => !t.on), "both timers stopped");
});
