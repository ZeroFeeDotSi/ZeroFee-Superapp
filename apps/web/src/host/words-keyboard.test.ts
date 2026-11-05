// Audit H3 (3 Nov): the 24 words typed on the phone's own words screen never reach a third-party keyboard, and never a
// screenshot, while every other field in ZeroFee keeps whatever keyboard the person uses (Gboard, a Thai keyboard: Chat,
// AgentZero and the Browser stay as they are). A scan of the iPhone app's own code, as the other host checks do (the
// Swift itself is typechecked by swiftc and run on a device). Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const IOS = new URL("../../../ios/ZeroFee/", import.meta.url);
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[^]*?\*\//g, "");
const swift = (f: string) => code(readFileSync(new URL(f, IOS), "utf8"));
/** The words entry's own input: a secure field, which iOS types into only with its own keyboard (no extension keyboard,
 *  no dictation, no autocorrect learning). */
const secureWordsField = /SecureField\("Word \\\(at \+ 1\)", text: Binding\(get: \{ current \}, set: \{ typed\(\$0\) \}\)\)/;
/** An app-wide refusal of extension keyboards (what d7726d46 did): it would take Gboard from Chat too. */
const refusesEverywhere = /shouldAllowExtensionPointIdentifier[^]*?\.keyboard/;

test("H3: the words field refuses extension keyboards (a secure field), and only it: no app-wide refusal, so a Chat field allows them (controls: a plain words field and an app-wide refusal are caught)", () => {
  assert.match(swift("WordsEntry.swift"), secureWordsField, "the words field: secure, the system keyboard only");
  assert.doesNotMatch(swift("WordsEntry.swift"), /TextField\("Word /, "never a plain field for the words");
  assert.doesNotMatch('TextField("Word \\(at + 1)", text: Binding(get: { current }, set: { typed($0) }))', secureWordsField, "control: a plain field is caught");
  for (const f of readdirSync(IOS).filter((n) => n.endsWith(".swift"))) assert.doesNotMatch(swift(f), refusesEverywhere, `${f}: no app-wide keyboard refusal`);
  assert.match("func application(_ a: UIApplication, shouldAllowExtensionPointIdentifier p: UIApplication.ExtensionPointIdentifier) -> Bool { p != .keyboard }", refusesEverywhere, "control: an app-wide refusal is caught");
  // Chat's message field is the page's own plain input: any keyboard types there
  const chat = code(readFileSync(new URL("../../../../packages/chat/src/app/ChatApp.tsx", import.meta.url), "utf8"));
  const composer = chat.slice(chat.indexOf("export function Composer("));
  assert.match(composer, /<input value=\{text\}/, "Chat's message field");
  assert.doesNotMatch(composer.slice(0, composer.indexOf("/>")), /type="password"/, "not a secure field: every keyboard allowed");
});

test("H3: the typed words stay out of screenshots and recordings: the entry is drawn in the secure canvas, under its cover (control: the shown words already are)", () => {
  const entry = swift("WordsEntry.swift");
  assert.match(entry, /AnyView\(ScreenshotProof\(content: WordsEntryView\(/, "typed words: screenshot-proof");
  assert.match(entry, /\.privacyCover\(\)/, "and covered when ZeroFee isn't on screen");
  assert.match(swift("WordsSheet.swift"), /AnyView\(ScreenshotProof\(content: WordsSheetView\(/, "control: the shown words, as before");
});
