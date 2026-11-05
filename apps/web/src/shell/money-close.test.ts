// The phone test (3 Nov): "Put money in pump.fun" sat on a quote that never came back, and its ✕ did nothing, so he
// force-quit. Now every money sheet's Close always closes. A price behind it waits as long as the relay does (20 s,
// QUOTE_WAIT_MS: a real quote often takes 3 to 10 s), counting the seconds ("Getting a price… 0:07"); only then, or
// when the relay itself says so, it says "1Click didn't answer." with Try again; a price refused at once says why, never
// "didn't answer" (phone test, 3 Nov). On the test's own clock (mock timers), never the wall's.
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge, BridgeResult } from "@zerofee/core/bridge";

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void; pressNamed: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let SiteAddSheet: FunctionComponent<Record<string, unknown>>;
let MoneySheet: FunctionComponent<Record<string, unknown>>;
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let consts: { FEE_LATE_LINE: string; FEE_WAIT_LINE: string; AWAY_SLOW_LINE: string; AWAY_SLOW_MS: number; QUOTE_WAIT_MS: number };

/** Every timer armed on a test's mocked clock, so done() takes out what is left before the clock is reset. Node's
 *  mock.timers.reset() drops its queue but leaves each timer's queue position on it, and a clearTimeout of such a timer
 *  under the next test's clock takes out whatever timer sits at that position there. Vite's module runner arms one
 *  for every import() it loads (AppHost's lazy modules) and clears it when the module comes back; under a landing's
 *  load that came back during the next test and took out the fake runtime's settle turn, so settled() waited for ever. */
const armed = new Set<ReturnType<typeof setTimeout>>();
{
  const enable = mock.timers.enable.bind(mock.timers);
  mock.timers.enable = (o) => {
    enable(o);
    const arm = globalThis.setTimeout;
    globalThis.setTimeout = ((...a: Parameters<typeof setTimeout>) => {
      const t = arm(...a);
      armed.add(t);
      return t;
    }) as typeof setTimeout;
  };
}

before(async () => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
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
  ({ AppHost } = await server.ssrLoadModule("./shell/AppHost.tsx"));
  const site = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx");
  const money = await server.ssrLoadModule("@zerofee/design/MoneySheet.tsx");
  SiteAddSheet = site.SiteAddSheet;
  MoneySheet = money.MoneySheet;
  consts = { FEE_LATE_LINE: site.FEE_LATE_LINE, FEE_WAIT_LINE: site.FEE_WAIT_LINE, AWAY_SLOW_LINE: money.AWAY_SLOW_LINE, AWAY_SLOW_MS: money.AWAY_SLOW_MS, QUOTE_WAIT_MS: money.QUOTE_WAIT_MS };
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 3_000).unref();
});

const SITE = "sw-site-pump-sol";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const COINS = [{ tokenId: USDC, symbol: "USDC", usd: "30.00", amount: "30" }];

/** The mock, with the fee's quote and the move itself never answering (a 1Click that hangs). */
function hung(): Bridge {
  const inner = mockBridge();
  return {
    call: ((method: string, p?: Record<string, unknown>) => (method === "subwallet.site.addCost" || method === "spending.topUp" ? new Promise(() => {}) : inner.call(method, p))) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
}
/** The mock, with the fee's price answered after `ms` on the test's clock: a figure, a refusal at once, or 1Click unreachable. */
function priceAfter(ms: number, answer: "fee" | "refused" | "unreachable" = "fee"): Bridge {
  const inner = mockBridge();
  const problem = answer === "refused"
    ? { code: "security.subwallet.refused", whatHappened: "This wallet can't approve this, so ZeroFee said no.", more: "1Click said no. Nothing moved.", money: { state: "safe", where: "in that wallet" }, next: { kind: "nothing", label: "Go back" } }
    : { code: "security.partner.unreachable", whatHappened: "1Click didn't answer, so ZeroFee stopped. Nothing was sent.", money: { state: "safe", where: "in your Safe" }, next: { kind: "retry", label: "Try again" }, service: "oneclick" };
  return {
    call: ((method: string, p?: Record<string, unknown>) => {
      if (method !== "subwallet.site.addCost") return inner.call(method, p);
      return new Promise((r) => setTimeout(() => r(answer === "fee" ? { ok: { feeUsd: 0.5, legsUsd: [0.1, 0.4] } } : { problem }), ms));
    }) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
}
async function mountSite(bridge: Bridge, onClose: () => void = () => {}, props: Record<string, unknown> = {}): Promise<void> {
  const render = () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", coins: COINS, onClose, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {}, ...props });
  const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render }];
  void runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
  await settled();
}

