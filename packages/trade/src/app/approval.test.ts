// Trade's approval lines say what the person really does: Face ID in the iPhone app, Approve in a browser (D20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { PHONE_WORDS, WEB_WORDS } from "@zerofee/shell-api/approval-words.ts";
import { addRowLine, faceLine, movesLeftLine, sessionLine, spentLine, takeOutRowLine } from "./approval.ts";

test("on the phone the lines say Face ID; in a browser they say approve, and never Face ID", () => {
  // D143: a trade signs with no Face ID; a trade the core won't sign says so before the tap, never that it asks
  assert.equal(faceLine(undefined, PHONE_WORDS), "No Face ID");
  assert.equal(faceLine(undefined, WEB_WORDS), "Nothing to approve");
  assert.equal(faceLine("always", PHONE_WORDS), "ZeroFee can't check this trade, so it won't go");
  assert.equal(faceLine("wide", WEB_WORDS), "Its price can move a lot, so this sale won't go");
  assert.equal(addRowLine(PHONE_WORDS), "One Face ID · lands in about a minute");
  assert.equal(addRowLine(WEB_WORDS), "One approval · lands in about a minute");
  // No network words on a step (grade 02h, H10: "Your chains come back first")
  assert.equal(takeOutRowLine(PHONE_WORDS), "Your NEAR wallet's cash goes back to your Safe · no Face ID");
  assert.equal(takeOutRowLine(WEB_WORDS), "Your NEAR wallet's cash goes back to your Safe · nothing to approve");
  // past the fee guard a move waits a day (the core refuses it, named); money back to the Safe still goes
  assert.equal(movesLeftLine(0), "No more moves today. Money can still go back to your Safe.");
  assert.equal(movesLeftLine(3), "3 more moves today");
  assert.equal(movesLeftLine(1), "1 more move today");
  assert.equal(sessionLine(PHONE_WORDS), "Trades go without Face ID. ZeroFee checks each one first.");
  assert.equal(spentLine(PHONE_WORDS), "Trades from your wallets go without Face ID. ZeroFee checks each one first.");
  const web = [...(["always", "wide", undefined] as const).map((a) => faceLine(a, WEB_WORDS)), addRowLine(WEB_WORDS), takeOutRowLine(WEB_WORDS), movesLeftLine(0), movesLeftLine(2), sessionLine(WEB_WORDS), spentLine(WEB_WORDS)];
  for (const line of web) assert.doesNotMatch(line, /Face ID/, line);
  // only the Add from the Safe (money leaving it) names an approval as a step; nothing a hot key signs asks
  const trade = [...(["always", "wide", undefined] as const).map((a) => faceLine(a, PHONE_WORDS)), movesLeftLine(0), movesLeftLine(2), sessionLine(PHONE_WORDS), spentLine(PHONE_WORDS)];
  for (const line of trade) assert.doesNotMatch(line, /asks|approve each|once per|every 30 minutes|Face ID (once|for each)|need(s)? one/i, line);
});

test("no Trade screen hard-codes 'Face ID' in what it shows (comments aside): each takes the words from approvalWords()", () => {
  const dir = new URL("./screens/", import.meta.url);
  const files = [...readdirSync(dir).filter((f) => f.endsWith(".tsx")).map((f) => new URL(f, dir)), new URL("./TradeApp.tsx", import.meta.url)];
  for (const f of files) {
    const code = readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l)).join("\n").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n"`']*$/gm, "");
    assert.doesNotMatch(code, /Face ID/, String(f).split("/").pop());
  }
});
