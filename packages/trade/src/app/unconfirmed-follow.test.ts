// The not-confirmed card follows its record (unconfirmed-follow.ts): it ends once, the moment the record does; a record
// still on its way never ends it; the thrown Problem names its record.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TradeRecord } from "../service.ts";
import { tradeProblems } from "../trade-problems.ts";
import { followRecord, recordOf } from "./unconfirmed-follow.ts";

function fakeSvc(list: TradeRecord[]) {
  const ls = new Set<() => void>();
  return { svc: { on: (f: () => void) => { ls.add(f); return () => { ls.delete(f); }; }, activity: async () => [...list] }, tell: () => ls.forEach((f) => f()), listeners: () => ls.size };
}
const turns = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r)); };
const rec = (o: Partial<TradeRecord>): TradeRecord => ({ id: "r1", kind: "buy", chain: "sol", symbol: "WIF", status: "unconfirmed", amountUsd: 25, hashes: ["h"], startedAt: 1, ...o });

test("followRecord: still unconfirmed, nothing; landed, ends once with the record and stops listening", async () => {
  const r = rec({});
  const f = fakeSvc([r]);
  const ended: string[] = [];
  followRecord(f.svc, "r1", (x) => ended.push(x.status));
  f.tell(); await turns();
  assert.deepEqual(ended, [], "on its way: the card stays");
  r.status = "done";
  f.tell(); f.tell(); await turns();
  assert.deepEqual(ended, ["done"], "once");
  assert.equal(f.listeners(), 0);
});

test("followRecord: a proven expiry ends it too; the stop ends the follow before", async () => {
  const r = rec({});
  const f = fakeSvc([r]);
  const ended: string[] = [];
  followRecord(f.svc, "r1", (x) => ended.push(x.status));
  r.status = "expired";
  f.tell(); await turns();
  assert.deepEqual(ended, ["expired"]);
  const g = fakeSvc([rec({ status: "done" })]);
  const stop = followRecord(g.svc, "r1", () => assert.fail("stopped"));
  stop();
  g.tell(); await turns();
  assert.equal(g.listeners(), 0);
});

test("followRecord: a record that already ended before the follow began ends it at once, with no event after (control: unconfirmed waits)", async () => {
  const f = fakeSvc([rec({ status: "done" })]);
  const ended: string[] = [];
  followRecord(f.svc, "r1", (x) => ended.push(x.status));
  await turns();
  assert.deepEqual(ended, ["done"]);
  const g = fakeSvc([rec({})]);
  const none: string[] = [];
  followRecord(g.svc, "r1", (x) => none.push(x.status));
  await turns();
  assert.deepEqual(none, []);
});

test("followRecord: still on its way with new words (the live look stopped): said, not ended", async () => {
  const r = rec({ problem: tradeProblems.unconfirmed("WIF", "Solana") });
  const f = fakeSvc([r]);
  const said: string[] = [], ended: string[] = [];
  followRecord(f.svc, "r1", (x) => ended.push(x.status), (x) => said.push(x.problem!.whatHappened));
  await turns();
  r.problem = tradeProblems.unconfirmed("WIF", "Solana", false);
  f.tell(); await turns();
  assert.deepEqual(said, ["Solana hasn't confirmed this trade yet. Open this again to check."]);
  assert.deepEqual(ended, []);
  f.tell(); await turns();
  assert.equal(said.length, 1, "control: the same words again say nothing");
});

test("recordOf: the thrown Problem's own record (the very object the service keeps), never another's", async () => {
  const p = tradeProblems.unconfirmed("WIF", "Solana");
  const mine = rec({ id: "mine", problem: p }), other = rec({ id: "other", problem: tradeProblems.unconfirmed("WIF", "Solana") });
  assert.equal((await recordOf(fakeSvc([other, mine]).svc, p))?.id, "mine");
});

test("the Buy sheet (source pin): its not-confirmed card is watched only while it shows with Trade on screen, never ends the task as failed, and is taken off when the record ends", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /useEffect\(\(\) => \(watching && active \? svc\.watch\(\) : undefined\), \[watching, active, svc\]\);/);
  const branch = src.slice(src.indexOf("if (e instanceof ProblemError && e.problem.code === UNCONFIRMED)"), src.indexOf("taskEnd(\"failed\", e instanceof ProblemError"));
  assert.ok(branch.length > 0, "the unconfirmed branch comes before the failed task");
  assert.match(branch, /followRecord\(svc, rec\.id, \(r\) => \{ ended = r; taskOf\(r\); endProblem\?\.\(now\); \}, \(r\) => \{ const was = now; now = r\.problem!; endProblem\?\.\(was\); \}\)/, "the card ends the moment the record does; new words replace it");
  assert.match(branch, /setWatching\(true\);\n\s*await onProblem\(p\);\n\s*while \(!ended && now !== p && now\.code === UNCONFIRMED\) \{[^\n]*\}\n\s*setWatching\(false\);/, "watched while it shows");
  assert.match(branch, /if \(r\.status === "done"\) \{[\s\S]*?setMoment\(\{ phase: "done"/, "landed: the normal done");
  assert.match(branch, /if \(r\.problem\) await onProblem\(r\.problem\);/, "proven expired: its own card (Buy stopped, Try again)");
  assert.doesNotMatch(branch.slice(0, branch.indexOf("const taskOf")), /taskEnd\(/, "the task is not ended while it may still land");
});
