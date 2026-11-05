// 3 Nov (after 0ce3ff96: on a real account "AgentZero can't pay people yet. Use Send in Chat."): Chat's request chip
// says nothing of AgentZero on a real account while its private route is off. The engine answers a real account's offer
// with PRIVATE_OFF_LINE (engine.ts payable); that branch now draws the plain Pay with no AgentZero line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_PRIVATE_ROUTE } from "@zerofee/core/agent-route";

const chip = readFileSync(new URL("./app/agentzero-chip.ts", import.meta.url), "utf8");
const branch = (src: string, guard: string) => {
  const at = src.indexOf(guard);
  assert.ok(at >= 0, `the chip still has: ${guard}`);
  return src.slice(at, src.indexOf("\n", at));
};
const says = (line: string) => /AZ_OFF_LINE|PRIVATE_OFF_LINE\s*\}|offer\.line\s*\}/.test(line.slice(line.indexOf("return")));

test("a real account's chip (the engine's own 'can't pay privately') shows no AgentZero line, only the plain Pay", () => {
  assert.equal(AGENT_PRIVATE_ROUTE, false, "the route is still off: if it opens, this rule is looked at again");
  const real = branch(chip, "if (!offer.ok && offer.line === PRIVATE_OFF_LINE)");
  assert.ok(!says(real), real);
  assert.match(real, /label: null/, "and no AgentZero Pay");
  // control: main's branch said AZ_OFF_LINE and fails the same check
  assert.ok(says("  if (!offer.ok && offer.line === PRIVATE_OFF_LINE) return { ...base, label: null, warn: null, line: line ?? AZ_OFF_LINE };"));
  // control: sample money (the engine offers, the route is off) still says it, as review M1 asked
  assert.ok(says(branch(chip, "if (offer.ok && !route)")));
});
