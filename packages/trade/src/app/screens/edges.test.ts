// R3 edges (review, 4 Nov; Home's cdd8204d + 19f8bb7e): nothing in Trade is cut hard at either edge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./sheet.css", import.meta.url), "utf8");
const coin = readFileSync(new URL("../coinpage.css", import.meta.url), "utf8");

test("every Trade sheet fades what scrolls up 20 px before the title, Home's exact values", () => {
  assert.match(css, /\.tr-app \.zf-sheet__content \{[^}]*mask-image: linear-gradient\(to bottom, transparent 0, transparent calc\(var\(--zf-top, env\(safe-area-inset-top, 0px\)\) \+ 48px\), #000 calc\(var\(--zf-top, env\(safe-area-inset-top, 0px\)\) \+ 68px\)\)/);
});

test("Trade's own screens fade under the bar: the scroll area starts 20 px higher with 20 px padding, the bar on top with a ground solid to its last 20 px", () => {
  assert.match(css, /\.tr-app \.af-main \{ margin-top: -20px; padding-top: 20px;[^}]*mask-image: linear-gradient\(to bottom, transparent 0, #000 20px\)/);
  assert.match(css, /\.tr-app \.af-top \{ z-index: 2; background: linear-gradient\(to bottom, var\(--bg\) calc\(100% - 20px\)/);
});

test("the coin page's floor has no hairline, a solid ground across the gutters and 32 px of fade above it (control: coinpage.css still draws the line)", () => {
  assert.match(css, /\.tr-app \.cp \.tr-coin-floor \{ box-shadow: none; \}/);
  assert.match(css, /\.tr-app \.cp \.tr-coin-floor::before \{[^}]*z-index: -1;[^}]*left: calc\(-1 \* var\(--gutter, 28px\)\);[^}]*top: -32px; bottom: 0;[^}]*transparent\) 0, var\(--bg\) 32px\)/);
  assert.match(coin, /\.cp \.tr-coin-floor \{[^}]*box-shadow: 0 -1px 0 var\(--line\)/, "control: the line the override removes");
});

test("the Buy page is its sheet's height exactly, so it never scrolls by its 4 px foot", () => {
  assert.match(css, /\.tp \{ position: relative; display: flex; flex-direction: column; min-height: 100%; padding-bottom: 4px; \}/, "control: the foot");
  assert.match(css, /\.tp \{ box-sizing: border-box; \}/);
});
