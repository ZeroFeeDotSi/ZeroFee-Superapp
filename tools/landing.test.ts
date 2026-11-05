// Checks that run before a branch lands on main (CONTRIBUTING.md, "Landing on main").
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("commits about to land carry UTC times only (a rebase without TZ=UTC stamps the local zone)", () => {
  let log: string;
  try {
    log = execFileSync("git", ["log", "--format=%h %ai | %ci  %s", "main..HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return; // not a git checkout (e.g. a source archive): nothing to land
  }
  const local = log.split("\n").filter((line) => line && !/^[0-9a-f]+ \S+ \S+ \+0000 \| \S+ \S+ \+0000 {2}/.test(line));
  assert.deepEqual(local, [], "re-stamp these in UTC: TZ=UTC git rebase -f main");
});

// Compiled contracts keep the paths they were built in unless the build remaps them (build:contracts does), and a path
// on a developer's machine names that machine's user. A text diff never shows what's inside a .wasm, so check here.
const BUILT_PATH = /\/Users\/|\/home\/(?!\/)[a-z]|-Users-|\/private\/tmp\/|claude-\d{3}/;
/** Known, with their owner, until rebuilt. None now. */
const KNOWN_UNTIL_REBUILT: string[] = [];

test("no committed contract build carries the path of the machine it was built on", () => {
  let files: string[];
  try {
    files = execFileSync("git", ["ls-files", "*.wasm"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
  } catch {
    return; // not a git checkout
  }
  const leaking = files.filter((f) => !KNOWN_UNTIL_REBUILT.includes(f) && BUILT_PATH.test(readFileSync(f, "latin1")));
  assert.deepEqual(leaking, [], "rebuild these with the paths remapped (see build:contracts)");
});
