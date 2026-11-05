// AgentZero's moving parts cost no layout (perf finding, 3 Nov: the first mark cost a layout and a style pass per frame
// at idle). Every AgentZero keyframe animates only transform and opacity, and every animated part of the mark is an HTML
// layer (a span or the mark's ::before), never an SVG child. With controls. The trace (0 layouts a second at idle, every
// mood, White and Black): $ZEROFEE_HOME/screens/agentzero-mark-perf-2026-11-03/after.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("./", import.meta.url);
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
/** Every property a CSS file's @keyframes set. */
function keyframeProps(css: string): string[] {
  const out: string[] = [];
  for (const m of strip(css).matchAll(/@keyframes [\w-]+ \{((?:[^{}]*\{[^}]*\})*)\s*\}/g)) {
    for (const d of m[1]!.matchAll(/([a-z-]+)\s*:/g)) out.push(d[1]!);
  }
  return out;
}
const COMPOSITED = new Set(["transform", "opacity"]);

test("no AgentZero keyframe animates a layout or paint property (control: a size, a shadow, a filter and a background are caught)", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.ok(files.includes("az-mark.css") && files.includes("chat.css"), "the scan reads AgentZero's CSS");
  let seen = 0;
  for (const f of files) {
    const props = keyframeProps(readFileSync(new URL(f, dir), "utf8"));
    seen += props.length;
    for (const p of props) assert.ok(COMPOSITED.has(p), `${f}: @keyframes sets ${p}`);
  }
  assert.ok(seen >= 4, `the scan found the keyframes' properties (${seen})`);
  // control: each kind of costly animation is caught by the same reader
  for (const bad of ["width", "box-shadow", "filter", "background-position", "r"]) {
    assert.deepEqual(keyframeProps(`@keyframes x { 0% { ${bad}: 1px; } 100% { opacity: 1; } }`), [bad, "opacity"]);
  }
});

test("the mark's moving parts are HTML layers, never SVG children (control: the first mark's animated SVG circle is caught)", () => {
  const css = strip(readFileSync(new URL("./az-mark.css", dir), "utf8"));
  const tsx = readFileSync(new URL("./AzMark.tsx", dir), "utf8");
  // every rule that runs an animation: its last class (or ::before) is the part that moves
  const moving = [...css.matchAll(/([^{}]+)\{[^}]*\banimation(?:-duration)?:\s*(?!none)[^;}]+/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith("@"));
  assert.ok(moving.length >= 1, `found the animated rules (${moving.length})`);
  const parts = new Set(moving.map((s) => (s.endsWith("::before") ? "::before" : /\.([\w-]+)\s*$/.exec(s)?.[1] ?? s)));
  const htmlOnly = (src: string, part: string) => part === "::before" || new RegExp(`<span className="${part}"`).test(src);
  for (const p of parts) assert.ok(htmlOnly(tsx, p), `${p} moves, and is a <span>`);
  assert.doesNotMatch(css, /transform-box/, "no SVG transform boxes left");
  // control: the first mark animated an SVG circle (.az-dot was <circle className="az-dot" …>)
  assert.equal(htmlOnly(`<circle className="az-dot" cx="12" cy="12" r="1.55" />`, "az-dot"), false);
});
