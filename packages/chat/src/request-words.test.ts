// e2e walk (3 Nov, 95-97): the request bubble showed the wire line ("Request: 13.33 USDC on NEAR to
// zf-sample383081.testnet · ZeroFee Chat"); Ask for money's Amount didn't say its unit; "Split a bill" sat off the column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { displayText, readRequest, requestText, requestWords } from "./messages.ts";

const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
test("a request reads in words, dollars first, no address and no app name; the wire line is unchanged (control: plain text stays as typed)", () => {
  const usdc = { amount: "13.33", coin: "USDC", chain: "sol", address: SOL };
  const wire = requestText(usdc);
  assert.equal(wire, `Request: 13.33 USDC on Solana to ${SOL} · ZeroFee Chat`, "every client still reads the same line");
  assert.deepEqual(readRequest(wire), usdc);
  assert.equal(displayText({ text: wire, mine: false }), "A request for $13.33 in USDC on Solana.");
  assert.equal(displayText({ text: wire, mine: true }), "Your request for $13.33 in USDC on Solana.");
  assert.equal(requestWords({ amount: "5", coin: "NEAR", chain: "near", address: "kim.near" }, false), "A request for 5 NEAR on NEAR.");
  for (const t of [displayText({ text: wire, mine: false })]) assert.doesNotMatch(t, new RegExp(`${SOL}|ZeroFee Chat|Request:`));
  assert.equal(displayText({ text: "hello there", mine: false }), "hello there");
  assert.equal(displayText({ text: `Request: 13.33 USDC on Solana to 0xnot · ZeroFee Chat`, mine: false }), "Request: 13.33 USDC on Solana to 0xnot · ZeroFee Chat", "an invalid request is never dressed up");
});
test("Ask for money says the Amount's unit; Split a bill is a row in the column; every bubble and preview shows the words", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  assert.match(app, /dollarCoin \? "Amount in dollars" : `Amount in \$\{coin \|\| "the coin"\}`/);
  // sd-chat crawl (5 Nov, g): a bubble is BubbleText (its links tappable), still the words
  assert.equal((app.match(/<BubbleText text=\{displayText\((m|l)(, \{[^}]*\})?\)\} \/>/g) ?? []).length, 2);
  assert.doesNotMatch(app, /<div className="ch-text">\{(m|l)\.text\}<\/div>/, "control: no bubble shows the raw text");
  assert.match(readFileSync(new URL("./app/Room.tsx", import.meta.url), "utf8"), /<BubbleText text=\{displayText\(m\)\} \/>/);
  assert.match(readFileSync(new URL("./app/chat.css", import.meta.url), "utf8"), /\.ch-splitswitch \{ justify-self: stretch;[^}]*padding: 10px 0;/);
});
