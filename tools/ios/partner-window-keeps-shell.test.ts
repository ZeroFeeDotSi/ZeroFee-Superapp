// The partner window (PartnerView.swift) must cover the shell, never take it out of the window. Browser's wallet engine
// runs in the shell's own web view and answers every wallet-mode request (device.wallet.request from PartnerWallet);
// with .fullScreen UIKit removes that web view from the window and an iPhone's WebKit suspends its page, so a site's
// Connect and Sign in waited for ever (2 Nov: pump.fun in Apps, on the test iPhone; the simulator doesn't suspend).
// Swift has no test target here, so this reads the Swift source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const code = (src: string) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join("\n");

test("the partner window is presented over the shell (.overFullScreen), so the shell's page keeps answering the site", () => {
  const view = code(read("apps/ios/ZeroFee/PartnerView.swift"));
  assert.match(view, /modalPresentationStyle = \.overFullScreen/);
  assert.doesNotMatch(view, /\.fullScreen\b/, "never .fullScreen: it takes the shell's web view out of the window");
  // the screen is opaque, so nothing of the shell shows through it
  assert.match(view, /view\.backgroundColor = \.systemBackground/);
});

test("no screen ZeroFee presents over the shell takes the shell's page out of the window", () => {
  for (const f of ["PartnerView.swift", "NativeSheet.swift", "Bridge.swift", "PartnerBridge.swift", "Host.swift", "SecretSheet.swift", "WordsSheet.swift", "WordsEntry.swift"]) {
    assert.doesNotMatch(code(read(`apps/ios/ZeroFee/${f}`)), /modalPresentationStyle = \.fullScreen/, f);
  }
});
