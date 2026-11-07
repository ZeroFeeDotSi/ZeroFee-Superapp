// the audit's way-home audit P4 (7 Nov; D140): Private $33.86, Move it all: Home's Safe $5,288.01 read $5,254.15 for the whole
// flight, and through a reload: a moving "home:" movement out of Private is in neither Private's rows nor the Safe's, and
// Home counted only Adds and Safe swaps. Now it counts at its price until it ends, with its own On its way row unless
// its job's card stands for it. Fails on main: no home-homing, Home's addsUsd leaves it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Movement } from "../../types.ts";
import { homing, homingUsd } from "./home-homing.ts";

const USDC = "nep141:usdc", NEAR = "nep141:wrap.near";
const mv = (o: Partial<Movement>): Movement => ({ id: "home:pm-1", kind: "private", status: "moving", from: "private", to: USDC, amount: "25", startedAtIso: "", updatedAtIso: "", explorerUrls: [], ...o }) as Movement;
const px = (id: string) => ({ [USDC]: "1", [NEAR]: "4.43" })[id];

test("P4: a way home in flight counts at its price: $25.00 of USDC + 2 NEAR at $4.43 is $33.86, the dip gone", () => {
  const ms = homing([mv({}), mv({ id: "home:pm-2", to: NEAR, amount: "2" })]);
  assert.equal(ms.length, 2);
  assert.equal(homingUsd(ms, px).toFixed(2), "33.86");
});

test("P4 controls: landed, failed, into Private, a Send out of Private, another kind, no price: never counted", () => {
  const not = [mv({ status: "done" }), mv({ status: "problem" }), mv({ id: "home:x", from: USDC, to: "private" }), mv({ id: "pocket-send:x" }), mv({ kind: "swap" }), mv({ kind: "pay" })];
  assert.deepEqual(homing(not), []);
  assert.equal(homingUsd(homing([mv({ to: "nep141:unpriced" })]), px), 0);
  assert.deepEqual(homing(null), []);
});

test("P4: Home adds it to the Safe's figure (the same addsUsd the tab reads) and gives it a row unless its job's card covers it", () => {
  const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
  assert.match(home, /const homes = homing\(activity\);\n\s*const addsUsd = [^\n]*\+ homingUsd\(homes, \(id\) => tokens\.get\(id\)\?\.priceUsd\);/);
  assert.match(home, /const tabUsd = tab === "safe" \? \(!shown \? null : safeUsd && addsUsd > 0 \? plusUsd\(safeUsd, addsUsd\.toFixed\(2\)\)/, "the Safe tab's figure");
  assert.match(home, /\.\.\.homes\.filter\(\(m\) => !covered\.has\(carried\(`send:\$\{m\.id\}`\)\?\.job \?\? ""\)\)\.map/);
  assert.match(home, /data-testid="home-homing"/);
});
