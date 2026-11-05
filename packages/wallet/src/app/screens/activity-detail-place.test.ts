// The phone test (4 Nov): in the merged Activity centre, a row's page opened INSIDE the list (not full screen, a
// floating ✕ under the Money/Account switch, "which X to click") and its labels broke a letter per line ("Star / ted").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const activity = readFileSync(new URL("./Activity.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");

test("a row's page draws where `overlay` draws (a full-screen sheet over the list), never inline in the list when an overlay is given (control: the old inline render is caught)", () => {
  // S10b: through its own slot of the overlay (overlay-slot.ts), so the live tracker's reads never close it
  assert.match(activity, /const slot = useMemo\(\(\) => \(overlay \? ownSlot\(overlay\) : null\), \[overlay\]\);\s*useEffect\(\(\) => \{ slot\?\.draw\(detail\); \}, \[shown, Detail\]\);/);
  assert.match(activity, /\{overlay \? null : detail\}/);
  assert.doesNotMatch(activity, /\n\s*\{detail\}\n\s*<\/div>/, "control: the list no longer holds the page");
});

test("in the centre the page has ‹ back to the list and ✕ that closes the centre too (one way back each, D135)", () => {
  assert.match(activity, /onClose=\{onDone \? \(\) => \{ setShown\(null\); onDone\(\); \} : \(\) => setShown\(null\)\} \{\.\.\.\(onDone \? \{ onBack: \(\) => setShown\(null\) \} : \{\}\)\}/);
  const sheet = readFileSync(new URL("../../../../design/src/Sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{onBack && <button className="zf-sheet__back" onClick=\{onBack\} aria-label="Back"><Back \/><\/button>\}/);
});

test("a label on the page keeps its words whole and the room they need (control: a rule that breaks anywhere is caught)", () => {
  const rule = (sel: string) => [...css.matchAll(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map((m) => m[1]!).join(";");
  assert.match(rule(".wl-detail .wl-row-2"), /grid-template-columns: minmax\(8ch, 1fr\) auto/);
  assert.match(rule(".wl-detail .wl-row .t, .wl-detail .wl-row .d"), /overflow-wrap: normal; word-break: normal/);
  assert.doesNotMatch(rule(".wl-detail .wl-row .t"), /anywhere|break-all/);
  assert.match(".wl-row .t { overflow-wrap: anywhere; }", /anywhere/, "control: the base row rule that let a label break per letter");
});
