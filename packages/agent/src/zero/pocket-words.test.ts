// Finding 47: AgentZero's words follow the person's own pocket money and wait, and a typed send to an address gets
// its own answer, not the four jobs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobLine, pocketWaitLine } from "./jobs.ts";
import { CANNOT_LINE, SEND_ELSEWHERE_LINE, readJob } from "./rulebox.ts";

const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

test("a job not started yet says the pocket's own day: $5 a day reads $5, never $20", () => {
  assert.equal(jobLine("copy", undefined, 5), "$5.00 a trade, sells at +50%");
  assert.equal(jobLine("pay-list", undefined, 5), "Only to people you pick");
  assert.equal(jobLine("copy", undefined, 50), "$5.00 a trade, sells at +50%");
  // control: no pocket known keeps the starting $20
  assert.equal(jobLine("pay-list", undefined), "Only to people you pick");
  assert.equal(jobLine("keep", undefined, 5), "Fills your SOL wallet from your Safe");
});

test("the Pocket money sheet names the wait: the recovery wait plus as much again, up to a day more", () => {
  assert.equal(pocketWaitLine(172_800), "More money starts 3 days after you approve. Less works at once.");
  assert.equal(pocketWaitLine(604_800), "More money starts 8 days after you approve. Less works at once.");
  assert.equal(pocketWaitLine(60), "More money starts 2 minutes after you approve. Less works at once.");
  assert.equal(pocketWaitLine(3_600), "More money starts 2 hours after you approve. Less works at once.");
  // control: unknown wait never guesses a length
  assert.doesNotMatch(pocketWaitLine(null), /\d/);
});

test("a typed send to an address is answered as a send, never with the four jobs, and never reaches a model", async () => {
  let asked = false;
  const opts = { relayBase: "https://relay.example", fetch: (async () => ((asked = true), { ok: true, status: 200, json: async () => ({}) })) as never, token: "az1.t" };
  for (const words of [`Send $1 of SOL to ${SOL}`, `pay 2 usdc to 0x${"ab".repeat(20)}`, `transfer $3 to ${SOL}.`]) {
    const r = await readJob(words, opts);
    assert.deepEqual(r.reading, { kind: "cannot", line: SEND_ELSEWHERE_LINE, by: "phone" }, words);
  }
  assert.equal(asked, false);
  assert.notEqual(SEND_ELSEWHERE_LINE, CANNOT_LINE);
  // controls: copying a wallet by its address is still a job, and a .near payment is still Pay once
  const copy = await readJob(`copy ${SOL} with $5 a trade`, opts);
  assert.notDeepEqual(copy.reading, { kind: "cannot", line: SEND_ELSEWHERE_LINE, by: "phone" });
  const near = await readJob("pay $5 to kim.near", opts);
  assert.notEqual((near.reading as { line?: string }).line, SEND_ELSEWHERE_LINE);
});
