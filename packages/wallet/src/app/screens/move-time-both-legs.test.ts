import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEG_SEC, MEASURED_SEC, moveLegSec } from "@zerofee/shell-api/job-steps.ts";
import { gasJobEndsAt, SALE_SEC } from "@zerofee/trade/app/sale-gas.ts";
import { aboutLegs, costRows, legTime, madeState, type Leg, type Place } from "./move-split.ts";

// the audit's S8 (7 Nov): a Move that fills Private from the Safe said "Takes about 30 s", Private's payout alone; the Safe's fill
// into Private before it was never counted. The product rule: time left is real. One estimator times every Move leg.
const safeToSol: Leg[] = [{ from: "safe", to: "sol", usd: 20 }];

test("the audit's S8: a Move that fills Private first counts both legs (the fill, then Private's payout); paid by Private whole, one", () => {
  assert.equal(LEG_SEC.safeFill, MEASURED_SEC.safeToNear, "the fill is one Safe-signed NEAR move, timed as the measured Safe -> NEAR hop");
  assert.equal(moveLegSec("safe", "sol", { fill: true }), LEG_SEC.safeFill + LEG_SEC.privateOut);
  assert.equal(aboutLegs(safeToSol, true), "About 1 min.", "both legs");
  assert.equal(aboutLegs(safeToSol, false), "About 30 s.", "control: Private pays it whole, its payout only");
  assert.equal(costRows(safeToSol, true)!.rows.at(-1)!.value, "about 1 min", "the floor's time row");
  assert.equal(madeState([], safeToSol, 0, true).etaSec, 60, "the receipt's time left");
  assert.equal(moveLegSec("private", "sol", { fill: true }), LEG_SEC.privateOut, "control: Private's own leg never waits on a fill");
});

test("the audit's S8: the Move sheet's legTime is the one estimator on every route; Trade's fee-first Sell counts its leg from it", () => {
  const places: Place[] = ["safe", "private", "near", "sol", "hood", "bsc"];
  for (const from of places) for (const to of places) {
    if (from === to) continue;
    for (const fill of [false, true]) assert.equal(legTime({ from, to, usd: 5 }, fill), moveLegSec(from, to, { fill }), `${from} -> ${to}`);
  }
  assert.equal(moveLegSec("near", "sol"), LEG_SEC.nearOut, "NEAR wallet on to a chain wallet");
  assert.equal(gasJobEndsAt(1000), 1000 + (moveLegSec("near", "sol") + SALE_SEC) * 1000);
  const sale = readFileSync(new URL("../../../../trade/src/app/sale-gas.ts", import.meta.url), "utf8");
  assert.match(sale, /moveLegSec\("near", chain\)/, "the fee job's leg is the Move estimator's, never its own constant");
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const fillsFirst = fillHeld \?\? safeSigns\(legs, coins, SAFE_FILL_OPEN\) !== false;/, "as if it fills until the coins are read");
  for (const call of ["costRows(legs, fillsFirst)", "aboutLegs(legs, fillsFirst)", "madeState(runs, legs, follow?.length ?? 0, fillsFirst)", "legTime(r.leg, fillsFirst)"]) assert.ok(sheet.includes(call), call);
  const run = readFileSync(new URL("./move-run.ts", import.meta.url), "utf8");
  assert.ok(run.includes("legs.map((l) => legTime(l, safeAsks))"), "the job's time: both legs when the Safe fills (its Approve)");
});
