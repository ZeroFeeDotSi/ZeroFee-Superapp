// ST8 (AUDIT section K): every line on the Browser tab (the hub, its money sheets, the site window) passes the voice
// guard at A or B, and none says "we". The Browser tab's words live in packages/browser (its hub, address bar, Problems),
// Wallet's site money sheet (SiteMoney.tsx) and the phone's site window (the Partner*.swift, Host*.swift files).
// Not copy, so not graded (the copy review's "Not copy" list, 3 Nov): the engine's answers to a site's own code
// (packages/browser/src/engine), CSS selectors, the user-agent string, log lines and developer diagnostics.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allStrings } from "./strings.ts";
import { grade } from "./voice.ts";

const BROWSER_TAB = /^(?:packages\/browser\/src\/(?!engine\/)|packages\/wallet\/src\/app\/money\/SiteMoney\.tsx$|apps\/ios\/ZeroFee\/(?:Partner\w*|HostRules|Host|IsolatedCore)\.swift$)/;
const NOT_COPY: RegExp[] = [
  /\[(?:role|aria-label|href)[*^$]?=|:has\(/, // CSS selectors (PartnerBanners.swift, app-banners.ts)
  /^Mozilla\/5\.0/, // the user-agent string
  /privacy: \.public/, // os_log lines
  /^an engine answer with no wallet-mode window open$|^No partner window in robot mode is open\.$/, // diagnostics
];
const WE = /\b(?:we|us|our|ours)\b|\bwe['’](?:re|ll|ve|d)\b/i;

const browserStrings = () => allStrings().filter((f) => BROWSER_TAB.test(f.file) && !NOT_COPY.some((re) => re.test(f.text)));

test("ST8: every Browser-tab string grades A or B on the voice guard, and none says we", () => {
  const found = browserStrings();
  // control: the reader found the tab's words in each place (a broken file filter would pass by finding nothing)
  assert.ok(found.length > 300, `${found.length} strings`);
  for (const place of ["packages/browser/src/social/", "packages/browser/src/browser-problems.ts", "packages/wallet/src/app/money/SiteMoney.tsx", "apps/ios/ZeroFee/PartnerView.swift", "apps/ios/ZeroFee/HostRules.swift"]) {
    assert.ok(found.some((f) => f.file.startsWith(place)), `no strings read from ${place}`);
  }
  const low = found.map((f) => ({ f, g: grade(f.file, f.text) })).filter(({ g }) => g.grade !== "A" && g.grade !== "B");
  assert.deepEqual(low.map(({ f, g }) => `${f.file}:${f.line} ${g.grade} "${f.text}": ${g.problems.join("; ")}`), []);
  const we = found.filter((f) => WE.test(f.text));
  assert.deepEqual(we.map((f) => `${f.file}:${f.line} "${f.text}"`), []);
});

test("the product Browser thesis (4 Nov): no Browser-tab line promises a Face ID for everything a site asks (a site's own wallet signs a checked trade without one)", () => {
  const untrue = /needs your Face ID|Everything it asks for/i;
  assert.ok(untrue.test("Everything it asks for still needs your Face ID."), "control: the old connect line is caught");
  assert.deepEqual(browserStrings().filter((f) => untrue.test(f.text)).map((f) => `${f.file}:${f.line} "${f.text}"`), []);
});

test("ST8 controls: the same check fails the lines it replaced, and passes the money line 'Nothing was sent.'", () => {
  const file = "packages/browser/src/social/address.ts";
  assert.ok(WE.test("pump isn't on this phone yet, so we opened it in the App Store."));
  assert.equal(grade(file, "pump.fun asked for something ZeroFee can't show you.").grade, "C", "vague 'something'");
  assert.equal(grade(file, "pump.fun says my browser is blocked").grade, "D", "passive");
  assert.equal(grade(file, "Find it in the app store.").grade, "D", "our Apps called the app store");
  assert.equal(grade(file, "Get it in the App Store.").grade, "A", "Apple's App Store is a real name");
  assert.equal(grade(file, "Stopped. Nothing was sent.").grade, "A", "VOICE rule 1 (copy review 3 Nov): the money line has no actor");
  assert.equal(grade(file, "It was sent.").grade, "D", "control: any other passive still fails");
  assert.ok(!BROWSER_TAB.test("packages/browser/src/engine/engine.ts"), "the engine's answers to a site's code are not copy");
});
