// Phone test (3 Nov): Activity's proof page drew "Star / ted", "Fini / she / d": its rows have no logo, so the
// shared .wl-row grid (30px logo, text, right) put the label in the 30 px logo column. Rows with no logo use .wl-row-2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./ActivityDetail.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../wallet.css", import.meta.url), "utf8");

test("every row on Activity's proof page is the two-column row (no logo column for the label to fall into)", () => {
  const rows = src.match(/className="wl-row(?: [^"]*)?"/g) ?? [];
  assert.ok(rows.length >= 4, `rows found: ${rows.length}`);
  for (const r of rows) assert.match(r, /\bwl-row-2\b/, `a row without wl-row-2: ${r}`);
  assert.match(css, /\.wl-row-2\s*\{\s*grid-template-columns:\s*1fr auto;/, "the two-column row is text, then the right side");
  // control: the bare shared row has a 30 px first column, which is what broke the label
  assert.match(css, /\.wl-row \{[^}]*grid-template-columns: 30px 1fr auto;/);
  assert.doesNotMatch('className="wl-row"', /\bwl-row-2\b/);
});

test("R2 (the test list, no grey pills): Copy and View stay text links on the right of plain rows, on the facts and the proof rows", () => {
  assert.equal((src.match(/className="zf-chip"/g) ?? []).length, 0, "no chips");
  assert.equal((src.match(/className="zf-link"/g) ?? []).length, 3, "a fact's Copy, a transaction's Copy and View");
});
