// QA's sd-errors crawl (4 Nov): Send and Swap read "1,5" and "1e5" as 15, "-5" as 5, and a 50-digit paste broke
// Send's screen. A pasted or typed amount is read as the keypad would have it, or refused with why: never guessed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAmount, refusedLine } from "./read-amount.ts";

const ok = (t: string, max?: number, dec?: number) => { const r = readAmount(t, max, dec); assert.ok("ok" in r, `${t}: ${JSON.stringify(r)}`); return r.ok; };
const no = (t: string, max?: number, dec?: number) => { const r = readAmount(t, max, dec); assert.ok("no" in r, `${t}: ${JSON.stringify(r)}`); return r.no; };

test("controls: plain amounts read as typed", () => {
  assert.equal(ok("25"), "25");
  assert.equal(ok("12.5"), "12.5");
  assert.equal(ok("$25"), "25");
  assert.equal(ok(" 7 "), "7");
  assert.equal(ok("007"), "7");
  assert.equal(ok(".5"), "0.5");
  assert.equal(ok(""), "", "an emptied field is an empty amount");
});

test("a locale comma is a point when it can't be a thousands mark; thousands marks only when they group by three", () => {
  assert.equal(ok("1,5"), "1.5", "never 15");
  assert.equal(ok("1,25"), "1.25");
  assert.equal(ok("1,"), "1.");
  assert.equal(ok("1,234.50"), "1234.50");
  assert.equal(ok("1.234,50"), "1234.50");
  assert.equal(ok("1,234,567"), "1234567");
  assert.equal(no("1,500"), "ambiguous", "1.5 or 1500: refused, never guessed");
  assert.equal(no("12,34.5"), "unreadable");
});

test("exponents, signs, letters and a second point are refused", () => {
  for (const t of ["1e5", "1E5", "-5", "+5", "abc", "1.2.3", "5 USDC", "0x10"]) assert.equal(no(t), "unreadable", t);
});

test("more digits than the keypad takes are refused (the 50-character paste)", () => {
  assert.equal(no("12345678901234567890123456789012345678901234567890"), "too-long");
  assert.equal(no("1234567890"), "too-long", "10 whole digits");
  assert.equal(ok("123456789"), "123456789", "control: 9 is the keypad's own most");
  assert.equal(no("1.234", 9, 2), "too-long", "dollars take 2 places");
  assert.equal(ok("1.23", 9, 2), "1.23");
});

test("each refusal says why in the Copywriter's words", () => {
  assert.equal(refusedLine("unreadable", "1e5"), "That amount can't be read. Use the keypad.");
  assert.equal(refusedLine("ambiguous", "1,500"), "Is that 1.5 or 1500? Use the keypad.");
  assert.equal(refusedLine("too-long", "1".repeat(50)), "That's too many digits. Use the keypad.");
});
