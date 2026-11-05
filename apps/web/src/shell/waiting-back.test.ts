// Grade 02e, E5: Escape on the Waiting screen and on its ended face ("Cancelled.") must leave, as Done does. Mounted on
// the stand-in React that runs effects (fake-react.ts); runBack is what Escape and browser Back run.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let WaitingView: FunctionComponent<Record<string, unknown>>;
let back: { runBack: () => void; backDepth: () => number };

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
  (globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  WaitingView = (await server.ssrLoadModule("./shell/WaitingView.tsx")).WaitingView;
  back = await server.ssrLoadModule("@zerofee/design/back.ts") as typeof back;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

for (const state of ["waiting", "cancelled"] as const) {
  test(`E5: Back and Escape leave the Waiting screen (${state})`, async () => {
    let closed = 0;
    const readyAtIso = new Date(Date.now() + 3_600_000).toISOString();
    const item = { id: "7", title: "Change your protection", lines: ["Up to $500 (117.3708 NEAR): runs as soon as you approve"], readyAtIso, needsSecondDevice: false, ready: false, change: true };
    const bridge = {
      call: async (m: string) => (m === "account.waiting" ? { ok: state === "waiting" ? [item] : [] } : m === "account.waiting.status" ? { ok: { state } } : { ok: [] }),
      // the ended face: this device's cancel, as the core tells it
      on: (ev: string, h: (e: unknown) => void) => (state === "cancelled" && ev === "account.waiting.ended" && queueMicrotask(() => h({ id: "7", ended: "cancelled" })), () => {}),
    };
    await runtime.mount(createElement(WaitingView, { bridge, held: { id: "7", readyAtIso, needsSecondDevice: false }, onClose: () => closed++ }));
    for (let i = 0; i < 5; i++) await runtime.settle();
    assert.match(runtime.text(), state === "cancelled" ? /Cancelled/ : /Change your protection/);
    assert.equal(back.backDepth(), 1, "the screen registered its way back");
    back.runBack();
    assert.equal(closed, 1, runtime.text());
    runtime.unmount();
  });
}
