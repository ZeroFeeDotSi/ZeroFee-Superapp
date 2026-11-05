// e2e walk (3 Nov, 81): a standing buy due tomorrow read "next Wed 8:16 AM" on a Tuesday (as if next week). Known answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextWhen as when } from "./order-words.ts";

const tue = new Date(2026, 10, 3, 9, 0).getTime();
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();
test("the next buy: today, tomorrow, or the weekday (control: the old words said \"Wed\" for tomorrow)", () => {
  assert.match(when(at(3, 21, 5), tue), /^today 9:05\sPM$/);
  assert.match(when(at(4, 8, 16), tue), /^tomorrow 8:16\sAM$/);
  assert.match(when(at(6, 8, 16), tue), /^Fri 8:16\sAM$/);
  assert.doesNotMatch(when(at(4, 8, 16), tue), /^Wed/);
});
test("the exit plan draws one hairline per order (control: the row's own line is off inside an order)", () => {
  assert.match(readFileSync(new URL("./trade.css", import.meta.url), "utf8"), /\.tr-order > \.tr-kv \{ border-bottom: 0; \}/);
});
