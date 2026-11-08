// D14 (QA's grade of builder 14's f03-relay-send, 8 Nov): Send said "ZeroFee's server is down, so this can't go now" on top,
// yet its keypad and the $5/$25/$50/Max chips were live; only Send was off. Now every cause the sheet can't go (offline,
// ZeroFee's server, NEAR Intents, NEAR Confidential down: its `waits`) rests them, inert and dimmed, as builder 13's
// offline keypad. Fails on main: the pad rested on `offline` alone and the chips never did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");
const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");

test("D14: one rule rests Send's keypad, chips and amount while the sheet can't go", () => {
  assert.match(form, /const rests = offline \|\| !!waits;/);
  assert.match(form, /<div \{\.\.\.restsProps\(rests\)\} data-testid="send-pad"><Keypad/, "the keypad rests (audit 16's G1 helper: inert, dimmed)");
  assert.match(form, /aria-label="How much of it" \{\.\.\.restsProps\(rests\)\} data-testid="send-chips"/, "the $5/$25/$50/Max chips");
  assert.match(form, /data-testid="send-amount" disabled=\{busy \|\| rests\}/, "the typed amount");
});

test("D14: the sheet's waits is every down cause it needs (services.down: server, NEAR Intents, NEAR Confidential) and offline is its own", () => {
  assert.match(sheet, /const waits = services\.down \? services\.line : null;/);
  assert.match(sheet, /waits=\{waits\}[^\n]*offline=\{offline\}/);
});
