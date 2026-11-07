// The busy refusal's words, per money id (the UI reviewer's ruling, 6 Nov): a hot wallet by its name and "done"; the Safe "signed".
import assert from "node:assert/strict";
import { test } from "node:test";
import { claim, jobTaken, runJob, takenLine } from "./job-run.ts";

const HOT = (name: string) => `Another job is using your ${name} wallet's money, so nothing moved. Try again once that job is done.`;
const SIGNED = "Another job is using this money, so nothing moved. Try again once that job is signed.";

const TABLE: [readonly string[], string][] = [
  [["row:sol"], HOT("SOL")],
  [["row:hood"], HOT("ETH (RH)")],
  [["row:bsc"], HOT("BNB")],
  [["row:near"], HOT("NEAR")],
  [["agent", "row:near"], HOT("NEAR")], // AgentZero's Add money comes out of the NEAR wallet
  [["safe"], SIGNED],
  [["safe", "private"], SIGNED], // a Send from the Safe
  [["private"], "Another job is using Private's money, so nothing moved. Try again once that job is signed."],
  [["row:unknown"], SIGNED], // never a made-up wallet name
  [["__proto__"], SIGNED],
  [[], SIGNED],
];

for (const [money, line] of TABLE) {
  test(`takenLine ${JSON.stringify(money)}`, () => assert.equal(takenLine(money), line));
}

test("the code stays shell.job.taken (swap-refused.ts keys on it), it is a retry, and nothing moved", () => {
  for (const [money] of TABLE) {
    const p = jobTaken(money);
    assert.equal(p.code, "shell.job.taken");
    assert.deepEqual(p.next, { kind: "retry", label: "Try again" });
    assert.equal(p.money.state, "safe");
  }
  assert.equal(jobTaken().whatHappened, SIGNED, "no money named: the Safe's");
});

test("runJob says the wallet of the money it was asked for, before its call", async () => {
  const release = claim(["row:hood"])!;
  let called = false;
  const end = await runJob({ tasks: undefined, title: "Send", safe: false, money: ["row:hood"], call: async () => { called = true; return { ok: 1 }; }, declined: () => false, made: () => undefined });
  release();
  assert.ok("refused" in end);
  assert.equal(end.refused.whatHappened, HOT("ETH (RH)"));
  assert.equal(called, false);
});
