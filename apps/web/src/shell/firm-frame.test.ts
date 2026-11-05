// Bug report, 4 Nov: "some pages you can swipe and move the entire app frame, the headings, the body… I like it firm,
// the elements that make the UI are fixed". The page never scrolls, pans or bounces; an app's frame (its header, its
// sections, a pinned row such as Browser's address bar) never scrolls; only the content region scrolls, up and down,
// with no rubber band; and a swipe between apps starts only at the screen's edge (swipe.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const repo = new URL("../../../../", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(repo, p), "utf8");

test("firm frame: html and body never scroll or bounce, and no scroller anywhere rubber-bands or hands its scroll on", () => {
  const app = read("apps/web/src/app.css");
  assert.match(app, /html, body \{ overflow: hidden; overscroll-behavior: none; \}/);
  assert.doesNotMatch(app, /^\*[^{\n]*\{[^}]*overscroll-behavior/m, "never on every element: a short quick flick on a row's clipped text must reach the list");
  assert.match(app, /html\[data-mode="laptop"\], html\[data-mode="laptop"\] body \{[^}]*overflow: auto;/, "control: the laptop page still scrolls as a document");
});

test("firm frame: an app's frame never scrolls; only its content does, up and down only, with no bounce", () => {
  const css = read("packages/shell-api/src/appframe.css");
  assert.match(css, /\.zf-screen\.af-frame \{ overflow: hidden; \}/);
  assert.match(css, /\.af-main \{[^}]*overflow-x: hidden; overflow-y: auto;[^}]*overscroll-behavior: none;/);
  assert.doesNotMatch(read("packages/design/src/ui.css"), /\.zf-screen \{[^}]*overscroll-behavior: contain/);
  const frame = read("packages/shell-api/src/AppFrame.tsx");
  assert.equal(frame.match(/className="zf-screen af-frame"/g)?.length, 2, "AppFrame and PushedFrame");
  assert.match(frame, /\{pinned && <div className="af-pinned">\{pinned\}<\/div>\}\s*<main className="af-main">/, "a pinned row sits outside the scroller");
  assert.match(read("packages/browser/src/social/SocialHub.tsx"), /pinned=\{<AddressBar /, "Browser's address bar stays put");
});

test("firm frame: no shared stylesheet lets a scroller bounce (overscroll-behavior: contain keeps iOS's rubber band)", () => {
  const roots = ["apps/web/src", "packages/wallet/src", "packages/design/src", "packages/shell-api/src", "packages/browser/src", "packages/trade/src", "packages/agent/src", "packages/chat/src"];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(repo, dir))) {
      const p = join(dir, name);
      if (statSync(join(repo, p)).isDirectory()) walk(p);
      else if (p.endsWith(".css") && /overscroll-behavior:\s*(contain|auto)/.test(read(p))) found.push(p);
    }
  };
  roots.forEach(walk);
  assert.deepEqual(found, []);
});

// Tester, 4 Nov (71e5dec4's confirm run): on Trade's list a quick 120 px flick moved nothing while a slow drag scrolled.
// A rule giving every element overscroll-behavior: none caught it: a row's clipped text (overflow: hidden) is a scroll
// container, and `none` there stopped the short flick from reaching .af-main (measured in Chrome, 390x844: 0 px with the
// rule, 179 px without it; the build before 71e5dec4, 217 px). So each scroller declares its own: up-and-down ones
// overscroll-behavior (none; Home's wallet list may still say contain), sideways strips overscroll-behavior-x.
test("firm frame: every scroller says its own overscroll-behavior, sideways strips on x only", () => {
  const roots = ["apps/web/src", "packages/design/src", "packages/shell-api/src", "packages/browser/src", "packages/trade/src", "packages/agent/src", "packages/chat/src", "packages/pay/src", "packages/wallet/src"];
  const missing: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(repo, dir))) {
      const p = join(dir, name);
      if (statSync(join(repo, p)).isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".css")) continue;
      for (const m of read(p).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [sel, body] = [m[1].trim().split("\n").pop()!.trim(), m[2]];
        if (/data-mode="laptop"/.test(sel)) continue; // the laptop page scrolls as a document
        const y = /(^|[;\s])overflow(-y)?:\s*(auto|scroll)/.test(body);
        const x = /(^|[;\s])overflow-x:\s*(auto|scroll)/.test(body);
        if (y && !/overscroll-behavior(-y)?:\s*(none|contain)/.test(body)) missing.push(`${p} ${sel} (up and down)`);
        else if (!y && x && !/overscroll-behavior(-x)?:\s*none/.test(body)) missing.push(`${p} ${sel} (sideways)`);
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(missing, []);
});

test("rule 10: on a phone the page is pinned (position: fixed), the laptop page is not, and a drag selects no text outside fields", () => {
  const app = read("apps/web/src/app.css");
  assert.match(app, /@media \(max-width: 599px\) \{\s*html:not\(\[data-mode="laptop"\]\), html:not\(\[data-mode="laptop"\]\) body \{ position: fixed; inset: 0; width: 100%; \}/);
  assert.match(app, /#root \{ overscroll-behavior: none; -webkit-user-select: none; user-select: none;/);
  assert.match(app, /#root :where\(input, textarea, select, \[contenteditable\], pre, code, \.zf-selectable\) \{ -webkit-user-select: text; user-select: text;/, "control: fields still select");
});
