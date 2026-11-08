// B28 R1 (product decision, 2 Nov): every money sheet opens with every outside service dead. For each of 1Click, NEAR
// Intents' bridge, NEAR, Solana, ZeroFee's quote relay and NEAR AI Cloud failing with 521, then 429, then a timeout,
// each sheet (Add, Send, Swap, Move, a site's Add, Take out, Chat's pay) opens in place and paints its title; the failure
// is one line on the sheet naming the service, only on a sheet that needs it; the shell's Problem screen never shows.
// A sheet whose service is down holds its button ("Add waits until it's back"); a busy or slow one keeps it, and a tap
// that fails is the line again, never a page. The faults are injected as the real layers answer them (shell-api
// faults.ts; its ledger half is checked against the real ledger in packages/wallet never-blocked.test.ts).
// B28_TABLE=<file> writes the results table (service × failure × sheet → result) for the proof.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";
import { SERVICES, SERVICE_NAMES, downLine, type Service } from "@zerofee/core/services";

/** The top banner's line (rule 9a: "<service> is down. <what waits> <what works>"), never the sheet's own. */
const isBanner = (l: string): boolean => / since /.test(l) || SERVICES.some((s) => l === downLine(s));

type Failure = 521 | 429 | "timeout";
const FAILURES: Failure[] = [521, 429, "timeout"];
let server: ViteDevServer;
/** Market data down on every door (StatusBanner.tsx MARKET_DOWN_LINE's start): never "busy since". */
const MARKET_DOWN = "GeckoTerminal is down. Trade shows the last prices.";
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string; press: (l: RegExp) => void };
let AppHost: FunctionComponent<Record<string, unknown>>;
let SiteAddSheet: FunctionComponent<Record<string, unknown>>;
let SiteBackSheet: FunctionComponent<Record<string, unknown>>;
let useShell: () => { openMoney: (ask: unknown) => void };
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;
let faultedBridge: (b: Bridge, f: { service: Service; failure: Failure }) => Bridge;
let SHEET_NEEDS: Record<string, readonly Service[]>;
let needsWith: (base: readonly Service[], places: readonly string[]) => readonly Service[];
let sheetsLoaded: () => Promise<unknown>;
let LoadingSheet: FunctionComponent<Record<string, unknown>>;
let sendLink: (l: { to: string; chain: string; amount?: string; back?: string }) => string;

