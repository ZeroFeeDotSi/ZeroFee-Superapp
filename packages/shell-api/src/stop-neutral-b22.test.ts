// Audit 18's I5 (builder 22's item 12, 8 Nov): a person's own Stop wore the error badge in Activity: "AgentZero on
// mugs.example.com / Stopped. ... Nothing was paid." with a red "!" (TaskCentre ROW_STATE: failed and stopped had one
// mark). Stopping before paying is the safe path, not a failure. Now a stopped task's row is "ended": a neutral mark (a
// small square on the muted colour, no progress line); only a failed one ("Didn't finish.") keeps the problem colour.
// Fails on main: no task-row-state.ts; TaskCentre mapped stopped to "stopped".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROW_STATE } from "./task-row-state.ts";

const css = readFileSync(new URL("../../design/src/liverow.css", import.meta.url), "utf8");
const row = readFileSync(new URL("../../design/src/LiveRow.tsx", import.meta.url), "utf8");

test("stop-neutral-b22: a stopped task's row is neutral, a failed one keeps the problem colour", () => {
  assert.equal(ROW_STATE.stopped, "ended");
  assert.equal(ROW_STATE.failed, "stopped", "control: Didn't finish stays the problem mark");
  assert.equal(ROW_STATE.done, "done");
});

test("stop-neutral-b22: the ended mark is drawn, on the muted colour, never --down", () => {
  assert.match(row, /state === "ended" && <svg/);
  const rule = css.split("\n").find((l) => l.startsWith(".is-ended .zf-lrow__badge"));
  assert.ok(rule, "an ended badge rule");
  assert.match(rule!, /background: var\(--mute\)/);
  assert.doesNotMatch(rule!, /--down|--alert/);
  assert.match(css, /\.is-stopped \.zf-lrow__badge \{[^}]*var\(--down\)/, "control: a failure is still red");
});
