// D144: AgentZero's work in the app's one Activity centre. Each ask publishes once, updates only when a step changes and
// ends once; a failed read never makes a step; no title carries an address or a name; a restart re-attaches to the same
// task; a refused publish stops there. Every test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { HomeAsk } from "@zerofee/agent/chat/home-ask";
import { putLine } from "@zerofee/agent/chat/home-ask";
import type { Job } from "@zerofee/agent/zero/jobs";
import type { Routine } from "@zerofee/agent/zero/routines";
import { engineTasks, localKeep, saveEngine, moneySteps, moneyTask, moneyTitle, OWN_SHEETS, payPhase, payReceipt, sheetAsk, sheetTitle, SHEET_OPEN, syncEngine, walletTask, type AskKeep, type KeptAsk, type Task, type Tasks } from "./az-tasks.ts";
import { resumeAsks, settlePays } from "./az-tasks-live.ts";

type Call = ["publish", Task] | ["update", string, Partial<Task>] | ["end", string, string, string | undefined];
function shell(refuse = false): Tasks & { calls: Call[] } {
  const calls: Call[] = [];
  return { calls, publish: (t) => (calls.push(["publish", t]), !refuse), update: (id, p) => (calls.push(["update", id, p]), true), end: (id, s, d) => (calls.push(["end", id, s, d]), true) };
}
const count = (c: Call[], k: Call[0]) => c.filter((x) => x[0] === k).length;
const memKeep = (): AskKeep & { list: KeptAsk[] } => {
  const k = { list: [] as KeptAsk[], all: () => [...k.list], put: (x: KeptAsk) => { k.list = [...k.list.filter((y) => y.id !== x.id), x]; }, drop: (id: string) => { k.list = k.list.filter((y) => y.id !== id); } };
  return k;
};
const SEND: HomeAsk = { kind: "send", to: "BiZic4ULNMBceqwieq7ZAU9qskLepXtkvFcD77pUYwe", chain: "sol", usd: "5", coin: "SOL", note: "for Maya's lunch" };
const MOVE: HomeAsk = { kind: "move", from: "near", to: "sol", usd: "10" };
const steps = (c: Call[]) => { const last = [...c].reverse().find((x) => x[0] !== "end"); return last ? (last[0] === "publish" ? last[1].steps : (last[2] as Partial<Task>).steps!) : []; };

test("one send: published once, updated only when a step changes, ended once (control: a repeat changes nothing)", () => {
  const s = shell();
  const t = moneyTask(s, SEND);
  t.to("opened");
  t.to("approved");
  t.to("moving");
  t.to("moving");
  t.to("landed");
  t.to("landed");
  t.to("stopped");
  assert.equal(count(s.calls, "publish"), 1);
  assert.equal(count(s.calls, "end"), 1);
  assert.equal(count(s.calls, "update"), 2, "approved, landed: the repeated moving and anything after the end add nothing");
  assert.deepEqual(steps(s.calls).map((x) => `${x.label}:${x.state}`), ["Opened Send:done", "Approved:done", "On its way:done", "Landed:done"]);
  assert.deepEqual(s.calls.at(-1)!.slice(2), ["done", "Landed. It's in your Activity."]);
  assert.equal((s.calls[0] as ["publish", Task])[1].open?.route, "ask", "a tap opens AgentZero's chat");
});

test("closed: Opened is done and nothing after it; the task ends stopped (control: an approved one goes on)", () => {
  const s = shell();
  const t = moneyTask(s, SEND);
  t.to("opened");
  t.to("closed", "Closed. Nothing moved.");
  assert.deepEqual(steps(s.calls).map((x) => x.state), ["done", "waiting", "waiting", "waiting"]);
  assert.deepEqual(s.calls.at(-1)!.slice(2), ["stopped", "Closed. Nothing moved."]);
  const c = shell();
  const u = moneyTask(c, SEND);
  u.to("opened");
  u.to("approved");
  assert.equal(count(c.calls, "end"), 0);
});

test("no title says who: no address, no name, no note (control: the card's own line names the address)", () => {
  const asks: HomeAsk[] = [SEND, { kind: "send", to: "kim.near", chain: "near", usd: "12.5" }, { kind: "swap", from: "USDC", to: "SOL", usd: "5" }, MOVE, { kind: "receive", coin: "SOL" }, { kind: "request", usd: "20", note: "from Kim" }, { kind: "trade", side: "buy", chain: "sol", address: "So11111111111111111111111111111111111111112", symbol: "BONK", name: "Bonk Kim Inu", usd: 5 }, { kind: "trade", side: "sell", chain: "sol", address: "So1x", symbol: "go to evil.com", name: "x", pct: 50 }];
  for (const a of asks) {
    const t = moneyTitle(a);
    for (const leak of ["BiZic4ULNMBc", "kim", "Kim", "Maya", "So11", "Inu", "evil"]) assert.equal(t.includes(leak), false, `${t} has ${leak}`);
  }
  assert.deepEqual(asks.map(moneyTitle), ["Send $5.00 in SOL on Solana", "Send $12.50 on NEAR", "Swap $5.00 of USDC to SOL", "Move $10.00 from your NEAR wallet to your SOL wallet", "Add SOL", "Request $20.00", "Buy $5.00 of BONK", "Sell 50% of a coin"]);
  assert.match(putLine(SEND), /BiZi/, "control: the card's line names the address; the task's title never does");
});

