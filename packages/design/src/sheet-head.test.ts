// The phone test (4 Nov): a money sheet's pots line ("Safe $33.10 · Wallets $80.58") drew over its title.
// The head added the status bar's height on top of its own (content-box), so on a phone its title sat half a status bar
// low; and the pots line was pulled up into the head by a negative margin. Both are held here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the sheet's head counts the status bar inside its height (border-box), and the pots line never reaches up into it (control: the old rules fail)", () => {
  const sheet = readFileSync(new URL("./sheet.css", import.meta.url), "utf8");
  const money = readFileSync(new URL("./moneysheet.css", import.meta.url), "utf8");
  const headHeight = /\.zf-sheet__head \{[^}]*height: calc\(var\(--zf-top, env\(safe-area-inset-top, 0px\)\) \+ 64px\); padding: var\(--zf-top, env\(safe-area-inset-top, 0px\)\)/;
  assert.match(sheet, headHeight, "its height includes the status bar, and so does its padding");
  assert.match(sheet, /\.zf-sheet__head \{ box-sizing: border-box; \}/, "so the box must be border-box, or the padding adds a second status bar");
  const where = [...money.matchAll(/\.zf-money__where \{[^}]*margin: ([^;]+);/g)].at(-1)![1]!;
  assert.doesNotMatch(where, /-/, `the last margin of the pots line is never negative (${where})`);
  // control: the old pots rule alone pulled it up
  assert.match(".zf-money__where { margin: -6px 0 14px; }", /margin: -6px/);
});