/** Lets the tree settle on the mocked clock: the fake runtime waits on setTimeout(0), so the clock is ticked meanwhile. */
async function settled(): Promise<void> {
  let done = false;
  void runtime.settle().then(() => (done = true));
  // bounded by real time, not a count of turns: on a loaded machine a settle that loads a module needs more turns
  // (5,000 ran out in 1 run of 4 under a landing's test load). It ends as soon as the tree has settled.
  const until = performance.now() + 30_000;
  while (!done && performance.now() < until) { mock.timers.tick(0); await new Promise((r) => setImmediate(r)); }
  assert.ok(done, "settled");
}
/** A clock test's end: the tree unmounted and let settle on the mocked clock, then the real clock back (a settle left
 *  waiting on a mocked turn would hold the next test's). */
async function done(): Promise<void> {
  runtime.unmount();
  await settled().catch(() => undefined);
  // on the mocked clock still: each timer leaves its queue for good, so a late clearTimeout of it touches nothing after
  for (const t of armed) clearTimeout(t);
  armed.clear();
  mock.timers.reset();
  // a turn of the real clock: anything the mocked one left (a settle's last turn) runs out before the next test
  await new Promise((r) => setTimeout(r, 20));
}
/** The clock moved one second at a time (a ticking line's next second is set by the one before). */
async function seconds(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await wait(1_000);
}
/** Close here is counted the moment it's tapped: under Reduce Motion a sheet goes at once, with no fall (Sheet.tsx FALL_MS;
 *  the fall itself is tray-locked's), so a sheet a test keeps on screen takes its next Close too. Returns the undo. */
function stillMotion(): () => void {
  const g = globalThis as { matchMedia?: unknown };
  const was = g.matchMedia;
  g.matchMedia = (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  return () => { g.matchMedia = was; };
}
async function wait(ms: number): Promise<void> {
  mock.timers.tick(ms);
  await settled();
}

test("a price at 7 s lands (no \"didn't answer\"); one at 21 s has said \"1Click didn't answer.\" at 20 s (control)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mountSite(priceAfter(7_000));
    await seconds(6);
    await wait(990);
    assert.ok(runtime.text().includes("Getting a price… 0:06"), runtime.text());
    await wait(20);
    assert.ok(runtime.text().includes("About $0.50 in fees."), `the price at 7 s is shown\n${runtime.text()}`);
    assert.ok(!runtime.text().includes(consts.FEE_LATE_LINE), "a 7 s price never says it didn't answer");
    assert.ok(!/Getting a price/.test(runtime.text()), "the waiting line is gone");
    runtime.unmount();
    await mountSite(priceAfter(21_000));
    await seconds(19);
    await wait(990);
    assert.ok(!runtime.text().includes(consts.FEE_LATE_LINE), "control: not before 20 s");
    await wait(20);
    assert.ok(runtime.text().includes(consts.FEE_LATE_LINE), `21 s: past the relay's own wait\n${runtime.text()}`);
  } finally {
    await done();
  }
});

test("a price refused at once says why, never \"didn't answer\"; the relay saying 1Click didn't answer is asked again silently, and only a failed retry says it, the 9a way (control)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mountSite(priceAfter(150, "refused"));
    await wait(200);
    assert.ok(runtime.text().includes("1Click said no. Nothing moved."), runtime.text());
    assert.ok(!runtime.text().includes(consts.FEE_LATE_LINE), "a refusal is never \"didn't answer\"");
    runtime.unmount();
    await mountSite(priceAfter(150, "unreachable"));
    await wait(200);
    // rule 9a (the proof run's Sim walk, 5 Nov): never "1Click didn't answer." on the first miss: it is asked again silently
    assert.ok(!/didn't answer/.test(runtime.text()), `the first miss is silent\n${runtime.text()}`);
    await wait(2_000);
    await wait(200);
    assert.ok(runtime.text().includes(consts.FEE_LATE_LINE), `control: the retry failed too, so it is said\n${runtime.text()}`);
    assert.equal(consts.FEE_LATE_LINE, "NEAR Intents didn't answer. ZeroFee keeps asking. You can still tap Add.", "what is down, what ZeroFee does, whether money moves");
    const { feeLateLine } = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx");
    assert.equal(feeLateLine("oneclick", true), "NEAR Intents isn't answering. ZeroFee keeps asking. Add waits until it's back. Your money stays in your Safe.", "control: really down, Add waits");
  } finally {
    await done();
  }
});

