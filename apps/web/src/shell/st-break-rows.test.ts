// ST break rows, the Browser tab's money sheets (Add "Put money in", Take out "Move to your Safe"): each dependency at
// 404 (1Click, NEAR Intents' bridge, NEAR, Solana, ZeroFee's quote relay; 521 and slow are the B28 suite's rows in
// never-blocked.test.ts), a double tap, amounts at the edges, and a site's page (Browser's engine) that tries to drive a
// move or answer the Approve. Matrix: $ZEROFEE_HOME/screens/st-break-rows/MATRIX.md.
//
// (harness as site-add-fee.test.ts) ST3 (QA's rule: a fee figure only from a real quote, never a fixed or bounded number): the Browser's "Put money in"
// sheet says "About $X in fees." only when the core's two dry 1Click quotes put the Add's cost over 2 % of it; under 2 %
// nothing; before the quote is back "Fees show once the swap service gives a price."; the price never signs, moves or
// raises a sheet; only the money sheet (Wallet's bridge) and the Browser tab may ask it.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
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
let SiteBackSheet: FunctionComponent<Record<string, unknown>>;
let faultedBridge: (b: Bridge, f: { service: string; failure: 404 | 521 | 429 | "timeout" }) => Bridge;
let SERVICE_NAMES: Record<string, string>;
/** The shell's top banner (rule 9a, one line for any service really down, app-wide: "<service> is down. <what waits> <what
 *  works>"), never the sheet's own line; it was told apart by its "since" before 9a dropped that. */
let downLine: (s: string) => string;
let SHEET_NEEDS: Record<string, readonly string[]>;
let createSpendingService: (d: unknown) => Bridge;
let DemoCoreAppRules: (app: string) => Bridge;

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
  ({ SiteAddSheet, SiteBackSheet } = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx"));
  ({ faultedBridge } = await server.ssrLoadModule("@zerofee/shell-api/faults.ts"));
  ({ SERVICE_NAMES, downLine } = await server.ssrLoadModule("@zerofee/core/services"));
  ({ SHEET_NEEDS } = await server.ssrLoadModule("@zerofee/wallet/app/services.ts"));
  ({ createSpendingService } = await server.ssrLoadModule("@zerofee/core/spending"));
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
const PROBLEM_PAGE = /Your money hasn't moved\.|Your money is waiting for you:|Details for ZeroFee/;

/** Spending and the site's wallet as the core's engine answers them; every method asked is kept; moves answer `move`. */
function withSpending(inner: Bridge, move: () => Promise<BridgeResult<unknown>> = () => Promise.resolve({ ok: { declined: true } })) {
  const asked: string[] = [];
  const status = { loaded: true, totalUsd: "40.00", cashUsd: "30.00", coinsUsd: "10.00", capUsd: "500", roomUsd: "460.00", ready: true, networks: [], onItsWay: [], firstTopUp: false };
  const wallets = [{ id: SITE, role: "site", site: "pump", network: "sol", address: "So1ana1111111111111111111111111111111111111", label: "pump.fun wallet", current: true, cashUsd: "12.00" }];
  const bridge: Bridge = {
    call: ((m: string, p?: Record<string, unknown>) => {
      asked.push(m);
      return m === "spending.status" ? Promise.resolve({ ok: status })
        : m === "spending.wallets" ? Promise.resolve({ ok: wallets })
        : m === "subwallet.site.addCost" ? Promise.resolve({ ok: { feeUsd: 0.1, legsUsd: [0, 0.1] } })
        : m === "spending.topUp" || m === "subwallet.site.moveBack" ? move()
        : inner.call(m, p);
    }) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
  return { bridge, asked };
}
const add = (o: Record<string, unknown> = {}) => () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", coins: COINS, onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {}, ...o });
const back = () => () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {} });
async function mount(bridge: Bridge, render: () => unknown): Promise<string> {
  const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render }];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
  await runtime.settle();
  await runtime.settle();
  return runtime.text();
}
const SHEETS = [{ name: "Add", kind: "siteadd", render: add(), title: /Add \$[0-9.]+ to your pump\.fun wallet/ }, { name: "Take out", kind: "takeout", render: back(), title: /Take out to your Safe/ }] as const;
export const ROWS: string[] = [];

