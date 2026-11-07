// Send's refusal, Swap's pattern (QA, 6 Nov): plain text, the one button reads Try again, any edit ends it, and only a refusal that
// can be tried again: a maybe-sent problem never gets that button.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Problem } from "@zerofee/core/problem";
import { securityProblems } from "@zerofee/core/security-problems";
import { jobTaken } from "@zerofee/shell-api/job-run.ts";
import { walletProblems } from "../../wallet-problems.ts";
import { sendFloor } from "./send-said.ts";
import { saidOnSheet } from "./swap-refused.ts";

const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./send.css", import.meta.url), "utf8");
const X = "https://example.test/x";

test("which refusals read Try again: saidOnSheet decides, per Problem", () => {
  const table: [string, Problem, boolean][] = [
    ["busy, this money", jobTaken(["safe", "private"]), true],
    ["busy, a hot wallet", jobTaken(["row:sol"]), true],
    ["the signed price didn't fit, before Face ID", securityProblems.sendUnbound(), true],
    ["maybe sent: partly", securityProblems.sendPartly(X), false],
    ["maybe sent: unconfirmed", securityProblems.sendUnconfirmed(X), false],
    ["maybe sent: unread", walletProblems.sendUnread("a.near"), false],
    ["a service's line stays the service's", { ...jobTaken(), service: "oneclick" } as Problem, false],
  ];
  for (const [name, p, yes] of table) assert.equal(saidOnSheet(p), yes, name);
});

test("what the floor says: the button reads the retry only while the form could send; else the form's reason goes first", () => {
  const go = { label: "Send $5.00", again: null, said: null, why: null, ready: true };
  assert.deepEqual(sendFloor(go), { label: "Send $5.00", line: null }, "nothing to say");
  assert.deepEqual(sendFloor({ ...go, said: "NEAR is down." }), { label: "Send $5.00", line: "said" }, "a line that can't be retried: the button stays Send (a maybe-sent one included)");
  assert.deepEqual(sendFloor({ ...go, again: "Try again", said: "Another job." }), { label: "Try again", line: "said" }, "refused: Try again");
  assert.deepEqual(sendFloor({ ...go, again: "Send again", said: "Priced differently." }), { label: "Send again", line: "said" }, "the Problem's own label");
  assert.deepEqual(sendFloor({ ...go, again: "Try again", said: "Another job.", why: "Pick how much.", ready: false }), { label: "Send $5.00", line: "why" }, "the amount can no longer go: its why, no lit Try again that does nothing");
  assert.deepEqual(sendFloor({ ...go, again: "Try again", said: "Another job.", ready: false }), { label: "Send $5.00", line: "said" }, "busy: off, its label");
  assert.deepEqual(sendFloor({ ...go, why: "Pick how much.", ready: false }), { label: "Send $5.00", line: "why" });
});

test("the sheet: the same tap as ever (the form's own Send), the refusal's line and label kept together, any edit ends it", () => {
  assert.match(form, /disabled=\{!ready\} onClick=\{go\} data-testid="send-go">\{floor\.label\}<\/button>/, "one button, its own go");
  assert.match(sheet, /setStopped\(saidOnSheet\(end\.refused\) \? \{ line: end\.refused\.whatHappened, label: end\.refused\.next\.label \} : null\);/);
  assert.match(sheet, /return setLine\(sheetLineOf\(end\.refused\) \?\? end\.refused\.whatHappened\);/, "the line it holds is the one drawn: a saidOnSheet Problem names no service, so sheetLineOf is null");
  assert.match(sheet, /const again = stopped && line === stopped\.line \? stopped\.label : null;/, "any other line ends it");
  assert.match(sheet, /const edited = \(\) => \{ setLine\(null\); setStopped\(null\); \};/, "any edit ends the refusal (the reviewer's ruling); a service's own line isn't this state");
  assert.match(sheet, /said=\{line \?\? services\.line\} again=\{again\} onEdit=\{edited\}/);
  assert.match(form, /const editKey = JSON\.stringify\(\[sourceId, picked, amount, typed, exact\]\);/, "keypad, chips, Max, a paste, a coin, a network; never the sources' read settling");
  assert.match(form, /useLayoutEffect\(\(\) => \{ if \(lastEdit\.current !== editKey\) \{ lastEdit\.current = editKey; onEdit\?\.\(\); \} \}, \[editKey\]\);/, "before it paints");
  assert.match(sheet, /setStop\(null\);\n\s*setLine\(null\);/, "a new To ends it too");
});

test("the refusal is plain text, centred: no box", () => {
  assert.match(css, /\.wl-send2__floor > :is\(\.wl-send2__why, \.zf-money__line\) \{ margin: 0; padding: 0 16px; background: none; box-shadow: none; border-radius: 0; text-align: center; \}/);
});
