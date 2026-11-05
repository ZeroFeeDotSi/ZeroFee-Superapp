// the audit's condition (5 Nov, the Move's split block): the phone's sheet drops its "Amount:" line only while one of the sheet's
// own lines says the signed amount's dollars, as the web's sheet-amount.ts does; the core's amountSaid flag alone never
// hides it. Swift has no test target here, so this reads the Swift source; each rule has a control (a bad snippet fails).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/SheetWords.swift", import.meta.url)), "utf8");
const code = (s: string) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");

function amountRules(swift: string): string[] {
  const p: string[] = [];
  const c = code(swift);
  const set = c.match(/self\.amount\s*=\s*([^\n]+)/g) ?? [];
  if (set.length !== 1) p.push("one place sets the sheet's amount");
  if (!/self\.amount\s*=\s*\(w\["amountSaid"\] as\? Bool\) == true && said \? nil : amount/.test(c)) p.push("the flag hides it only with `said`");
  if (!/let said = [^\n]*readLines\.contains/.test(c)) p.push("`said` reads the sheet's own lines");
  if (!/components\(separatedBy: " \("\)\[0\]/.test(c)) p.push("the dollars are the amount's own, before its coin figure");
  if (/self\.lines\s*=(?!\s*readLines\b)/.test(c)) p.push("the lines are shown as read, so the From your Safe line stays");
  return p;
}

test("83: SheetWords.swift drops \"Amount:\" only while a line says the signed amount's dollars (controls: a flag-only hide, and dropped lines, fail)", () => {
  assert.deepEqual(amountRules(src), []);
  const flagOnly = src.replace(/self\.amount = \(w\["amountSaid"\] as\? Bool\) == true && said \? nil : amount/, 'self.amount = (w["amountSaid"] as? Bool) == true ? nil : amount');
  assert.ok(amountRules(flagOnly).includes("the flag hides it only with `said`"), "control: the flag alone");
  const noLines = src.replace("self.lines = readLines", "self.lines = []");
  assert.ok(amountRules(noLines).includes("the lines are shown as read, so the From your Safe line stays"), "control: lines dropped");
});
