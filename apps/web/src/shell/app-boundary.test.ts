// One app throwing must not blank the superapp (security review, Low). The AppHost wraps each app in an AppBoundary: a
// Root that throws shows the Problem screen "shell.app.crashed" for that app only, with no error text, and its "Try again"
// mounts the app afresh; Wallet (and any other app) beside it renders as before. React's server renderer has no error
// boundaries, so the test plays React's part: render each app; on a throw, hand the error to the boundary the way React
// does (getDerivedStateFromError, then render with that state). TSX loads through vite's own loader, as in the other
// shell tests.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

type Boundary = { state: { crashed: boolean; attempt: number }; setState(f: (s: { crashed: boolean; attempt: number }) => { crashed: boolean; attempt: number }): void; render(): ReactNode };
type BoundaryClass = { new (p: { name: string; children: ReactNode }): Boundary; getDerivedStateFromError(e: unknown): { crashed: boolean } };

let server: ViteDevServer;
let AppBoundary: BoundaryClass;
let walletRoot: ComponentType;
let ShellContext: { Provider: unknown };
let walletBridge: unknown;
before(async () => {
  server = await createServer({ configFile: false, root: import.meta.dirname, logLevel: "silent", server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  AppBoundary = (await server.ssrLoadModule("./AppBoundary.tsx")).AppBoundary;
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  const { forApps } = await server.ssrLoadModule("@zerofee/core/bridge");
  walletBridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 0 }), "wallet");
  walletRoot = (await server.ssrLoadModule("@zerofee/wallet/app/WalletApp.tsx")).walletApp.Root;
});
after(async () => server?.close());

/** What React does with one app inside its boundary. */
function show(name: string, Root: ComponentType, crashes = { count: 0 }): { html: string; boundary: Boundary } {
  const boundary = new AppBoundary({ name, children: createElement(Root) });
  boundary.setState = (f) => { boundary.state = f(boundary.state); };
  try {
    return { html: renderToStaticMarkup(createElement(Root)), boundary };
  } catch (e) {
    crashes.count++;
    Object.assign(boundary.state, AppBoundary.getDerivedStateFromError(e));
    return { html: renderToStaticMarkup(boundary.render() as never), boundary };
  }
}

const Throws = () => { throw new Error("secret stack detail 0xDEADBEEF"); };
const Fine = () => createElement("p", null, "chat is fine");

test("an app whose Root throws shows the shell Problem for that app only; the app beside it renders normally", () => {
  const chat = show("ZeroFee Chat", Throws);
  assert.match(chat.html, /ZeroFee Chat stopped working\./);
  assert.match(chat.html, /Try again/);
  assert.match(chat.html, /in your Safe/);
  assert.doesNotMatch(chat.html, /secret stack|DEADBEEF|Error/);
  const other = show("Pay", Fine);
  assert.equal(other.html, "<p>chat is fine</p>");
  // The Wallet beside the crashed app renders its own frame, inside its own boundary, on the sample-money bridge.
  const noop = () => {};
  const WalletInShell = () => createElement(ShellContext.Provider as never, { value: { bridge: walletBridge, openApp: noop, showProblem: async () => ({ kind: "nothing", label: "OK" }), showWaiting: noop, openSwitcher: noop, openMenu: noop, active: true, index: 0, count: 2 } }, createElement(walletRoot));
  const crashed = { count: 0 };
  const wallet = show("Wallet", WalletInShell, crashed);
  assert.equal(crashed.count, 0, "Wallet must not crash");
  assert.doesNotMatch(wallet.html, /stopped working/);
  assert.ok(wallet.html.length > 200);
  assert.match(chat.html, /ah-crashed/);
});

test("Try again mounts the app afresh (a new key, crashed cleared)", () => {
  const { boundary } = show("ZeroFee Chat", Throws);
  assert.equal(boundary.state.crashed, true);
  const before = boundary.state.attempt;
  const el = boundary.render() as { props: { children: { props: { onNext: () => void } } } };
  el.props.children.props.onNext();
  assert.equal(boundary.state.crashed, false);
  assert.equal(boundary.state.attempt, before + 1);
  assert.equal((boundary.render() as { key: string }).key, String(before + 1));
});

test("the AppHost puts every app inside its own AppBoundary", () => {
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /<AppBoundary name=\{app\.name\}>[^\n]*app\.render\(\)[^\n]*<\/AppBoundary>/);
});

test("shell.app.crashed is catalogued in apps/web/errors.md", () => {
  assert.ok(readFileSync(new URL("../../errors.md", import.meta.url), "utf8").includes("`shell.app.crashed`"));
});

