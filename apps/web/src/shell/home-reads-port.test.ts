// home/reads in D134's runtime (review H1, M1): Home paints the Safe from the first node to answer, but the money fields
// (what Send, Move and Swap check) and the copy kept on the phone count only reads two nodes agreed; an event reads again
// only the parts it names, never every read. Mounted on the stand-in React against the sample-money bridge.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void };
let WalletProvider: FunctionComponent<{ bridge: Bridge; children: ReactNode }>;
let useWallet: () => { balances: unknown[] | null; shown: { balances: unknown[] | null }; refresh: () => void };
let mockBridge: () => Bridge & { emit: (e: string, p: unknown) => void };
let forApps: (b: Bridge, app: string) => Bridge;
let primeHome: (b: Bridge) => Promise<unknown>;

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
  primeHome = (await server.ssrLoadModule("@zerofee/wallet/app/home-cache.ts")).primeHome;
});
after(async () => server?.close());

/** The sample bridge, with the Safe's agreed read (ledger.balances without {shown:true}) held until `agree()`. */
function withAgreement() {
  const inner = mockBridge();
  const asked: { m: string; p?: Record<string, unknown> }[] = [];
  let agree!: () => void;
  const agreedHeld = new Promise<void>((r) => { agree = r; });
  const bridge: Bridge = {
    async call<T>(m: string, p?: Record<string, unknown>): Promise<BridgeResult<T>> {
      asked.push({ m, ...(p ? { p } : {}) });
      if (m === "ledger.balances" && !p?.shown) await agreedHeld;
      return inner.call<T>(m, p);
    },
    on: (e, h) => inner.on(e, h),
  };
  return { bridge: forApps(bridge, "wallet"), inner, asked, agree };
}

test("M1: with the Safe kept as two nodes agreed it, one node's read paints Home but never the money fields; two nodes' read does (controls)", async () => {
  const b = withAgreement();
  // the copy kept on this phone: the Safe's rows as two nodes agreed them (only such rows are kept: H1)
  const rows = await b.inner.call<{ amount: string }[]>("ledger.balances");
  assert.ok("ok" in rows);
  await b.bridge.call("device.store.set", { key: "home-cache.v1", value: JSON.stringify({ v: 1, balances: { at: Date.now() - 60_000, rows: rows.ok.map((r) => ({ ...r, agreed: true })) } }) });
  await primeHome(b.bridge);
  const seen: { money: boolean; fresh: boolean }[] = [];
  const Probe = () => { const w = useWallet(); seen.push({ money: w.balances !== null, fresh: w.shown.balances !== null }); return null; };
  await runtime.mount(createElement(WalletProvider, { bridge: b.bridge }, createElement(Probe)), { limit: 60 });
  assert.ok(b.asked.some((a) => a.m === "ledger.balances" && a.p?.shown === true), "the screen read is the first node's ({ shown: true })");
  const one = seen.at(-1)!;
  assert.equal(one.fresh, true, "control: Home paints the Safe at once");
  assert.equal(one.money, false, "the money fields wait for two nodes");
  b.agree();
  await new Promise((r) => setTimeout(r, 20));
  await runtime.settle();
  assert.equal(seen.at(-1)!.money, true, "agreed: the money fields have the Safe");
  runtime.unmount();
});

test("an event reads again only the parts it names, coalesced; never every read (control: refresh reads them all)", async () => {
  const b = withAgreement();
  b.agree();
  await primeHome(b.bridge);
  let refresh = () => {};
  const Probe = () => { refresh = useWallet().refresh; return null; };
  await runtime.mount(createElement(WalletProvider, { bridge: b.bridge }, createElement(Probe)), { limit: 60 });
  await new Promise((r) => setTimeout(r, 400));
  await runtime.settle();
  b.asked.length = 0;
  // a balance that moved, three times in a row: one read of the Safe, its activity and Private
  for (let i = 0; i < 3; i++) b.inner.emit("ledger.balancesChanged", { parts: ["safe"] });
  await new Promise((r) => setTimeout(r, 400));
  await runtime.settle();
  const after = b.asked.map((a) => a.m);
  assert.equal(after.filter((m) => m === "ledger.balances").length >= 1, true, "the Safe is read again");
  assert.ok(after.filter((m) => m === "ledger.balances" && true).length <= 2, `coalesced: ${after.join(", ")}`);
  for (const m of ["spending.status", "earn.positions", "ledger.chains", "ledger.tokens", "trade.positions"]) assert.ok(!after.includes(m), `${m} is not read for a Safe change`);
  // control: Retry (refresh) reads every part
  b.asked.length = 0;
  refresh();
  await new Promise((r) => setTimeout(r, 400));
  await runtime.settle();
  for (const m of ["ledger.balances", "spending.status", "earn.positions", "ledger.activity", "ledger.private"]) assert.ok(b.asked.some((a) => a.m === m), `control: refresh reads ${m}`);
  runtime.unmount();
});
