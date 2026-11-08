// b18 (review MUST 1 and its ruling): a job that ended right before a reload comes back ended, never pending (then
// swept as cut off). The sealed write is async; the end is also written ahead in the tab's own storage, as numbers and
// the state word only: its line and report come back from the sealed store, or the row says "Done. Took N s.".
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore, jobNumber, TASK_ENDS_KEY } from "./tasks.ts";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const ID = "az-browser-1000";
const LINE = "AgentZero is done on mugs.example.com. Blue mug costs $12.00 on mugs.example.com. Took 4 s.";

/** A page whose sealed writes stop landing from `lose()` on (the reload came first). */
function page(tab: ReturnType<typeof mem>) {
  const sealed = mem();
  let lost = false;
  const store = createTaskStore({ now: () => 5_000, ahead: tab });
  store.keep({ getItem: () => null, setItem: (k, v) => void (!lost && sealed.setItem(k, v)) });
  const az = store.forApp("agent");
  az.publish({ id: ID, title: "AgentZero on mugs.example.com", steps: [{ label: "Opening mugs.example.com", state: "doing" }], startedAt: 1000 });
  return { az, sealed, lose: () => void (lost = true) };
}
const reload = (tab: ReturnType<typeof mem>, sealed: ReturnType<typeof mem>) => {
  const next = createTaskStore({ now: () => 9_000, ahead: tab });
  const text = sealed.getItem("zf.tasks.v1");
  next.keep({ getItem: () => text, setItem: (k, v) => sealed.setItem(k, v) });
  return next.list().find((t) => t.id === ID)!;
};

test("the record: exactly jobId, state, endedAt, tookMs; no words, no site, no figures", () => {
  const tab = mem();
  const p = page(tab);
  p.az.update(ID, { detail: LINE });
  p.az.end(ID, "done", LINE);
  const recs = JSON.parse(tab.getItem(TASK_ENDS_KEY)!) as Record<string, unknown>[];
  assert.equal(recs.length, 1);
  assert.deepEqual(Object.keys(recs[0]!).sort(), ["endedAt", "jobId", "state", "tookMs"]);
  assert.deepEqual(recs[0], { jobId: jobNumber("agentzero", ID), state: "done", endedAt: 5_000, tookMs: 4_000 });
  for (const v of Object.values(recs[0]!)) if (typeof v === "string") assert.ok(/^(done|stopped|failed)$/.test(v), `only the state word: ${v}`);
  assert.ok(!/mug|example|\$|AgentZero|az-browser/i.test(tab.getItem(TASK_ENDS_KEY)!), "nothing of the job's words or id");
});

test("its final line landed before the end was lost: the row comes back done with its report and its own time", () => {
  const tab = mem();
  const p = page(tab);
  p.az.update(ID, { detail: LINE }); // the summary first (sealed), then the end
  p.lose();
  p.az.end(ID, "done", LINE);
  assert.match(p.sealed.getItem("zf.tasks.v1")!, /"pending"/, "the sealed copy still says pending");
  const row = reload(tab, p.sealed);
  assert.deepEqual([row.state, row.endedAt, row.detail], ["done", 5_000, LINE]);
  assert.equal(tab.getItem(TASK_ENDS_KEY), null, "applied once, then dropped");
  assert.match(p.sealed.getItem("zf.tasks.v1")!, /"done"/, "and written to the sealed copy");
});

test("the report was lost too: \"Done. Took 4 s.\" with no report, never a wrong line; a stop says the plain words", () => {
  const tab = mem();
  const p = page(tab);
  p.az.update(ID, { detail: "On its way." }); // a going line, not the final one
  p.lose();
  p.az.update(ID, { detail: LINE });
  p.az.end(ID, "done", LINE);
  const row = reload(tab, p.sealed);
  assert.deepEqual([row.state, row.detail], ["done", "Done. Took 4 s."]);
  const tab2 = mem();
  const q = page(tab2);
  q.lose();
  q.az.end(ID, "stopped", "Stopped. Nothing was sent.");
  const r2 = reload(tab2, q.sealed);
  assert.deepEqual([r2.state, r2.detail], ["stopped", undefined]);
});

test("a row that really was cut off (no end written) stays pending for its own sweep; a bad record is never taken", () => {
  const tab = mem();
  tab.setItem(TASK_ENDS_KEY, JSON.stringify([{ jobId: jobNumber("agentzero", "az-browser-2"), state: "pending", endedAt: 1, tookMs: 1 }, { jobId: jobNumber("home", "x-3"), state: "done", endedAt: 2, tookMs: 1 }]));
  const kept = JSON.stringify([{ id: "az-browser-1", app: "agentzero", title: "AgentZero on a.com", steps: [], state: "pending", startedAt: 1 }, { id: "az-browser-2", app: "agentzero", title: "AgentZero on b.com", steps: [], state: "pending", startedAt: 1 }, { id: "x-3", app: "agentzero", title: "t", steps: [], state: "pending", startedAt: 1 }]);
  const next = createTaskStore({ now: () => 9_000, ahead: tab });
  next.keep({ getItem: () => kept, setItem: () => {} });
  assert.deepEqual(next.list().map((t) => [t.id, t.state]).sort(), [["az-browser-1", "pending"], ["az-browser-2", "pending"], ["x-3", "pending"]], "a pending 'end' and another app's end are not taken");
});
