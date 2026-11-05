// UX walk 2 Nov (a real account, saved changes 2 and 3 with the same rules): Security's overview showed
// two identical "Change your protection · Finish" rows. One row each, the newest; payments never merged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oneRowEach } from "./waiting-rows.ts";

const change = (id: string, over: Record<string, unknown> = {}) => ({ id, title: "Change your protection", lines: ["Payments up to $21 go as soon as you approve.", "Bigger ones go as soon as you approve."], ready: true, change: true, ...over });

test("two saved changes that say the same thing are one row: the newest (the one to finish)", () => {
  // its two, as account.waiting gave them: the coin details behind "See which coins count" differ by a price tick
  const eth = (n: string) => ({ details: [{ label: "See which coins count", lines: [`ETH: up to ${n} ETH`] }] });
  assert.deepEqual(oneRowEach([change("2", eth("0.00915")), change("3", eth("0.00916"))]).map((w) => w.id), ["3"]);
  assert.deepEqual(oneRowEach([change("10"), change("9")]).map((w) => w.id), ["10"], "by number, not by text ('10' > '9')");
});

test("controls: different words, a different state or a payment stay their own rows", () => {
  assert.equal(oneRowEach([change("2"), change("3", { lines: ["Payments up to $50: go as soon as you approve"] })]).length, 2);
  assert.equal(oneRowEach([change("2"), change("3", { ready: false })]).length, 2);
  assert.equal(oneRowEach([change("2"), change("3", { needsSecondDevice: true })]).length, 2);
  const pay = (id: string) => ({ ...change(id), title: "Send $5 to bob.near", change: false });
  assert.deepEqual(oneRowEach([pay("4"), pay("5")]).map((w) => w.id), ["4", "5"], "two identical payments are two payments");
});
