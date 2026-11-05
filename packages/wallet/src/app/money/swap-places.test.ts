// QA's mainnet crawl (5 Nov, k-agentzero 520–533): a $3 NEAR → SOL swap's steps said "Leaving your Safe /
// Through NEAR / Arriving in your Safe … In your Safe" for a swap that lands in the SOL wallet. Each job says its real
// from and to.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import { moveTrack } from "./live-steps.ts";

const row = (o: Partial<SpendingActivity>): SpendingActivity => ({ id: "sw1", kind: "top-up", usd: "3.00", status: "done", shown: true, atIso: new Date(Date.now() - 50_000).toISOString(), words: "Swap NEAR for SOL", ...o }) as SpendingActivity;

test("a swap of the Safe's NEAR into SOL goes from the Safe to the SOL wallet, and ends \"In your SOL wallet\" (control: a swap inside the Safe, E7, stays the Safe's both ends)", () => {
  const sol = moveTrack({ ...row({ goesTo: ["sol"] }), legs: [row({ id: "leg1", kind: "ready", network: "sol", status: "done" })] } as never, "Swap 3.2 NEAR for SOL")!;
  assert.deepEqual(sol.steps.map((s) => s.label), ["Left your Safe", "Through NEAR Confidential", "In your SOL wallet"], "landed: the place, once read (crawl-home: the doing form names who lands it)");
  assert.equal(sol.end?.line, "In your SOL wallet.");
  assert.equal(sol.kind, "swap");
  assert.ok(sol.wallets.includes("sol"));
  const home = moveTrack(row({ words: "Swap 3.2 NEAR for USDC in your Safe" }) as never, "Swap 3.2 NEAR for USDC")!;
  assert.deepEqual(home.steps.map((s) => s.label), ["Left your Safe", "Through NEAR Confidential", "In your Safe"], "control: E7");
});
