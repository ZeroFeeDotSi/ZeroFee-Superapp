// "Was this you?" (a recovery started from another device) loads with set-up's screens (App.tsx, setup-gate.ts). While its
// code is on its way the boot title holds, then the real screen shows: never a blank, never skipped, never closed by the
// load itself. The real later() and the real gate, under the stand-in React (testing/fake-react.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createElement, type ComponentType } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let later: <P extends object>(load: () => Promise<ComponentType<P>>) => ComponentType<P> & { preload: () => Promise<unknown> };
let setupGate: (load: () => Promise<unknown>) => { fetch: () => Promise<unknown>; here: () => boolean; useWaiting: (needs: boolean) => boolean };

before(async () => {
  const fake = fileURLToPath(new URL("./testing/fake-react.ts", import.meta.url));
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL(".", import.meta.url)),
    logLevel: "silent",
    // the stand-in React, plus the real createElement (later.tsx draws with it; its elements are what the stand-in walks)
    resolve: { alias: [{ find: /^react$/, replacement: "zf-fake-react" }] },
    plugins: [{
      name: "zf-fake-react",
      enforce: "pre",
      resolveId: (id) => (id === "zf-fake-react" ? "\0zf-fake-react" : null),
      load: (id) => (id === "\0zf-fake-react" ? `export * from ${JSON.stringify(fake)};\nexport const createElement = (...a) => globalThis.zfCreateElement(...a);` : null),
    }],
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  (globalThis as { zfCreateElement?: typeof createElement }).zfCreateElement = createElement;
  runtime = (await server.ssrLoadModule("zf-fake-react")) as typeof runtime;
  later = (await server.ssrLoadModule("./later.tsx")).later;
  setupGate = (await server.ssrLoadModule("./setup-gate.ts")).setupGate;
});
after(async () => server?.close());

type Alert = { onStop: () => void; onItsMe: () => void };
/** A stand-in for Recovery.tsx's module, held until the test lets it arrive. */
function heldScreens() {
  let arrive!: () => void;
  const here = new Promise<void>((r) => { arrive = r; });
  const WasThisYouReal = ({ onStop, onItsMe }: Alert) => createElement("div", null, createElement("p", null, "Was this you?"), createElement("button", { onClick: onStop }, "Stop it"), createElement("button", { onClick: onItsMe }, "It's me"));
  const WasThisYou = later<Alert>(() => here.then(() => WasThisYouReal));
  return { WasThisYou, arrive };
}

test("Was this you? while its code loads: the title holds, then the real screen shows; nothing is answered for the person (control: without the gate the screen is blank)", async () => {
  const { WasThisYou, arrive } = heldScreens();
  const gate = setupGate(() => WasThisYou.preload());
  const answered: string[] = [];
  const Title = () => createElement("p", null, "TITLE");
  // App.tsx's shape: the view stays "alert"; the gate only picks what is drawn in its place
  const Shell = ({ gated }: { gated: boolean }) => {
    const waiting = gate.useWaiting(gated);
    const screen = createElement(WasThisYou, { onStop: () => answered.push("stop"), onItsMe: () => answered.push("its-me") });
    return waiting ? createElement(Title) : screen;
  };

  await runtime.mount(createElement(Shell, { gated: false }));
  assert.equal(runtime.text(), "", "control: drawn before its code is here, the screen is blank (what the gate prevents)");
  runtime.unmount();

  await runtime.mount(createElement(Shell, { gated: true }));
  assert.equal(runtime.text(), "TITLE", "the title holds while the code loads");
  assert.equal(gate.here(), false);
  await runtime.settle();
  assert.equal(runtime.text(), "TITLE", "still the title after many turns: no timeout skips it");
  arrive();
  await runtime.settle();
  assert.match(runtime.text(), /^Was this you\?\nStop it\nIt's me$/, "the real screen shows the moment its code lands");
  assert.deepEqual(answered, [], "neither Stop nor It's me was pressed for the person: the load answers nothing");
  runtime.unmount();

  // once here, it draws in the very first render
  await runtime.mount(createElement(Shell, { gated: true }), { limit: 1 });
  assert.match(runtime.text(), /^Was this you\?/);
  runtime.unmount();
});

test("App.tsx: Was this you? is behind the gate, its view never changes while it waits, and the gate draws the boot's own title", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /const SETUP_VIEWS: ReadonlySet<View\["k"\]> = new Set\(\[[^\]]*"alert"/);
  assert.match(app, /const WasThisYou = later\(\(\) => recoveryScreens\(\)\.then\(\(m\) => m\.WasThisYou\)\);/);
  assert.match(app, /const SETUP_SCREENS = \[[^\]]*WasThisYou/);
  assert.match(app, /const waitSetup = SETUP\.useWaiting\(SETUP_VIEWS\.has\(view\.k\)\);/);
  assert.match(app, /\n  if \(waitSetup\) screen = <Title \/>;\n/);
  assert.match(app, /case "boot": screen = <Title \/>; break;/, "control: the same element the boot draws");
  const gate = readFileSync(new URL("./setup-gate.ts", import.meta.url), "utf8");
  assert.doesNotMatch(gate, /setView|setTimeout/, "the gate never moves the view on, and has no clock");
});
