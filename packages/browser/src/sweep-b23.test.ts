// Builder 23, item 6 (audit 18's sweep outside builder 22's files: "…", "soon", "OK" buttons in the areas builder 23
// owns): Social trading's line names its sites with no "more soon" (end to end or hidden); the site window, the hub's
// figure and Make ready have no ellipsis; the extension's problems close with "Close" (a button says what happens).
// Fails on main 5d80fde2e.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOCIAL_TRADING } from "./social/social-trading.ts";
import { extProblems } from "../../../apps/extension/src/problems.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("no 'soon', no ellipsis on the Social and site screens", () => {
  assert.equal(SOCIAL_TRADING.line, "pump.fun and GMGN");
  assert.doesNotMatch(read("./social/SiteApp.tsx"), /`Opening \$\{name\}…`/);
  assert.doesNotMatch(read("./social/SocialApp.tsx"), /ready…`/);
  assert.doesNotMatch(read("./social/SocialHub.tsx"), /"Solana didn't answer" : "…"/);
});

test("the extension's problems never end on an OK button", () => {
  const src = read("../../../apps/extension/src/problems.ts");
  assert.doesNotMatch(src, /label: "OK"/);
  assert.ok(extProblems);
  assert.doesNotMatch(read("../../../apps/extension/errors.md"), /\| OK( \(nothing\))? \|$/m);
});
