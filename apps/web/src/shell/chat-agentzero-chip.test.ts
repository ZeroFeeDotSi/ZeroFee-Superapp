// AgentZero pays a Chat request (AZ2 job 3; D91, D98), on Chat's real RequestChip, rendered on the fake React runtime with
// a payer standing in for AgentZero's engine. Rows: the route off (the plain Send and one line, AgentZero never asked to
// pay), the route on (its words on the chip, its check on who gets paid BEFORE the tap, one payment for a double tap, the
// receipt), not sure it went and paid before (Pay never offered again), a refusal (its line, the plain Send back), and
// the requests AgentZero is never offered: asked of someone else, not USDC on NEAR, no payer.
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: (o?: { limit?: number }) => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let ShellContext: { Provider: unknown };
let RequestChip: FunctionComponent<Record<string, unknown>>;
let setPayer: (p: unknown) => void;
let azTestRoute: { on?: boolean };

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
  ShellContext = (await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx")).ShellContext;
  RequestChip = (await server.ssrLoadModule("@zerofee/chat/app/ChatApp.tsx")).RequestChip;
  setPayer = (await server.ssrLoadModule("@zerofee/shell-api/agentzero-pay.ts")).setAgentZeroPayer;
  azTestRoute = (await server.ssrLoadModule("@zerofee/chat/app/agentzero-chip.ts")).azTestRoute;
});
after(async () => server?.close());
beforeEach(() => {
  setPayer(null);
  delete azTestRoute.on;
});

const KIM = { amount: "5", coin: "USDC", chain: "near", address: "kim.near" };

/** A payer that answers as told and records every call. */
function payer(o: { offer?: unknown; paid?: unknown }) {
  const calls: { method: string; ask: unknown; tap?: unknown }[] = [];
  setPayer({
    offer: async (ask: unknown) => (calls.push({ method: "offer", ask }), o.offer ?? { ok: true, line: "Pay $5 · AgentZero" }),
    payRequest: async (ask: unknown, tap: unknown) => (calls.push({ method: "payRequest", ask, tap }), await new Promise((r) => setTimeout(r, 5)), o.paid ?? { kind: "paid", line: "Paid", txHash: "H1" }),
  });
  return calls;
}

/** Chat's device store, kept across mounts like the phone's (a reload). */
const store = new Map<string, string | null>();
beforeEach(() => store.clear());
const bridge = {
  call: async (method: string, p: { key?: string; value?: string | null } = {}) => {
    if (method === "device.store.get") return { ok: { value: store.get(String(p.key)) ?? null } };
    if (method === "device.store.set") return (store.set(String(p.key), p.value ?? null), { ok: null });
    return { ok: null };
  },
  on: () => () => {},
};

