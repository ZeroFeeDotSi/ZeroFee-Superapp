// O-2b review: the first win's screen, rendered on the fake React runtime with a fake Wallet that answers as told and
// records every call. Each row is a person's path: done, a "no" then a second tap, held by the rules, came back,
// refused before anything was signed, and Later. Every way out calls onDone (into ZeroFee).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: (o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let FirstWin: FunctionComponent<Record<string, unknown>>;

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
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
  FirstWin = (await server.ssrLoadModule("/screens/FirstWin.tsx")).FirstWin;
});
after(async () => server?.close());

const refused = (code: string, whatHappened: string, money: unknown = { state: "not-involved" }) => ({ problem: { code, whatHappened, money, next: { kind: "nothing", label: "OK" } } });

/** A Wallet whose answers are given per method (a list is used in turn); every call is recorded. */
function wallet(answers: Record<string, unknown | unknown[]>) {
  const calls: string[] = [];
  const used = new Map<string, number>();
  return {
    calls,
    bridge: {
      call: async (method: string) => {
        calls.push(method);
        const a = answers[method];
        if (Array.isArray(a)) {
          const i = used.get(method) ?? 0;
          used.set(method, i + 1);
          return a[Math.min(i, a.length - 1)];
        }
        return a ?? { ok: null };
      },
      on: () => () => {},
    },
  };
}

async function show(w: ReturnType<typeof wallet>, setUp = true) {
  let done = 0;
  await runtime.mount(createElement(FirstWin as never, { wallet: w.bridge, offer: { near: "0.44445", usd: 2, setUp }, onDone: () => void done++, pollMs: 1 }));
  return { done: () => done };
}
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5));
    await runtime.settle();
  }
};

test("done: Hidden's wallet made, priced, the Approve answered, the move followed until it lands; Open ZeroFee goes in", async () => {
  const w = wallet({ "ledger.privateSetup": { ok: {} }, "ledger.quoteToPrivate": { ok: { id: "pq1" } }, "ledger.toPrivate": { ok: { id: "m1", status: "moving" } }, "ledger.activity": [{ ok: [{ id: "m1", status: "moving" }] }, { ok: [{ id: "m1", status: "done" }] }] });
  const s = await show(w);
  assert.match(runtime.text(), /Try Private/);
  assert.match(runtime.text(), /Private from the public, except the money going in and coming out\. NEAR Intents sees every payment\./, "the honest line (P-1), on the screen");
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /You did it/);
  assert.doesNotMatch(runtime.text(), /\$2 is in Hidden/, "never a figure the fees made untrue");
  assert.deepEqual(w.calls.filter((c) => c !== "ledger.activity"), ["ledger.privateSetup", "ledger.quoteToPrivate", "ledger.toPrivate"]);
  runtime.press(/^Open ZeroFee$/);
  assert.equal(s.done(), 1);
  runtime.unmount();
});

test("review M1: a 'no' on the Approve goes back to the offer with nothing moved; the second tap doesn't make Hidden's wallet again", async () => {
  const w = wallet({ "ledger.privateSetup": [{ ok: {} }, refused("security.subwallet.one", "There is one Hidden balance.")], "ledger.quoteToPrivate": { ok: { id: "pq1" } }, "ledger.toPrivate": [refused("ledger.signature.declined", "You said no, so nothing moved."), { ok: { id: "m1", status: "done" } }] });
  await show(w);
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /Try Private/, "back to the offer");
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /You did it/);
  assert.equal(w.calls.filter((c) => c === "ledger.privateSetup").length, 1, "made once");
  runtime.unmount();
});

test("review M3: held by the account's rules: said plainly (nothing moved yet), with the way in", async () => {
  const w = wallet({ "ledger.quoteToPrivate": { ok: { id: "pq1" } }, "ledger.toPrivate": { ok: { id: "m1", status: "waiting", held: { id: "h1" } } } });
  const s = await show(w, false);
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /Your rules hold it/);
  assert.match(runtime.text(), /It waits for your yes in Waiting\./);
  assert.doesNotMatch(runtime.text(), /on its way/);
  runtime.press(/^Open ZeroFee$/);
  assert.equal(s.done(), 1);
  runtime.unmount();
});

test("review M2: a move that came back says where (Hidden), never 'still in your Safe'; refused before signing says the Safe (control)", async () => {
  const back = wallet({ "ledger.quoteToPrivate": { ok: { id: "pq1" } }, "ledger.toPrivate": { ok: { id: "m1", status: "moving" } }, "ledger.activity": { ok: [{ id: "m1", status: "refunded" }] } });
  await show(back, false);
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /It came back to you\. Find it in Private\./);
  assert.doesNotMatch(runtime.text(), /still in your Safe/);
  runtime.unmount();
  const before = wallet({ "ledger.quoteToPrivate": refused("ledger.private.quote", "1Click didn't give a safe price. Nothing was sent.") });
  const s = await show(before, false);
  runtime.press(/^Hide \$2$/);
  await settle();
  assert.match(runtime.text(), /Private didn't get it/);
  assert.match(runtime.text(), /1Click didn't give a safe price/);
  assert.match(runtime.text(), /Your money is still in your Safe\./);
  assert.ok(!before.calls.includes("ledger.toPrivate"), "nothing signed");
  runtime.press(/^Open ZeroFee$/);
  assert.equal(s.done(), 1);
  runtime.unmount();
});

test("Later goes straight in, and nothing is asked of Wallet", async () => {
  const w = wallet({});
  const s = await show(w);
  runtime.press(/^Later$/);
  assert.equal(s.done(), 1);
  assert.deepEqual(w.calls, []);
  runtime.unmount();
});
