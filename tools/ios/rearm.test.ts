// Turning approvals back on after Face ID changed (audit IOS-1b): the approval key is made again only through the
// isolated core's own channel (after the core checked the 24 words), never from the page; the words are typed on the
// phone's own screen, which first says to remove a face someone else added; and a dead account key is never reused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../../apps/ios/ZeroFee/${f}`, import.meta.url)), "utf8");
const isolated = read("IsolatedCore.swift");
const bridge = read("Bridge.swift");
const chip = read("ChipKey.swift");
const entry = read("WordsEntry.swift");

test("the approval key is reset only by the core's own channel, and the page can't reach it", () => {
  const coreKey = isolated.slice(isolated.indexOf("func coreKey("), isolated.indexOf("nonisolated func coreResource("));
  assert.match(coreKey, /if op == "approval-reset" \{[\s\S]*try ApprovalPass\.resetKey\(\)/);
  assert.match(coreKey, /if op == "approval-state" \{ return ok\(\["changed": ApprovalPass\.facesChanged\(\)\]\) \}/);
  assert.doesNotMatch(bridge, /approval-reset|resetKey/, "the page's bridge has no way to it");
});

test("the words screen for it says to remove a face someone else added first", () => {
  assert.match(entry, /purpose == "rearm" \? "ZEROFEE · FACE ID CHANGED"/);
  assert.match(entry, /Didn't change Face ID yourself\? Stop here\. Reset it in Settings, Face ID & Passcode/);
});

test("a new account or a move to this phone never reuses an account key made before the faces changed", () => {
  const create = chip.slice(chip.indexOf("static func create() throws -> String {"), chip.indexOf("static func publicRaw()"));
  assert.match(create, /guard let then, let now = ApprovalPass\.facesNow\(\), then != now else \{ return existing \}/);
  assert.match(create, /try Keychain\.delete\(Keychain\.chipKey, handleItem\)/);
  assert.match(create, /try\? Keychain\.set\(Keychain\.chipKey, facesItem, faces\)/);
});

test("the core's ask for the re-arm screen reaches it as \"rearm\", not as a restore", () => {
  const ctx = read("CoreContext.swift");
  assert.match(ctx, /let purpose = asked == "check" \|\| asked == "rearm" \|\| asked == "codes" \? asked! : "restore"/);
});
