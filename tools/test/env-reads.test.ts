// Every build flag in packages/ and apps/ is read in the form Vite writes as a literal (env-reads.ts; the audit's finding,
// 7 Nov: 31 reads through `(import.meta as { env?: … }).env?.VITE_X`). Cheap: one read of each tracked source file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { codeOnly, inScope, looseEnvReads } from "./env-reads.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("the reads it catches, and the ones Vite folds that it lets through (table)", () => {
  const caught: Array<[string, string]> = [
    ['const a = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_X === "1";', "cast"],
    ['const a = (import.meta as any).env.VITE_X;', "cast"],
    ['const a = ( import.meta as unknown as { env: X }).env.VITE_X;', "cast"],
    ['const a = import.meta.env["VITE_X"];', "bracket"],
    ['const a = import.meta.env?.["VITE_X"];', "bracket"],
    ['const a = import.meta["env"].VITE_X;', "bracket"],
    ['const a = import.meta?.env?.VITE_X;', "optional-meta"],
    ["const env = import.meta.env;", "whole"],
    ["const f = (env = import.meta.env) => env.VITE_X;", "whole"],
    ['const a = typeof import.meta.env !== "undefined" ? 1 : 0;', "whole"],
  ];
  for (const [src, why] of caught) assert.deepEqual(looseEnvReads(src).map((r) => r.why), [why], src);
  const folded = [
    'const a = import.meta.env.VITE_X === "1";',
    'const a = import.meta.env?.VITE_X === "1";',
    "const a = import.meta.env.PROD;",
    "const a = import.meta.env?.DEV && import.meta.env?.VITE_Y;",
    'const u = new URL("./x.svg", import.meta.url);',
    "// (import.meta as { env?: X }).env?.VITE_X, a comment",
    "/* const env = import.meta.env; */ const b = 1;",
  ];
  for (const src of folded) assert.deepEqual(looseEnvReads(src), [], src);
});

test("a hit names its line, comments kept out without moving lines", () => {
  const src = "/* one\n two */\nconst x = 1; // import.meta.env\nconst y = (import.meta as { env?: X }).env?.VITE_Y;\n";
  assert.deepEqual(looseEnvReads(src).map((r) => [r.line, r.why]), [[4, "cast"]]);
  assert.equal(codeOnly(src).split("\n").length, src.split("\n").length);
});

test("no source file in packages/ or apps/ reads a build flag in a form Vite may not fold (control: the old rulebox read is caught)", () => {
  const files = execFileSync("git", ["ls-files", "packages", "apps"], { cwd: root, encoding: "utf8" }).split("\n").filter(inScope);
  assert.ok(files.length > 500, `the scan sees the app's code (${files.length} files)`);
  assert.ok(files.includes("packages/agent/src/zero/rulebox.ts") && files.includes("apps/web/src/mode.ts"), "control: the scan includes the files 83 named");
  assert.ok(!files.some((f) => /\.test\.[a-z]+$/.test(f) || /vite\.config\.ts$/.test(f)), "tests and build configs are out of scope");
  const loose = files.flatMap((f) => looseEnvReads(readFileSync(`${root}/${f}`, "utf8")).map((r) => `${f}:${r.line} ${r.why}: ${r.text}`));
  assert.deepEqual(loose, []);
  // control: rulebox.ts's test-lane read as it was before 7 Nov would be caught, and its present form isn't
  const rulebox = readFileSync(`${root}/packages/agent/src/zero/rulebox.ts`, "utf8");
  assert.match(rulebox, /if \(import\.meta\.env\?\.VITE_ZF_TEST_LANE !== "1"\) return \{\};/);
  const old = rulebox.replace("if (import.meta.env?.VITE_ZF_TEST_LANE", "if ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ZF_TEST_LANE");
  assert.deepEqual(looseEnvReads(old).map((r) => r.why), ["cast"]);
});
