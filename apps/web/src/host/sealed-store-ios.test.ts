// Audit M4 (3 Nov), the phone's half: device.store, Browser places and the sites already opened once are sealed at rest
// in one AES-GCM file (SealedStore.swift: its key in the Keychain this device only, the file under complete protection
// and never in a backup), never plain UserDefaults, and Reset takes it all. A scan of the app's own code, as the other
// host checks do; the store's behaviour runs on a Mac with apps/ios/check/store.sh. Each rule has a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[^]*?\*\//g, "");
const swift = (f: string) => code(readFileSync(new URL(`../../../ios/ZeroFee/${f}`, import.meta.url), "utf8"));
/** A plain write or read of these in UserDefaults. */
const plainDefaults = /UserDefaults\([^)]*device-store[^)]*\)!?\.(set|string)|storeSuite|UserDefaults\.standard\.(set|bool)\(forKey: seen\)|UserDefaults\.standard\.(array|set)\([^)]*Places\.key/;

test("M4: the phone's device.store, places and seen sites go through the sealed store, never plain UserDefaults (control: the old suite write is caught)", () => {
  const bridge = swift("Bridge.swift"), partner = swift("PartnerView.swift");
  assert.match(bridge, /SealedStore\.shared\.get\(slot\)/, "device.store reads the sealed store");
  assert.match(bridge, /SealedStore\.shared\.set\(slot, value\)/, "and writes it");
  assert.match(partner, /SealedStore\.shared\.set\(Places\.key/, "Browser places");
  assert.match(partner, /SealedStore\.shared\.set\(seen, "1"\)/, "seen sites");
  assert.match(partner, /removeAll\(prefix: "zf\.partner\.seen\."\)/, "History cleared takes the seen sites too");
  for (const [f, s] of [["Bridge.swift", bridge], ["PartnerView.swift", partner]]) assert.doesNotMatch(s, plainDefaults, `${f}: nothing plain`);
  assert.match('private static let storeSuite = UserDefaults(suiteName: "si.zerofee.device-store")!', plainDefaults, "control: the old suite is caught");
});

test("M4: one AES-GCM file, its key in the Keychain this device only, complete protection, never in a backup; Reset takes it (controls)", () => {
  const store = swift("SealedStore.swift"), keychain = swift("Keychain.swift"), host = swift("Host.swift");
  assert.match(store, /AES\.GCM\.seal\(/, "sealed with AES-GCM");
  assert.match(store, /\.completeFileProtection/, "complete protection: unreadable while the phone is locked");
  assert.match(store, /isExcludedFromBackup = true/, "never in a backup");
  assert.match(store, /Keychain\.get\("si\.zerofee\.store-key"/, "its key in the Keychain");
  assert.match(keychain, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/, "this device only");
  assert.match(host, /SealedStore\.shared\.wipe\(\)/, "Reset takes the file and its key");
  assert.doesNotMatch(host, /removePersistentDomain\(forName: "si\.zerofee\.device-store"\)/, "never only the old suite");
  assert.doesNotMatch("try sealed.write(to: url, options: [.atomic])", /\.completeFileProtection/, "control: a write without the protection is caught");
});
