// Builder 22's item 8 (8 Nov): the held-payment screen said "This takes a few seconds." with no one doing it and no
// steps: after Finish it now or Cancel it, one line, no way to see where it stood. Now the tap shows its three steps
// (the sheet, the person's yes, NEAR's transaction), each ticking as it goes, and one clock on NEAR's step ("NEAR is
// sending it. About 2 s."); the look-up says who looks and its own clock. Fails on main: no HELD_WORDS, no phaseSteps.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (re: RegExp) => void };
let mod: { WaitingView: FunctionComponent<Record<string, unknown>>; HELD_WORDS: Record<string, string>; phaseSteps: (p: { run: boolean; approved: boolean }, change: boolean) => { key: string; label: string; state: string }[]; phaseWords: (p: { run: boolean; approved: boolean }, change: boolean) => string };
let approvalAnswered: (approved: boolean) => void;

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
  (globalThis as { window?: unknown }).window ??= { setTimeout, clearTimeout, setInterval, clearInterval, addEventListener() {}, removeEventListener() {} };
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  mod = await server.ssrLoadModule("./shell/WaitingView.tsx") as typeof mod;
  approvalAnswered = (await server.ssrLoadModule("./shell/approval-answered.ts")).approvalAnswered;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

const clocks = (t: string) => (t.match(/About \d+ s\./g) ?? []).length;

test("held-steps-b22: each wait says who does it with one clock, no ellipsis", () => {
  const w = mod.HELD_WORDS;
  assert.equal(w.finding, "NEAR is finding it. About 3 s.");
  assert.equal(mod.phaseWords({ run: true, approved: true }, false), "NEAR is sending it. About 2 s.");
  assert.equal(mod.phaseWords({ run: true, approved: true }, true), "NEAR is making the change. About 2 s.");
  assert.equal(mod.phaseWords({ run: false, approved: true }, false), "NEAR is cancelling it. About 2 s.");
  for (const l of Object.values(w)) assert.doesNotMatch(l, /…|\.\.\.|few seconds/);
});

test("held-steps-b22: a tap's steps tick: sheet, then the person's yes, then NEAR", () => {
  const before = mod.phaseSteps({ run: true, approved: false }, false);
  assert.deepEqual(before.map((s) => `${s.label}:${s.state}`), ["Your sheet opens:doing", "You approve it:waiting", "NEAR sends it:waiting"]);
  const afterYes = mod.phaseSteps({ run: true, approved: true }, false);
  assert.deepEqual(afterYes.map((s) => s.state), ["done", "done", "doing"]);
  assert.equal(mod.phaseSteps({ run: false, approved: true }, false)[2]!.label, "NEAR cancels it");
  assert.equal(mod.phaseSteps({ run: true, approved: true }, true)[2]!.label, "NEAR makes the change");
});

test("held-steps-b22: on screen, Send it now shows the steps and one clock once Approve is tapped", async () => {
  const READY = { id: "4", title: "Send $900.00", lines: ["To kiosk.near"], readyAtIso: "2026-01-01T00:00:00.000Z", ready: true, needsSecondDevice: false };
  let finish: (r: BridgeResult<never>) => void = () => {};
  const bridge: Bridge = {
    call<T>(method: string): Promise<BridgeResult<T>> {
      if (method === "account.waiting") return Promise.resolve({ ok: [READY] as T });
      if (method === "account.waiting.run") return new Promise((r) => (finish = r as typeof finish));
      return Promise.resolve({ ok: [] as T });
    },
    on: () => () => {},
  };
  await runtime.mount(createElement(mod.WaitingView, { bridge, held: { id: "4", readyAtIso: READY.readyAtIso, needsSecondDevice: false }, onClose: () => {} }));
  assert.doesNotMatch(runtime.text(), /You approve it/);
  runtime.press(/^Send it now$/);
  await runtime.settle();
  assert.match(runtime.text(), /Your sheet opens.*You approve it.*NEAR sends it/s);
  assert.equal(clocks(runtime.text()), 0, "the person's turn next: no clock");
  approvalAnswered(true);
  await runtime.settle();
  assert.ok(runtime.text().includes("NEAR is sending it. About 2 s."), runtime.text());
  assert.equal(clocks(runtime.text()), 1, runtime.text());
  finish({ ok: { status: "declined" } } as never);
  await runtime.settle();
  assert.doesNotMatch(runtime.text(), /NEAR sends it/);
  runtime.unmount();
});

test("held-steps-b22: the look-up says who looks, with one clock", async () => {
  const bridge: Bridge = { call: <T,>() => new Promise<BridgeResult<T>>(() => {}), on: () => () => {} };
  await runtime.mount(createElement(mod.WaitingView, { bridge, held: { id: "9", readyAtIso: "2026-01-01T00:00:00.000Z", needsSecondDevice: false }, onClose: () => {} }));
  const t = runtime.text();
  assert.ok(t.includes("A payment or change is held.") && t.includes("NEAR is finding it. About 3 s."), t);
  assert.equal(clocks(t), 1);
  runtime.unmount();
});
