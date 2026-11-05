import { test } from "node:test";
import assert from "node:assert/strict";
import { isPositive, press, type Key } from "./keypad.ts";

const type = (keys: string, decimals = 2) => [...keys].reduce((v, k) => press(v, (k === "<" ? "del" : k) as Key, decimals), "0");

test("typing builds a decimal string with no leading zero", () => {
  assert.equal(type("20"), "20");
  assert.equal(type("004.2"), "4.2");
  assert.equal(type(".5"), "0.5");
});

test("the coin's decimals cap the fraction, and a second point is ignored", () => {
  assert.equal(type("4.205"), "4.20");
  assert.equal(type("4..2"), "4.2");
  assert.equal(type("7.", 0), "7");
});

test("delete walks back to zero, never to empty", () => {
  assert.equal(type("4.2<<<"), "0");
  assert.equal(type("<"), "0");
});

test("whole digits are capped", () => {
  assert.equal(type("1234567890"), "123456789");
});

test("only an amount above zero can be sent", () => {
  assert.equal(isPositive("0"), false);
  assert.equal(isPositive("0.00"), false);
  assert.equal(isPositive("0.01"), true);
});

test("rebrand: a key the amount can't take is a refusal (the figure shakes); delete at zero is not", async () => {
  const { isRefused } = await import("./keypad.ts");
  assert.equal(isRefused("123456789", press("123456789", "1", 2), "1"), true, "the figure is full");
  assert.equal(isRefused("4.2", press("4.2", ".", 2), "."), true, "a second point");
  assert.equal(isRefused("0", press("0", "del", 2), "del"), false, "nothing to take back");
  assert.equal(isRefused("4", press("4", "2", 2), "2"), false, "control: a digit that lands");
});

test("Finding 37: a figure the person didn't type is typed over, not added to ($25 then 1 is 1; control: a typed one grows)", async () => {
  const { padBase } = await import("./keypad.ts");
  assert.equal(press(padBase("25", true), "1", 2), "1");
  assert.equal(press(padBase("25", false), "1", 2), "251", "control: typed by the person, the key adds");
  assert.equal(press(padBase("25", true), ".", 2), "0.");
  assert.equal(press(padBase("25", true), "del", 2), "0");
  assert.equal(press("", "0", 2), "0");
});
