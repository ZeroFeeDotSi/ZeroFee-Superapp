// QA's proof lap (5 Nov): a Move refused before anything moved ("That isn't a NEAR account.", its next step
// a field the Move sheet doesn't have) showed nothing at all: "Moving…" for 2 s, then the button. Every refusal is said
// on the sheet. Each test has its control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletProblems } from "../../wallet-problems.ts";
import { MOVE_LOST, refusedLine, refusedStep } from "./move-run.ts";
import { privateShort } from "@zerofee/core/private-route";

test("a refusal whose next step is a field (the lap's ledger.recipient.invalid) is said on the sheet in its own words; control: one that opens a screen (a hold) goes to the shell", () => {
  const p = walletProblems.recipientInvalid();
  assert.notEqual(p.next.kind, "open");
  assert.equal(refusedLine(p), p.whatHappened);
  assert.ok(p.whatHappened.length > 0);
  assert.equal(refusedLine({ ...p, next: { kind: "open", screen: "held/x", label: "See it" } as never }), null);
});

test("the Move sheet puts the refusal on its own line, and a call that threw says so too, never nothing (control: the source wires both)", () => {
  const src = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /refused: \(pr\) => \{ back\(\); if \(sendEndsHere\(pr\)\) return void endHere\(shell, pr, onClose\); const said = refusedLine\(pr\); if \(said !== null\) \{ setLine\(said\); setStep\(refusedStep\(pr\)\); \}/);
  assert.match(src, /\.catch\(\(\) => \{ back\(\); setLine\(MOVE_LOST\); return null; \}\)/);
  assert.doesNotMatch(src, /\.catch\(\(\) => null\)/, "no silent catch");
  assert.ok(MOVE_LOST.length > 0);
});

test("rule 8 (the proof, 5 Nov): the refusal's next step is drawn on the sheet: Private short says \"Move less\", and its tap sets the Safe to what it can move; a step that opens a screen is the shell's (controls: \"Go back\" only clears the line)", () => {
  assert.deepEqual(refusedStep(privateShort(10, 49)), { label: "Move less", less: true });
  assert.deepEqual(refusedStep(walletProblems.recipientInvalid()), { label: walletProblems.recipientInvalid().next.label, less: false });
  assert.equal(refusedStep({ ...privateShort(10, 49), next: { kind: "open", screen: "held/x", label: "See it" } as never }), null);
  const src = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const lessen = \(\) => \{ const src = fromPriv \? "private" : "safe"; set\(src, least\(now, src\)\); \};/);
  assert.match(src, /onClick=\{\(\) => \{ if \(on\.tap === "again" \|\| on\.tap === "go"\) return void go\(\); setLine\(null\); if \(on\.tap === "less"\) lessen\(\); \}\}>\{busy \? MOVE_WORDS\.moving : on\.label\}/, "the floor's one button carries the step now");
});
