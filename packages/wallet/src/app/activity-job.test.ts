// the copy review's pair-jobs walk (5 Nov): Activity drew one Move as "Put away $28.80 · Brought $29.39 back · Done" while Home's
// Jobs row said "Moving $30.00 to your Safe". Activity's row is the job's own: its title in its tense, the figure asked
// (the receipt's), its line from the same track. Controls: a row no tap made a job for keeps its own words and figure.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { lineOf, nameOf, usdOf } from "./activity-rows.ts";

const at = new Date(Date.now() - 60_000).toISOString();
const row = (id: string, status: SpendingActivity["status"]): SpendingActivity => ({ id, kind: "put-away", usd: "28.80", status, shown: true, atIso: at, words: "Put away $28.80", network: "sol" });

test("Activity's Move row is its job's: \"Move $30.00 to your Safe\" with the asked figure, the same line as Home's (control: no job, the row's own words and figure)", () => {
  carryTo(["move:pa-1", "move:pa-2"], { usd: "$30.00" });
  const done = row("pa-1", "done");
  assert.equal(nameOf(done), "Move $30.00 to your Safe", "the asked form, as Home's row (copy review, 5 Nov)");
  assert.equal(usdOf(done), "$30.00", "the figure asked, the receipt's");
  assert.doesNotMatch(lineOf(done), /\$28\.80|\$29\.39/, "no second figure under it");
  const going = row("pa-2", "on-its-way");
  assert.equal(nameOf(going), "Move $30.00 to your Safe", "while it goes too: the line carries the state");
  assert.notEqual(lineOf(going), lineOf(done), "the line says the state");
  const plain = row("pa-3", "done");
  assert.equal(nameOf(plain), "Put away $28.80", "control: no job, its own words");
  assert.equal(usdOf(plain), "$28.80", "control: its own figure");
});
