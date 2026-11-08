// Audit 17's H3 (8 Nov): with Solana down, Move still said "Your Safe sends $60.00. $5.61 stays in Private." under "Solana is
// down, so this can't go now." The sheet's foot note (fill, back, rest, kept) is a promise: none while it can't go, as the
// summary and the time already are. Fails on main: the foot was gated on running only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { footNote, MOVE_WORDS } from "./move-split.ts";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");

test("H3: no fill line (or any foot note) while Move can't go", () => {
  assert.match(sheet, /const foot = running \|\| cantGo \? null : footNote\(/);
  assert.ok(sheet.indexOf("const cantGo = ") < sheet.indexOf("const foot = "), "cantGo is known before the foot");
});

test("control: a Move that can go still says the fill once", () => {
  const fill = MOVE_WORDS.fill("$60.00", "$5.61");
  assert.equal(fill, "Your Safe sends $60.00. $5.61 stays in Private.");
  assert.deepEqual(footNote({ back: [], fill, rest: null, kept: [], time: null }), { kind: "move-fill", text: fill });
});
