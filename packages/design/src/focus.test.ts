// Fields and focus (product decision, 3 Nov: a focus ring clipped by its box).
// Held for every stylesheet in the app: no CSS draws a browser outline (it sits outside the box, where an overflow:hidden
// parent cuts it), and every focus state's box-shadow is drawn INSIDE the box (inset), so nothing can clip it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  if (n === "node_modules" || n === "dist" || n.startsWith(".")) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
});
const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));

/** Declarations that draw outside the box on focus: an outline, or an outer (non-inset) box-shadow in a :focus rule. */
export const outsideFocus = (css: string): string[] => rules(css).flatMap(({ sel, body }) => {
  const bad: string[] = [];
  const outline = body.match(/(?:^|;)\s*outline\s*:\s*([^;]+)/);
  if (outline && !/^(none|0)\b/.test(outline[1]!.trim())) bad.push(`${sel}: outline ${outline[1]!.trim()}`);
  if (/:focus/.test(sel)) {
    const shadow = body.match(/(?:^|;)\s*box-shadow\s*:\s*([^;]+)/);
    if (shadow) for (const part of shadow[1]!.split(/,(?![^(]*\))/)) {
      const p = part.trim();
      if (!/^(inset\b|none\b|var\(--pin-band\))/.test(p)) bad.push(`${sel}: box-shadow ${p}`);
    }
  }
  return bad;
});

test("no stylesheet draws focus outside its box: no outline, and every :focus box-shadow is inset (control: the old rules are caught)", () => {
  const files = [...cssFiles(join(root, "packages")), ...cssFiles(join(root, "apps"))];
  assert.ok(files.length > 40, `${files.length} stylesheets`);
  const bad = files.flatMap((f) => outsideFocus(readFileSync(f, "utf8")).map((b) => `${f.slice(root.length)}: ${b}`));
  assert.deepEqual(bad, []);
  // controls: what the app had before
  assert.deepEqual(outsideFocus(".sh-tile:focus-visible { outline: 1px solid var(--hair); outline-offset: 2px; }"), [".sh-tile:focus-visible: outline 1px solid var(--hair)"]);
  assert.equal(outsideFocus(".dc-field:focus-within { box-shadow: inset 0 0 0 1px var(--ink), 0 0 0 4px rgba(0,0,0,.05); }").length, 1);
  assert.deepEqual(outsideFocus(".x:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--ink); }"), []);
});

test("one field: filled, no border at rest, 50 pt like the buttons, its ring inside", () => {
  const ui = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
  assert.match(ui, /:where\(\*\):focus, :where\(\*\):focus-visible \{ outline: none; \}/, "the browser's outline is gone everywhere");
  assert.match(ui, /min-height: 50px; padding: 0 16px; border: 0; border-radius: 14px;\s*background: var\(--act-fill\)/);
  assert.match(ui, /:where\(input, textarea, select\):focus-visible, :where\(input, textarea, select\):focus \{ box-shadow: inset 0 0 0 1px var\(--ink\); \}/);
});

// Product decision (5 Nov): a square box sat on a button after a tap. A tap focuses a button, so a plain `:focus` style on anything but
// a text field draws on every tap; buttons and links style only :focus-visible, which html[data-input="pointer"] switches off.
export const plainFocusOnNonFields = (css: string): string[] => rules(css).flatMap(({ sel }) =>
  sel.split(",").map((s) => s.trim()).filter((s) => /:focus(?![-\w])/.test(s) && !/\b(input|textarea|select)\b|\[type=|__field|__input|-field\b|__name\b|__type\b|-note\b|-range\b|-type\b|^:where\(\*\)/.test(s)));

test("no component styles a plain :focus on a button or link (only fields do); a tap never draws a box (control: the old shape is caught)", () => {
  const files = [...cssFiles(join(root, "packages")), ...cssFiles(join(root, "apps"))];
  const bad = files.flatMap((f) => plainFocusOnNonFields(readFileSync(f, "utf8")).map((b) => `${f.slice(root.length)}: ${b}`));
  assert.deepEqual(bad, []);
  assert.deepEqual(plainFocusOnNonFields(".wl-seg button:focus { box-shadow: inset 0 0 0 1px #fff; }"), [".wl-seg button:focus"]);
  assert.deepEqual(plainFocusOnNonFields(".wl-seg button:focus-visible { box-shadow: inset 0 0 0 1px #fff; }"), []);
  assert.deepEqual(plainFocusOnNonFields(".wl-chip:focus { outline: none; }"), [".wl-chip:focus"], "control: any other class is flagged");
  const ui = readFileSync(join(root, "packages/design/src/ui.css"), "utf8");
  assert.match(ui, /html\[data-input="pointer"\]\) :where\(button, a, summary, \[role="button"\], \[tabindex\], \.zf-btn\):focus-visible \{ box-shadow: none; \}/);
});
