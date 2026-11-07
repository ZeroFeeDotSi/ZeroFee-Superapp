// the audit's Trade audit T12 (8 Nov): a trade's Jobs row could stay in Now for ever. The sheet and the list row followed the
// trade only while they were mounted; "trade-…" ids aren't "job:", so endOrphans never ended them, and they have no
// staleMs: close the sheet, scroll the row away or reload, and Now said "Buy $5 of DOPE · Not confirmed yet" while
// Activity said "Bought DOPE". With QA 16's MUST on T2: after a reload a record still checking must be followed again,
// or its turn is lost. Now the record carries its task's id (svc.trade's `task`), and Trade's runtime keeps every trade
// task to its record on every change and at the start (keepTradeTasks): ended done, turned, said no; a task no record
// stands for, from before this run, ends with where the money is. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { TradeRecord } from "../service.ts";
import { tradeProblems } from "../trade-problems.ts";
import { CLOSED_WORDS, KEEP_GRACE_MS, keepTradeTasks } from "./trade-tasks.ts";

const tasks = taskStore().forApp("trade");
const task = (id: string) => taskStore().list().find((t) => t.id === id)!;
const STEPS = [{ label: "Sent", state: "doing" as const, at: 1 }, { label: "Landed", state: "waiting" as const }, { label: "In your SOL wallet", state: "waiting" as const }];
const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 5, hashes: ["h"], startedAt: 0, ...o });
function fakeSvc(list: TradeRecord[]) {
  let now = list;
  const fns = new Set<() => void>();
  return { activity: async () => now, on: (f: () => void) => { fns.add(f); return () => fns.delete(f); }, set(l: TradeRecord[]) { now = l; for (const f of [...fns]) f(); } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const fakeTimer = () => { const due: (() => void)[] = []; return { due, set: (f: () => void) => (due.push(f), due.length), clear: () => undefined }; };

test("a reload: a task whose record landed ends done with every step ticked; one whose record turned after done is rewritten (QA 16's MUST); one the person said no to stops", async () => {
  for (const id of ["trade-k1", "trade-k2", "trade-k3"]) tasks.publish({ id, title: "Buy $5 of DOPE", steps: STEPS, startedAt: 100 });
  tasks.end("trade-k2", "done");
  const svc = fakeSvc([
    rec({ id: "a", task: "trade-k1", status: "done", endedAt: 200 }),
    rec({ id: "b", task: "trade-k2", status: "expired", problem: tradeProblems.expired("DOPE") }),
    rec({ id: "c", task: "trade-k3", status: "declined", hashes: [] }),
  ]);
  const stop = keepTradeTasks(svc, tasks, { now: () => 10_000 });
  await tick();
  assert.equal(task("trade-k1").state, "done");
  assert.deepEqual(task("trade-k1").steps.map((s) => s.state), ["done", "done", "done"]);
  assert.equal(task("trade-k2").state, "failed", "the turn after done, followed again after the reload");
  assert.equal(task("trade-k2").detail, tradeProblems.expired("DOPE").whatHappened);
  assert.deepEqual([task("trade-k3").state, task("trade-k3").detail], ["stopped", "You said no. Nothing moved."]);
  stop();
});

test("a record still not confirmed keeps its task going; the moment it lands (an event, any time later) the task ends done", async () => {
  tasks.publish({ id: "trade-u1", title: "Buy $5 of DOPE", steps: STEPS, startedAt: 100 });
  const svc = fakeSvc([rec({ id: "u", task: "trade-u1", status: "unconfirmed", problem: tradeProblems.unconfirmed("DOPE") })]);
  const stop = keepTradeTasks(svc, tasks, { now: () => 10_000 });
  await tick();
  assert.equal(task("trade-u1").state, "pending", "not confirmed: still going, never ended unsure");
  svc.set([rec({ id: "u", task: "trade-u1", status: "done", endedAt: 9_000 })]);
  await tick();
  assert.equal(task("trade-u1").state, "done");
  stop();
});

test("a live tap: the screen's own ending runs first; the keeper ends a done task only past KEEP_GRACE_MS from its landing, then at once by its own timer", async () => {
  let now = 50_000;
  const timer = fakeTimer();
  const svc = fakeSvc([]);
  const stop = keepTradeTasks(svc, tasks, { now: () => now, timer });
  await tick();
  tasks.publish({ id: "trade-l1", title: "Buy $5 of DOPE", steps: STEPS, startedAt: 50_100 });
  svc.set([rec({ id: "l", task: "trade-l1", status: "done", timing: { tapAt: 50_100, landedAt: 50_700 }, endedAt: 50_700, verifying: true })]);
  await tick();
  assert.equal(task("trade-l1").state, "pending", "the sheet's 1.6 s ending is the screen's");
  assert.equal(timer.due.length, 1);
  now = 50_700 + KEEP_GRACE_MS + 1;
  timer.due[0]!();
  await tick();
  assert.equal(task("trade-l1").state, "done", "the sheet went away: the keeper ends it");
  stop();
});

test("a task no record stands for, from before this run: nothing started after it, it ends with nothing spent; a record started just after it (inside a tap's minute) with no task, unsure; a task made in this run is never touched", async () => {
  tasks.publish({ id: "trade-o1", title: "Buy $5 of DOPE", steps: STEPS, startedAt: 1_000 });
  tasks.publish({ id: "trade-o2", title: "Buy $5 of WIF", steps: STEPS, startedAt: 100_000 });
  const svc = fakeSvc([rec({ id: "x", status: "done", startedAt: 100_500 })]);
  const stop = keepTradeTasks(svc, tasks, { now: () => 200_000 });
  await tick();
  assert.deepEqual([task("trade-o1").state, task("trade-o1").detail], ["stopped", CLOSED_WORDS]);
  assert.equal(CLOSED_WORDS, "The app closed before it was sent. Nothing was spent.");
  assert.deepEqual([task("trade-o2").state, task("trade-o2").detail], ["stopped", "Check Activity for where this is."]);
  tasks.publish({ id: "trade-o3", title: "Buy $5 of BONK", steps: STEPS, startedAt: 200_500 });
  svc.set([]);
  await tick();
  assert.equal(task("trade-o3").state, "pending", "a tap of this run, its record not made yet: left to its screen");
  stop();
});

test("the record carries its task's id, the sheet and the row hand it in, and Trade's runtime keeps the tasks from its start", () => {
  const svc = readFileSync(new URL("../service.ts", import.meta.url), "utf8");
  assert.match(svc, /trade\(p: Prepared, origin\?: string, o: \{ task\?: string; tapAt\?: number \} = \{\}\): Promise<TradeRecord> \{/, "changed pin (the audit's T4): with its press");
  assert.match(svc, /\.\.\.\(task \? \{ task \} : \{\}\), hashes: \[\], startedAt: tapAt \};/);
  assert.match(readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8"), /svc\.trade\(quote\.p, undefined, \{ task: taskId, tapAt: epochOf\(at\) \}\)/, "the audit's T4: with its press");
  assert.match(readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8"), /svc\.trade\(p, `chip:\$\{r\.address\}`, \{ task: taskId, tapAt: epochOf\(at\) \}\)/);
  assert.match(readFileSync(new URL("./runtime.tsx", import.meta.url), "utf8"), /useEffect\(\(\) => \(tasks \? keepTradeTasks\(rt\.svc, tasks\) : undefined\), \[rt, tasks\]\);/);
});
