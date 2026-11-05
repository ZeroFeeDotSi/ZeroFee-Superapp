// D147 (product decision, 3 Nov, sharpened): in "All apps" a person holds any icon and drags it to any place, as on the
// iPhone's home screen; the first five places ARE the bottom row (five since 3 Nov), in that order; the order is kept on
// the phone. The default order is Home, Trade, Browser, AgentZero, pump.fun, then Chat, GMGN, Earn, Perps, Predict. Locked tiles move like the rest,
// and a tap on one (even in the bottom row) opens its "Coming soon" sheet. Haptics on lift and drop; Reduce Motion snaps.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void; pressNamed: (l: RegExp) => void; propsOf: (name: string) => Record<string, unknown> | undefined };
let AppHost: FunctionComponent<Record<string, unknown>>;
let nearestPlace: (rects: { left: number; top: number; width: number; height: number }[], x: number, y: number) => number;
let previewPlaces: (count: number, from: number, to: number) => number[];

/** This phone's storage (node has none): the order is kept here, and a restart reads it back. */
const disk = new Map<string, string>();
const session = new Map<string, string>();
const store = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
const had = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  Object.defineProperty(globalThis, "localStorage", { value: store(disk), configurable: true, writable: true });
  g.sessionStorage = store(session);
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
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  ({ nearestPlace, previewPlaces } = await server.ssrLoadModule("@zerofee/design/Tray.tsx"));
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  if (had) Object.defineProperty(globalThis, "localStorage", had);
  else delete (globalThis as Record<string, unknown>).localStorage;
  delete (globalThis as Record<string, unknown>).sessionStorage;
});

function recording() {
  const calls: { method: string; params?: Record<string, unknown> }[] = [];
  const bridge: Bridge = { call: async (method: string, params?: Record<string, unknown>) => (calls.push({ method, params }), { ok: { ok: true } }) as never, on: () => () => {} };
  return { bridge, calls };
}
const page = (t: string) => () => createElement("p", null, t);
const APPS = [["wallet", "Home"], ["trade", "Trade"], ["chat", "ZeroFee Chat"], ["social", "Browser"], ["agent", "AgentZero"]] as const;
const host = (bridge: Bridge) => createElement(AppHost, { apps: APPS.map(([id, name]) => ({ id, name, line: "", bridge, render: page(`${id.toUpperCase()}-PAGE`) })), onMenu: () => {}, shellBridge: bridge });
/** The bottom row's names, read from the bar (drawn before anything else of the shell's). */
const row = () => runtime.text().split("\n").filter((l) => /^(Home|Trade|Browser|AgentZero|Chat|Earn|Perps|Predict|pump\.fun|GMGN|Pay|Social)$/.test(l)).slice(0, 5);
/** The tray's names, in its order. */
const trayOrder = () => {
  const t = runtime.text();
  return t.slice(t.indexOf("All apps") + 9).split("\n").filter((l) => /^(Home|Trade|Browser|AgentZero|Chat|Earn|Perps|Predict|pump\.fun|GMGN|Pay|Social)$/.test(l));
};
async function until(re: RegExp) {
  for (let i = 0; i < 40 && !re.test(runtime.text()); i++) {
    await new Promise((r) => setTimeout(r, 50));
    await runtime.settle();
  }
}

test("the default (a build without pump.fun's app): Home, Trade, Browser, AgentZero, Chat in the bottom row; Earn, Perps, Predict after them", async () => {
  disk.clear();
  const { bridge } = recording();
  await runtime.mount(host(bridge));
  assert.deepEqual(row(), ["Home", "Trade", "Browser", "AgentZero", "Chat"]);
  runtime.pressNamed(/^All apps$/);
  await runtime.settle();
  assert.deepEqual(trayOrder(), ["Home", "Trade", "Browser", "AgentZero", "Chat", "Earn", "Perps", "Predict"]);
  runtime.unmount();
});

