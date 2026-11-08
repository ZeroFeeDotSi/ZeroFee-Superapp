// A mouse's hover (desktop audit, 5 Nov): one shared rule set in ui.css, under the hover media query, so a finger never
// sees a hover stuck on after a tap. No stylesheet in the app draws a bare :hover outside such a query.
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
const HOVER_MEDIA = /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/;

/** Every `:hover` in the CSS that is not inside a `@media (hover: hover) and (pointer: fine)` block, with its selector. */
export const bareHovers = (css: string): string[] => {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const stack: boolean[] = []; // per open brace: is this block (or one above it) the hover media query
  const bad: string[] = [];
  let head = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "{") {
      const h = head.trim();
      const inHover = (stack[stack.length - 1] ?? false) || HOVER_MEDIA.test(h);
      if (/:hover/.test(h) && !inHover) bad.push(h.replace(/\s+/g, " "));
      stack.push(inHover); head = "";
    } else if (c === "}") { stack.pop(); head = ""; }
    else if (c === ";") head = "";
    else head += c;
  }
  return bad;
};

test("ui.css carries the hover rule set under the hover media query, for the shared controls", () => {
  const css = readFileSync(new URL("./ui.css", import.meta.url), "utf8");
  const at = css.search(HOVER_MEDIA);
  assert.ok(at > 0, "the media query exists");
  const block = css.slice(at);
  for (const sel of [".zf-btn:hover", ".zf-chip", ".wl-pick", ".wl-row", ".zf-row", ".zf-keypad button:hover", ".zf-seg__item:hover", ".zf-appbar__item:hover", ".zf-tray__app:hover", ".zf-sheet__close:hover"]) {
    assert.ok(block.includes(sel), `hover for ${sel}`);
  }
  assert.match(block, /--hover-film: color-mix\(in srgb, var\(--ink\) 6%, transparent\)/, "the film is 6 % ink, a token mix, no new colour");
  assert.match(block, /\.zf-btn:hover:not\(:disabled\):not\(\.zf-btn--quiet\):not\(\.is-busy\) \{ filter: brightness\(1\.06\); \}/, "the lit button brightens (a16: 1.04 did not show)");
  assert.match(block, /\.wl-buy:hover:not\(:disabled\) > span \{ background-image: linear-gradient\(color-mix\(in srgb, var\(--bg\) 14%, transparent\)/, "Home's ink Buy pill takes a film in the ground's colour");
  assert.match(block, /\.wl-act:hover:not\(:disabled\) \.wl-act__dot \{ background-image: linear-gradient\(var\(--hover-film\), var\(--hover-film\)\); \}/, "Home's action discs take the film");
  assert.match(block, /transition-duration: var\(--dur-fast\); transition-timing-function: var\(--ease-out\);/, "the shared timing");
  assert.equal(bareHovers(css).length, 0, "ui.css has no bare :hover");
});

test("no stylesheet in the app draws a bare :hover outside the hover media query", () => {
  const bad = cssFiles(root).flatMap((f) => bareHovers(readFileSync(f, "utf8")).map((s) => `${f.slice(root.length)}: ${s}`));
  assert.deepEqual(bad, []);
});

test("the guard can fail: a bare :hover is caught, one under the query is not (controls)", () => {
  assert.deepEqual(bareHovers(".a:hover { color: red; }"), [".a:hover"]);
  assert.deepEqual(bareHovers("@media (hover: hover) and (pointer: fine) { .a:hover { color: red; } }"), []);
  assert.deepEqual(bareHovers("@media (min-width: 600px) { .a:hover { color: red; } }"), [".a:hover"]);
  assert.deepEqual(bareHovers("@media (hover: hover) and (pointer: fine) { @supports (x: y) { .a:hover { color: red; } } }"), []);
});
