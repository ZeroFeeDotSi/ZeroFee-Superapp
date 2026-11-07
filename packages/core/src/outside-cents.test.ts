// the audit's Send audit M7 (7 Nov): the Private-only Send sheet (outsideLines) rounded "They get" and the fee apart under a
// title of $X.toFixed(2): amountInUsd 5.0049, amountOutUsd 4.9851 said "$5.00", "They get about $4.99", "Fees · about
// $0.02": $5.01. Now one cent figure each: what they get by the app's one rounding rule, the fee the rest of the title's cents. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { outsideLines } from "./subwallets.ts";

const cents = (l: string) => Math.round(Number(/\$([\d.]+)/.exec(l)![1]) * 100);

test("M7: the audit's case adds up to the title's cent: $5.00 = $4.99 + $0.01", () => {
  const { lines } = outsideLines("bob.near", "5.0049", "4.9851", "NEAR");
  const get = lines.find((l) => l.startsWith("They get"))!, fee = lines.find((l) => l.startsWith("Fees"))!;
  assert.equal(get, "They get about $4.99");
  assert.equal(fee, "Fees · about $0.01");
  assert.equal(cents(get) + cents(fee), Math.round(Number((5.0049).toFixed(2)) * 100));
});

test("M7: across many half-cent figures, they get + fees always equal the title's cents, and what they get is the quote's own figure to the cent (half up, core cents.ts)", () => {
  for (let a = 1.001; a < 30; a += 0.7373) for (const keep of [0.9, 0.97, 0.995, 1]) {
    const b = a * keep, title = Math.round(Number(a.toFixed(2)) * 100);
    const { lines } = outsideLines("bob.near", a.toFixed(4), b.toFixed(4), "NEAR");
    const get = cents(lines.find((l) => l.startsWith("They get"))!), fee = cents(lines.find((l) => l.startsWith("Fees"))!);
    assert.equal(get + fee, title, `${a} ${b}`);
    assert.ok(Math.abs(get - Number(b.toFixed(4)) * 100) <= 0.5 + 1e-6, `${a} ${b}`);
  }
});

test("M7 controls: no dollars known, only the address and the network; they get more than went in, the same", () => {
  assert.equal(outsideLines("bob.near", undefined, "4", "NEAR").lines.length, 2);
  assert.equal(outsideLines("bob.near", "4", "5", "NEAR").lines.length, 2);
});
