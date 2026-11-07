// The Safe's steps on ONE sheet (the audit's c, 7 Nov): approvalsFor's cases as a table. An account that can chain: one chained
// request (control, unchanged). One that can't: ZeroFee's own Safe screens (wallet, trade) get ONE request of separate
// steps (apart); every other caller one request per step, as before. More than 4: refused, chained or not, never split.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TxRequest } from "@zerofee/core/signer";
import { ProblemError } from "@zerofee/core/problem";
import { APART_CALLERS, approvalsFor } from "./ledger.ts";

const step = (receiverId: string, why = "Move it"): TxRequest => ({ receiverId, actions: [{ kind: "transfer", yocto: "1" }], why, from: "wallet" });
const two = [step("usdc.near", "Let the swap service hold USDC"), { ...step("usdc.near"), sendFill: true as const }];

test("table: how many approvals, chained or apart, for each case", () => {
  const rows: [string, TxRequest[], boolean, string | undefined, { n: number; then?: number; apart?: boolean } | "refused"][] = [
    ["one step, can't chain", [step("a.near")], false, "wallet", { n: 1 }],
    ["two steps, chains (control)", two, true, "wallet", { n: 1, then: 1 }],
    ["two steps, can't chain, Home", two, false, "wallet", { n: 1, then: 1, apart: true }],
    ["two steps, can't chain, Trade", two, false, "trade", { n: 1, then: 1, apart: true }],
    ["four steps, can't chain, Home", [step("a.near"), step("b.near"), step("c.near"), step("d.near")], false, "wallet", { n: 1, then: 3, apart: true }],
    ["two steps, can't chain, Agent: one per step, as before", two, false, "agent", { n: 2 }],
    ["two steps, can't chain, Browser: one per step, as before", two, false, "browser", { n: 2 }],
    ["two steps, can't chain, no caller", two, false, undefined, { n: 2 }],
    ["five steps, chains", [1, 2, 3, 4, 5].map((i) => step(`s${i}.near`)), true, "wallet", "refused"],
    ["five steps, can't chain", [1, 2, 3, 4, 5].map((i) => step(`s${i}.near`)), false, "wallet", "refused"],
    ["five steps, can't chain, Agent", [1, 2, 3, 4, 5].map((i) => step(`s${i}.near`)), false, "agent", "refused"],
  ];
  for (const [name, steps, canChain, caller, want] of rows) {
    if (want === "refused") {
      assert.throws(() => approvalsFor(steps, canChain, caller), (e: unknown) => e instanceof ProblemError && e.problem.code === "ledger.steps.too-many", name);
      continue;
    }
    const out = approvalsFor(steps, canChain, caller);
    assert.equal(out.length, want.n, name);
    assert.equal(out[0]!.then?.length, want.then, name);
    assert.equal(out[0]!.apart, want.apart, name);
  }
  assert.deepEqual([...APART_CALLERS], ["wallet", "trade"]);
});

test("apart: the first step's receiver and actions, the rest in order, the last step's markers (a Send's fill) kept", () => {
  const [one] = approvalsFor(two, false, "wallet");
  assert.equal(one!.receiverId, "usdc.near");
  assert.equal(one!.why, "Move it");
  assert.equal(one!.sendFill, true, "the fill's marker rides with the one request, as on the chained path");
  assert.deepEqual(one!.then, [{ receiverId: "usdc.near", actions: two[1]!.actions }]);
});
