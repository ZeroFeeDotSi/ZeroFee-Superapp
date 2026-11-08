// Grade 01c, P13: "Finish it now" showed nothing new for over a second (its sheet came at 4.3 s), and after Approve the
// screen sat still for 2.3 s. The Waiting screen now says what the tap is doing at once, and again once Approve is
// tapped. Mounted on the stand-in React that runs effects (fake-react.ts).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (re: RegExp) => void };
let WaitingView: FunctionComponent<Record<string, unknown>>;
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
  WaitingView = (await server.ssrLoadModule("./shell/WaitingView.tsx")).WaitingView;
  approvalAnswered = (await server.ssrLoadModule("./shell/approval-answered.ts")).approvalAnswered;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

const READY = { id: "3", title: "Change your protection", lines: ["Anything bigger: waits 1 hour."], readyAtIso: "2026-01-01T00:00:00.000Z", ready: true, needsSecondDevice: false, change: true };

for (const [button, before, afterApprove] of [
  [/^Finish it now$/, "Getting it ready for you to approve.", "NEAR is making the change. About 2 s."],
  [/^Cancel it$/, "Getting the cancel ready for you to approve.", "NEAR is cancelling it. About 2 s."],
] as const) {
  test(`${button.source}: says what it's doing at the tap ("${before}"), then "${afterApprove}" once Approve is tapped`, async () => {
    let finish: (r: BridgeResult<never>) => void = () => {};
    const bridge: Bridge = {
      call<T>(method: string): Promise<BridgeResult<T>> {
        if (method === "account.waiting") return Promise.resolve({ ok: [READY] as T });
        if (method === "account.waiting.run" || method === "account.waiting.cancel") return new Promise((r) => (finish = r as typeof finish));
        return Promise.resolve({ ok: [] as T });
      },
      on: () => () => {},
    };
    await runtime.mount(createElement(WaitingView, { bridge, held: { id: "3", readyAtIso: READY.readyAtIso, needsSecondDevice: false }, onClose: () => {} }));
    assert.doesNotMatch(runtime.text(), /ready to approve/);
    runtime.press(button);
    await runtime.settle();
    assert.match(runtime.text(), new RegExp(before.replace(/[.…]/g, "."), "u"));
    approvalAnswered(true);
    await runtime.settle();
    assert.ok(runtime.text().includes(afterApprove), runtime.text());
    finish({ ok: { status: "declined" } } as never);
    await runtime.settle();
    assert.ok(!runtime.text().includes(afterApprove), "the status goes when the answer comes");
    runtime.unmount();
  });
}

// Grade 01d, Q3: "Cancelled." showed for about 10 s, then the screen's own next look (the request no longer listed, the
// account's history not showing the cancel yet) replaced it with "That request isn't waiting any more". Once an outcome
// is shown, nothing replaces it without a tap.
test("an outcome on screen is never replaced by a later look", async () => {
  const w = globalThis.window as unknown as { setTimeout: unknown; clearTimeout: unknown };
  const real = { set: w.setTimeout, clear: w.clearTimeout };
  const timers = new Map<number, () => void>();
  let n = 0;
  w.setTimeout = (f: () => void) => (timers.set(++n, f), n);
  w.clearTimeout = (id: number) => void timers.delete(id);
  let listed = true;
  let finish: (r: BridgeResult<never>) => void = () => {};
  const bridge: Bridge = {
    call<T>(method: string): Promise<BridgeResult<T>> {
      if (method === "account.waiting") return Promise.resolve({ ok: (listed ? [READY] : []) as T });
      if (method === "account.waiting.status") return Promise.resolve({ ok: { state: "unknown" } as T });
      if (method === "account.waiting.cancel") return new Promise((r) => (finish = r as typeof finish));
      return Promise.resolve({ ok: [] as T });
    },
    on: () => () => {},
  };
  try {
    await runtime.mount(createElement(WaitingView, { bridge, held: { id: "3", readyAtIso: READY.readyAtIso, needsSecondDevice: false }, onClose: () => {} }));
    runtime.press(/^Cancel it$/);
    await runtime.settle();
    finish({ ok: { status: "done" } } as never);
    await runtime.settle();
    assert.match(runtime.text(), /Cancelled\./);
    listed = false;
    for (const f of [...timers.values()]) f();
    await runtime.settle();
    assert.match(runtime.text(), /Cancelled\./);
    assert.doesNotMatch(runtime.text(), /isn't waiting any more/);
  } finally {
    w.setTimeout = real.set;
    w.clearTimeout = real.clear;
    runtime.unmount();
  }
});
