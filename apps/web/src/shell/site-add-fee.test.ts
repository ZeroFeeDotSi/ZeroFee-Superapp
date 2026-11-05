// ST3 (QA's rule: a fee figure only from a real quote, never a fixed or bounded number): the Browser's "Put money in"
// sheet says "About $X in fees." only when the core's two dry 1Click quotes put the Add's cost over 2 % of it; under 2 %
// nothing; before the quote is back "Fees show once the swap service gives a price."; the price never signs, moves or
// raises a sheet; only the money sheet (Wallet's bridge) and the Browser tab may ask it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let AppHost: FunctionComponent<Record<string, unknown>>;
let SiteAddSheet: FunctionComponent<Record<string, unknown>>;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let FEE_WAIT_LINE: string;

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
  ({ SiteAddSheet, FEE_WAIT_LINE } = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx"));
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
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const COINS = [{ tokenId: USDC, symbol: "USDC", usd: "30.00", amount: "30" }];
/** Anything that signs, sends, moves or answers a sheet: never asked while the sheet prices an Add. */
const MOVES = /^(spending\.(topUp|putAway|makeReady)|subwallet\.(sign|signTx|signMessage|send|site\.moveBack|float\.(out|in|home|swap)$)|tx\.|approval\.|ledger\.(send|toTrading|swap))/;

/** The mock, with the price answered by `cost` (a figure, a Problem, or never); every method asked is kept. */
function priced(cost: number | "never" | "down"): { bridge: Bridge; asked: { method: string; p: Record<string, unknown> | undefined }[] } {
  const inner = mockBridge();
  const asked: { method: string; p: Record<string, unknown> | undefined }[] = [];
  const bridge: Bridge = {
    call: ((method: string, p?: Record<string, unknown>) => {
      asked.push({ method, p });
      if (method !== "subwallet.site.addCost") return inner.call(method, p);
      if (cost === "never") return new Promise(() => {});
      if (cost === "down") return Promise.resolve({ problem: { code: "security.partner.unreachable", whatHappened: "1Click didn't answer.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" }, service: "oneclick" } } as BridgeResult<never>);
      return Promise.resolve({ ok: { feeUsd: cost, legsUsd: [0, cost] } });
    }) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
  return { bridge, asked };
}

async function sheet(bridge: Bridge, props: Record<string, unknown> = {}): Promise<string> {
  const render = () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", coins: COINS, onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {}, ...props });
  const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render }];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
  await runtime.settle();
  return runtime.text();
}

test("ST3: over 2 % the sheet says the cost from the quote; under 2 % nothing (control); never a sign, a move or a sheet", async () => {
  for (const [fee, line] of [[0.31, "About $0.31 in fees."], [0.21, "About $0.21 in fees."], [0.2, null], [0.12, null]] as const) {
    const { bridge, asked } = priced(fee);
    try {
      const shown = await sheet(bridge);
      assert.match(shown, /Add \$[0-9.]+ to your pump\.fun wallet/);
      const lines = shown.split("\n");
      if (line) assert.ok(lines.includes(line), `$${fee} on $10: "${line}"\n${shown}`);
      else assert.ok(!lines.some((l) => / in fees\.$/.test(l)), `$${fee} on $10 (2 % or less): no fee line\n${shown}`);
      assert.ok(!lines.includes(FEE_WAIT_LINE), "the quote is back: no waiting line");
      // the price was asked for this wallet, these dollars and the Safe's coin that pays, by Wallet's bridge (the money sheet)
      const ask = asked.find((a) => a.method === "subwallet.site.addCost");
      assert.deepEqual(ask?.p, { id: SITE, usd: "10.00", tokenId: USDC, app: "wallet" });
      assert.deepEqual(asked.filter((a) => MOVES.test(a.method)).map((a) => a.method), [], "nothing signs or moves");
    } finally {
      runtime.unmount();
    }
  }
});

