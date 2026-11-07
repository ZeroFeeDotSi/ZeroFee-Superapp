// privateQuotesLoopback: a tool's own quote relay on loopback (tools/mainnet/local-relay.sh) is plain http, which the core
// takes only when that tool says so. The app's build never says so, and an http relay anywhere else is still refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("only the mainnet flows tool and the release-4 sandbox rehearsal set privateQuotesLoopback: never the app, the extension or any package", () => {
  const setters = [...sources(join(repo, "apps")), ...sources(join(repo, "packages")), ...sources(join(repo, "tools"))]
    .filter((f) => /privateQuotesLoopback\s*:/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(repo.length));
  assert.deepEqual(setters, ["tools/mainnet/flows.ts", "tools/mainnet/v4-sandbox.ts"]);
  const core = readFileSync(join(repo, "packages/core/src/demo-core.ts"), "utf8");
  assert.match(core, /const local = loopback && \/\^http:\\\/\\\/\(127\\\.0\\\.0\\\.1\|localhost\):\\d\{2,5\}\$\/\.test\(base\);/, "loopback only, a port, nothing after it");
});
