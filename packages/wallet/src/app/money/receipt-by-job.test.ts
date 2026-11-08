// QA's finding, made a MUST by QA (7 Nov): a receipt's state and tense came from the rows started
// since it opened (less LANDED_SLACK_MS), not from its job, so two jobs on different money started within the slack (a hot
// wallet's and the Safe's) put the OTHER job's stop words, or its landing, on this receipt. Now each receipt follows its
// own job's rows (job-start.ts jobRows: its starting row and the ids it was made with); the time window is only the
// fallback for a receipt that knows no job id. Fixed figures, no wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobRows, startJob } from "@zerofee/shell-api/job-start.ts";
import { LANDED_SLACK_MS, landedOf, receiptRows, receiptStateOf } from "@zerofee/shell-api/job-steps.ts";
import { receiptSaid, sendWords } from "./receipt-said.ts";

const T = 1_800_000_000_000;
/** A store where every row is already there: made() hands over at once (no timer). */
const there = { list: () => ({ some: () => true }) as never, subscribe: () => () => {} };
const job = (title: string, id?: string) => startJob(undefined, { title, ...(id ? { id } : {}) }, { now: () => T, store: there });
type Row = { id: string; state: string; startedAt: number; endedAt?: number; detail?: string };
const STOP = "NEAR said no. Your money is in your Safe.";

test("two jobs within the slack, one going (a hot wallet's Send) and one stopped (the Safe's Send): each receipt says its own job (control: the time window alone mixes them)", () => {
  const a = job("Send $25.00 to bob.near"), b = job("Send $30.00 to carol.near");
  a.made(["send:a-1"]); b.made(["send:b-1"]);
  const rows: Row[] = [
    { id: "send:a-1", state: "pending", startedAt: T + 300 },
    { id: "send:b-1", state: "failed", startedAt: T + 200, endedAt: T + 900, detail: STOP },
  ];
  assert.ok(Math.abs(rows[0]!.startedAt - rows[1]!.startedAt) < LANDED_SLACK_MS, "both inside the slack");
  const aState = receiptStateOf(rows, T, jobRows(a.id)), bState = receiptStateOf(rows, T, jobRows(b.id));
  assert.deepEqual(aState, { state: "going" }, "A: its own row is going");
  assert.equal(receiptSaid(sendWords("bob.near"), aState), "Sending it to bob.near.", "A keeps the present, no stop words");
  assert.deepEqual(bState, { state: "stopped", words: STOP }, "B: its own stop words");
  assert.equal(receiptSaid(sendWords("carol.near"), bState), `Not sent to carol.near. ${STOP}`);
  assert.deepEqual(receiptStateOf(rows, T), { state: "stopped", words: STOP }, "control: with no job id (the fallback), the window takes B's stop words");
});

test("a landed row of job B never makes job A's receipt past tense: A not yet answered, or A going (control: A's own rows done, landed)", () => {
  const a = job("Send $25.00 to bob.near"), b = job("Move $30.00 to your Safe");
  const bDone: Row = { id: "move:b-1", state: "done", startedAt: T + 200, endedAt: T + 700 };
  // A's call hasn't answered: only its starting row (handed over, never counted) is A's
  b.made(["move:b-1"]);
  const early: Row[] = [{ id: a.id, state: "pending", startedAt: T }, bDone];
  assert.deepEqual(receiptStateOf(early, T, jobRows(a.id)), { state: "going" }, "A not answered yet: going");
  assert.equal(landedOf(early, T, jobRows(a.id)), undefined, "A's time never says Done in");
  assert.deepEqual(receiptStateOf(early, T), { state: "landed", at: T + 700 }, "control: the window alone calls A landed on B's row");
  // A answered, its row going
  a.made(["send:a-1"]);
  const going: Row[] = [{ id: "send:a-1", state: "pending", startedAt: T + 400 }, bDone];
  assert.deepEqual(receiptStateOf(going, T, jobRows(a.id)), { state: "going" });
  assert.equal(receiptSaid(sendWords("bob.near"), receiptStateOf(going, T, jobRows(a.id))), "Sending it to bob.near.");
  assert.deepEqual(receiptStateOf(going, T, jobRows(b.id)), { state: "landed", at: T + 700 }, "B's own receipt: landed");
  // control: A's own row done, A landed (and says Sent)
  const both: Row[] = [{ id: "send:a-1", state: "done", startedAt: T + 400, endedAt: T + 1_200 }, bDone];
  assert.deepEqual(receiptStateOf(both, T, jobRows(a.id)), { state: "landed", at: T + 1_200 });
  assert.equal(receiptSaid(sendWords("bob.near"), receiptStateOf(both, T, jobRows(a.id))), "Sent to bob.near.");
});

test("a job's rows are its own whenever they started, and only its own: its starting row's refusal, a Safe Move's own row id, a job with two rows", () => {
  const c = job("Add $10.00 to Private");
  assert.deepEqual(receiptStateOf([{ id: c.id, state: "failed", startedAt: T, endedAt: T + 400, detail: "Not enough in Private." }], T, jobRows(c.id)), { state: "stopped", words: "Not enough in Private." }, "a refusal before the core answered: its starting row's words");
  const mv = job("Move $30.00 to your SOL wallet", "move:mv-k1");
  mv.made(["move:mv-k1", "move:sol-leg"]);
  const legs: Row[] = [{ id: "move:mv-k1", state: "done", startedAt: T - 60_000, endedAt: T + 2_000 }, { id: "move:sol-leg", state: "pending", startedAt: T + 100 }];
  assert.deepEqual(receiptStateOf(legs, T, jobRows(mv.id)), { state: "going" }, "one of its two rows going: going (its own row counts though it started before the receipt)");
  legs[1] = { ...legs[1]!, state: "done", endedAt: T + 5_000 };
  assert.deepEqual(receiptStateOf(legs, T, jobRows(mv.id)), { state: "landed", at: T + 5_000 });
  assert.deepEqual(receiptRows(legs, T, jobRows("job:none")), [], "an unknown job owns no row");
  assert.equal(jobRows(c.id)("move:sol-leg"), false, "another job's row is never this one's");
});

test("control: one job alone reads as on ef0e7ee6c (its own rows equal the time window's)", () => {
  const d = job("Send $25.00 to bob.near");
  d.made(["send:d-1"]);
  const cases: [Row[], ReturnType<typeof receiptStateOf>][] = [
    [[], { state: "going" }],
    [[{ id: "send:d-1", state: "pending", startedAt: T + 900 }], { state: "going" }],
    [[{ id: "send:d-1", state: "done", startedAt: T + 900, endedAt: T + 9_000 }], { state: "landed", at: T + 9_000 }],
    [[{ id: "send:d-1", state: "failed", startedAt: T + 900, endedAt: T + 9_000, detail: STOP }], { state: "stopped", words: STOP }],
    [[{ id: "send:d-1", state: "failed", startedAt: T + 900, endedAt: T + 9_000, detail: "Your money is either in Private or still with NEAR Intents." }], { state: "unsure", words: "Your money is either in Private or still with NEAR Intents." }],
  ];
  for (const [rows, want] of cases) {
    assert.deepEqual(receiptStateOf(rows, T, jobRows(d.id)), want, JSON.stringify(rows));
    assert.deepEqual(receiptStateOf(rows, T), want, "the fallback agrees");
    assert.equal(landedOf(rows, T, jobRows(d.id)), landedOf(rows, T));
  }
});
