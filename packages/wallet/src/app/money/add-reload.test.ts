// Audit 11's B8 (8 Nov): Add to Private, the page reloaded 1 s after Approve. The core had answered (made() named its row,
// send:<id>), but the page closed inside the hand-off, so its starting row came back pending; reopenOf saw a matching
// movement since its start and ended it "Move stopped · Check Activity for where this is." for good, while Activity said
// "Moved to Private" and the $10 was in. Now made() keeps the rows that take its place on the job's own carry, by id; a
// reopen that finds them in the ledger drops the starting row, and the core's row says how it ended. One name: "Add 10 USDC
// to Private". Fails on main: stopped; "Send to private".
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_WORDS, endOrphans, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { sendTrack } from "./live-steps.ts";
import type { Movement } from "../../types.ts";

const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
const ledger = (rows: unknown[]): Pick<Bridge, "call"> => ({ call: (async (m: string) => (m === "ledger.activity" ? { ok: rows } : { problem: { code: "x" } })) as never });
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };
const iso = (ms: number) => new Date(ms).toISOString();
const still = { list: () => [], subscribe: () => () => {} };

test("B8: an Add whose core answered, reopened inside the hand-off, its movement done in the ledger: the starting row goes, never \"stopped\" [before: stopped]", async () => {
  const add = startJob(tasks(), { title: "Add 10 USDC to Private", approve: true }, { store: still });
  add.approved();
  add.made(["send:sim-3"]);
  await reopen(ledger([{ id: "sim-3", kind: "private", status: "done", startedAtIso: iso(Date.now()) }]));
  const t = row(add.id);
  assert.ok(!t || (t.state === "done" && t.detail !== JOB_WORDS.mayHaveMoved), `fails before: ${t?.state} ${t?.detail}`);
});

test("B8 control: its ids kept but not in the ledger: unsure, as before (never a guess)", async () => {
  const add = startJob(tasks(), { title: "Add 5 USDC to Private", approve: true }, { store: still });
  add.approved();
  add.made(["send:sim-9"]);
  await reopen(ledger([{ id: "sim-4", kind: "private", status: "done", startedAtIso: iso(Date.now()) }]));
  assert.equal(row(add.id)?.detail, JOB_WORDS.mayHaveMoved);
});

test("B8: the core's row of an Add into Private has the Add's name and ends in Private [before: \"Send to private\", \"Paid to private.\"]", () => {
  const now = Date.now();
  const m: Movement = { id: "sim-3", kind: "private", status: "done", from: "nep141:usdc.omft.near", to: "private", amount: "10", startedAtIso: iso(now - 3000), updatedAtIso: iso(now), explorerUrls: [] };
  const t = sendTrack(m, "safe", "private")!;
  assert.equal(t.title, "Add 10 USDC to Private");
  assert.equal(t.end?.line, "In Private.");
  assert.equal(t.steps.at(-1)?.label, "In Private");
  assert.equal(sendTrack({ ...m, status: "moving" }, "safe", "private", "$10.00")!.title, "Add $10.00 to Private");
  // the Safe's USDC by its real id (the Sim's shot said "Add 10 to Private"); a coin not known: no bare figure
  assert.equal(sendTrack({ ...m, from: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1" }, "safe", "private")!.title, "Add 10 USDC to Private");
  assert.equal(sendTrack({ ...m, from: "nep141:zzz.near" }, "safe", "private")!.title, "Add to Private");
});
