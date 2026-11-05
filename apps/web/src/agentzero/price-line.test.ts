// QA's real test (5 Nov): the paid reply passed, but the line said "About 1½¢" where 2.2¢ was paid. Before a
// message: the most it usually costs, rounded up; after the reply: what its receipt says it cost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aboutLine, messageUpperUsd, messageUsd, upToLine } from "@zerofee/agent/chat/model";
import { priceLine, shownPrice } from "./wallet-words.ts";

const PAID = 0.022; // the real test's charge for one Sonnet message (receipt)

test("before a message: the figure never undershoots the 2.2¢ one message cost; control: the old typical figure did", () => {
  assert.equal(priceLine(undefined), "One message costs up to 3½¢.", "Sonnet, the default");
  assert.equal(priceLine("claude-opus-5-5"), "One message costs up to 7¢.");
  assert.ok(messageUpperUsd("claude-sonnet-5-5") >= PAID, "the upper figure covers the real charge");
  assert.equal(aboutLine(messageUsd("claude-sonnet-5-5")), "About 1½¢ a message.", "control: the old line");
  assert.ok(messageUsd("claude-sonnet-5-5") < PAID, "control: the typical figure undershot it");
});

test("the upper line rounds UP to the half cent, never down", () => {
  assert.equal(upToLine(0.0301), "One message costs up to 3½¢.");
  assert.equal(upToLine(0.03), "One message costs up to 3¢.", "an exact half cent stays");
  assert.equal(upToLine(0.0051), "One message costs up to 1¢.");
  assert.equal(upToLine(0.0001), "One message costs up to ½¢.", "never 0¢");
});

test("after the reply: the receipt's figure; while it answers or before any paid reply: the upper figure", () => {
  assert.equal(shownPrice(undefined, PAID, false), "This message cost 2.2¢.");
  assert.equal(shownPrice(undefined, PAID, true), "One message costs up to 3½¢.", "mid-reply, part paid: not a partial figure");
  assert.equal(shownPrice(undefined, null, false), "One message costs up to 3½¢.", "control: nothing paid yet");
  assert.equal(shownPrice(undefined, 0, false), "One message costs up to 3½¢.");
});

test("the wallet adds every payment of the message (as the receipt row does) and starts again at the next message", () => {
  const src = readFileSync(new URL("./use-agent-wallet.ts", import.meta.url), "utf8");
  assert.match(src, /if \(r\.paidMicros && turnId\.current\) \{ const paid = r\.paidMicros; setTurnPaid\(\(n\) => \(n \?\? 0\) \+ paid\); \}/);
  assert.match(src, /turnSum\.current = 0;\n    setTurnPaid\(null\);/, "a new message clears it");
  const chat = readFileSync(new URL("./AgentZeroChat.tsx", import.meta.url), "utf8");
  assert.match(chat, /<WalletLine w=\{wallet\} busy=\{running\}/);
});