test("ST3: no quote yet (1Click slow), the Safe's coins not read, or 1Click down: its own line, never a made-up figure", async () => {
  // slow: the price is on its way, its seconds counted; the Safe unread: the waiting line; the relay saying 1Click
  // didn't answer: that, at once (the sheet asks again by itself)
  for (const [name, cost, props, want] of [["slow", "never", {}, "Getting a price… 0:00"], ["Safe unread", 0.5, { coins: null }, FEE_WAIT_LINE], ["1Click down, first miss: asked again silently (rule 9a)", "down", {}, "Getting a price… 0:00"]] as const) {
    const { bridge, asked } = priced(cost);
    try {
      const lines = (await sheet(bridge, props)).split("\n");
      assert.ok(lines.includes(want), `${name}: "${want}"\n${lines.join("\n")}`);
      assert.ok(!lines.some((l) => /^About \$.* in fees\.$/.test(l)), `${name}: no figure`);
      if (name === "Safe unread") assert.equal(asked.filter((a) => a.method === "subwallet.site.addCost").length, 0, "no price asked before the Safe's coin is known");
      assert.deepEqual(asked.filter((a) => MOVES.test(a.method)).map((a) => a.method), [], `${name}: nothing signs or moves`);
    } finally {
      runtime.unmount();
    }
  }
});

test("ST3: the sample demo's price (the mock): the money sheet and the Browser tab ask; Trade, a site's page, Chat and AgentZero are refused", async () => {
  const m = mockBridge();
  for (const app of ["wallet", "social"]) {
    const r = await forApps(m, app).call<{ feeUsd: number }>("subwallet.site.addCost", { id: SITE, usd: "3.00" });
    assert.ok("ok" in r && r.ok.feeUsd > 0.06, `${app}: ${JSON.stringify(r)}`);
  }
  for (const app of ["trade", "browser", "chat", "agent", "pay"]) {
    const r = await forApps(m, app).call("subwallet.site.addCost", { id: SITE, usd: "3.00" });
    assert.ok("problem" in r && /not-allowed$/.test(r.problem.code), `${app}: ${JSON.stringify(r)}`);
  }
});

test("ST3 review Low: a site's wallet on another network (GMGN's BNB) is not priced: no line, no ask (control: Solana is)", async () => {
  for (const [network, priced_] of [["BNB", false], ["Solana", true]] as const) {
    const { bridge, asked } = priced(0.5);
    try {
      const lines = (await sheet(bridge, { network })).split("\n");
      assert.equal(asked.some((a) => a.method === "subwallet.site.addCost"), priced_, network);
      assert.equal(lines.includes("About $0.50 in fees."), priced_, network);
      assert.ok(!lines.includes(FEE_WAIT_LINE), `${network}: no waiting line`);
    } finally {
      runtime.unmount();
    }
  }
});

test("finding 61: a $2 Add says its least, and its lit button moves the least, never a dead \"Move $2\" (QA, 5 Nov); $2.09 is priced as asked (control)", async () => {
  const { bridge, asked } = priced(0.05);
  const shown = await sheet(bridge, { askedUsd: "2" });
  assert.ok(shown.split("\n").includes("Add at least $2.09 to cover the network fee."), shown);
  const lines = shown.split("\n");
  assert.ok(lines.includes("Add $2.09") && !lines.includes("Add $2"), `the lit choice is the least\n${shown}`);
  assert.deepEqual(asked.filter((a) => MOVES.test(a.method) || a.method === "subwallet.site.addCost").map((a) => a.method), [], "nothing priced or moved under the least");
  runtime.unmount();
  const p = priced(0.05);
  const ok = await sheet(p.bridge, { askedUsd: "2.09" });
  assert.ok(ok.split("\n").includes("Add $2.09"), ok);
  assert.ok(p.asked.some((a) => a.method === "subwallet.site.addCost"), "control: $2.09 is the person's own amount, priced as asked");
  runtime.unmount();
});
