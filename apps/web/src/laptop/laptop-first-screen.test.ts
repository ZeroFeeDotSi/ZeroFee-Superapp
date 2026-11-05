// The laptop page "shows nothing" (product decision, 5 Nov, laptop.zerofee.si): a bare visit sat on the mark and "Opening ZeroFee…"
// until this browser's storage answered, then on a bare spinning mark until NEAR did, with no deadline on the second.
// Now its first paint says what the page is and the next step; a load NEAR never answers ends as a named error with Try
// again; and before the script runs at all, the page's own HTML says what it is (and, after 8 s, that it hasn't loaded).
// Each with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { LAPTOP_BOOT_CSS, LAPTOP_LOCK, LAPTOP_START, laptopBootHtml } from "../unlock/laptop-lock-words.ts";
import { LOAD_DEADLINE_MS, LOAD_LATE, withinDeadline } from "./laptop-load.ts";

let server: ViteDevServer;
let UnlockGate: ComponentType<Record<string, unknown>>;
let ProblemView: ComponentType<Record<string, unknown>>;
let Loading: ComponentType<Record<string, unknown>>;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  UnlockGate = (await server.ssrLoadModule("../unlock/UnlockGate.tsx")).UnlockGate;
  ProblemView = (await server.ssrLoadModule("@zerofee/shell-api/ProblemView.tsx")).ProblemView;
  Loading = (await server.ssrLoadModule("./LaptopLoading.tsx")).Loading;
});
after(async () => server?.close());

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
// a device that never answers: the first paint must not wait on it
const hung = { readRecord: () => new Promise(() => {}), vaults: () => new Promise(() => {}) };
const START = { heading: LAPTOP_START.what, next: LAPTOP_START.next };

test("the words, pinned (the design reviewer's finals, 5 Nov): one name everywhere, Add my laptop", () => {
  assert.equal(LAPTOP_START.what, "This page makes your laptop a second key for ZeroFee.");
  assert.equal(LAPTOP_START.next, "Next: tap Use this laptop. Then on your phone: ZeroFee, Security, Add my laptop.");
  assert.equal(LAPTOP_START.pairOn, "On your phone: ZeroFee, Security, Add my laptop.");
  assert.equal(LAPTOP_START.late, "NEAR didn't answer, so this laptop's key didn't load. Nothing changed on your phone.");
  assert.equal(LAPTOP_START.notLoaded, "This page hasn't loaded. Check your internet, then reload.");
  // no "…ing" line anywhere on the laptop's first screens, and the phone's button is named one way
  for (const line of Object.values(LAPTOP_START)) assert.doesNotMatch(line, /…|Second device|main device/, line);
  const page = readFileSync(new URL("./Laptop.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Security, Second device/, "the QR screen names Add my laptop too");
  assert.match(page, /\{LAPTOP_START\.pairOn\}/);
});

test("a bare visit: the first paint says what the page is and the next step, in the mount's own render (never after the device answers)", () => {
  // no wall clock (rule: no wall-clock tests; this flaked at 105.7 ms under load): the first render is one synchronous
  // pass over a device that never answers, so the words in it were painted without waiting on anything; the order is
  // the assertion (control below: the app's own lock, which waits, shows only its status line in the same render)
  const html = renderToStaticMarkup(createElement(UnlockGate, { device: hung, laptopWords: LAPTOP_LOCK, laptopStart: START }, createElement("p", null, "the laptop page")));
  const words = text(html);
  for (const line of [LAPTOP_START.what, LAPTOP_START.next, LAPTOP_LOCK.use]) assert.ok(words.includes(line), `${line} in "${words}"`);
  assert.match(html, /<h1 class="zf-title"[^>]*>This page makes your laptop a second key for ZeroFee\.<\/h1>/, "the heading says what the page is");
  assert.doesNotMatch(words, /Opening ZeroFee|…/, "never the endless Opening line, nor any …ing line, on the laptop");
  // Use this laptop waits for the storage read (a stuck one still ends on "taking too long" at OPEN_DEADLINE_MS)
  assert.match(html, /<button class="zf-btn" disabled="">Use this laptop<\/button>/);
  assert.doesNotMatch(words, /the laptop page/, "nothing behind the lock shows");
  // control: the app's own lock (no laptop words) still opens on its status line, and says none of the laptop's
  const app = text(renderToStaticMarkup(createElement(UnlockGate, { device: hung }, createElement("p", null, "app"))));
  assert.equal(app, "Opening ZeroFee…");
  for (const line of Object.values(START)) assert.ok(!app.includes(line), line);
});

test("while the laptop's key loads: the mark and the heading only, no sentence beside them", () => {
  const html = renderToStaticMarkup(createElement(Loading));
  assert.equal(text(html), LAPTOP_START.what);
  assert.match(html, /<h1 class="zf-title"/);
  // control: a bare mark (the old screen) would read as nothing
  assert.notEqual(text(html), "");
});

test("a load NEAR never answers ends as a named error with Try again, never an endless mark", async () => {
  assert.equal(LOAD_DEADLINE_MS, 15_000);
  const late = await withinDeadline(() => new Promise(() => {}), 20);
  assert.deepEqual(late, { problem: LOAD_LATE });
  const shown = text(renderToStaticMarkup(createElement(ProblemView, { problem: LOAD_LATE, onNext: () => {} })));
  assert.ok(shown.includes("NEAR didn't answer, so this laptop's key didn't load. Nothing changed on your phone."), shown);
  assert.match(shown, /Try again/);
  // control: an answer in time is the answer, not the error
  const ok = await withinDeadline(async () => ({ ok: { code: "c", fingerprint: "f", accounts: [] } }), 20);
  assert.deepEqual(ok, { ok: { code: "c", fingerprint: "f", accounts: [] } });
  // control: the core's own problem passes through as itself
  const own = { problem: { ...LOAD_LATE, code: "chain.down", whatHappened: "NEAR is slow right now." } };
  assert.deepEqual(await withinDeadline(async () => own, 20), own);
});

test("before its script runs, the page's HTML says what it is; 'hasn't loaded' shows only after 8 s (CSS, no inline script)", () => {
  const boot = laptopBootHtml();
  assert.ok(boot.startsWith('<div id="root">') && boot.endsWith("</div></div>"));
  assert.ok(text(boot).includes(LAPTOP_START.what));
  assert.ok(text(boot).includes(LAPTOP_START.notLoaded));
  assert.doesNotMatch(boot, /<script|on[a-z]+=/i, "the CSP allows no inline script");
  // the late line is hidden at first and shown after 8 s; control: the first line has no delay
  // (visibility, not opacity: a hidden line isn't read out by a screen reader before its time either)
  assert.match(LAPTOP_BOOT_CSS, /\.zf-boot-late\{visibility:hidden;animation:zf-boot-late 0s 8s forwards\}@keyframes zf-boot-late\{to\{visibility:visible\}\}/);
  assert.match(boot, /<p class="zf-boot-late" role="status">/);
  assert.match(boot, /<h1>This page makes your laptop a second key for ZeroFee\.<\/h1>/);
});
