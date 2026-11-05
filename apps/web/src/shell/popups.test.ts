// D146 (product decision, 3 Nov): a sheet belongs to the app that asked and shows only while it is on screen. Asked after the person
// left, it never shows; up when they leave, it is put away (nothing signed) and waits in the Activity centre as "Waiting
// for you", a tap there brings its app back with the sheet up again. The approve sheet too: leaving answers Not now.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let ApprovalSheet: FunctionComponent<Record<string, unknown>>;
let screenApp: (app: string) => void;
let screenMoney: (open: boolean) => void;
let useShell: () => { openMoney: (ask: unknown, onEnd?: (e: unknown) => void) => void; openApp: (id: string, tab?: string) => void };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let sheetsLoaded: () => Promise<unknown>;
let store: { list: () => { app: string; id: string; title: string; state: string; detail?: string; open?: { route?: string } }[] };

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
  ({ ApprovalSheet } = await server.ssrLoadModule("./shell/ApprovalSheet.tsx"));
  ({ screenApp, screenMoney } = await server.ssrLoadModule("./shell/screen-app.ts"));
  ({ useShell } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
  ({ sheetsLoaded } = await server.ssrLoadModule("@zerofee/wallet/app/money/MoneyHost.tsx"));
  store = (await server.ssrLoadModule("@zerofee/shell-api/tasks.ts")).taskStore();
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => { runtime?.unmount(); await server?.close(); });

/** Trade (its buttons ask for a sheet now, or keep its shell to ask later) and Home; every bridge call recorded. */
async function host() {
  const inner = mockBridge();
  const calls: string[] = [];
  const status = { loaded: true, totalUsd: "172.54", cashUsd: "140.00", coinsUsd: "32.54", capUsd: "500", roomUsd: "327.46", ready: true, networks: [], onItsWay: [], firstTopUp: false };
  const bridge: Bridge = { call: ((m: string, p?: Record<string, unknown>) => { calls.push(m); return m === "spending.status" ? Promise.resolve({ ok: status }) : inner.call(m, p); }) as never, on: (e, h) => inner.on(e, h) };
  const ends: unknown[] = [];
  let tradeShell: ReturnType<typeof useShell> | null = null;
  const trade = () => createElement(function TradePage() {
    const shell = useShell();
    tradeShell = shell;
    return createElement("div", null, createElement("button", { onClick: () => shell.openMoney({ kind: "topup" }, (e) => ends.push(e)) }, "ASK-SHEET"), "TRADE-PAGE");
  });
  const apps = [
    { id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render: () => createElement("p", null, "HOME-PAGE") },
    { id: "trade", name: "Trade", line: "", bridge: forApps(bridge, "trade"), render: trade },
  ];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "trade" } }), { limit: 80 });
  const settle = async () => { await sheetsLoaded(); for (let i = 0; i < 3; i++) await runtime.settle(); };
  return { calls, ends, settle, shell: () => tradeShell!, signed: () => calls.filter((m) => /^(tx\.|spending\.topUp|ledger\.toTrading|approval)/.test(m)) };
}
const SHEET = /Move to your NEAR wallet/;

test("control: asked on screen, the sheet shows over its own app", async () => {
  const h = await host();
  runtime.press(/^ASK-SHEET/);
  await h.settle();
  assert.match(runtime.text(), SHEET);
  runtime.unmount();
});

test("asked after the person left its app: it never shows, and the app hears it didn't go", async () => {
  const h = await host();
  runtime.press(/^Home$/);
  await h.settle();
  h.shell().openMoney({ kind: "topup" }, (e) => h.ends.push(e));
  await h.settle();
  assert.doesNotMatch(runtime.text(), SHEET, "never over Home");
  assert.deepEqual(h.ends, [{ went: false }]);
  runtime.unmount();
});

test("up when the person leaves: it's put away with nothing signed, waits in the Activity centre, and a tap there brings it back", async () => {
  const h = await host();
  runtime.press(/^ASK-SHEET/);
  await h.settle();
  assert.match(runtime.text(), SHEET);
  runtime.press(/^Home$/);
  await h.settle();
  assert.doesNotMatch(runtime.text(), SHEET, "gone from Home");
  assert.deepEqual(h.signed(), [], "nothing signed or moved");
  assert.deepEqual(h.ends, [{ went: false }], "Trade hears not now");
  const parked = store.list().find((t) => t.app === "trade" && t.title === "Move to your NEAR wallet");
  assert.ok(parked, "parked in the Activity centre");
  assert.equal(parked!.state, "pending");
  assert.match(parked!.detail ?? "", /^Waiting for you\. Nothing moved\./);
  // back to Trade by itself: the sheet stays put away (its task is the way back)
  runtime.press(/^Trade$/);
  await h.settle();
  assert.doesNotMatch(runtime.text(), SHEET, "control: coming back alone doesn't throw it up again");
  // the task's tap: its app, the sheet up again, the task gone
  runtime.press(/^Home$/);
  await h.settle();
  h.shell().openApp("trade", parked!.open!.route);
  await h.settle();
  assert.match(runtime.text(), /TRADE-PAGE/);
  assert.match(runtime.text(), SHEET, "up again on Trade");
  assert.equal(store.list().some((t) => t.id === parked!.id), false, "its task is gone");
  runtime.unmount();
});

