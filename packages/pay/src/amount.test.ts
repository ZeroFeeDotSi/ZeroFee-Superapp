import { test } from "node:test";
import assert from "node:assert/strict";
import { add, compare, fromUnits, isDecimal, mul, normalise, round, sub, toUnits, wholeUnits } from "./amount.ts";

test("decimal strings convert to base units and back, exactly", () => {
  assert.equal(toUnits("12.5", 6), 12_500_000n);
  assert.equal(toUnits("0.000001", 6), 1n);
  assert.equal(toUnits("1.500", 2), 150n, "trailing zeros past the precision are fine");
  assert.equal(toUnits("0.0000001", 6), null, "more precision than the coin has is refused, never rounded away");
  assert.equal(fromUnits(12_500_000n, 6), "12.5");
  assert.equal(fromUnits(1n, 24), "0.000000000000000000000001");
  assert.equal(fromUnits(0n, 6), "0");
});

test("only plain decimals count as amounts", () => {
  for (const ok of ["0", "12", "12.5", "0.000001"]) assert.ok(isDecimal(ok), ok);
  for (const bad of ["", "-1", "1e3", "1,000", ".5", "5.", " 1", "NaN"]) assert.ok(!isDecimal(bad), bad);
});

test("arithmetic never passes through a float", () => {
  assert.equal(add("0.1", "0.2"), "0.3");
  assert.equal(sub("5.27", "5"), "0.27");
  assert.equal(mul("5", "0.999545"), "4.997725");
  assert.equal(compare("1.10", "1.1"), 0);
  assert.equal(compare("0.30000000000000001", "0.3"), 1);
  assert.equal(normalise("012.50"), "12.5");
  assert.throws(() => sub("1", "2"));
});

test("rounding goes the way the screen needs", () => {
  assert.equal(round("5.2969431", 2, "up"), "5.3");
  assert.equal(round("5.2969431", 2, "down"), "5.29");
  assert.equal(round("5.00", 2, "up"), "5");
});

test("payment links' whole units, with or without an exponent (EIP-681)", () => {
  assert.equal(wholeUnits("2014000000000000000"), 2014000000000000000n);
  assert.equal(wholeUnits("2.014e18"), 2014000000000000000n);
  assert.equal(wholeUnits("1e6"), 1000000n);
  assert.equal(wholeUnits("1.5"), null, "half a base unit isn't a payment");
  assert.equal(wholeUnits("1.5e0"), null);
  assert.equal(wholeUnits("-1"), null);
});
