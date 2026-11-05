// The web wallet's one page for what lives on the phone (product decision, 4 Nov): the Browser, pump.fun, GMGN, and any way
// in to the Safe, AgentZero or Private. One component, one layout: full screen (D135), Close, the app's icon, "On your
// phone", one reason line, Get the phone app.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PHONE_APP_URL, PHONE_PAGE, phoneReason } from "./web-wallet-words.ts";

test("the page's words: one title, one button, one reason per thing (drafts, Copywriter after)", () => {
  assert.equal(PHONE_PAGE.title, "On your phone");
  assert.equal(PHONE_PAGE.button, "Get the phone app");
  assert.equal(PHONE_PAGE.tag, "Phone");
  assert.equal(phoneReason("browser"), "Most sites won't open inside a web page. The phone app has its own browser.");
  assert.equal(phoneReason("site", "pump.fun"), "In the phone app, pump.fun opens with your pump.fun wallet. A web page can't do that.");
  assert.equal(phoneReason("site", "GMGN"), "In the phone app, GMGN opens with your GMGN wallet. A web page can't do that.");
  assert.equal(phoneReason("safe"), "Your Safe needs the chip in your iPhone, the Secure Enclave.");
  assert.equal(phoneReason("agent"), "AgentZero works in the phone app. There it does jobs on sites for you.");
  assert.equal(phoneReason("chat"), "Chat works in the phone app.");
  assert.equal(phoneReason("private"), "Private needs your Safe. Your Safe is in the phone app.");
});

test("one layout: a full-screen Sheet with Close, the icon, the title, the reason, and the button to the phone app", () => {
  const page = readFileSync(new URL("./OnYourPhone.tsx", import.meta.url), "utf8");
  assert.match(page, /<Sheet onClose=\{onClose\}>/, "the title is said once, on the page (not again in the bar)");
  assert.match(page, /<h2 className="zf-title oyp__title">\{PHONE_PAGE\.title\}<\/h2>/);
  assert.match(page, /\{phoneReason\(reason, name\)\}/);
  assert.match(page, /href=\{PHONE_APP_URL\} target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /\{icon \?\? <Mark size=\{64\} mode="still" \/>\}/);
  assert.equal(PHONE_APP_URL, "https://zerofee.si");
});
