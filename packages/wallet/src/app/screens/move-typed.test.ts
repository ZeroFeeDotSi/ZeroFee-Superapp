// Finding 17 (real money, 4 Nov): Move said only "Drag a slider to move money.", and an exact $6 by slider was fiddly.
// Each row's figure can be typed, the slider follows it, and the one line says so. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MOVE_WORDS, drag, legsOf, today, typedUsd, type PlaceNow } from "./move-split.ts";

test("finding 17: a typed figure reads as dollars (control: anything else is dropped)", () => {
  assert.equal(typedUsd("6"), 6);
  assert.equal(typedUsd("$6.50"), 6.5);
  assert.equal(typedUsd(" 1,200 "), 1200);
  for (const bad of ["", "abc", "6.505", "-6", "1e3", "6..5"]) assert.equal(typedUsd(bad), null, bad);
});

test("finding 17: typing $6 on SOL's row makes the one leg Safe → SOL $6, as a drag to $6 does", () => {
  const now: PlaceNow[] = [{ place: "safe", usd: 46, lo: 0 }, { place: "sol", usd: 0, lo: 0 }];
  assert.deepEqual(legsOf(now, drag(now, today(now), "sol", typedUsd("6")!)), [{ from: "safe", to: "sol", usd: 6 }]);
});

test("finding 17: each row's figure is a field until the legs run, it sets the split when left, and the line says it can be typed (control: one figure per row)", () => {
  const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  assert.match(sheet, /\{running \|\| x\.place === "safe" \|\| x\.place === "private"\s*\? <span className="wl-mv-usd"[^>]*>\{usdShort\(shown\)\}<\/span>\s*: <input className="wl-mv-usd wl-mv-type" inputMode="decimal"/);
  assert.match(sheet, /onBlur=\{\(\) => typeIn\(x\.place\)\}/);
  assert.match(sheet, /const usd = text === "" \? 0 : typedUsd\(text\);/, "an empty field is $0 (finding 62)");
  assert.match(sheet, /const t = typeOp\(now, base, ops, k, usd, HOME_PROOF\)[\s\S]*?if \(!t\.over\) setOps\(t\.ops\);/, "set with the Safe only, the plan worked out again (finding 65)");
  assert.match(MOVE_WORDS.untouched, /^Drag a slider, or tap an amount to type it\.$/);
});
