// the audit's C2 MUST (7 Nov): a held first step ran and the rest wasn't sent. Its face is one lit choice, Finish the move, that
// reopens the same action's own sheet (a new Face ID), never a Done-only floor; where the money is: in your Safe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { finishScreen, walletProblems, FINISH_WORDS } from "./wallet-problems.ts";
import { finishOpen } from "./app/finish-open.ts";
import type { Movement } from "./types.ts";

test("table: every movement kind's part-sent face has one choice that opens its own sheet, never Done", () => {
  const rows: [Movement["kind"], string, string | null][] = [
    ["withdraw", "money/send", "send"], ["transfer", "money/send", "send"], ["pay", "money/send", "send"],
    ["swap", "money/swap", "swap"], ["trading", "money/move", "move"], ["private", "money/move", "move"],
    ["deposit", "money/move", "move"], ["account", "money/move", "move"], ["convert", "convert", null],
  ];
  for (const [kind, screen, sheet] of rows) {
    const p = walletProblems.holdPartSent(kind);
    assert.deepEqual(p.next, { kind: "open", label: FINISH_WORDS.finish, screen }, kind);
    assert.equal(finishScreen(kind), screen, kind);
    assert.equal(finishOpen(screen)?.kind ?? null, sheet, kind);
    assert.deepEqual(p.money, { state: "safe", where: "in your Safe" }, kind);
    assert.equal(p.more, "Step 1: Done. The rest: Not sent.", kind);
    assert.doesNotMatch(`${p.whatHappened} ${p.more}`, /Send it again/, "no dead-end instruction");
  }
  assert.equal(FINISH_WORDS.finish, "Finish the move");
  assert.equal(finishOpen("security/rules"), null, "control: any other screen isn't a money sheet");
});
