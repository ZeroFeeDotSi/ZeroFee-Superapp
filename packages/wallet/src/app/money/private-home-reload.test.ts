// the audit's ruling (8 Nov) on Private's way home and a reload mid-way. Before (146dbad11), a page reopened while the job went
// ended its row "The page closed as it started." (endOrphans) even though its money had moved. Now: (a) the job's parts
// (the core's movement ids) are in its sealed carry the moment the core answered, and a reopened page finds them by id
// and goes on to done; (b) reopened before the answer (no ids kept), "closed" only when the ledger proves no move out of
// Private began after the job's start, else unsure ("Check Activity for where this is."; 53, 8 Nov: never "may"). A
// damaged store proves nothing either: unsure (the audit's SHOULD). The Sim's ledger on the
// test's own clock (simClock, MockBridge's timers); no wall-clock waits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { simClock } from "@zerofee/shell-api/testing/sim-clock.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { JOB_WORDS, PRIVATE_HOME_TITLE, endOrphans, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";
import type { Movement } from "../../types.ts";
import { publishTracks, watchLive, type LiveTrack } from "./live-steps.ts";

const turn = () => new Promise<void>((r) => setImmediate(r));
function sim() {
  const clock = simClock();
  const mock = clock.watch(createMockBridge({ latencyMs: 0, settleMs: 50, timers: clock.timers, hiddenStart: { usdc: "30", near: "1.5" } }));
  const home = async () => { const r = await mock.call<Movement[]>("ledger.fromPrivate", {}); assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
  return { clock, mock, home };
}
const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
/** What the closed page kept (its sealed rows), and the reopen's own pass over them. */
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };

test("(a) reopened after the core answered: the job's parts are kept by id, its row goes on and ends done [before: \"The page closed as it started.\"]", async () => {
  const s = sim();
  const job = startJob(tasks(), { title: PRIVATE_HOME_TITLE, usd: "$33.86", etaSec: 10 });
  const moved = await s.home();
  assert.equal(moved.length, 2, "two coins");
  // what Private.tsx does the moment the core answers
  carryTo(moved.map((m) => `send:${m.id}`), { job: job.id });
  carryTo([job.id], { parts: moved.map((m) => m.id) });
  job.made([job.id]);
  // the page closes and opens again: its kept rows pass through the reopen
  await reopen(s.mock);
  assert.equal(row(job.id)?.state, "pending", `fails before: ${row(job.id)?.detail}`);
  // Home's watch on the reopened page follows its parts to their end
  let feed: Movement[] = [];
  const sent = new Map<string, string>();
  const stop = watchLive(s.mock as unknown as Bridge, () => ({ adds: [], movements: feed }), (list: LiveTrack[], _c, tell) => publishTracks(tasks(), tell ?? list, sent));
  const read = async () => { const r = await s.mock.call<Movement[]>("ledger.activity", { limit: 50 }); feed = "ok" in r ? r.ok : []; stop.poke(); for (let i = 0; i < 6; i++) await turn(); };
  await s.clock.quiet();
  await s.clock.advance(60);
  await read();
  assert.equal(row(job.id)?.state, "done");
  assert.notEqual(row(job.id)?.detail, JOB_WORDS.closed);
  stop();
});

test("(b) reopened BEFORE the core answered, a move out of Private began after the job's start: it ends unsure, never \"closed as it started\" [before: closed]", async () => {
  const s = sim();
  const job = startJob(tasks(), { title: PRIVATE_HOME_TITLE, usd: "$33.86", etaSec: 10 });
  await s.home(); // the core moved it; the page closed before it heard (no ids kept)
  await reopen(s.mock);
  const t = row(job.id)!;
  assert.notEqual(t.detail, JOB_WORDS.closed, "fails before: \"The page closed as it started.\"");
  assert.equal(t.detail, "Check Activity for where this is.");
  assert.doesNotMatch(t.detail ?? "", /\bmay\b/, "53: \"may\" is banned");
  assert.equal(t.state, "stopped");
  assert.equal(t.open?.route, "activity", "Activity is the way forward");
});

test("control: reopened before the answer with no move out of Private in the ledger: it may say it closed; another job's row: closed as before", async () => {
  const s = sim();
  const job = startJob(tasks(), { title: PRIVATE_HOME_TITLE, usd: "$33.86", etaSec: 10 });
  const other = startJob(tasks(), { title: "Send $5.00 to alice.near", usd: "$5.00" });
  await reopen(s.mock);
  assert.equal(row(job.id)?.detail, JOB_WORDS.closed);
  assert.equal(row(job.id)?.state, "failed");
  assert.equal(row(other.id)?.detail, JOB_WORDS.closed);
  // a ledger that won't answer proves nothing: unsure, never closed
  const job2 = startJob(tasks(), { title: PRIVATE_HOME_TITLE, usd: "$1.00" });
  await reopen({ call: async () => { throw new Error("locked"); } } as unknown as Pick<Bridge, "call">);
  assert.equal(row(job2.id)?.detail, JOB_WORDS.mayHaveMoved);
});

test("the audit's SHOULD: a kept store that won't parse proves nothing: reopenOf says unsure, never closed [before: closed]", async () => {
  const s = sim();
  const how = await reopenOf(s.mock, "{not json");
  assert.equal(how({ id: "job:damaged", state: "pending", title: PRIVATE_HOME_TITLE, startedAt: 0 }), "unsure");
});