before(async () => {
  if (process.env.B28_LEAKS) {
    const timers = new Map<unknown, string>();
    (globalThis as any).__timers = timers;
    const set = globalThis.setTimeout, clear = globalThis.clearTimeout;
    (globalThis as any).setTimeout = (fn: () => void, ms?: number, ...a: unknown[]) => {
      const t = set(() => (timers.delete(t), fn()), ms, ...a);
      if ((ms ?? 0) >= 1000) timers.set(t, `${ms} ${new Error().stack?.split("\n").slice(2, 6).join(" | ")}`);
      return t;
    };
    (globalThis as any).clearTimeout = (t: unknown) => (timers.delete(t), clear(t as never));
    const every = globalThis.setInterval, stop = globalThis.clearInterval;
    (globalThis as any).setInterval = (fn: () => void, ms?: number, ...a: unknown[]) => {
      const t = every(fn, ms, ...a);
      timers.set(t, `INTERVAL ${ms} ${new Error().stack?.split("\n").slice(2, 6).join(" | ")}`);
      return t;
    };
    (globalThis as any).clearInterval = (t: unknown) => (timers.delete(t), stop(t as never));
  }
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
  const fake = fileURLToPath(new URL("../testing/fake-react.ts", import.meta.url));
  // D125: the test build (VITE_HOME_PROOF=1), where Home's Send and Add are on: every sheet here is the one a tester
  // tests. Off (a release build), Send and Add are one line and Close, checked in their own tests.
  process.env.VITE_HOME_PROOF = "1";
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
  ({ useShell } = await server.ssrLoadModule("@zerofee/shell-api/AppFrame.tsx"));
  ({ SiteAddSheet, SiteBackSheet } = await server.ssrLoadModule("@zerofee/wallet/app/money/SiteMoney.tsx"));
  ({ SHEET_NEEDS, needsWith } = await server.ssrLoadModule("@zerofee/wallet/app/services.ts"));
  ({ sheetsLoaded, LoadingSheet } = await server.ssrLoadModule("@zerofee/wallet/app/money/MoneyHost.tsx"));
  ({ faultedBridge } = await server.ssrLoadModule("@zerofee/shell-api/faults.ts"));
  ({ sendLink } = await server.ssrLoadModule("@zerofee/pay/app/links.ts"));
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => {
  runtime?.unmount();
  await server?.close();
  // Every sheet's timers are stopped above (B28_LEAKS=1 lists any left: only sayWent's 5 s line), yet vite's dev server
  // keeps a pipe open after 126 mounts, and the file would never end: once every test has reported, it ends itself.
  setTimeout(() => process.exit(process.exitCode ?? 0), 6_000).unref();
});

const SITE = "sw-site-pump-sol";
/** Spending and the site's wallet, as the core's engine answers them (a bare mock has no engine). */
function withSpending(inner: Bridge): Bridge {
  const status = { loaded: true, totalUsd: "40.00", cashUsd: "30.00", coinsUsd: "10.00", capUsd: "500", roomUsd: "460.00", ready: true, networks: [], onItsWay: [], firstTopUp: false };
  const wallets = [{ id: SITE, role: "site", site: "pump", network: "sol", address: "So1ana1111111111111111111111111111111111111", label: "pump.fun wallet", current: true, cashUsd: "12.00" }];
  return {
    call: ((m: string, p?: Record<string, unknown>) =>
      m === "spending.status" ? Promise.resolve({ ok: status })
      : m === "spending.wallets" ? Promise.resolve({ ok: wallets })
      // a move whose services all answer goes on to the core's Approve sheet; here the person says No (nothing moves)
      : m === "spending.topUp" || m === "spending.putAway" || m === "subwallet.site.moveBack" ? Promise.resolve({ ok: { declined: true } })
      : inner.call(m, p)) as Bridge["call"],
    on: (e, h) => inner.on(e, h),
  };
}

interface Sheet { name: string; kind: string; title: RegExp; go?: RegExp; open: (shell: { openMoney: (a: unknown) => void }) => void; direct?: () => unknown }
const SHEETS = (): Sheet[] => [
  // audit 13's D5: Home's Add list needs NEAR Intents, its bridge and NEAR Confidential (wallet services.ts addAddress)
  { name: "Add", kind: "addAddress", title: /Add money/, open: (s) => s.openMoney({ kind: "receive" }) },
  { name: "Send", kind: "send", title: /^Send$/m, open: (s) => s.openMoney({ kind: "send" }) },
  { name: "Swap", kind: "swap", title: /Swap (NEAR|USDT) for USDC|^Swap$/m, go: /^Swap \$/, open: (s) => s.openMoney({ kind: "swap" }) },
  { name: "Move", kind: "move", title: /Move to your NEAR wallet/, go: /^Move \$/, open: (s) => s.openMoney({ kind: "topup" }) },
  { name: "Site Add", kind: "siteadd", title: /Add \$[0-9.]+ to your pump\.fun wallet/, go: /^Add \$/, open: () => {}, direct: () => createElement(SiteAddSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {}, onHeld() {}, onOpen() {}, onAdd() {} }) },
  { name: "Take out", kind: "takeout", title: /Take out to your Safe/, go: /^Take out \$/, open: () => {}, direct: () => createElement(SiteBackSheet, { wallet: SITE, name: "pump.fun", safeUsd: "30.00", onClose() {}, onDone() {} }) },
  { name: "Chat pay", kind: "send", title: /^Send$/m, open: (s) => s.openMoney({ kind: "send", link: sendLink({ to: "alex.near", chain: "near", amount: "1", back: "chat" }) }) },
];

