// Security review of 9004735f (b): a page never asks the core for a site's two-factor code. The native host refuses
// every site2fa.* method from a page before the isolated-core switch is even read, and the core's codeFor takes the
// main frame's origin as WebKit gives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const isolated = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/IsolatedCore.swift", import.meta.url)), "utf8");
const core = readFileSync(fileURLToPath(new URL("../../packages/core/src/site-2fa.ts", import.meta.url)), "utf8");

test("review (b): pages are refused site2fa.* whatever the isolated-core switch says", () => {
  const body = isolated.slice(isolated.indexOf("func pageMayUse("));
  const refuse = body.indexOf('if method.hasPrefix("site2fa.") { return false }');
  const sw = body.indexOf("guard Self.isolatedCoreWanted else { return true }");
  assert.ok(refuse > 0 && sw > 0 && refuse < sw, "the site2fa refusal comes before the switch's early yes");
});

test("review (b): codeFor names the main frame's origin", () => {
  assert.match(core, /async codeFor\(mainFrameOrigin: string\)/);
});
