// the audit's way-home audit M6 (7 Nov), the same family as Send's M8: every Move said its figure twice. The receipt's hero
// "$20.00" over "Moving $20.00 to your SOL wallet."; the start face's "$20.00" over "Moves $20.00 to your SOL wallet.";
// before the tap, "Moves $20.00 to your SOL wallet." under the Leaves row's "$20.00". Now the lines say the place only.
// Fails on main (each line carried the figure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moveWhere, movingLine } from "../money/receipt-said.ts";
import { costRows, moveSummary, type Leg } from "./move-split.ts";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
const L = (from: Leg["from"], to: Leg["to"], usd: number): Leg => ({ from, to, usd }) as Leg;
const figure = /\$\d/;

test("M6: the receipt's line says where, going and landed, never the hero's figure again", () => {
  for (const landed of [false, true]) {
    for (const where of [moveWhere(["SOL"]), moveWhere(["SOL", "ETH (RH)"]), moveWhere(["Safe"]), moveWhere(["Private"])]) {
      const line = movingLine(where, landed);
      assert.doesNotMatch(line, figure, line);
      assert.ok(line.includes(where), line);
    }
  }
  assert.equal(movingLine("your SOL wallet", false), "Moving it to your SOL wallet.");
  assert.equal(movingLine("your SOL wallet", true), "Moved to your SOL wallet.");
  // the sheet: the hero says the figure, the line under it the place
  assert.match(sheet, /<p className="zf-receipt__amount">\{dollars\(made\.toFixed\(2\)\)\}<\/p>/);
  assert.match(sheet, /data-testid="move-made-title">\{movingLine\(madeTo\(legs\.map\(\(l\) => l\.to\)\), job\.state === "landed"\)\}<\/p>/);
});

test("M6: the start face and the floor's summary say where it goes; the figure is the hero's and the Leaves row's alone", () => {
  const one = [L("safe", "sol", 20)], two = [L("safe", "sol", 112.96), L("private", "hood", 22.04)];
  assert.equal(moveSummary(one, false), "Moves it to your SOL wallet.");
  assert.equal(moveSummary(two, false), "Moves it to your SOL and ETH (RH) wallets.");
  for (const plan of [one, two]) {
    assert.doesNotMatch(moveSummary(plan, false)!, figure);
    assert.match(costRows(plan)!.rows[0]!.value, figure, "control: the Leaves row still says the figure");
  }
  // the start face: its hero, then moveSummary's line (the same words)
  assert.match(sheet, /const go1 = moveSummary\(legs, false\);/);
  assert.match(sheet, /\{go1 && <p className="zf-receipt__line" data-testid="move-start-line">\{go1\}<\/p>\}/);
  // controls: none on an empty or blocked plan
  assert.equal(moveSummary([], false), null);
  assert.equal(moveSummary(one, true), null);
});
