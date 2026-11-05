import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { walletProblems } from "./wallet-problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");

test("every ledger Problem has a unique code, the three parts, and a row in errors.md", () => {
  const codes = new Set<string>();
  for (const [name, make] of Object.entries(walletProblems)) {
    const p = (make as (...a: unknown[]) => ReturnType<typeof walletProblems.unexpected>)("x", 1);
    assert.match(p.code, /^ledger(\.[a-z-]+)+$/, name);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: what happened, in one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: money state and one next step`);
    // "Safe" the name of the main money (the house style) is not a promise; "safe" the adjective is
    assert.doesNotMatch(`${p.whatHappened} ${p.more ?? ""}`.replace(/\b(your|the) Safe\b|\bSafe's\b/g, ""), /\b(safe|guaranteed|unhackable)\b/i, `${p.code}: no promises`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
});