test("Put money in says where the money comes from and how much is there, with Max; over it, refused before any price is asked (control: under it, asked)", async () => {
  const asked: string[] = [];
  const inner = mockBridge();
  const bridge: Bridge = {
    call: ((method: string, p?: Record<string, unknown>) => {
      if (method === "subwallet.site.addCost") { asked.push(String(p?.usd)); return Promise.resolve({ ok: { feeUsd: 0.1, legsUsd: [0, 0.1] } }); }
      return inner.call(method, p);
    }) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mountSite(bridge);
    assert.ok(runtime.text().includes("From your Safe · $30.00 available"), runtime.text());
    // over what the Safe has: 100 on the keypad
    asked.length = 0;
    for (const k of ["1", "0", "0"]) { runtime.press(new RegExp(`^${k}$`)); await wait(400); }
    assert.ok(runtime.text().includes("$100"), runtime.text());
    assert.ok(runtime.text().includes("That's more than your Safe has."), runtime.text());
    assert.deepEqual(asked, [], "no price asked for more than the Safe has");
    // Max: all the Safe has, and the line goes
    runtime.pressNamed(/^Max, \$30\.00$/);
    await wait(400);
    assert.ok(runtime.text().split("\n").includes("$30"), runtime.text());
    assert.ok(!runtime.text().includes("That's more than your Safe has."), runtime.text());
    // control: an amount under what the Safe has is priced
    runtime.unmount();
    await mountSite(bridge);
    asked.length = 0;
    for (const k of ["1", "2"]) { runtime.press(new RegExp(`^${k}$`)); await wait(400); }
    assert.ok(!runtime.text().includes("That's more than your Safe has."), runtime.text());
    assert.deepEqual(asked, ["1.00", "12.00"].filter((u) => Number(u) >= 2), "under it: priced");
  } finally {
    await done();
  }
});

// last of the clock tests: it leaves a move that never answers behind it
test("a price that never answers: it counts the seconds and says \"1Click didn't answer.\" with Try again only at 20 s (control: not at 19.99 s, nor at 5 s), the move getting ready says it may be closed, and the ✕ closes it all the while", async () => {
  assert.equal(consts.QUOTE_WAIT_MS, 20_000, "as long as the relay waits for 1Click");
  assert.equal(consts.AWAY_SLOW_MS, 5_000, "the move getting ready still says so at 5 s");
  mock.timers.enable({ apis: ["setTimeout"] });
  const moving = stillMotion();
  try {
    let closed = 0;
    const bridge = hung();
    await mountSite(bridge, () => { closed++; });
    assert.ok(runtime.text().includes("Getting a price… 0:00"), runtime.text());
    await seconds(7);
    assert.ok(runtime.text().includes("Getting a price… 0:07"), `the seconds count up\n${runtime.text()}`);
    assert.ok(!runtime.text().includes(consts.FEE_LATE_LINE), "control: never at 5 s (the old limit)");
    await wait(12_990);
    assert.ok(!runtime.text().includes(consts.FEE_LATE_LINE), "control: not before 20 s");
    await wait(20);
    assert.ok(runtime.text().includes(consts.FEE_LATE_LINE), runtime.text());
    assert.ok(/Try again/.test(runtime.text()), "with Try again");
    // the ✕ while the price hangs: closes
    runtime.pressNamed(/^Close$/);
    assert.equal(closed, 1, "Close closed it while the quote hung");
    // the move itself hangs (1Click's quote inside it never answers): after 5 s the sheet says so, and Close still closes
    runtime.press(/^Add \$/);
    await settled();
    assert.ok(/Getting it ready…/.test(runtime.text()), "the move is getting ready");
    assert.ok(!runtime.text().includes(consts.AWAY_SLOW_LINE), "control: not at once");
    await wait(5_000);
    assert.ok(runtime.text().includes(consts.AWAY_SLOW_LINE), runtime.text());
    runtime.pressNamed(/^Close$/);
    assert.equal(closed, 2, "Close closed it while the move was getting ready (it used to do nothing)");
  } finally {
    moving();
    await done();
  }
});

test("every Home money sheet closes: MoneySheet hands its Close the sheet's own onClose even while a move gets ready; only Trade's own sending moment may hide it (control: closable false draws no Close)", async () => {
  let closed = 0;
  const moving = stillMotion();
  try {
    const bridge = mockBridge();
    const render = () => createElement(MoneySheet, { title: "Move", away: true, onClose() { closed++; } }, "body");
    const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render }];
    await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 60 });
    await runtime.settle();
    runtime.pressNamed(/^Close$/);
    assert.equal(closed, 1, "away (getting ready) still closes");
    const off = () => createElement(MoneySheet, { title: "Buy", closable: false, onClose() { closed++; } }, "body");
    await runtime.mount(createElement(AppHost, { apps: [{ ...apps[0]!, render: off }], onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 60 });
    await runtime.settle();
    assert.throws(() => runtime.pressNamed(/^Close$/), /nothing to tap/, "control: closable false draws no Close");
  } finally {
    moving();
  }
});

/** A Problem the mock would give, kept for the shape (unused). */
export type _P = BridgeResult<never>;
