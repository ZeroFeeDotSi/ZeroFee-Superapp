// the audit's Trade audit T2 (8 Nov): a trade that turns after "done" never updated its Jobs row or the open receipt. The sheet
// and the list row ended the task "done" (at 1.6 s, or at once on the row) and nothing listened after that: a Rhea buy
// done on one node's word whose coin Ref kept said "Landed in 0.9 s · In your NEAR wallet" in Jobs while Activity said
// "Your X didn't reach your NEAR wallet."; a Solana buy one node said landed and two said expired stayed "Bought". Now the
// task follows its record by id until its check clears (followTurn), and a turn rewrites the task's end (turnTask), the
// open receipt and the row (turnOf). Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { taskStore } from "@zerofee/shell-api/tasks.ts";
import type { TradeRecord } from "../service.ts";
import { tradeProblems } from "../trade-problems.ts";
import { followTurn, turnOf, turnTask } from "./trade-turn.ts";

const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "t1", kind: "buy", chain: "sol", symbol: "DOPE", status: "done", amountUsd: 5, hashes: ["h1"], startedAt: 0, ...o });
function fakeSvc(first: TradeRecord) {
  let now = first;
  const fns = new Set<() => void>();
  return {
    activity: async () => [now],
    on: (f: () => void) => { fns.add(f); return () => fns.delete(f); },
    set(r: TradeRecord) { now = r; for (const f of [...fns]) f(); },
    get listening() { return fns.size; },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("what a turn says: two nodes failed / expired, Ref kept the coin, final unchecked, back to unconfirmed; a clean done is no turn", () => {
  assert.equal(turnOf(rec({ verifying: true })), null, "still checking: no turn");
  assert.equal(turnOf(rec({})), null, "booked: no turn");
  const failed = turnOf(rec({ status: "failed", problem: tradeProblems.reverted("DOPE") }))!;
  assert.deepEqual([failed.task, failed.row.phase, failed.moment], ["failed", "refused", "refused"]);
  assert.equal(failed.detail, tradeProblems.reverted("DOPE").whatHappened);
  assert.equal(failed.feeTaken, true, "it landed on the chain and reverted: its fee went");
  const expired = turnOf(rec({ status: "expired", problem: tradeProblems.expired("DOPE") }))!;
  assert.deepEqual([expired.task, expired.row.phase, expired.feeTaken], ["failed", "refused", false]);
  const kept = turnOf(rec({ chain: "near", problem: tradeProblems.rheaKept("DOPE") }))!;
  assert.deepEqual([kept.task, kept.row.phase, kept.row.why, kept.moment], ["failed", "refused", "Your DOPE didn't reach your NEAR wallet.", "problem"]);
  const unsure = turnOf(rec({ chain: "near", problem: tradeProblems.finalUnchecked("DOPE") }))!;
  assert.deepEqual([unsure.task, unsure.row.phase, unsure.moment], ["stopped", "checking", "problem"]);
  const back = turnOf(rec({ status: "unconfirmed", problem: tradeProblems.unconfirmed("DOPE") }))!;
  assert.deepEqual([back.task, back.row.phase, back.moment], ["stopped", "checking", "checking"]);
});

test("the Jobs row: a task ended done is rewritten by the turn, its words and the step that failed", () => {
  const tasks = taskStore().forApp("trade");
  tasks.publish({ id: "trade-turn-1", title: "Buy $5 of DOPE", steps: [{ label: "Sent", state: "done", at: 1 }, { label: "Landed", state: "done", at: 2 }, { label: "In your NEAR wallet", state: "done", at: 3 }] });
  tasks.end("trade-turn-1", "done");
  turnTask(tasks, "trade-turn-1", turnOf(rec({ chain: "near", problem: tradeProblems.rheaKept("DOPE") }))!, { taskAt: 1, wallet: "In your NEAR wallet" });
  const t = taskStore().list().find((x) => x.id === "trade-turn-1")!;
  assert.equal(t.state, "failed");
  assert.equal(t.detail, "Your DOPE didn't reach your NEAR wallet.");
  assert.deepEqual(t.steps.map((s) => [s.label, s.state]), [["Sent", "done"], ["Landed", "done"], ["In your NEAR wallet", "failed"]]);
  tasks.publish({ id: "trade-turn-2", title: "Buy $5 of DOPE", steps: [] });
  tasks.end("trade-turn-2", "done");
  turnTask(tasks, "trade-turn-2", turnOf(rec({ status: "expired", problem: tradeProblems.expired("DOPE") }))!, { taskAt: 1, wallet: "In your SOL wallet" });
  const e = taskStore().list().find((x) => x.id === "trade-turn-2")!;
  assert.deepEqual(e.steps.map((s) => [s.label, s.state]), [["Sent", "done"], ["Landed", "failed"], ["In your SOL wallet", "waiting"]]);
  assert.equal(e.state, "failed");
});

test("followTurn: follows the record by id while it is checking, calls the turn once, then stops; a clean booking stops it with no call", async () => {
  const svc = fakeSvc(rec({ verifying: true }));
  const seen: string[] = [];
  followTurn(svc, "t1", (r, t) => seen.push(`${r.status}:${t.task}`));
  await tick();
  assert.equal(svc.listening, 1, "still checking: it listens");
  svc.set(rec({ status: "expired", problem: tradeProblems.expired("DOPE") }));
  await tick();
  svc.set(rec({ status: "failed", problem: tradeProblems.reverted("DOPE") }));
  await tick();
  assert.deepEqual(seen, ["expired:failed"], "once");
  assert.equal(svc.listening, 0);
  const clean = fakeSvc(rec({ verifying: true }));
  const none: string[] = [];
  followTurn(clean, "t1", () => none.push("x"));
  clean.set(rec({}));
  await tick();
  assert.deepEqual([none, clean.listening], [[], 0], "booked: no turn, no listener left");
  // control: a record that already turned before the follow began turns at the first look
  const early = fakeSvc(rec({ chain: "near", problem: tradeProblems.rheaKept("DOPE") }));
  const got: string[] = [];
  followTurn(early, "t1", (_r, t) => got.push(t.task));
  await tick();
  assert.deepEqual(got, ["failed"]);
});

test("the sheet and the list row hand every landed trade to followTurn, and the sheet's 1.6 s done never ends a turned task", () => {
  const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  const disc = readFileSync(new URL("./screens/Discover.tsx", import.meta.url), "utf8");
  // changed pin (S6, QA 16): the sheet's writes go through its job (withLead: a sale after its fee keeps that step first)
  assert.match(sheet, /followTurn\(svc, rec\.id, \(r, t\) => \{ turned = true; turnTask\(job, taskId, t, \{ taskAt, wallet: walletStep \}\);/);
  assert.match(sheet, /setTimeout\(\(\) => \{ if \(turned\) return; /);
  assert.match(disc, /followTurn\(svc, rec\.id, \(_r, t\) => \{ turnTask\(tasks, taskId, t, \{ taskAt, wallet: walletStep \}\); onState\(\{ phase: t\.row\.phase, at, got, \.\.\.\(t\.row\.why \? \{ why: t\.row\.why \} : \{\}\) \}\); \}\);/);
});
