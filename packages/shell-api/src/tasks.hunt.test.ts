// Core hunt 5 Nov (QA): a job's state machine never steps backwards. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskStore } from "./tasks.ts";

const T0 = Date.parse("2026-11-05T21:00:00Z");
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const job = { id: "move:1", title: "Move $5.00 to your SOL wallet", steps: [{ label: "Left your Safe", state: "done" as const }] };

test("control: end() refuses \"pending\" as an end state", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const home = s.forApp("wallet");
  home.publish(job);
  assert.equal(home.end("move:1", "pending" as never), false);
});

test("BUG tasks.ts:199-204: update() lets a done job go back to pending (its endedAt kept)", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const home = s.forApp("wallet");
  home.publish(job);
  home.end("move:1", "done");
  home.update("move:1", { state: "pending" });
  const t = s.list()[0]!;
  assert.equal(t.state, "done", `a done job stepped back to ${t.state} (endedAt ${t.endedAt})`);
});

test("BUG tasks.ts:191-196: publish() of an ended id resets it to pending with no endedAt", () => {
  const s = createTaskStore({ kv: memory(), now: () => T0 });
  const home = s.forApp("wallet");
  home.publish(job);
  home.end("move:1", "done");
  home.publish(job);
  const t = s.list()[0]!;
  assert.equal(t.state, "done", `an ended job republished is ${t.state}`);
});
