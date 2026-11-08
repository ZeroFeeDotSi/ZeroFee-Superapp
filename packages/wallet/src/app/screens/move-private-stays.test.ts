// Audit 10's A6 (8 Nov): the Move sheet said the fill's extra "goes into Private to pay the Move" while Check and the result
// said Private keeps it (core private-route.ts "Private keeps the rest"); and $9.36 was said twice (that line and Private's
// row note). Now: "$9.36 also goes into Private and stays there.", said once. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVE_WORDS, WHERE, alsoMoved, alsoSaysPrivate, privateGetsLine, type Leg, type SetOp } from "./move-split.ts";

const L = (from: Leg["from"], to: Leg["to"], usd: number): Leg => ({ from, to, usd });
const op = (place: SetOp["place"]): SetOp => ({ place, by: "slide", usd: 199 });

test("A6: the fill's extra stays in Private, and the line says so; never \"to pay the Move\" (control: a plan with no extra says nothing of Private)", () => {
  const pays = { legs: [L("safe", "sol", 20), L("hood", "sol", 4.36)], extra: 9.36, privateUsd: 9.36 };
  const line = alsoMoved([op("sol")], pays)!;
  assert.equal(line, `$9.36 also goes into Private and stays there. $4.36 also comes from ${WHERE.hood}.`);
  assert.doesNotMatch(line, /pay the Move|First |Then /);
  assert.equal(MOVE_WORDS.intoPrivate("$9.36"), "$9.36 also goes into Private and stays there.");
  assert.equal(alsoMoved([op("sol")], { legs: [L("safe", "sol", 20)], extra: 0, privateUsd: 0 }), null, "control: nothing else moves");
});

test("A6: said once: Private's row note is dropped when the also line already says Private's figure (control: it stays when the also line doesn't)", () => {
  const line = alsoMoved([op("sol")], { legs: [L("safe", "sol", 20)], extra: 9.36, privateUsd: 9.36 });
  assert.equal(alsoSaysPrivate(line), true);
  assert.equal(alsoSaysPrivate(`Also moves $4.36 from ${WHERE.hood}.`), false, "control: another source only");
  assert.equal(alsoSaysPrivate(null), false);
  assert.ok(privateGetsLine(28.85, 38.21), "the note itself is unchanged");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const privGets = running \|\| cantGo \|\| legs\.length === 0 \|\| alsoSaysPrivate\(also\) \? null : privateGetsLine\(/);
});
