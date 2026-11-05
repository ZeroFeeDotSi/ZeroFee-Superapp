// D140 (product decision, 3 Nov). A Move between
// the Safe and the wallets, on the real engine (trade float-core + core spending over the MockBridge) and Home's own
// reads (home-reads heldToFloor: one node never lowers the Safe; home-keep confirmDrop: a big drop waits for a second
// read; cross-count: each move counted once). Home's total stays at the same figure, less fees, at every step: the
// Safe's drop still held, the drop confirmed, the move on its way, the SOL wallet's read showing the money before the
// engine hears the move landed, and done. Controls: without cross-count the held Safe and the move add to $70; the
// wallet's early read is real (the move is still on its way while the SOL wallet holds it).
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingStatus } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";
import { heldToFloor } from "@zerofee/wallet/app/home-reads.ts";
import { confirmDrop } from "@zerofee/wallet/app/home-keep.ts";
import { countOnce, newCrossState } from "@zerofee/wallet/app/cross-count.ts";
import { tradingUsd } from "@zerofee/wallet/app/trading.ts";
import type { Balance } from "@zerofee/wallet/types.ts";

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
/**
 * No wall clock (land checks): the test's clock is node's mock timers. A pump turns them 5 ms per turn of the event loop
 * (setImmediate, left real), so the mock's own latency and its moves (moveMs) run in virtual time, in the same order
 * every run, however busy the machine is.
 */
function virtualClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-11-04T00:00:00Z") });
  let on = true;
  void (async () => { while (on) { t.mock.timers.tick(5); await new Promise((r) => setImmediate(r)); } })();
  return { stop: () => { on = false; }, wait: (ms: number) => new Promise((r) => setTimeout(r, ms)) };
}
const nativeUsd = async (c: keyof typeof PX) => PX[c];
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const safe = (usd: number, agreed = false): Balance[] => [{ tokenId: USDC, symbol: "USDC", name: "USD Coin", icon: "usdc", chain: "near", amount: usd.toFixed(2), usd: usd.toFixed(2), bridged: false, held: "ledger", listed: true, ...(agreed ? { agreed: true as const } : {}) }];
const usdOf = (rows: Balance[]) => rows.reduce((n, r) => n + Number(r.usd ?? 0), 0);

async function setup() {
  // the Safe's Add settles 2 s after its Approve, each move on 300 ms after it is sent (virtual time)
  const mock = createMockBridge({ latencyMs: 0, settleMs: 2000, float: { moveMs: 300 } });
  /** The move's status, as the engine asks it: held "pending" while `lag` is on (1Click says landed after the chain does). */
  const lag = { on: false, told: 0 };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params);
    if ("problem" in r) throw new ProblemError(r.problem);
    const late = (m: any) => (lag.on && m?.kind === "out" && m.status === "done" ? (lag.told++, { ...m, status: "pending", where: "in-flight", settled: undefined }) : m);
    if (method === "subwallet.float.move") return late(r.ok);
    if (method === "subwallet.float.moves") return (r.ok as any[]).map(late);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => Date.now(), every: () => () => undefined, rng: () => 0.5 });
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const status = async () => { const r = await svc.call<SpendingStatus>("spending.status", {}); assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
  return { f, svc, lag, status, now: () => Date.now() };
}

/** Home's total from the Safe it shows and the engine's status: with cross-count (Home), or without (the control). */
function home() {
  const cross = newCrossState();
  return (rows: Balance[], s: SpendingStatus, nowMs: number, once = true) => {
    const trading = tradingUsd(s, [], []).usd;
    const v = once ? countOnce({ balances: rows, spending: s, trading }, cross, nowMs) : { trading };
    return Math.round((usdOf(rows) + Number(v.trading)) * 100) / 100;
  };
}

