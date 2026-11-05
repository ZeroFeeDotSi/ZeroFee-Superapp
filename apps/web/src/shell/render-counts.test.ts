// Speed (2 Nov): no render loops on the screens people sit on. Home (the hub with Wallet on screen), Wallet's own tabs and
// Apps mount on a stand-in React that runs effects (testing/fake-react.ts) against the sample-money bridge, and must
// settle within a few renders and a bounded number of reads. Settings has its own (settings-render-loop.test.ts). The
// control mounts the same Wallet under a parent that hands it a new bridge every render (the 01c bug's shape) and must
// be caught, so the bound can fail for the reason that matters.
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";
import { holdTimers } from "../testing/held-timers.ts";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; useState: <T>(v: T) => [T, (n: T) => void]; useEffect: (run: () => void, deps?: unknown[]) => void };
let ShellContext: { Provider: unknown };
let walletRoot: FunctionComponent;
let socialRoot: FunctionComponent;
let AppHost: FunctionComponent<Record<string, unknown>>;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let securityRows: FunctionComponent<Record<string, unknown>>;
let HomeSlotsContext: { Provider: unknown };
let ACCOUNT: unknown;

before(async () => {
  // The hub listens for arrow keys and times its neighbours on `window`: Node's global stands in for it.
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
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  walletRoot = (await server.ssrLoadModule("@zerofee/wallet/app/WalletApp.tsx")).walletApp.Root;
  // Home's readers (home-keep.ts) load at boot in the app; here, before the first mount
  await server.ssrLoadModule("@zerofee/wallet/app/home-keep.ts");
  socialRoot = (await server.ssrLoadModule("@zerofee/browser/social/SocialApp.tsx")).socialApp.Root;
  AppHost = (await server.ssrLoadModule("./shell/AppHost.tsx")).AppHost;
  securityRows = (await server.ssrLoadModule("./apps/security/SecurityApp.tsx")).SecurityRows;
  HomeSlotsContext = (await server.ssrLoadModule("@zerofee/shell-api/home-slots.ts")).HomeSlotsContext;
  ACCOUNT = { accountId: "sample.near", network: "mainnet", keys: [{ handle: "h1", role: "device", kind: "secure-chip", current: true }, { handle: "h2", role: "recovery" }], recovery: { delaySeconds: 172_800, pending: null } };
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());
// Each mount is judged at its first paint: every timer the screens set (Home's 2 s re-read, the neighbours' 1.5 s, a
// 150 ms or 300 ms one, each 1 s tick) is held, never run on the wall clock; only the runtime's own turns (0 ms) run. A
// loaded gate took 10 s to mount Home and its sub-second timers and ticks ran inside it: 31, then 43 reads (5 Nov).
let release = () => {};
beforeEach(() => { release = holdTimers(1, { intervals: true }); });
afterEach(() => release());

/** The sample bridge, counting every call. */
function counting(inner: Bridge) {
  const calls: string[] = [];
  const bridge: Bridge = {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      // one stored value per key (last total, last coins, a note): different reads, never one read asked again
      calls.push(method === "device.store.get" || method === "device.store.set" ? `${method}:${String(params?.key)}` : method);
      return inner.call<T>(method, params);
    },
    on: (event, handler) => inner.on(event, handler),
  };
  return { bridge, calls };
}

/**
 * The read bound, per trigger and never per elapsed window (no wall clock): each thing is read once on mount and again
 * only on a real change (`most`, at most 3 asks of one thing), and all the asks-again together stay few (`again`). How
 * many DIFFERENT things a screen reads (its lazy parts landing early or late on a loaded machine) is not the bound: a
 * loop is one read asked over and over, which these catch at any speed (control: the read-in-a-render-loop test).
 */
function readsWrong(calls: readonly string[], o: { distinct: number }): string | null {
  const per = Object.groupBy(calls, (c) => c);
  const most = Math.max(...Object.values(per).map((xs) => xs!.length));
  const distinct = Object.keys(per).length;
  const again = calls.length - distinct;
  if (most > 3) return `one read was asked ${most} times: ${calls.join(", ")}`;
  if (again > 6) return `${again} reads asked again: ${calls.join(", ")}`;
  if (distinct > o.distinct) return `${distinct} different reads: ${calls.join(", ")}`;
  return null;
}

const noop = () => {};
const shell = (bridge: Bridge, children: unknown) =>
  createElement(ShellContext.Provider as never, { value: { bridge, openApp: noop, showProblem: async () => ({ kind: "nothing", label: "OK" }), showWaiting: noop, openSwitcher: noop, openMenu: noop, active: true, index: 1, count: 3 } }, children as never);

