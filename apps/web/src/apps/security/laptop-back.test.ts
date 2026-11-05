// Grade 01d, Q4: on "Add your laptop" and "Paste the code", Escape and browser Back did nothing; only the arrow left.
// They are now the arrow's own way back, a step at a time. Mounted on the stand-in React that runs effects (fake-react.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (re: RegExp) => void };
let LaptopFlow: FunctionComponent<Record<string, unknown>>;
let back: { runBack: () => void; backDepth: () => number };

before(async () => {
  const fake = fileURLToPath(new URL("../../testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../..", import.meta.url)),
    logLevel: "silent",
    resolve: { alias: [{ find: /^react$/, replacement: fake }] },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  (globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  // A browser's test page, which has a laptop page to name (the iPhone's test build has none: laptop-words.ts, E12).
  (globalThis as { location?: unknown }).location ??= { host: "localhost:5180", origin: "http://localhost:5180" };
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  LaptopFlow = (await server.ssrLoadModule("./apps/security/SecurityApp.tsx")).LaptopFlow;
  back = await server.ssrLoadModule("@zerofee/design/back.ts") as typeof back;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

test("Back and Escape step back through Add your laptop and Paste the code, then leave", async () => {
  let left = 0;
  const bridge = { call: async () => ({ ok: [] }), on: () => () => {} };
  const actions = { bridge, onProblem() {}, onRemoveKey() {}, onStopRecovery() {}, onCheckWords() {}, onChanged() {}, onWaiting() {} };
  await runtime.mount(createElement(LaptopFlow, { actions, onDone: () => left++ }));
  assert.match(runtime.text(), /Add your laptop/);
  assert.equal(back.backDepth(), 1, "the flow registered its way back");
  runtime.press(/^(Paste the code|Or paste the code|Scan my laptop's code)$/);
  await runtime.settle();
  assert.match(runtime.text(), /The code|Or paste the code/);
  back.runBack();
  await runtime.settle();
  assert.match(runtime.text(), /Add your laptop/);
  assert.equal(left, 0, "one step back, not out");
  back.runBack();
  await runtime.settle();
  assert.equal(left, 1, "then out of the flow");
  runtime.unmount();
});
