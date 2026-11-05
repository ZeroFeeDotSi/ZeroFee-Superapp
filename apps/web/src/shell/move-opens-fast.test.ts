// UI's mainnet rehearsal (3 Nov, real core): the Move sheet sat on "Reading your money…" for over 60 s with only Close,
// because the money host read Spending again from nothing and the core's read was slow. Now a money sheet opens at once
// on what Home read this session (never the copy kept on the phone: D134) and refines in place; after 2 s of a slow read
// it names it: "Your wallets are slow to answer. These figures are from 10:52."
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import { holdTimers } from "../testing/held-timers.ts";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let AppHost: FunctionComponent<Record<string, unknown>>;
let MoneyHost: FunctionComponent<Record<string, unknown>>;
let WalletProvider: FunctionComponent<Record<string, unknown>>;
let useWallet: () => { spending: { totalUsd: string } | null; spendingFresh: boolean };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let host: { SEEN_SLOW_MS: number; slowReadLine: (at: number) => string };
let AWAY_SLOW_MS: number;

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
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  const m = await server.ssrLoadModule("@zerofee/wallet/app/money/MoneyHost.tsx");
  MoneyHost = m.MoneyHost;
  host = { SEEN_SLOW_MS: m.SEEN_SLOW_MS, slowReadLine: m.slowReadLine };
  // the sheets' code is here before any mount: Move's own code still loading (its "Reading your money…" too) is never
  // what the test sees (a loaded gate, 5 Nov: Move's code came after the runtime had settled)
  await m.sheetsLoaded();
  ({ AWAY_SLOW_MS } = await server.ssrLoadModule("@zerofee/design/MoneySheet.tsx"));
  ({ WalletProvider, useWallet } = await server.ssrLoadModule("@zerofee/wallet/app/runtime.tsx"));
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

/** Spending as the core answers it (enough of it for the sheet's figures). */
const STATUS = { loaded: true, totalUsd: "172.54", cashUsd: "12.00", coinsUsd: "160.54", capUsd: "500.00", roomUsd: "327.46", reserveUsd: "12.00", ready: true, networks: [{ network: "sol", name: "Solana", cashUsd: "160.54", coinsUsd: "0.00", readyUsd: "159.54" }], onItsWay: [] };
/** The mock, with spending.status answering STATUS, or never once `slow` is on (the real core's read on a bad day). */
function core(): { bridge: Bridge; slow: () => void } {
  const inner = mockBridge();
  let slow = false;
  return {
    bridge: { call: ((m: string, p?: Record<string, unknown>) => (m === "spending.status" ? (slow ? new Promise(() => {}) : Promise.resolve({ ok: STATUS })) : inner.call(m, p))) as Bridge["call"], on: (e, h) => inner.on(e, h) },
    slow: () => (slow = true),
  };
}
const Probe = () => { const w = useWallet(); return `spending:${w.spending?.totalUsd ?? "none"} fresh:${w.spendingFresh}`; };
async function mountApp(appBridge: Bridge, render: () => unknown): Promise<void> {
  const apps = [{ id: "wallet", name: "Home", line: "", bridge: appBridge, render }];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: appBridge, start: { id: "wallet" } }), { limit: 150 });
  await runtime.settle();
}

test("Move opens at once on what Home already read this session, never \"Reading your money…\" while the read is slow (control: with nothing read on this bridge this session, it reads first)", async (t) => {
  // the sheets' slow-read timers (SEEN_SLOW_MS, AWAY_SLOW_MS) are held, never run on the wall clock: a loaded gate took
  // 18 s to mount and the control read "Your wallets didn't answer" (its 5 s line) before the test looked (5 Nov)
  t.after(holdTimers(Math.min(host.SEEN_SLOW_MS, AWAY_SLOW_MS)));
  // control first: nothing read yet on this bridge: the sheet waits for its read
  const c = core();
  c.slow();
  const cb = forApps(c.bridge, "wallet");
  await mountApp(cb, () => createElement(MoneyHost, { ask: { kind: "move" }, onEnd() {} }));
  assert.match(runtime.text(), /Reading your money…/, "control: nothing read this session, so it reads first");
  // Home reads Spending on its bridge (it answers) ...
  const h = core();
  const hb = forApps(h.bridge, "wallet");
  await mountApp(hb, () => createElement(WalletProvider, { bridge: hb }, createElement(Probe)));
  assert.match(runtime.text(), /^spending:172\.54 fresh:true/, runtime.text());
  // ... then the core's read turns slow, and Move opens on the same bridge: at once, on Home's figures
  h.slow();
  await mountApp(hb, () => createElement(WalletProvider, { bridge: hb }, createElement(Probe)));
  assert.match(runtime.text(), /^spending:172\.54 fresh:false/, `the sheet's own read hasn't answered, Home's figures are there: ${runtime.text()}`);
  await mountApp(hb, () => createElement(MoneyHost, { ask: { kind: "move" }, onEnd() {} }));
  assert.doesNotMatch(runtime.text(), /Reading your money…/, "opens at once, never waits on the slow read");
});

test("a late read says, after 2 s, when the figures are from, and never blames anyone as slow (rule 9a; control: the time is the read's own)", () => {
  assert.equal(host.SEEN_SLOW_MS, 2_000);
  const at = new Date(2026, 10, 3, 10, 52).getTime();
  assert.match(host.slowReadLine(at), /^These figures are from 10:52/);
  assert.doesNotMatch(host.slowReadLine(at), /slow|busy|answer/i, "nothing is down: no one is named slow");
  assert.match(host.slowReadLine(new Date(2026, 10, 3, 9, 5).getTime()), /9:05/, "control: another read's time");
});
