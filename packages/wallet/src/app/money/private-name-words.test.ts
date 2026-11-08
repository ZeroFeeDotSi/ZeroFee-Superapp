import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTSIDE_WORDS } from "@zerofee/core/send-words";
import { privateOver } from "./send-cap.ts";

// the audit's S3 + S4 (7 Nov): "Private holds 0.5 of USDC." and core sheets that said "private balance" where the app says Private.
test("the audit's S3: privateOver says a coin figure once with its name, a dollar figure in its coin", () => {
  assert.equal(privateOver("0.5", "USDC"), "Private holds 0.5 USDC. Send up to that, or pick another coin.");
  assert.equal(privateOver("0.5 USDC", "USDC"), "Private holds 0.5 USDC. Send up to that, or pick another coin.", "never \"0.5 USDC USDC\"");
  assert.equal(privateOver("$4.50", "NEAR"), "Private holds $4.50 in NEAR. Send up to that, or pick another coin.");
});

test("the audit's S4: the core's Send sheets name Private as the app does, never \"your private balance\" (control: a wallet keeps \"your\")", () => {
  assert.equal(OUTSIDE_WORDS.title("Private"), "Send from Private");
  assert.equal(OUTSIDE_WORDS.declined("Private"), "You said no. Nothing left Private.");
  assert.equal(OUTSIDE_WORDS.title("SOL wallet"), "Send from your SOL wallet");
  const core = readFileSync(new URL("../../../../core/src/subwallets.ts", import.meta.url), "utf8");
  assert.ok(!/"(Send|Pay) from your private balance"|leaves your private balance|sendDeclined\("in your private balance"\)|outsideSheet\("private balance"/.test(core), "no sheet says private balance");
  assert.match(core, /this\.capSheet\("Send from Private", \[`About \$\$\{Number\(usd \|\| 0\)\.toFixed\(2\)\} leaves Private\.`\]/);
});