// QA's MUST (Sim crawl, 5 Nov): a deploy's missing chunk showed "Trade stopped working." until a hand reload.
test("a missing chunk under an open page reloads it once and draws no error first; the next one on the same build shows the Problem (control: any other crash shows it at once, no reload)", async () => {
  const cr = await server.ssrLoadModule("@zerofee/shell-api/chunk-reload.ts");
  const m = new Map<string, string>();
  let reloads = 0;
  const deps = { storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }, now: () => 5_000, build: () => "/assets/index-AAA.js", reload: () => void reloads++, native: () => false, busy: () => false, settled: () => Promise.resolve() };
  cr.resetChunkReload();
  cr.setChunkReloadDeps(deps);
  const ChunkGone = () => { throw new TypeError("Failed to fetch dynamically imported module: https://app.zerofee.si/assets/TradeApp-x.js"); };
  // control: a crash that isn't a chunk
  assert.match(show("Trade", Throws).html, /Trade stopped working\./);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reloads, 0);
  const gone = show("Trade", ChunkGone);
  assert.equal(gone.html, "", "no error flashes before the reload");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reloads, 1);
  // the reloaded page, still on the same build within the window: the normal Problem, no second reload
  cr.resetChunkReload();
  cr.setChunkReloadDeps(deps);
  assert.match(show("Trade", ChunkGone).html, /Trade stopped working\./);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reloads, 1);
  cr.resetChunkReload();
});

// Audit 12 C1: offline, Trade's code didn't arrive; the page reloaded with no network and Chrome's "No internet" page took
// the app. Offline the boundary says the app's own words, never reloads, and remounts the app once the phone is back.
test("offline, an app whose code didn't arrive says the app's offline words and never reloads (control: online it reloads once)", async () => {
  const cr = await server.ssrLoadModule("@zerofee/shell-api/chunk-reload.ts");
  const m = new Map<string, string>();
  let reloads = 0, on = false;
  cr.resetChunkReload();
  cr.setChunkReloadDeps({ storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }, now: () => 5_000, build: () => "/assets/index-AAA.js", reload: () => void reloads++, native: () => false, online: () => on, busy: () => false, settled: () => Promise.resolve() });
  const ChunkGone = () => { throw new TypeError("Failed to fetch dynamically imported module: https://app.zerofee.si/assets/TradeApp-x.js"); };
  const off = show("Trade", ChunkGone).html;
  assert.match(off, /You&#x27;re offline\. Your money is safe\. Trade opens when you&#x27;re back\./);
  assert.doesNotMatch(off, /stopped working/);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reloads, 0, "offline: no reload into Chrome's page");
  on = true;
  assert.equal(show("Trade", ChunkGone).html, "", "control: online, it reloads and draws nothing first");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reloads, 1);
  cr.resetChunkReload();
  const src = readFileSync(new URL("./AppBoundary.tsx", import.meta.url), "utf8");
  assert.match(src, /whenOnline\(\(\) => \{ this\.stopWaiting = null; this\.retry\(\); \}\)/, "back online, it mounts the app afresh");
  const apps = readFileSync(new URL("../apps.ts", import.meta.url), "utf8");
  assert.match(apps, /loading = null; Later = fresh\(\);/, "and the app's code is asked for again (React keeps a failed lazy as failed)");
});

// Audit 12 C1, the shot: a load still in flight when the phone went offline left Trade's page blank (Suspense's fallback
// was nothing). Offline, the fallback says the same words; online it is nothing (the code arrives in ms).
test("offline, an app whose code is still on its way says the offline words, not a blank page (control: online, nothing)", async () => {
  const cr = await server.ssrLoadModule("@zerofee/shell-api/chunk-reload.ts");
  const { AppWaiting } = await server.ssrLoadModule("./AppBoundary.tsx");
  let on = false;
  cr.resetChunkReload();
  cr.setChunkReloadDeps({ online: () => on, storage: null });
  try {
    assert.match(renderToStaticMarkup(createElement(AppWaiting, { name: "Trade" })), /You&#x27;re offline\. Your money is safe\. Trade opens when you&#x27;re back\./);
    on = true;
    assert.equal(renderToStaticMarkup(createElement(AppWaiting, { name: "Trade" })), "", "control: online, nothing");
  } finally { cr.resetChunkReload(); }
  const host = readFileSync(new URL("./AppHost.tsx", import.meta.url), "utf8");
  assert.match(host, /<Suspense fallback=\{<AppWaiting name=\{app\.name\} \/>\}>/);
});
