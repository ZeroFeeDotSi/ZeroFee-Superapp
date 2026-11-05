// Speed (D145): a money sheet's own Wallet runtime (MoneyHost's) starts from what Home's runtime on the same bridge has
// read, so Send, Swap and Move paint in their first frame instead of "Reading your money…" while the same reads run again.
// Mounted on the stand-in React (testing/fake-react.ts) against the sample-money bridge. Control: a runtime on another
// bridge (nothing read there yet) starts empty, and waits for its own reads.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void };
let WalletProvider: FunctionComponent<{ bridge: Bridge; children: ReactNode }>;
let useWallet: () => { spending: { totalUsd: string } | null; balances: unknown[] | null; chains: unknown[] };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;

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
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  const rt = await server.ssrLoadModule("@zerofee/wallet/app/runtime.tsx");
  WalletProvider = rt.WalletProvider;
  useWallet = rt.useWallet;
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());

/** The sample bridge, whose reads can be stopped from answering (a slow network): `hang` holds every call from then on. */
function slowable(inner: Bridge) {
  let hang = false;
  const bridge: Bridge = {
    call<T>(method: string, params?: Record<string, unknown>): Promise<BridgeResult<T>> {
      return hang ? new Promise<BridgeResult<T>>(() => {}) : inner.call<T>(method, params);
    },
    on: (event, handler) => inner.on(event, handler),
  };
  return { bridge, hang: () => { hang = true; } };
}

/** What a sheet's first render sees, and what it sees once settled. */
async function sheetSees(bridge: Bridge) {
  const seen: string[] = [];
  const Sheet = () => {
    const w = useWallet();
    seen.push(w.balances ? `coins ${w.balances.length}, networks ${w.chains.length}` : "reading");
    return createElement("p", null, "x");
  };
  await runtime.mount(createElement(WalletProvider, { bridge }, createElement(Sheet)), { limit: 60 });
  runtime.unmount();
  return { first: seen[0], last: seen[seen.length - 1] };
}

test("later(): a screen is drawn the moment its code is here, never behind Suspense; a failed load says so and the next open loads again (controls)", async () => {
  const { later } = await server.ssrLoadModule("@zerofee/wallet/app/later.tsx");
  const text = (runtime as unknown as { text: () => string }).text;
  const Screen = ({ who }: { who: string }) => createElement("p", null, `SCREEN ${who}`);
  let tries = 0;
  let fail = true;
  const L = later(
    () => { tries++; return fail ? Promise.reject(new Error("offline")) : Promise.resolve(Screen); },
    (p: { who: string }) => createElement("p", null, `WAIT ${p.who}`),
    (p: { who: string }) => createElement("p", null, `FAILED ${p.who}`),
  );
  await runtime.mount(createElement(L, { who: "a" }));
  assert.equal(text(), "FAILED a", "control: a load that failed says so, with the screen's own props");
  runtime.unmount();
  fail = false;
  const seen: string[] = [];
  const Watch = () => { const r = createElement(L, { who: "b" }); return r; };
  await runtime.mount(createElement(Watch));
  seen.push(text());
  runtime.unmount();
  assert.equal(tries, 2, "the next open loads again (a failure is never kept)");
  assert.equal(seen[0], "SCREEN b", "drawn once its code arrived");
  // once here, the screen is in the very first render: no wait at all
  await runtime.mount(createElement(L, { who: "c" }), { limit: 1 });
  assert.equal(text(), "SCREEN c");
  runtime.unmount();
  const { readFileSync } = await import("node:fs");
  const wallet = readFileSync(fileURLToPath(new URL("../../../../packages/wallet/src/app/WalletApp.tsx", import.meta.url)), "utf8");
  const add = readFileSync(fileURLToPath(new URL("../../../../packages/wallet/src/app/money/AddSheet.tsx", import.meta.url)), "utf8");
  assert.match(wallet, /const Activity = later</);
  assert.match(add, /const RequestSheet = later</);
  assert.doesNotMatch(wallet + add, /lazy\(\(\) => import\("\.\/(screens\/Activity|RequestSheet)\.tsx"\)/, "control: neither is a Suspense lazy any more");
});

test("speed (D145): an app whose module is already here draws in its first render, never through React.lazy (control: one not here yet still goes through lazy)", async () => {
  const { lazyApp } = await server.ssrLoadModule("./apps.ts");
  const text = (runtime as unknown as { text: () => string }).text;
  const App = () => createElement("p", null, "TRADE-APP");
  const m = lazyApp("trade", "Trade", "", async () => ({ id: "trade", name: "Trade", line: "", Root: App }));
  // not here yet: React.lazy (the stand-in React draws a lazy as nothing)
  await runtime.mount(createElement(m.Root), { limit: 1 });
  assert.equal(text(), "", "control: a module not here yet goes through lazy");
  runtime.unmount();
  m.preload();
  await new Promise((r) => setTimeout(r, 0));
  await runtime.mount(createElement(m.Root), { limit: 1 });
  assert.equal(text(), "TRADE-APP", "preloaded: drawn in the first render");
  runtime.unmount();
});

test("speed (D145): the Browser's page is drawn the same way, and its preload reads the start page ahead on idle (controls)", async () => {
  const { preloadBrowser } = await server.ssrLoadModule("./shell/home-apps.tsx");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(fileURLToPath(new URL("./home-apps.tsx", import.meta.url)), "utf8");
  assert.match(src, /const hub = readyLazy<\{ browser\?: Bridge \}>\(\(\) => import\("@zerofee\/browser\/social\/SocialApp\.tsx"\)\.then\(\(m\) => m\.HubRoot\)\);/);
  assert.doesNotMatch(src, /\blazy\(/, "control: no React.lazy left in the shell's pages");
  const asked: string[] = [];
  const browser: Bridge = { call: async <T,>(m: string) => { asked.push(m); return { ok: m === "device.store.get" ? { value: null } : [] } as BridgeResult<T>; }, on: () => () => {} };
  let preloaded = 0;
  preloadBrowser(() => { preloaded++; }, browser);
  assert.equal(preloaded, 1, "the app's own preload runs");
  for (let i = 0; i < 50 && asked.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(asked.length > 0, "the start page's lists were read ahead through the Browser's bridge");
  // control: no Browser bridge, nothing read
  const before = asked.length;
  preloadBrowser(undefined, undefined);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(asked.length, before);
});
