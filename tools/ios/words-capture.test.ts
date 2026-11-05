// H33: the 24 words are kept out of screenshots and recordings, and the whole app is covered in the app switcher.
// H54: Settings' Face ID row is the phone's real state, never a static "On".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the words sheet: drawn in a secure field's layer, covered when not active or captured, a screenshot gets a warning", () => {
  const words = read("apps/ios/ZeroFee/WordsSheet.swift");
  assert.match(words, /ScreenshotProof\(content: WordsSheetView\(/, "the words sheet is presented inside ScreenshotProof");
  assert.match(words, /\.privacyCover\(\)/, "and behind the recording / app-switcher cover Logins and SecretSheet use");
  assert.match(words, /userDidTakeScreenshotNotification/);
  const secret = read("apps/ios/ZeroFee/SecretSheet.swift");
  assert.match(secret, /struct ScreenshotProof/);
  assert.match(secret, /isSecureTextEntry = true/);
  assert.match(secret, /canBecomeFirstResponder: Bool \{ false \}/, "the field never takes focus or shows a keyboard");
});

test("an exported key (D51): drawn in a secure field's layer, behind the cover, and a screenshot gets a warning", () => {
  const secret = read("apps/ios/ZeroFee/SecretSheet.swift");
  assert.match(secret, /ScreenshotProof\(content: SecretSheetView\(/, "the exported key's sheet is presented inside ScreenshotProof");
  assert.match(secret, /ScreenshotProof\(content: SecretSheetView\([^\n]*\)\)\.ignoresSafeArea\(\)\.privacyCover\(\)/, "and behind PrivacyCover");
  assert.doesNotMatch(secret, /AnyView\(SecretSheetView\(/, "never presented bare");
  assert.match(secret, /userDidTakeScreenshotNotification/);
});

test("a native sheet's cover follows the app's own active state, never scenePhase (it reads background in a sheet, so the words never showed)", () => {
  for (const f of ["SecretSheet.swift", "Logins.swift", "WordsSheet.swift", "WordsEntry.swift"]) {
    assert.doesNotMatch(read(`apps/ios/ZeroFee/${f}`), /@Environment\(\\\.scenePhase\)/, f);
  }
  const secret = read("apps/ios/ZeroFee/SecretSheet.swift");
  assert.match(secret, /willResignActiveNotification/);
  assert.match(secret, /didBecomeActiveNotification/);
});

test("the whole app shows a plain cover in the app switcher, but not over a Face ID prompt", () => {
  const app = read("apps/ios/ZeroFee/ZeroFeeApp.swift");
  assert.match(app, /phase == \.background \|\| \(phase == \.inactive && !FaceIdPrompt\.showing\)/);
  assert.match(app, /struct SwitcherCover/);
  const chip = read("apps/ios/ZeroFee/ChipKey.swift");
  const prompts = chip.match(/context\.evaluate(AccessControl|Policy)\(/g) ?? [];
  const wrapped = chip.match(/FaceIdPrompt\.around\(?\s*\{ try await context\.evaluate/g) ?? [];
  assert.equal(wrapped.length, prompts.length, "every Face ID prompt is marked, so the cover stays off over it");
});

test("Settings: no static Face ID row; the live row reads the phone and warns before Settings", () => {
  const settings = read("apps/web/src/shell/SettingsPanel.tsx");
  assert.doesNotMatch(settings, /"Face ID & lock", "On"/);
  assert.match(settings, /<FaceIdRow host=\{phoneHost\} \/>/);
  const row = read("apps/web/src/shell/FaceIdRow.tsx");
  assert.match(row, /"device\.phoneCheck"/);
  assert.ok(row.indexOf("FACE_ID_CHANGE_WARNING}") < row.indexOf("Open Settings</button>"), "the warning shows before the way to Settings");
});
