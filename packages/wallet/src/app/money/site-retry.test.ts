// QA's rules for a site Add's retry (5 Nov): reads again by themselves with no second sheet (b); a signed Add
// NEAR let expire says "NEAR was busy, so it timed out. Nothing left your Safe." and its Try again opens the Safe's Approve and Face ID again (c);
// a first attempt that went, or may have, is never retried (d). The same key's dedupe is site-topup-retry.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { securityProblems } from "@zerofee/core/security-problems";
import { retryOf, SITE_BUSY_LINE } from "./site-retry.ts";

const site = readFileSync(new URL("./SiteMoney.tsx", import.meta.url), "utf8");
const expired = securityProblems.sendRefused("It took too long, so the network let it expire.");

test("rule c: a signed Add NEAR let expire, nothing sent, asks on the sheet (control: not signed, never this sheet)", () => {
  assert.equal(retryOf(expired, { signed: true, readsAgain: false }), "ask");
  assert.equal(SITE_BUSY_LINE, "NEAR was busy, so it timed out. Nothing left your Safe.");
  assert.equal(retryOf(expired, { signed: false, readsAgain: false }), null, "control: no yes, so the Problem as before");
  // its Try again is go() again: spending.topUp, the Safe's own Approve and Face ID; never a signature by itself
  assert.match(site, /onClick=\{\(\) => void go\(busyAgain\)\}>Try again</);
  assert.match(site, /if \(again === "ask" && j && !auto\) \{ setMade\(null\); setBusyAgain\(v\); return j\.failed\(r\.problem\.whatHappened\); \}/);
});

test("rule b: NEAR busy before any yes reads again once by itself, no second sheet (control: the second time, the Problem)", () => {
  const busy = securityProblems.nodesUnreachable("busy");
  assert.equal(retryOf(busy, { signed: false, readsAgain: false }), "reads");
  assert.equal(retryOf(busy, { signed: false, readsAgain: true }), null, "control: once only");
  assert.match(site, /if \(again === "reads"\) return void setTimeout\(\(\) => void go\(v, true\), SITE_READS_AGAIN_MS\);/);
});

test("the audit's MUST: a NEAR busy or a timeout after the yes may have gone out: never Try again (control: a refusal before sending asks)", () => {
  assert.equal(retryOf(securityProblems.nodesUnreachable("busy"), { signed: true, readsAgain: false }), null);
  assert.equal(retryOf(securityProblems.nodesUnreachable("slow"), { signed: true, readsAgain: false }), null);
  assert.equal(retryOf(securityProblems.sendUnconfirmed("https://nearblocks.io/txns/h"), { signed: true, readsAgain: false }), null, "on its way, read by its hash: no Try again");
  assert.equal(retryOf(expired, { signed: true, readsAgain: false }), "ask", "control");
});

test("rule d: a first attempt that went, or may have, is never retried (control: nothing sent, it may be)", () => {
  const onItsWay = { ...expired, money: { state: "on-the-way" as const, where: "on NEAR" } };
  assert.equal(retryOf(onItsWay, { signed: true, readsAgain: false }), null);
  assert.equal(retryOf(securityProblems.sendRefused("The network refused it."), { signed: true, readsAgain: false }), null, "a refusal that isn't NEAR's busy or expiry: as before");
  assert.equal(retryOf(expired, { signed: true, readsAgain: false }), "ask", "control");
  // the key: a new one only once a move went, so a Try again asks with the same key (the core answers a move that went as itself)
  assert.match(site, /if \("ok" in r && !\("declined" in r\.ok\)\) addKey\.current = moveKey\(\);/);
  assert.doesNotMatch(site, /\.finally\(stop\);\n\s+addKey\.current = moveKey\(\);/, "control: never a new key after every answer");
});
