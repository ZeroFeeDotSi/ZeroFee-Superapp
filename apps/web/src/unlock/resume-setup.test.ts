// Grade 01d, Q8: set-up made the passkey lock, then the free test service refused the account. A reload showed "ZeroFee is
// locked · Unlock with your passkey" for an account that was never made. Now the set-up comes back (the intro), and its
// passkey tap opens the lock already made; a device with an account still opens on "ZeroFee is locked".
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (re: RegExp) => void };
let UnlockGate: FunctionComponent<Record<string, unknown>>;

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
  (globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval };
  runtime = await server.ssrLoadModule(fake) as typeof runtime;
  UnlockGate = (await server.ssrLoadModule("./unlock/UnlockGate.tsx")).UnlockGate;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
});

const locked = { readRecord: async () => ({ method: "passkey" }), writeRecord: async () => {}, vaults: async () => [], store: () => ({}), clear: async () => {} };

for (const unfinished of [true, false]) {
  test(unfinished ? "no account made yet: the set-up comes back, not the lock" : "an account on this device: it opens locked, as before", async () => {
    let opened = 0;
    const intro = (done: (lockNow?: boolean) => void) => createElement("button", { onClick: () => { opened++; done(true); } }, "Create my account");
    await runtime.mount(createElement(UnlockGate, { device: locked, intro, unfinished: () => unfinished }, "APP"));
    await runtime.settle();
    if (!unfinished) {
      assert.match(runtime.text(), /ZeroFee is locked/);
      return runtime.unmount();
    }
    assert.match(runtime.text(), /Create my account/);
    assert.doesNotMatch(runtime.text(), /ZeroFee is locked/);
    runtime.press(/^Create my account$/);
    await runtime.settle();
    assert.equal(opened, 1);
    // No real passkey here: the unlock it tried didn't open, and the screen says set-up goes on, never "locked".
    assert.doesNotMatch(runtime.text(), /ZeroFee is locked/);
    assert.match(runtime.text(), /Finish setting up/);
    runtime.unmount();
  });
}
