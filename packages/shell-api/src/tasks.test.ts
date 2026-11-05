// D144: the Activity centre's store. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TASK_APPS, createTaskStore, KEPT_MS, TASKS_KEY, type TaskInput } from "./tasks.ts";

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const T0 = Date.parse("2026-11-03T10:00:00Z");
const move: TaskInput = { id: "m1", title: "Move $5.00 to your SOL wallet", steps: [{ label: "Left your Safe", state: "done", at: T0 }, { label: "Through NEAR privately", state: "doing" }, { label: "Arriving in your SOL wallet", state: "waiting" }] };

test("an app writes only its own tasks: the shell stamps the app; another app can't update, end or name one it doesn't own", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const home = s.forApp("wallet"), trade = s.forApp("trade"), agent = s.forApp("agent");
  assert.equal(home.publish({ ...move, app: "trade" }), false, "Home can't publish as Trade");
  assert.equal(home.publish(move), true);
  assert.equal(s.list()[0]!.app, "home", "stamped from the caller");
  assert.equal(trade.update("m1", { title: "Mine now" }), false, "Trade can't update Home's task");
  assert.equal(agent.end("m1", "failed"), false, "nor can AgentZero end it");
  assert.equal(s.list()[0]!.title, "Move $5.00 to your SOL wallet");
  assert.equal(s.list()[0]!.state, "pending");
  // control: the owner can
  assert.equal(home.update("m1", { steps: [{ label: "Left your Safe", state: "done" }] }), true);
  assert.equal(home.end("m1", "done"), true);
  assert.equal(s.list()[0]!.state, "done");
  // the same id in two apps is two tasks; perps may come from Trade or the Browser, never from Home
  assert.equal(trade.publish({ ...move, title: "Buy BONK" }), true);
  assert.equal(s.list().length, 2);
  assert.equal(trade.publish({ ...move, id: "p1", app: "perps" }), true);
  assert.equal(s.forApp("browser").publish({ ...move, id: "p2", app: "perps" }), true);
  assert.equal(home.publish({ ...move, id: "p3", app: "perps" }), false);
  assert.equal(s.forApp("nobody").publish(move), false, "an app that owns no task app writes nothing");
});

test("the badge counts pending only (control: done, failed and stopped don't count)", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const home = s.forApp("wallet");
  for (const id of ["a", "b", "c", "d"]) home.publish({ ...move, id });
  assert.equal(s.pending(), 4);
  home.end("a", "done"); home.end("b", "failed"); home.end("c", "stopped");
  assert.equal(s.pending(), 1);
  assert.equal(s.list().length, 4, "ended ones are still listed (Earlier)");
});

test("tasks survive a restart: a new store over the same phone's record has them (control: another phone's record is empty)", () => {
  const kv = memory();
  const s = createTaskStore({ kv, now: () => T0 });
  s.forApp("wallet").publish(move);
  s.forApp("trade").publish({ ...move, id: "t1", title: "Buy BONK" });
  s.forApp("trade").end("t1", "done");
  const again = createTaskStore({ kv, now: () => T0 + 60_000 });
  assert.deepEqual(again.list().map((t) => [t.app, t.id, t.state]).sort(), [["home", "m1", "pending"], ["trade", "t1", "done"]]);
  assert.equal(again.pending(), 1);
  assert.equal(again.forApp("wallet").end("m1", "done"), true, "and the app still owns it after the restart");
  assert.deepEqual(createTaskStore({ kv: memory() }).list(), []);
  kv.setItem(TASKS_KEY, "{not json");
  assert.deepEqual(createTaskStore({ kv }).list(), [], "a damaged record is no record, never a crash");
});

test("an ended task is kept 24 h, then dropped; a pending one is never dropped by age", () => {
  let now = T0;
  const kv = memory();
  const s = createTaskStore({ kv, now: () => now });
  const home = s.forApp("wallet");
  home.publish({ ...move, id: "old" }); home.end("old", "done");
  home.publish({ ...move, id: "going" });
  now = T0 + KEPT_MS - 1;
  assert.deepEqual(s.list().map((t) => t.id).sort(), ["going", "old"], "control: just under 24 h, still kept");
  now = T0 + KEPT_MS + 1;
  assert.deepEqual(s.list().map((t) => t.id), ["going"]);
  assert.deepEqual(createTaskStore({ kv, now: () => T0 + 3 * KEPT_MS }).list().map((t) => t.id), ["going"], "after a restart too");
});

