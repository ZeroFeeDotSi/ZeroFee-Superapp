// H-3: device.shareFile, the statement's way off the phone: iOS's own share sheet, so the file leaves only by the
// person's choice there. Swift has no test target here, so this reads the source (as approval-pass.test.ts does); the
// proof on a phone is a walk: Activity → Statement → Save statement → the share sheet → Save to Files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const share = read("../../apps/ios/ZeroFee/ShareFile.swift");
const bridge = read("../../apps/ios/ZeroFee/Bridge.swift");
const ios = read("../../apps/web/src/host/ios.ts");
const host = read("../../apps/ios/ZeroFee/Host.swift");
const fn = share.slice(share.indexOf("func shareFile("));

test("the host routes device.shareFile to ShareFile.swift, and the page's iPhone bridge lets it through; control: one route, after the app-id checks", () => {
  assert.equal(bridge.match(/case "device\.shareFile": return await shareFile\(app, p\)/g)?.length, 1);
  const route = bridge.indexOf('case "device.shareFile"');
  assert.ok(route > bridge.indexOf("guard knownApps.contains(app)"), "only a known app's request reaches it");
  assert.match(ios, /"device\.shareFile"\]\);/, "in DEVICE_METHODS");
  assert.match(ios, /if \(method === "device\.shareFile" && app !== "wallet"\) return refuse\("Only Wallet can do that\."\);/, "checked on the page's side too (review L7)");
});

test("Wallet only, checked first; control: no other app is named", () => {
  const firstGuard = fn.indexOf("guard ");
  assert.equal(fn.indexOf('guard app == "wallet" else { return problem("shell.device.refused", "Only Wallet can do that.") }'), firstGuard);
  assert.doesNotMatch(fn, /app == "(pay|trade|browser|social|agent|earn|chat|extension)"/);
});

test("text only, at most 2 MB, a plain name with no folder in it; control: the pattern refuses a path and an app", () => {
  assert.match(share, /private let shareMimes: Set<String> = \["text\/csv", "text\/plain"\]/);
  assert.match(share, /private let maxShared = 2 \* 1024 \* 1024/);
  assert.match(fn, /name\.wholeMatch\(of: shareNamePattern\) != nil/);
  const pattern = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}\.(csv|txt)$/;
  assert.match(share, /\/\[A-Za-z0-9\]\[A-Za-z0-9 \._-\]\{0,79\}\\\.\(csv\|txt\)\//, "the Swift pattern is this one");
  assert.ok(pattern.test("ZeroFee statement 2026-11.csv"));
  for (const bad of ["../x.csv", "/etc/x.csv", ".x.csv", "a.csv.app", "x.html", "a/b.csv"]) assert.ok(!pattern.test(bad), bad);
});

test("the file lives in a folder of its own, protected, and is deleted when the sheet ends, when it can't be shown, on a timeout, and at launch after a crash", () => {
  assert.match(fn, /fm\.temporaryDirectory\.appendingPathComponent\(ShareFiles\.prefix \+ UUID\(\)\.uuidString, isDirectory: true\)/);
  assert.match(fn, /options: \[\.atomic, \.completeFileProtection\]/);
  assert.match(fn, /once\.done = true\n\s+once\.timeout\?\.cancel\(\)\n\s+try\? FileManager\.default\.removeItem\(at: dir\)/, "the end deletes it and stops the timeout");
  assert.match(fn, /guard !Task\.isCancelled, !once\.done else \{ return \}[\s\S]*finish\(false\)/, "a sheet left open gives it up");
  assert.match(fn, /guard sheet\.presentingViewController != nil else \{ return finish\(false\) \}/, "a sheet that couldn't be shown: at once (review M3)");
  assert.match(fn, /while let next = top\.presentedViewController, !next\.isBeingDismissed \{ top = next \}/);
  assert.match(host, /override init\(\) \{[\s\S]{0,400}ShareFiles\.sweep\(\)/, "a crash's folder goes at launch (review L5)");
  assert.ok(fn.indexOf("ShareFiles.sweep()") < fn.indexOf("fm.createDirectory"), "and before a new one");
  assert.match(fn, /UIActivityViewController\(activityItems: \[file\], applicationActivities: nil\)/, "iOS's own sheet: the person picks");
  // control: nothing in it sends anything itself
  assert.doesNotMatch(share, /URLSession|URLRequest|https?:\/\//);
});

test("only the sheet's end ends it: a sub-activity closed (Mail's compose) keeps the file; control: done, or the sheet closed, ends it", () => {
  assert.match(fn, /completionWithItemsHandler = \{ activity, completed, _, _ in\n\s+guard completed \|\| activity == nil else \{ return \}/);
});

test("one share at a time: a second is refused, never stacked, and can't sweep the first one's file; control: the gate opens again on the way out", () => {
  const gate = fn.indexOf("guard !ShareFiles.open else");
  assert.ok(gate > 0 && gate < fn.indexOf("ShareFiles.sweep()"));
  assert.match(fn, /ShareFiles\.open = true\n\s+defer \{ ShareFiles\.open = false \}/);
});
