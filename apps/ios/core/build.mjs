// Bundles the trusted core into one script for Swift's own JavaScriptCore context (S1.6 phase 2): entry.ts + the core +
// its libraries, as an IIFE with no imports, for the browser-like platform (no Node built-ins). Output: core/dist/zerofee-core.js,
// and its sha256 (printed, and in core/dist/SHA256SUMS), which each release publishes (audit NF-14). rolldown is a
// declared, exact dev dependency (package.json), not one reached through another package's range.
import { build } from "rolldown";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/**
 * The build flags the core reads (import.meta.env), as Vite gives them to the page: only VITE_HOME_PROOF (home-proof.ts,
 * D125: the $1 proof build, where Home's two-leg moves and the NEAR wallet → AgentZero fill run). Without this the
 * phone's core read `{}.env?.VITE_HOME_PROOF` and was never the proof build, whatever the page was (3 Nov). Unset, it is
 * "" and the core is a release core. Build the test phone with `VITE_HOME_PROOF=1 sh apps/ios/build-web.sh`.
 */
export const CORE_ENV = { VITE_HOME_PROOF: process.env.VITE_HOME_PROOF === "1" ? "1" : "" };
await build({
  input: join(here, "entry.ts"),
  platform: "browser",
  transform: { define: { "import.meta.env": JSON.stringify(CORE_ENV) } },
  output: { file: join(here, "dist", "zerofee-core.js"), format: "iife", minify: false, sourcemap: false },
  logLevel: "warn",
});
const bundle = join(here, "dist", "zerofee-core.js");
const sha = createHash("sha256").update(readFileSync(bundle)).digest("hex");
writeFileSync(join(here, "dist", "SHA256SUMS"), `${sha}  zerofee-core.js\n`);
console.log(`zerofee-core.js sha256 ${sha}`);
