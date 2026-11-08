// Audit 13's D6 (8 Nov): with NEAR Confidential down the banner said so while Settings → Status said "All working" and had
// no NEAR Confidential row. Its row now stands after NEAR Intents', down by the banner's own rule. Fails on main: no
// "confidential" status id, no withConfidential.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STATUS_IDS, type StatusReport } from "./status-probe.ts";
import { STATUS_NAMES, statusSummary, withConfidential } from "./status-summary.ts";
import { DOWN_WORDS } from "./status-words.ts";

const look: StatusReport = { at: 1, relay: true, rows: [{ id: "near", state: "working", via: "relay", ms: 90 }, { id: "oneclick", state: "working", via: "direct", ms: 300 }, { id: "jupiter", state: "working", via: "direct", ms: 80 }] };

test("D6: NEAR Confidential has its row, down when the app's record says so (the banner's rule)", () => {
  assert.ok((STATUS_IDS as readonly string[]).includes("confidential"));
  assert.equal(STATUS_NAMES.confidential, "NEAR Confidential");
  const down = withConfidential(look, [{ service: "confidential", state: "down", seen: "both" }]);
  assert.deepEqual(down.rows.map((r) => r.id), ["near", "oneclick", "confidential", "jupiter"], "after NEAR Intents'");
  assert.equal(down.rows[2]!.state, "down");
  assert.notEqual(statusSummary(down), "All working", "fails on main: All working");
  assert.match(statusSummary(down), /NEAR Confidential/);
  assert.equal(DOWN_WORDS.confidential, "Sends, swaps, moves, Safe Buy and Sell can't go now. Trades in Hot work.");
});

test("control: no record of it down, its row says NEAR Intents' own check; one source alone is not down; never twice", () => {
  const up = withConfidential(look, []);
  assert.deepEqual(up.rows.find((r) => r.id === "confidential"), { id: "confidential", state: "working", via: "direct", ms: 300 });
  assert.equal(statusSummary(up), "All working");
  assert.equal(withConfidential(look, [{ service: "confidential", state: "down", seen: "device" }]).rows.find((r) => r.id === "confidential")!.state, "working");
  assert.equal(withConfidential(up, []).rows.filter((r) => r.id === "confidential").length, 1);
  const shell = readFileSync(new URL("../../../apps/web/src/shell/StatusSheet.tsx", import.meta.url), "utf8");
  const row = readFileSync(new URL("../../../apps/web/src/shell/status-row.ts", import.meta.url), "utf8");
  assert.match(shell, /void lookStatus\(bridge\)\.then\(/, "the sheet reads both");
  assert.match(row, /void lookStatus\(bridge\)\.then\(/, "Settings' row too");
});
