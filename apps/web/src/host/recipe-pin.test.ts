// Security's review, SHOULD 1: the iPhone host pins the recipes it accepts (apps/ios/ZeroFee/PinnedRecipes.swift). That
// table must be exactly what the shell compiles (Pay's recipes) and Browser's presets: this fails when either side
// changes without the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pinnedTable } from "./partner.ts";

const swift = readFileSync(new URL("../../../ios/ZeroFee/PinnedRecipes.swift", import.meta.url), "utf8");

test("the Swift pin table equals Pay's compiled recipes, Browser's presets and the typed-site chains", () => {
  const m = swift.match(/\/\/ PIN-BEGIN\n\s*static let json = #"(.*)"#\n\s*\/\/ PIN-END/);
  assert.ok(m, "PinnedRecipes.swift has its PIN block");
  assert.deepEqual(JSON.parse(m![1]!), JSON.parse(JSON.stringify(pinnedTable())));
});

test("the control: a changed recipe would not match", () => {
  const t = JSON.parse(JSON.stringify(pinnedTable()));
  t.recipes[0].hosts.push("evil.example");
  const m = swift.match(/static let json = #"(.*)"#/);
  assert.notDeepEqual(JSON.parse(m![1]!), t);
});
