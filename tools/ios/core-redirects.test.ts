// The phone core's network rule holds for redirects too (Security, 28 Oct, the outside study's item 2): CoreContext's
// fetch reaches only https and its allowed hosts, and a redirect is followed only under the same rule. Swift has no
// test target here, so this reads the Swift source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const swift = readFileSync(fileURLToPath(new URL("../../apps/ios/ZeroFee/CoreContext.swift", import.meta.url)), "utf8");

test("the core's one session follows redirects only through RedirectGate, on the same allowed hosts", () => {
  assert.equal(swift.match(/URLSession\(/g)?.length, 1, "one session");
  assert.match(swift, /session = URLSession\(configuration: config, delegate: RedirectGate\(allowedHosts\), delegateQueue: nil\)/);
  assert.doesNotMatch(swift, /URLSession\.shared/);
});

test("RedirectGate follows https to an allowed host and nothing else", () => {
  assert.match(swift, /guard let url, url\.scheme == "https", let host = url\.host else \{ return false \}\n\s*return allowedHosts\.contains\(host\)/);
  assert.match(swift, /willPerformHTTPRedirection[^{]*\{\n\s*completionHandler\(Self\.follows\(request\.url, allowedHosts: allowedHosts\) \? request : nil\)/);
});
