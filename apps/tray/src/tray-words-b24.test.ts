// Builder 24, item 5 + audit 19's J7: the Tray's pairing line graded 6.4 ("On your phone: AgentZero, then Use AgentZero on
// a computer. Paste this:"); now short sentences that keep the phone row's name. The pay tool told Claude Code its payees
// may be on BNB Chain; V1's chains are core app-chains.ts (SOL, NEAR, Robinhood). Fails on main 5af9af16b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOLS } from "./tools.ts";

test("the pairing line: one idea a sentence, the row's name kept", () => {
  const src = readFileSync(new URL("./pair-flow.ts", import.meta.url), "utf8");
  assert.match(src, /d\.print\("On your phone, open AgentZero\. Tap Use AgentZero on a computer\. It asks for this\. Paste it there:"\);/);
  assert.doesNotMatch(src, /On your phone: AgentZero, then/);
  assert.ok(src.includes("for ${opened.accountId}. It spends up to $${dayLimitUsd} a day from here."), "the paired line, two ideas in two sentences (was 9.9)");
});

test("J7: the pay tool names only the app's chains", () => {
  const pay = TOOLS.find((t) => t.name === "pay")!;
  assert.match(pay.description, /They may be on Solana, NEAR or Robinhood Chain\./);
  assert.doesNotMatch(JSON.stringify(TOOLS), /BNB/);
});
