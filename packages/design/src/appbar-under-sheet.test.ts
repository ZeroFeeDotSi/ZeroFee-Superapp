// Under a sheet the bar's backdrop blur leaked: Chrome drew the blurred page in the frame's last 2 px under every sheet in
// Black (desktop audit, 5 Nov). While a sheet is up the bar is solid, as it is while pages move.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the app bar is solid, with no backdrop blur, while a sheet is up", () => {
  const css = readFileSync(new URL("./appbar.css", import.meta.url), "utf8");
  assert.match(css, /\.ah:has\(\.zf-sheet\) \.zf-appbar \{ background: var\(--bar-solid\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
});
