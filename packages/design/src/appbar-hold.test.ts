// Product decision, 5 Nov. The bottom bar's hold (450 ms) opens the
// tray; a tap switches the app, the bar re-renders or leaves, its own pointerup never comes, and the hold's timer fired
// after the tap. A hold now ends on any pointerup/cancel (the window's), on leaving the bar, on a plain click and when
// the bar goes. Control: a real hold still opens the tray (the timer and onHold stay).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./AppBar.tsx", import.meta.url), "utf8");

test("the bar's hold ends on any release, on leaving, on a plain click and on unmount (control: a real hold still opens the tray)", () => {
  assert.match(src, /window\.addEventListener\("pointerup", clear, \{ once: true \}\)/);
  assert.match(src, /window\.addEventListener\("pointercancel", clear, \{ once: true \}\)/);
  assert.match(src, /onPointerLeave=\{onHold \? clear : undefined\}/);
  assert.match(src, /useEffect\(\(\) => clear, \[\]\)/);
  assert.match(src, /\} else clear\(\);/);
  assert.match(src, /window\.setTimeout\(\(\) => \{\s*h\.fired = true;\s*onHold\(\);\s*\}, HOLD_MS\)/, "control: the hold still opens the tray");
});
