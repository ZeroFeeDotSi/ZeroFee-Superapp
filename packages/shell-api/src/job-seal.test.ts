// QA's SHOULD (5 Nov): the job rows live in Home's sealed store (device.store), never plain localStorage.
// Controls: a store that won't answer keeps the plain copy and changes nothing; before sealing, nothing is written plain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TASKS_KEY, taskStore } from "./tasks.ts";
import { SEALED_TASKS, sealJobs } from "./job-start.ts";
import { JOB_CARRY_KEY, SEALED_CARRY, carried, carryTo } from "./job-carry.ts";
import type { Bridge } from "@zerofee/core/bridge";

const T = Date.now();
const plainOf = (init?: string) => {
  const m = new Map<string, string>(init ? [[TASKS_KEY, init]] : []);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const bridgeOf = (sealed: Map<string, string>, refuse = false) => ({
  call: async (method: string, p: Record<string, unknown> = {}) => {
    if (refuse) return { problem: { code: "shell.device.refused" } };
    if (method === "device.store.get") return { ok: { value: sealed.get(String(p.key)) ?? null } };
    if (method === "device.store.set") { sealed.set(String(p.key), String(p.value)); return { ok: { ok: true } }; }
    return { problem: { code: "unknown" } };
  },
  on: () => () => undefined,
}) as unknown as Bridge;
const flush = () => new Promise((r) => setTimeout(r, 5));

test("the job rows move into Home's sealed store: the old plain copy joins once and is erased; this page's rows stay; every change is written sealed (control: a refused store changes nothing)", async () => {
  const old = JSON.stringify([{ id: "move:old", app: "home", title: "Move $5.00 to your SOL wallet", steps: [], state: "done", startedAt: T - 60_000, endedAt: T - 30_000 }]);
  const plain = plainOf(old);
  plain.m.set(JOB_CARRY_KEY, JSON.stringify({ "send:old": { usd: "$4.00", at: T - 60_000 } }));
  const oldCarry = plain.m.get(JOB_CARRY_KEY);
  carryTo(["send:new"], { usd: "$9.00" });
  const home = taskStore().forApp("wallet");
  home.publish({ id: "move:new", title: "Move $9.00 to your SOL wallet", steps: [] });
  assert.equal(plain.m.get(TASKS_KEY), old, "control: before sealing nothing is written plain");

  const sealed = new Map<string, string>();
  assert.equal(await sealJobs(bridgeOf(sealed, true), plain), false, "control: a refused store");
  assert.equal(plain.m.get(TASKS_KEY), old, "control: the plain copy stays for the next try");
  assert.equal(plain.m.get(JOB_CARRY_KEY), oldCarry, "control: what the jobs carry stays plain for the next try, nothing new written plain");
  assert.deepEqual(taskStore().list().map((t) => t.id), ["move:new"]);

  assert.equal(await sealJobs(bridgeOf(sealed), plain), true);
  assert.deepEqual(taskStore().list().map((t) => t.id).sort(), ["move:new", "move:old"], "the plain copy joined; this page's row stayed");
  assert.equal(plain.m.has(TASKS_KEY), false, "the plain copy is erased");
  assert.equal(plain.m.has(JOB_CARRY_KEY), false, "what the jobs carry: its plain copy is erased too (QA, 5 Nov)");
  assert.deepEqual([carried("send:old")?.usd, carried("send:new")?.usd], ["$4.00", "$9.00"], "the plain carry joined; this page's stayed");
  await flush();
  assert.deepEqual((JSON.parse(sealed.get(SEALED_TASKS)!) as { id: string }[]).map((t) => t.id).sort(), ["move:new", "move:old"]);
  home.end("move:new", "done");
  await flush();
  assert.equal((JSON.parse(sealed.get(SEALED_TASKS)!) as { id: string; state: string }[]).find((t) => t.id === "move:new")?.state, "done", "a change is written sealed");
  assert.equal(plain.m.has(TASKS_KEY), false, "never plain again");
  carryTo(["send:later"], { usd: "$1.00" });
  await flush();
  assert.deepEqual(Object.keys(JSON.parse(sealed.get(SEALED_CARRY)!)).sort(), ["send:later", "send:new", "send:old"], "what a job carries is written sealed");
  assert.equal(plain.m.has(JOB_CARRY_KEY), false, "never plain again");
});

test("F2 (QA's Jobs re-crawl, 5 Nov): a starting row a closed page left ends at once, never 10 min of Getting ready; controls: a Safe Move's own row (move:mv-…), this page's starting row and an ended row are left as they are", async () => {
  const { JOB_WORDS, endOrphans, startJob } = await import("./job-start.ts");
  const step = [{ label: JOB_WORDS.starting, state: "doing", at: T - 2_000 }];
  const kept = JSON.stringify([
    { id: "job:orphan1", app: "home", title: "Move $40.00 to your Safe", steps: step, state: "pending", startedAt: T - 2_000 },
    { id: "move:mv-safe1", app: "home", title: "Move $20.00 to your SOL wallet", steps: step, state: "pending", startedAt: T - 2_000 },
    { id: "job:ended1", app: "home", title: "Move $5.00 to your Safe", steps: step, state: "done", startedAt: T - 9_000, endedAt: T - 8_000 },
  ]);
  const mine = startJob(taskStore().forApp("wallet"), { title: "Move $9.00 to your Safe" });
  taskStore().keep({ getItem: () => kept, setItem: () => undefined });
  endOrphans(kept);
  const by = (id: string) => taskStore().list().find((t) => t.id === id)!;
  assert.equal(by("job:orphan1").state, "failed");
  assert.equal(by("job:orphan1").detail, JOB_WORDS.closed);
  assert.equal(by("job:orphan1").steps[0]!.state, "failed", "its step says it stopped, never a spinner");
  assert.equal(by("move:mv-safe1").state, "pending", "control: a Safe Move goes on from the core's own record");
  assert.equal(by(mine.id).state, "pending", "control: this page's own starting row waits for its sheet");
  assert.equal(by("job:ended1").state, "done", "control: an ended row stays as it ended");
  endOrphans("{not json");
  assert.equal(by(mine.id).state, "pending", "control: a damaged copy ends nothing");
});