test("each dependency at 404 (1Click, NEAR Intents' bridge, NEAR, Solana, the relay): both sheets open in place; a needed one is one line naming it with Move held; never a page", async () => {
  for (const service of ["oneclick", "bridge", "near", "solana", "relay"]) {
    for (const s of SHEETS) {
      const { bridge } = withSpending(mockBridge());
      try {
        const shown = await mount(faultedBridge(bridge, { service, failure: 404 }), s.render);
        const label = `${SERVICE_NAMES[service]} 404, ${s.name}`;
        assert.match(shown, s.title, label);
        assert.doesNotMatch(shown, PROBLEM_PAGE, label);
        const line = shown.split("\n").find((l) => l.startsWith(SERVICE_NAMES[service]!) && !/ since /.test(l) && l !== downLine(service)) ?? null;
        const needs = SHEET_NEEDS[s.kind]!.includes(service);
        if (needs) {
          assert.ok(line, `${label}: a line naming it\n${shown}`);
          // F2: the line names what waits in the sheet's own word: "Move", never "Add" (the sheet says "Put money in")
          if (s.name === "Add") assert.match(line!, / Add waits until it's back\.$/, label);
          assert.throws(() => runtime.press(/^(Add|Take out) \$/), /is off|nothing to tap/, `${label}: Move waits until it's back`);
        } else assert.equal(line, null, `${label}: no line for a service it doesn't use`);
        ROWS.push(`${SERVICE_NAMES[service]} | 404 | ${s.name} | ${needs ? "line, Move held" : "not needed, no line"} | ${line ?? "(none)"}`);
      } finally {
        runtime.unmount();
      }
    }
  }
});

test("double tap: Move tapped twice asks the core once (Add and Take out); control: one tap asks once", async () => {
  for (const s of SHEETS) {
    let answer: (r: BridgeResult<unknown>) => void = () => {};
    const { bridge, asked } = withSpending(mockBridge(), () => new Promise((r) => (answer = r)));
    const method = s.name === "Add" ? "spending.topUp" : "subwallet.site.moveBack";
    try {
      await mount(bridge, s.render);
      runtime.press(/^(Add|Take out) \$/);
      await runtime.settle();
      // the second tap lands on a button that is off while the first is with the core (or gone)
      assert.throws(() => runtime.press(/^(Add|Take out) \$/), /is off|nothing to tap/, `${s.name}: the second tap does nothing`);
      answer({ ok: { declined: true } });
      await runtime.settle();
      assert.equal(asked.filter((m) => m === method).length, 1, `${s.name}: asked once`);
    } finally {
      runtime.unmount();
    }
  }
});

test("amounts: under $2.09 holds Move (finding 61: a site's Add is at least a Safe -> wallet leg's least); $2.09 is allowed; empty, letters, three decimals are not amounts; the start is never more than the Safe", async () => {
  const { typedUsd, validUsd } = await server.ssrLoadModule("@zerofee/wallet/app/hub.ts");
  for (const bad of ["", " ", "abc", "1.234", "-5", "0"]) assert.equal(validUsd(bad), false, JSON.stringify(bad));
  for (const ok of ["2", "$2.00", "1,000.50", ".5"]) assert.equal(validUsd(ok), true, ok);
  assert.equal(typedUsd("1,000.50"), "1000.50");
  for (const [asked, held] of [["1.99", true], ["2", true], ["2.09", false]] as const) {
    const { bridge } = withSpending(mockBridge());
    try {
      await mount(bridge, add({ askedUsd: asked }));
      // under the least the typed amount never goes: the lit choice is the least itself (QA, 5 Nov: a dead "Move $2")
      if (held) assert.throws(() => runtime.press(new RegExp(`^Add \\$${asked.replace(".", "\\.")}$`)), /is off|nothing/i, `$${asked}: held`);
      else assert.doesNotThrow(() => runtime.press(/^(Add|Take out) \$/), `$${asked}: goes`);
    } finally {
      runtime.unmount();
    }
  }
  // asked for $50 with $30 in the Safe: the sheet starts at the Safe's $30, never more
  const { bridge } = withSpending(mockBridge());
  try {
    const shown = await mount(bridge, add({ askedUsd: "50" }));
    assert.ok(shown.split("\n").some((l) => /^Add \$30$/.test(l)), shown);
  } finally {
    runtime.unmount();
  }
  // an empty Safe: no amount at all, one step ("Add money")
  const empty = withSpending(mockBridge());
  try {
    const shown = await mount(empty.bridge, add({ safeUsd: "1.50" }));
    assert.match(shown.replace(/\n/g, ""), /Your Safe has less than \$2\.09\. Add money to it first\./);
    assert.ok(!empty.asked.includes("spending.topUp"));
  } finally {
    runtime.unmount();
  }
});

test("a site's page never drives a move or answers the Approve: Browser's engine is refused topUp, moveBack, addCost and approval.*; it never hears approval events (controls: Wallet's sheet)", async () => {
  const m = mockBridge();
  const page = forApps(m, "browser");
  for (const method of ["approval.answer", "approval.pending"]) {
    const r = await page.call(method, { id: "1", approve: true });
    assert.ok("problem" in r && r.problem.code === "security.bridge.not-allowed", method);
  }
  // a page's subscription to the Approve never reaches the core (control: Wallet's own event does)
  const subs: string[] = [];
  const spy: Bridge = { call: m.call, on: (e) => (subs.push(e), () => {}) };
  forApps(spy, "browser").on("approval.needed", () => {});
  forApps(spy, "browser").on("approval.answered", () => {});
  assert.deepEqual(subs, []);
  forApps(spy, "wallet").on("ledger.balancesChanged", () => {});
  assert.deepEqual(subs, ["ledger.balancesChanged"]);
  for (const method of ["subwallet.site.moveBack", "subwallet.site.addCost"]) {
    const r = await page.call(method, { id: SITE, amount: "all", key: "page-asks-0000000001", usd: "10" });
    assert.ok("problem" in r && /not-allowed$/.test(r.problem.code), `${method}: ${JSON.stringify(r)}`);
  }
  // Spending's own rule (the service, not the mock): Browser's engine never tops up; Wallet's sheet does (control)
  const svc = createSpendingService({ engine: () => ({ snapshot: () => ({ totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [] }), subscribe: () => () => {}, refresh: async () => {}, add: async () => "declined", takeOut: async () => { throw new Error("no"); }, setCost: () => {}, setCap: () => {}, moveNow: async () => { throw new Error("no"); } }), call: async (method: string) => (method === "device.store.get" ? { value: null } : method === "account.state" ? { account: { network: "mainnet" } } : method === "subwallet.list" ? [{ id: SITE, kind: "site", chain: "sol", site: "pump" }] : method === "account.protection.get" ? {} : method === "ledger.balances" ? COINS : {}) } as never);
  const no = await svc.call("spending.topUp", { usd: "10", ready: SITE, caller: "browser" });
  assert.ok("problem" in no && no.problem.code === "security.request.not-allowed", JSON.stringify(no));
  const yes = await svc.call("spending.topUp", { usd: "10", ready: SITE, caller: "wallet" });
  assert.notEqual("problem" in yes ? yes.problem.code : "ok", "security.request.not-allowed", "control: Wallet's sheet gets past the rule");
});

test("the table", () => {
  if (process.env.ST_TABLE) writeFileSync(process.env.ST_TABLE, ["service | failure | sheet | result | line", ...ROWS].join("\n") + "\n");
});
