import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeclined, payProblems } from "./pay-problems.ts";

const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");

test("every Pay Problem has a unique code, the three parts, and a row in errors.md", () => {
  const codes = new Set<string>();
  for (const [name, make] of Object.entries(payProblems)) {
    const p = (make as (...a: unknown[]) => ReturnType<typeof payProblems.codeUnreadable>)("Banxa", "x");
    assert.match(p.code, /^pay(\.[a-z-]+)+$/, name);
    assert.ok(!codes.has(p.code), `${p.code} is used twice`);
    codes.add(p.code);
    assert.ok(p.whatHappened.length > 0 && p.whatHappened.length < 140, `${p.code}: what happened, in one or two short sentences`);
    assert.ok(p.money && p.next?.label, `${p.code}: money state and one next step`);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
  for (const row of catalogue.matchAll(/^\| `(pay\.[a-z.-]+)`/gm)) assert.ok(codes.has(row[1]), `errors.md lists ${row[1]}, which Pay never produces`);
});

test("Pay's words never promise what nobody can", () => {
  for (const make of Object.values(payProblems)) {
    const p = (make as (...a: unknown[]) => ReturnType<typeof payProblems.codeUnreadable>)("Banxa", "x");
    const words = `${p.whatHappened} ${p.more ?? ""} ${p.next.label} ${"where" in p.money ? p.money.where : ""}`;
    // "Safe" the name of the main money (the house style) is not a promise; "safe" the adjective is
    assert.doesNotMatch(words.replace(/\b(your|the) Safe\b|\bSafe's\b/g, ""), /\b(safe|safely|guarantee[ds]?|unhackable|anonymous|risk-free|yet)\b/i, p.code);
    assert.notEqual(p.money.state, "not-involved", `${p.code}: every Problem says where the money is`);
  }
});

test("a declined signature is told apart from a failure", () => {
  assert.ok(isDeclined({ code: "ledger.signature.declined", whatHappened: "", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } }));
  assert.ok(!isDeclined(payProblems.quoteFailed()));
});
