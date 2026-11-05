// The phone's core (apps/ios/core/build.mjs, its own rolldown build) reads the $1 proof flag (home-proof.ts,
// VITE_HOME_PROOF) as the page does. Before 3 Nov it bundled `{}.env?.VITE_HOME_PROOF`, so the phone's core was never the
// proof build: the NEAR wallet → AgentZero fill and Home's two-leg moves refused "opens after its $1 test" on a
// test phone. Control: the release default ("") keeps it off, and only VITE_HOME_PROOF reaches the core.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../apps/ios/core/build.mjs", import.meta.url), "utf8");

test("the phone's core gets import.meta.env from the build: VITE_HOME_PROOF only, \"1\" only when the build says so", () => {
  assert.match(src, /export const CORE_ENV = \{ VITE_HOME_PROOF: process\.env\.VITE_HOME_PROOF === "1" \? "1" : "" \};/);
  assert.match(src, /transform: \{ define: \{ "import\.meta\.env": JSON\.stringify\(CORE_ENV\) \} \}/);
  // control: nothing else from the environment reaches the trusted core
  assert.equal((src.match(/process\.env\.[A-Z_]+/g) ?? []).filter((v) => v !== "process.env.VITE_HOME_PROOF").length, 0);
  // home-proof.ts reads it in the form this define replaces (the public web build too, since 3 Nov: the
  // go for Home's money paths there; its core is the page's own, built with the page's env)
  const proof = readFileSync(new URL("../../packages/core/src/home-proof.ts", import.meta.url), "utf8");
  assert.match(proof, /export const HOME_PROOF: boolean = false \|\| import\.meta\.env\?\.VITE_HOME_PROOF === "1";/);
});