test("a task is kept as its known fields only, and nothing reaches the network", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  s.forApp("wallet").publish({ ...move, steps: [...move.steps, { label: "", state: "done" }, { label: "x", state: "nope" as never }], ...({ secret: "k" } as object) } as TaskInput);
  const t = s.list()[0]!;
  assert.equal(t.steps.length, 3, "a step with no label or an unknown state is dropped");
  assert.equal("secret" in t, false);
  const src = readFileSync(new URL("./tasks.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|WebSocket|bridge\.call/, "local only");
});

test("the shell hands every app its own tasks, stamped by the app's id (a site's own app, \"site:pump\", writes the Browser's)", () => {
  const host = readFileSync(new URL("../../../apps/web/src/shell/AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /tasks: taskStore\(\)\.forApp\(taskApp\(app\.id\)\)/);
  assert.match(host, /export const taskApp = \(id: string\): string => \(id\.startsWith\("site:"\) \? "social" : id\);/, "only a site page maps; every other app is its own");
  // control: the Browser's task apps are what a site page writes into (its Adds, Take outs and sign-ins)
  assert.ok(TASK_APPS.social?.includes("browser"));
  assert.match(host, /tasks: taskStore\(\)\.forApp\("wallet"\)/, "the money sheet's context is Wallet's");
});

test("tasks.open asks the centre to open, all of it or one app's group; an unknown app opens it whole (control: no ask, no open)", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  let told = 0;
  s.subscribe(() => told++);
  assert.deepEqual(s.openAsk(), { seq: 0 }, "control: nothing asked");
  s.forApp("agent").open({ app: "agentzero" });
  assert.deepEqual(s.openAsk(), { seq: 1, app: "agentzero" });
  s.forApp("trade").open();
  assert.deepEqual(s.openAsk(), { seq: 2 });
  s.forApp("chat").open({ app: "nope" as never });
  assert.deepEqual(s.openAsk(), { seq: 3 }, "an app the centre doesn't know: the whole centre");
  assert.equal(told, 3, "the frames are told each time");
  assert.equal(s.list().length, 0, "opening writes no task");
});

test("S3: a trade's task keeps its public transactions (chain and id), only real ids, and the centre draws Copy and View under the row", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const trade = s.forApp("trade");
  const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYVCJjBRAxN3Rh2SA6S5aBwX1bK2V9pD8Mh4M2xr6qXu3kH2z9y6Ab";
  const evm = `0x${"ab".repeat(32)}`;
  assert.ok(trade.publish({ id: "t1", title: "Sell $1.52 of DemWifHat", steps: [] }));
  assert.ok(trade.update("t1", { proof: [{ chain: "sol", hash: sig }, { chain: "bsc", hash: evm }, { chain: "sol", hash: "not a hash" }, { chain: "SOL!", hash: sig }] as never }));
  assert.deepEqual(s.list()[0]!.proof, [{ chain: "sol", hash: sig }, { chain: "bsc", hash: evm }]);
  // control: a task with no proof keeps none
  assert.ok(trade.publish({ id: "t2", title: "Buy $5 of BONK", steps: [] }));
  assert.equal(s.list().find((t) => t.id === "t2")!.proof, undefined);
  const centre = readFileSync(new URL("./TaskCentre.tsx", import.meta.url), "utf8");
  assert.match(centre, /\{t\.proof\?\.map\(\(x\) => <TxProofLine /);
  assert.match(readFileSync(new URL("./TxProofLine.tsx", import.meta.url), "utf8"), /const url = txUrl\(tx\.chain, tx\.hash\);/);
  assert.match(centre, /import \{ TxProofLine \} from "\.\/TxProofLine\.tsx";/, "one proof line, shared with the web Send's receipt");
  const sheet = readFileSync(new URL("../../trade/src/app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /proof: \(rec\.hashes \?\? \[\]\)\.map\(\(hash\) => \(\{ chain: coin\.chain, hash \}\)\)/, "a landed trade hands its ids to its task");
});
