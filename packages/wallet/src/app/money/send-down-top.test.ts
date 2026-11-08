// Audit 13's D4 (8 Nov): with ZeroFee's server or NEAR Intents down the banner said "Sending on NEAR works." while the Send
// sheet under it said it can't go, and that line sat under the keypad. One story: a service a Send needs never says
// sending works, and the sheet's Problem is on top, said once. Fails on main: the "works" lines, no send-down block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERVICE_EFFECTS } from "@zerofee/core/services";
import { SHEET_NEEDS } from "../services.ts";

const sheet = readFileSync(new URL("./SendSheet.tsx", import.meta.url), "utf8");
const form = readFileSync(new URL("./SendForm.tsx", import.meta.url), "utf8");

test("D4: a service Send needs never tells the banner that sending works; its blocks line names Sends or payments", () => {
  for (const s of SHEET_NEEDS.send) {
    const e = SERVICE_EFFECTS[s];
    assert.doesNotMatch(e.works, /send/i, `${s}: "${e.works}"`);
    assert.match(e.blocks, /Sends|Payments/, `${s}: "${e.blocks}"`);
  }
  // control: a service Send doesn't need can still say NEAR sends work
  assert.match(SERVICE_EFFECTS.solana.works, /sending on NEAR/);
});

test("D4: Send's down line is on top, once; the floor doesn't say it again and Send stays off", () => {
  assert.match(sheet, /const downTop = !offline && !flying && waits \? waits : null;/);
  assert.match(sheet, /\) : downTop \? \(\n\s+<div role="alert" data-testid="send-down"/);
  assert.match(sheet, /said=\{line \?\? \(downTop \? null : services\.line\)\}/, "the floor's line is not the down line a second time");
  assert.match(form, /: waits \? \(topSaid \? null : waits\)/);
  assert.match(form, /const ready = !!source && !!who && !!network && !why && !waits && /, "control: Send stays off while it waits");
});
