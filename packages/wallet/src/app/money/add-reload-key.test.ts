// M12-5 (builder 12's open edge, audit 11's B8, 8 Nov): Add to Private, the page reloaded after the Safe signed but before
// the core answered. The job's row came back pending with no ids (made() never ran), so reopenOf could only say "Check
// Activity for where this is." while Activity said the $10 was in Private. Now the page makes the job's key at the tap
// (newJobKey), passes it as ledger.toPrivate's `key` and keeps it on the job's carry (jobKeyPart); the core stamps it on
// the movement (Movement.jobKey, on every ledger.activity row). The reopen finds the job's own movement by that key and the
// job ends as the movement ended: "In Private.", never unsure. Fails on main: the core keeps no key; the row is unsure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JOB_WORDS, endOrphans, jobKeyPart, newJobKey, reopenOf, startJob } from "@zerofee/shell-api/job-start.ts";
import { carryTo } from "@zerofee/shell-api/job-carry.ts";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import type { Bridge } from "@zerofee/core/bridge";
import { sendTrack } from "./live-steps.ts";
import type { Movement } from "../../types.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const tasks = () => taskStore().forApp("wallet");
const row = (id: string): Task | undefined => taskStore().list().find((t) => t.id === id);
const reopen = async (bridge: Pick<Bridge, "call">) => { const text = JSON.stringify(taskStore().list()); endOrphans(text, await reopenOf(bridge, text)); };
const still = { list: () => [], subscribe: () => () => {} };
const ok = async <T>(b: Bridge, m: string, p?: Record<string, unknown>): Promise<T> => { const r = await b.call<T>(m, p); if ("problem" in r) assert.fail(`${m}: ${r.problem.code}`); return r.ok; };

/** The Sim's core: Private set up, a quote, the Safe's sheet answered yes. */
async function sim() {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5 });
  mock.on<{ id: string }>("approval.needed", (e) => void mock.call("approval.answer", { id: e.id, approve: true }));
  await ok(mock, "ledger.privateSetup", {});
  const q = await ok<{ id: string }>(mock, "ledger.quoteToPrivate", { tokenId: USDC, amount: "10" });
  return { mock, q };
}

test("M12-5: reload mid-Add after the Safe signed, before the core answered: the core's movement carries the job's key, and the job ends as it did, never unsure [before: unsure]", async () => {
  const { mock, q } = await sim();
  // the tap, as Private.tsx's Add: its key, the job made on the Safe's yes, the key on its carry
  const key = newJobKey();
  const add = startJob(tasks(), { title: "Add 10 USDC to Private", approve: true }, { store: still });
  carryTo([add.id], { parts: [jobKeyPart(key)] });
  add.approved();
  // the core goes on and records it; the page closed before its answer (made() never runs)
  const m = await ok<Movement>(mock, "ledger.toPrivate", { quoteId: q.id, key });
  assert.equal(m.jobKey, key, "the core stamps the key on the movement");
  const rows = await ok<Movement[]>(mock, "ledger.activity", { limit: 50 });
  assert.equal(rows.find((r) => r.id === m.id)?.jobKey, key, "and on its ledger.activity row");
  await reopen(mock);
  const t = row(add.id);
  assert.ok(!t || (t.state === "done" && t.detail !== JOB_WORDS.mayHaveMoved), `fails before: ${t?.state} ${t?.detail}`);
  // the core's own row tells the end: Done, "In Private."
  await new Promise((r) => setTimeout(r, 40));
  const done = (await ok<Movement[]>(mock, "ledger.activity", { limit: 50 })).find((r) => r.id === m.id)!;
  assert.equal(done.status, "done");
  assert.equal(sendTrack(done, "safe", "private")?.end?.line, "In Private.");
});

test("M12-5 controls: another job's key, or no key, still proves nothing: unsure, never a guess", async () => {
  const { mock, q } = await sim();
  const other = startJob(tasks(), { title: "Add 5 USDC to Private", approve: true }, { store: still });
  carryTo([other.id], { parts: [jobKeyPart(newJobKey())] });
  other.approved();
  await ok<Movement>(mock, "ledger.toPrivate", { quoteId: q.id, key: newJobKey() });
  await reopen(mock);
  assert.equal(row(other.id)?.detail, JOB_WORDS.mayHaveMoved, "another job's key");
  const { mock: m2, q: q2 } = await sim();
  const bare = await ok<Movement>(m2, "ledger.toPrivate", { quoteId: q2.id, key: "bad key!" });
  assert.equal(bare.jobKey, undefined, "a key of another shape is left off");
});

test("M12-5: the page makes the key at the tap, passes it, and keeps it on the job's carry the moment the job is made", () => {
  const src = readFileSync(new URL("../screens/Private.tsx", import.meta.url), "utf8");
  assert.match(src, /const key = newJobKey\(\);/);
  assert.match(src, /bridge\.call<Movement>\("ledger\.toPrivate", \{ quoteId: quote\.id, key \}\)/);
  assert.match(src, /made: \(j\) => \{ carryTo\(\[j\.id\], \{ parts: \[jobKeyPart\(key\)\] \}\);/);
});
