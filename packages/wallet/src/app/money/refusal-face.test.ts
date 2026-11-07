// the copy review's rule (7 Nov): a refusal on the Move and Swap sheets and the Problem screen says who and why as its head (one
// sentence), the money fact as its body, and its button is the way on. A wallet's refusal with its own reason heads with
// that reason; the generic one heads "ZeroFee said no.". Table on the pure split; the Problem screen mounted; the two
// sheets' own line functions (each sheet draws exactly that line: swap-floor.test and move pins).
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { securityProblems } from "@zerofee/core/security-problems";
import { jobTaken } from "@zerofee/shell-api/job-run.ts";
import { refusalFace } from "@zerofee/shell-api/refusal-face.ts";
import { createServer, type ViteDevServer } from "vite";
import { stoppedLine } from "./swap-refused.ts";
import { refusedLine } from "../screens/move-run.ts";

// the Problem screen, as the app draws it (its .tsx through vite's SSR, as decline-confirm.test does)
let server: ViteDevServer;
let ProblemView: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("../../../../shell-api/src", import.meta.url)), logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  ProblemView = (await server.ssrLoadModule("./ProblemView.tsx")).ProblemView;
});
after(async () => { await server.close(); });

const READS: [string, string][] = [
  ["ZeroFee couldn't read Private, so it stopped this. Nothing moved.", "ZeroFee couldn't read Private, so it stopped this."],
  ["ZeroFee couldn't read this coin's price, so it stopped this. Nothing moved.", "ZeroFee couldn't read this coin's price, so it stopped this."],
  ["ZeroFee couldn't read your Safe, so it stopped this. Nothing moved.", "ZeroFee couldn't read your Safe, so it stopped this."],
];

test("the copy review's rule, the table: each read failure's head is its reason, its body \"Nothing moved.\"; a non-read refusal the same way; the generic one \"ZeroFee said no.\" then the rest; any other Problem keeps its own words (null)", () => {
  for (const [more, head] of READS) assert.deepEqual(refusalFace(securityProblems.subwalletRefused(more, true)), { head, body: "Nothing moved." }, more);
  assert.deepEqual(refusalFace(securityProblems.subwalletRefused("That wallet isn't one of yours, so ZeroFee stopped this. Nothing moved.")), { head: "That wallet isn't one of yours, so ZeroFee stopped this.", body: "Nothing moved." });
  assert.deepEqual(refusalFace({ ...securityProblems.subwalletRefused(""), more: undefined }), { head: "ZeroFee said no.", body: "This wallet can't approve this. Your money is in that wallet." }, "the generic one");
  assert.deepEqual(refusalFace(securityProblems.subwalletRefused("A 0x1234567890123456789012345678901234567890 id.")), { head: "ZeroFee said no.", body: "This wallet can't approve this. Your money is in that wallet." }, "machine text is never a head");
  assert.equal(refusalFace(jobTaken()), null, "control: another Problem's own words");
});

test("the copy review's rule, the Problem screen (mounted): the read failure's head is its reason, the body \"Nothing moved.\", the lit button Try again; never the generic words [the head was \"This wallet can't approve this, so ZeroFee said no.\" before]", () => {
  for (const [more, head] of READS) {
    const html = renderToStaticMarkup(createElement(ProblemView, { problem: securityProblems.subwalletRefused(more, true), onNext: () => {}, onBack: () => {}, close: true }));
    assert.match(html, new RegExp(`<h1 class="zf-title">${head.replace(/'/g, "&#x27;")}</h1>`), more);
    assert.match(html, /<p class="zf-body">Nothing moved\.<\/p>/);
    assert.match(html, /<button class="zf-btn">Try again<\/button>/);
    assert.match(html, /aria-label="Close"/, "the bar's X");
    assert.doesNotMatch(html, /can(&#x27;|')t approve|in that wallet/, "never the generic words");
  }
  // control: the generic one heads "ZeroFee said no."; another Problem as before
  const g = renderToStaticMarkup(createElement(ProblemView, { problem: { ...securityProblems.subwalletRefused(""), more: undefined }, onNext: () => {} }));
  assert.match(g, /<h1 class="zf-title">ZeroFee said no\.<\/h1>/);
  assert.match(g, /<p class="zf-body">This wallet can(&#x27;|')t approve this\. Your money is in that wallet\.<\/p>/);
  assert.match(g, />Go back<\/button>/);
  const t = renderToStaticMarkup(createElement(ProblemView, { problem: jobTaken(), onNext: () => {} }));
  assert.match(t, /<h1 class="zf-title">Another job is using this money, so nothing moved\. Try again once that job is signed\.<\/h1>/);
});

test("the copy review's rule, the Move and Swap sheets' line: the read failure's reason then \"Nothing moved.\" [both said \"This wallet can't approve this, so ZeroFee said no.\" before]; control: another refusal's line as before", () => {
  for (const [more] of READS) {
    const p = securityProblems.subwalletRefused(more, true);
    assert.equal(stoppedLine(p), more, "Swap");
    assert.equal(refusedLine(p), more, "Move");
  }
  assert.equal(stoppedLine(jobTaken()), jobTaken().whatHappened);
  assert.equal(refusedLine(jobTaken()), jobTaken().whatHappened);
});
