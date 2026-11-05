// QA's crawl (4 Nov): a tap on an Add row copied the address, but "Copied" never showed. A page whose
// clipboard answers oddly (a hooked writeText, a web view's that returns nothing or throws at once) made the row's tap
// throw before it could say so. Now the row says "Copied" whatever the clipboard does.
// (The address stays off the row: D138, the QR sheet alone shows it.)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; pressNamed: (l: RegExp) => void };
let AddressRow: FunctionComponent<Record<string, unknown>>;
let ADD_ROWS: { chain: string }[];

const ADDR = "3R36RM6qh7wRaUkFb59DGFDmw8DfcwnEqpNAUQtAcpE4";  // generated sample
const bridge: Bridge = {
  call: (async (method: string, p?: Record<string, unknown>) => method === "subwallet.add.quote"
    ? { ok: { key: String(p?.key), chain: "sol", to: "wallet", depositAddress: ADDR, tokenId: "nep141:sol.omft.near", symbol: "SOL", decimals: 9, minAmountIn: "1000000", amountIn: "100000000", untilIso: new Date(Date.now() + 86_400_000).toISOString() } }
    : { ok: {} }) as Bridge["call"],
  on: () => () => {},
};

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
  ({ AddressRow } = await server.ssrLoadModule("@zerofee/wallet/app/money/AddSheet.tsx"));
  ({ ADD_ROWS } = await server.ssrLoadModule("@zerofee/wallet/app/money/add-coins.ts"));
}, { timeout: 60_000 });
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

async function rowAfterTap(writeText: (t: string) => unknown): Promise<{ before: string; text: string; copiedText: string[] }> {
  const copiedText: string[] = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: (t: string) => (copiedText.push(t), writeText(t)) } }, configurable: true });
  const row = ADD_ROWS.find((r) => r.chain === "sol");
  await runtime.mount(createElement(AddressRow, { bridge, row, to: "wallet", onQr() {} }));
  for (let i = 0; i < 100 && !/Tap to copy/.test(runtime.text()); i++) { await new Promise((r) => setTimeout(r, 20)); await runtime.settle(); }
  const before = runtime.text();
  runtime.pressNamed(/^Copy your SOL wallet address$/);
  await runtime.settle();
  const text = runtime.text();
  runtime.unmount();
  return { before, text, copiedText };
}

test("a tap shows Copied when the clipboard answers normally", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => Promise.resolve());
  assert.deepEqual(r.copiedText, [ADDR]);
  assert.match(r.text, /Copied/);
});

test("a tap shows Copied when the clipboard returns nothing (a hooked or web view's writeText)", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => undefined);
  assert.deepEqual(r.copiedText, [ADDR]);
  assert.match(r.text, /Copied/);
});

test("a tap shows Copied when the clipboard throws at once", { timeout: 30_000 }, async () => {
  const r = await rowAfterTap(() => { throw new Error("NotAllowedError"); });
  assert.match(r.text, /Copied/);
});

