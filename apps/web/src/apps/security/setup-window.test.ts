import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupWindowLine } from "./setup-window.ts";

const when = () => "Mon, 2 Nov, 6:14 PM";

test("while the set-up window lasts: added at once now, and after its end, adding one waits the real change wait", () => {
  const now = Date.parse("2026-11-01T11:00:00Z");
  const until = "2026-11-02T11:14:00Z";
  assert.equal(setupWindowLine(until, 172_800, now, when), "Add it by Mon, 2 Nov, 6:14 PM and it's added at once. After that, adding takes 3 days.");
  assert.match(setupWindowLine(until, 604_800, now, when)!, /adding takes 8 days\.$/, "a 7-day wait: 8 days");
  assert.match(setupWindowLine(until, 2_592_000, now, when)!, /adding takes 31 days\.$/, "a 30-day wait: 31 days");
});

test("over, or unknown: no line (never a window that has closed)", () => {
  assert.equal(setupWindowLine(undefined, 172_800), null);
  assert.equal(setupWindowLine("2026-11-01T10:00:00Z", 172_800, Date.parse("2026-11-01T11:00:00Z")), null);
  assert.equal(setupWindowLine("nonsense", 172_800), null);
});

test("never says the device counts fully at once (it still ages for recovery)", () => {
  assert.doesNotMatch(setupWindowLine("2099-01-01T00:00:00Z", 172_800)!, /counts/);
});

test("the core says the window's end in account.state, from the account's own creation time", () => {
  const core = readFileSync(new URL("../../../../../packages/core/src/demo-core.ts", import.meta.url), "utf8");
  assert.match(core, /setupUntil > Date\.now\(\) \? \{ setupUntilIso: new Date\(setupUntil\)\.toISOString\(\) \}/);
  assert.match(core, /created \+ 86_400_000/);
});
