// A held Send has ONE result screen: the shell's Waiting screen (On hold until..., Cancel it, Done). The money sheet
// closes under it (Job 1: the one money sheet, SendSheet), so Done lands where the person was and never on a second,
// dead "On hold" screen (robot walk 1 Nov, 390x844). And no Send ends on a screen of its own: the amount flies into the
// check mark on the sheet (the Home plan §1.3), the sheet closes, and a line follows it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// code and on-screen words only (the comments name what was removed)
const src = readFileSync(new URL("./money/SendSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("a held send closes the sheet and hands over to the shell's Waiting screen, no second On hold screen", () => {
  assert.match(src, /const held = moved\.find\(\(m\) => m\.status === "waiting" && m\.held\);\n\s+if \(held\?\.held\) \{\n\s+onClose\(true\);\n\s+return shell\.showWaiting\(held\.held\);/);
});

test("a send that went is one line, never a screen: no Paid, no On its way screen, no Done, no Share", () => {
  assert.doesNotMatch(src, /<Paid|<OnHold|>Done<|Share/);
  assert.match(src, /const went = [\s\S]*?sayWent\(line, landed \? "went" : "quiet"\)/);
  assert.match(src, /setFlying\(/, "the success moment is on the sheet itself, then it closes");
});

test("a payment only on its way never shows the tick (security review of Job 1, L7)", () => {
  const lines = [...src.matchAll(/went\(`[^`]*`[^;]*;/g)].map((m) => m[0]);
  assert.ok(lines.length > 0, "the sheet's went lines");
  for (const l of lines) {
    assert.match(l, /: on its way\. Activity shows it\.`/, "a private Send lands later: it is on its way when the sheet closes");
    assert.match(l, /, false\);$/);
  }
});
