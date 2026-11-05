// A-12, explain before act: the dry run's steps, the most it can cost at the core's prices, what it never touches; a step
// it can't price blocks Approve. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRY_HEAD, dryRun } from "./dry-run.ts";

test("steps in order, the most it can cost summed in dollars, then what it never touches", () => {
  const r = dryRun([{ words: "Watch Spending.", usd: 0 }, { words: "Move money.", usd: 12.4 }, { words: "Stop at noon.", usd: 0 }], { never: ["Never takes from your Safe."] });
  assert.deepEqual(r.lines, [DRY_HEAD, "1. Watch Spending.", "2. Move money.", "3. Stop at noon.", "3 steps, $12.40 most.", "Never takes from your Safe."]);
  assert.equal(r.mostUsd, 12.4);
  assert.equal(r.canApprove, true);
  assert.equal(dryRun([{ words: "Sign in.", usd: 0 }]).lines.at(-1), "1 step, no money moves.");
  assert.equal(dryRun([{ words: "Buy.", usd: 20 }], { per: "a day" }).lines.at(-1), "1 step, $20 most a day.");
});

test("a coin step is priced by the core's own price; rounded up to the cent, never less than it can cost", () => {
  const price = (c: string) => (c === "SOL" ? 150 : null);
  const r = dryRun([{ words: "Buy with 0.08271 SOL.", coin: "SOL", amount: 0.08271 }], { price });
  assert.equal(r.mostUsd, 12.41, "12.4065 rounds up");
  assert.match(r.lines.at(-1)!, /\$12\.41 most/);
});

test("a step it can't price says which, and there's no Approve; control: the same priced", () => {
  const steps = [{ words: "Watch.", usd: 0 }, { words: "Buy with 3 BONK.", coin: "BONK", amount: 3 }] as const;
  const no = dryRun(steps, { price: () => null, never: ["Never takes from your Safe."] });
  assert.equal(no.canApprove, false);
  assert.equal(no.mostUsd, null);
  assert.ok(no.lines.includes("I can't tell the cost of step 2."));
  assert.ok(no.lines.includes("Never takes from your Safe."), "what it never touches is still said");
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) assert.equal(dryRun([{ words: "x", usd: bad }]).canApprove, false, String(bad));
  assert.equal(dryRun(steps, { price: () => 0.00002 }).canApprove, true, "control");
});
