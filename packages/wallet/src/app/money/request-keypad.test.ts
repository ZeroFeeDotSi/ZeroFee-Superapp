// Finding 12 (real money, 4 Nov): Request money opened with "$20" filled in and no keypad to change it. It opens on no
// dollars (an app that opened it filled in keeps its own), with the app's keypad under the figure. Each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { press } from "@zerofee/design/keypad.ts";
import { REQUEST_WORDS, askLine, askedUsd } from "./request-money.ts";

const sheet = readFileSync(new URL("./RequestSheet.tsx", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("finding 12: Request opens on no dollars and says to type them (control: an app's own dollars are kept)", () => {
  assert.match(sheet, /const \[usd, setUsd\] = useState\(start\?\.usd \?\? ""\);/);
  assert.doesNotMatch(sheet, /\?\? "20"/, "control: no made-up $20");
  assert.equal(askLine(askedUsd("")), REQUEST_WORDS.typeFirst);
});

test("finding 12: the keypad sits under the figure and types into the same dollars as the field", () => {
  assert.match(sheet, /<MoneyAmount usd=\{usd\} onUsd=\{typeUsd\} label=\{W\.howMuch\} \/>\s*<Keypad value=\{usd\} decimals=\{2\} onChange=\{typeUsd\} \/>/);
  assert.match(sheet, /const typeUsd = \(v: string\) => \{ setUsd\(v\); setLine\(null\); \};/);
  assert.match(sheet, /import \{ Keypad \} from "@zerofee\/design\/Keypad\.tsx";/);
  // from nothing, 2 then 5 asks for $25; a third decimal is never taken (control: the figure the request asks for)
  const typed = ["2", "5", ".", "5", "0", "1"].reduce((v, k) => press(v, k as never, 2), "");
  assert.equal(typed, "25.50");
  assert.equal(askedUsd(typed), "25.50");
});
