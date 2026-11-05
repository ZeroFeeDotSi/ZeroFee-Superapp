// Test findings (e2e fresh walk, 3 Nov), Social trading's two money sheets (packages/wallet money/SiteMoney.tsx):
// - 75: a $0.00 tile opened "Put money in pump.fun" with no way to open the site: putting money in is a choice on the
//   sheet, never a gate ("Open pump.fun" beside Move, back to the site through the hub);
// - 76: Take out moved "All of it" only and had no way back: one wallet now moves the amount picked (a slider and Max, the
//   least that lands said before the tap), and Back returns to the wallet sheet it came from.
// Each with a control.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import { backAmount, backLeast, SOL_KEEP } from "@zerofee/wallet/app/money/site-moves.ts";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (p: string) => readFileSync(ROOT + p, "utf8");
let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let SiteAddSheet: FunctionComponent<Record<string, unknown>>;
let SiteBackSheet: FunctionComponent<Record<string, unknown>>;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent", resolve: { alias: [{ find: /^react$/, replacement: fake }] }, server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] } });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  ({ SiteAddSheet, SiteBackSheet } = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx"));
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

const SITE = "sw-site-pump-sol";
/** 0.2 SOL at $150: $30.00. */
const UNITS = "200000000";
function bridgeWith(moves: Record<string, unknown>[]): Bridge {
  const inner = mockBridge();
  const wallets = [{ id: SITE, role: "site", site: "pump", network: "sol", address: "So1ana1111111111111111111111111111111111111", label: "pump.fun wallet", current: true, cashUsd: "30.00", units: UNITS }];
  return {
    call: ((m: string, p?: Record<string, unknown>) =>
      m === "spending.wallets" ? Promise.resolve({ ok: wallets })
        : m === "spending.status" ? Promise.resolve({ ok: { loaded: true, totalUsd: "0", cashUsd: "0", coinsUsd: "0", capUsd: "500", roomUsd: "500", ready: true, networks: [], onItsWay: [], firstTopUp: false } })
        : m === "subwallet.site.addCost" ? Promise.resolve({ ok: { feeUsd: 0.1 } })
        : m === "subwallet.site.moveBack" ? (moves.push(p ?? {}), Promise.resolve({ ok: { declined: true } }))
        : inner.call(m, p)) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
}
async function mount(bridge: Bridge, render: () => unknown): Promise<string> {
  const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render }];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
  await runtime.settle();
  await runtime.settle();
  return runtime.text();
}
const tap = async (l: RegExp) => { runtime.press(l); await runtime.settle(); await runtime.settle(); return runtime.text(); };

test("75: the $0.00 tile's sheet offers the site itself: \"Open pump.fun\" ends the sheet with open, and the hub opens the site", async () => {
  const opened: string[] = [];
  try {
    const shown = await mount(bridgeWith([]), () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", coins: [], onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {}, onOpenSite: () => opened.push("site") }));
    assert.match(shown, /Add \$[0-9.]+ to your pump\.fun wallet[\s\S]*Add \$10[\s\S]*Open pump\.fun/);
    assert.match(shown, /It goes through your NEAR wallet\. It takes 3–4 minutes\./, "never \"through Trading\", and never \"privately\" (audit H1)");
    await tap(/^Open pump\.fun$/);
    assert.deepEqual(opened, ["site"]);
  } finally { runtime.unmount(); }
  try {
    // an empty Safe: Add money first, and still the site
    const empty = await mount(bridgeWith([]), () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "0.00", coins: [], onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {}, onOpenSite() {} }));
    assert.match(empty, /Add money\nOpen pump\.fun/);
  } finally { runtime.unmount(); }
  try {
    const plain = await mount(bridgeWith([]), () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", coins: [], onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {} }));
    assert.doesNotMatch(plain, /Open pump\.fun/, "control: asked from inside the site (no onOpenSite), no button");
  } finally { runtime.unmount(); }
  // the wiring: MoneyHost ends with open, the hub opens the site on it, only from a tile
  assert.match(read("packages/wallet/src/app/money/MoneyHost.tsx"), /ask\.canOpen \? \{ onOpenSite: \(\) => onEnd\(\{ went: false, open: true \}\) \}/);
  const hub = read("packages/browser/src/social/SocialHub.tsx");
  assert.match(hub, /if \(!end\.went && end\.open\) setSite\(r\.site\);/);
  assert.match(hub, /if \(t\.kind === "add"\) return add\(r, undefined, true\);/);
});

