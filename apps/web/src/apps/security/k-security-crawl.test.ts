// QA's hand crawl on a real account (k-security, 4 Nov, main@b9935fbf): Your account's back paths, Details,
// the dead Currency and Language rows, the Settings line, and the jargon.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const wallet = read("../../../../../packages/wallet/src/app/WalletApp.tsx");
const details = read("../../../../../packages/wallet/src/app/screens/Details.tsx");
const settings = read("../../shell/SettingsPanel.tsx");

test("S3: Back from Devices, Protection and Check my words goes to Your account, not Home", () => {
  assert.match(wallet, /const toAccount = \(\) => \{ tabs\(\); setSheet\("account"\); \};/);
  assert.match(wallet, /const backFrom = \(v: [^)]*\) => \(v\.fromAccount \? toAccount : tabs\)/);
  assert.match(wallet, /openPlace\(place, step, true\)/, "the account sheet's rows say where they came from");
  assert.match(wallet, /fromAccount: true/, "Details too");
});

test("S3: Details answers from the saved account at once (account.id), then reads the rest", () => {
  assert.match(details, /"account\.id"/);
  assert.ok(details.indexOf('"account.id"') < details.indexOf('"account.state"'), "the saved record first");
});

test("S3: no Currency or Language row with nothing behind it (drop, don't degrade)", () => {
  assert.doesNotMatch(settings, /\["Currency", "USD"\]/);
  assert.doesNotMatch(settings, /\["Language", "English"\]/);
});

test("S4: the Settings line names what Settings really holds; no Face ID row promised", () => {
  // sd-security (e): one line per kind of Settings (settings-line.ts), so the Sim never promises a lock it hasn't
  assert.match(wallet, /const SETTINGS_LINE = settingsLine\(\{ phone: onPhone\(\), webWallet: webWallet\(\), sim: onDemoPage\(\) \}\);/);
  assert.match(wallet, /line=\{SETTINGS_LINE\}/);
  assert.doesNotMatch(wallet, /Theme, currency/);
  // the Copywriter (4 Nov): the line uses the screen's own heading word
  assert.match(settings, /<h2 className="zf-label set__h">Colors<\/h2>/);
  assert.doesNotMatch(settings, />Appearance</);
});

test("S4: no \"NEAR contract\" or \"guardian key\" on the screen", async () => {
  const { INTRO } = await import("./protection-words.ts");
  assert.equal(INTRO, "Your NEAR account keeps these rules. Only you can change them.");
  assert.doesNotMatch(read("./GuardianSide.tsx"), /This device's guardian key/);
});