/** What the shell's Problem screen says on every Problem (ProblemView's money line): never on screen here. */
const PROBLEM_PAGE = /Your money hasn't moved\.|Your money is waiting for you:|Details for ZeroFee/;
const rows: string[] = ["service | failure | sheet | result | line on the sheet"];

async function open(sheet: Sheet, bridge: Bridge): Promise<string> {
  const opener = () =>
    createElement(function Page() {
      const shell = useShell();
      return createElement("button", { onClick: () => sheet.open(shell) }, "OPEN-SHEET");
    });
  const apps = [
    { id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render: sheet.direct ?? opener },
  ];
  await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
  if (!sheet.direct) {
    runtime.press(/^OPEN-SHEET$/);
    // the sheets whose code loads after Home are here before the screen is read: the wait is on their own load, never a
    // clock (a busy machine made Swap's row read its "Reading your money…" before its code arrived)
    await sheetsLoaded();
    await runtime.settle();
  }
  await runtime.settle();
  return runtime.text();
}

for (const service of SERVICES) {
  for (const failure of FAILURES) {
    test(`${SERVICE_NAMES[service]} answers ${failure}: every money sheet opens, paints, and says it in one line only where it is needed`, async () => {
      for (const sheet of SHEETS()) {
        const bridge = faultedBridge(withSpending(mockBridge()), { service, failure });
        try {
        const shown = await open(sheet, bridge);
        // audit 16's G3: Swap opens on the Safe's USDC into the SOL wallet, so it needs Solana too (wallet needsWith)
        const needs = (sheet.kind === "swap" ? needsWith(SHEET_NEEDS.swap!, ["safe-usdc", "sol"]) : SHEET_NEEDS[sheet.kind]!).includes(service);
        const label = `${SERVICE_NAMES[service]} ${failure}, ${sheet.name}`;
        assert.match(shown, sheet.title, `${label}: the sheet paints its title`);
        assert.doesNotMatch(shown, PROBLEM_PAGE, `${label}: never the shell's Problem screen`);
        // the sheet's own line (the top banner, "… is down since …", is checked on its own below)
        const line = shown.split("\n").find((l) => l.startsWith(SERVICE_NAMES[service]) && /\.( |$)/.test(l) && !isBanner(l) && !l.startsWith(MARKET_DOWN)) ?? null;
        // phone test, 5 Nov: market data is never "busy since" or "slow since"; down (every door) is its one calm line
        // rule 9a (product decision, 5 Nov "NEAR is slow since <a time>"): only down is said, as one calm line, never "since"
        const banner = service === "gecko" ? shown.split("\n").some((l) => l.startsWith(MARKET_DOWN)) : shown.split("\n").some((l) => l.startsWith(`${SERVICE_NAMES[service]} is down. `));
        assert.doesNotMatch(shown, / is (busy|slow|down) since /, `${label}: never a "since" banner`);
        // NEAR AI Cloud is AgentZero's chat's own line, never the shell's notice (restore crawl, 4 Nov)
        assert.equal(banner, service !== "nearai" && failure === 521, `${label}: the top banner names it only when it is down (never NEAR AI Cloud)`);
        assert.doesNotMatch(shown, /is (busy|slow) right now\. \w+ may take longer/, `${label}: before the tap, busy or slow is never said`);
        if (needs && failure === 521) assert.ok(line, `${label}: one line naming ${SERVICE_NAMES[service]}\n${shown}`);
        else if (!needs) assert.equal(line, null, `${label}: no line about a service this sheet doesn't use`);
        let result = needs ? (failure === 521 ? "opens · waits (button held)" : "opens · line") : "opens · not needed";
        // a busy or slow service keeps the button; the tap that fails is the line on the sheet again
        // a site's wallet Solana hasn't read has no button to tap yet: its line says so, and it is read again by itself
        const hasGo = !!sheet.go && shown.split("\n").some((l) => sheet.go!.test(l));
        if (needs && sheet.go && !hasGo) result += " · nothing to tap until read";
        if (needs && failure !== 521 && sheet.go && hasGo) {
          runtime.press(sheet.go);
          await runtime.settle();
          await runtime.settle();
          const after = runtime.text();
          assert.doesNotMatch(after, PROBLEM_PAGE, `${label}: the failed tap is not a page`);
          assert.match(after, sheet.title, `${label}: the sheet is still up after the tap`);
          // the sheet's own line names it (not the banner): the tap's failure with the money line, or the quiet line before the tap
          // rule 9a: a busy or slow door is the failover's: a tap that still failed names it with where the money is; one
          // that went says nothing about it (never "may take longer")
          const named = after.split("\n").filter((l) => l.startsWith(SERVICE_NAMES[service]) && !isBanner(l));
          assert.ok(named.every((l) => /Your money is/.test(l)) && !/may take longer/.test(after), `${label}: the sheet's line, if any, names it with where the money is\n${after}`);
          result += " · tap → line";
        }
        if (needs && failure === 521 && sheet.go) assert.throws(() => runtime.press(sheet.go!), /is off|nothing to tap/, `${label}: waits until it's back (its button held, or not shown while unread)`);
        rows.push(`${SERVICE_NAMES[service]} | ${failure} | ${sheet.name} | ${result} | ${line ?? "(none)"}`);
        } catch (e) {
          // said at once (a long screen in the message is cut, so the report never stalls on it)
          const said = String((e as Error).message).slice(0, 1500);
          console.error(`FAILED: ${said}`);
          throw new Error(said);
        } finally {
          // every effect's cleanup (the sheet's service check, its read-again timers), pass or fail
          runtime.unmount();
        }
      }
    });
  }
}

