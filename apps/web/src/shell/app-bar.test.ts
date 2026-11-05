// J2 (2 Nov): one obvious, named way between the apps. The shell's app bar names the apps in the bottom row, marks
// the one on screen, switches with one tap and the phone's light tap; the dots and the second bar at the bottom are gone
// (an app's sections are a segmented control at its top). Job 1: the tray holds every app (swipe up, hold to pin,
// swipe down); no Security app, no Apps app.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void; propsOf: (name: string) => Record<string, unknown> | undefined; renders: number; useRef: <T>(v: T) => { current: T } };
let AppHost: FunctionComponent<Record<string, unknown>>;
let barItems: (apps: { id: string; name: string }[]) => { id: string; label: string; icon: () => unknown }[];
let landing: (id: string, tab: string | undefined, pages: readonly string[]) => unknown;
let orderFor: (available: readonly string[], saved?: readonly string[] | null) => string[];
let moveItem: <T>(order: readonly T[], from: number, to: number) => T[];
let rowOf: (order: readonly string[]) => string[];
let barSlot: (at: number, pages: readonly string[], row: readonly string[]) => number;
let arrangeNote: (before: readonly string[], after: readonly string[], id: string, name: (id: string) => string) => string;
let pageOrder: (apps: readonly { id: string }[], row: readonly string[]) => { id: string }[];
let closesOnRelease: (dy: number, h: number, v: number) => boolean;
let useShell: () => { openApp: (id: string, tab?: string) => void };

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ AppHost, barItems, landing } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  ({ orderFor, moveItem, rowOf, barSlot, pageOrder, arrangeNote } = await server.ssrLoadModule("./shell/tray.ts"));
  ({ closesOnRelease } = await server.ssrLoadModule("@zerofee/design/Tray.tsx"));
  ({ useShell } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

/** A bridge that records what it is asked. */
function recording() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const bridge: Bridge = { call: async (method: string, params?: Record<string, unknown>) => (calls.push({ method, params }), { ok: { ok: true } }) as never, on: () => () => {} };
  return { bridge, calls };
}
// Job 1 (the spine), then Social Trading (product decision, 2 Nov): the bottom row is Home · Trade · Chat · Social Trading; the
// sites are inside Social Trading; the tray holds every app.
const PAGES = [["wallet", "Home"], ["trade", "Trade"], ["chat", "ZeroFee Chat"], ["social", "Browser"], ["site:trading", "Social trading"], ["site:jupiter", "Jupiter"]] as const;
const HUB = [["wallet", "Home"], ["trade", "Trade"], ["chat", "ZeroFee Chat"], ["social", "Social trading"], ["earn", "Earn"]] as const;

test("D147 (five since 3 Nov): the bottom row starts as Home, Trade, Browser, AgentZero, then the next; Chat is in the tray; no Security", () => {
  const all = ["wallet", "trade", "chat", "social", "agent", "earn", "perps", "predict"];
  assert.deepEqual(orderFor(all), ["wallet", "trade", "social", "agent", "chat", "earn", "perps", "predict"], "the default order (a build without pump.fun's app)");
  assert.deepEqual(rowOf(orderFor(all)), ["wallet", "trade", "social", "agent", "chat"], "the first five are the bottom row");
  // an order saved before, with site apps this build doesn't show: they are gone, so it keeps the rest, and what it
  // lacks joins in the default's order
  assert.deepEqual(orderFor(all, ["chat", "site:pump", "trade", "site:gmgn"]), ["chat", "trade", "wallet", "social", "agent", "earn", "perps", "predict"]);
  const src = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /AppSecurity|function Switcher|"More"/, "no Security icon, no switcher, no More");
});

test("each of the five tabs has its own icon (QA, 3 Nov: Browser and AgentZero shared the four tiles)", () => {
  const tabs = [["wallet", "Home"], ["trade", "Trade"], ["chat", "ZeroFee Chat"], ["social", "Browser"], ["agent", "AgentZero"]].map(([id, name]) => ({ id: id!, name: name! }));
  const icons = barItems(tabs).map((i) => i.icon);
  assert.equal(new Set(icons).size, 5, "five different icons");
  // control: an app the table doesn't know still gets the tiles, so the check can see a repeat
  assert.equal(new Set(barItems([...tabs, { id: "other", name: "Other" }, { id: "else", name: "Else" }]).map((i) => i.icon)).size, 6);
});

