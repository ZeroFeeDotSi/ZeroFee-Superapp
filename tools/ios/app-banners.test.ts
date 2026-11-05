// The partner window's app-banner rules (PartnerBanners.swift) are exactly packages/browser/src/app-banners.ts's: one
// css-display-none rule per site, on its exact host, and nothing else (no other action, no script, no wildcard host).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BANNER_RULES, contentRules } from "../../packages/browser/src/app-banners.ts";
import { PRESETS } from "../../packages/browser/src/presets.ts";

const swift = readFileSync(new URL("../../apps/ios/ZeroFee/PartnerBanners.swift", import.meta.url), "utf8");
const pinned = /PIN-BEGIN\s*\n\s*static let json = #"([\s\S]*?)"#\s*\n\s*\/\/ PIN-END/.exec(swift)?.[1];

test("PartnerBanners.swift pins exactly the TypeScript rules", () => {
  assert.ok(pinned, "the pin is in the Swift file");
  assert.equal(pinned, contentRules());
});

test("each rule only hides, only on one exact host ZeroFee lists, with no script", () => {
  const rules = JSON.parse(contentRules()) as { trigger: Record<string, unknown>; action: { type: string; selector: string } }[];
  const hosts = new Set(PRESETS.flatMap((p) => p.hosts));
  for (const r of rules) {
    assert.equal(r.action.type, "css-display-none");
    assert.deepEqual(Object.keys(r.trigger).sort(), ["if-domain", "url-filter"]);
    const domains = r.trigger["if-domain"] as string[];
    assert.equal(domains.length, 1);
    assert.ok(hosts.has(domains[0]!) && !domains[0]!.startsWith("*"), domains[0]);
    assert.doesNotMatch(r.action.selector, /script|javascript:|url\(/i);
  }
  assert.deepEqual(BANNER_RULES.map((r) => r.host).sort(), ["gmgn.ai", "pump.fun"]);
  // the Swift side adds the list and runs nothing in the page
  const code = swift.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /evaluateJavaScript|callAsyncJavaScript|WKUserScript|addScriptMessageHandler/);
  assert.match(code, /compileContentRuleList/);
});
