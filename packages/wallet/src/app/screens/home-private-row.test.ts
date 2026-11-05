// Product decision, 5 Nov (Sim Home shot): Home's Private row read one word a line ("Priv / ate / The / public …"). The row is a
// .wl-row, a grid of 30 px icon | words | figure, and Private has no icon, so its words sat in the 30 px column. The fix:
// a no-icon row (.wl-row--text) is words | figure. Control: the coin rows keep their icon column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const home = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");

test("Home's Private row is a no-icon row, laid out words | figure (control: a coin row keeps its 30 px icon column)", () => {
  assert.match(home, /className="wl-row wl-pick wl-row--text" data-testid="safe-private"/);
  assert.match(css, /\.wl-row\.wl-row--text \{ grid-template-columns: 1fr auto; \}/);
  assert.match(css, /\.wl-row \{ display: grid; grid-template-columns: 30px 1fr auto;/, "control: rows with an icon keep it");
  assert.doesNotMatch(home, /className="wl-row wl-pick" data-testid="safe-private"/, "control: the old one-column-squeezed row is gone");
});
