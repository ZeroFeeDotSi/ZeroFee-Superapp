// Finding 37: with $25 showing, typing 1 gave "$251" and the button followed ("Buy $251 of DOPE"); and the Buy page opened
// on $25 already chosen, so a first-timer bought $25 with one tap. Now a key types over a figure the person didn't type,
// and a Buy page opens on no amount with its button off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPositive, padBase, press, type Key } from "@zerofee/design/keypad.ts";
import { buyLabel, openAmount } from "./buy-button.ts";

/** The sheet's amount through a chip and keys, as TradeSheet holds it: `picked` is set by a chip, cleared by a key. */
function walk(steps: string[]): string {
  let value = openAmount("buy");
  let picked = true;
  for (const s of steps) {
    if (s.startsWith("$")) { value = s.slice(1); picked = true; continue; }
    value = press(padBase(value, picked), (s === "<" ? "del" : s) as Key, 2);
    picked = false;
  }
  return value;
}

test("a key after a chip replaces it: $25 then 1 is $1, and the button says $1 (control: keys after that add)", () => {
  assert.equal(walk(["$25", "1"]), "1");
  assert.equal(buyLabel(walk(["$25", "1"]), "DOPE"), "Buy $1 of DOPE");
  assert.equal(walk(["$25", "1", "2"]), "12", "control: the second key adds to the first");
  assert.equal(walk(["1", "2", "$50", "7"]), "7", "a chip after typing is replaced too");
  assert.equal(walk(["$25", "."]), "0.", "a point after a chip starts at 0.");
  assert.equal(walk(["$25", "<"]), "0", "delete after a chip clears it");
});

test("a Buy page opens on the Quick buy amount from Settings (product decision, 5 Nov); with none read, no amount and the button off; a sale still opens on all (control)", () => {
  assert.equal(openAmount("buy", undefined, 25), "25", "the setting's amount, never $0 with nothing picked");
  assert.equal(openAmount("buy", undefined, 10), "10");
  assert.equal(openAmount("buy", "40", 25), "40", "control: a Top up coming back keeps its own amount over the setting");
  assert.equal(openAmount("sell", undefined, 25), "100", "control: a sale is never the buy setting");
  assert.equal(openAmount("buy"), "");
  assert.equal(isPositive(openAmount("buy")), false, "the button is off until an amount is set");
  assert.equal(buyLabel("", "DOPE"), "Choose an amount", "the Copywriter: says why it is off, never the title again");
  assert.equal(buyLabel("0", "DOPE"), "Choose an amount");
  assert.equal(buyLabel("25", "DOPE"), "Buy $25 of DOPE", "control: an amount keeps the words the crawler taps");
  assert.equal(openAmount("buy", "40"), "40", "control: a Top up coming back opens on the amount it left with");
  assert.equal(openAmount("sell"), "100", "control: a sale opens on all of it");
});

test("the sheet wires it: opens via openAmount, a chip marks the figure picked, the keypad types over a picked figure", () => {
  const src = readFileSync(new URL("./TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(src, /const quick = useQuickBuy\(bridge\);\n  const \[value, setValue\] = useState\(openAmount\(side, start, quick\)\)/);
  assert.match(src, /new Set\(\[\.\.\.BUY_CHIPS, String\(quick\)\]\)/, "the setting's amount is always a chip, so it shows picked");
  assert.ok(!/lastBuy|\?\? "25"/.test(src), "no $25 or last amount to open on");
  assert.match(src, /<Keypad value=\{padBase\(value, fresh\)\}/);
  assert.ok(!src.includes("setFresh(false); instant.current = true"), "no chip leaves its figure open to appending");
  assert.match(src, /chips\.map\(\(\[l, v\]\) => <button[^>]*onClick=\{\(\) => \{ feel\.key\(\); setFresh\(true\);/);
});
