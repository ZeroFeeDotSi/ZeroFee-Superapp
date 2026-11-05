import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIL_RECEIVE_LIVE, MAIL_SEND_LIVE, inboxShown, sendShown } from "./inbox-gate.ts";

test("receive on, send off (QA 5 Nov): the Inbox shows with an address; no way to send is offered (control: no address, receive off)", () => {
  assert.equal(MAIL_RECEIVE_LIVE, false, "launch (5 Nov): receiving waits for mail.zerofee.si on the gate's host list; a follow-up flips it");
  assert.equal(MAIL_SEND_LIVE, false, "sending isn't built");
  assert.equal(inboxShown("bright.otter@mail.zerofee.si", true), true, "an address, receive on: the Inbox shows");
  assert.equal(inboxShown(null), false, "no mailbox yet: hidden");
  assert.equal(inboxShown(""), false);
  assert.equal(inboxShown("bright.otter@mail.zerofee.si", false), false, "control: receive off, hidden even with an address");
  assert.equal(sendShown(), false, "no Send today");
  assert.equal(sendShown(true), true, "control: once sending is live it shows");
});

test("the Inbox draws no Send control and no Write a mail while sending is off (absent, not a dead button)", () => {
  const src = readFileSync(new URL("./Inbox.tsx", import.meta.url), "utf8");
  // the only way to the writer is behind sendShown(); the writer itself returns nothing without it
  assert.match(src, /\{sendShown\(\) && <button className="zf-btn st-line-btn" onClick=\{\(\) => setWriting\(true\)\}>Write a mail<\/button>\}/);
  assert.match(src, /if \(writing && sendShown\(\)\) return <Write /);
  assert.equal((src.match(/setWriting\(true\)/g) ?? []).length, 1, "one way in, behind the switch");
  // the app reads the mailbox once receiving is live, never behind the send switch
  const app = readFileSync(new URL("./AgentZeroChatApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /if \(!MAIL_SEND_LIVE\) return;/);
  assert.match(app, /if \(!MAIL_RECEIVE_LIVE \|\| SAMPLE\) return;/);
});
