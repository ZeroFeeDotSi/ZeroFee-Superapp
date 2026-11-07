// the audit's Send audit M3 (7 Nov): a Safe Send or Swap job is made on job.signed (job-run.ts) and learns its movement ids only
// once the core answers. Reopened in between (Face ID done, the app killed inside safe-send's leg 1), its row ended
// "The page closed as it started. Home shows your money." (failed) while its signed leg moved on in Activity. Now every
// money job's starting row takes the audit's 8 Nov reopen rule: "closed" only when the ledger proves no movement began after its
// start; else unsure, "Check Activity for where this is.", Activity the way on. Fails on main: closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_WORDS, endOrphans, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { Bridge } from "@zerofee/core/bridge";

const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
const ledger = (rows: unknown[] | null): Pick<Bridge, "call"> => ({ call: (async (m: string) => (m === "ledger.activity" && rows ? { ok: rows } : { problem: { code: "x" } })) as never });
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };
const iso = (ms: number) => new Date(ms).toISOString();

test("M3: a Safe Send reopened after its Face ID, before the core answered, its leg 1 noted in the ledger: unsure, never \"closed as it started\" [before: closed]", async () => {
  const send = startJob(tasks(), { title: "Send $5.00 to bob.near", usd: "$5.00", approve: true });
  send.approved();
  const swap = startJob(tasks(), { title: "Swap $5.00 of SOL for USDC", usd: "$5.00" });
  // safe-send keep(): the Send's movement is on the device before leg 1's sheet; the hot Swap's put-away is moving too
  // (changed pin, m3's SHOULD: each job's own row by its kind, reopen-match.test.ts) the Swap's put-away is its own row
  await reopen(ledger([{ id: "safe-send:abc", kind: "pay", status: "moving", startedAtIso: iso(Date.now()) }, { id: "swap:s", kind: "private", status: "moving", startedAtIso: iso(Date.now()) }]));
  for (const id of [send.id, swap.id]) {
    const t = row(id)!;
    assert.notEqual(t.detail, JOB_WORDS.closed, `fails before: ${t.detail}`);
    assert.equal(t.detail, "Check Activity for where this is.");
    assert.equal(t.state, "stopped", "never failed: its money may be moving");
    assert.equal(t.open?.route, "activity");
  }
});

test("M3: a ledger row whose start won't read, or a ledger that won't answer, proves nothing: unsure", async () => {
  const a = startJob(tasks(), { title: "Send $2.00 to carol.near", usd: "$2.00" });
  await reopen(ledger([{ id: "pocket-send:x", kind: "pay", status: "moving" }]));
  assert.equal(row(a.id)?.detail, JOB_WORDS.mayHaveMoved);
  const b = startJob(tasks(), { title: "Send $3.00 to dan.near", usd: "$3.00" });
  await reopen(ledger(null));
  assert.equal(row(b.id)?.detail, JOB_WORDS.mayHaveMoved);
});

test("M3 controls: only rows from before the job's start (past the clock slack): it closed and nothing moved, as before; a core row (move:) and an ended row are left alone", async () => {
  const c = startJob(tasks(), { title: "Send $4.00 to erin.near", usd: "$4.00" });
  await reopen(ledger([{ id: "safe-send:old", kind: "pay", status: "done", startedAtIso: iso(Date.now() - 60_000) }]));
  assert.equal(row(c.id)?.detail, JOB_WORDS.closed);
  assert.equal(row(c.id)?.state, "failed");
  const how = await reopenOf(ledger([{ id: "x", startedAtIso: iso(Date.now()) }]), JSON.stringify([{ id: "job:z", state: "pending", title: "Send $1.00 to f.near", startedAt: Date.now() }]));
  assert.equal(how({ id: "move:mv-1", state: "pending", title: "Move $1.00" }), "closed", "control: never a core row (endOrphans skips it anyway)");
  assert.equal(how({ id: "job:done", state: "done", title: "Send $1.00 to f.near" }), "closed", "control: an ended row");
  assert.equal(how({ id: "job:z", state: "pending", title: "Send $1.00 to f.near", startedAt: Date.now() }), "unsure");
});
