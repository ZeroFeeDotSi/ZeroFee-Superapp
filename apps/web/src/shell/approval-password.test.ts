// The web wallet's approval sheet (fork A, 4 Nov: one path for an over-cap Send, Trade's over-cap and its first session):
// every approval.needed carries {password: true}; Approve answers with the password; a wrong one keeps the sheet open
// to type again (the core counts it), a wait says how long; Not now needs no password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APPROVAL_PASSWORD_WORDS as W, passwordAnswer } from "./approval-password.ts";

test("the core's answer to a password Approve: done, or why the sheet stays open", () => {
  assert.deepEqual(passwordAnswer({ ok: true }), { done: true });
  assert.deepEqual(passwordAnswer({ problem: { code: "security.web.password", whatHappened: "x" } }), { why: W.wrong });
  assert.deepEqual(passwordAnswer({ problem: { code: "security.web.wait", whatHappened: "Too many tries. Try again in 30 seconds." } }), { why: "Too many tries. Try again in 30 seconds." });
  assert.deepEqual(passwordAnswer({ problem: { code: "security.web.wait" } }), { why: W.failed }, "a wait with no line: the plain one");
  // control: any other refusal ends the sheet (the asker hears it), never a loop on a password that was right
  assert.deepEqual(passwordAnswer({ problem: { code: "security.request.gone" } }), { done: true });
  assert.deepEqual(passwordAnswer(null), { why: W.failed }, "no answer: try again");
});

test("the sheet: a password field when asked, Approve sends it, a wrong one stays open, Not now sends none", () => {
  const sheet = readFileSync(new URL("./ApprovalSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /bridge\.call\("approval\.answer", \{ id: showing\.id, approve: true, password \}\)/);
  assert.match(sheet, /if \("why" in said\) return said\.why;/, "a wrong password keeps the sheet");
  assert.match(sheet, /export type Pending = \{ id: string; words: PlainWords; app\?: string; password\?: boolean \};/);
  const view = readFileSync(new URL("./ApprovalSheetView.tsx", import.meta.url), "utf8");
  assert.match(view, /\{password && \(/);
  assert.match(view, /type="password"/);
  assert.match(view, /const canApprove = armed && atEnd && \(!password \|\| typed\.length > 0\);/);
  assert.match(view, /<button className="zf-link" onClick=\{\(\) => answer\(false\)\}>Not now<\/button>/);
  assert.equal(W.ask, "Type your password to approve.");
});

test("a web test (4 Nov): the full-screen 'Check this' sheet has Close (D135), answering as Not now does: no (control: Not now stays)", () => {
  const view = readFileSync(new URL("./ApprovalSheetView.tsx", import.meta.url), "utf8");
  assert.match(view, /<button type="button" className="zf-sheet__close approval__close" onClick=\{\(\) => answer\(false\)\} aria-label="Close" data-testid="approval-close"><Close \/><\/button>/);
  assert.match(readFileSync(new URL("./approval.css", import.meta.url), "utf8"), /\.approval \.approval__close \{ position: absolute;/, "its corner style is its own (not sheet.css: Home's first load)");
  assert.match(view, /<button className="zf-link" onClick=\{\(\) => answer\(false\)\}>Not now<\/button>/, "control");
});
