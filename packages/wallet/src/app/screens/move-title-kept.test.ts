// the copy review's Sim walk (5 Nov): a Move's sheet said $5.01; its job said $5.20, then $5.40, then $5.61 on later runs. The job's
// figure came from the core's row, which is the engine's own: a Move from the Safe sends the inflow grid's amount (its
// rest stays in the NEAR wallet), and a Take out's row is priced again (what the core expects, then what arrived). The
// job's dollars from the tap (job-carry.ts) covered it only on this page, only once the core had answered. Now the core
// keeps the person's own figure on the row (askedUsd: the Move's legs, the Take out's ask) and every surface names it:
// the live job (Home's row, the Jobs card: publishTracks), Activity's row and its figure, with or without the carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity } from "@zerofee/core/spending";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { carried } from "@zerofee/shell-api/job-carry.ts";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "../../../../trade/src/float-core.ts";
import { planOf, type Leg } from "./move-split.ts";
import { runMove, type MoveRunIo } from "./move-run.ts";
import { moveTrack, rowTitle, taskOf, withCarry, type Folded } from "../money/live-steps.ts";
import { activityRows, nameOf, usdOf } from "../activity-rows.ts";

const here = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

/** The real engine (trade float-core) under the real core Spending, on the Sim's bridge; `px.sol` is the live price the
 *  engine and the Sim read each round. `fromPrivate`: the real app's Move (runtime.ts: paid from Private, NEAR
 *  Confidential). */
async function engine(px: { sol: number }, fromPrivate: boolean) {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 5, timers: clock.timers, float: { moveMs: 10, timers: clock.timers, priceUsd: (c) => (c === "sol" ? px.sol : c === "hood" ? 3000 : 600) } }));
  /** A round's 40 ms of the test's own time: the engine's calls answered, then the Sim's steps due by then land in order. */
  const settle = async () => { await clock.quiet(); await clock.advance(40); };
  const call: CoreFloatDeps["call"] = async (method, params) => {
    const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem);
    return r.ok;
  };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  let t = 1_000_000;
  const ticks: (() => void)[] = [];
  const nativeUsd = async (c: string) => (c === "sol" ? px.sol : c === "hood" ? 3000 : 600);
  const f = createCoreFloat({ fromPrivate, offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd: nativeUsd as never, wallets: () => bridgeWallets(call, nativeUsd as never), get: async () => undefined, set: async () => {}, now: () => t, every: (fn) => { ticks.push(fn); return () => undefined; }, rng: () => 0.5 });
  f.start();
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const rows = async () => { const r = await svc.call<SpendingActivity[]>("spending.activity", {}); assert.ok("ok" in r); return activityRows([], r.ok).spending; };
  const tick = async () => { for (const k of ticks) k(); await settle(); await f.refresh(); t += 5_000; };
  return { svc, rows, tick };
}

let n = 0;
/** Move's own run (MoveSheet's Approve → runMove), on a real task store; `atCall`: what the job carried the moment the
 *  core was asked (the tap's job is made before it). */
function moveIo(e: Awaited<ReturnType<typeof engine>>, atCall: Map<string, string | undefined>) {
  const tasks = createTaskStore();
  // one Face ID (6 Nov): the Safe's job is made on the core's job.signed, its signature before anything is sent and before
  // its answer; this engine has no sheet, so the test says it as the core does, as the call starts
  let signed: ((jobKey?: string) => void) | undefined;
  const io: MoveRunIo = {
    call: (m, p) => { const key = (p as { key?: string }).key; if (m === "spending.topUp" && key) { signed?.(key); atCall.set(key, carried(`move:mv-${key}`)?.usd); } return e.svc.call(m, p) as never; },
    onSigned: (fn) => { signed = fn; return () => { signed = undefined; }; },
    tasks: tasks.forApp("wallet"), keyFor: () => `move-title-${(n++).toString().padStart(10, "0")}`, onApproval: () => () => {}, asks: false,
    say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {},
  };
  return { io, tasks };
}

/** Every place the job is named, from the core's row `r`: with the job's carry (this page), and as a page without it (a
 *  reload whose carry was lost, another device): the same row under an id nothing carried. */
function named(r: SpendingActivity) {
  const t = moveTrack(r as Folded)!;
  const live = withCarry(t, carried(t.id));
  const bare = { ...r, id: `other-${r.id}` };
  return { live: rowTitle(live), card: taskOf(live).title, activity: [nameOf(r), usdOf(r)], bareTrack: rowTitle(moveTrack(bare as Folded)!), bareActivity: [nameOf(bare), usdOf(bare)] };
}

