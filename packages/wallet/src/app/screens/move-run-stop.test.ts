// the audit's ruling (6 Nov), on Home's Move (runMove): a wallet leg whose money is unknown ends the Move there; no leg after it
// starts, and its row never says it "didn't go". Control: a refusal with nothing gone lets the next leg go, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { taskStore, type Task } from "@zerofee/shell-api/tasks.ts";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { legNotStarted, legRefused, runMove, type MoveRunIo } from "./move-run.ts";
import { planOf, type Leg } from "./move-split.ts";
import { walletProblems } from "../../wallet-problems.ts";

const store = taskStore();
const tasks = store.forApp("wallet");
const starting = (): Task[] => store.list().filter((t) => t.app === "home" && t.id.startsWith("job:"));
const clear = () => { for (const t of store.list()) store.remove(t.app, t.id); };
const REFUSED: Problem = { code: "trade.float.taken", whatHappened: "Another move is using this money. $4.00 is free to move.", money: { state: "safe", where: "where it was" }, next: { kind: "nothing", label: "Go back" } } as Problem;
const UNKNOWN = securityProblems.unexpectedMoney("spending.move", new Error("boom"));
const ok = (id: string) => ({ ok: { id, kind: "move", usd: "5.00", status: "on-its-way", shown: true, atIso: new Date(0).toISOString(), words: "" } });

/** Each call's answer by its turn; every call recorded with its params. */
function io(answers: unknown[]) {
  const called: { m: string; p: Record<string, unknown> }[] = [];
  const o: MoveRunIo = {
    call: async <T,>(m: string, p: Record<string, unknown>) => { called.push({ m, p }); return answers[called.length - 1] as { ok: T } | { problem: Problem }; },
    tasks, keyFor: (w) => `home-move-${w.replace(/[^a-z0-9]/gi, "").slice(0, 20).padEnd(16, "x")}`,
    onApproval: () => () => {}, say: () => {}, asking: () => {}, made: () => {}, refused: () => {}, declined: () => {},
  };
  return { o, called };
}
// two wallet legs and one home: SOL → NEAR, BNB → NEAR, ETH (RH) → Safe
const LEGS: Leg[] = [{ from: "sol", to: "near", usd: 10 }, { from: "bsc", to: "near", usd: 5 }, { from: "hood", to: "safe", usd: 4 }];

test("a wallet leg's plain throw in a money call (Check Activity): the next leg and the move home never start; the row says each, never \"didn't go\"", async () => {
  clear();
  const { o, called } = io([{ problem: UNKNOWN }, ok("b"), ok("c")]);
  assert.equal(await runMove(LEGS, planOf(LEGS), o), null);
  assert.deepEqual(called.map((c) => c.m), ["spending.move"], "only the first leg was asked");
  const [t] = starting();
  assert.equal(t?.state, "failed");
  assert.equal(t?.detail, `$10.00 from your SOL wallet to NEAR: ${UNKNOWN.whatHappened} $5.00 from your BNB wallet to NEAR didn't start. It's still in your BNB wallet. $4.00 from your Robinhood wallet to your Safe didn't start. It's still in your Robinhood wallet.`);
  assert.doesNotMatch(t?.detail ?? "", /didn't go/);
});

test("a later leg after one went: the leg that went is followed, the unknown one is said, the move home never starts", async () => {
  clear();
  const { o, called } = io([ok("a"), { problem: walletProblems.unexpectedMoney("x") }, ok("c")]);
  const r = await runMove(LEGS, planOf(LEGS), o);
  assert.deepEqual(called.map((c) => c.m), ["spending.move", "spending.move"]);
  assert.deepEqual(r?.followed.map((f) => f.id), ["a"]);
});

test("control: a refusal with nothing gone on the first leg lets the next leg and the move home go, as before", async () => {
  clear();
  const { o, called } = io([{ problem: REFUSED }, ok("b"), ok("c")]);
  const r = await runMove(LEGS, planOf(LEGS), o);
  assert.deepEqual(called.map((c) => c.m), ["spending.move", "spending.move", "spending.putAway"]);
  assert.deepEqual(r?.followed.map((f) => f.id), ["b", "c"]);
});

test("the move home's own unknown refusal never says \"didn't go\" (control: a plain refusal still does)", async () => {
  clear();
  const HOME: Leg[] = [{ from: "hood", to: "safe", usd: 4 }];
  await runMove(HOME, planOf(HOME), io([{ problem: UNKNOWN }]).o);
  assert.equal(starting()[0]?.detail, `Home: ${UNKNOWN.whatHappened}`);
  clear();
  await runMove(HOME, planOf(HOME), io([{ problem: REFUSED }]).o);
  assert.equal(starting()[0]?.detail, `Home didn't go: ${REFUSED.whatHappened}`);
});

for (const [name, p, halt] of [
  ["the core's plain throw in a money call", UNKNOWN, true],
  ["the ledger's plain throw in a money call", walletProblems.unexpectedMoney("x"), true],
  ["one step: Activity", { ...REFUSED, next: { kind: "open", label: "See what happened", screen: "activity" } }, true],
  ["money on its way", { ...REFUSED, money: { state: "on-the-way", where: "on its way" } }, true],
  ["nothing gone", REFUSED, false],
  ["a read's plain throw", walletProblems.unexpected("x"), false],
] as [string, Problem, boolean][]) {
  test(`legRefused: ${name}`, () => {
    const r = legRefused(p, "$10.00 from your SOL wallet to NEAR");
    assert.equal(r.halt, halt);
    assert.equal(r.said, halt ? `$10.00 from your SOL wallet to NEAR: ${p.whatHappened}` : `$10.00 from your SOL wallet to NEAR didn't go: ${p.whatHappened}`);
  });
}

test("legNotStarted names where the money still is", () => {
  assert.equal(legNotStarted({ from: "sol", to: "bsc", usd: 3 }), "$3.00 from your SOL wallet to BNB didn't start. It's still in your SOL wallet.");
});
