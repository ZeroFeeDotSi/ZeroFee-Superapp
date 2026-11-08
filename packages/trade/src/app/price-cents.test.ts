// Audit 12's C4 (8 Nov): Trade's NEAR Intents tab priced NEAR "$3.7", as its headline and in its list. The money rule:
// a dollar figure under $1,000 has its cents, so a price reads "$3.70". A price may show more digits when it has them
// ("$3.1416", "$0.000021"), never fewer than two.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listPrice, price } from "./format.ts";

test("C4: a price has two decimals at least: $3.70, never $3.7 (controls: more digits stay; $10 and up has cents; the floor words stay)", () => {
  assert.equal(price(3.7), "$3.70", "the headline");
  assert.equal(listPrice(3.7), "$3.70", "the list row");
  assert.equal(price(4), "$4.00");
  assert.equal(price(0.5), "$0.50", "under a dollar too");
  assert.equal(price(0.1), "$0.10");
  assert.equal(price(1.25), "$1.25");
  assert.equal(price(3.1416), "$3.14", "audit 17 H1: $1 and up reads to the cent");
  assert.equal(price(0.00002134), "$0.000021", "control: a tiny price keeps its six decimals");
  assert.equal(price(8.37), "$8.37", "control");
  assert.equal(price(150), "$150.00", "control");
  assert.equal(price(2416.1), "$2,416.10", "control");
  assert.equal(price(0.000000001234), "under $0.000001", "control: the floor words");
});