test("Home: the hub with Wallet on screen settles in a few renders, and Wallet reads each thing a bounded number of times", async () => {
  const { bridge, calls } = counting(forApps(mockBridge(), "wallet"));
  // Home with Security inside it (Job 1): its rows and places come in through HomeSlots, as the shell hands them.
  const rows = () => createElement(securityRows, { account: ACCOUNT, bridge, open: noop });
  const apps = [
    { id: "wallet", name: "Home", line: "", bridge, render: () => createElement(HomeSlotsContext.Provider as never, { value: { rows } }, createElement(walletRoot)) },
    { id: "trade", name: "Trade", line: "", bridge, render: () => createElement("p", null, "TRADE-PAGE") },
    { id: "chat", name: "ZeroFee Chat", line: "", bridge, render: () => createElement("p", null, "CHAT-PAGE") },
  ];
  const renders = await runtime.mount(createElement(AppHost, { apps, onMenu: noop, shellBridge: bridge }), { limit: 60 });
  const shown = runtime.text();
  runtime.unmount();
  assert.ok(renders <= 15, `Home rendered ${renders} times`);
  assert.match(shown, /^Safe\n\$[\d,]+\.\d\d$/m, "Home is drawn: the Safe and its figure (D129)");
  // The app on screen renders alone first; its neighbours join later (NEIGHBOURS_AFTER_MS), never in the first paint.
  // (Their names are on the app bar: what must not be there is their pages.)
  assert.doesNotMatch(shown, /CHAT-PAGE|TRADE-PAGE/);
  assert.doesNotMatch(shown, /^Protection$/m, "the account's rows are behind the menu glyph, off the money screen (design review §1.1)");
  assert.match(shown, /Home\nTrade\nChat/, "the bottom row names its apps");
  assert.equal(readsWrong(calls, { distinct: 40 }), null);
});

test("Wallet alone (its Balance tab) settles in a few renders", async () => {
  const { bridge, calls } = counting(forApps(mockBridge(), "wallet"));
  const renders = await runtime.mount(shell(bridge, createElement(walletRoot)), { limit: 60 });
  const shown = runtime.text();
  runtime.unmount();
  assert.match(shown, /\$[\d,.]+[\s\S]*Add\nSend\nSwap\nMove[\s\S]*Safe\n\$[\d,.]+/i);
  assert.ok(renders <= 12, `Wallet rendered ${renders} times`);
  // No read is asked over and over (the real guard), counted per trigger, never per elapsed window
  assert.equal(readsWrong(calls, { distinct: 40 }), null);
});

test("Apps settles in a few renders", async () => {
  const { bridge, calls } = counting(forApps(mockBridge(), "social"));
  const renders = await runtime.mount(shell(bridge, createElement(socialRoot)), { limit: 60 });
  const shown = runtime.text();
  runtime.unmount();
  assert.ok(shown.length > 40, `Apps drew: ${shown.slice(0, 80)}`);
  assert.ok(renders <= 12, `Apps rendered ${renders} times`);
  assert.equal(readsWrong(calls, { distinct: 30 }), null);
});

test("control: Wallet under a parent that hands it a new bridge every render is caught as a loop", async () => {
  const inner = forApps(mockBridge(), "wallet");
  const Loop = () => shell({ call: inner.call, on: inner.on }, createElement(walletRoot));
  const renders = await runtime.mount(createElement(Loop), { limit: 60 });
  runtime.unmount();
  assert.equal(renders, 60, "the runtime must see the loop");
});

test("control: a read in a render loop (Wallet beside a part that reads its balances again on every render) fails the read bound", async () => {
  const { bridge, calls } = counting(forApps(mockBridge(), "wallet"));
  const { useState, useEffect } = runtime;
  const Rereads = () => {
    const [n, setN] = useState(0);
    // the regression's shape: no deps, so every render reads again and the answer renders again
    useEffect(() => { void bridge.call("ledger.balances").then(() => setN(n + 1)); });
    return createElement("p", null, `read ${n}`);
  };
  await runtime.mount(shell(bridge, createElement("div", null, createElement(walletRoot), createElement(Rereads))), { limit: 60 });
  runtime.unmount();
  assert.match(readsWrong(calls, { distinct: 40 }) ?? "", /^one read was asked \d+ times/, "the loop is caught by the per-trigger bound");
  // control of the control: the same Wallet without the loop passes
  const plain = counting(forApps(mockBridge(), "wallet"));
  await runtime.mount(shell(plain.bridge, createElement(walletRoot)), { limit: 60 });
  runtime.unmount();
  assert.equal(readsWrong(plain.calls, { distinct: 40 }), null);
});
