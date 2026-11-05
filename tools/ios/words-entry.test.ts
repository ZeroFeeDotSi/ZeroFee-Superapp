// Typing the 24 words on the phone's own screen (the study's 4.11, S1.6 follow-up): what's typed goes from the native
// screen to the isolated core and nowhere else; the page has no way to ask for it. Swift has no test target here, so
// these read the source (and the core's own test covers what the core does with them).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const context = read("apps/ios/ZeroFee/CoreContext.swift");
const entry = read("apps/ios/core/entry.ts");
const bridge = read("apps/ios/ZeroFee/Bridge.swift");
const entryView = read("apps/ios/ZeroFee/WordsEntry.swift");
const app = read("apps/web/src/App.tsx");

test("the typed words go from the native screen to the core's own callback, and only there", () => {
  assert.match(context, /\("typeWords", typeWords\)/, "offered to the core's context");
  assert.match(context, /private func typeWords[\s\S]*?coreTypeWords\(purpose, wordlist: wordlist\)[\s\S]*?done\.call\(withArguments:/);
  assert.match(entry, /typeWords: \(purpose: "restore" \| "check" \| "rearm" \| "codes"\) =>\s*new Promise\(\(resolve\) => native\.typeWords\(/, "the isolated core asks for them");
  assert.doesNotMatch(bridge, /typeWords|coreTypeWords/, "the page's bridge has nothing that returns them");
  assert.match(entryView, /done\(words\)/);
  assert.doesNotMatch(entryView, /UIPasteboard\.general\.(string|strings)\s*=/, "never copied out");
});

test("on the phone the page opens the native screen instead of its own word fields", () => {
  assert.match(app, /case "restore": screen = coreIsIsolated\(iosHost\(\)\) \? <NativeWords run=\{\(\) => restore\(\)\} \/>/);
  assert.match(app, /case "checkwords": screen = coreIsIsolated\(iosHost\(\)\) \? <NativeWords run=\{\(\) => checkWords\(view\.account\)\} \/>/);
});
