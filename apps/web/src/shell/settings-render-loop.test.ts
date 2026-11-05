// Grade 01c, P1: tapping ☰ froze the app and grew memory without end. Settings made a new forApps(bridge, "browser")
// every render; the Sites rows keyed a memo and an effect on it, so each render read the sites again, the read set a new
// list, and that rendered again, for ever. Here Settings mounts on a stand-in React that runs effects (fake-react.ts)
// and must settle within a few renders and a few reads. The control mounts the same rows on a fresh bridge per render
// (the old bug's shape) and must be caught, so this test can fail for the reason that matters.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void };
let SettingsPanel: FunctionComponent<Record<string, unknown>>;
let ConnectedSiteRows: FunctionComponent<{ bridge: Bridge }>;
let forApps: (b: Bridge, app: "browser" | "wallet") => Bridge;

before(async () => {
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
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  SettingsPanel = (await server.ssrLoadModule("./shell/SettingsPanel.tsx")).SettingsPanel;
  ConnectedSiteRows = (await server.ssrLoadModule("@zerofee/browser/app/SiteRows.tsx")).ConnectedSiteRows;
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());

/** A shell bridge that counts every read; one site connected. */
function countingBridge() {
  const calls: string[] = [];
  const bridge: Bridge = {
    async call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      calls.push(`${method} ${String(params?.key ?? "")}`);
      if (method === "device.store.get" && params?.key === "wallet.connections") {
        return { ok: { value: JSON.stringify({ "pump.fun": { host: "pump.fun", chain: "solana", sinceIso: "2026-11-01T00:00:00Z" } }) } as T };
      }
      return { ok: { value: null } as T };
    },
    on: () => () => {},
  };
  return { bridge, calls };
}

test("Settings opens and settles: a few renders and a few reads of the sites, never a loop", async () => {
  const { bridge, calls } = countingBridge();
  const renders = await runtime.mount(createElement(SettingsPanel, { accountId: "zf-x.testnet", onClose: () => {}, logins: null, bridge }));
  runtime.unmount();
  const siteReads = calls.filter((c) => c.endsWith("wallet.connections")).length;
  assert.ok(renders <= 6, `Settings rendered ${renders} times`);
  assert.ok(siteReads >= 1 && siteReads <= 2, `the sites were read ${siteReads} times`);
});

test("forApps gives one wrapper per bridge and app, so a screen that calls it while rendering stays still", () => {
  const { bridge } = countingBridge();
  assert.equal(forApps(bridge, "browser"), forApps(bridge, "browser"));
  assert.notEqual(forApps(bridge, "browser"), forApps(bridge, "wallet"));
  assert.notEqual(forApps(bridge, "browser"), forApps(countingBridge().bridge, "browser"));
});

test("control: rows handed a new bridge every render (the 01c bug) are caught as a loop", async () => {
  const { bridge, calls } = countingBridge();
  const Loop = () => createElement(ConnectedSiteRows, { bridge: { call: bridge.call, on: bridge.on } });
  const renders = await runtime.mount(createElement(Loop), { limit: 60 });
  runtime.unmount();
  assert.equal(renders, 60, "the runtime must see the loop");
  assert.ok(calls.length > 20);
});
