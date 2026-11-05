// Audit: in a public city room a stranger could post a request under a friend's nickname and get a Pay chip ("Asked by
// kim#1a2b"). A Pay chip now shows only for a poster whose NEAR account is checked, paying that same account, and the
// bubble then says where the money goes in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chipFor, displayText, requestText } from "./messages.ts";

const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const nearAsk = requestText({ amount: "5", coin: "USDC", chain: "near", address: "kim.near" });
const solAsk = requestText({ amount: "5", coin: "USDC", chain: "sol", address: SOL });
const msg = (text: string, mine = false) => ({ text, mine, request: mine ? undefined : { amount: "5", coin: "USDC", chain: text === nearAsk ? "near" : "sol", address: text === nearAsk ? "kim.near" : SOL } });

test("audit: a poster whose NEAR account isn't checked gets no Pay chip, whatever their nickname", () => {
  assert.equal(chipFor(msg(nearAsk), null), null, "a stranger calling themselves kim");
  assert.equal(chipFor(msg(solAsk), null), null, "a stranger's Solana address");
  assert.equal(chipFor(msg(nearAsk), "bob.near"), null, "checked, but asks for someone else's account");
  assert.equal(chipFor(msg(solAsk), "kim.near"), null, "checked, but pays an address that isn't their account");
  assert.deepEqual(chipFor(msg(nearAsk), "kim.near"), msg(nearAsk).request, "control: checked, paying their own account");
  assert.equal(chipFor(msg(nearAsk, true), "kim.near"), null, "my own: no chip");
});

test("audit: a checked poster's request says in full where the money goes", () => {
  assert.equal(displayText({ text: nearAsk, mine: false }, { to: true }), "A request for $5.00 in USDC on NEAR to kim.near.");
  assert.equal(displayText({ text: solAsk, mine: false }, { to: true }), `A request for $5.00 in USDC on Solana to ${SOL}.`);
  assert.equal(displayText({ text: solAsk, mine: false }), "A request for $5.00 in USDC on Solana.", "control: without a chip, as before");
});

test("audit: the city room draws its chip only through chipFor, never under a nickname", () => {
  const app = readFileSync(new URL("./app/ChatApp.tsx", import.meta.url), "utf8");
  const room = app.slice(app.indexOf("const hasConversation = person"), app.indexOf("/** The field every chat ends with"));
  assert.doesNotMatch(room, /<RequestChip[^>]*who=\{m\.who\}/, "no chip under a nickname");
  assert.match(room, /chipFor\(m, book\.account\(m\.pubkey\)\)/);
});
