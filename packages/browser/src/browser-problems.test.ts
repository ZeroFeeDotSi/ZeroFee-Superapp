import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { browserProblems } from "./browser-problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
const all = () => Object.entries(browserProblems).map(([name, make]) => [name, (make as (...a: string[]) => Problem)("pump.fun", "pump.fun")] as const);

test("every Browser Problem has a unique code, the three parts, and a row in errors.md", () => {
  const codes = new Set<string>();
  for (const [name, p] of all()) {
    assert.match(p.code, /^browser(\.[a-z-]+)+$/, name);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: what happened, in one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: money state and one next step`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
  for (const row of catalogue.matchAll(/^\| `(browser\.[a-z.-]+)`/gm)) assert.ok(codes.has(row[1]), `errors.md lists ${row[1]}, which the Browser never produces`);
});

test("the Browser's words never promise what nobody can, and always say where the money is", () => {
  for (const [, p] of all()) {
    const words = `${p.whatHappened} ${p.more ?? ""} ${p.next.label} ${"where" in p.money ? p.money.where : ""}`;
    // "your Safe" is the main money's name (the house style), never a promise that a site is safe
    assert.doesNotMatch(words.replace(/\byour Safe\b/g, "your S"), /\b(safe|safely|guarantee[ds]?|unhackable|anonymous|risk-free|yet|soon)\b/i, p.code);
    assert.notEqual(p.money.state, "not-involved", `${p.code}: every Problem says where the money is`);
  }
});
