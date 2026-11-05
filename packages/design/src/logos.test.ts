import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// SVG can carry script. These files are only ever shown as <img src>, where nothing inside runs, but a vendored file
// must still be clean on its own.
const dir = new URL("./logos/", import.meta.url);
const svgs = readdirSync(dir).filter((f) => f.endsWith(".svg"));

test("there are logos to check", () => {
  assert.ok(svgs.length >= 9);
});

test("no vendored logo carries a script, an event handler, or a link outside itself", () => {
  for (const f of svgs) {
    const s = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(s, /<script/i, `${f}: <script>`);
    assert.doesNotMatch(s, /\son[a-z]+\s*=/i, `${f}: an on… handler`);
    assert.doesNotMatch(s, /href\s*=\s*["']\s*(https?:|javascript:|data:|\/\/)/i, `${f}: a link out`);
    assert.doesNotMatch(s, /xlink:href\s*=\s*["'](?!#)/i, `${f}: xlink:href outside the file`);
    assert.doesNotMatch(s, /<foreignObject|<iframe|<embed|<object/i, `${f}: embedded content`);
  }
});

test("every vendored logo has a viewBox, so it scales to any size", () => {
  for (const f of svgs) assert.match(readFileSync(new URL(f, dir), "utf8"), /<svg[^>]*\sviewBox=/, `${f}: no viewBox`);
});
