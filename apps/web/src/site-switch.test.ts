// The public site's Sim | Real switch above the phone (product decision, 4 Nov), and its × on the web line's sibling rule:
// one switch, the side the page is in selected, a tap on the other side switches; only where WEB_MODES is on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SITE_SIDES, mountSiteSwitch, siteSides } from "./site-switch.ts";
import { WEB_MODES, type WebMode } from "./mode.ts";
import { clearedOnStartAgain } from "./unlock/clear-keys.ts";
import { simKey } from "./sim-storage.ts";
import { WEB_LINE_HIDDEN_KEY, hideWebLine, webLineHidden } from "@zerofee/shell-api/web-wallet-words.ts";

type El = { tag: string; className: string; type: string; textContent: string; attrs: Record<string, string>; kids: El[]; click?: () => void; setAttribute(k: string, v: string): void; addEventListener(e: string, f: () => void): void; append(c: El): void };
function fakeDoc() {
  const el = (tag: string): El => ({
    tag, className: "", type: "", textContent: "", attrs: {}, kids: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(e, f) { if (e === "click") this.click = f; },
    append(c) { this.kids.push(c); },
  });
  const before: El[] = [];
  const root = { before: (b: El) => void before.push(b) };
  const doc = { createElement: el, documentElement: { dataset: {} as Record<string, string> }, getElementById: (id: string) => (id === "root" ? root : null), body: { prepend: () => assert.fail("goes before #root") } };
  return { doc: doc as unknown as Document, before, html: doc.documentElement };
}
const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("two sides, Sim and Real (Settings' words), the page's own side selected; control: the other mode flips it", () => {
  assert.deepEqual(SITE_SIDES.map((s) => [s.mode, s.label]), [["sim", "Sim"], ["web", "Real"]]);
  assert.deepEqual(siteSides(true).map((s) => s.on), [true, false]);
  assert.deepEqual(siteSides(false).map((s) => s.on), [false, true], "control: in Real, Real is on");
});

test("a tap on the other side switches with switchWebMode's mode; a tap on the side already on does nothing", () => {
  const { doc, before, html } = fakeDoc();
  const went: WebMode[] = [];
  mountSiteSwitch(doc, true, (m) => void went.push(m));
  assert.equal(before.length, 1, "drawn once, before the app's root");
  const bar = before[0]!;
  assert.equal(bar.className, "zf-site-switch");
  assert.equal(bar.attrs.role, "group");
  assert.equal(bar.attrs["aria-label"], "Money");
  assert.equal("siteSwitch" in html.dataset, true, "the page knows it has the switch (app.css makes room for it)");
  const [sim, real] = bar.kids;
  assert.deepEqual([sim!.textContent, sim!.attrs["aria-pressed"], real!.textContent, real!.attrs["aria-pressed"]], ["Sim", "true", "Real", "false"]);
  assert.equal(sim!.type, "button");
  sim!.click!();
  assert.deepEqual(went, [], "control: Sim is already on");
  real!.click!();
  assert.deepEqual(went, ["web"], "Real is the web wallet (mode.ts parseMode)");
  const r = fakeDoc();
  mountSiteSwitch(r.doc, false, (m) => void went.push(m));
  r.before[0]!.kids[0]!.click!();
  assert.deepEqual(went, ["web", "sim"]);
});

test("only where WEB_MODES is on (never the extension or the phone app); the Sim pill's link is gone", () => {
  const main = src("./main.tsx");
  assert.match(main, /if \(WEB_MODES\) void import\("\.\/site-switch\.ts"\)\.then\(\(m\) => m\.mountSiteSwitch\(document, SIM\), \(\) => undefined\);/);
  assert.ok(main.indexOf('if (WEB_MODES) document.documentElement.dataset.siteSwitch = "";') > 0 && main.indexOf("dataset.siteSwitch") < main.indexOf('import("./site-switch.ts")'), "its room kept before its code arrives");
  assert.doesNotMatch(main, /^import .*site-switch/m, "loaded only on the public site, never in the phone build's first load");
  assert.ok(main.indexOf("mountSiteSwitch(document") > main.indexOf("if (!EXTENSION_BUILD) {"), "inside the site's own branch, never the extension's");
  assert.ok(main.indexOf("mountSiteSwitch(document") > main.indexOf("async function startPublic"), "the public build only");
  assert.equal(WEB_MODES, false, "control: under node (no public build) there is no switch");
  const mark = src("./shell/ModeMark.tsx");
  assert.doesNotMatch(mark, /otherMode|zf-mode-mark__go/);
});

test("the switch sits above the phone on a computer and above the app on a phone, never over the app's top bar; mint on the side that is on", () => {
  const css = src("./app.css");
  assert.match(css, /\.zf-site-switch button\[aria-pressed="true"\] \{ background: var\(--mint, #2ee6a6\); color: var\(--on-mint, #04140e\);/);
  assert.match(css, /@media \(max-width: 599\.98px\) \{[\s\S]*?\.zf-site-switch \{ margin: calc\(env\(safe-area-inset-top, 0px\) \+ 6px\) auto 6px; height: 36px; \}\n {2}html\[data-site-switch\] #root \{ height: calc\(100dvh - 48px - env\(safe-area-inset-top, 0px\)\); \}/, "a phone: a 48 px strip under the status bar, the app under it (web6: one band)");
  assert.match(css, /\.zf-site-switch \{ position: fixed; z-index: 1; left: 0; right: 0; top: max\(32px, calc\(50vh - var\(--fit, 1\) \* 438px - 56px\)\); \}/);
  assert.match(css, /body \{ display: grid; place-items: center; min-height: 100vh; grid-template-rows: 100vh; overflow: hidden; \}/, "the frame centred on 50vh in a short window too");
  assert.match(src("./main.tsx"), /VITE_ZEROFEE_PUBLIC === "1" && !EXTENSION_BUILD \? 176 : 48;/, "the frame leaves 88 px above it for the name and the switch");
});

test("the web line's ×: kept closed in this browser, shared by Sim and Real, cleared by Start again; a store that throws shows the line", () => {
  const kv = new Map<string, string>();
  const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
  assert.equal(WEB_LINE_HIDDEN_KEY, "zf.web.lineHidden");
  assert.equal(webLineHidden(store), false, "control: shown until closed");
  hideWebLine(store);
  assert.equal(kv.get(WEB_LINE_HIDDEN_KEY), "1");
  assert.equal(webLineHidden(store), true);
  kv.set(WEB_LINE_HIDDEN_KEY, "0");
  assert.equal(webLineHidden(store), false, "control: only the kept mark hides it");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(webLineHidden(broken), false);
  assert.doesNotThrow(() => hideWebLine(broken));
  assert.equal(webLineHidden(null), false);
  assert.equal(simKey(WEB_LINE_HIDDEN_KEY), WEB_LINE_HIDDEN_KEY, "Sim reads Real's key: closed in one, closed in both");
  assert.equal(simKey("zf.web.other"), "sim:zf.web.other", "control: other keys stay Sim's own");
  assert.equal(clearedOnStartAgain(WEB_LINE_HIDDEN_KEY), true, "Start again shows it again");
});
