// One time format across Home (join walk 3 Nov, item 8): every place a person reads a time on Home goes through
// clock.ts (the device's locale, hour and minute). Control: the old hard-coded formats differ by locale, the helper
// follows the device.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortTime, weekdayName } from "./clock.ts";
import { sinceWords } from "./services.ts";

const AT = new Date(2026, 10, 3, 13, 9).getTime();
const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), "utf8");

test("the device's own way: 13:09 on a 24-hour phone, 1:09 PM on a 12-hour one", () => {
  assert.equal(shortTime(AT, "en-GB"), "13:09");
  assert.match(shortTime(AT, "en-US"), /^1:09\s?PM$/);
  assert.equal(weekdayName(AT, false, "en-GB"), "Tue");
  assert.equal(weekdayName(AT, true, "en-GB"), "Tuesday");
  assert.equal(shortTime(AT), new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(AT), "no locale: the device's");
});

test("Home's as-of, Add's works-until, the banner's since and a held move's until all use it; none keeps its own format", () => {
  const places: [string, RegExp][] = [
    ["packages/wallet/src/app/screens/home-view.ts", /export const clock = \(ms: number\): string => shortTime\(ms\);/],
    ["packages/wallet/src/app/money/add-coins.ts", /const t = shortTime\(d\);/],
    ["packages/core/src/services.ts", /const time = shortTime\(at\);/],
    ["packages/wallet/src/app/screens/Home.tsx", /`\$\{weekdayName\(d\)\} \$\{shortTime\(d\)\}`/],
  ];
  for (const [file, uses] of places) {
    const src = read(file);
    assert.match(src, uses, file);
    assert.doesNotMatch(src, /toLocaleTimeString|toLocaleString\([^)]*hour/, `${file}: no format of its own`);
  }
  // control: the banner's line now reads as the device does, the same as Home's
  assert.equal(sinceWords(new Date(AT).toISOString(), AT + 60_000), shortTime(AT));
});
