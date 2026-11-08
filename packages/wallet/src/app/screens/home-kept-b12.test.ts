// QA 16's tick 51 (8 Nov), builder 12's M12-3 and M12-4 (b11's a03 shot, edge B2). NEAR down: Home's hero said only
// "Can't see it now" even with a figure kept on this phone, and the read line said "NEAR didn't answer…" under the
// shell's notice "NEAR is down. Payments wait. Your money stays in your Safe." Now the Safe shows its last figure with its
// time under it ("As of 7:40 AM"), "Can't see it now" only when this phone never read it; with the notice up, the read
// line says what Home does next ("Your Safe updates when NEAR is back."), never the outage or the money's place again.
// Fails on main: no safeAsOf, no timed/told, noticeShows missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readLines } from "./read-lines.ts";
import { clock } from "./home-view.ts";
import { noticeShows } from "@zerofee/core/services";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const AT = Date.UTC(2026, 10, 8, 0, 40);

test("M12-3: the Safe's kept figure carries its time in the hero's line; never-read keeps \"Can't see it now\" [before: Can't see it now / no time]", () => {
  assert.match(home, /export const safeAsOf = \(at: number\): string => `As of \$\{clock\(at\)\}`;/);
  // b22's item 3: offline it says the last read's time first, then as before
  assert.match(home, /: !web && tab === "safe" && a\.readFailed && read && balancesAt \? safeAsOf\(balancesAt\) : hotAt \? safeAsOf\(hotAt\) : null;/);
  assert.match(home, /: asOf && hero \? asOf\n/, "the time takes the line under the figure, before Updating…");
  assert.match(home, /!read \? \(!web && a\.readFailed \? HOME_WORDS\.unseen :/, "control: never read, Can't see it now");
  assert.equal(`As of ${clock(AT)}`, `As of ${clock(AT)}`);
});

test("M12-3: the read line never says the time the hero says", () => {
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: AT, timed: true } }), ["NEAR didn't answer. Your money is still in your Safe."]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: AT } }), [`NEAR didn't answer. Your Safe is as of ${clock(AT)}. Your money is still in it.`], "control: no time above, the line keeps it");
});

test("M12-4: under the notice, the read line says what Home does, never the outage again [before: NEAR didn't answer… under NEAR is down]", () => {
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: AT, timed: true, told: true } }), ["Your Safe updates when NEAR is back."]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: null, shown: false, told: true } }), ["Your Safe shows when NEAR is back."]);
  assert.deepEqual(readLines({ offline: false, safe: { by: "NEAR", at: null, shown: false } }), ["NEAR didn't answer, so your Safe shows when it does. Your money is still in it."], "control: no notice, the line names it");
  for (const l of readLines({ offline: false, safe: { by: "NEAR", at: AT, timed: true, told: true } })) assert.doesNotMatch(l, /didn't answer|is down|still in/);
  // Home reads the notice's own rule, only while its read failed, and only for the service its read names
  assert.match(home, /r\.ok\.filter\(\(x\) => x && noticeShows\(x\)\)\.map\(\(x\) => x\.service\)/);
  assert.match(home, /told\.includes\(safeBy\) && !offline \? \{ told: true \}/);
  assert.match(readFileSync(new URL("../../../../../apps/web/src/shell/StatusBanner.tsx", import.meta.url), "utf8"), /const shows = noticeShows;/, "one rule for the notice and Home");
  assert.equal(noticeShows({ service: "near", state: "down", seen: "both" }), true);
  assert.equal(noticeShows({ service: "near", state: "down", seen: "device" }), false, "one source: no notice, so the line says it");
  assert.equal(noticeShows({ service: "near", state: "slow", seen: "both" }), false);
  assert.equal(noticeShows({ service: "gecko", state: "down", seen: "relay" }), true);
});