test("the approve sheet: the person moving to another app answers it Not now (nothing signed); control: staying keeps it", async () => {
  const answers: unknown[] = [];
  const handlers: ((p: unknown) => void)[] = [];
  const bridge = { call: async (m: string, p: unknown) => { if (m === "approval.answer") answers.push(p); return { ok: null }; }, on: (e: string, h: (p: unknown) => void) => { if (e === "approval.needed") handlers.push(h); return () => {}; } };
  screenApp("trade");
  await runtime.mount(createElement(ApprovalSheet, { bridge }), { limit: 30 });
  for (const h of handlers) h({ id: "a1", words: { title: "Move $5.00 to your NEAR wallet", lines: [], warnings: [], effect: [] } });
  await runtime.settle();
  // the sheet's view loads with its first ask (the speed budget): settle until it is drawn, bounded, never a clock (a
  // full suite's load raced the one settle)
  for (let i = 0; i < 40 && !/Move \$5\.00 to your NEAR wallet/.test(runtime.text()); i++) await runtime.settle();
  assert.match(runtime.text(), /Move \$5\.00 to your NEAR wallet/);
  screenApp("trade");
  await runtime.settle();
  assert.deepEqual(answers, [], "control: the same app on screen, no answer");
  screenApp("wallet");
  await runtime.settle();
  assert.deepEqual(answers, [{ id: "a1", approve: false }], "Not now: nothing signed");
  assert.doesNotMatch(runtime.text(), /Move \$5\.00 to your NEAR wallet/, "never over the other app");
  runtime.unmount();
});

test("D146: an approve sheet asked by an app that isn't on screen never shows: answered Not now at once (controls: its own app shows; Spending's engine and ZeroFee's own screens show)", async () => {
  const answers: unknown[] = [];
  const handlers: ((p: unknown) => void)[] = [];
  const bridge = { call: async (m: string, p: unknown) => { if (m === "approval.answer") answers.push(p); return { ok: null }; }, on: (e: string, h: (p: unknown) => void) => { if (e === "approval.needed") handlers.push(h); return () => {}; } };
  screenApp("wallet");
  await runtime.mount(createElement(ApprovalSheet, { bridge }), { limit: 30 });
  const words = (title: string, asker?: string) => ({ title, lines: [], warnings: [], effect: [], ...(asker ? { asker } : {}) });
  for (const h of handlers) h({ id: "late", app: "browser", words: words("Add $10.00 to your pump.fun wallet", "browser") });
  await runtime.settle();
  assert.deepEqual(answers, [{ id: "late", approve: false }], "Not now: nothing signed");
  assert.doesNotMatch(runtime.text(), /pump\.fun wallet/, "never shown over Home");
  // Home's money sheet is up (Send): its Safe sheet shows
  screenMoney(true);
  for (const h of handlers) h({ id: "own", app: "wallet", words: words("Send $5.00", "wallet") });
  await runtime.settle();
  for (let i = 0; i < 40 && !/Send \$5\.00/.test(runtime.text()); i++) await runtime.settle();
  assert.match(runtime.text(), /Send \$5\.00/, "control: Home's own sheet, its money sheet up, shows");
  assert.equal(answers.length, 1);
  runtime.unmount();
  answers.length = 0;
  handlers.length = 0;
  await runtime.mount(createElement(ApprovalSheet, { bridge }), { limit: 30 });
  for (const h of handlers) h({ id: "relay", app: "trade", words: words("Move $25.00 to your NEAR wallet", "trade") });
  await runtime.settle();
  assert.match(runtime.text(), /Move \$25\.00 to your NEAR wallet/, "Spending's engine (Trade's bridge) asks for Home's open money sheet: it shows");
  assert.deepEqual(answers, []);
  runtime.unmount();
  screenMoney(false);
});

test("review M5: a Move's Safe sheet that arrives after its money sheet was put away (the person swiped to the Browser while the call was in flight) is answered Not now and never shown (control: the money sheet still up, it shows)", async () => {
  const answers: unknown[] = [];
  const handlers: ((p: unknown) => void)[] = [];
  const bridge = { call: async (m: string, p: unknown) => { if (m === "approval.answer") answers.push(p); return { ok: null }; }, on: (e: string, h: (p: unknown) => void) => { if (e === "approval.needed") handlers.push(h); return () => {}; } };
  screenApp("wallet");
  screenMoney(true);
  await runtime.mount(createElement(ApprovalSheet, { bridge }), { limit: 30 });
  // the person left for the Browser; AppHost put the Move away; the ledger's call was still in flight
  screenApp("browser");
  screenMoney(false);
  for (const h of handlers) h({ id: "late-move", app: "wallet", words: { title: "Move $40.00 from your Safe", lines: [], warnings: [], effect: [], asker: "wallet" } });
  for (const h of handlers) h({ id: "late-add", app: "trade", words: { title: "Move $10.00 to your NEAR wallet", lines: [], warnings: [], effect: [], asker: "trade" } });
  await runtime.settle();
  assert.deepEqual(answers, [{ id: "late-move", approve: false }, { id: "late-add", approve: false }], "both answered Not now: nothing signed");
  assert.doesNotMatch(runtime.text(), /Move \$40\.00|Move \$10\.00/, "never over the Browser");
  // control: back on Home with the money sheet up, the same ask shows
  screenApp("wallet");
  screenMoney(true);
  for (const h of handlers) h({ id: "on-time", app: "wallet", words: { title: "Move $40.00 from your Safe", lines: [], warnings: [], effect: [], asker: "wallet" } });
  await runtime.settle();
  assert.match(runtime.text(), /Move \$40\.00 from your Safe/);
  runtime.unmount();
  screenMoney(false);
});

test("a site window's late top-up ask is dropped once its app is off screen", () => {
  const src = readFileSync(fileURLToPath(new URL("../../../../packages/browser/src/social/SiteApp.tsx", import.meta.url)), "utf8");
  assert.match(src, /if \(!onScreen\.current\) return void bridge\.call\("device\.site\.money", \{ host, line: "Your money hasn't moved\." \}\);\n\s*shell\.openMoney\(\{ kind: "siteadd"/);
});
