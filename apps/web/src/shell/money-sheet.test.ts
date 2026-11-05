// The one money sheet (Job 1, criteria 4 and 6): Send, Top up, Put away, Buy, Sell, pay in Chat and a site's "Make
// ready" all use one sheet design (MoneySheet), opened in place over the app the person is in; no tap jumps into Wallet
// for money; the sheet says how much is where (B12); a send ends in one line, never a Done screen.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Code and on-screen words only (comments may name what was removed). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "testing" || name === "tools") continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** A jump into Wallet (or Pay) to move money: never, it is the one sheet in place (openMoney). */
const JUMP = /openApp\(\s*"(?:wallet"\s*,\s*"(?:send|receive|topup)"|pay")/;

test("no tap jumps apps for money: nothing opens Wallet's (or Pay's) Send, Add money or Top up with openApp", () => {
  const files = [...sources(join(ROOT, "packages")), ...sources(join(ROOT, "apps/web/src"))];
  const hits = files.filter((f) => JUMP.test(code(readFileSync(f, "utf8")))).map((f) => f.slice(ROOT.length));
  assert.deepEqual(hits, []);
});

test("only the money sheet and Trade say a line went (security review of Job 1, M1: no other code can draw 'Sent $500')", () => {
  const allowed = new Set(["packages/wallet/src/app/money/SendSheet.tsx", "packages/wallet/src/app/money/MoneyHost.tsx", "packages/wallet/src/app/money/SwapSheet.tsx", "packages/wallet/src/app/money/swap-follow.ts", "packages/wallet/src/app/screens/Spending.tsx", "packages/trade/src/app/TradeApp.tsx", "packages/trade/src/perps/PerpsTab.tsx" /* D119: Trade's Perps tab, its own trades' lines */, "packages/shell-api/src/money.ts", "packages/wallet/src/app/money/SiteMoney.tsx", "packages/wallet/src/app/screens/MoveSheet.tsx"]);
  const files = [...sources(join(ROOT, "packages")), ...sources(join(ROOT, "apps/web/src"))];
  // any mention, not only a call (perps review L3): a file handing sayWent on as a value is seen too
  const callers = files.filter((f) => /\bsayWent\b/.test(code(readFileSync(f, "utf8")))).map((f) => f.slice(ROOT.length));
  assert.deepEqual(callers.filter((f) => !allowed.has(f)), []);
  assert.ok(callers.includes("packages/wallet/src/app/money/SendSheet.tsx"), "control: the scan sees the real caller");
});

test("control: the jump scan finds a planted jump", () => {
  assert.ok(JUMP.test(`shell.openApp("wallet", "send", link)`));
  assert.ok(JUMP.test(`openApp("wallet", "topup")`));
  assert.ok(JUMP.test(`openApp("pay", "send")`));
  assert.ok(!JUMP.test(`openApp("wallet", "details")`), "seeing wallets is not moving money");
});

test("one sheet design: Top up, Put away, Send, Buy and Sell are each a MoneySheet with how much is where", () => {
  const spending = code(read("packages/wallet/src/app/screens/Spending.tsx"));
  for (const name of ["TopUpSheet", "PutAwaySheet"]) {
    const body = spending.slice(spending.indexOf(`export function ${name}(`), spending.indexOf("export function", spending.indexOf(`export function ${name}(`) + 10));
    assert.match(body, /<MoneySheet [^>]*pots=\{potsOf\(/, name);
  }
  assert.match(code(read("packages/wallet/src/app/money/SendSheet.tsx")), /<MoneySheet title="Send" pots=\{pots\}/);
  // the Buy and Sell page is a MoneySheet titled for its side (empty while it is the trade's moment and receipt)
  assert.match(code(read("packages/trade/src/app/screens/TradeSheet.tsx")), /<MoneySheet title=\{moment \? "" : `\$\{side === "buy" \? "Buy" : "Sell"\}/);
  // the apps ask for the one sheet: Chat's pay, a site's Make ready, Trade's Top up and Put away
  assert.match(code(read("packages/chat/src/app/ChatApp.tsx")), /shell\.openMoney\(\{ kind: "send"/);
  assert.match(code(read("packages/browser/src/social/SocialApp.tsx")), /shell\.openMoney\(\{ kind: "topup", usd: String\(READY_USD\) \}/);
  const trade = code(read("packages/trade/src/app/TradeApp.tsx"));
  assert.match(trade, /shell\.openMoney\(\{ kind: "topup" \}/);
  assert.match(trade, /shell\.openMoney\(\{ kind: "putaway" \}/);
  assert.doesNotMatch(trade, /setView\(\{ kind: "done", rec \}\)/, "a trade ends in one line, not a Done screen");
});

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let useShell: () => { openMoney: (ask: unknown) => void };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let sheetsLoaded: () => Promise<unknown>;

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
  ({ useShell } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
  ({ sheetsLoaded } = await server.ssrLoadModule("@zerofee/wallet/app/money/MoneyHost.tsx"));
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

test("Top up from Trade opens in place over Trade: the sheet says how much is where, Trade stays the app on screen", async () => {
  const inner = mockBridge();
  // Spending as its engine answers (the demo routes it to the Trade reader; a bare mock has none)
  const status = { loaded: true, totalUsd: "172.54", cashUsd: "140.00", coinsUsd: "32.54", capUsd: "500", roomUsd: "327.46", ready: true, networks: [], onItsWay: [], firstTopUp: false };
  const mock: Bridge = { call: (m: string, p?: Record<string, unknown>) => (m === "spending.status" ? Promise.resolve({ ok: status }) : inner.call(m, p)) as never, on: (e, h) => inner.on(e, h) };
  // Which app is on screen, as the shell tells each app (AppContext.active), not whether its page is in the tree: the
  // shell also mounts the neighbours (Home among them, NEIGHBOURS_AFTER_MS after start, or after the reveal), so Home's
  // page being there says nothing (3 Nov: under the full suite's load the neighbour mount came first and this failed).
  const onScreen = { trade: false, home: false, homeEver: false };
  const opener = () => createElement(function TradePage() {
    const shell = useShell();
    onScreen.trade = shell.active;
    return createElement("div", null,
      createElement("button", { onClick: () => shell.openMoney({ kind: "topup" }) }, "TRADE-TOP-UP"),
      createElement("button", { onClick: () => (shell as unknown as { openApp: (id: string) => void }).openApp("wallet") }, "TRADE-GO-HOME"));
  });
  const home = () => createElement(function HomePage() {
    const shell = useShell();
    onScreen.home = shell.active;
    onScreen.homeEver ||= shell.active;
    return createElement("p", null, "HOME-PAGE");
  });
  const apps = [
    { id: "trade", name: "Trade", line: "", bridge: forApps(mock, "trade"), render: opener },
    { id: "wallet", name: "Home", line: "", bridge: forApps(mock, "wallet"), render: home },
  ];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: mock, start: { id: "trade" } }), { limit: 80 });
  runtime.press(/^TRADE-TOP-UP$/);
  // the Move sheet's code loads after Home (speed budget): the wait is on its own load, never a clock
  await sheetsLoaded();
  await runtime.settle();
  await runtime.settle();
  // the money host's own reads (two nodes for the Safe: home/reads H1) answer in turns, never on a clock: settle until
  // its figures are in (bounded), so the full suite's load can't race them
  for (let i = 0; i < 40 && !/Wallets\s+\$/.test(runtime.text()); i++) await runtime.settle();
  const shown = runtime.text();
  assert.match(shown, /Move to your NEAR wallet/, "one verb for this move (design review §7); home/words: never Trading");
  assert.match(shown, /Safe\s+\$[\d,]+\.\d\d[\s\S]*Wallets\s+\$[\d,]+\.\d\d/, "how much is where (B12)");
  assert.match(shown, /TRADE-TOP-UP/, "Trade is still the page under it");
  assert.equal(onScreen.trade, true, "Trade is the app on screen, the sheet over it");
  assert.equal(onScreen.homeEver, false, "no jump to Home: Home was never the app on screen");
  // control: a real jump (Trade opening Home) is caught by the same probe
  runtime.press(/^TRADE-GO-HOME$/);
  await runtime.settle();
  assert.equal(onScreen.home, true, "control: a jump to Home shows Home as the app on screen");
  runtime.unmount();
});
