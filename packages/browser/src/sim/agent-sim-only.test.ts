// b18: the Sim's thinker and site window load only where the Sim is on. The one door is sites-data.ts simAgent() (a
// dynamic import behind simSitesOn); no other module imports them; the extension's gate refuses them and its stand-in
// for sites-data.ts returns null; the phone and a real page get null.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { simAgent } from "./sites-data.ts";
import { simProblems } from "../../../../apps/extension/src/no-sim/build.ts";
import { simAgent as extSimAgent } from "../../../../apps/extension/src/no-sim/sites-data.ts";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
/** An import of one of them: from inside packages/browser/src/sim ("./agent-…"), or by path from anywhere else. */
const NAMES = "(sim|host|thinker|fixtures|injections|suite)(\\.ts)?";
const imports = (f: string, text: string) => new RegExp(`(from|import\\()\\s*["'](${f.startsWith("packages/browser/src/sim/") ? "\\.\\/|" : ""}[^"']*browser\\/src\\/sim\\/|@zerofee\\/browser\\/sim\\/)agent-${NAMES}["']`).test(text);

test("only the Sim's own files import its browser (and sites-data.ts, by a dynamic import behind simSitesOn)", () => {
  const files = execFileSync("git", ["ls-files", "apps", "packages"], { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
  // control: the scan sees a known importer
  const importers = files.filter((f) => imports(f, readFileSync(`${repo}${f}`, "utf8")));
  assert.ok(importers.includes("packages/browser/src/sim/sites-data.ts"), "control");
  for (const f of importers) assert.ok(f.startsWith("packages/browser/src/sim/"), f);
  const door = readFileSync(`${repo}packages/browser/src/sim/sites-data.ts`, "utf8");
  assert.match(door, /if \(phone \|\| !simSitesOn\(env\)\) return null;\s*return \(await import\("\.\/agent-sim\.ts"\)\)/);
  assert.doesNotMatch(door, /^import .*agent-/m, "no static import");
});

test("the phone and a real page get no Sim browser; the extension never has one", async () => {
  assert.equal(await simAgent({ sim: false, demo: false, phone: false }), null);
  assert.equal(await simAgent({ sim: true, demo: true, phone: true }), null, "on the phone a site opens in its real window");
  assert.equal(await extSimAgent({ sim: true }), null);
  for (const f of ["agent-sim", "agent-host", "agent-thinker", "agent-fixtures"]) assert.ok(simProblems([`${repo}packages/browser/src/sim/${f}.ts`]).some((p) => p.includes(f)), f);
});

test("in the Sim it loads, and runs a task to its report", async () => {
  const cloud = await simAgent({ sim: true, demo: true, phone: false });
  assert.ok(cloud);
  const { id } = await cloud.start("Find the price of the Red mug on mugs.example.com", "https://mugs.example.com/");
  const end = await new Promise<string>((resolve) => cloud.events(id, (e) => e.kind === "done" && resolve(e.summary ?? "")));
  assert.match(end, /\$14\.50/);
});

test("the Sim's list of sites AgentZero opens is the made-up sites' own", async () => {
  const { SIM_AGENT_SITES } = await import("./sites-data.ts");
  const { FIXTURE_SITES } = await import("./agent-fixtures.ts");
  assert.deepEqual([...SIM_AGENT_SITES].sort(), Object.keys(FIXTURE_SITES).sort());
});
