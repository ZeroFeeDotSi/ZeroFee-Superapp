// the copy review's ruling (5 Nov): one Hot row per move the person started, until it lands. The review's Q3: on main, the
// person's own Move to the SOL wallet, paid from Private as the real app pays every Move from the Safe, drew only a Jobs
// card. Hot's rows were capped by what the engine counts on its way, and the engine never counts a part Private pays
// straight to a chain's wallet (float-core onWayOf, rule 11). Now such a Move counts from its own row, at the figure the
// person approved, until the round whose read of that wallet shows it; the public path's row says that figure too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "../../../trade/src/float-core.ts";
import { planOf, type Leg } from "./screens/move-split.ts";
import { runMove, type MoveRunIo } from "./screens/move-run.ts";
import { MOVING_WORDS, movingRows } from "./hot-moving.ts";
import { tradingUsd } from "./trading.ts";

const said = (s: SpendingStatus) => movingRows(s).map((r) => MOVING_WORDS.row(r.to, `$${r.usd}`));
const hot = (s: SpendingStatus) => tradingUsd(s, [], []).usd;
const sol = (s: SpendingStatus) => s.networks.find((n) => n.network === "sol")?.cashUsd;

/** The real engine paying from Private (runtime.ts fromPrivate: true) under the real core Spending, on the Sim's bridge. */
async function engine() {
  // The bridge's timed steps (the Private pay landing on the SOL wallet) wait on the test's own clock, never the wall's: one
  // lands only when a round lands it (a 5 ms timer landed it before "going" was read about 1 run in 8 on a busy machine).
  const due: (() => void)[] = [];
  const timers = { set: (run: () => void) => (due.push(run), run), clear: (h: unknown) => { const i = due.indexOf(h as () => void); if (i >= 0) due.splice(i, 1); } };
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, timers, float: { moveMs: 10 } });
  let busy = 0;
  const call: CoreFloatDeps["call"] = async (m, p) => { busy++; try { const r = await mock.call<any>(m, p); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; } finally { busy--; } };
  /** The engine's own steps done: no bridge call in flight for three turns of the loop (a count of calls, not a wait). */
  const settle = async () => { for (let quiet = 0; quiet < 3; ) { await new Promise((r) => setImmediate(r)); quiet = busy === 0 ? quiet + 1 : 0; } };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const ticks: (() => void)[] = [];
  const nativeUsd = async (c: string) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600);
  const f = createCoreFloat({ fromPrivate: true, offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd: nativeUsd as never, wallets: () => bridgeWallets(call, nativeUsd as never), get: async () => undefined, set: async () => {}, now: () => t, every: (fn) => { ticks.push(fn); return () => undefined; }, rng: () => 0.5 });
  f.start();
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const status = async () => { const r = await svc.call<SpendingStatus>("spending.status", {}); assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
  /** One engine round: the bridge's held steps land (`land`), the engine's timers, then the chain reads. */
  const round = async (land: boolean) => { if (land) for (const run of due.splice(0)) run(); for (const k of ticks) k(); await settle(); await f.refresh(); t += 5_000; };
  return { svc, status, round, held: () => due.length };
}