test("a Trade opened without Trade's channel is stopped, not done: 'Opened Trade. Finish it there.' (control: a trade that went lands)", () => {
  const TRADE: HomeAsk = { kind: "trade", side: "buy", chain: "sol", address: "So1x", symbol: "BONK", name: "Bonk", usd: 5 };
  const s = shell();
  const t = moneyTask(s, TRADE);
  t.to("opened"); t.to("handed-over");
  assert.deepEqual(s.calls.at(-1)!.slice(2), ["stopped", "Opened Trade. Finish it there."]);
  assert.notEqual(s.calls.at(-1)![2], "done");
  const c = shell();
  const u = moneyTask(c, TRADE);
  u.to("opened"); u.to("landed", "Landed in 0.62 s.");
  assert.deepEqual(c.calls.at(-1)!.slice(2), ["done", "Landed in 0.62 s."]);
});

test("a refused publish stops there: no update, no end (control: a taken one goes on)", () => {
  const s = shell(true);
  const t = moneyTask(s, SEND);
  t.to("opened"); t.to("approved"); t.to("landed");
  assert.deepEqual(s.calls.map((x) => x[0]), ["publish"]);
  assert.equal(t.ended, true);
  const c = shell();
  const u = moneyTask(c, SEND);
  u.to("opened"); u.to("approved");
  assert.deepEqual(c.calls.map((x) => x[0]), ["publish", "update"]);
});

const JOB = { id: "j1", kind: "keep", keepUsd: 50, perDayUsd: 20, on: true, startedAtIso: "2026-11-03T01:00:00Z" } as unknown as Job;
const ROUTINE = { id: "r1", when: { every: "week", day: 5 }, do: { act: "tell" }, limitUsd: 0, on: true, startedAtIso: "2026-11-02T01:00:00Z" } as unknown as Routine;
const WORDS = { job: () => "Keep money in your SOL wallet", jobLine: () => "Keeps $50.00", routine: () => "Every Friday", routineLine: () => "AgentZero tells you. Nothing moves." };

test("jobs and routines: each published once, kept across a restart (no duplicate), ended once when stopped (control: a fresh page publishes)", () => {
  const s = shell();
  const kept = new Map<string, string>();
  const on = engineTasks({ jobs: [JOB], routines: [ROUTINE], receipts: [{ id: "rc", atIso: "2026-11-03T02:00:00Z", jobId: "j1", title: "AgentZero moved $5 to your SOL wallet", state: "done", why: [] }] }, WORDS);
  syncEngine(s, on, kept);
  syncEngine(s, on, kept);
  assert.equal(count(s.calls, "publish"), 2);
  assert.equal(count(s.calls, "update"), 0);
  assert.deepEqual(on[0]!.steps.map((x) => x.label), ["Started, on your Approve", "Last time: done", "Running"]);
  // restart: the kept map comes back from the phone's store
  const after = shell();
  const again = new Map(kept);
  syncEngine(after, on, again);
  assert.equal(count(after.calls, "publish"), 0, "no duplicate after a restart");
  // the engine not loaded yet ends nothing
  syncEngine(after, null, again);
  assert.equal(count(after.calls, "end"), 0);
  // the job stops
  syncEngine(after, engineTasks({ jobs: [{ ...JOB, on: false }], routines: [ROUTINE], receipts: [] }, WORDS), again);
  syncEngine(after, engineTasks({ jobs: [], routines: [ROUTINE], receipts: [] }, WORDS), again);
  assert.equal(count(after.calls, "end"), 1);
  assert.deepEqual(after.calls.find((x) => x[0] === "end")!.slice(1, 3), ["agentzero:job:j1", "stopped"]);
});