test("a Move from the Safe to the SOL wallet, paid from Private as the real app pays it: its job, Jobs card, Home row and Activity keep the $5.01 approved while the SOL price moves after the tap and the Safe sends the grid's $5.20; the tap's job carries it before the core answers (control: the row's own figure is $5.20, and a row without the kept figure is named by it)", async () => {
  const px = { sol: 150 };
  const e = await engine(px, true);
  const atCall = new Map<string, string | undefined>();
  const { io, tasks } = moveIo(e, atCall);
  const legs: Leg[] = [{ from: "safe", to: "sol", usd: 5.01 }];
  const ran = await runMove(legs, planOf(legs), io);
  assert.ok(ran?.followed.length, "the Move was made");
  assert.deepEqual([...atCall.values()], ["$5.01"], "the job, made on the Safe's signature, carries its dollars to the core's row before the core answers (main: only once it had)");
  px.sol = 171;
  let r: SpendingActivity | undefined;
  for (let i = 0; i < 12; i++) {
    await e.tick();
    r = (await e.rows()).find((x) => x.id === ran!.followed[0]!.id);
    assert.ok(r, "the Move's row");
    const at = named(r);
    assert.deepEqual([at.live, at.card, at.bareTrack], ["Move $5.01 to your SOL wallet", "Move $5.01 to your SOL wallet", "Move $5.01 to your SOL wallet"], `round ${i}: ${r.status}`);
    assert.deepEqual([at.activity, at.bareActivity], [["Move $5.01 to your SOL wallet", "$5.01"], ["Move $5.01 to your SOL wallet", "$5.01"]], `round ${i}: Activity`);
    assert.match(r.words, /\$5\.01 to your SOL wallet$/, "the core's own words name the legs, as the sheet did");
  }
  assert.equal(r!.status, "done");
  assert.equal(tasks.list().find((x) => x.id === `move:${r!.id}`)?.title, "Move $5.01 to your SOL wallet", "the Jobs card's own row");
  // control: the engine's figure is the grid's, and a row without the kept figure (main's) is named by it
  assert.equal(r!.usd, "5.20", "control: the Safe sent the inflow grid's $5.20");
  assert.equal(r!.askedUsd, "5.01");
  const { askedUsd: _a, legsUsd: _l, ...main } = r!;
  const old = { ...main, id: `old-${r!.id}`, words: "Moved $5.20 to your SOL wallet" };
  assert.deepEqual([rowTitle(moveTrack(old as Folded)!), nameOf(old), usdOf(old)], ["Move $5.20 to your SOL wallet", "Moved $5.20 to your SOL wallet", "$5.20"], "control: main's row says the grid's figure");
});

test("all of the SOL wallet's $5.01 back to the Safe (Move's take-out): the core prices the move home again as the SOL price moves after the tap, and its job, Jobs card and Activity keep the $5.01 asked, without the carry too (control: the row's own figure moved off $5.01)", async () => {
  const px = { sol: 150 };
  // the SOL wallet's money first (a public Add: the take-out is the same move home on either engine)
  const e = await engine(px, false);
  const fund = await e.svc.call<SpendingActivity>("spending.topUp", { usd: 5.01, legs: [{ network: "sol", usd: 5.01 }] });
  assert.ok("ok" in fund, JSON.stringify(fund));
  for (let i = 0; i < 20; i++) await e.tick();
  const atCall = new Map<string, string | undefined>();
  const { io, tasks } = moveIo(e, atCall);
  const legs: Leg[] = [{ from: "sol", to: "safe", usd: 5.01 }];
  const ran = await runMove(legs, planOf(legs), io);
  assert.ok(ran?.followed.length, "the take-out was made");
  px.sol = 135;
  let r: SpendingActivity | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    await e.tick();
    r = (await e.rows()).find((x) => x.id === ran!.followed[0]!.id);
    assert.ok(r, "the take-out's row");
    seen.add(r.usd);
    const at = named(r);
    assert.deepEqual([at.live, at.card], ["Move $5.01 to your Safe", "Move $5.01 to your Safe"], `round ${i}: ${r.status}`);
    // audit 13's D2: landed, Activity's figure is what came in (the row's own), the title keeps the asked
    const shown = r.status === "done" ? `$${r.usd}` : "$5.01";
    assert.deepEqual(at.activity, ["Move $5.01 to your Safe", shown], `round ${i}: Activity`);
    if (r.usd !== "5.01") assert.deepEqual([at.bareTrack, ...at.bareActivity], ["Move $5.01 to your Safe", "Move $5.01 to your Safe", shown], `round ${i}: with no carry`);
  }
  assert.equal(r!.status, "done");
  assert.equal(tasks.list().find((x) => x.id.startsWith("job:"))?.title, "Move $5.01 to your Safe", "the tap's Jobs row");
  // control: the row's own figure moved with the price (what arrived), so only the kept figure can say $5.01
  assert.ok([...seen].some((u) => u !== "5.01"), `control: the row's own figure moved (${[...seen].join(", ")})`);
  assert.equal(r!.askedUsd, "5.01");
  const { askedUsd: _a, ...main } = r!;
  const old = { ...main, id: `old-${r!.id}` };
  assert.equal(rowTitle(moveTrack(old as Folded)!), `Move $${r!.usd} to your Safe`, "control: main's row, priced again");
});

test("Home's own on-its-way row (a move no live job covers) says the kept figure; the engine keeps the Take out's ask in its journal, never a parked remainder's", () => {
  assert.match(here("./Home.tsx"), /<div className="v">\{\$\(m\.askedUsd \?\? m\.usd\)\}<\/div>/);
  assert.match(here("../../../../trade/src/float-jobs.ts"), /\.\.\.\(asked > 0 && !parked \? \{ askedUsd: asked \} : \{\}\)/);
});
