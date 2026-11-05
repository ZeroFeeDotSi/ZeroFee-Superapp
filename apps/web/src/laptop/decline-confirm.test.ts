// Contract round 3's MUST (QA, the veto audit): one routine no from a second device of age pauses the main
// device's Face ID payments for a change's wait and ends what it asked alone (lib.rs `decline`). So Say no asks first,
// on one full-screen sheet, and only its Say no anyway sends the no. Say yes, and a no that pauses nothing, are
// unchanged. Each with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { NO_PAUSE, pauseWait, sayNoFirst } from "./decline-words.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
let server: ViteDevServer;
let DeclineConfirm: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  DeclineConfirm = (await server.ssrLoadModule("./DeclineConfirm.tsx")).DeclineConfirm;
});
after(async () => server?.close());

test("a no that pauses asks first; Say yes and a no that pauses nothing answer at once", () => {
  assert.equal(sayNoFirst({ pauseSeconds: 259_200 }, false), "ask");
  // controls: Approve is unchanged, with or without a pause; a no on an older contract or from a young laptop is sent
  assert.equal(sayNoFirst({ pauseSeconds: 259_200 }, true), "answer");
  assert.equal(sayNoFirst({}, true), "answer");
  assert.equal(sayNoFirst({}, false), "answer");
  // the audit's SHOULD: unread just then (pauseUnknown) fails toward asking; Approve still answers at once
  assert.equal(sayNoFirst({ pauseUnknown: true }, false), "ask");
  assert.equal(sayNoFirst({ pauseUnknown: true }, true), "answer");
});

test("the pause is said in the account's own wait: 72 hours on the app's 48-hour account, else its own", () => {
  assert.equal(pauseWait(259_200), "72 hours");
  assert.equal(pauseWait(172_800), "48 hours");
  assert.equal(pauseWait(345_600), "4 days");
  assert.equal(pauseWait(691_200), "8 days");
  assert.equal(pauseWait(216_000), "60 hours");
});

test("the sheet: full screen with Close, the pause and its wait, what ends, the words' way out, Say no anyway and Go back", () => {
  for (const whose of ["mine", "theirs"] as const) {
    const html = renderToStaticMarkup(createElement(DeclineConfirm, { seconds: 259_200, whose, onNo: () => {}, onBack: () => {} }));
    assert.match(html, /class="zf-sheet" role="dialog" aria-modal="true"/, "the one full-screen Sheet (D135)");
    assert.match(html, /aria-label="Close"/);
    assert.ok(html.includes(NO_PAUSE[whose].title.replace("{wait}", "72 hours")), whose);
    for (const l of NO_PAUSE[whose].lines) assert.ok(html.includes(l.replace("'", "&#x27;")), l);
    assert.match(html, /data-act="say-no">Say no anyway</);
    assert.match(html, /data-act="go-back">Go back</);
    assert.doesNotMatch(html, /\{wait\}/);
  }
  // unread just then: "may", the lead, the same four lines, no length promised
  for (const whose of ["mine", "theirs"] as const) {
    const html = renderToStaticMarkup(createElement(DeclineConfirm, { seconds: null, whose, onNo: () => {}, onBack: () => {} }));
    assert.ok(html.includes(NO_PAUSE[whose].maybeTitle), whose);
    assert.ok(html.includes(NO_PAUSE[whose].maybeLead), whose);
    for (const l of NO_PAUSE[whose].lines) assert.ok(html.includes(l.replace("'", "&#x27;")), l);
    assert.doesNotMatch(html, /hours|days|\{wait\}/, "control: no length when it wasn't read");
    assert.match(html, /data-act="say-no">Say no anyway</);
  }
  assert.match(NO_PAUSE.mine.title, /your main device/);
  assert.match(NO_PAUSE.theirs.title, /their main device/);
});

test("on the laptop and the guardian's phone, Say no goes through the ask; only the sheet's Say no anyway sends a no", () => {
  const cases = [
    { src: read("./RecoveryRequest.tsx"), send: "onAnswer", whose: "mine" },
    { src: read("../apps/security/GuardianSide.tsx"), send: "answer", whose: "theirs" },
  ];
  for (const { src, send, whose } of cases) {
    assert.match(src, /onClick=\{\(\) => tap\(r, false\)\}>Say no</);
    assert.match(src, /onClick=\{\(\) => tap\(r, true\)\}>Say yes</, "Approve goes through tap, which answers it at once");
    assert.match(src, /sayNoFirst\(r, approve\) === "ask" \? setAsking\(r\)/);
    assert.match(src, new RegExp(`<DeclineConfirm whose="${whose}" seconds=\\{asking\\.pauseSeconds \\?\\? null\\} onBack=\\{\\(\\) => setAsking\\(null\\)\\} onNo=\\{\\(\\) => \\{ setAsking\\(null\\); (void )?${send}\\(asking[^)]*, false\\); \\}\\}`));
    // control: no Say no button sends the no itself any more (it did before: onClick={() => onAnswer(r.accountId, r.id, false)})
    assert.doesNotMatch(src, /onClick=\{\(\) => (void )?(onAnswer|answer)\(r[^)]*, false\)\}/);
  }
});

test("Go back and Close send nothing: both are the sheet's onBack, which only clears the ask", () => {
  const src = read("./DeclineConfirm.tsx");
  assert.match(src, /<Sheet title=\{w\.headTitle\} onClose=\{onBack\}>/);
  assert.match(src, /data-act="go-back" onClick=\{onBack\}/);
  assert.match(src, /data-act="say-no" onClick=\{onNo\}/);
});
