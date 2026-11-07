// Grade 01c, P7: a held change to the rules didn't show without a reload. Protection said "Nothing changed" while the
// account held one, and Security's "Waiting for you" sat under the list, out of view. Protection now says the held change
// at the top and opens its Waiting screen; Security draws "Waiting for you" right under the count. Mounted on the
// stand-in React that runs effects (fake-react.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; unmount: () => void; text: () => string };
let Protection: FunctionComponent<Record<string, unknown>>;
let pendingWords: (p: { readyAtIso: string; ready: boolean; needsSecondDevice: boolean }, now?: Date) => string;
let pendingState: typeof pendingWords;

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
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  const mod = await server.ssrLoadModule("./apps/security/Protection.tsx");
  Protection = mod.Protection;
  pendingWords = mod.pendingWords;
  pendingState = mod.pendingState;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

const BANDS = { bands: [], usd: [{ upToUsd: 500, level: "faceid", waitSeconds: 0 }, { upToUsd: null, level: "wait", waitSeconds: 3600 }] };
const HELD = { id: "3", title: "Change your protection", lines: [], readyAtIso: "2099-01-01T00:00:00.000Z", ready: false, needsSecondDevice: false, change: true };

function bridge(waiting: unknown[]): Bridge {
  return {
    async call<T>(method: string): Promise<BridgeResult<T>> {
      if (method === "account.protection.get") return { ok: BANDS as T };
      if (method === "account.waiting") return { ok: waiting as T };
      return { ok: null as T };
    },
    on: () => () => {},
  };
}

test("Protection says a held rules change at once, with when its wait ends", async () => {
  const opened: unknown[] = [];
  await runtime.mount(createElement(Protection, { bridge: bridge([HELD]), network: "testnet", hasSecondDevice: false, onBack: () => {}, onProblem: () => {}, onPairDevice: () => {}, onWaiting: (h: unknown) => opened.push(h) }));
  const shown = runtime.text();
  runtime.unmount();
  assert.match(shown, /Your new rules start /, "one row above the rules (design review §3.7)");
  assert.doesNotMatch(shown, /Reading your rules…/);
});

test("with nothing held, Protection shows no such line", async () => {
  await runtime.mount(createElement(Protection, { bridge: bridge([]), network: "testnet", hasSecondDevice: false, onBack: () => {}, onProblem: () => {}, onPairDevice: () => {}, onWaiting: () => {} }));
  const shown = runtime.text();
  runtime.unmount();
  assert.doesNotMatch(shown, /Your new rules/);
  assert.match(shown, /Your Safe keeps these rules/);
});

test("the held change's line: its end time, or ready to finish, or the second device's yes", () => {
  const now = new Date("2026-11-01T15:00:00Z");
  assert.match(pendingWords({ readyAtIso: "2026-11-01T15:30:00Z", ready: false, needsSecondDevice: false }, now), /^Its wait ends .+\. Tap to see it, or cancel it\.$/);
  assert.equal(pendingWords({ readyAtIso: "2026-11-01T14:00:00Z", ready: false, needsSecondDevice: false }, now), "Tap to finish it.");
  assert.match(pendingWords({ readyAtIso: "2026-11-01T14:00:00Z", ready: true, needsSecondDevice: true }, now), /second device/);
  // the word beside the title never says "waiting" once the wait is over (UX walk 2 Nov: a contradiction)
  assert.equal(pendingState({ readyAtIso: "2026-11-01T15:30:00Z", ready: false, needsSecondDevice: false }, now), "waiting");
  assert.equal(pendingState({ readyAtIso: "2026-11-01T14:00:00Z", ready: false, needsSecondDevice: false }, now), "ready to finish");
  assert.equal(pendingState({ readyAtIso: "2026-11-01T14:00:00Z", ready: true, needsSecondDevice: true }, now), "needs your second device");
});

test("Waiting for you is on Home itself while something is held, above the rows, and nothing when nothing is (review High: a hold in its cancel window is never behind a tap)", () => {
  const src = readFileSync(new URL("./SecurityApp.tsx", import.meta.url), "utf8");
  const waiting = src.slice(src.indexOf("export function SecurityWaiting("), src.indexOf("export function SecurityRows("));
  assert.ok(waiting.includes("<WaitingForYou"), "the held list is Home's waiting slot");
  assert.match(src, /if \(items\.length === 0\) return null;/, "it draws nothing when nothing is held");
  const home = readFileSync(new URL("../../../../../packages/wallet/src/app/screens/Home.tsx", import.meta.url), "utf8");
  assert.ok(home.indexOf("{a.waiting}") > 0 && home.indexOf("{a.waiting}") < home.indexOf('className="wl-rows wl-list"'), "on Home, before the rows");
  assert.doesNotMatch(home, /wl-v4-dot/, "no dot that is on whether or not anything waits");
  const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
  assert.match(app, /waiting: \(\) => <SecurityWaiting /, "the shell hands it to Home");
});
