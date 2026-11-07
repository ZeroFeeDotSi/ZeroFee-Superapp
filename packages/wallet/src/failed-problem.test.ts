// 1Click's FAILED and a stuck quote, per kind of move (audit, 6 Nov): each names where its own quote refunds, and none promises a refund.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { problemLine } from "@zerofee/core/services";
import { failedProblem, refundPlace, walletProblems } from "./wallet-problems.ts";

const line = (what: string, place: string) => `NEAR Intents didn't finish this ${what}. Your money is either in ${place} or still with NEAR Intents. Check ${place} first.`;
const NO_PROMISE = /comes? back|coming back|sends? (them|it) back|still finishing|not lost|with it\b/;
const TABLE = [
  ["a Top up", { kind: "trading" }, "your NEAR wallet", "ledger.topup.failed", line("move", "your NEAR wallet")],
  ["a NEAR wallet swap", { kind: "swap", source: "private" }, "your NEAR wallet", "ledger.swap.near-failed", null],
  ["a move into Private (kind private, no private flag; to-private.ts)", { kind: "private" }, "Private", "ledger.convert.failed", line("move", "Private")],
  ["a payment from Private (private-pay.ts)", { kind: "pay", private: true }, "Private", "ledger.convert.failed", line("payment", "Private")],
  ["a payment from the Safe", { kind: "pay" }, "your Safe", "ledger.convert.failed", line("payment", "your Safe")],
  ["a conversion", { kind: "convert" }, "your Safe", "ledger.convert.failed", line("swap", "your Safe")],
  ["a Safe swap", { kind: "swap", source: "safe" }, "your Safe", "ledger.convert.failed", line("swap", "your Safe")],
] as const;

for (const [name, m, place, code, words] of TABLE) {
  test(`FAILED, ${name}: ${place}`, () => {
    assert.equal(refundPlace(m), place);
    const p = failedProblem(m);
    assert.equal(p.code, code);
    if (words) assert.equal(problemLine(p), words);
    assert.doesNotMatch(`${problemLine(p)} ${p.more ?? ""}`, NO_PROMISE, "never a promise");
  });
  test(`stuck, ${name}: looks in ${place}, no promise`, () => {
    const p = walletProblems.convertStuck(refundPlace(m));
    assert.equal(problemLine(p), `NEAR Intents hasn't started this yet. Your money is either in ${place} or still with NEAR Intents. Check ${place} first.`);
    assert.equal(p.more, undefined);
    assert.equal(p.next.kind, "wait", "it's still moving: a late SUCCESS still lands");
    assert.doesNotMatch(problemLine(p), NO_PROMISE);
  });
}

test("a Top up's id is its own quiet line, never inside the sentence", () => {
  const p = failedProblem({ kind: "trading" }, "3".repeat(64));
  assert.equal(p.more, `NEAR Intents' id: ${"3".repeat(64)}`);
  assert.doesNotMatch(problemLine(p), /333/);
  assert.equal(failedProblem({ kind: "trading" }).more, undefined);
});

test("the ledger follows a quote through these two, for every kind", () => {
  const src = readFileSync(new URL("./ledger.ts", import.meta.url), "utf8");
  assert.match(src, /status === "FAILED"\) return end\(\{ status: "problem", problem: failedProblem\(m, m\.depositAddress \?\? depositAddress\) \}\)/);
  assert.match(src, /walletProblems\.convertStuck\(refundPlace\(m\)\)/);
});
