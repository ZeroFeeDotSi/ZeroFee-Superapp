// The Activity walk (6 Nov, $ZEROFEE_HOME/sim-crawls/2026-11-06-activity-walk/WALK.md) and the owner's named bug: the
// ended list didn't show the LAST job that ended. One table per cause, each with its control; no wall clock (every time
// is an injected number).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../types.ts";
import type { Task } from "@zerofee/shell-api/tasks.ts";
import { createTaskStore } from "@zerofee/shell-api/tasks.ts";
import { createJobCarry, carried } from "@zerofee/shell-api/job-carry.ts";
import { startJob } from "@zerofee/shell-api/job-start.ts";
import { activityRows, byEnd, endedNow, endsOf, foldJobs, onScreen, rowEndIso, rowFace, sendRowOf } from "./activity-rows.ts";
import { homeFrom, spendingFacts } from "./statement.ts";
import { describe as describeRow } from "./format.ts";

const T = Date.UTC(2026, 10, 6, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const move = (o: Partial<SpendingActivity> = {}): SpendingActivity => ({ id: "mv-a", kind: "top-up", usd: "50.00", status: "on-its-way", shown: true, atIso: iso(T), words: "Moving $50.00 to your SOL wallet", goesTo: ["sol"], via: "private", paid: ["pocket-send:a"], ...o });
const doneMove = (o: Partial<SpendingActivity> = {}) => move({ status: "done", landed: ["sol"], paidDone: true, words: "Moved $50.00 to your SOL wallet", ...o });
const task = (o: Partial<Task>): Task => ({ id: "move:mv-a", app: "home", title: "Move $50.00 to your SOL wallet", steps: [], state: "done", startedAt: T, ...o } as Task);
const send = (o: Partial<Movement> = {}): Movement => ({ id: "pocket-send:s1", kind: "pay", status: "done", from: "private", to: "bob.near", amount: "5.6433", startedAtIso: iso(T), updatedAtIso: iso(T + 20_000), explorerUrls: [], private: true, ...o } as Movement);

test("cause 1 (bug): a job the store says ended is on the list at once, though our copy of its row still says going", () => {
  const record = activityRows([], [move()]);
  const now = T + 70_000;
  const table: [label: string, ends: Map<string, ReturnType<typeof endsOf> extends Map<string, infer E> ? E : never>, shown: number][] = [
    ["no end in the store: its live card is its one row (control)", new Map(), 0],
    ["ended done in the store (the live watch's 4 s read, no spending.changed)", endsOf([task({ state: "done", endedAt: T + 65_000, where: "It's in your SOL wallet." })]), 1],
    ["ended failed in the store", endsOf([task({ state: "failed", endedAt: T + 65_000, detail: "It didn't go." })]), 1],
    ["another job ended (control)", endsOf([task({ id: "move:mv-other", endedAt: T + 65_000 })]), 0],
    ["a pending task is no end (control)", endsOf([task({ state: "pending" })]), 0],
  ];
  for (const [label, ends, shown] of table) assert.equal(onScreen(record, now, ends).spending.length, shown, label);
  // and a Send the live watch ended
  const going = send({ status: "moving", updatedAtIso: iso(T) });
  assert.equal(onScreen({ ledger: [going], spending: [] }, T + 1000).ledger.length, 0, "control: going, its card");
  assert.equal(onScreen({ ledger: [going], spending: [] }, T + 1000, endsOf([task({ id: "send:pocket-send:s1" })])).ledger.length, 1, "ended in the store: its row");
});

test("cause 1: the stale row's face is the store's end (line and mark) until our own read says it", () => {
  const ends = endsOf([task({ state: "done", endedAt: T + 65_000, where: "It's in your SOL wallet." })]);
  assert.deepEqual(rowFace(move(), ends, T + 70_000), { line: "It's in your SOL wallet.", mark: "on" });
  const bad = endsOf([task({ state: "failed", endedAt: T + 65_000, detail: "It didn't go. Your money is in Private." })]);
  assert.deepEqual(rowFace(move(), bad, T + 70_000), { line: "It didn't go. Your money is in Private.", mark: "bad" });
  // control: our own copy ended: its own face, whatever the store says
  assert.equal(rowFace(doneMove(), ends, T + 70_000).mark, "on");
  assert.notEqual(rowFace(doneMove(), ends, T + 70_000).line, "It's in your SOL wallet.");
});

test("cause 1: the list reads its rows again on the tick a Home task ends (endedNow)", () => {
  const p = new Set(["move:mv-a"]);
  const table: [label: string, list: { app: string; id: string; state: string }[], read: boolean][] = [
    ["still pending (control)", [{ app: "home", id: "move:mv-a", state: "pending" }], false],
    ["ended done", [{ app: "home", id: "move:mv-a", state: "done" }], true],
    ["ended failed", [{ app: "home", id: "move:mv-a", state: "failed" }], true],
    ["gone from the store", [], true],
    ["another app's task ended (control)", [{ app: "home", id: "move:mv-a", state: "pending" }, { app: "trade", id: "x", state: "done" }], false],
  ];
  for (const [label, list, read] of table) assert.equal(endedNow(p, list), read, label);
  // the wiring: Activity reads on the store's change, not only on spending.changed
  const src = readFileSync(new URL("./screens/Activity.tsx", import.meta.url), "utf8");
  assert.match(src, /store\.subscribe\(\(\) => \{\s*const list = store\.list\(\);\s*if \(endedNow\(pending, list\)\) read\(\);/);
  assert.match(src, /onScreen\(record, Date\.now\(\), ends, going\)/);
});

test("cause 2: rows sort by their END, so a Move that ended last is on top (control: by start it sat under a Send)", () => {
  // the Move started at T and ended at T + 120 s; a Send started at T + 10 s and ended at T + 30 s
  const m = doneMove();
  const s = send({ startedAtIso: iso(T + 10_000), updatedAtIso: iso(T + 30_000) });
  const ends = endsOf([task({ state: "done", endedAt: T + 120_000 })]);
  const order = byEnd([s], [m], ends).map((r) => ("ledger" in r ? "send" : "move"));
  assert.deepEqual(order, ["move", "send"], "the Move ended last: on top");
  // control: main's rule (Spending rows by atIso, their start) put it under the Send
  const byStart = [{ at: s.updatedAtIso, k: "send" }, { at: m.atIso, k: "move" }].sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.k);
  assert.deepEqual(byStart, ["send", "move"]);
  // after a reload with no task kept: the latest of its legs' and parts' times
  const legged = { ...m, legs: [{ ...m, id: "leg-1", atIso: iso(T + 90_000) }] };
  assert.equal(rowEndIso(legged), iso(T + 90_000));
  assert.equal(rowEndIso(m), iso(T), "control: no end known, its own time");
});

test("cause 3: one Move is one row: its core moves fold by their job, each part keeps its own figure; the worst state shows", () => {
  const eth = doneMove({ id: "mv-eth", kind: "move", usd: "12.92", network: "hood", to: "sol", atIso: iso(T + 2000) });
  const safe = move({ id: "mv-safe", usd: "152.08", atIso: iso(T) });
  const job = (id: string) => (id === "mv-eth" || id === "mv-safe" ? "move:mv-safe" : undefined);
  const rows = foldJobs([eth, safe, doneMove({ id: "mv-other" })], job);
  assert.equal(rows.length, 2);
  const one = rows.find((r) => r.id === "mv-safe")!;
  assert.deepEqual(one.parts?.map((p) => [p.id, p.usd]), [["mv-eth", "12.92"]]);
  assert.equal(one.status, "on-its-way", "one part still going: the job is going");
  assert.equal(foldJobs([eth, { ...safe, status: "failed" }], job)[0]!.status, "failed");
  // control: no job carried, two rows as before (the record: the Statement, AgentZero)
  assert.equal(foldJobs([eth, safe], () => undefined).length, 2);
  assert.equal(activityRows([], [eth, safe]).spending.length, 2, "the record keeps every move");
  assert.equal(activityRows([], [eth, safe], job).spending.length, 1, "Activity's screen: one row");
});

test("cause 3: the job's id rides on each core row it made (job-start made()), and survives a reload (the sealed carry)", () => {
  const store = createTaskStore();
  const tasks = store.forApp("wallet");
  const j = startJob(tasks, { title: "Move $165.00 to your SOL wallet", usd: "$165.00", id: "move:mv-safe" }, { store });
  j.made(["move:mv-safe", "move:mv-safe", "move:mv-eth"]);
  assert.equal(carried("move:mv-eth")?.job, "move:mv-safe");
  assert.equal(carried("move:mv-safe")?.job, "move:mv-safe");
  // control: a job of one core row carries no job (nothing to fold)
  const k = startJob(tasks, { title: "Move $5.00 to your SOL wallet", usd: "$5.00", id: "move:mv-solo" }, { store });
  k.made(["move:mv-solo"]);
  assert.equal(carried("move:mv-solo")?.job, undefined);
  // the sealed copy keeps it
  const c = createJobCarry(new Map(), () => T);
  c.keep(JSON.stringify({ "move:mv-eth": { at: T, usd: "$165.00", job: "move:mv-safe" }, "move:bad": { at: T, job: "<script>" } }), () => {});
  assert.equal(c.get("move:mv-eth")?.job, "move:mv-safe");
  assert.equal(c.get("move:bad")?.job, undefined, "control: a damaged job id is dropped");
});

test("item 8: money coming home says the wallet it left from, never the NEAR wallet it went through", () => {
  const table: [Partial<SpendingActivity>, string][] = [
    [{ network: "sol" }, "SOL wallet"],
    [{ legs: [{ network: "sol" } as SpendingActivity] }, "SOL wallet"],
    [{ legs: [{ network: "sol" } as SpendingActivity, { network: "hood" } as SpendingActivity] }, "SOL wallet and ETH (RH) wallet"],
    [{}, "NEAR wallet"],
  ];
  for (const [o, from] of table) assert.equal(homeFrom(o), from, JSON.stringify(o));
  const home = move({ kind: "put-away", words: "Bringing $29.00 back from Solana", network: "sol", goesTo: undefined });
  assert.deepEqual(spendingFacts(home).find((f) => f.label === "From")?.value, "SOL wallet");
  // control: a Move the Safe filled still says Safe; one Private paid whole says Private (J3, the audit's MUST 1, 7 Nov)
  assert.equal(spendingFacts(move({ paid: ["safe-send:a"], fill: "done" })).find((f) => f.label === "From")?.value, "Safe");
  assert.equal(spendingFacts(move()).find((f) => f.label === "From")?.value, "Private");
});

test("item 7: a Send keeps its job's name and figure when it ends (never \"Paid · 5.6433 NEAR\")", () => {
  const r = sendRowOf(send(), "$25.00");
  assert.deepEqual(r, { title: "Send $25.00 to bob.near", usd: "$25.00", line: "From Private" }, "J3-4: the line where it left from only");
  assert.equal(sendRowOf(send({ status: "moving" }), "$25.00")?.title, "Send $25.00 to bob.near", "the same name while it goes");
  // control: a payment this phone didn't make (no carried figure): the ledger's own words
  assert.equal(sendRowOf(send(), undefined), null);
});

test("item 5: rows say Private by its name and dollars first, never \"private balance\" or a raw coin first", () => {
  const usdc = "17208a7a4b2c8f1c1e2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b";
  const tokens = new Map([[usdc, { id: usdc, symbol: "USDC", decimals: 6, priceUsd: 1 }], ["nep141:wrap.near", { id: "nep141:wrap.near", symbol: "NEAR", decimals: 24, priceUsd: 4.43 }]]) as never;
  const into = describeRow({ id: "p1", kind: "private", status: "done", from: usdc, to: "private", amount: "200", startedAtIso: iso(T), updatedAtIso: iso(T) } as Movement, tokens, []);
  assert.equal(into.title, "Moved to Private");
  assert.equal(into.detail, "Into Private from your Safe.", "its dollars are the row's right column, said once");
  const paid = describeRow(send({ to: "bob.near", from: usdc, amount: "25" }), tokens, []);
  assert.equal(paid.detail, "From Private · to bob.near");
  // control: no price, the coin stays (never a row with no figure)
  assert.match(describeRow(send({ to: "bob.near", from: "nep141:unknown.near" }), tokens, []).detail, /^5\.6433 +from Private/);
  for (const d of [into, paid]) assert.doesNotMatch(`${d.title} ${d.detail}`, /private balance/);
});

test("item 9: the Account tab reads again when something was approved, never \"Nothing yet.\" from a read on opening only", () => {
  const src = readFileSync(new URL("../../../../apps/web/src/apps/security/SecurityApp.tsx", import.meta.url), "utf8");
  assert.match(src, /ACCOUNT_CHANGED = \["spending\.changed", "ledger\.balancesChanged"\]/);
  assert.match(src, /const offs = ACCOUNT_CHANGED\.map\(\(ev\) => bridge\.on\(ev, \(\) => read\(true\)\)\);/);
  assert.match(src, /if \(!quiet\) setProblem\(res\.problem\);/, "a failed quiet read keeps the rows");
});