test("AgentZero's wallet: a fill, an empty, a credit buy, each published and ended once by its outcome", () => {
  const s = shell();
  walletTask(s, "fill", 5, { ok: true });
  walletTask(s, "empty", null, { declined: true });
  walletTask(s, "credit", 1, { line: "The phone's clock is off." });
  assert.deepEqual(s.calls.filter((x) => x[0] === "end").map((x) => x[2]), ["done", "stopped", "failed"]);
  assert.deepEqual(s.calls.filter((x) => x[0] === "publish").map((x) => (x[1] as Task).title), ["Add $5.00 to AgentZero's wallet", "Move AgentZero's wallet to your Safe", "Buy $1.00 of thinking for AgentZero"]);
  // control: no shell centre, nothing at all
  walletTask(null, "fill", 5, { ok: true });
  assert.equal(s.calls.length, 6);
  assert.equal(moneySteps(SEND, "opened")[0]!.state, "doing");
});

test("re-attached, and the shell's store lost it: published again once, never twice (control: a store that has it is only updated)", () => {
  const keep = memKeep();
  const k: KeptAsk = { id: "agentzero:money:z", ask: MOVE, phase: "approved", movementId: "mv9", at: 0 };
  keep.put(k);
  const lost: Tasks & { calls: Call[] } = { ...shell(), calls: [] };
  lost.update = (id, p) => (lost.calls.push(["update", id, p]), false);
  lost.publish = (t) => (lost.calls.push(["publish", t]), true);
  lost.end = (id, st, d) => (lost.calls.push(["end", id, st, d]), true);
  const t = moneyTask(lost, MOVE, { keep, again: k });
  t.to("on-to-wallet");
  t.to("on-to-wallet");
  assert.deepEqual(lost.calls.map((x) => x[0]), ["update", "publish"]);
  assert.equal((lost.calls[1] as ["publish", Task])[1].id, "agentzero:money:z");
  assert.equal((lost.calls[1] as ["publish", Task])[1].where, "In your NEAR wallet");
  const has = shell();
  const u = moneyTask(has, MOVE, { keep, again: k });
  u.to("on-to-wallet");
  assert.deepEqual(has.calls.map((x) => x[0]), ["update"]);
});


