// Product decision, 3 Nov: three more apps in the tray, locked: Earn, Perps, Predict. An icon with a small lock and the
// name; a tap opens a "Coming soon" sheet (the shared Sheet, D135), never the app, and none of their code loads. The
// grab bar glows now and then (once about 1 s after the app opens, then every 24 s) until the tray is opened once.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void; pressNamed: (l: RegExp) => void; hasClass: (c: string) => boolean };
let AppHost: FunctionComponent<Record<string, unknown>>;
let LOCKED_APPS: { id: string; label: string; locked?: boolean }[];
let SoonSheet: FunctionComponent<Record<string, unknown>>;
let SOON_LINES: Record<string, string>;

/** This tab's session storage (node has none). */
const session = new Map<string, string>();

// every wait here is bounded (review, 4 Nov: a stuck run of this file jammed the landing train)
before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  g.sessionStorage = { getItem: (k: string) => session.get(k) ?? null, setItem: (k: string, v: string) => void session.set(k, v), removeItem: (k: string) => void session.delete(k) };
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    // its own cache: a dev server running in the same worktree shares apps/web/node_modules/.vite, and this server then
    // waited on it forever (4 Nov: the stuck runs that jammed the train)
    cacheDir: mkdtempSync(join(tmpdir(), "tray-locked-vite-")),
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  ({ LOCKED_APPS, SoonSheet, SOON_LINES } = await server.ssrLoadModule("./shell/locked-apps.tsx"));
}, { timeout: 60_000 });
after(async () => {
  runtime?.unmount();
  await server?.close();
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

function recording() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const bridge: Bridge = { call: async (method: string, params?: Record<string, unknown>) => (calls.push({ method, params }), { ok: { ok: true } }) as never, on: () => () => {} };
  return { bridge, calls };
}
const page = (t: string) => () => createElement("p", null, t);
/** A build's apps (D147's default row: Home, Trade, Browser, AgentZero; Chat in the tray), and any `extra` (a real Earn
 *  under `?all`). */
function build(bridge: Bridge, extra: [string, string][] = []) {
  return [["wallet", "Home"], ["trade", "Trade"], ["social", "Browser"], ["agent", "AgentZero"], ["chat", "ZeroFee Chat"], ...extra]
    .map(([id, name]) => ({ id, name, line: "", bridge, render: page(`${id.toUpperCase()}-PAGE`) }));
}
/** Settles until `re` shows (the locked tiles' module loads on its own turn), at most ~15 s: on a loaded machine the
 *  module's first load took over 2 s and marked main red (4 Nov, eight landings paused). Still bounded. */
async function until(re: RegExp) {
  for (let i = 0; i < 300 && !re.test(runtime.text()); i++) {
    await new Promise((r) => setTimeout(r, 50));
    await runtime.settle();
  }
}
async function openTray(bridge: Bridge, extra: [string, string][] = []) {
  await runtime.mount(createElement(AppHost, { apps: build(bridge, extra), onMenu: () => {}, shellBridge: bridge, start: { id: "trade" } }));
  // the bar's grab bar. On a loaded machine the first press can land before the bar's handler is wired (4 Nov: the
  // tray stayed shut, "TRADE-PAGE\nHome…" with no "All apps", and stopped a landing train): press again while it is
  // still shut, then wait for the locked tiles' own module. Bounded, as every wait here.
  for (let i = 0; i < 300 && !/All apps\n/.test(runtime.text()); i++) {
    if (i % 20 === 0) runtime.pressNamed(/^All apps$/);
    await new Promise((r) => setTimeout(r, 50));
    await runtime.settle();
  }
  await until(/Hold and drag\./);
}

/** A sheet falls on close (Sheet.tsx FALL_MS, 280 ms) before its host takes it away. */
const fallen = async () => { await new Promise((r) => setTimeout(r, 330)); await runtime.settle(); };

test("the tray holds Earn, Perps and Predict, locked, in the order; a tap opens the coming-soon sheet, never the app", { timeout: 30_000 }, async () => {
  session.clear();
  const { bridge, calls } = recording();
  await openTray(bridge);
  assert.match(runtime.text(), /All apps\nHome\nTrade\nBrowser\nAgentZero\nChat\nEarn\nPerps\nPredict\nHold and drag\. The top five are your bottom row\./, "the default order (D147), three locked tiles in it");
  assert.ok(runtime.hasClass("zf-tray__app--locked") && runtime.hasClass("zf-tray__lock"), "each with its lock mark");
  assert.deepEqual(LOCKED_APPS.map((a) => [a.label, a.locked]), [["Earn", true], ["Perps", true], ["Predict", true]]);
  const methods = calls.length;
  runtime.press(/^Earn$/);
  await runtime.settle();
  await until(/Coming soon/);
  const shown = runtime.text();
  assert.doesNotMatch(shown, /All apps/, "the tray closed for the sheet");
  assert.match(shown, /Earn\nEarn on your NEAR\.\nComing soon$/, "the coming-soon sheet is up: no full stop in its label, no Close pill");
  assert.ok(runtime.hasClass("zf-sheet"), "the shared full-screen sheet");
  assert.match(shown, /TRADE-PAGE/, "the app on screen stays under it");
  assert.doesNotMatch(shown, /EARN-PAGE/, "no Earn app opened");
  assert.equal(calls.length, methods, "nothing asked of the core");
  runtime.pressNamed(/^Close$/); // the sheet's corner ✕, by its aria-label
  await fallen();
  assert.doesNotMatch(runtime.text(), /Coming soon/, "Close closes it");
  assert.match(runtime.text(), /TRADE-PAGE/, "back on the app it came from");
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  // the sheet loads after the first paint or on the tap (speed-budget.test.ts, NEVER_FIRST), and no app code with it
  assert.match(host, /const lockedApps = \(\) => import\("\.\/locked-apps\.tsx"\);/);
  const mod = readFileSync(new URL("./locked-apps.tsx", import.meta.url), "utf8") + readFileSync(new URL("./locked-tiles.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(mod + host, /@zerofee\/(earn|perps)|\/perps\/|\/predict\//, "no real Earn, Perps or Predict code");
  runtime.unmount();
});

test("CONTROL: an app the build does show (a real Earn under ?all) is its own tile, and a tap opens it", { timeout: 30_000 }, async () => {
  session.clear();
  const { bridge } = recording();
  await openTray(bridge, [["earn", "Earn"]]);
  assert.match(runtime.text(), /All apps\nHome\nTrade\nBrowser\nAgentZero\nChat\nEarn\nPerps\nPredict\n/, "Earn once, as the real app; Perps and Predict still locked");
  runtime.press(/^Earn$/);
  await runtime.settle();
  assert.match(runtime.text(), /EARN-PAGE/, "the real one opens");
  assert.doesNotMatch(runtime.text(), /Coming soon/);
  runtime.unmount();
});

test("the coming-soon sheet: icon, name, one line, Coming soon, and one way out (the corner Close, D135); the words for each", { timeout: 30_000 }, async () => {
  assert.deepEqual(SOON_LINES, { earn: "Earn on your NEAR.", perps: "Confidential perps. Trade with leverage, in private.", predict: "Trade on what happens next." });
  for (const app of LOCKED_APPS) {
    let closed = 0;
    await runtime.mount(createElement(SoonSheet, { id: app.id, onClose: () => closed++ }));
    assert.equal(runtime.text(), `${app.label}\n${SOON_LINES[app.id]}\nComing soon`, "no full stop in the spaced-capital label, no Close pill");
    assert.ok(runtime.hasClass("zf-sheet") && runtime.hasClass("soon__icon"), "the shared full-screen sheet, with the icon");
    assert.ok(!runtime.hasClass("zf-btn"), "one way out: the corner Close, no second button");
    runtime.pressNamed(/^Close$/); // the corner ✕, by its aria-label
    assert.equal(closed, 0, "the sheet falls first (FALL_MS)");
    await fallen();
    assert.equal(closed, 1, "Close closes it");
    runtime.unmount();
  }
  for (const line of Object.values(SOON_LINES)) assert.ok(line.split(" ").length < 12 && !/please|!|error|we can/i.test(line));
});

test("the grab bar glows from the start, and stops once the tray has been opened this session", { timeout: 30_000 }, async () => {
  session.clear();
  const { bridge } = recording();
  await runtime.mount(createElement(AppHost, { apps: build(bridge), onMenu: () => {}, shellBridge: bridge, start: { id: "trade" } }));
  assert.ok(runtime.hasClass("zf-appbar__all--hint"), "on at start");
  runtime.pressNamed(/^All apps$/);
  await runtime.settle();
  assert.ok(!runtime.hasClass("zf-appbar__all--hint"), "off once the tray opened");
  runtime.unmount();
  await runtime.mount(createElement(AppHost, { apps: build(bridge), onMenu: () => {}, shellBridge: bridge }));
  assert.ok(!runtime.hasClass("zf-appbar__all--hint"), "still off in the same session");
  runtime.unmount();
  // CONTROL: a new session (nothing remembered) glows again
  session.clear();
  await runtime.mount(createElement(AppHost, { apps: build(bridge), onMenu: () => {}, shellBridge: bridge }));
  assert.ok(runtime.hasClass("zf-appbar__all--hint"), "a new session glows again");
  runtime.unmount();
});

test("the hint is CSS only (product decision, 5 Nov): the All apps button nudges 1 px once (about 600 ms), about 1 s after open then every 30 s; transform and opacity only; a still dot under Reduce Motion", { timeout: 30_000 }, () => {
  const css = readFileSync(new URL("../../../../packages/design/src/appbar.css", import.meta.url), "utf8");
  const rule = css.match(/\.zf-appbar__all--hint span \{ animation: zf-hint (\d+)s (\d+(?:\.\d+)?)s var\(--ease-out\) infinite; \}/);
  assert.ok(rule, "the hint animation on the button's bar");
  const [, period, delay] = rule!.map(Number);
  assert.ok(period === 30, `every ${period} s`);
  assert.ok(delay! >= 0.5 && delay! <= 1.5, `first about 1 s in (${delay} s)`);
  const keys = css.match(/@keyframes zf-hint \{[\s\S]*?\n\}/)![0];
  assert.doesNotMatch(keys, /box-shadow|background|filter|width|height|top|left|opacity/, "transform only");
  assert.match(keys, /1% \{ transform: translateY\(-1px\); \}/, "up 1 px, once");
  assert.match(keys, /0%, 2%, 100% \{ transform: none; \}/, "back: the nudge is 2% of 30 s = 600 ms");
  assert.doesNotMatch(css, /zf-appbar--glow|zf-beckon/, "control: the old glow is gone");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.zf-appbar__all--hint span \{ animation: none; \}\n  \.zf-appbar__all--hint span::after \{ opacity: 1; \}/, "a still dot");
  assert.match(css, /\.zf-appbar__grab span::after \{[^}]*width: 4px; height: 4px;[^}]*background: var\(--mute\)/);
});
