// Builder QA's item 2 (the review's tick 69 edge on b19's re-grade): "Private gets $4.37 so this move is harder to trace."
// still showed under a Move that can't go (Solana down, offline), the one promise line left. While Move can't go it goes
// with "Moves it to...", "About 1 min." and the arrives rows. Fails on main: privGets has no cantGo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateGetsLine } from "./move-split.ts";

const sheet = readFileSync(new URL("./MoveSheet.tsx", import.meta.url), "utf8");

test("Move can't go: no \"Private gets\" line", () => {
  assert.match(sheet, /const privGets = running \|\| cantGo \|\| legs\.length === 0/);
  assert.ok(sheet.indexOf("const cantGo =") < sheet.indexOf("const privGets ="), "cantGo is read first");
});

test("control: a Move that can go still says it", () => {
  assert.equal(privateGetsLine(0, 4.37), "Private gets $4.37 so this move is harder to trace.");
});
