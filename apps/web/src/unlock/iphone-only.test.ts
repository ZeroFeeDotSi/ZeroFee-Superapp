// Real money in a browser leads to ONE option, the iPhone (product decision, 3 Nov): money leaves the Safe only after the iPhone's
// fresh check (D143, the core's safeStepUp), which a passcode can't give, so on mainnet no passcode is offered; a browser
// that can't use the iPhone says so in one line and points to it. Elsewhere (testnet, a developer's page) as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_IPHONE_HERE, PASSCODE_CANT_SEND } from "./passkey.ts";

const gate = readFileSync(new URL("./UnlockGate.tsx", import.meta.url), "utf8");

test("on mainnet the gate never offers a passcode: no iPhone means one line, Try again", () => {
  assert.match(gate, /iphoneOnly = MAINNET/);
  assert.match(gate, /setStep\(s\.passkey \? \{ k: "setup", legacy: s\.legacy \} : iphoneOnly \? \{ k: "no-iphone", legacy: s\.legacy \} : \{ k: "new-code", legacy: s\.legacy \}\);/);
  assert.match(gate, /setStep\(iphoneOnly \? \{ k: "no-iphone", legacy \} : \{ k: "new-code", legacy, note: NO_IPHONE_KEY \}\);/);
  assert.match(gate, /\{!iphoneOnly && <button className="zf-link"[^\n]*>Use a passcode instead<\/button>\}/);
  assert.match(gate, /<Screen title=\{laptop \? laptop\.noChipTitle : "Use your iPhone"\} body=\{laptop \? laptop\.noChipBody : NO_IPHONE_HERE\}/, "the iPhone pages unchanged; the laptop page its own (product decision, 5 Nov)");
  // control: off mainnet the passcode path is still there
  assert.match(gate, /: \{ k: "new-code", legacy: s\.legacy \}\);/);
});

test("the words: one plain line pointing to the iPhone; a passcode browser is told it can't send", () => {
  assert.equal(NO_IPHONE_HERE, "This browser can't use your iPhone as a key. Open ZeroFee in Chrome or Safari, then scan with your iPhone.");
  assert.equal(PASSCODE_CANT_SEND, "Money leaves your Safe only with your iPhone, so this browser can't send it.");
  assert.match(gate, /iphoneOnly \? `Your keys are kept on this device, encrypted with your passcode\. \$\{PASSCODE_CANT_SEND\}`/);
  for (const w of [NO_IPHONE_HERE, PASSCODE_CANT_SEND]) assert.doesNotMatch(w, /chip/i);
});

// Finding 5 (real money, 4 Nov): a failed passkey on mainnet said "Try again, or use a passcode", where mainnet has none.
test("finding 5: a failed passkey on mainnet never points to a passcode", () => {
  assert.match(gate, /iphoneOnly \? `\$\{cap\(name\)\} didn't open it\. Try again\.` : `\$\{cap\(name\)\} didn't open it\. Try again, or use a passcode\.`/);
  assert.equal(gate.match(/or use a passcode/g)?.length, 1, "the passcode line is only the off-mainnet branch");
});
