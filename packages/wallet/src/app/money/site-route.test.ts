// A site's top-up, one exit (QA, 5 Nov): the sheet's way (site-route.ts). Private covers it: one exit, no Face
// ID, the job made at the tap; short: the WHOLE amount filled a step up (one Face ID), then that exit; the fill not open:
// said before the tap, the button off. Control: the sheet never asks the public leg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateUsdcOf, siteRoute } from "./site-route.ts";

test("the way it goes: Private covers it, short (the whole amount filled a step up), the fill not open, or Private unread", () => {
  assert.deepEqual(siteRoute(10, 25, false), { kind: "private" });
  assert.deepEqual(siteRoute(30, 12.5, true), { kind: "fill", fillUsd: 40 });
  assert.deepEqual(siteRoute(30, 12.5, false), { kind: "closed", haveUsd: 12.5 });
  assert.deepEqual(siteRoute(10, null, false), { kind: "unread" });
  assert.equal(privateUsdcOf({ available: true, ready: true, rows: [{ symbol: "USDC", amount: "12.5" }, { symbol: "NEAR", amount: "4" }] }), 12.5);
  assert.equal(privateUsdcOf({ available: true, ready: false, rows: [] }), 0);
  assert.equal(privateUsdcOf(null), null);
});

test("the sheet: Private alone makes the job at the tap (no Face ID); with the fill, on the Safe's yes; the fill not open is said and nothing asked (control: never ledger.toTrading)", () => {
  const src = readFileSync(new URL("./SiteMoney.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(way\.kind === "private"\) make\(\);\n\s+const stop = onOwnApproval/);
  assert.match(src, /if \(way\.kind === "closed"\) \{ const l = ROUTE_WORDS\.closed\([^\n]+return void \(auto \? onAutoLine\?\.\(l\) : setLine\(l\)\); \}\n\s+setBusy\(true\);/);
  assert.match(src, /disabled=\{busy \|\| services\.down \|\| over \|\| route\.kind === "closed"/);
  assert.match(src, /title=\{ROUTE_WORDS\.title\(/);
  assert.doesNotMatch(src, /ledger\.toTrading/);
});
