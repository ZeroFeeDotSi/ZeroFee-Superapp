// J3-3 (the copy review's walk, 8 Nov): a Private-paid Swap said "You pay: Your Safe $1,325.60" and "$25.00 leaves Private", then
// "From Private, so no Face ID." on its job page. The payer card names the real payer by the one value the money path
// reads (safeSigns' `signs`: the tap's fromPrivate, the Safe's sheet, the receipt's W1). Fails on main: no swapPayer, and
// the card printed SWAP_COIN's place whatever paid. Controls: the Safe paying keeps its card, and says no W1 anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privatePays, receiptPaidLine, swapPayer } from "./paid-from.ts";

const base = { safeRoute: true, where: "your Safe", usd: 1325.6, privateUsd: "33.86" };

test("J3-3: Private paying the Safe's Swap whole names Private and Private's figure on \"You pay\"; control: the Safe signing (a fill) or coins unread keep the Safe", () => {
  assert.deepEqual(swapPayer({ ...base, signs: false }), { where: "Private", usd: 33.86, private: true });
  assert.deepEqual(swapPayer({ ...base, signs: true }), { where: "your Safe", usd: 1325.6, private: false }, "control: the Safe fills, the Safe pays");
  assert.deepEqual(swapPayer({ ...base, signs: undefined }), { where: "your Safe", usd: 1325.6, private: false }, "control: coins unread, the Safe's Approve comes");
  assert.deepEqual(swapPayer({ ...base, safeRoute: false, signs: false, where: "your SOL wallet", usd: 40 }), { where: "your SOL wallet", usd: 40, private: false }, "control: a wallet's own swap");
  assert.deepEqual(swapPayer({ ...base, signs: false, privateUsd: null }), { where: "Private", usd: null, private: true }, "Private not read: no figure, never the Safe's under Private's name");
});

test("J3-3: the card, the \"leaves Private\" line, the tap's job and the receipt read ONE value; the Safe paying never says \"From Private, so no Face ID.\"", () => {
  const sheet = readFileSync(new URL("./SwapSheet.tsx", import.meta.url), "utf8");
  assert.equal(sheet.split("safeSigns(").length - 1, 1, "fails on main: the card guessed nothing, the tap computed its own");
  assert.match(sheet, /const payer = pay \? swapPayer\(\{ safeRoute: route\?\.kind === "topup", signs, where: SWAP_COIN\[pay\.place\]\.where, usd: pay\.usd, privateUsd: privateFigure\(pocket\) \}\) : null;/);
  assert.match(sheet, /const stays = !block && !payer\?\.private \? swapStays\(/, "the card says Private pays: no \"$25.00 leaves Private.\" under it");
  assert.match(sheet, /\{payer\?\.where \?\? SWAP_COIN\[pay\.place\]\.where\}/);
  assert.match(sheet, /\.\.\.\(signs === false \? \{ fromPrivate: true \} : \{\}\)/, "the job's W1 step only when the same value says Private");
  // the Safe paying: no W1 on the receipt or the job, whatever the record
  const priv = { paid: ["pocket-send:1"] }, safe = { paid: ["safe-send:1"], fill: "done" };
  for (const signs of [true, undefined]) {
    assert.equal(privatePays(true, signs), false);
    assert.equal(receiptPaidLine(true, signs, priv), null, `signs ${signs}: no "From Private, so no Face ID."`);
  }
  assert.equal(receiptPaidLine(true, false, safe), null, "the record says the Safe filled it: none");
  assert.equal(receiptPaidLine(true, false, priv), "From Private, so no Face ID.", "control: Private paid it whole, said");
  assert.equal(privatePays(true, false), true);
});
