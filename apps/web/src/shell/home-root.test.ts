// The Home tab tapped again while a Home sub-page or sheet is open returns Home to its root (a-nav-5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const host = readFileSync(fileURLToPath(new URL("./AppHost.tsx", import.meta.url)), "utf8");

test("tapping the tab already on screen closes its money sheet and tells the app (zf:home-root)", () => {
  assert.match(host, /if \(j !== goal\.current\) goRef\.current\(j, 0, false, felt\);\s*else homeRootRef\.current\(id!\);/);
  assert.match(host, /window\.dispatchEvent\(new CustomEvent\("zf:home-root", \{ detail: \{ app: id \} \}\)/);
  // the shell only announces: it never ends a money sheet itself (that skipped MoneyHost's sealed Close)
  const fn = host.slice(host.indexOf("const homeRoot = "), host.indexOf("const homeRootRef"));
  assert.doesNotMatch(fn, /setMoney|onEnd|went/);
});
