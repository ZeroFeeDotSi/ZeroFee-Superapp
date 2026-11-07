// QA's SHOULD (7 Nov): a job's carried `to` is the plan's place keys only (move-split PLACES: safe, sol, hood,
// near, bsc, private), as every other carried field is checked; a kept copy's unknown key is dropped, and a job row's
// page (jobFacts) never prints a raw key. Fails on deb6c02f3: job-carry.ts took `c.to.map(String)` unchecked, and jobFacts
// printed "<key> wallet" for any key.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { createJobCarry } from "@zerofee/shell-api/job-carry.ts";
import { foldJobs, jobFacts } from "./activity-rows.ts";

const T0 = 1_000_000;
const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "r1", kind: "top-up", usd: "40", status: "done", shown: true, atIso: new Date(T0).toISOString(), words: "Move $40.00 to your SOL wallet", ...o });

test("a kept copy's `to`: the plan's place keys kept in order, anything else dropped (an unknown key, markup, a number); none left: no `to`", () => {
  const rows: [unknown, string[] | undefined][] = [
    [["sol", "near"], ["sol", "near"]],
    [["safe", "private", "hood", "bsc"], ["safe", "private", "hood", "bsc"]],
    [["sol", "<b>x</b>", "near"], ["sol", "near"]],
    [["sol", "eth", 7, null, "NEAR"], ["sol"]],
    [["solana wallet"], undefined],
    ["sol", undefined],
  ];
  for (const [to, want] of rows) {
    const c = createJobCarry(new Map(), () => T0);
    c.keep(JSON.stringify({ "move:a": { at: T0, usd: "$5.00", to } }), () => {});
    assert.deepEqual(c.get("move:a")?.to, want, JSON.stringify(to));
    assert.equal(c.get("move:a")?.usd, "$5.00", "control: the other fields still carried");
  }
});

test("jobFacts: a job's To never prints a raw unknown key; control: the plan's wallets in order", () => {
  const JOB = "move:j1";
  const a = row({ id: "j1", via: "private", goesTo: ["sol"], usd: "10" });
  const b = row({ id: "j2", kind: "move", network: "hood", to: "near", usd: "5", atIso: new Date(T0 + 1_000).toISOString() });
  const [r] = foldJobs([a, b], (id) => (id === "j1" || id === "j2" ? JOB : undefined));
  const facts = [{ label: "From", value: "Safe" }, { label: "To", value: "SOL wallet" }];
  // fix/move-leg-steps (QA's SHOULD): From names every wallet that paid
  const from = { label: "From", value: "Safe, ETH (RH) wallet" };
  assert.deepEqual(jobFacts(r!, facts, ["near", "sol"]), [from, { label: "To", value: "SOL wallet, NEAR wallet" }]);
  const odd = jobFacts(r!, facts, ["sol", "evil", "near"]);
  assert.deepEqual(odd, [from, { label: "To", value: "SOL wallet, NEAR wallet" }], JSON.stringify(odd));
  assert.ok(!JSON.stringify(odd).includes("evil"));
});
