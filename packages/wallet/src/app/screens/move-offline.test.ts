// Audit 13's D8 (8 Nov): offline, Move said only "You're offline." above its fee line, and its sliders still moved. Now it
// says what Send says (builder 13), once, on top; its rows rest (inert, dimmed); the floor never says it again and Move
// stays off; no Try again. Fails on main: no MOVE_OFFLINE, no move-offline block, live rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");

test("D8: Move offline says Send's line on top, its rows at rest, said once", () => {
  assert.match(sheet, /export const MOVE_OFFLINE = "You're offline\. Your money is safe\. Move works again when you're back\. It checks again by itself\.";/);
  assert.match(sheet, /const offline = useOffline\(\);/);
  assert.match(sheet, /\{offline && !running && <div role="status" data-testid="move-offline"[^\n]*<p className="zf-body">\{MOVE_OFFLINE\}<\/p><\/div>\}/);
  assert.match(sheet, /className="wl-mv-rows" role="group" aria-label=\{MOVE_WORDS\.head\} \{\.\.\.restsProps\(rests\)\} data-testid="move-rows"/, "the sliders and amounts rest (audit 16's G1 helper)");
  assert.match(sheet, /const rests = \(offline \|\| sheetDown\) && !running;/, "offline, or a service the sheet needs down");
  assert.match(sheet, /said: \(offline \|\| downTop \? null : services\.line\) \?\? p\.slowLine/, "the floor's line never says offline a second time");
  assert.match(sheet, /down: services\.down \}\);/, "control: Move stays off while the services line holds it (offline is down)");
  const block = sheet.slice(sheet.indexOf('data-testid="move-offline"'), sheet.indexOf("</div>}", sheet.indexOf('data-testid="move-offline"')));
  assert.doesNotMatch(block, /Try again|<button/, "no Try again");
});