test("B30: with a service dead the banner names it, since when, what waits and what works, with its own status link; when it is back it says so and leaves", async () => {
  const { StatusBanner, STATUS_EVERY_MS } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  assert.ok(STATUS_EVERY_MS <= 30_000, "read at least twice a minute: shows within 60 s of a death and leaves within 60 s of the return");
  // A hand-run clock (landing rule: no wall-clock waits): the banner's timers queue here and the test fires them.
  type Due = { fn: () => void; ms: number; id: number };
  let queue: Due[] = [];
  let next = 1;
  const timers = { set: (fn: () => void, ms: number) => { const id = next++; queue.push({ fn, ms, id }); return id; }, clear: (h: unknown) => { queue = queue.filter((d) => d.id !== h); } };
  /** Fire every timer of this length that is queued now, then let the screen settle. */
  const fire = async (ms: number) => {
    const due = queue.filter((d) => d.ms === ms);
    assert.ok(due.length > 0, `a timer of ${ms} ms is queued`);
    queue = queue.filter((d) => d.ms !== ms);
    for (const d of due) d.fn();
    await runtime.settle();
  };
  const EVERY = 20, BACK = 60;
  // NEAR AI Cloud is never the shell's notice (restore crawl, 4 Nov; its own test below)
  for (const service of SERVICES.filter((x) => x !== "nearai")) {
    let dead = true;
    queue = [];
    const bridge = faultedBridge(mockBridge(), () => (dead ? { service, failure: 521 } : null), new Date(Date.now() - 5 * 60_000).toISOString());
    try {
      // clearMs 0: "back" on the first fine read (the 90 s spell is status-spell.test.ts's)
      await runtime.mount(createElement(StatusBanner, { bridge, everyMs: EVERY, backMs: BACK, clearMs: 0, timers }), { limit: 60 });
      await runtime.settle();
      // one line at the bottom: who and since when (product decision, 3 Nov); a tap on it says the rest
      const line = runtime.text();
      // rule 9a: what is down and whether money moves, one calm line, never "since"
      const head = service === "gecko" ? MARKET_DOWN : `${SERVICE_NAMES[service]} is down. `;
      assert.doesNotMatch(runtime.text(), / since /, `${service}: never "since"`);
      assert.ok(line.startsWith(head), `${service}: ${line}`);
      assert.doesNotMatch(line, /See their status/, `${service}: the links wait behind a tap`);
      runtime.press(new RegExp(`^${head.replace(/[.'()]/g, ".")}`));
      await runtime.settle();
      const shown = runtime.text();
      assert.match(shown, /can't go now\.|can't answer\.|are not fresh\.|are slow now\./, `${service}: what it holds up`);
      assert.match(shown, /works?\.|stays in your Safe\.|stays where it is\./, `${service}: what still works`);
      // never NEAR's (bug 8): status.near.org measures something else than the nodes this phone reads
      const linked = ["oneclick", "bridge", "solana", "helius"].includes(service);
      assert.equal(/See their status/.test(shown), linked, `${service}: its own status page, only where one is allow-listed`);
      rows.push(`banner | ${SERVICE_NAMES[service]} dead | ${shown.split("\n")[0]}`);
      dead = false;
      await fire(EVERY); // the next read finds it back
      assert.match(runtime.text(), new RegExp(`^${SERVICE_NAMES[service].replace(/[.']/g, ".")} is back\\.`), `${service}: back`);
      rows.push(`banner | ${SERVICE_NAMES[service]} back | ${runtime.text().split("\n")[0]}`);
      await fire(BACK); // "is back." has had its time
      assert.equal(runtime.text(), "", `${service}: the banner left by itself`);
    } finally {
      runtime.unmount();
    }
    assert.equal(queue.length, 0, `${service}: unmounting clears the banner's timers`);
  }
});

