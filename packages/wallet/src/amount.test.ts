import { test } from "node:test";
import assert from "node:assert/strict";
import { fromUnits, isDecimal, toUnits, usdOf } from "./amount.ts";

test("decimal strings and whole units convert exactly, both ways", () => {
  assert.equal(toUnits("1.5", 6), 1_500_000n);
  assert.equal(toUnits("0.00125", 9), 1_250_000n);
  assert.equal(toUnits("12", 0), 12n);
  assert.equal(toUnits("1.50", 1), 15n, "trailing zeros past the coin's decimals are fine");
  assert.equal(fromUnits(1_500_000n, 6), "1.5");
  assert.equal(fromUnits("1000000000000000000000000", 24), "1");
  assert.equal(fromUnits(1n, 18), "0.000000000000000001");
  assert.equal(fromUnits(0n, 6), "0");
});

test("anything that isn't a plain decimal, or is finer than the coin, is refused", () => {
  for (const bad of ["", "1e6", "-1", "1.", ".5", "01", "1,5", " 1", "NaN"]) {
    assert.equal(isDecimal(bad), false, bad);
    assert.equal(toUnits(bad, 6), null, bad);
  }
  assert.equal(toUnits("0.0000001", 6), null);
});

test("dollar estimates round down to cents and never use exponent notation", () => {
  assert.equal(usdOf("12.5", "0.999545"), "12.49");
  assert.equal(usdOf("0.05", 101.75), "5.08");
  assert.equal(usdOf("1000000", 0.0000001), "0.10");
  assert.equal(usdOf("3", "2"), "6.00");
  assert.equal(usdOf("1", undefined), undefined);
  // A balance row says what the sheet says: to the nearest cent (grade 02h, H1: 7.1049 NEAR at $4.2795 = $30.4054).
  assert.equal(usdOf("7.1049", "4.2795", true), "30.41");
  assert.equal(usdOf("7.1049", "4.2795"), "30.40");
  assert.equal(usdOf("0.05", 101.75, true), "5.09");
});

test("W-5: amount math refuses a bad number of decimals instead of computing with it", () => {
  for (const d of [-1, 2.5, 1_000_000, Number.NaN, 37]) {
    assert.equal(toUnits("1", d), null, `toUnits with ${d} decimals`);
    assert.throws(() => fromUnits(1n, d), /decimals/, `fromUnits with ${d} decimals`);
  }
  assert.equal(toUnits("1", 24), 10n ** 24n, "NEAR's 24 decimals are fine");
});
