// T-2 landing 1: standing buys on the phone. QA's terms, each with a control: nothing pre-signed; a run due while open
// runs once; one missed while closed asks ONCE and never catches up; a failure pauses; a "no" skips that run only; the
// weekly cap holds across two tabs; a damaged store is kept aside, never overwritten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_RUN } from "./orders.ts";
import { ALL_CAP_LINE, ALL_CAP_NOTE, ALL_WEEK_CAP_USD, allWeekSpent, createStandingBook, droppable, missedLine, nextAfter, planRefusal, weekSpent, type StandingPlan } from "./standing.ts";

const T0 = 1_760_000_000_000, DAY = 86_400_000, MIN = 60_000;
const sol = { chain: "sol" as const, coin: "native", symbol: "SOL", usd: 5, every: "day" as const, weekCapUsd: 35 };

function shared() {
  const store = { v: null as string | null };
  const held = new Set<string>(), queues = new Map<string, Promise<unknown>>();
  const lock = async <T>(name: string, ifAvailable: boolean, fn: () => Promise<T>) => {
    if (ifAvailable && held.has(name)) return NOT_RUN;
    const mine = (queues.get(name) ?? Promise.resolve()).then(async () => { held.add(name); try { return await fn(); } finally { held.delete(name); } });
    queues.set(name, mine.catch(() => undefined));
    return mine;
  };
  return { store, lock };
}
function tab(s: ReturnType<typeof shared>, clock: { t: number }, opts: { answer?: "ok" | "declined" | "throw"; withLock?: boolean } = {}) {
  const ran: { id: string; usd: number }[] = [];
  const aside: string[] = [];
  const book = createStandingBook({
    load: async () => s.store.v, save: async (j) => void (s.store.v = j), now: () => clock.t, newId: () => "p1",
    keepAside: async (raw) => void aside.push(raw),
    run: async (p, usd) => {
      ran.push({ id: p.id, usd });
      if (opts.answer === "declined") return "declined";
      if (opts.answer === "throw") throw { problem: { whatHappened: "There isn't enough SOL for sale for that much." } };
      return { recordId: `r${ran.length}` };
    },
    ...(opts.withLock === false ? {} : { lock: s.lock }),
  });
  return { book, ran, aside };
}

test("control: a run that falls due while ZeroFee is open and on screen runs once, then the plan waits for its next time", async () => {
  const clock = { t: T0 };
  const a = tab(shared(), clock);
  await a.book.add(sol, 7);
  clock.t = T0 + DAY - MIN; await a.book.tick(); // seen just before it is due
  clock.t = T0 + DAY + MIN; await a.book.tick(); await a.book.settled();
  assert.deepEqual(a.ran, [{ id: "p1", usd: 5 }]);
  for (let i = 0; i < 3; i++) { clock.t += MIN; await a.book.tick(); await a.book.settled(); }
  assert.equal(a.ran.length, 1, "once");
  const [p] = await a.book.list();
  assert.equal(p!.nextAt, T0 + 2 * DAY);
  assert.equal(p!.runs[0]!.status, "done");
});

test("QA: a run missed while ZeroFee was closed asks ONCE and never catches up, however many were missed; only the tap buys", async () => {
  const s = shared(), clock = { t: T0 };
  await tab(s, clock).book.add(sol, 30);
  clock.t = T0 + 4 * DAY + 3 * 3_600_000; // closed for four days
  const reopened = tab(s, clock);
  for (let i = 0; i < 5; i++) { await reopened.book.tick(); await reopened.book.settled(); clock.t += MIN; }
  assert.equal(reopened.ran.length, 0, "nothing bought by itself");
  const [p] = await reopened.book.list();
  assert.ok(p!.missed, "one ask");
  assert.equal(p!.nextAt, T0 + 5 * DAY, "moved on to its next time: the missed days are not owed");
  assert.equal(missedLine(p!), "Your $5.00 SOL buy was due while ZeroFee was closed. Buy now?");
  await reopened.book.runMissed("p1"); await reopened.book.settled();
  await reopened.book.runMissed("p1"); await reopened.book.settled();
  assert.equal(reopened.ran.length, 1, "the tap buys once");
  assert.equal((await reopened.book.list())[0]!.missed, undefined);
});

