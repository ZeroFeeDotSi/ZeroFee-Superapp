// Audit 15 (8 Nov) FL1: on any laptop width (1280, 756) the laptop page was a 48 px column. Fails on main ea3017f8a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("FL1: on a laptop the page fills the window; the wide screen's centring never reaches the laptop's block body", () => {
  const css = read("../app.css");
  // the cause: wide screens centre the phone frame with `place-items: center` on body, which Chrome also applies to a
  // block body's children (justify-items), so the laptop's #root (width auto) shrank to its words' width
  assert.match(css, /@media \(min-width: 600px\) \{[^@]*body \{ display: grid; place-items: center;/, "control: the phone frame is still centred on a wide screen");
  const laptopBody = [...css.matchAll(/html\[data-mode="laptop"\][^{]*body \{([^}]*)\}/g)].map((m) => m[1]).join(";");
  assert.match(laptopBody, /place-items: normal/, "the laptop page resets it");
  assert.match(css, /html\[data-mode="laptop"\] #root \{ width: auto;/, "control: #root is width auto there, so it would shrink without the reset");
  // the reset comes after the wide-screen rule, so it wins at equal or higher specificity
  assert.ok(css.indexOf('html[data-mode="laptop"] body { place-items: normal; }') > css.indexOf("place-items: center"));
});

