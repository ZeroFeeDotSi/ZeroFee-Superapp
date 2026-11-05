// Trenches' rows and chain chips (a-nav-5, QA's crawl row 8): names take the free width, the cap says what it is, the
// chip row ends clear of the pinned Move button with room at its scroll's end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("./discover.css", import.meta.url)), "utf8");

test("the name is cut only at the cell's end, the cap is labelled, the chips keep clear of Move", () => {
  assert.match(css, /\.dc-tabs \{ margin-right: 16px; padding-right: 24px; \}/);
  assert.match(css, /\.dc-name \{ flex: 0 1 auto; max-width: 100%; \}/);
  // a16 (Sim re-walk): no label before the figure ("mcap" and "cap" are jargon); a dot, and the line never wraps
  assert.match(css, /\.dc-cap::before \{ content: "·"; margin: 0 \.35em; color: var\(--mute\); \}/);
  assert.doesNotMatch(css, /content: "mcap"|content: "cap"/);
  assert.match(css, /\.dc-sub \{ flex-wrap: nowrap; column-gap: 0; \}/, "the name gives way, the figure never drops to a third line");
});
