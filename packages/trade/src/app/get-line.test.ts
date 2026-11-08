// the audit's S1 (8 Nov): the Buy sheet said its fee twice, in two forms: "About 7,505 DOPE · $0.002 fee" under the amount and
// "Solana's network gets under a cent." above the button. Now once, above the button, with who gets it; the line under
// the amount says what you get (a sale: what you give). No dot ever leads it (UI audit 5 Nov).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paidLine } from "./paid.ts";

const sheet = readFileSync(new URL("./screens/TradeSheet.tsx", import.meta.url), "utf8");

test("S1: the fee is said once, above the button with who gets it; the line under the amount names no fee", () => {
  assert.match(sheet, /const getWords = q \? \{ head: side === "buy" \? `About \$\{fmtAmount\(q\.getRaw, q\.decimals\)\} \$\{symbol\}` : soldText \} : \{ head: "" \};/);
  assert.match(sheet, /\{q \? <>\{getWords\.head\}<span className="tp-chev" aria-hidden="true" \/><\/>/, "no fee span under the amount");
  assert.doesNotMatch(sheet, /className="tp-fee"|getLine\(|saleLine\(/, "control: the second fee is gone");
  assert.equal(sheet.match(/paidLine\(q, CHAINS\[coin\.chain\]\.name\)/g)?.length, 1, "the one fee line");
  assert.match(paidLine({ route: "", feeUsd: 0.002 }, "Solana"), /^Solana's network gets under a cent\./, "it carries the network's figure");
});
