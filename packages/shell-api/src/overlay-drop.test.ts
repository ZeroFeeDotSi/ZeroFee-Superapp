// endProblem (app-module.ts): a Problem whose news is over (Trade's "not confirmed yet", then the chain answered) is taken
// off, showing or lined up; its asker hears the step given. A Problem not there: false, nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NextStep, Problem } from "@zerofee/core/problem";
import { createOverlayQueue } from "./overlay-queue.ts";

const P = (code: string, words: string): Problem => ({ code, whatHappened: words, money: { state: "unsure" }, next: { kind: "open", label: "Open your SOL wallet", screen: "wallets" } } as Problem);
const NOTHING: NextStep = { kind: "nothing", label: "Back" };

test("drop: the showing Problem goes, its asker hears the step, the next one shows", async () => {
  const q = createOverlayQueue();
  const a = P("trade.trade.unconfirmed", "Solana hasn't confirmed this trade yet. ZeroFee keeps checking."), b = P("x.other", "Other.");
  const heard = q.push("trade", { kind: "problem", problem: a });
  void q.push("trade", { kind: "problem", problem: b });
  assert.equal(q.drop("trade", a, NOTHING), true);
  assert.deepEqual(await heard, NOTHING);
  assert.equal((q.first("trade") as { problem: Problem }).problem.code, "x.other");
  assert.equal(q.count("trade"), 1);
});

test("drop: a lined-up one goes too; one not there (or another app's) is false and changes nothing", () => {
  const q = createOverlayQueue();
  const a = P("x.first", "First."), b = P("trade.trade.unconfirmed", "Not yet.");
  void q.push("trade", { kind: "problem", problem: a });
  void q.push("trade", { kind: "problem", problem: b });
  assert.equal(q.drop("wallet", b, NOTHING), false, "another app's line");
  assert.equal(q.drop("trade", P("x.none", "None."), NOTHING), false);
  assert.equal(q.count("trade"), 2);
  assert.equal(q.drop("trade", b, NOTHING), true);
  assert.equal(q.count("trade"), 1);
  assert.equal((q.first("trade") as { problem: Problem }).problem.code, "x.first", "control: the showing one stays");
});