test("a run due while Trade was off screen (pause) asks too; Skip clears the ask (control: no pause, it runs)", async () => {
  for (const paused of [true, false]) {
    const clock = { t: T0 };
    const a = tab(shared(), clock);
    await a.book.add(sol, 7);
    clock.t = T0 + DAY - MIN; await a.book.tick();
    if (paused) a.book.pause();
    clock.t = T0 + DAY + MIN; await a.book.tick(); await a.book.settled();
    assert.equal(a.ran.length, paused ? 0 : 1);
    if (paused) { assert.ok((await a.book.list())[0]!.missed); await a.book.skipMissed("p1"); assert.equal((await a.book.list())[0]!.missed, undefined); }
  }
});

test("QA: a failure pauses the plan with its words and nothing runs after it; resuming never makes up the paused runs", async () => {
  const s = shared(), clock = { t: T0 };
  const a = tab(s, clock, { answer: "throw" });
  await a.book.add(sol, 30);
  clock.t = T0 + DAY - MIN; await a.book.tick();
  clock.t = T0 + DAY + MIN; await a.book.tick(); await a.book.settled();
  const [p] = await a.book.list();
  assert.equal(p!.status, "paused");
  assert.match(p!.note!, /^Paused: There isn't enough SOL for sale for that much\./);
  clock.t = T0 + 3 * DAY + MIN; await a.book.tick(); await a.book.settled();
  assert.equal(a.ran.length, 1, "paused: nothing more");
  await a.book.setStatus("p1", "on");
  assert.equal((await a.book.list())[0]!.nextAt, T0 + 4 * DAY, "on again from its next time, nothing owed");
});

test("a no on the sheet skips that run only: the plan stays on", async () => {
  const clock = { t: T0 };
  const a = tab(shared(), clock, { answer: "declined" });
  await a.book.add(sol, 7);
  clock.t = T0 + DAY - MIN; await a.book.tick();
  clock.t = T0 + DAY + MIN; await a.book.tick(); await a.book.settled();
  const [p] = await a.book.list();
  assert.equal(p!.status, "on");
  assert.equal(p!.runs[0]!.status, "skipped");
});

test("QA: the weekly cap holds across two tabs, and one due time is one buy (control: without the lock both tabs buy)", async () => {
  for (const withLock of [true, false]) {
    const s = shared(), clock = { t: T0 };
    const a = tab(s, clock, { withLock }), b = tab(s, clock, { withLock });
    await a.book.add({ ...sol, usd: 20, weekCapUsd: 35 }, 30);
    clock.t = T0 + DAY - MIN; await Promise.all([a.book.tick(), b.book.tick()]);
    clock.t = T0 + DAY + MIN; await Promise.all([a.book.tick(), b.book.tick()]); await Promise.all([a.book.settled(), b.book.settled()]);
    const day1 = a.ran.length + b.ran.length;
    clock.t = T0 + 2 * DAY - MIN; await Promise.all([a.book.tick(), b.book.tick()]);
    clock.t = T0 + 2 * DAY + MIN; await Promise.all([a.book.tick(), b.book.tick()]); await Promise.all([a.book.settled(), b.book.settled()]);
    const all = [...a.ran, ...b.ran];
    if (withLock) {
      assert.equal(day1, 1, "one due time, one buy");
      assert.equal(all.length, 1, "day 2 would pass the $35 week: skipped");
      const [p] = await a.book.list();
      assert.equal(weekSpent(p!, clock.t), 20);
      assert.match(p!.note!, /most is spent/);
    } else assert.ok(day1 >= 2 || all.reduce((n, r) => n + r.usd, 0) > 35, `control: without the lock (${day1} on day 1)`);
  }
});

test("a damaged store is kept aside, nothing runs, nothing is written over it (control: a sane store is read)", async () => {
  const s = shared(), clock = { t: T0 };
  s.store.v = JSON.stringify([{ id: "x", every: "hourly" }]);
  const a = tab(s, clock);
  assert.deepEqual(await a.book.list(), []);
  assert.equal(a.book.damaged(), true);
  await a.book.tick();
  assert.deepEqual(a.aside, [s.store.v]);
  assert.equal(s.store.v, JSON.stringify([{ id: "x", every: "hourly" }]), "never overwritten");
  const ok = shared();
  await tab(ok, clock).book.add(sol, 7);
  const b = tab(ok, clock);
  assert.equal((await b.book.list()).length, 1, "control");
  assert.equal(b.book.damaged(), false);
});

test("the rules: a run $1 to $50, a week's most from one run to $100, 1 to 30 days; its own rhythm", () => {
  assert.equal(planRefusal(sol, 30), null, "control");
  assert.match(planRefusal({ ...sol, usd: 60 }, 30)!, /\$1 to \$50/);
  assert.match(planRefusal({ ...sol, weekCapUsd: 200 }, 30)!, /\$100/);
  assert.match(planRefusal({ ...sol, weekCapUsd: 4 }, 30)!, /can be one buy/);
  assert.match(planRefusal(sol, 31)!, /1 to 30 days/);
  assert.equal(nextAfter({ madeAt: T0, every: "day" }, T0 + 2.5 * DAY), T0 + 3 * DAY);
  assert.equal(nextAfter({ madeAt: T0, every: "week" }, T0 + 1), T0 + 7 * DAY);
  const p = { runs: [{ at: T0, usd: 5, status: "done" }, { at: T0, usd: 5, status: "skipped" }, { at: T0 - 8 * DAY, usd: 5, status: "done" }] } as Pick<StandingPlan, "runs">;
  assert.equal(weekSpent(p, T0 + DAY), 5, "skipped and older runs don't count");
});

test("the runner is Trade's own buy of the plan's dollars; a no is declined; a failure throws its words", async () => {
  const { standingRunner } = await import("./standing.ts");
  const calls: unknown[] = [];
  let status = "done";
  const run = standingRunner({ quote: async (...a: unknown[]) => (calls.push(a), {}), trade: async () => ({ id: "r1", status, problem: { whatHappened: "No." } }) } as never);
  const plan = { id: "p", chain: "sol", coin: "native", symbol: "SOL" } as StandingPlan;
  assert.deepEqual(await run(plan, 5), { recordId: "r1" });
  assert.deepEqual(calls[0], ["buy", "sol", "native", { usd: 5 }]);
  status = "declined"; assert.equal(await run(plan, 5), "declined");
  status = "failed"; await assert.rejects(run(plan, 5), (e: any) => e.problem.whatHappened === "No.");
});

test("review H1: a claim whose save fails buys nothing (control: a saved claim buys)", async () => {
  for (const failClaim of [true, false]) {
    const s = shared(), clock = { t: T0 };
    const a = tab(s, clock);
    await a.book.add(sol, 7);
    const real = s.store;
    clock.t = T0 + DAY - MIN; await a.book.tick();
    const book = createStandingBook({ load: async () => real.v, save: async (j) => { if (failClaim && JSON.parse(j).some((p: StandingPlan) => p.runs.some((r) => r.status === "running"))) throw new Error("disk"); real.v = j; }, now: () => clock.t, keepAside: async () => undefined, run: async (p, usd) => (a.ran.push({ id: p.id, usd }), { recordId: "r" }), lock: s.lock });
    await book.list();
    clock.t = T0 + DAY - MIN / 2; await book.tick();
    clock.t = T0 + DAY + MIN; await book.tick(); await book.settled();
    assert.equal(a.ran.length, failClaim ? 0 : 1, failClaim ? "no saved claim, no buy" : "control");
  }
});

test("review M2: a run left running with nobody buying it (ZeroFee closed mid-buy) pauses the plan and counts toward the week (control: a finished run doesn't)", async () => {
  const s = shared(), clock = { t: T0 };
  const plan = { ...sol, id: "p1", madeAt: T0, endsAt: T0 + 30 * DAY, nextAt: T0 + 2 * DAY, status: "on", runs: [{ at: T0 + DAY, usd: 5, status: "running" }] };
  s.store.v = JSON.stringify([plan]);
  const a = tab(s, clock);
  clock.t = T0 + DAY + 5 * MIN; await a.book.tick(); await a.book.settled();
  const [p] = await a.book.list();
  assert.equal(p!.status, "paused");
  assert.match(p!.note!, /Check Activity/);
  assert.equal(weekSpent(p!, clock.t), 5, "a failed run counts: it may have gone");
  const done = shared();
  done.store.v = JSON.stringify([{ ...plan, runs: [{ at: T0 + DAY, usd: 5, status: "done" }] }]);
  const b = tab(done, clock);
  await b.book.tick();
  assert.equal((await b.book.list())[0]!.status, "on", "control");
});

test("review L3/L6: a tap after the plan's end buys nothing; a crafted run with negative dollars makes the store damaged", async () => {
  const s = shared(), clock = { t: T0 };
  const plan = { ...sol, id: "p1", madeAt: T0, endsAt: T0 + 2 * DAY, nextAt: T0 + 3 * DAY, status: "on", runs: [], missed: { dueAt: T0 + DAY } };
  s.store.v = JSON.stringify([plan]);
  const a = tab(s, clock);
  clock.t = T0 + 2 * DAY + MIN;
  await a.book.runMissed("p1"); await a.book.settled();
  assert.equal(a.ran.length, 0);
  const c = shared();
  c.store.v = JSON.stringify([{ ...plan, endsAt: T0 + 20 * DAY, runs: [{ at: T0, usd: -100, status: "done" }] }]);
  const b = tab(c, clock);
  assert.deepEqual(await b.book.list(), []);
  assert.equal(b.book.damaged(), true);
});

test("a run this copy is still buying (its sheet open) is never taken for an orphan, even with no lock at all", async () => {
  const s = shared(), clock = { t: T0 };
  let release!: () => void;
  const sheet = new Promise<void>((r) => (release = r));
  const ran: number[] = [];
  const book = createStandingBook({ load: async () => s.store.v, save: async (j) => void (s.store.v = j), now: () => clock.t, newId: () => "p1", keepAside: async () => undefined, run: async () => { ran.push(1); await sheet; return { recordId: "r" }; } });
  await book.add(sol, 7);
  clock.t = T0 + DAY - MIN; await book.tick();
  clock.t = T0 + DAY + MIN; await book.tick();
  await new Promise((r) => setTimeout(r, 5));
  clock.t += MIN; await book.tick(); // the sheet is still open
  release(); await book.settled();
  const [p] = await book.list();
  assert.equal(p!.status, "on");
  assert.equal(p!.runs[0]!.status, "done");
  assert.equal(ran.length, 1);
});

// QA (3 Nov): ONE cap across all standing buys ($100 a week), held under the same store lock; old closed plans go.
function idTab(s: ReturnType<typeof shared>, clock: { t: number }, prefix: string) {
  let n = 0;
  const ran: { id: string; usd: number }[] = [];
  const book = createStandingBook({
    load: async () => s.store.v, save: async (j) => void (s.store.v = j), now: () => clock.t, newId: () => `${prefix}${++n}`,
    keepAside: async () => undefined, lock: s.lock,
    run: async (p, usd) => { ran.push({ id: p.id, usd }); return { recordId: `r${ran.length}` }; },
  });
  return { book, ran };
}

test("QA: all standing buys together stay within $100 a week, two plans in two tabs (control: one plan under it runs every time)", async () => {
  const s = shared(), clock = { t: T0 };
  const a = idTab(s, clock, "a"), b = idTab(s, clock, "b");
  await a.book.add({ ...sol, usd: 40, weekCapUsd: 100 }, 30);
  await b.book.add({ ...sol, coin: "BONK", symbol: "BONK", usd: 40, weekCapUsd: 100 }, 30);
  for (const day of [1, 2, 3]) {
    clock.t = T0 + day * DAY - MIN; await Promise.all([a.book.tick(), b.book.tick()]);
    clock.t = T0 + day * DAY + MIN; await Promise.all([a.book.tick(), b.book.tick()]); await Promise.all([a.book.settled(), b.book.settled()]);
  }
  const all = [...a.ran, ...b.ran];
  const spent = all.reduce((n, r) => n + r.usd, 0);
  assert.ok(spent <= ALL_WEEK_CAP_USD, `spent $${spent}`);
  assert.equal(spent, 80, "day 1: both ($80); days 2 and 3 would pass $100: skipped");
  const plans = await a.book.list();
  assert.equal(allWeekSpent(plans, clock.t), 80);
  assert.ok(plans.every((p) => p.note === ALL_CAP_NOTE), JSON.stringify(plans.map((p) => p.note)));
  assert.ok(plans.every((p) => p.weekCapUsd === 100 && weekSpent(p, clock.t) <= 40), "each plan's own cap alone would have let them run");
  assert.equal(ALL_CAP_LINE, "All your repeat buys: up to $100 a week.");

  // control: one plan under the overall cap runs every time, two tabs looking
  const s2 = shared(), c2 = { t: T0 };
  const one = idTab(s2, c2, "c"), other = idTab(s2, c2, "d");
  await one.book.add({ ...sol, usd: 25, weekCapUsd: 100 }, 30);
  for (const day of [1, 2, 3, 4]) {
    c2.t = T0 + day * DAY - MIN; await Promise.all([one.book.tick(), other.book.tick()]);
    c2.t = T0 + day * DAY + MIN; await Promise.all([one.book.tick(), other.book.tick()]); await Promise.all([one.book.settled(), other.book.settled()]);
  }
  assert.equal([...one.ran, ...other.ran].length, 4, "control: $25 x 4 = $100 runs");
});

test("the overall cap counts a cancelled plan's runs of the week (control: a cap set higher lets the run go)", async () => {
  for (const allWeekCapUsd of [100, 200]) {
    const s = shared(), clock = { t: T0 };
    let n = 0;
    const ran: number[] = [];
    const book = createStandingBook({ load: async () => s.store.v, save: async (j) => void (s.store.v = j), now: () => clock.t, newId: () => `p${++n}`, lock: s.lock, allWeekCapUsd, run: async (_p, usd) => { ran.push(usd); return { recordId: "r" }; } });
    await book.add({ ...sol, usd: 50, weekCapUsd: 100 }, 30);
    for (const day of [1, 2]) { clock.t = T0 + day * DAY - MIN; await book.tick(); clock.t = T0 + day * DAY + MIN; await book.tick(); await book.settled(); }
    assert.equal(ran.length, 2);
    assert.equal(await book.setStatus("p1", "cancelled"), true);   // $100 spent this week by a plan now cancelled
    clock.t = T0 + 2 * DAY + 2 * MIN;
    await book.add({ ...sol, usd: 10, weekCapUsd: 100 }, 30);
    clock.t = T0 + 3 * DAY + MIN; await book.tick();
    clock.t = T0 + 3 * DAY + 3 * MIN; await book.tick(); await book.settled();
    assert.equal(ran.length, allWeekCapUsd === 100 ? 2 : 3, `cap $${allWeekCapUsd}`);
  }
});

test("plans cancelled or ended more than 7 days ago go from the store at its next change (control: newer ones, and live ones, stay)", async () => {
  const s = shared(), clock = { t: T0 };
  const plan = (id: string, status: StandingPlan["status"], closedAt: number | undefined, runAt?: number): StandingPlan => ({
    id, chain: "sol", coin: "native", symbol: "SOL", usd: 5, every: "day", weekCapUsd: 35, madeAt: T0 - 20 * DAY, endsAt: T0 + 5 * DAY, nextAt: T0 + DAY, status,
    ...(closedAt !== undefined ? { closedAt } : {}), runs: runAt !== undefined ? [{ at: runAt, usd: 5, status: "done" as const }] : [],
  });
  s.store.v = JSON.stringify([
    plan("old-cancel", "cancelled", T0 - 8 * DAY, T0 - 9 * DAY),
    plan("new-cancel", "cancelled", T0 - 6 * DAY, T0 - 6 * DAY),
    plan("old-cancel-no-stamp", "cancelled", undefined, T0 - 12 * DAY),
    { ...plan("old-end", "ended", T0 - 8 * DAY), endsAt: T0 - 8 * DAY },
    plan("paused", "paused", undefined, T0 - 15 * DAY),
    plan("on", "on", undefined),
  ]);
  const a = idTab(s, clock, "x");
  assert.equal((await a.book.list()).length, 6, "a read alone drops nothing");
  assert.equal(await a.book.setStatus("on", "paused"), true);   // any change
  assert.deepEqual((await a.book.list()).map((p) => p.id).sort(), ["new-cancel", "on", "paused"]);
  assert.equal(a.book.damaged(), false);
  // a plan cancelled now carries its time, and goes 7 days later
  await a.book.setStatus("on", "cancelled");
  const cancelled = (await a.book.list()).find((p) => p.id === "on")!;
  assert.equal(cancelled.closedAt, T0);
  clock.t = T0 + 7 * DAY + MIN;
  await a.book.setStatus("paused", "on");
  assert.deepEqual((await a.book.list()).map((p) => p.id), ["paused"]);
  assert.equal(droppable({ ...cancelled, runs: [{ at: T0 + 6 * DAY, usd: 5, status: "done" }] }, clock.t), false, "control: a run in the last 7 days keeps it");
});