test("a drag moves an app to any place; the others close up; the bar is a straight view of the first five", () => {
  const order = ["wallet", "trade", "social", "agent", "chat", "earn", "perps", "predict"];
  assert.deepEqual(moveItem(order, 4, 1), ["wallet", "chat", "trade", "social", "agent", "earn", "perps", "predict"], "Chat from place 5 to place 2");
  assert.deepEqual(moveItem(order, 0, 7), ["trade", "social", "agent", "chat", "earn", "perps", "predict", "wallet"], "even Home moves (any icon, any place)");
  assert.deepEqual(moveItem(order, 2, 2), order, "dropped where it was: nothing moves");
  assert.deepEqual(rowOf(moveItem(order, 5, 0)), ["earn", "wallet", "trade", "social", "agent"], "a locked tile can sit in the bottom row");
  // the pages swipe in the order (never the locked tiles), then any the order lacks
  assert.deepEqual(pageOrder(PAGES.map(([id]) => ({ id })), ["wallet", "earn", "site:jupiter", "trade"]).map((a) => a.id), ["wallet", "site:jupiter", "trade", "chat", "social", "site:trading"]);
  // each drag says what it did to the row
  const name = (id: string) => ({ wallet: "Home", agent: "AgentZero", chat: "Chat", trade: "Trade", earn: "Earn" })[id] ?? id;
  const row = rowOf(order);
  assert.equal(arrangeNote(row, rowOf(moveItem(order, 5, 1)), "earn", name), "Earn took Chat's place in your bottom row.");
  assert.equal(arrangeNote(row, rowOf(moveItem(order, 1, 6)), "trade", name), "Trade left your bottom row. Earn is in it now.");
  assert.equal(arrangeNote(row, rowOf(moveItem(order, 1, 2)), "trade", name), "", "a move inside the row: the hint stays");
  // the bar's marker: the app's place in the row, between two while a page moves, none for an app outside it
  const pages = ["wallet", "trade", "social", "agent", "chat"];
  assert.equal(barSlot(1, pages, ["wallet", "earn", "trade", "social"]), 2, "a locked tile in the row moves the places after it");
  assert.equal(barSlot(1.5, pages, ["wallet", "earn", "trade", "social"]), 2.5);
  assert.equal(barSlot(4, pages, rowOf(order).slice(0, 4)), -1, "Chat is outside the row: no marker");
  assert.equal(barSlot(3.2, pages, rowOf(order).slice(0, 4)), 3, "leaving the row's last app: the marker stays until halfway");
  assert.equal(barSlot(4, pages, rowOf(order)), 4, "control: Chat fifth in a row of five has its marker");
});

test("Security's places open inside Home; pump.fun or GMGN named opens its page inside Social trading (S17); any other site, the Browser", () => {
  const ids = PAGES.map(([id]) => id);
  assert.deepEqual(landing("security", "protection", ids), { id: "wallet", tab: "security/protection" });
  assert.deepEqual(landing("security", undefined, ids), { id: "wallet", tab: "security" });
  assert.deepEqual(landing("security", "overview", ids), { id: "wallet", tab: "security" });
  assert.deepEqual(landing("social", "pump", ids), { id: "site:trading", tab: "pump" });
  assert.deepEqual(landing("social", "gmgn", ids), { id: "site:trading", tab: "gmgn" });
  assert.deepEqual(landing("social", "rhea", ids), { id: "social", tab: "rhea" }, "control: a site that isn't social trading stays in the Browser");
  assert.deepEqual(landing("social", "pump", ["wallet", "social"]), { id: "social", tab: "pump" }, "control: a build without Social trading, the Browser");
  assert.equal(landing("site:pump", undefined, ids), null, "control: no page of pump.fun's own");
  assert.deepEqual(landing("social", undefined, ids), { id: "social" });
  assert.equal(landing("social", undefined, ["wallet"]), "tray", "a build without it: the tray");
  assert.deepEqual(landing("trade", "home", ids), { id: "trade", tab: "home" });
  assert.equal(landing("earn", undefined, ids), null, "an app this build doesn't show");
});

test("the tray closes on a drag past a quarter of its height or a flick down; a short drag or a flick up keeps it", () => {
  assert.equal(closesOnRelease(150, 420, 0), true);
  assert.equal(closesOnRelease(60, 420, 0), false);
  assert.equal(closesOnRelease(40, 420, 900), true, "a flick down");
  assert.equal(closesOnRelease(200, 420, -900), false, "a flick back up");
});

