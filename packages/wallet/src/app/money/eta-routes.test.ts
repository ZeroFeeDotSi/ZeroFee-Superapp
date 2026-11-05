// the copy review's pair-jobs walk (5 Nov, b): the site top-up's and AgentZero's Add-money receipts had no time left. Each now counts
// down from its route's measured time (job-steps.ts LEG_SEC, QA's real-money matrix), on the receipt and on
// the job's row. Control: a job with no estimate says it has none, never a made-up time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEG_SEC, receiptLeft, TIME_WORDS } from "@zerofee/shell-api/job-steps.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("the site top-up and AgentZero's Add money count down from their routes' measured times, on the receipt and the job's row (control: no estimate says none)", () => {
  const site = src("./SiteMoney.tsx");
  assert.match(site, /startJob\(tasks, \{ title: `Add \$\{amount\} to your \$\{name\} wallet`, usd: amount, etaSec: LEG_SEC\.privateOut \}\)/, "the job's row");
  assert.match(site, /\{JOB_WORDS\.created\}<\/p>\n\s*<TimeLeft etaSec=\{LEG_SEC\.privateOut\} \/>/, "the receipt");
  const az = src("../../../../../apps/web/src/agentzero/AgentWallet.tsx");
  assert.match(az, /\{JOB_WORDS\.created\}<\/p>\n\s*<TimeLeft etaSec=\{LEG_SEC\.nearToSafe\} watch \/>/, "AgentZero's receipt");
  assert.match(src("../../../../../apps/web/src/agentzero/use-agent-wallet.ts"), /etaSec: LEG_SEC\.nearToSafe, safe: false/, "AgentZero's job row");
  // the table is the measured times (HOPS.md): SOL → NEAR 79–112 s, NEAR wallet → Safe 10 s
  assert.deepEqual([LEG_SEC.chainIn, LEG_SEC.nearToSafe], [112, 10]);
  const T = Date.now();
  assert.notEqual(receiptLeft(T + LEG_SEC.privateOut * 1000, T), receiptLeft(undefined, T), "a time left is said");
  assert.equal(receiptLeft(undefined, T), TIME_WORDS.receiptNone, "control: no estimate says it has none");
});
