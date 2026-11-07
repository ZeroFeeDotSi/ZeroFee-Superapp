// the audit's ruling (c), 8 Nov, with R4 (audit, 6 Nov): the Move's Getting-ready sheet starts Approve's 700 ms arm at the tap, and
// the core's sheet with the same headline keeps it (so Approve may be on at once). A sheet whose signed quote broke the
// plan's bound heads with "Costs more than the plan said.": it RE-ARMS, Approve off, the same 700 ms arm from when it
// came. Fails on ae8e3f472 and 1e2123004: the sheet kept the tap's arm whatever its words (no approval-arm.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveSheet } from "@zerofee/core/move-plan";
import { ARM_MS, COSTS_MORE_HEAD, keptArm } from "./approval-arm.ts";

const sheet = readFileSync(new URL("./ApprovalSheet.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./ApprovalSheetView.tsx", import.meta.url), "utf8");
const $c = (v: bigint) => `$${(Number(v) / 100).toFixed(2)}`;
/** Approve's off time from the moment the sheet came, as ApprovalSheetView works it (its effect, pinned below). */
const left = (armAt: number | undefined, now: number) => Math.max(0, (armAt ?? now) + ARM_MS - now);

test("the audit's ruling (c): a quote past the plan's bound gives the head and an Approve that is off at first, the 700 ms arm restarting; within it, the tap's arm is kept (control)", () => {
  const getting = { headline: "Move $51.00 to your SOL wallet", at: 1_000 };
  const came = 1_000 + 2_500; // the core's sheet, 2.5 s after the tap: the tap's arm long done
  // the core's sheet from leg 2's signed quote: $45.00 at least for $51.00 (the plan said at least $49.01)
  const past = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 5100n, got: 5000n, least: 4500n }], 6000n, $c);
  assert.equal(past.lines[0], COSTS_MORE_HEAD, past.lines.join(" | "));
  assert.equal(past.title, getting.headline, "the same headline as the tap's sheet");
  const kept = keptArm(getting, past);
  assert.equal(kept, null, "the head re-arms: no kept arm");
  assert.equal(left(kept?.at, came), ARM_MS, "Approve off at first, for the whole 700 ms");
  assert.equal(ARM_MS, 700);
  // control: within the plan, the same headline keeps the tap's arm, so Approve is on as the sheet comes
  const within = moveSheet([{ wallet: "your SOL wallet", priv: 0n, pay: 5100n, got: 5050n, least: 4999n }], 6000n, $c);
  assert.ok(!within.lines.includes(COSTS_MORE_HEAD), within.lines.join(" | "));
  assert.equal(keptArm(getting, within), getting);
  assert.equal(left(keptArm(getting, within)?.at, came), 0);
  // control: another headline re-arms as before (R4)
  assert.equal(keptArm(getting, { title: "Move $52.00 to your SOL wallet", lines: within.lines }), null);
  // the shell uses it: the kept arm (or none) decides the sheet's key and armAt, and the view arms ARM_MS from it
  assert.match(sheet, /const same = keptArm\(lastGetting\.current, showing\.words\);/);
  assert.match(sheet, /key=\{same \? `getting-\$\{same\.at\}` : showing\.id\}[^\n]*\{\.\.\.\(same \? \{ armAt: same\.at \} : \{\}\)\}/);
  assert.match(view, /const left = Math\.max\(0, \(armAt \?\? Date\.now\(\)\) \+ ARM_MS - Date\.now\(\)\);/);
  // the head is said first, in ink
  assert.match(view, /if \(line === COSTS_MORE_HEAD\) return <p key=\{i\} className="approval__line approval__lead" role="alert">/);
});
