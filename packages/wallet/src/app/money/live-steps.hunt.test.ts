// Core hunt 5 Nov (QA): what a job's row says after a reload and at its end. Each test has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SpendingActivity } from "@zerofee/core/spending";
import type { Movement } from "../../types.ts";
import { moveTrack, sendTrack, taskOf } from "./live-steps.ts";
import { jobCarry } from "@zerofee/shell-api/job-carry.ts";

const T0 = Date.parse("2026-11-05T21:00:00Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const swapRow = (): SpendingActivity => ({ id: "t1", kind: "top-up", usd: "8.22", status: "on-its-way", shown: true, atIso: iso(0), words: "Moving $8.22 to your SOL wallet", goesTo: ["sol"] });
const send = (o: Partial<Movement>): Movement => ({ id: "hidden-row:abc", kind: "private", status: "done", amount: "0.05", from: "nep141:sol.omft.near", to: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", startedAtIso: iso(0), updatedAtIso: iso(40), explorerUrls: ["https://solscan.io/tx/x"], private: true, ...o });

test("control: with this page's own words for it (swap-follow.ts), a Safe -> SOL swap is a swap", () => {
  const t = moveTrack(swapRow(), "Swap $8.22 of NEAR for SOL")!;
  assert.equal(t.kind, "swap");
  assert.equal(t.title, "Swap $8.22 of NEAR for SOL");
});

test("BUG live-steps.ts:148,217-218 + swap-follow.ts:10: after a reload the swap's words are gone (kept in memory only), so the same Swap is drawn as \"Move $8.22 to your SOL wallet\", kind move", () => {
  // the page loaded again: what Home's sealed store kept (job-carry.ts; job-start.ts sealJobs) comes back, nothing else
  const kept = JSON.stringify({ "move:t1": { words: "Swap $8.22 of NEAR for SOL", at: Date.now() } });
  jobCarry().keep(kept, () => undefined);
  const t = moveTrack(swapRow(), undefined)!;
  assert.equal(t.kind, "swap", `kind is ${t.kind}; title "${t.title}"`);
});

test("control: a finished Send's track says it is paid", () => {
  const t = sendTrack(send({}), "sol", "them")!;
  assert.equal(t.end?.ok, true);
});

test("BUG live-steps.ts:237-238,391-399: a finished Send with no app label drops its amount: its title is \"Send to them\" and its Activity-centre task carries no usd, while the tap's starting row said \"Send $9.50 ...\"", () => {
  const t = sendTrack(send({}), "sol", "them")!;
  const task = taskOf(t);
  assert.ok(/\$|0\.05|SOL/.test(t.title) || task.usd, `title "${t.title}", usd ${task.usd}: nothing says how much`);
});
