import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Problem } from "@zerofee/core/problem";
import { earnProblems } from "./earn-problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
const all = Object.entries(earnProblems).map(([name, make]) => [name, (make as (...a: unknown[]) => Problem)("Allnodes", "0", "10", "2026-10-26T00:00:00.000Z", 60)] as const);

test("every Earn Problem has a unique code, the three parts, no promises, and a row in errors.md", () => {
  const codes = new Set<string>();
  for (const [name, p] of all) {
    assert.match(p.code, /^earn(\.[a-z-]+)+$/, name);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: what happened, in one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: where the money is, and one next step`);
    if (p.money.state !== "not-involved") assert.ok(p.money.where, `${p.code}: says where the money is`);
    // "your Safe" is the main money's name (the house style), never a promise
    assert.doesNotMatch(`${p.whatHappened} ${p.more ?? ""} ${p.next.label}`.replace(/\byour Safe\b/g, "your S"), /\b(safe|guaranteed|unhackable|promise)\b/i, `${p.code}: no promises`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
});

test("errors.md lists no code the app can't produce", () => {
  const listed = [...catalogue.matchAll(/`(earn\.[a-z.-]+)`/g)].map((m) => m[1]);
  const made = new Set(all.map(([, p]) => p.code));
  for (const c of listed) assert.ok(made.has(c), `${c} is in errors.md but no Problem makes it`);
});