test("D140: $30 moved from a $40 Safe to the SOL wallet: Home says ~$40 at every step, never $70 (control: without cross-count, the held Safe and the move on its way make $70)", async (t) => {
  const clock = virtualClock(t);
  t.after(() => clock.stop());
  const s = await setup();
  // one step of the engine as its follow takes it: a second of the network (the mock's 300 ms moves land), then a round
  const step = async () => { await clock.wait(1000); await s.f.traded("sol"); };
  const total = home(), control = home();
  const T0 = Number((await s.status()).totalUsd);
  const before = total(safe(40, true), await s.status(), s.now());
  assert.equal(before, 40 + T0);
  const floor = new Map(safe(40, true).map((r) => [`${r.tokenId}|${r.held}`, r]));

  // privacy audit (4 Nov): the $30 Move leaves the Safe on the inflow grid, $31, its rest hidden in the NEAR wallet
  const SENT = 31, LEFT = 40 - SENT;
  const r = await s.svc.call("spending.topUp", { usd: 30, legs: [{ network: "sol", usd: 30 }] });
  assert.ok("ok" in r, JSON.stringify(r));
  let st = await s.status();
  assert.ok(st.onItsWay.some((m) => m.kind === "top-up" && m.status === "on-its-way"), "the move is on its way");
  // one node already reads the Safe's $9: Home holds the Safe at $40 until two nodes agree (review H1)
  const held = heldToFloor(safe(LEFT), floor);
  assert.equal(held.heldBack, true);
  assert.equal(usdOf(held.rows), 40, "the Safe's drop is held");
  assert.equal(control(held.rows, st, s.now(), false), 40 + SENT + T0, "control: the old count, $71");
  assert.equal(total(held.rows, st, s.now()), 40 + T0, "counted once while the Safe's drop is held");
  // two nodes agree on $9: the drop still waits for a second read (confirmDrop), then shows
  const first = confirmDrop(safe(40, true), null, safe(LEFT, true), usdOf);
  assert.equal(usdOf(first.shown!), 40);
  assert.equal(total(first.shown!, st, s.now()), 40 + T0);
  const second = confirmDrop(first.shown, first.pending, safe(LEFT, true), usdOf);
  assert.equal(usdOf(second.shown!), LEFT);
  assert.equal(total(second.shown!, st, s.now()), 40 + T0, "the drop shown: the move counts on its way, once");

  // the engine runs the move: in the NEAR wallet, then on to SOL. 1Click is late to say the move out landed.
  s.lag.on = true;
  let early = false;
  for (let i = 0; i < 12; i++) {
    await step();
    st = await s.status();
    const now = total(safe(LEFT, true), st, s.now());
    assert.ok(now <= 40 + T0 + 0.01 && now >= 40 + T0 - 30 * 0.08, `step ${i}: $${now}, never a double or a dip (fees only)`);
    const sol = Number(st.networks.find((n) => n.network === "sol")?.cashUsd ?? 0);
    if (sol > 20 && s.lag.told > 0) {
      early = true;
      // D144: the move's row ends the moment the SOL wallet holds it, the same hand-off as the total
      assert.equal(st.onItsWay.length, 0, `step ${i}: the move is done where the money is, not "Arriving…"`);
    }
  }
  assert.ok(early, "control: the SOL wallet's read showed the money while 1Click still said the move out was on its way");
  s.lag.on = false;
  for (let i = 0; i < 4; i++) await step();
  st = await s.status();
  assert.equal(st.onItsWay.length, 0, "done");
  const after = total(safe(LEFT, true), st, s.now());
  assert.ok(after <= 40 + T0 + 0.01 && after >= 40 + T0 - 30 * 0.08, `after: $${after}`);
});

test("D140: $30 brought home from the wallets: the Safe shows it at once and the move home stops counting on its way (control: the old count adds both)", async () => {
  const total = home(), control = home();
  const now = 1_700_000_000_000;
  const at = new Date(now).toISOString();
  const base = (on: boolean): SpendingStatus => ({ loaded: true, totalUsd: on ? "30.00" : "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "470.00", ready: false, networks: [{ network: "sol", name: "Solana", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0.00" }, { network: "hood", name: "Robinhood Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0.00" }] as SpendingStatus["networks"], onItsWay: on ? [{ id: "home-1", kind: "put-away", usd: "30.00", status: "on-its-way", shown: true, atIso: at, words: "Putting away $30.00" }] : [], firstTopUp: false });
  assert.equal(total(safe(10, true), base(true), now), 40, "on its way: the Safe $10, the move $30");
  // the Safe's read has the $30 before the engine hears the move landed
  assert.equal(control(safe(39.4, true), base(true), now + 5000, false), 69.4, "control: the old count, ~$70");
  assert.equal(total(safe(39.4, true), base(true), now + 5000), 40, "counted once: what arrived in the Safe, and the fees until the move ends");
  assert.equal(total(safe(39.4, true), base(false), now + 9000), 39.4, "done");
});

test("D140: a move begun before Home saw it (the app reopened mid-move) is left as the engine counts it: never a dip (control: a fresh one is keyed)", () => {
  const total = home();
  const now = 1_700_000_000_000;
  const st = (atIso: string): SpendingStatus => ({ loaded: true, totalUsd: "30.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "470.00", ready: false, networks: [], onItsWay: [{ id: "add-1", kind: "top-up", usd: "30.00", status: "on-its-way", shown: true, atIso, words: "Moving $30.00 to your SOL wallet" }], firstTopUp: false });
  assert.equal(total(safe(10, true), st(new Date(now - 5 * 60_000).toISOString()), now), 40, "the Safe already shows it gone: $10 + $30");
  const fresh = home();
  assert.equal(fresh(safe(40, true), st(new Date(now).toISOString()), now), 40, "control: a fresh move out of a Safe still showing $40 counts once");
});

test("D140: a move out of the Safe that lands in the wallets before the Safe's drop shows stays counted once until it does (control: let go at once, the held Safe and the wallets made $70)", () => {
  const total = home();
  const now = 1_700_000_000_000;
  const at = new Date(now).toISOString();
  const st = (on: boolean, wallets: string): SpendingStatus => ({ loaded: true, totalUsd: wallets, cashUsd: wallets, coinsUsd: "0.00", capUsd: "500.00", roomUsd: "470.00", ready: true, networks: [{ network: "sol", name: "Solana", cashUsd: wallets, coinsUsd: "0.00", readyUsd: wallets }, { network: "hood", name: "Robinhood Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0.00" }] as SpendingStatus["networks"], onItsWay: on ? [{ id: "add-9", kind: "top-up", usd: "30.00", status: "on-its-way", shown: true, atIso: at, words: "Moving $30.00 to your SOL wallet" }] : [], firstTopUp: false });
  assert.equal(total(safe(40, true), st(true, "30.00"), now), 40, "on its way, the Safe's drop held");
  assert.equal(total(safe(40, true), st(false, "29.40"), now + 3000), 40, "landed in SOL, the Safe's drop still held: once");
  assert.equal(total(safe(10, true), st(false, "29.40"), now + 5000), 39.4, "the Safe shows it gone: let go");
  const control = home();
  assert.equal(control(safe(40, true), st(false, "29.40"), now + 3000), 69.4, "control: never keyed, the old double");
});