test("a Move of $5.01 from the Safe to the SOL wallet, paid from Private: Hot draws \"On its way to your SOL wallet · $5.01\" and counts it from the tap; the round whose read of the SOL wallet shows it, the row is gone and the wallet holds it, Hot's total $5.01 throughout (control: the engine's own figure never had it, so main drew no row and Hot jumped $0 → $5.01)", async () => {
  const e = await engine();
  const before = await e.status();
  assert.deepEqual([said(before), hot(before)], [[], "0.00"]);
  const io: MoveRunIo = { call: (m, p) => e.svc.call(m, p) as never, tasks: createTaskStore().forApp("wallet"), keyFor: () => "hot-private-0000000001", onApproval: () => () => {}, asks: false, say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {} };
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 5.01 }];
  const ran = await runMove(legs, planOf(legs), io);
  assert.ok(ran?.followed.length, "the Move was made");
  assert.equal(e.held(), 2, "the Move's two Private pays are held until a round lands them");
  const going = await e.status();
  const row = going.onItsWay?.find((a) => a.id === ran!.followed[0]!.id);
  assert.deepEqual([row?.status, row?.via, row?.usd, row?.askedUsd], ["on-its-way", "private", "5.20", "5.01"], "the core's row: paid from Private, the grid's $5.20 sent, $5.01 approved");
  assert.equal(sol(going), "0.00", "the SOL wallet's read doesn't show it yet");
  assert.deepEqual(said(going), ["On its way to your SOL wallet · $5.01"]);
  assert.equal(hot(going), "5.01", "Hot counts it from the tap");
  // control: the engine's own figure holds none of it (rule 11), the cap main's rows were gated on
  assert.equal(Math.round((Number(going.totalUsd) - Number(going.reserveUsd) - going.networks.reduce((n, x) => n + Number(x.cashUsd) + Number(x.coinsUsd), 0)) * 100) / 100, 0, "control: the engine counts nothing on its way");
  let landed: SpendingStatus | undefined;
  // round 0 lands nothing (still on its way across a round); round 1 lands the Private pay, and its read shows it
  for (let i = 0; i < 3 && !landed; i++) {
    await e.round(i > 0);
    const s = await e.status();
    assert.equal(hot(s), "5.01", `round ${i}: Hot's total never dips or doubles`);
    if (sol(s) === "5.01") landed = s;
    else assert.deepEqual(said(s), ["On its way to your SOL wallet · $5.01"], `round ${i}: still on its way`);
  }
  assert.ok(landed, "the SOL wallet's read showed it");
  assert.deepEqual(said(landed!), [], "the chain read shows it: the row is gone, the wallet's own row holds it");
});

const net = (network: string, cashUsd: string) => ({ network, name: network, cashUsd, coinsUsd: "0.00", readyUsd: "0.00" });
const S = (o: Partial<SpendingStatus>) => ({ loaded: true, totalUsd: "0.00", reserveUsd: "0.00", cashUsd: "0.00", coinsUsd: "0.00", capUsd: "500", roomUsd: "0", ready: true, firstTopUp: false, onItsWay: [], networks: [net("sol", "0.00"), net("hood", "0.00")], ...o }) as SpendingStatus;
const move = (o: Partial<SpendingActivity>) => ({ id: "mv-1", kind: "top-up", usd: "5.20", askedUsd: "5.01", legsUsd: "5.01", status: "on-its-way", shown: true, atIso: "2026-11-05T12:00:00.000Z", words: "Moving $5.01 to your SOL wallet", goesTo: ["sol"], ...o }) as SpendingActivity;

test("the public path's row names the approved figure too, and the rows stay gated where the engine is the count (controls: a public Move the engine doesn't count, a Private one already landed, a site's Add)", () => {
  // the public path: the engine counts the Safe's $5.20 on its way; the row says the $5.01 asked (the grid's rest goes to
  // the NEAR wallet, counted in the total with no row of its own)
  const pub = S({ totalUsd: "5.20", onItsWay: [move({ via: undefined } as never)] });
  assert.deepEqual(said(pub), ["On its way to your SOL wallet · $5.01"]);
  assert.equal(hot(pub), "5.20", "the engine's whole figure still counts");
  // control: a public Move the engine no longer counts (in its wallet's read) is no row: the gate stands
  assert.deepEqual(said(S({ totalUsd: "5.20", networks: [net("sol", "5.20"), net("hood", "0.00")], onItsWay: [move({})] })), []);
  // control: paid from Private and already landed on its chain (`landed`): that wallet's, never twice
  assert.deepEqual(said(S({ networks: [net("sol", "5.01"), net("hood", "0.00")], onItsWay: [move({ via: "private", landed: ["sol"] } as never)] })), []);
  // control: a site's Add paid from Private stays gated (its wallet is a site's, counted by its own read)
  assert.deepEqual(said(S({ onItsWay: [move({ via: "private", goesTo: undefined, site: "pump", siteName: "pump.fun" } as never)] })), []);
  // the Private one going: its row and its count
  const priv = S({ onItsWay: [move({ via: "private" } as never)] });
  assert.deepEqual([said(priv), hot(priv)], [["On its way to your SOL wallet · $5.01"], "5.01"]);
});
