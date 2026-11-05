// A shell 3 (5 Nov, phone walk of train 2): rule 12 and one segmented style. Source guards with a control for each.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("rule 12: Protection, Recovery, Devices and Open source open as full-screen Sheets with Close, never a pushed page with a Back arrow", () => {
  const sec = code(read("../apps/security/SecurityApp.tsx"));
  assert.match(sec, /<Sheet title="Recovery" onClose=\{onBack\}>/);
  assert.match(sec, /<Sheet title="Devices" onClose=\{onBack\}>/);
  assert.doesNotMatch(sec, /PushedFrame/, "control: no pushed page is left in Security");
  const prot = code(read("../apps/security/Protection.tsx"));
  assert.match(prot, /<Sheet title="Protection" onClose=\{onBack\}>/);
  assert.doesNotMatch(prot, /aria-label="Back"/);
  const os = code(read("./OpenSourceScreen.tsx"));
  assert.match(os, /<Sheet title="Open source" onClose=\{onClose\}>/);
  assert.doesNotMatch(os, /aria-label="Back"/);
});

test("Protection's pickers sit beside its sheet, not inside it (a sheet inside a sheet would hide itself when it opens)", () => {
  const prot = code(read("../apps/security/Protection.tsx"));
  const page = prot.slice(prot.indexOf("{page(<>"), prot.indexOf('editing?.what === "level"'));
  assert.ok(page.length > 200 && !page.includes("<Sheet"), "the page body holds no Sheet");
});

test("one segmented style: Colors, Quick buy and Sim | Real are the design Segmented; the thumb sits 3 px in on every side, no ring", () => {
  const panel = code(read("./SettingsPanel.tsx"));
  assert.equal(panel.match(/<Segmented /g)?.length, 3);
  assert.doesNotMatch(panel, /set__seg/);
  assert.doesNotMatch(read("./settings.css"), /set__seg/, "control: Settings keeps no segmented style of its own");
  const css = read("../../../../packages/design/src/segmented.css");
  assert.match(css, /padding: 3px; box-sizing/);
  assert.match(css, /top: 3px; bottom: 3px; left: 3px; width: calc\(\(100% - 6px\) \/ var\(--n\)\)/);
  assert.match(css, /margin: -3px 0; min-height: 44px/);
  assert.doesNotMatch(css, /top: 4px; bottom: 4px/);
  assert.match(css, /\.zf-seg \{ box-shadow: inset 0 1px 0 var\(--edge-hi\); \}/, "the theme's inset top highlight is the track's only shadow");
  assert.doesNotMatch(css, /\.zf-seg \{[^}]*box-shadow: (?!inset|none)/, "no outer ring");
});

test("theme gaps: Start over is the quiet capsule command (hairline, --r-cmd, 44 pt, no fill) and the account button is a 44 pt target", () => {
  const css = read("./settings.css");
  assert.match(css, /\.set__sec--danger \.set__row--btn \{ min-height: 44px; border: 0; border-radius: var\(--r-cmd, 18px\); background: none; box-shadow: inset 0 0 0 1px var\(--line\); \}/);
  assert.match(css, /\.set__acct \.set__name--btn \{ min-height: 44px;/);
  assert.match(css, /\.set__sec--danger \.set__row > span, [^{]*\{ color: var\(--alert\); \}/, "control: the text stays alert red");
});
