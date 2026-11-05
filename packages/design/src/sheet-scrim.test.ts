// A sheet's scrim ignores a tap in the first 300 ms after the open: a double tap on a tile must not open and shut the
// sheet at once (Earn crawl, 5 Nov). The Close button and Back are not guarded: they are never the double tap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCRIM_GUARD_MS } from "./sheet-scrim.ts";

test("the scrim's tap is guarded for 300 ms after the open; Close is not", () => {
  assert.equal(SCRIM_GUARD_MS, 300);
  const src = readFileSync(new URL("./Sheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const openedAt = useRef\(performance\.now\(\)\);/);
  assert.match(src, /const onScrim = \(\) => \{ if \(performance\.now\(\) - openedAt\.current < SCRIM_GUARD_MS\) return; close\(\); \};/);
  assert.match(src, /className="zf-sheet__scrim" onClick=\{onScrim\}/);
  assert.match(src, /className="zf-sheet__close" onClick=\{close\}/, "Close itself is never guarded");
});
