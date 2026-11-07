// QA 16's MUST on T12 (8 Nov): is Trade's runtime (TradeProvider) there at a cold start on Home? Not for sure. The shell
// draws an app only when it is on screen, kept, or Home's neighbour after NEIGHBOURS_AFTER_MS; a tray with Trade moved
// away never mounts it, and even beside Home TradeProvider asks for the open trades again (svc.resume) only once Trade is
// on screen. So T12's reload follow-up didn't run on a start that never opened Trade. Now the shell starts Trade's
// follower once Home is up (App.tsx startHome, trade-follow.ts): the rows kept to their records and the open trades
// looked at again, with one keeper per service shared with TradeProvider's. Fails on t12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { TradeRecord } from "../service.ts";
import { tradeProblems } from "../trade-problems.ts";
import { keepTradeTasks } from "./trade-tasks.ts";
import { followTrades } from "./trade-follow.ts";
import { orderFor, pageOrder } from "../../../../apps/web/src/shell/tray.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const tasks = taskStore().forApp("trade");
const task = (id: string) => taskStore().list().find((t) => t.id === id)!;
const STEPS = [{ label: "Sent", state: "done" as const, at: 1 }, { label: "Landed", state: "done" as const, at: 2 }, { label: "In your SOL wallet", state: "done" as const, at: 3 }];
const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 5, hashes: ["h"], startedAt: 0, ...o });
const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeSvc(list: TradeRecord[]) {
  let now = list, resumes = 0, ons = 0;
  const fns = new Set<() => void>();
  return {
    activity: async () => now,
    on: (f: () => void) => { ons++; fns.add(f); return () => fns.delete(f); },
    resume: async () => { resumes++; },
    set(l: TradeRecord[]) { now = l; for (const f of [...fns]) f(); },
    get resumes() { return resumes; }, get ons() { return ons; }, get listeners() { return fns.size; },
  };
}

test("the proof: Trade's screen isn't there at a cold start on Home for sure, and mounted it doesn't look at open trades until it is on screen", () => {
  const host = read("../../../../apps/web/src/shell/AppHost.tsx");
  assert.match(host, /const shown = kept\.current\.has\(app\.id\) \|\| i === index \|\| \(near && Math\.abs\(i - index\) <= 1\);/, "an app is drawn only on screen, kept, or Home's neighbour once `near`");
  const ids = ["wallet", "trade", "social", "agent", "site:trading", "chat"];
  const at = (saved: string[] | null) => pageOrder(ids.map((id) => ({ id })), orderFor(ids, saved)).findIndex((a) => a.id === "trade");
  assert.equal(at(null), 1, "the default order: Trade beside Home, drawn only after NEIGHBOURS_AFTER_MS");
  assert.ok(at(["wallet", "social", "agent", "site:trading", "trade"]) - 0 > 1, "Trade moved in the tray: never Home's neighbour, never mounted at the start");
  assert.match(read("./runtime.tsx"), /if \(active && !resumed\) \{ setResumed\(true\); void rt\.svc\.resume\(\)/, "TradeProvider looks again only once Trade is on screen");
});

test("the shell starts Trade's follower once Home is up, with Trade's own bridge, and stops it with Home", () => {
  const app = read("../../../../apps/web/src/App.tsx");
  assert.match(app, /void import\("@zerofee\/trade\/app\/trade-follow\.ts"\)\.then\(\(m\) => \{ if \(!gone\) stopTrades = m\.followTrades\(appBridge\("trade"\)\); \}\)/);
  assert.match(app, /return \(\) => \{ gone = true; stopBacks\?\.\(\); stopTrades\?\.\(\); stop\(\); \};/);
  assert.match(read("./trade-follow.ts"), /const svc: Svc = o\.svc \?\? runtimeFor\(bridge\)\.svc;/, "the very runtime Trade's screen uses (runtimeFor by bridge)");
});

test("a reload that never opens Trade: a row whose trade turned after done is rewritten, a landed one ends done, and the open trades are looked at again", async () => {
  tasks.publish({ id: "trade-f1", title: "Buy $5 of DOPE", steps: STEPS, startedAt: 100 });
  tasks.end("trade-f1", "done");
  tasks.publish({ id: "trade-f2", title: "Buy $5 of WIF", steps: STEPS, startedAt: 100 });
  const svc = fakeSvc([rec({ id: "a", task: "trade-f1", status: "expired", problem: tradeProblems.expired("DOPE") }), rec({ id: "b", task: "trade-f2", status: "unconfirmed", symbol: "WIF", problem: tradeProblems.unconfirmed("WIF") })]);
  const stop = followTrades({} as never, { svc, tasks });
  await tick();
  assert.equal(svc.resumes, 1, "the open trades looked at again at Home's start");
  assert.equal(task("trade-f1").state, "failed");
  assert.equal(task("trade-f2").state, "pending", "still checking: going");
  svc.set([rec({ id: "b", task: "trade-f2", status: "done", symbol: "WIF", endedAt: 50 })]);
  await tick();
  assert.equal(task("trade-f2").state, "done", "its check cleared with Trade never opened");
  stop();
  assert.equal(svc.listeners, 0);
});

test("one keeper per service: Trade's own joins the shell's, and the rows are kept until the last lets go", async () => {
  const svc = fakeSvc([]);
  const shell = followTrades({} as never, { svc, tasks });
  const trade = keepTradeTasks(svc, tasks);
  assert.equal(svc.ons, 1, "one keeper listens");
  trade();
  trade();
  assert.equal(svc.listeners, 1, "Trade's screen gone: the shell's still keeps them");
  tasks.publish({ id: "trade-f3", title: "Buy $5 of BONK", steps: STEPS, startedAt: 100 });
  svc.set([rec({ id: "c", task: "trade-f3", status: "declined", hashes: [] })]);
  await tick();
  assert.equal(task("trade-f3").state, "stopped");
  shell();
  assert.equal(svc.listeners, 0);
  const again = keepTradeTasks(svc, tasks);
  assert.equal(svc.ons, 2, "a new keeper once all let go");
  again();
});

test("before this run means before this page loaded: a keeper started later never ends a row of this page", async () => {
  tasks.publish({ id: "trade-f4", title: "Buy $5 of POPCAT", steps: STEPS.map((s) => ({ ...s, state: "waiting" as const })), startedAt: Date.now() });
  const svc = fakeSvc([]);
  const stop = keepTradeTasks(svc, tasks);
  await tick();
  assert.equal(task("trade-f4").state, "pending", "a tap of this page whose record isn't made yet: its screen's");
  stop();
  assert.match(read("./trade-tasks.ts"), /const born = o\.now \? now\(\) : pageBorn\(\);/);
});
