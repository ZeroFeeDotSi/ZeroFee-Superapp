// Audit 17's H11 (8 Nov): ellipses on screens people reach: the held-payment screen ("Looking it up…", "A payment or change
// is held. Finding it…", "Getting it ready to approve…", "Cancelling it…", "Sending it…"), Activity → Account ("Reading
// your account's history…"), Settings' Reset ("Resetting…"), Passwords ("Reading…") and AgentZero's own key ("Checking
// with Claude…"). A busy line says the step, and its time where it is known; never "…". Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = ["./WaitingView.tsx", "./SettingsPanel.tsx", "./PasswordsScreen.tsx", "../apps/security/SecurityApp.tsx", "../agentzero/KeySetup.tsx"];
// the words on screen: string literals and JSX text, never comments
const shown = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("H11: no ellipsis on the held-payment screen, Account's reading line, Reset, Passwords or AgentZero's key check", () => {
  for (const f of files) {
    const src = shown(readFileSync(new URL(f, import.meta.url), "utf8"));
    // a cut id ("abc123…9f3c") and a box's example ("ZFL1:…") are no busy line
    const hits = src.split("\n").map((l) => l.replace(/\}…\$\{/g, "").replace(/placeholder="[^"]*"/g, "")).filter((l) => /["'`>][^"'`<]*…/.test(l));
    assert.deepEqual(hits, [], `${f}: ${hits.join(" | ")}`);
  }
});

test("H11: the held-payment screen's busy lines say the step and its time", () => {
  const src = readFileSync(new URL("./WaitingView.tsx", import.meta.url), "utf8");
  // builder 22's item 8: who does it and one clock (held-steps-b22.test.ts has the words)
  assert.match(src, /held: "A payment or change is held\."/);
  assert.match(src, /sending: "NEAR is sending it\. About 2 s\."/);
  assert.match(src, /cancelling: "NEAR is cancelling it\. About 2 s\."/);
});
