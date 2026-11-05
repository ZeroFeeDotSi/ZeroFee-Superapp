// The auditor's ruling (5 Nov): one rounding for coin amounts. The Send form said a typed dollar figure's coins rounded UP
// ("1.1287 NEAR") while every sheet rounds DOWN (core format.ts fourPlacesText: "1.1286 NEAR"). The form now says it as the
// sheet does; display only: the amount sent stays the exact figure the form worked from the typed dollars.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatAmount, fourPlacesText } from "@zerofee/core/format";
import { coinSaid, coinShown } from "./send-cap.ts";
import { safeAmount } from "./send-sources.ts";

// the sheet's coin words: intents.ts money() (formatAmount over the units) under fourPlacesText
const sheetSays = (units: bigint, decimals: number, symbol: string) => fourPlacesText(`${formatAmount(units, decimals)} ${symbol}`);
const toUnits = (amount: string, decimals: number) => { const [w, f = ""] = amount.split("."); return BigInt(w! + f.padEnd(decimals, "0")); };

test("the form and the sheet print the same coin text for the same send: 1.128653627 NEAR is \"1.1286 NEAR\" on both (was \"1.1287\" on the form)", () => {
  const amount = "1.128653627";
  assert.equal(sheetSays(toUnits(amount, 24), 24, "NEAR"), "1.1286 NEAR");
  assert.equal(coinSaid(amount, "NEAR"), "1.1286 NEAR");
  assert.equal(`${coinShown(amount, "up")} NEAR`, "1.1287 NEAR", "the old form line, up: what the ruling removes");
  for (const [a, d, sym] of [["0.049179", 24, "NEAR"], ["1234.56789", 6, "USDC"], ["0.00001234567", 18, "ETH"], ["1.1", 24, "NEAR"], ["12", 18, "ETH"], ["0.4917", 9, "SOL"]] as const) {
    assert.equal(coinSaid(a, sym), sheetSays(toUnits(a, d), d, sym), `${a} ${sym}: the form says what the sheet says`);
  }
  assert.equal(coinSaid("1.10000", "NEAR"), "1.1 NEAR", "no trailing zeros, as the sheet");
  assert.equal(coinSaid("1e-7", "NEAR"), "0.0000001 NEAR", "a figure written with an exponent still reads");
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  assert.match(form, /`\$\{coinSaid\(amount, source\.symbol\)\} from \$\{source\.place\}`/, "the line under the keypad is coinSaid");
  assert.doesNotMatch(form, /coinShown\(amount, "up"\)/, "control: the up-rounded line is gone");
});

test("control: display only; the amount sent is the exact unrounded figure, never the shown text", () => {
  const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
  // the ask and the fee's quote carry `amount` itself (c6-send-figure.test.ts pins the same), and coinSaid is only the line
  assert.match(form, /onSend\(\{\s*source, recipient: who\.recipient, network, [^\n]*amountIn: amount\.replace\(\/\\\.\$\/, ""\), usd,/);
  const uses = form.split("\n").filter((l) => /coinSaid\(/.test(l) && !/^\s*import /.test(l));
  assert.equal(uses.length, 1, uses.join("\n"));
  assert.match(uses[0]!, /wl-send2__coins/, "only the line under the keypad reads it");
  const amount = "1.128653627";
  const source = { id: "safe:near", row: null, tokenId: "near", label: "", place: "your Safe", symbol: "NEAR", chain: "near", amount: "10", usd: "44.3", max: "10" };
  assert.equal(safeAmount({ source: source as never, amountIn: amount, usd: 5 }), amount, "amountIn reaching the quote is the unrounded figure");
  assert.notEqual(coinSaid(amount, "NEAR").split(" ")[0], amount, "control: the shown text is rounded, the sent one is not");
});
