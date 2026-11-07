// a web test (QA, 4 Nov), items 3, 4 and 7: the unlock's wait said honestly, "password" on the web's password
// box, a short address and one truth about the source code in Settings, Passwords out of the Colors card, and the phone
// pages' sheet gone after Close. Source checks with their controls, plus the pure helpers run for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountNameShown, shortAddress } from "./shell/settings-words.ts";
import { POSITIONING } from "./shell/open-source.ts";
import { INTRO_SOURCE } from "./gallery/sim-intro.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const gate = read("./unlock/UnlockGate.tsx");
const unlockCore = read("../../../packages/core/src/unlock.ts");
const settings = read("./shell/SettingsPanel.tsx");

test("item 3: one Argon2id stretch per try, at full strength; the web line says up to 30 seconds, not a few", () => {
  // strength unchanged (control: these are the settings every record is sealed with)
  assert.match(unlockCore, /export const PASSCODE_KDF = \{ name: "argon2id", t: 3, m: 65_536, p: 1 \} as const;/);
  // one stretch in unlock(): kekFromPasscode runs again only to re-seal a weaker record
  const body = unlockCore.slice(unlockCore.indexOf("export async function unlock("), unlockCore.indexOf("export class IdleLock"));
  assert.equal(body.match(/kekFromPasscode\(/g)?.length, 2);
  assert.match(body, /if \(weaker\) \{\n\s+const kdf = \{ \.\.\.PASSCODE_KDF/);
  assert.match(gate, /opening: "Opening ZeroFee… This can take up to 30 seconds\.",/);
  assert.match(gate, /locking: "Setting your password… This can take up to 30 seconds\.",/);
  const said = [...gate.slice(gate.indexOf("export const WEB_LOCK"), gate.indexOf("} as const;")).matchAll(/: "([^"]+)"/g)].map((m) => m[1]!);
  assert.ok(said.length >= 10);
  for (const w of said) assert.doesNotMatch(w, /few seconds/, `control: the old promise is gone (${w})`);
});

test("item 4: the web's password box is called Password (the app's keeps Passcode)", () => {
  assert.match(gate, /field: "Password",/);
  assert.equal(gate.match(/\{\.\.\.\(web \? \{ field: WEB_LOCK\.field \} : \{\}\)\}/g)?.length, 3, "choose, again and unlock");
  assert.match(gate, /aria-label=\{props\.field \?\? "Passcode"\} placeholder=\{props\.placeholder \?\? props\.field \?\? "Passcode"\}/);
  assert.doesNotMatch(gate, /aria-label="Passcode" placeholder=\{props\.placeholder \?\? "Passcode"\}/, "control: the fixed word is gone");
});

test("item 4: Settings shows a 64-hex address short (Copy keeps it whole); a named one as it is", () => {
  const hex = "a".repeat(30) + "0123456789" + "b".repeat(20) + "cdef";
  assert.equal(hex.length, 64);
  assert.equal(shortAddress(hex), "aaaaaa…cdef");
  assert.equal(shortAddress("zf-sample000001.testnet"), "zf-sample000001.testnet", "control: the phone's named account");
  assert.equal(shortAddress("A".repeat(64)), "A".repeat(64), "control: not NEAR's lower-case hex");
  // the copy review's S3 (7 Nov): Settings has no account card ("Your account · Change" led back to itself); the address is on Details
  assert.doesNotMatch(settings, /set__acct|set__id-text|Label this account/);
  assert.equal(accountNameShown(null, true), "Your NEAR account");
  assert.equal(accountNameShown(null), "Your account", "control: the app's word");
  assert.equal(accountNameShown("Main", true), "Main");
});

test("item 4: Open source and the Sim say the same about the source code (product decision, 5 Nov late: the code is open)", () => {
  for (const line of [POSITIONING, INTRO_SOURCE]) {
    assert.match(line, /\bcode\b/, line);
    assert.doesNotMatch(line, /isn't public|given away/, line);
  }
  assert.match("The source code isn't public yet.", /isn't public/, "control: the old line would be caught");
});

test("item 7: Passwords sits in its own card, not inside Colors", () => {
  const colors = settings.slice(settings.indexOf('<h2 className="zf-label set__h">Colors</h2>'), settings.indexOf("</section>", settings.indexOf('<h2 className="zf-label set__h">Colors</h2>')));
  assert.ok(colors.length > 0);
  assert.doesNotMatch(colors, /Passwords|LOGINS_ON_PHONE_ONLY|MoreRows/, "the Colors card holds the colors only");
  const more = settings.slice(settings.indexOf("set__sec set__more"), settings.indexOf("{bridge && ("));
  assert.match(more, /<span><span>Passwords<\/span><small>\{WEB_PASSWORDS_LINE\}<\/small><\/span><span>\{ON_IPHONE\}<\/span>/);
  assert.match(more, /<MoreRows onOpenSource=/);
});

test("item 7: a phone tab's Close takes its sheet out of the page; coming back shows it again", () => {
  const src = read("./shell/home-apps.tsx");
  const tab = src.slice(src.indexOf("export function PhoneTab("), src.indexOf("export function hostApps("));
  assert.match(tab, /useEffect\(\(\) => \{ if \(shell\.active\) setClosed\(false\); \}, \[shell\.active\]\);/);
  assert.match(tab, /const close = \(\) => \{\n\s+setClosed\(true\);\n\s+shell\.openApp\("wallet"\);/);
  assert.match(tab, /\{!closed && shell\.active && <OnYourPhone /, "restore crawl: no sheet on a tab kept out of view");
  assert.doesNotMatch(tab, /onClose=\{\(\) => shell\.openApp\("wallet"\)\}/, "control: Close no longer only switches tabs");
  // the other two hosts already unmount it on Close
  assert.match(read("./shell/AppHost.tsx"), /\{phone && <OnYourPhone reason=\{phone\} onClose=\{\(\) => setPhone\(null\)\} \/>\}/);
});

test("restore crawl (4 Nov): Terms never says open-source while the code isn't public yet (control: Open source says built in the open, not open source)", async () => {
  const { TERMS } = await import("./terms.ts");
  const all = TERMS.map((t) => `${t.h} ${t.p}`).join(" ");
  assert.doesNotMatch(all, /open-source|open source/i);
  assert.equal(TERMS[0]!.h, "Beta", "the product beta note first (5 Nov late)");
  assert.match(TERMS[1]!.p, /^ZeroFee is software that runs on your device\./);
  assert.ok(POSITIONING.startsWith("ZeroFee is built in the open."), "control");
  assert.doesNotMatch(POSITIONING, /open-source|open source/i, "Settings' line says the same as Terms until the push");
});

test("restore crawl (4 Nov): on the web wallet Settings has no Passwords row that offers nothing: it opens its On iPhone page (bug report, 5 Nov late; control: elsewhere without the Keychain it says the phone has it)", () => {
  const panel = read("./shell/SettingsPanel.tsx");
  // the copy review's #7 (7 Nov): every browser (the Sim too) gets the row that opens its On iPhone page; no dead "In the iPhone app" row
  assert.match(panel, /\) : \(\n\s+\/\/ any browser[^\n]*\n\s+<button className="set__row set__row--btn set__row--two set__row--val" onClick=\{\(\) => setPasswordsOnIphone\(true\)\}><span><span>Passwords<\/span><small>\{WEB_PASSWORDS_LINE\}<\/small><\/span><span>\{ON_IPHONE\}<\/span><\/button>\n\s+\)\}/);
  assert.doesNotMatch(panel, /LOGINS_ON_PHONE_ONLY/);
  assert.match(panel, /if \(passwordsOnIphone\) return <Suspense fallback=\{null\}><OnIphoneSheet page=\{ON_IPHONE_PAGES\.passwords\} codeUrl=\{import\.meta\.env\.VITE_CODE_URL\} onClose=\{\(\) => setPasswordsOnIphone\(false\)\} \/><\/Suspense>;/, "the row opens its page");
  assert.match(panel, /\{logins \? \(\n\s+<button className="set__row set__row--btn" onClick=\{\(\) => setPasswords\(true\)\}><span>Passwords<\/span>/, "control: the phone's row");
});

test("terms (product decision, 5 Nov late): Beta first, in the UI lead's words; the summary and points lead with it; every install agrees again", async () => {
  const T = await import("./terms.ts");
  assert.deepEqual([...T.TERMS_BETA], [
    "This is the first release. Use small amounts while you try it.",
    "ZeroFee holds no keys and no money, so it cannot get either back for you.",
    "Your funds, your backup words and any loss are your responsibility.",
    "The code comes with no warranty.",
  ]);
  assert.deepEqual(T.TERMS[0], { h: "Beta", p: T.TERMS_BETA.join(" ") });
  assert.equal(T.TERMS_SUMMARY, "A beta: use small amounts. You hold your keys, and payments can't be undone.");
  assert.equal(T.TERMS_POINTS[0], "First release. Use small amounts.");
  assert.equal(T.TERMS_VERSION, "2026-11-05", "bumped: an install that agreed to 2026-10-26 is asked again");
  assert.notEqual("2026-10-26", T.TERMS_VERSION, "control");
});