test("dragging from place 6 to place 2 puts it second in the bottom row, and the order survives a restart", async () => {
  disk.clear();
  const { bridge, calls } = recording();
  await runtime.mount(host(bridge));
  runtime.pressNamed(/^All apps$/);
  await runtime.settle();
  const tray = runtime.propsOf("Tray")!;
  // the lift: the phone's light tap
  (tray.onLift as () => void)();
  assert.deepEqual(calls.filter((c) => c.method === "device.haptic").map((c) => c.params?.kind).slice(-1), ["tap"], "a tap on lift");
  // the drop: Earn (place 6) lands on place 2
  (tray.onMove as (from: number, to: number) => void)(5, 1);
  await runtime.settle();
  assert.deepEqual(row(), ["Home", "Earn", "Trade", "Browser", "AgentZero"], "the bottom row is the first five, in order");
  assert.deepEqual(trayOrder(), ["Home", "Earn", "Trade", "Browser", "AgentZero", "Chat", "Perps", "Predict"], "the others closed up");
  assert.match(runtime.text(), /Earn took Chat's place in your bottom row\./, "the tray says what changed");
  assert.deepEqual(calls.filter((c) => c.method === "device.haptic").map((c) => c.params?.kind).slice(-1), ["success"], "a buzz on drop");
  assert.deepEqual(JSON.parse(disk.get("zf.tray.order")!), ["wallet", "earn", "trade", "social", "agent", "chat", "perps", "predict"], "kept on the phone");
  runtime.unmount();
  // a restart: the same order, read from the phone
  await runtime.mount(host(bridge));
  assert.deepEqual(row(), ["Home", "Earn", "Trade", "Browser", "AgentZero"], "after a restart");
  // a locked tile in the bottom row: a tap opens its "Coming soon" sheet, never an app
  runtime.press(/^Earn$/);
  await runtime.settle();
  await until(/Coming soon/);
  assert.match(runtime.text(), /Earn on your NEAR\.\nComing soon/);
  assert.match(runtime.text(), /WALLET-PAGE/, "Home stays on screen under it");
  runtime.unmount();
  // CONTROL: nothing kept (a new phone): the default row
  disk.clear();
  await runtime.mount(host(bridge));
  assert.deepEqual(row(), ["Home", "Trade", "Browser", "AgentZero", "Chat"]);
  runtime.unmount();
});

test("a drag of Chat into the row makes it a tab: a tap on it opens Chat; the app on screen stays through the drag", async () => {
  disk.clear();
  const { bridge } = recording();
  await runtime.mount(host(bridge));
  runtime.press(/^Trade$/);
  await runtime.settle();
  runtime.pressNamed(/^All apps$/);
  await runtime.settle();
  (runtime.propsOf("Tray")!.onMove as (from: number, to: number) => void)(4, 0);
  await runtime.settle();
  assert.deepEqual(row(), ["Chat", "Home", "Trade", "Browser", "AgentZero"]);
  assert.match(runtime.text(), /TRADE-PAGE/, "Trade is still on screen");
  runtime.pressNamed(/^Close$/); // the tray's grab bar closes it
  await runtime.settle();
  runtime.press(/^Chat$/);
  await runtime.settle();
  assert.match(runtime.text(), /CHAT-PAGE/, "Chat is one tap away from the bar");
  runtime.unmount();
});

const SITES = [...APPS, ["site:trading", "Social trading"]] as const;
/** The phone's device.store (a value per key, null when never kept) behind every other call's plain yes. */
function withStore(kept: Map<string, string>) {
  const { bridge, calls } = recording();
  const call = async (method: string, p: Record<string, unknown> = {}) => {
    if (method === "device.store.get") return { ok: { value: kept.get(String(p.key)) ?? null } };
    if (method === "device.store.set") return (kept.set(String(p.key), String(p.value)), { ok: { ok: true } });
    return bridge.call(method, p);
  };
  return { bridge: { ...bridge, call } as Bridge, calls };
}
const sitesHost = (bridge: Bridge, firstTray = false) => createElement(AppHost, { apps: SITES.map(([id, name]) => ({ id, name, line: "", bridge, render: page(`${id.toUpperCase()}-PAGE`) })), onMenu: () => {}, shellBridge: bridge, firstTray });

test("S17: ONE Social trading entry, fifth in the row; no pump.fun, GMGN or Pay tile; an order kept from before gains it fifth", async () => {
  disk.clear();
  const { bridge } = recording();
  await runtime.mount(sitesHost(bridge));
  assert.deepEqual(row(), ["Home", "Trade", "Browser", "AgentZero", "Social"], "the row says Social: the short name, a whole word");
  runtime.pressNamed(/^All apps$/);
  await runtime.settle();
  assert.deepEqual(trayOrder(), ["Home", "Trade", "Browser", "AgentZero", "Social", "Chat", "Earn", "Perps", "Predict"]);
  for (const gone of ["pump.fun", "GMGN", "Pay"]) assert.equal(trayOrder().includes(gone), false, `no ${gone} tile`);
  assert.equal(trayOrder().filter((n) => n === "Social").length, 1, "one entry");
  assert.match(runtime.text(), /Hold and drag\. The top five are your bottom row\./);
  runtime.unmount();
  // a person who arranged before (four in the row then): their four, and Social trading in the fifth place
  disk.set("zf.tray.order", JSON.stringify(["chat", "wallet", "trade", "social", "agent", "earn", "perps", "predict"]));
  await runtime.mount(sitesHost(bridge));
  assert.deepEqual(row(), ["Chat", "Home", "Trade", "Browser", "Social"]);
  runtime.unmount();
  // an order kept with pump.fun's and GMGN's old places: they are gone; Social trading takes the fifth place
  disk.set("zf.tray.order", JSON.stringify(["chat", "wallet", "trade", "social", "site:pump", "agent", "earn", "perps", "predict", "site:gmgn"]));
  await runtime.mount(sitesHost(bridge));
  assert.deepEqual(row(), ["Chat", "Home", "Trade", "Browser", "Social"]);
  runtime.unmount();
  // control: an order arranged since (Social trading in it, out of the row) is kept as it is
  disk.set("zf.tray.order", JSON.stringify(["chat", "wallet", "trade", "social", "agent", "site:trading", "earn", "perps", "predict"]));
  await runtime.mount(sitesHost(bridge));
  assert.deepEqual(row(), ["Chat", "Home", "Trade", "Browser", "AgentZero"]);
  runtime.unmount();
  disk.clear();
});

test("the P0 (3 Nov): the tray never opens by itself: not on the first open (the grab bar glows instead, once), not on an app switch; control: the person's tap opens it", async () => {
  disk.clear();
  const kept = new Map<string, string>();
  await runtime.mount(sitesHost(withStore(kept).bridge, true));
  await new Promise((r) => setTimeout(r, 150));
  await runtime.settle();
  assert.doesNotMatch(runtime.text(), /All apps\n/, "the first open: no tray");
  assert.equal(kept.get("tray.first-open"), "1", "the first open is kept");
  runtime.unmount();
  await runtime.mount(sitesHost(withStore(kept).bridge, true));
  await new Promise((r) => setTimeout(r, 150));
  await runtime.settle();
  assert.doesNotMatch(runtime.text(), /All apps\n/, "the second open: no tray");
  runtime.unmount();
  // a store that can't be read (the web before unlock): never the tray, never the glow
  await runtime.mount(sitesHost({ call: async () => ({ problem: { code: "x" } }) as never, on: () => () => {} } as never, true));
  await new Promise((r) => setTimeout(r, 150));
  await runtime.settle();
  assert.doesNotMatch(runtime.text(), /All apps\n/, "an unreadable store: no tray");
  runtime.unmount();
});

test("the drag's places: the nearest place to the finger, and the others make room in order", () => {
  // a 4-wide grid of 64 x 80 boxes
  const rects = [...Array(8).keys()].map((i) => ({ left: (i % 4) * 80, top: Math.floor(i / 4) * 100, width: 64, height: 80 }));
  assert.equal(nearestPlace(rects, 32, 40), 0);
  assert.equal(nearestPlace(rects, 115, 30), 1, "the second place, top row");
  assert.equal(nearestPlace(rects, 300, 160), 7);
  // icon 5 dragged to place 1: icons 1..4 each move one place on; 0, 6, 7 stay
  assert.deepEqual(previewPlaces(8, 5, 1), [0, 2, 3, 4, 5, 1, 6, 7]);
  assert.deepEqual(previewPlaces(8, 1, 5), [0, 5, 1, 2, 3, 4, 6, 7], "and back the other way");
  assert.deepEqual(previewPlaces(4, 2, 2), [0, 1, 2, 3], "no move: no one moves");
});

test("it moves on --ease-out, snaps under Reduce Motion, and the first row is marked as the bottom row", () => {
  const css = readFileSync(new URL("../../../../packages/design/src/tray.css", import.meta.url), "utf8");
  assert.match(css, /\.zf-tray__grid\.is-arranging \.zf-tray__app \{ transition: transform var\(--dur-base\) var\(--ease-out\)/, "the others slide on ease-out");
  assert.match(css, /\.zf-tray__grid\.is-arranging \.zf-tray__app\.is-lifted \{[^}]*transition: none; \}/, "the lifted icon follows the finger, no lag");
  assert.match(css, /\.zf-tray__app\.is-lifted \.zf-tray__icon \{ transform: scale\(1\.02\);/, "it lifts (2 % at most, 5 Nov)");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.zf-tray__grid\.is-arranging \.zf-tray__app, \.zf-tray__grid\.is-arranging \.zf-tray__app\.is-dropping, \.zf-tray__grid--arrange \.zf-tray__icon \{ transition: none; \}/, "Reduce Motion: snap");
  assert.match(css, /\.zf-tray__grid--arrange::before \{[^}]*height: 100px;/, "a soft band behind the first four");
  const tray = readFileSync(new URL("../../../../packages/design/src/Tray.tsx", import.meta.url), "utf8");
  assert.match(tray, /if \(reducedMotion\(\)\) done\(\);/, "Reduce Motion: the drop lands at once");
});