test("one tap on a name switches to that app, marks it, and the phone gives its light tap; Apps opens the tray", async () => {
  const { bridge, calls } = recording();
  const page = (t: string) => () => createElement("p", null, t);
  const opener = () => createElement(function Opener() {
    const shell = useShell();
    return createElement("button", { onClick: () => shell.openApp("social") }, "OPEN-APPS");
  });
  // a build without the Browser: openApp("social") is the tray, as before
  const apps = PAGES.filter(([id]) => id !== "social").map(([id, name]) => ({ id, name, line: "", bridge, render: id === "trade" ? opener : page(`${id.toUpperCase()}-PAGE`) }));
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge }));
  let shown = runtime.text();
  assert.match(shown, /WALLET-PAGE/, "it opens on Home");
  assert.match(shown, /Home\nTrade\nSocial\nChat\nEarn\n/, "a build without Browser and AgentZero: the next in the order fill the row (S17: one Social trading, no site tiles)");
  assert.doesNotMatch(shown, /Jupiter/, "Jupiter is in the tray, not the row");
  runtime.press(/^Trade$/);
  await runtime.settle();
  assert.match(runtime.text(), /OPEN-APPS/, "Trade is one tap away");
  assert.deepEqual(calls.filter((c) => c.method === "device.haptic").map((c) => c.params?.kind), ["tap"], "one light tap for the switch");
  // control: tapping the app already on screen is no switch, and no tap is felt
  runtime.press(/^Trade$/);
  await runtime.settle();
  assert.equal(calls.filter((c) => c.method === "device.haptic").length, 1);
  // openApp("social") (an old "Apps" link): the tray, with every app; a tap there opens it
  runtime.press(/^OPEN-APPS$/);
  await runtime.settle();
  shown = runtime.text();
  assert.match(shown, /All apps[\s\S]*Jupiter[\s\S]*Hold and drag\. The top five are your bottom row\./);
  runtime.press(/^Jupiter$/);
  await runtime.settle();
  shown = runtime.text();
  assert.match(shown, /SITE:JUPITER-PAGE/);
  assert.doesNotMatch(shown, /All apps/, "the tray closed");
  runtime.unmount();
});

test("speed (D145): the app a switch goes to takes taps from the first frame of its slide; the one it leaves takes none (control: React's own values agree)", () => {
  const src = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  const go = src.slice(src.indexOf("const go = (target: number"), src.indexOf("const goRef = useRef(go);"));
  const at = go.indexOf("p.inert = i !== to;");
  assert.ok(at > 0 && at < go.indexOf("flight.current = slide("), "set in go(), before the slide's first frame");
  assert.ok(at < go.indexOf("if (now || reducedMotion())"), "and before the crossfade or the jump");
  assert.match(go, /p\.setAttribute\("aria-hidden", String\(i !== to\)\);/, "read aloud only the app it goes to");
  // control: React renders the same values at the commit, so nothing flips back
  assert.match(src, /<section ref=\{ref\} className="ah-page" aria-hidden=\{!here\} inert=\{!here\}>/);
});

