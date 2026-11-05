// Grade 01c, P5: the Problem screen an app shows (Apps: "Spending has no cash for your sites yet.") had no way back:
// Back and Escape did nothing. The shell's Problem screen now registers its own way back, so Back and Escape close it
// and the app hears "nothing" (it was dismissed). Mounted on the stand-in React that runs effects (fake-react.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { NextStep, Problem } from "@zerofee/core/problem";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let useShell: () => { showProblem: (p: Problem) => Promise<NextStep> };
let back: { runBack: () => void; backDepth: () => number };
let useEffect: (run: () => void, deps: unknown[]) => void;

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
  // AppHost listens for arrow keys on window; nothing else here needs a page.
  (globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  useEffect = (runtime as unknown as { useEffect: typeof useEffect }).useEffect;
  AppHost = (await server.ssrLoadModule("./shell/AppHost.tsx")).AppHost;
  useShell = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).useShell;
  back = await server.ssrLoadModule("@zerofee/design/back.ts") as typeof back;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

const SHORT: Problem = { code: "spending.site.short", whatHappened: "Trading has no cash for your apps yet.", money: { state: "safe", where: "in Trading and your Safe" }, next: { kind: "open", label: "Top up Trading", screen: "spending-topup" } };

test("Back (and Escape, the same way back) closes an app's Problem screen, and the app hears it was dismissed", async () => {
  const heard: NextStep[] = [];
  let asked = false;
  const Apps = () => {
    const shell = useShell();
    useEffect(() => {
      if (asked) return;
      asked = true;
      void shell.showProblem(SHORT).then((s) => heard.push(s));
    }, []);
    return null;
  };
  const apps = [{ id: "social", name: "Apps", line: "", bridge: { call: async () => ({ ok: null }), on: () => () => {} }, render: () => createElement(Apps) }];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: apps[0].bridge }));
  assert.equal(back.backDepth(), 1, "the Problem screen registered its way back");
  back.runBack();
  await runtime.settle();
  assert.deepEqual(heard.map((s) => s.kind), ["nothing"]);
  assert.equal(back.backDepth(), 0, "and it is gone");
});