async function chip(request: Record<string, unknown>, me: string | null = "me.near") {
  const paidMarks: string[] = [];
  const plain: string[] = [];
  const money = { opening: null, payRequest: async () => void plain.push("plain"), onPaid: (id: string) => void paidMarks.push(id) };
  const ctx = { bridge, openApp: () => {}, openMoney: () => {}, showProblem: async () => ({ kind: "nothing" }), showWaiting: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
  await runtime.mount(createElement(ShellContext.Provider as never, { value: ctx }, createElement(RequestChip as never, { request, asked: { id: "req-1", atIso: "2026-11-02T12:00:00Z" }, who: "kim.near", money, paid: {}, activity: [], me })), { limit: 40 });
  return { paidMarks, plain };
}

test("route off (until the test proof): the plain Send and one line; AgentZero is never asked to pay", async () => {
  const calls = payer({ offer: { ok: true, line: "Pay $5 · AgentZero", warn: "First time paying kim.near." } });
  const { plain } = await chip(KIM);
  const t = runtime.text();
  assert.match(t, /^Pay 5 USDC on NEAR$/m, "the plain chip");
  assert.match(t, /AgentZero can't pay this privately yet\./);
  assert.doesNotMatch(t, /· AgentZero|First time paying/, "no AgentZero chip, no warning for a payment it won't make");
  runtime.press(/^Pay 5 USDC on NEAR$/);
  await runtime.settle({ limit: 20 });
  assert.deepEqual(plain, ["plain"], "the tap opens the plain Send (from Private only, D85)");
  assert.equal(calls.some((c) => c.method === "payRequest"), false);
  runtime.unmount();
});

test("route on: its words on the chip, the check on who gets paid shown BEFORE the tap, one payment for a double tap, the receipt", async () => {
  azTestRoute.on = true;
  const calls = payer({ offer: { ok: true, line: "Pay $5 · AgentZero", warn: "First time paying kim.near." } });
  const { paidMarks } = await chip(KIM);
  const before = runtime.text();
  assert.match(before, /Pay \$5 · AgentZero\nFirst time paying kim\.near\./, "the warn line sits under the chip before any tap");
  assert.equal(calls.filter((c) => c.method === "payRequest").length, 0);
  runtime.press(/Pay \$5 · AgentZero/);
  runtime.press(/Pay \$5 · AgentZero|Paying…/); // a second tap while the first is on its way
  await runtime.settle({ limit: 40 });
  const pays = calls.filter((c) => c.method === "payRequest");
  assert.equal(pays.length, 1, "one payment");
  assert.deepEqual(pays[0]!.ask, { requestId: "req-1", to: "kim.near", usd: 5 });
  assert.deepEqual(paidMarks, ["req-1"], "the request is marked paid");
  assert.match(runtime.text(), /Paid \$5 to kim\.near through NEAR Intents\. Only the middle of the payment is hidden\./);
  runtime.unmount();
});

test("control: with no warning from AgentZero's check, no warn line", async () => {
  azTestRoute.on = true;
  payer({ offer: { ok: true, line: "Pay $5 · AgentZero" } });
  await chip(KIM);
  assert.match(runtime.text(), /Pay \$5 · AgentZero/);
  assert.doesNotMatch(runtime.text(), /First time paying/);
  runtime.unmount();
});

test("not sure it went, or paid before: Pay is never offered again for that request", async () => {
  azTestRoute.on = true;
  payer({ paid: { kind: "unknown", line: "Not sure it went. Check Activity before you pay again." } });
  await chip(KIM);
  runtime.press(/Pay \$5 · AgentZero/);
  await runtime.settle({ limit: 40 });
  assert.match(runtime.text(), /Not sure it went\. Check Activity before you pay again\./);
  assert.doesNotMatch(runtime.text(), /^Pay /m, "no Pay of any kind");
  runtime.unmount();
  store.clear(); // another situation for the same request: nothing kept from the first
  payer({ offer: { ok: false, line: "Paid by AgentZero · $5" } });
  await chip(KIM);
  assert.match(runtime.text(), /Paid by AgentZero · \$5/);
  assert.doesNotMatch(runtime.text(), /^Pay /m);
  runtime.unmount();
});

test("refused: its line, and the plain Send back", async () => {
  azTestRoute.on = true;
  payer({ paid: { kind: "refused", line: "Over today's limit. Nothing was sent." } });
  await chip(KIM);
  runtime.press(/Pay \$5 · AgentZero/);
  await runtime.settle({ limit: 40 });
  const t = runtime.text();
  assert.match(t, /Over today's limit\. Nothing was sent\./);
  assert.match(t, /^Pay 5 USDC on NEAR$/m);
  runtime.unmount();
});

test("never offered to AgentZero: asked of someone else, not USDC on NEAR, an address that isn't a NEAR account, no payer", async () => {
  azTestRoute.on = true;
  for (const r of [{ ...KIM, from: "bob.near" }, { ...KIM, coin: "NEAR" }, { ...KIM, chain: "base", address: "0x1111111111111111111111111111111111111111" }]) {
    const calls = payer({});
    await chip(r);
    assert.deepEqual(calls, [], JSON.stringify(r));
    assert.doesNotMatch(runtime.text(), /AgentZero/);
    runtime.unmount();
  }
  // asked of this person: offered
  const mine = payer({});
  await chip({ ...KIM, from: "me.near" });
  assert.equal(mine.filter((c) => c.method === "offer").length, 1);
  runtime.unmount();
  setPayer(null);
  await chip(KIM);
  assert.match(runtime.text(), /^Pay 5 USDC on NEAR$/m, "no payer: the plain chip only");
  runtime.unmount();
});

test("break rows: no answer mid-pay (offline) is 'not sure', never Pay again; not on the pay list is the plain Send", async () => {
  azTestRoute.on = true;
  setPayer({ offer: async () => ({ ok: true, line: "Pay $5 · AgentZero" }), payRequest: async () => { throw new Error("offline"); } });
  await chip(KIM);
  runtime.press(/Pay \$5 · AgentZero/);
  await runtime.settle({ limit: 40 });
  assert.match(runtime.text(), /Not sure it went\. Check Activity before you pay again\./);
  assert.doesNotMatch(runtime.text(), /^Pay /m, "no Pay of any kind after an unknown");
  assert.doesNotMatch(runtime.text(), /Nothing was sent/, "never claims nothing went");
  runtime.unmount();
  store.clear(); // another situation for the same request: nothing kept from the first
  payer({ offer: { ok: false, line: "kim.near isn't on your pay list." } });
  await chip(KIM);
  assert.match(runtime.text(), /^Pay 5 USDC on NEAR$/m, "not on the list: the plain chip");
  runtime.unmount();
});

test("adversarial: a stranger's message never pays; AgentZero is asked to pay only from the chip's own tap", async () => {
  azTestRoute.on = true;
  const calls = payer({});
  await chip(KIM);
  await runtime.settle({ limit: 40 });
  assert.equal(calls.filter((c) => c.method === "payRequest").length, 0, "showing the chip pays nothing");
  assert.deepEqual(calls.map((c) => c.method), ["offer"], "an offer only, until the person taps");
  runtime.unmount();
});

test("review M1, then 3 Nov: a real account with the route off (the engine says so itself): the plain Send, and no AgentZero line", async () => {
  // 0ce3ff96: on a real account AgentZero can't pay people, so Chat offers no dead AgentZero line under the chip
  payer({ offer: { ok: false, line: "AgentZero can't pay this privately yet." } });
  await chip(KIM);
  const t = runtime.text();
  assert.match(t, /^Pay 5 USDC on NEAR$/m);
  assert.doesNotMatch(t, /AgentZero/);
  runtime.unmount();
  // control: sample money (the engine offers, the route is off) still says the line (review M1)
  payer({ offer: { ok: true, line: "Pay $5 · AgentZero" } });
  await chip(KIM);
  assert.match(runtime.text(), /AgentZero can't pay this privately yet\./);
  runtime.unmount();
});

test("review M2: 'not sure it went' is kept on the device: after a reload no Pay comes back, not even the plain one", async () => {
  azTestRoute.on = true;
  payer({ paid: { kind: "unknown", line: "Not sure it went. Check Activity before you pay again." } });
  await chip(KIM);
  runtime.press(/Pay \$5 · AgentZero/);
  await runtime.settle({ limit: 40 });
  runtime.unmount();
  // a reload, offline: AgentZero doesn't answer at all
  delete azTestRoute.on;
  setPayer({ offer: async () => { throw new Error("offline"); }, payRequest: async () => { throw new Error("offline"); } });
  await chip(KIM);
  assert.match(runtime.text(), /Not sure it went\. Check Activity before you pay again\./);
  assert.doesNotMatch(runtime.text(), /^Pay /m, "no Pay of any kind");
  runtime.unmount();
  // control: another request on the same device is unaffected
  store.clear();
  setPayer({ offer: async () => { throw new Error("offline"); }, payRequest: async () => { throw new Error("offline"); } });
  await chip(KIM);
  assert.match(runtime.text(), /^Pay 5 USDC on NEAR$/m);
  runtime.unmount();
});

test("review M2: while AgentZero hasn't answered for a request it may pay, the plain Pay is off", async () => {
  setPayer({ offer: () => new Promise(() => {}), payRequest: async () => ({ kind: "paid", line: "" }) });
  const { plain } = await chip(KIM);
  assert.throws(() => runtime.press(/^Pay 5 USDC on NEAR$/), /is off/);
  assert.deepEqual(plain, []);
  runtime.unmount();
});

test("review L4: an amount past the cent is never AgentZero's (the chip says dollars to the cent)", async () => {
  azTestRoute.on = true;
  const calls = payer({});
  await chip({ ...KIM, amount: "5.123456" });
  assert.deepEqual(calls, []);
  runtime.unmount();
});
