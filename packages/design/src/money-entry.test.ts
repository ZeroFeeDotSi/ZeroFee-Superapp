import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amtSize, chipAt } from "./money-entry.ts";

test("the figure steps down by its digits so it stays on one line", () => {
  assert.equal(amtSize("$50"), 72);
  assert.equal(amtSize("$1,250"), 72);
  assert.equal(amtSize("$125,000"), 60);
  assert.equal(amtSize("$12,500,000"), 48);
  assert.equal(amtSize("$1,234,567,890"), 40);
});

test("the thumb sits on the chip the amount is, and nowhere when none is", () => {
  assert.equal(chipAt(["5", "25", "50", "70.39"], "50"), 2);
  assert.equal(chipAt(["5", "25", "50"], "12"), -1);
});

test("rebrand: no weight under 400 in the design layer, and money figures are tabular", () => {
  for (const f of ["keypad.css", "moneyentry.css"]) {
    const css = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(css, /font:\s*[123]00\b/, f);
  }
  const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  assert.match(tokens, /--font-money: "Geist"/);
  assert.match(tokens, /@font-face \{ font-family: "Geist"; src: url\("\.\/fonts\/geist\.woff2"\)/);
  assert.match(tokens, /--t-hero: 500 52px\/60px var\(--font-money\)/);
});

test("rebrand: the glow is Black's only (dim .30), White has none, and mint is the one brand colour", () => {
  const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  const rebrand = tokens.slice(tokens.indexOf("Rebrand (product decision, 4 Nov"));
  const [white, black] = rebrand.split(':root[data-theme="dark"]');
  assert.match(white!, /--glow-coin: 0;/);
  assert.match(white!, /--bloom: none;/);
  assert.match(black!, /--glow-coin: \.30;/);
  assert.match(white!, /--mint: #2ee6a6;/);
  assert.match(white!, /--mute: #6c6c72;/, "5.2:1 on White");
  assert.match(black!, /--mute: #9a9aa0;/, "7.5:1 on Black");
});