test("76: Take out picks an amount: starts at $10 with the least that lands, Max is the whole; Move sends that share, Max sends \"all\"", async () => {
  const moves: Record<string, unknown>[] = [];
  try {
    const shown = await mount(bridgeWith(moves), () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {} }));
    // where it comes from and how much is there (product decision, 3 Nov), then Max
    assert.match(shown, /Take out to your Safe\n\$10\.00\nFrom your pump\.fun wallet · \$30\.00 available\nMax\nAt least \$9\.04 reaches your Safe, after fees\. Coins you bought stay in your pump\.fun wallet\./);
    const made = await tap(/^Take out \$10\.00$/);
    assert.equal(moves[0]?.amount, "66666666", "a third of 0.2 SOL, in lamports, rounded down");
    // QA's Sim test (item 7, rule 2): the tap makes the job, and the sheet stays on its receipt until Done
    assert.match(made, /\$10\.00\nJob created\.\nAbout 2 min left\.[\s\S]*Done/);
  } finally { runtime.unmount(); }
  try {
    // a new Take out, its sheet opened again: Max is the whole
    await mount(bridgeWith(moves), () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {} }));
    const max = await tap(/^Max$/);
    assert.match(max, /\$30\.00[\s\S]*At least \$28\.07 reaches your Safe/);
    await tap(/^Take out \$30\.00$/);
    assert.equal(moves[1]?.amount, "all", "Max: the core keeps its fee and moves the rest");
  } finally { runtime.unmount(); }
});

test("76: Back returns to the wallet sheet it came from; control: opened elsewhere (the site's window), no Back", async () => {
  const backs: string[] = [];
  try {
    await mount(bridgeWith([]), () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {}, onBack: () => backs.push("back") }));
    await tap(/^Back$/);
    assert.deepEqual(backs, ["back"]);
  } finally { runtime.unmount(); }
  try {
    assert.doesNotMatch(await mount(bridgeWith([]), () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {} })), /^Back$/m);
  } finally { runtime.unmount(); }
  assert.match(read("packages/wallet/src/app/money/MoneyHost.tsx"), /ask\.back \? \{ onBack: \(\) => onEnd\(\{ went: false, back: true \}\) \}/);
  const hub = read("packages/browser/src/social/SocialHub.tsx");
  assert.match(hub, /if \(!end\.went && end\.back\) setSheet\(r\.site\);/);
  assert.match(hub, /onClick=\{\(\) => \{ setSheet\(null\); back\(open, true\); \}\}>Take out<\/button>/);
});

test("76: the amount for the core: a share in lamports, or \"all\" at the most, when what stays is under Solana's keep, or with no units read", () => {
  assert.equal(backAmount(10, 30, UNITS), "66666666");
  assert.equal(backAmount(15, 30, UNITS), "100000000");
  assert.equal(backAmount(30, 30, UNITS), "all", "the most");
  assert.equal(backAmount(29.99, 30, UNITS), "all", "$0.01 left is 66,666 lamports, under the keep: the whole");
  assert.equal(backAmount(10, 30, undefined), "all", "no units read: only the whole can be said");
  assert.ok(BigInt(UNITS) - BigInt(backAmount(29.8, 30, UNITS)) >= SOL_KEEP, "control: a share that leaves the keep stays a share");
  // the least the sheet says: a $0.50 network allowance, the swap service's 3 %, then a 2 % floor (since D143 the core's
  // Move back has no sheet of its own to keep this in step with)
  assert.equal(backLeast(10).toFixed(2), "9.04");
  assert.equal(backLeast(0.4), 0, "never under $0");
});

test("the sheets' words: \"your … wallet\", never Trading, row or Hidden", () => {
  const src = read("packages/wallet/src/app/money/SiteMoney.tsx").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
  const shown = [...src.matchAll(/(["`])([^"`]*[A-Za-z][^"`]*)\1/g)].map((m) => m[2]!).filter((t) => / /.test(t));
  assert.deepEqual(shown.filter((t) => /\bTrading\b|\brow\b|\bHidden\b/.test(t)), []);
});