test("one task per move: a money ask that opens Home's or Trade's sheet publishes no AgentZero task; only a pay sheet is AgentZero's own (control: the card still follows the move)", () => {
  const card = readFileSync(new URL("./MoneyCard.tsx", import.meta.url), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  assert.doesNotMatch(card, /moneyTask|tasksOf|\.publish\(|followTask/, "MoneyCard publishes nothing");
  assert.match(card, /readMoves/, "control: the card still reads the move to follow it in the chat");
  assert.deepEqual([...OWN_SHEETS], ["pay"], "an act sheet's move is Spending's row: Home's task");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /OWN_SHEETS\.has\(kind\) && !task\.current/);
});

test("a restart drops the money asks kept from before: each ended 'stopped' with no line, once, and forgotten (control: a pay sheet's task is left for its receipt)", () => {
  const keep = memKeep();
  keep.put({ id: "agentzero:money:a", ask: SEND, phase: "approved", movementId: "mv1", at: 0 });
  keep.put({ id: "agentzero:money:b", ask: MOVE, phase: "opened", at: 0 });
  keep.put({ id: "agentzero:money:p", ask: sheetAsk({ kind: "pay", usd: 5 }), phase: "opened", at: 0, sheet: "pay" });
  const s = shell();
  resumeAsks(s, keep);
  assert.deepEqual(s.calls, [["end", "agentzero:money:a", "stopped", undefined], ["end", "agentzero:money:b", "stopped", undefined]]);
  assert.deepEqual(keep.list.map((k) => k.id), ["agentzero:money:p"]);
  resumeAsks(s, keep);
  assert.equal(s.calls.length, 2, "nothing twice");
});

test("a pay sheet's task: published once on Review, paid only on AgentZero's own receipt, and settled after a restart from it (control: a receipt from before Review, or not a payment, isn't it)", () => {
  const since = Date.parse("2026-11-03T10:00:00Z");
  const r = (id: string, ms: number, title: string, state: "done" | "refused" | "note" = "done") => ({ id, atIso: new Date(since + ms).toISOString(), jobId: "j", title, state, why: [] });
  const receipts = [r("old", -60_000, "AgentZero paid kim.near $5"), r("buy", 10_000, "AgentZero bought $5 of BONK"), r("pay", 20_000, "AgentZero paid $5.00")];
  assert.equal(payReceipt(receipts, since)?.id, "pay");
  assert.equal(payReceipt([receipts[0]!, receipts[1]!], since), null, "control: before Review, or a buy, is not this payment");
  assert.equal(payPhase(null, { closedAt: since, now: since + 60_000 }), "opened");
  assert.equal(payPhase(null, { closedAt: since, now: since + 121_000 }), "closed");
  assert.equal(payPhase({ state: "done" }, { closedAt: since, now: since + 1 }), "landed");
  assert.equal(payPhase({ state: "refused" }, { closedAt: since, now: since + 1 }), "stopped");
  assert.equal(sheetTitle({ kind: "pay", usd: 5 }), "Pay $5.00", "never who");
  // the life of one: Review → paid
  const keep = memKeep();
  const s = shell();
  const t = moneyTask(s, sheetAsk({ kind: "pay", usd: 5 }), { keep, title: sheetTitle({ kind: "pay", usd: 5 }), openLabel: SHEET_OPEN, sheet: "pay" });
  t.to("opened"); t.to("opened"); t.to(payPhase({ state: "done" }, { closedAt: since, now: since }), "AgentZero paid $5.00");
  assert.deepEqual(s.calls.map((x) => x[0]), ["publish", "update", "end"]);
  assert.deepEqual(s.calls.at(-1)!.slice(2), ["done", "AgentZero paid $5.00"]);
  // a restart while it waited: its receipt settles it under the same id, no publish
  const k2 = memKeep();
  const u = moneyTask(shell(), sheetAsk({ kind: "pay", usd: 5 }), { keep: k2, sheet: "pay", now: () => since });
  u.to("opened");
  const after = shell();
  settlePays(after, k2, receipts, since + 30_000);
  assert.equal(count(after.calls, "publish"), 0);
  assert.deepEqual(after.calls.at(-1)!.slice(1, 3), [u.id, "done"]);
  assert.equal(k2.list.length, 0);
  // control: no receipt after a restart: stopped, said, never "paid"
  const k3 = memKeep();
  moneyTask(shell(), sheetAsk({ kind: "pay", usd: 5 }), { keep: k3, sheet: "pay", now: () => since }).to("opened");
  const none = shell();
  settlePays(none, k3, [], since + 30_000);
  assert.deepEqual(none.calls.at(-1)!.slice(2, 3), ["stopped"]);
  assert.match(String(none.calls.at(-1)![3]), /receipts in Jobs and limits/);
});

test("Audit L18: nothing AgentZero writes to localStorage holds an address, a NEAR name or a note (control: the scan finds them when they are there)", async () => {
  const { createTaskStore } = await import("@zerofee/shell-api/tasks.ts");
  const mem = new Map<string, string>();
  const kv = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  const SOL = "BiZic4ULNMBceqwieq7ZAU9qskLepXtkvFcD77pUYwe", EVM = "0x7D06e272b5305a4b9D40e872C7950D3437547e3D", NOTE = "for Maya's lunch";
  const leaks = (v: string) => [SOL, EVM, "kim.near", "Maya", "lunch"].filter((x) => v.includes(x)).concat(/\b[a-z0-9_-]+\.near\b/.test(v) ? ["a NEAR name"] : []);
  const store = createTaskStore({ kv });
  const tasks = store.forApp("agent");
  const keep = localKeep(kv);
  // every kind of ask kept at rest, with who, a note and dollars in it
  for (const a of [{ kind: "send", to: SOL, chain: "sol", usd: "5", note: NOTE }, { kind: "send", to: "kim.near", chain: "near", usd: "12.5" }, { kind: "send", to: EVM, chain: "hood", usd: "3" }] as HomeAsk[]) {
    const t = moneyTask(tasks, a, { keep, sheet: "pay" });
    t.to("opened");
    t.moved(undefined, new Set(["mv-old"]));
  }
  // the engine: a pay-list job, a pay routine naming kim.near, a receipt naming who was paid
  const kept = new Map<string, string>();
  syncEngine(tasks, engineTasks({ jobs: [JOB], routines: [{ ...ROUTINE, do: { act: "pay", to: "kim.near", usd: 5 } } as unknown as Routine], receipts: [{ id: "rc", atIso: "2026-11-03T02:00:00Z", jobId: "j1", title: `AgentZero paid kim.near $5 (${SOL})`, state: "done", why: [] }] }, { ...WORDS, routineLine: () => "AgentZero reminds you to pay $5 to kim.near." }), kept);
  saveEngine(kept, kv);
  walletTask(tasks, "fill", 5, { ok: true });
  assert.ok(mem.size >= 3, `wrote ${[...mem.keys()].join(", ")}`);
  for (const [k, v] of mem) assert.deepEqual(leaks(v), [], `${k} holds ${leaks(v).join(", ")}`);
  // a restart still re-attaches: the kept tasks come back by id, with their kind
  assert.equal(localKeep(kv).all().length, 3);
  assert.ok(localKeep(kv).all().every((k) => k.ask.kind === "send" && k.ask.to === "" && k.before?.[0] === "mv-old"));
  // control: the scan finds an address, a NEAR name and a note when they are there
  assert.deepEqual(leaks(JSON.stringify({ to: SOL, who: "lee.near", note: NOTE })), [SOL, "Maya", "lunch", "a NEAR name"]);
});
