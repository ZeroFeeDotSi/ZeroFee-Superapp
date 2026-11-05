// Audit NF-14 (network and supply chain, 28 Oct 2026; FIXED): every package the trusted core's build script imports is a
// declared, exactly pinned dependency, so the bundle Swift runs is built from what package-lock.json names, not from a
// package reached through another one's version range.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("NF-14: every package the trusted core's build script imports is declared, at an exact version", () => {
  const declared = new Map<string, string>();
  for (const p of [join(repo, "package.json"), ...["packages", "apps"].flatMap((d) => readdirSync(join(repo, d)).map((x) => join(repo, d, x, "package.json")))]) {
    try {
      const j = JSON.parse(readFileSync(p, "utf8"));
      for (const s of ["dependencies", "devDependencies"]) for (const [k, v] of Object.entries(j[s] ?? {})) declared.set(k, String(v));
    } catch {
      // no package.json there
    }
  }
  const src = readFileSync(join(repo, "apps/ios/core/build.mjs"), "utf8");
  const imported = [...src.matchAll(/from\s+"([^".][^"]*)"/g)].map((m) => m[1]!).filter((m) => !m.startsWith("node:"));
  assert.ok(imported.length > 0);
  for (const m of imported) assert.match(declared.get(m) ?? "undeclared", /^\d+\.\d+\.\d+$/, `${m} is ${declared.get(m) ?? "declared nowhere"}`);
});
