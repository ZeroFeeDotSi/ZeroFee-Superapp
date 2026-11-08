// Audit 15 FB3 (8 Nov): the Sim said "Private browsing is on. Sites can't see where you are." while the committed iOS
// project links no Tor, so the phone says "Private browsing isn't ready yet". The web side reads the capability
// (TOR_IN_PHONE_BUILD), never assumes it. Fails on main ea3017f8a.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIVACY, TOR_IN_PHONE_BUILD, viewOf } from "./privacy.ts";
import { SIM_PRIVACY } from "./sim/sites-data.ts";

const repo = new URL("../../../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, repo), "utf8");

test("FB3: the switch follows the committed phone project (no Tor linked: off), and the Sim says what the phone says", () => {
  const pbx = read("apps/ios/ZeroFee.xcodeproj/project.pbxproj");
  assert.equal(TOR_IN_PHONE_BUILD, /\bTor\b|Tor\.xcframework|libtor/.test(pbx), "one fact: the phone build links Tor or it doesn't");
  assert.match(read("apps/ios/ZeroFee/PrivateBrowsing.swift"), /#if canImport\(Tor\)[\s\S]*#else\s*return false/, "control: without Tor the phone's built is false");
  assert.equal(SIM_PRIVACY.built, TOR_IN_PHONE_BUILD, "the Sim never shows what the phone can't");
  // b23: hidden, not "isn't ready yet" (end to end or hidden)
  assert.equal(PRIVACY.rowLine(viewOf({ ok: SIM_PRIVACY })), "Trackers, history and site data");
  const screen = read("packages/browser/src/social/Privacy.tsx");
  assert.doesNotMatch(screen, /privacy-switch-sample|sampleOn|sampleOff/, "no sample switch that claims it");
  assert.match(screen, /\{phone && phone\.built && \(/, "control: the real switch only where Tor is built");
});
