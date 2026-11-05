// a-nine (5 Nov): the bar lights the app a screen was opened from (a back link), until a tap or a Back. Set-up as app-bar.test.ts.
// J2 (2 Nov): one obvious, named way between the apps. The shell's app bar names the apps in the bottom row, marks
// the one on screen, switches with one tap and the phone's light tap; the dots and the second bar at the bottom are gone
// (an app's sections are a segmented control at its top). Job 1: the tray holds every app (swipe up, hold to pin,
// swipe down); no Security app, no Apps app.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
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
let useShell: () => { openApp: (id: string, tab?: string, link?: string) => void };

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

test("Home opens Trade's coin page with a back link: the bar stays on Home; a tap on Trade marks Trade; Back returns to Home (control: no link marks Trade)", async () => {
  const { bridge } = recording();
  const mark = () => (runtime.propsOf("AppBar") as { current: number }).current;
  const home = () => createElement(function H() {
    const shell = useShell();
    return createElement("div", null,
      createElement("button", { onClick: () => shell.openApp("trade", undefined, "back=wallet") }, "OPEN-COIN"),
      createElement("button", { onClick: () => shell.openApp("trade") }, "OPEN-PLAIN"),
      createElement("p", null, "HOME-PAGE"));
  });
  const trade = () => createElement(function T() {
    const shell = useShell();
    return createElement("button", { onClick: () => shell.openApp("wallet") }, "BACK");
  });
  const apps = [["wallet", "Home", home], ["trade", "Trade", trade], ["chat", "ZeroFee Chat", () => createElement("p", null, "C")]].map(([id, name, render]) => ({ id: id as string, name: name as string, line: "", bridge, render: render as () => unknown }));
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge }));
  assert.equal(mark(), 0, "Home on open");
  runtime.press(/^OPEN-PLAIN$/);
  await runtime.settle();
  assert.equal(mark(), 1, "control: opened with no back link, Trade is marked");
  runtime.press(/^BACK$/);
  await runtime.settle();
  assert.equal(mark(), 0);
  runtime.press(/^OPEN-COIN$/);
  await runtime.settle();
  assert.match(runtime.text(), /BACK/, "Trade's page is on screen");
  assert.equal(mark(), 0, "...and the bar still lights Home, the app it came from");
  runtime.press(/^Trade$/);
  await runtime.settle();
  assert.equal(mark(), 1, "a tap on a tab marks the tapped app");
  runtime.press(/^BACK$/);
  await runtime.settle();
  assert.equal(mark(), 0, "Back is on Home with Home marked");
  runtime.press(/^OPEN-COIN$/);
  await runtime.settle();
  runtime.press(/^BACK$/);
  await runtime.settle();
  assert.equal(mark(), 0, "Back from the linked screen: Home marked");
  runtime.unmount();
});
