// webd-money2 crawl (4 Nov): Trade's Bought / Sold receipt had no proof. It now carries the trade's own transaction as Send's
// receipt does (TxProofLine: its network and View; the id itself is never on screen, QA 5 Nov). Mounted for real
// (fake-react); control: a receipt with no hash has no line.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string };
let TradeMoment: FunctionComponent<Record<string, unknown>>;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 0);
  g.cancelAnimationFrame ??= (h: unknown) => clearTimeout(h as never);
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false, root: fileURLToPath(new URL("..", import.meta.url)), logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null }, appType: "custom", optimizeDeps: { noDiscovery: true, include: [] },
  });
  runtime = (await server.ssrLoadModule(fake)) as typeof runtime;
  ({ TradeMoment } = (await server.ssrLoadModule("@zerofee/trade/app/screens/Moment.tsx")) as { TradeMoment: typeof TradeMoment });
});
after(async () => server?.close());

const SIG = "27UckxmYVcsFiu4vJ2QUTV8mGwT8iyWPGGm6aq9BnkdwEDBfgwNyJ7h4V3cQkuGkV8b6aSE6cN3U5pvWkn5U7zEHLR";
const done = (extra: Record<string, unknown>) => createElement(TradeMoment, { phase: "done", side: "buy", symbol: "ANSEM", glow: "", amountText: "$0.50", sub: "About 10.58 ANSEM", tapAt: 0, landedMs: 1320, onDone: () => {}, ...extra });

test("the landed receipt has its transaction's proof: the network and View (control: none without a hash)", async () => {
  await runtime.mount(done({ tx: { chain: "sol", hash: SIG } }));
  const withTx = runtime.text();
  runtime.unmount();
  assert.match(withTx, /On Solana\nView/);
  await runtime.mount(done({}));
  const without = runtime.text();
  runtime.unmount();
  assert.doesNotMatch(without, /On Solana|View/, "control");
  const sheet = readFileSync(new URL("../../../../packages/trade/src/app/screens/TradeSheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const last = rec\.hashes\?\.\[rec\.hashes\.length - 1\];/);
  assert.match(sheet, /\{\.\.\.\(moment\.phase === "done" && moment\.tx \? \{ tx: moment\.tx \} : \{\}\)\}/);
});
