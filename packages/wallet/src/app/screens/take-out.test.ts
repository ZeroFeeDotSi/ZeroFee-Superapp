// Move's take-out, said before the tap (QA, 3 Nov, 65-move-takeout-sol: "Move $20.00 to your Safe" took $20.60 from the
// SOL row and landed $19.88, and the sheet said neither). Known answers, and the least checked against the core's floors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leastHome, leastIn } from "@zerofee/core/float-floors";
import { takeOutLeast, takeOutLines } from "./take-out.ts";

test("$20 from SOL: what leaves, the least that reaches the Safe, and no fee figure (known answer)", () => {
  assert.deepEqual(takeOutLines([{ from: "sol", name: "SOL", usd: 20, all: false }]), [
    "$20.00 leaves your SOL wallet, and its network fee.",
    "At least $18.35 reaches your Safe.",
    "The swap service's fees come out on the way.",
  ]);
});

test("the least is the core's own floors chained: a row's move in (leastIn), then home (98 %), each cut to the cent; NEAR's row only the move home", () => {
  // the core's floor at a price 1 % under the sheet's (review M2)
  assert.equal(takeOutLeast([{ from: "sol", name: "SOL", usd: 20, all: false }]), Math.floor(leastHome(Math.floor(leastIn(20 * 0.99) * 100) / 100) * 100) / 100);
  // NEAR's row: a cent under its rounded figure (review L5), then home's 98 %
  assert.equal(takeOutLeast([{ from: "near", name: "NEAR", usd: 10, all: false }]), 9.79);
  assert.equal(takeOutLeast([{ from: "sol", name: "SOL", usd: 20, all: false }, { from: "near", name: "NEAR", usd: 10, all: false }]), Math.floor(0.98 * (18.73 + 9.99) * 100) / 100);
  // Hidden: each coin home as itself, held by the core to 98 % (pocket-moves.ts), a cent under its rounded figure; never
  // "comes back whole" (QA, 3 Nov; control: the old sheet said that and counted Hidden as $0 of the least)
  assert.equal(takeOutLeast([{ from: "hidden", name: "Hidden", usd: 30, all: true }]), 29.39);
  assert.deepEqual(takeOutLines([{ from: "hidden", name: "Hidden", usd: 30, all: true }]), ["About $30.00 leaves your private balance.", "At least $29.39 reaches your Safe.", "The swap service's fees come out on the way."]);
  assert.equal(takeOutLeast([{ from: "sol", name: "SOL", usd: 20, all: false }, { from: "hidden", name: "Hidden", usd: 23.86, all: true }]), Math.floor((18.35 + 23.37) * 100 + 1e-9) / 100);
});

test("All: about the row's cash, and the least from what can leave at once (never more than the cash less a network fee)", () => {
  const all = { from: "sol" as const, name: "SOL", usd: 151.07, all: true };
  assert.equal(takeOutLines([all])[0], "About $151.07 leaves your SOL wallet, and its network fee.");
  assert.equal(takeOutLeast([all]), Math.floor(leastHome(Math.floor(leastIn(150.57 * 0.99) * 100) / 100) * 100) / 100);
  assert.equal(takeOutLeast([{ ...all, readyUsd: 120 }]), Math.floor(leastHome(Math.floor(leastIn(120 * 0.99) * 100) / 100) * 100) / 100, "a fee reserve kept while it holds coins");
});

test("review M1: a pick over what the row can send at once (its fee reserve kept while it holds coins) is worked from what it can send, and said \"Up to\" (control: a row that can send it all)", () => {
  const leg = { from: "sol" as const, name: "SOL", usd: 20, all: false, readyUsd: 19.4 };
  assert.equal(takeOutLeast([leg]), Math.floor(leastHome(Math.floor(leastIn(19.4 * 0.99) * 100) / 100) * 100) / 100);
  assert.equal(takeOutLines([leg])[0], "Up to $20.00 leaves your SOL wallet, and its network fee.");
  assert.equal(takeOutLines([{ ...leg, readyUsd: 143 }])[0], "$20.00 leaves your SOL wallet, and its network fee.");
  assert.equal(takeOutLeast([{ ...leg, readyUsd: 143 }]), 18.35);
});

test("the least is never above what was picked, and never a made-up fee (control: the old 3 % pull's arrival, $19.88, sits above the least)", () => {
  for (const usd of [2, 5, 20, 99.99, 1000]) {
    const least = takeOutLeast([{ from: "sol", name: "SOL", usd, all: false }]);
    assert.ok(least < usd && least >= 0, `${usd}: ${least}`);
  }
  assert.ok(takeOutLeast([{ from: "sol", name: "SOL", usd: 20, all: false }]) <= 19.88);
  for (const line of takeOutLines([{ from: "hood", name: "ETH (RH)", usd: 7, all: false }])) assert.doesNotMatch(line, /fee of|\$0\.\d\d fee|about \$\d+\.\d\d in fees/i);
});

test("the core holds its moves to the same floors the sheet reads (one source: float-floors.ts)", () => {
  const core = readFileSync(new URL("../../../../core/src/float-moves.ts", import.meta.url), "utf8");
  assert.match(core, /import \{ HOME_LEAST_PERCENT, leastIn, mostIn \} from "\.\/float-floors\.ts";/);
  assert.equal((core.match(/\(units \* HOME_LEAST_PERCENT\) \/ 100n/g) ?? []).length, 2, "both moves home of a coin held as itself");
  assert.doesNotMatch(core, /const MAX_OVER|const FEE_ROOM_USD|98n\) \/ 100n/, "no second copy of the figures");
});

test("Move's sliders say the least that reaches the Safe from the core's own floors, before the tap, never \"About $20.00\" (control: the old words are gone)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");
  const split = readFileSync(new URL("./move-split.ts", import.meta.url), "utf8");
  assert.match(split, /import \{ HOME_LEG_MIN_USD, PAIR_MIN_USD, SAFE_LEG_MIN_USD, leastHome, leastIn \} from "@zerofee\/core\/float-floors";/);
  assert.match(sheet, /const cost = costLine\(legs\);/);   // one figure per Move: what was typed leaves (QA test)
  // REVAMP P0 (3 Nov): the same figures as one grouped block, its sentence (costLine) what a screen reader hears
  assert.match(sheet, /const costed = costRows\(legs\);/);
  assert.match(sheet, /data-testid="move-least" aria-label=\{cost\}>/);
  assert.doesNotMatch(sheet, /`About \$\{dollars\(total\.toFixed\(2\)\)\} is on its way/);
  assert.doesNotMatch(sheet, /"[^"\n]*comes back whole[^"\n]*"|`Hidden is on its way/, "never \"Hidden comes back whole.\"");
});