test("join walk (3 Nov): a phone that is offline never hears \"NEAR is down\" from the banner (Home says \"You're offline\"); control: online, it does", async () => {
  const { StatusBanner } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  const timers = { set: () => 0, clear: () => {} };
  const nav = globalThis.navigator as { onLine?: boolean };
  const had = Object.getOwnPropertyDescriptor(nav, "onLine");
  const shown = async (onLine: boolean) => {
    Object.defineProperty(nav, "onLine", { value: onLine, configurable: true });
    const bridge = faultedBridge(mockBridge(), { service: "near", failure: 521 }, new Date(Date.now() - 60_000).toISOString());
    try {
      await runtime.mount(createElement(StatusBanner, { bridge, timers }), { limit: 30 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  try {
    assert.equal(await shown(false), "", "offline: nothing blamed");
    assert.match(await shown(true), /^NEAR is down\. /, "control: online, NEAR named");
  } finally {
    if (had) Object.defineProperty(nav, "onLine", had);
    else delete nav.onLine;
  }
});

test("control: the check fails on a sheet that blanks to the Problem screen (a planted page)", () => {
  assert.match("Your money hasn't moved. It's in your Safe.\nTry again", PROBLEM_PAGE);
});

test("the hub's '$3.00 is on its way to pump.fun.' never shows the done tick (L7)", async () => {
  const { sayWent, onWent } = await server.ssrLoadModule("@zerofee/shell-api/money.ts");
  let seen: { text: string; state: string } | null = null;
  const off = onWent((l: { text: string; state: string } | null) => (seen = l));
  sayWent("$3.00 is on its way to pump.fun.");
  assert.equal(seen!.state, "quiet", "on its way: a dot, not a tick");
  sayWent("Sent $5.00 to alex.near");
  assert.equal(seen!.state, "went", "control: a send that landed keeps its tick");
  sayWent("");
  off();
});

after(() => {
  if (process.env.B28_TABLE) writeFileSync(process.env.B28_TABLE, rows.join("\n") + "\n");
  if (process.env.B28_LEAKS) setTimeout(() => console.log("LEFT", JSON.stringify(process.getActiveResourcesInfo()), [...(globalThis as any).__timers.values()].join("\n---\n")), 2000).unref();
});

test("a sheet whose code is still on its way names a dead service it needs at once (Swap), and none it doesn't (Add): the line never waits on the code", async () => {
  for (const [kind, title] of [["swap", "Swap"], ["add", "Add money"]] as const) {
    const bridge = faultedBridge(withSpending(mockBridge()), { service: "oneclick", failure: 521 });
    const apps = [{ id: "wallet", name: "Home", line: "", bridge: forApps(bridge, "wallet"), render: () => createElement(LoadingSheet, { title, kind, words: "Reading…", onClose() {} }) }];
    await runtime.mount(createElement(AppHost, { apps, onMenu: () => {}, shellBridge: bridge, start: { id: "wallet" } }), { limit: 120 });
    await runtime.settle();
    const shown = runtime.text();
    runtime.unmount();
    assert.match(shown, new RegExp(`^${title}$`, "m"), `${title}: its title`);
    const named = shown.split("\n").some((l) => l.startsWith(SERVICE_NAMES.oneclick) && !isBanner(l));
    // Swap needs 1Click: named while its code loads; Add (the Safe's own address) doesn't: never a line about it
    if (kind === "swap") assert.ok(named, `${title}: the sheet's own line names 1Click while its code loads\n${shown}`);
    else assert.ok(!named, `${title}: no line about a service it doesn't use\n${shown}`);
  }
});

/** A bridge whose Spending never answers: the race made certain (the sheet is up before its money is read). */
const spendingNeverAnswers = (inner: Bridge): Bridge => ({
  call: ((m: string, p?: Record<string, unknown>) => (m === "spending.status" ? new Promise(() => {}) : inner.call(m, p))) as Bridge["call"],
  on: (e, h) => inner.on(e, h),
});

test("the race made certain: Spending not read yet, the Swap and Move sheets still name 1Click when it's down (control: before 3 Nov the waiting sheet had no line)", async () => {
  for (const sheet of SHEETS().filter((s) => s.name === "Swap" || s.name === "Move")) {
    const shown = await open(sheet, faultedBridge(spendingNeverAnswers(withSpending(mockBridge())), { service: "oneclick", failure: 521 }));
    runtime.unmount();
    assert.match(shown, sheet.title, `${sheet.name}: its title`);
    assert.ok(shown.split("\n").some((l) => l.startsWith(SERVICE_NAMES.oneclick) && /\.( |$)/.test(l) && !isBanner(l)), `${sheet.name}: the line names 1Click while Spending is read\n${shown}`);
    assert.doesNotMatch(shown, /Reading Spending/, `${sheet.name}: never "Spending" on the sheet`);
  }
});

test("the Swap row with 1Click down passes 20 times in a row under CPU load (busy workers): no timer, read or microtask outruns the wait", async () => {
  const { Worker } = await import("node:worker_threads");
  const busy = Array.from({ length: 4 }, () => new Worker("const end = Date.now() + 120000; while (Date.now() < end) {}", { eval: true }));
  const swap = SHEETS().find((s) => s.name === "Swap")!;
  const fails: string[] = [];
  try {
    for (let i = 0; i < 20; i++) {
      const shown = await open(swap, faultedBridge(withSpending(mockBridge()), { service: "oneclick", failure: 521 }));
      runtime.unmount();
      const line = shown.split("\n").find((l) => l.startsWith(SERVICE_NAMES.oneclick) && /\.( |$)/.test(l) && !isBanner(l));
      if (!line || !/Swap/.test(shown)) fails.push(`run ${i + 1}:\n${shown}`);
    }
  } finally {
    await Promise.all(busy.map((w) => w.terminate()));
  }
  assert.deepEqual(fails, [], fails.join("\n----\n"));
});

test("bug 8: the banner says a service is down only when this phone and the relay both saw it (one source alone says nothing up there); control: both do", async () => {
  const { StatusBanner } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  const timers = { set: () => 0, clear: () => {} };
  const say = async (seen: string) => {
    const bridge = { call: async (m: string) => (m === "ledger.status" ? { ok: [{ service: "near", state: "down", since: new Date(Date.now() - 60_000).toISOString(), seen }] } : { ok: null }), on: () => () => {} } as unknown as Bridge;
    try {
      await runtime.mount(createElement(StatusBanner, { bridge, timers }), { limit: 40 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  assert.equal(await say("device"), "", "one failed read on this phone (the 10:13 'NEAR is down') is no banner");
  assert.equal(await say("relay"), "", "the relay's check alone is no banner");
  assert.match(await say("both"), /^NEAR is down\. Payments can't go now\. Your money stays in your Safe\./, "control: both sources, it is down: what is down and whether money moves (rule 9a)");
  assert.doesNotMatch(await say("both"), /See their status/, "and never status.near.org, which measures something else");
});

test("product decision, 4 Nov or 'Solana is slow' seen by this phone alone (a free node's 429, our own limit) is no banner; the relay's check of the paid door says it (control)", async () => {
  const { StatusBanner } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  const timers = { set: () => 0, clear: () => {} };
  const say = async (service: string, state: string, seen: string) => {
    const bridge = { call: async (m: string) => (m === "ledger.status" ? { ok: [{ service, state, since: new Date(Date.now() - 60_000).toISOString(), seen }] } : { ok: null }), on: () => () => {} } as unknown as Bridge;
    try {
      await runtime.mount(createElement(StatusBanner, { bridge, timers }), { limit: 40 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  assert.equal(await say("near", "busy", "device"), "", "this phone's own 429s: no 'NEAR is busy'");
  assert.equal(await say("solana", "slow", "device"), "", "this phone's own timeouts: no 'Solana is slow'");
  // rule 9a (product decision, 5 Nov; QA's test, "NEAR is slow since <a time>"): busy or slow is never a banner, by
  // anyone's check; the failover covers it silently
  assert.equal(await say("near", "busy", "relay"), "", "the relay's paid door busy: no 'NEAR is busy since'");
  assert.equal(await say("near", "slow", "both"), "", "both saw NEAR slow: no 'NEAR is slow since'");
  assert.equal(await say("solana", "slow", "both"), "", "both saw it slow: still nothing");
  assert.match(await say("solana", "down", "both"), /^Solana is down\. pump\.fun and Solana trades can't go now\. /, "control: really down (every door), said plainly");
});

test("phone test, 5 Nov never shows; market data is said only when every door is down, as one calm line (controls: NEAR busy still says so; gecko down says the line)", async () => {
  const { StatusBanner, MARKET_DOWN_LINE } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  const timers = { set: () => 0, clear: () => {} };
  const say = async (service: string, state: string, seen: string) => {
    const bridge = { call: async (m: string) => (m === "ledger.status" ? { ok: [{ service, state, since: new Date(Date.now() - 60_000).toISOString(), seen }] } : { ok: null }), on: () => () => {} } as unknown as Bridge;
    try {
      await runtime.mount(createElement(StatusBanner, { bridge, timers }), { limit: 40 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  for (const state of ["busy", "slow"]) for (const seen of ["relay", "both", "device"]) assert.equal(await say("gecko", state, seen), "", `gecko ${state} seen by ${seen}: no banner`);
  assert.equal(await say("gecko", "down", "device"), "", "this phone alone: no banner (its kept answer shows with its time)");
  const down = await say("gecko", "down", "relay");
  assert.ok(down.startsWith(MARKET_DOWN_LINE), "control: every door down is the one calm line");
  assert.doesNotMatch(down, /busy|since/, "never 'busy since'");
  assert.match(await say("near", "down", "both"), /^NEAR is down\. /, "control: another service really down still says so");
});

test("product decision, 3 Nov: the freeze line has no × and the bridge's line has one (control: the same line unpinned has one)", async () => {
  const { NoticeBar } = await server.ssrLoadModule("./shell/NoticeBar.tsx");
  const drawn = async (items: unknown[]) => {
    try {
      await runtime.mount(createElement(NoticeBar, { items }), { limit: 20 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  const freeze = { key: "freeze:a", rank: 40, alert: true, pinned: true, line: "Payments wait until 4:15 PM." };
  const bridge = { key: "service:bridge:slow:t1", rank: 10, alert: true, line: "NEAR Intents' bridge is slow since 2:05." };
  assert.doesNotMatch(await drawn([freeze, bridge]), /×/, "the freeze line, first and with no ×");
  assert.match(await drawn([freeze, bridge]), /^Payments wait/, "and it is the one shown");
  assert.match(await drawn([bridge]), /×/, "the bridge's line has its ×");
  const { pinned: _p, ...unpinned } = freeze;
  assert.match(await drawn([unpinned]), /×/, "control: unpinned, the same line has one");
});

test("product decision, 3 Nov: × hides the service's line until that service's state changes; then it shows again (control: without ×, it stays)", async () => {
  const { StatusBanner } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  type Due = { fn: () => void; ms: number };
  let queue: Due[] = [];
  const timers = { set: (fn: () => void, ms: number) => (queue.push({ fn, ms }), queue.length), clear: () => {} };
  // rule 9a: only down is ever a line, so "its state changes" is down, then back, then down again
  let row = { service: "bridge", state: "down", since: new Date(Date.now() - 5 * 60_000).toISOString(), seen: "both" };
  const bridge = { call: async (m: string) => (m === "ledger.status" ? { ok: [row] } : { ok: null }), on: () => () => {} } as unknown as Bridge;
  const read = async () => { const due = queue.filter((d) => d.ms === 20); queue = queue.filter((d) => d.ms !== 20); for (const d of due) d.fn(); await runtime.settle(); };
  try {
    await runtime.mount(createElement(StatusBanner, { bridge, everyMs: 20, clearMs: 0, timers }), { limit: 60 });
    await runtime.settle();
    assert.match(runtime.text(), /^NEAR Intents' bridge is down\. /, "the line");
    await read();
    assert.match(runtime.text(), /is down\. /, "control: without ×, the next read keeps it");
    runtime.press(/^×$/);
    await runtime.settle();
    assert.equal(runtime.text(), "", "× hides it");
    await read();
    assert.equal(runtime.text(), "", "the same state on the next read stays hidden");
    row = { ...row, state: "up" };
    await read();
    row = { ...row, state: "down", since: new Date().toISOString() };
    await read();
    assert.match(runtime.text(), /^NEAR Intents' bridge is down\. /, "its state changed: it shows again");
  } finally {
    runtime.unmount();
  }
});

test("restore crawl (4 Nov): NEAR AI Cloud slow or down is never the shell's notice over Home (AgentZero's chat says it); control: Solana slow on both still is", async () => {
  const { StatusBanner } = await server.ssrLoadModule("./shell/StatusBanner.tsx");
  const timers = { set: () => 0, clear: () => {} };
  const say = async (service: string, state: string) => {
    const bridge = { call: async (m: string) => (m === "ledger.status" ? { ok: [{ service, state, since: new Date(Date.now() - 60_000).toISOString(), seen: "both" }] } : { ok: null }), on: () => () => {} } as unknown as Bridge;
    try {
      await runtime.mount(createElement(StatusBanner, { bridge, timers }), { limit: 40 });
      await runtime.settle();
      return runtime.text();
    } finally {
      runtime.unmount();
    }
  };
  assert.equal(await say("nearai", "slow"), "");
  assert.equal(await say("nearai", "down"), "");
  assert.match(await say("solana", "down"), /^Solana is down\. /, "control");
});
