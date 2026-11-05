// ST-B: the exit plan's words. The steps are from what the person paid when Trade has the buys, else from today's price,
// and the sheet says which (never a made-up base); an exit says what it sells and when; the sheet's lines.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { baseLine, exitLine, paidPrice, REPLACES_LINE, TIME_STEPS } from "./exit-words.ts";
import { EXIT_MAX_HOURS } from "../orders.ts";

test("what one coin cost: Trade's own average cost over the amount it is for; no record or a silly cost is none (control: a sane one)", () => {
  assert.equal(paidPrice({ raw: "2000000", decimals: 6, costUsd: 3 }), 1.5, "control: $3 for 2 coins is $1.50 each");
  assert.equal(paidPrice(null), undefined);
  assert.equal(paidPrice(undefined), undefined);
  assert.equal(paidPrice({ raw: "0", decimals: 6, costUsd: 3 }), undefined, "none held on record");
  assert.equal(paidPrice({ raw: "2000000", decimals: 6, costUsd: 0.001 }), undefined, "under a cent is no cost (T-5's rule)");
  assert.equal(paidPrice({ raw: "2000000", decimals: 6, costUsd: Number.NaN }), undefined);
  assert.equal(paidPrice({ raw: "1e6", decimals: 6, costUsd: 3 }), undefined);
});

test("the sheet says what the steps are from; an exit's line says what it sells and when", () => {
  assert.equal(baseLine(0.0021, 0.003), "From what you paid: $0.0021 each.");
  assert.equal(baseLine(undefined, 0.003), "From today's price: $0.003. ZeroFee has no record of your buy.");
  assert.equal(exitLine({ kind: "take-profit", triggerPx: 0.0042 }), "Sell all if it rises to $0.0042");
  assert.equal(exitLine({ kind: "stop-loss", triggerPx: 0.0015 }), "Sell all if it falls to $0.0015");
  assert.match(exitLine({ kind: "sell-after", triggerPx: 1, at: Date.UTC(2026, 10, 3, 11, 5) }), /^Sell all at \w{3} \d{1,2}:05/);
  assert.equal(REPLACES_LINE("WIF"), "This replaces your sell plan for WIF.");
  assert.ok(TIME_STEPS.every(([h]) => h >= 1 && h <= EXIT_MAX_HOURS), "every time chip is one the book takes");
});

test("the sheet: Off on each row, QA's honest line, sells all, the first ends the others, the replace line, the cut name; on the coin page", () => {
  const sheet = readFileSync(new URL("./screens/ExitPlan.tsx", import.meta.url), "utf8");
  // D143: an exit's sale signs with no sheet, so no line says it asks
  assert.match(sheet, /\{ORDER_RUNS_LINE\} \{PLAN_LINE\}/);
  assert.doesNotMatch(sheet, /asks you first|trading limits/);
  assert.match(sheet, /\{SELLS_ALL_LINE\(name\)\}\{exits\.length > 1 \? " The first one to happen ends the others\." : ""\}/);
  assert.match(sheet, /\{replaces && <p className="zf-small" data-testid="exit-replaces">\{REPLACES_LINE\(name\)\}<\/p>\}/);
  assert.match(sheet, /addPlan\(\{ chain, coin, symbol: name \}, exits, px\)/, "kept with the cut name, checked against the sheet's price");
  assert.match(sheet, /\[null, "Off"\]/);
  assert.doesNotMatch(sheet, /Spending|Private/);
  const page = readFileSync(new URL("./screens/CoinPage.tsx", import.meta.url), "utf8");
  assert.match(page, /<CoinExitPlan chain=\{seed\.chain\} coin=\{seed\.address\} symbol=\{symbol\} px=\{px\} paid=\{position === undefined \? "loading" : paidPrice\(position\)\} holds=\{!!holds\} \/>/);
  const orders = readFileSync(new URL("./screens/Orders.tsx", import.meta.url), "utf8");
  assert.match(orders, /useOrders\(\(o\) => !o\.plan && o\.chain === chain/, "the price orders list leaves the plan's exits to the plan");
});