test("speed (D145): every money sheet's code is asked for with the neighbours, after Home's first paint (control: never in the first render)", async () => {
  const src = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.match(src, /if \(near\) \{\s*for \(const a of apps\) a\.preload\?\.\(\);\s*preloadSheets\(\);/, "with the apps' own preload, once the neighbours join");
  const host = readFileSync(new URL("../../../../packages/wallet/src/app/money/MoneyHost.tsx", import.meta.url), "utf8");
  assert.match(host, /export const preloadSheets = \(\): void => \{\s*void sheetsLoaded\(\)\.catch\(\(\) => undefined\);\s*MoveSheet\.preload\(\);/, "Add, Swap, Send, Move's pots and Move");
  assert.equal((src.match(/preloadSheets\(\)/g) ?? []).length, 1, "control: asked in one place only, the neighbours' effect");
});

test("the bar marks the app on screen (aria-current and the marker's place) and is 44 pt per target", () => {
  const bar = readFileSync(new URL("../../../../packages/design/src/AppBar.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../../packages/design/src/appbar.css", import.meta.url), "utf8");
  assert.match(bar, /aria-current=\{i === current \? "page" : undefined\}/);
  assert.match(css, /\.zf-appbar__item \{[^}]*min-height: 44px/);
  assert.match(css, /\.zf-appbar__in \{[^}]*height: calc\(var\(--bar-h\) - 12px\)/, "the capsule is --bar-h tall, its 6 pt padding inside");
  assert.match(css, /\.zf-appbar \{[^}]*bottom: var\(--bar-gap\)/, "above the home indicator (the capsule, product decision, 4 Nov)");
});

test("no dots and no second bar at the bottom: an app's sections are a segmented control at its top", () => {
  const frame = readFileSync(new URL("../../../../packages/shell-api/src/AppFrame.tsx", import.meta.url), "utf8");
  const fund = readFileSync(new URL("../screens/FundStart.tsx", import.meta.url), "utf8");
  for (const src of [frame, fund]) assert.doesNotMatch(src, /af-dots|Show all apps/);
  assert.match(frame, /<header className="af-top">[\s\S]*<Segmented[\s\S]*<main className="af-main">/, "sections between the name and the content");
  assert.doesNotMatch(frame, /<nav className="af-tray"/);
});

test("smooth (product decision, 3 Nov): a switch's flight runs on the compositor, a fade in place (5 Nov), never a style written per frame; off-screen apps run no endless animation (controls)", () => {
  const src = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  const slide = readFileSync(new URL("./slide.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("./apphost.css", import.meta.url), "utf8");
  assert.match(src, /flight\.current = slide\(pos\.current, dest, to, \(\) => \{/, "the flight is the compositor's slide");
  assert.match(slide, /el\.animate\(\[\{ transform: at, opacity: 0, zIndex: 2 \}, \{ transform: at, opacity: 1, zIndex: 2 \}\]/, "the page you go to fades in, in place (product decision, 5 Nov: no swoosh)");
  assert.doesNotMatch(slide, /translate3d\(\$\{a \* o\.W\}px/, "no page sweeps across the screen");
  assert.match(slide, /m\.animate\(\[\{ transform: `translateX/, "the bar's marker too");
  assert.doesNotMatch(slide, /requestAnimationFrame|\.style\.transform\s*=/, "no frame loop and no style written per frame");
  assert.match(src, /const paint = \(\) => \{\s*if \(sliding\.current\) return;/, "paint() leaves the pages to the flight while it runs");
  assert.match(src, /return code\.fly\(\{/, "AppHost hands the flight to slide.ts");
  // control: the per-frame spring is gone from the shell's flights
  assert.doesNotMatch(src, /runSpring\(/);
  assert.match(css, /\.ah-page\[aria-hidden="true"\] \*, \.ah-page\[aria-hidden="true"\] \*::before, \.ah-page\[aria-hidden="true"\] \*::after \{ animation-play-state: paused !important; \}/);
});

test("the app bar is solid ground while pages move under it, its blur back at rest (speed worker, 3 Nov): one attribute at each end, never per frame", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../../packages/design/src/appbar.css", import.meta.url), "utf8");
  assert.match(host, /start: \(\) => \{ sliding\.current = true; moving\(true\); \}/, "a flight sets it as it begins");
  assert.match(host, /end: \(\) => \{ sliding\.current = false; moving\(false\); done\(\); \}/, "and clears it once landed");
  assert.match(host, /stop: \(at\) => \{ sliding\.current = false; moving\(false\);/, "or when stopped under a finger");
  assert.match(host, /d\.axis = "x";\n\s*moving\(true\);/, "a finger's drag sets it once caught");
  assert.doesNotMatch(host.slice(host.indexOf("const paint = () =>"), host.indexOf("const paint = () =>") + 1200), /moving\(/, "control: never from paint(), the per-frame path");
  assert.match(css, /\.ah\[data-moving\] \.zf-appbar \{ background: var\(--bar-solid\); -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
});

test("the capsule reacts (product decision, 4 Nov, YouTube's bar): the press gives the light tap, and the switch it makes no second; a tab with live work gets a dot, the one on screen none; the bar steps aside on a scroll and comes back on a switch", async () => {
  const { bridge, calls } = recording();
  const page = (t: string) => () => createElement("p", null, t);
  const apps = PAGES.filter(([id]) => id !== "social").map(([id, name]) => ({ id, name, line: "", bridge, render: page(`${id.toUpperCase()}-PAGE`) }));
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge }));
  const taps = () => calls.filter((c) => c.method === "device.haptic").length;
  let bar = runtime.propsOf("AppBar")!;
  (bar.onPress as (i: number) => void)(1);
  assert.equal(taps(), 1, "the light tap on the press itself");
  (bar.onPick as (i: number) => void)(1);
  await runtime.settle();
  assert.match(runtime.text(), /TRADE-PAGE/);
  assert.equal(taps(), 1, "the switch that press made is not felt twice");
  // control: a switch with no press first (a key, a screen reader's tap) is still felt once
  bar = runtime.propsOf("AppBar")!;
  (bar.onPick as (i: number) => void)(0);
  await runtime.settle();
  assert.equal(taps(), 2);
  // a quiet dot: Trade has a trade going; Home (on screen) has its own going, and no dot
  const store = (await server.ssrLoadModule("@zerofee/shell-api/tasks.ts")).taskStore();
  store.forApp("trade").publish({ id: "dot-1", title: "Buy", steps: [{ label: "Buy", state: "doing" }] });
  store.forApp("wallet").publish({ id: "dot-2", title: "Send", steps: [{ label: "Send", state: "doing" }] });
  await runtime.settle();
  let news = runtime.propsOf("AppBar")!.news as ReadonlySet<string>;
  assert.ok(news.has("trade") && !news.has("wallet"), `dots: ${[...news]}`);
  store.forApp("trade").end("dot-1", "done");
  store.forApp("wallet").end("dot-2", "done");
  await runtime.settle();
  news = runtime.propsOf("AppBar")!.news as ReadonlySet<string>;
  assert.equal(news.size, 0, "the dot goes when the work ends");
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /followScroll\(el, \(\) => bar\.current\)/, "the bar follows the pages' scroll");
});
