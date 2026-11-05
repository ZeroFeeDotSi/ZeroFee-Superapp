// D134, Home instant: every figure paints on Home's first render from the copy kept on this phone (home-cache.ts), before
// any network answer; fresh reads replace it as they come; a damaged copy is no copy; no "as of" line for a copy under
// 2 minutes old; every Home read starts at once; and the copy is for the eyes only: no Send, Move or Swap amount check
// reads it (the runtime's money fields stay null while only the copy is known).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement, type FunctionComponent } from "react";
import { createServer, type ViteDevServer } from "vite";
import type { Bridge } from "@zerofee/core/bridge";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (p: string) => readFileSync(ROOT + p, "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

let server: ViteDevServer;
let runtime: { mount: (el: unknown, o?: { limit?: number }) => Promise<number>; settle: () => Promise<number>; unmount: () => void; text: () => string };
let ShellContext: { Provider: unknown };
let walletRoot: FunctionComponent;
let wallet: { WalletProvider: FunctionComponent<{ bridge: Bridge; children: unknown }>; useWallet: () => Record<string, unknown> & { shown: Record<string, unknown> }; };
let cache: typeof import("../../../../packages/wallet/src/app/home-cache.ts");
let view: typeof import("../../../../packages/wallet/src/app/screens/home-view.ts");
let keep: typeof import("../../../../packages/wallet/src/app/home-keep.ts");
let mockBridge: () => Bridge;
let forApps: (b: Bridge, app: string) => Bridge;

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
  walletRoot = (await server.ssrLoadModule("@zerofee/wallet/app/WalletApp.tsx")).walletApp.Root;
  wallet = (await server.ssrLoadModule("@zerofee/wallet/app/runtime.tsx")) as typeof wallet;
  cache = (await server.ssrLoadModule("@zerofee/wallet/app/home-cache.ts")) as typeof cache;
  view = (await server.ssrLoadModule("@zerofee/wallet/app/screens/home-view.ts")) as typeof view;
  keep = (await server.ssrLoadModule("@zerofee/wallet/app/home-keep.ts")) as typeof keep;
  const { createMockBridge } = await server.ssrLoadModule("@zerofee/shell-api/MockBridge.ts");
  mockBridge = () => createMockBridge({ latencyMs: 0, settleMs: 0 });
  forApps = (await server.ssrLoadModule("@zerofee/core/bridge")).forApps;
});
after(async () => server?.close());

const SPENDING = { loaded: true, totalUsd: "212.54", reserveUsd: "40.00", cashUsd: "212.54", coinsUsd: "0.00", capUsd: "500.00", roomUsd: "287.46", ready: true, firstTopUp: false, onItsWay: [],
  networks: [
    { network: "sol", name: "Solana", cashUsd: "144.37", coinsUsd: "0.00", readyUsd: "143.37", nativeAmount: "1.42" },
    { network: "hood", name: "Robinhood Chain", cashUsd: "28.17", coinsUsd: "0.00", readyUsd: "27.87", nativeAmount: "0.012" },
    { network: "bsc", name: "BNB Chain", cashUsd: "0.00", coinsUsd: "0.00", readyUsd: "0", closed: true },
  ] };
const HELD = [{ chain: "sol", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", amount: "125050", usd: "3.46" }];
const SITES = [{ id: "site-pump-sol-abc", role: "site", site: "pump", network: "sol", address: "SiteWalletAddr111", label: "pump.fun wallet", current: true, inCap: false, cashUsd: "10.00", coinsUsd: "0.00", keyExported: false }];
const ANSWERS: Record<string, unknown> = { "spending.status": SPENDING, "trade.positions": HELD, "spending.wallets": SITES };
const NEVER = new Promise<never>(() => {});
const NOW = Date.now();

/** A copy as the runtime keeps it after one full read of the demo account (taken from a real run below). */
let FULL: string;

type Opts = { store?: Record<string, string>; offline?: boolean; sets?: [string, unknown][]; prime?: boolean; first?: boolean; probe?: (rt: ReturnType<typeof wallet.useWallet>) => void; balancesDown?: boolean; answer?: (m: string, n: number, inner: () => Promise<unknown>) => unknown; then?: number; mid?: (text: string) => void };
async function open(o: Opts = {}): Promise<string> {
  const inner = mockBridge();
  const counts: Record<string, number> = {};
  const call = async (m: string, p?: Record<string, unknown>): Promise<unknown> => {
    if (m === "device.store.set") { o.sets?.push([String(p?.key), p?.value]); return { ok: { ok: true } }; }
    if (m === "device.store.get") return { ok: { value: o.store?.[String(p?.key)] ?? null } };
    if (m.startsWith("device.")) return inner.call(m, p);
    // the network stubbed never to answer: only the copy can paint
    if (o.offline) return NEVER;
    if (o.balancesDown && m === "ledger.balances") return { problem: { code: "ledger.nodes.unreachable", service: "near", whatHappened: "NEAR didn't answer.", money: { state: "safe" }, next: { kind: "retry", label: "Try again" } } };
    if (o.answer) { const n = (counts[m] = (counts[m] ?? 0) + 1); const a = await o.answer(m, n, () => (m in ANSWERS ? Promise.resolve({ ok: ANSWERS[m] }) : inner.call(m, p))); if (a !== undefined) return a; }
    if (m in ANSWERS) return { ok: ANSWERS[m] };
    return inner.call(m, p);
  };
  const bridge = forApps({ call: call as never, on: (e, h) => inner.on(e, h) }, "wallet");
  // the page reads the copy at boot (App.tsx primeHome), so Home's first render has it
  if (o.prime !== false) await cache.primeHome(bridge);
  const ctx = { bridge, openApp: () => {}, openMoney: () => {}, showProblem: async () => ({ kind: "nothing", label: "OK" }), showWaiting: () => {}, openSwitcher: () => {}, openMenu: () => {}, active: true, index: 0, count: 1 };
  const Probe = () => { o.probe?.(wallet.useWallet()); return null; };
  const tree = createElement(ShellContext.Provider as never, { value: ctx }, o.probe ? createElement(wallet.WalletProvider as never, { bridge }, createElement(Probe)) : createElement(walletRoot));
  // `first`: the first render only (no effect has run, no answer has come)
  await runtime.mount(tree, { limit: o.first ? 1 : 80 });
  if (o.then) { o.mid?.(runtime.text()); await new Promise((r) => setTimeout(r, o.then)); await runtime.settle(); }
  const shown = runtime.text();
  runtime.unmount();
  return shown;
}

test("a full read is kept as one copy (home-cache.v1) with every part Home shows, no wallet address in it", async () => {
  const sets: [string, unknown][] = [];
  await open({ sets });
  await new Promise((r) => setTimeout(r, 400));
  const kept = sets.filter(([k]) => k === keep.HOME_CACHE_KEY).at(-1);
  assert.ok(kept, `the copy was written: ${sets.map(([k]) => k).join(", ")}`);
  FULL = String(kept[1]);
  const s = keep.parseSnapshot(FULL)!;
  for (const part of ["balances", "chains", "tokens", "positions", "pocket", "spending", "held", "wallets", "total"] as const) assert.ok(s[part] !== undefined, `kept: ${part}`);
  assert.equal(s.total, "5480.15", "the total as counted in full");
  assert.doesNotMatch(FULL, /SiteWalletAddr111/, "a wallet's address is never kept");
  assert.ok((s.tokens ?? []).length < 40, `only the coins Home prices with: ${(s.tokens ?? []).length}`);
});

test("first render, network never answering: the total, every wallet and the Safe paint from the copy, no shimmer, no line", async () => {
  const shown = await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, offline: true, first: true });
  assert.match(shown, /^\$5,254\.15$/m, `the total at once:\n${shown}`);
  assert.match(shown, /\nSafe\n\$5,254\.15\n/, "the Safe's figure");
  assert.match(shown, /\nHot\n\$226\.00\n/, "Hot's figure on the switch (the wallets, BONK and the pump.fun wallet: QA test, BONK counted once)");
  assert.match(shown, /Bitcoin\n0\.0123 BTC\n\$989\.60/, "the Safe's coins");
  assert.doesNotMatch(shown, /Updating…|Reading|updating…|as of/, "instant: no updating line, no as-of line");
  // control: the first run ever (no copy) keeps the skeleton and says it is reading
  const cold = await open({ offline: true, first: true });
  assert.doesNotMatch(cold, /\$5,254\.15/, "control: no copy, no figure");
  assert.doesNotMatch(cold, /\$\d/, "control: no copy, no dollar at all (never $0)");
});

test("the copy read late (not primed at boot) still paints before any network answer", async () => {
  const shown = await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, offline: true, prime: false });
  assert.match(shown, /^\$5,254\.15$/m);
});

test("fresh replaces the copy: an older copy's figures give way to the read, and the new read is kept", async () => {
  const old = keep.parseSnapshot(FULL)!;
  const stale = JSON.stringify({ ...old, total: "999.00", balances: { at: NOW - 3_600_000, rows: old.balances!.rows.map((b) => ({ ...b, usd: b.usd ? "1.00" : b.usd })) } });
  const first = await open({ store: { [keep.HOME_CACHE_KEY]: stale }, offline: true, first: true });
  assert.doesNotMatch(first, /^\$5,254\.15$/m, "control: the stale copy paints its own figures first");
  const sets: [string, unknown][] = [];
  const shown = await open({ store: { [keep.HOME_CACHE_KEY]: stale }, sets });
  assert.match(shown, /^\$5,254\.15$/m, "the fresh total replaced the copy's");
  assert.match(shown, /\nSafe\n\$5,254\.15\n/);
  await new Promise((r) => setTimeout(r, 400));
  const kept = keep.parseSnapshot(String(sets.filter(([k]) => k === keep.HOME_CACHE_KEY).at(-1)?.[1]));
  assert.equal(kept?.total, "5480.15", "the new read is the copy now");
});

test("a damaged copy is ignored safely: no throw, the skeleton, then the fresh read", async () => {
  for (const bad of ["{not json", "null", "[]", JSON.stringify({ v: 2, total: "1.00" }), JSON.stringify({ v: 1, balances: { at: "x", rows: 5 }, chains: "no", total: "abc" })]) {
    const first = await open({ store: { [keep.HOME_CACHE_KEY]: bad }, offline: true, first: true });
    assert.doesNotMatch(first, /\$\d/, `nothing painted from ${bad}`);
    const shown = await open({ store: { [keep.HOME_CACHE_KEY]: bad } });
    assert.match(shown, /^\$5,254\.15$/m, `the fresh read after ${bad}`);
  }
  // part by part: a damaged part is dropped, the rest kept
  const s = keep.parseSnapshot(JSON.stringify({ v: 1, balances: { at: 1, rows: [{ nope: 1 }] }, chains: [{ id: "near", name: "NEAR", coins: [] }], total: "12.50" }));
  assert.equal(s?.balances, undefined);
  assert.equal(s?.chains?.length, 1);
  assert.equal(s?.total, "12.50");
  assert.equal(keep.parseSnapshot(FULL)?.total, "5480.15", "control: the good copy parses");
});

/** Home's view of the runtime (`shown`, from useWallet) or the copy's own module. */
const HOME_VIEW = /\{[^}]*\bshown\b[^}]*\}\s*=\s*useWallet\(\)|useWallet\(\)\.shown|home-cache|\blastTotal\b/;

test("money never reads the copy: with only the copy known, every field Send, Move and Swap check is empty; Home's view has it", async () => {
  let seen: ReturnType<typeof wallet.useWallet> | null = null;
  await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, offline: true, probe: (rt) => { seen = rt; } });
  const rt = seen! as ReturnType<typeof wallet.useWallet>;
  for (const k of ["balances", "spending", "wallets", "pocket", "trading"]) assert.equal(rt[k], null, `money's ${k} is fresh only`);
  assert.deepEqual([rt.chains, rt.earning, rt.tradingPartial], [[], [], true], "nothing of the copy in the networks, Earn or Trading");
  // control: the copy is there, in Home's view only
  assert.ok(Array.isArray(rt.shown.balances) && (rt.shown.balances as unknown[]).length > 0, "control: Home's view has the copy's coins");
  assert.ok(rt.shown.spending, "control: and the wallets");
  // and the sheets that decide an amount never reach Home's view or the copy
  for (const f of ["packages/wallet/src/app/money/MoneyHost.tsx", "packages/wallet/src/app/screens/MoveSheet.tsx", "packages/wallet/src/app/money/SwapSheet.tsx", "packages/wallet/src/app/money/SendSheet.tsx", "packages/wallet/src/app/money/SendForm.tsx", "packages/wallet/src/app/money/send-sources.ts", "packages/wallet/src/app/money/send-guard.ts", "packages/wallet/src/app/money/send-cap.ts", "packages/wallet/src/app/screens/Convert.tsx"]) {
    const src = code(read(f));
    assert.doesNotMatch(src, HOME_VIEW, `${f} never reads Home's view or its copy`);
  }
  assert.match(code(read("packages/wallet/src/app/screens/Home.tsx")), HOME_VIEW, "control: Home does read it, and the pin sees it");
});

test("home-keep.ts not loading is no dead end: Home reads by itself (plain fresh reads, no copy) and asks for it once more", async () => {
  const was = cache.loaded.keep, real = cache.load.keep;
  let asked = 0;
  try {
    cache.loaded.keep = undefined;
    cache.load.keep = () => { asked++; return Promise.reject(new Error("the chunk didn't load")); };
    const shown = await open();
    assert.equal(cache.loaded.keep, undefined, "control: the readers really didn't load (no copy, no drop check, no writer)");
    assert.match(shown, /^\$5,254\.15$/m, `fresh figures, read by Home itself, never a skeleton with no word:\n${shown}`);
    assert.match(shown, /\nSafe\n\$5,254\.15\n/);
    assert.equal(asked, 1);
    await new Promise((r) => setTimeout(r, cache.KEEP_RETRY_MS + 200));
    assert.equal(asked, 2, "asked for once more, quietly, and only once");
  } finally {
    cache.load.keep = real;
    cache.loaded.keep = was;
  }
});

test("every Home read starts at once (none waits on another); Trading's parts only once the account is known not a child's", async () => {
  const asked: string[] = [];
  let tell: (v: unknown) => void = () => {};
  const state = new Promise((r) => { tell = r; });
  const b = { call: (m: string) => { asked.push(m); return m === "account.state" ? state : NEVER; }, on: () => () => {} } as unknown as Bridge;
  const r = cache.startHomeReads(b);
  assert.deepEqual([...asked].sort(), ["account.state", "earn.positions", "ledger.activity", "ledger.balances", "ledger.chains", "ledger.private", "ledger.tokens", "spending.status"], "all eight asked in the same tick, before any answer");
  assert.ok(!asked.includes("trade.positions"), "control: Trading's parts wait for whose account this is");
  tell({ ok: { kid: false } });
  await r.parts;
  assert.ok(["trade.positions", "spending.wallets", "subwallet.float.balance"].every((m) => asked.includes(m)), "then asked together");
  const kidAsked: string[] = [];
  const k = cache.startHomeReads({ call: (m: string) => { kidAsked.push(m); return m === "account.state" ? Promise.resolve({ ok: { kid: true } }) : NEVER; }, on: () => () => {} } as unknown as Bridge);
  assert.equal(await k.parts, null, "a child's phone: no Trade (D30)");
  assert.ok(!kidAsked.includes("trade.positions"));
  // kicked at unlock: the Home that opens takes those reads, never asking twice
  const twice: string[] = [];
  const t = { call: (m: string) => { twice.push(m); return NEVER; }, on: () => () => {} } as unknown as Bridge;
  keep.kickEarly(t, 1000);
  keep.takeHomeReads(t, 2000);
  assert.equal(twice.filter((m) => m === "ledger.balances").length, 1, "one read of the Safe, started at unlock");
  keep.takeHomeReads(t, 3000);
  assert.equal(twice.filter((m) => m === "ledger.balances").length, 2, "control: a later Home asks again");
});

test("no \"as of\" line for a copy under 2 minutes old even when its read failed; an older one says as of; with no figure, it shows when it does", async () => {
  const fresh = keep.parseSnapshot(FULL)!;
  // 1Click unread: wallets from a copy read 30 s ago say nothing; from one read 10 minutes ago, "as of"
  const unread = (m: string) => (m === "spending.status" ? { ok: { ...SPENDING, loaded: false, unread: true, networks: [] } } : undefined);
  const spendingAt = (ago: number) => JSON.stringify({ ...fresh, spending: { ...fresh.spending!, at: Date.now() - ago } });
  assert.doesNotMatch(await open({ store: { [keep.HOME_CACHE_KEY]: spendingAt(30_000) }, answer: unread }), /NEAR Intents didn't answer/, "half a minute old: as good as fresh, no line");
  assert.match(await open({ store: { [keep.HOME_CACHE_KEY]: spendingAt(10 * 60_000) }, answer: unread }), /NEAR Intents didn't answer\. Your wallets are as of /, "control: ten minutes old says as of");
  // no figure at all: it says the Safe shows when NEAR answers, whatever the clock
  assert.match(await open({ balancesDown: true }), /NEAR didn't answer, so your Safe shows when it does\./);
  // on Home: a fresh copy and a Safe read that failed: the figure, no line
  const recent = JSON.stringify({ ...fresh, balances: { ...fresh.balances!, at: Date.now() - 30_000 } });
  const shown = await open({ store: { [keep.HOME_CACHE_KEY]: recent }, balancesDown: true });
  assert.match(shown, /\nSafe\n\$5,254\.15\n/);
  assert.doesNotMatch(shown, /as of/, "under 2 minutes: no as-of line");
  const oldCopy = JSON.stringify({ ...fresh, balances: { ...fresh.balances!, at: Date.now() - 10 * 60_000 } });
  assert.match(await open({ store: { [keep.HOME_CACHE_KEY]: oldCopy }, balancesDown: true }), /NEAR didn't answer\. Your Safe is as of/, "control: ten minutes old says as of");
});

// ---- product decision, 3 Nov ----

const NOPE = { problem: { code: "trade.market.busy", whatHappened: "x", money: { state: "safe" }, next: { kind: "nothing", label: "OK" } } };
const halved = async (inner: () => Promise<unknown>) => ({ ok: ((await inner()) as { ok: { usd?: string }[] }).ok.map((b) => ({ ...b, ...(b.usd ? { usd: (Number(b.usd) / 2).toFixed(2) } : {}) })) });

test("a source that fails keeps its last known value: the total stays, never $0, never short by it", async () => {
  const fails = (m: string) => (["spending.status", "trade.positions", "ledger.private", "earn.positions"].includes(m) ? NOPE : undefined);
  const shown = await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, answer: fails });
  assert.match(shown, /^\$5,254\.15$/m, `the total as last known:\n${shown}`);
  assert.match(shown, /\nHot\n\$226\.00\n/, "Hot keeps its figure");
  assert.doesNotMatch(shown, /\$0\.00/);
  // control: with nothing known before, the same failures show no total at all (never a short one)
  // (the Safe's own number needs none of these sources; Hot's does)
  assert.doesNotMatch(await open({ answer: fails }), /\nHot\n\$226\.00\n/);
});

test("a Move on its way is counted exactly once: the engine's own total holds it (float-core inFlight, addsOnWay), Home never adds it again", async () => {
  // the real engine (trade float-core) on the sample core: a $100 Add from the Safe, left the Safe, not yet in the count
  const { createCoreFloat } = await import("../../../../packages/trade/src/float-core.ts");
  const { createMockBridge } = await import("@zerofee/shell-api/MockBridge.ts");
  const mock = createMockBridge({ latencyMs: 0, settleMs: 5, float: { moveMs: 10 } });
  let landed = false;
  const call = async (method: string, params?: Record<string, unknown>) => {
    if (method === "subwallet.float.balance" && !landed) return { tokens: [], usd: 0, asOfIso: new Date(0).toISOString() };
    const r = await mock.call<never>(method, params);
    if ("problem" in r) throw new Error(r.problem.whatHappened);
    return r.ok;
  };
  const f = createCoreFloat({ call: call as never, on: (e, h) => mock.on(e, h), nativeUsd: async () => 100, wallets: async () => [], get: async () => undefined, set: async () => {}, now: () => Date.now(), every: () => () => undefined, rng: () => 0.5 });
  await f.add(100); await new Promise((r) => setTimeout(r, 40)); await f.refresh();
  const mid = f.snapshot();
  assert.deepEqual(mid.moves.map((m) => [m.kind, m.status]), [["add", "moving"]], "on its way");
  assert.equal(mid.totalUsd, 100, "the engine's total already holds it");
  landed = true; await f.refresh();
  assert.equal(f.snapshot().totalUsd, 100, "landed: still once");

  // Home, with the Safe $100 lighter and Trading as the engine says (spending.ts status(): totalUsd = the engine's)
  const s = keep.parseSnapshot(FULL)!;
  const base = { balances: s.balances!.rows, balancesAt: 1, chains: s.chains!, tokens: new Map(s.tokens!.map((t) => [t.assetId, t])), positions: s.positions as never, pocket: s.pocket!, tradingRead: true, spending: s.spending!.s, held: s.held!, wallets: s.wallets!, nearCoins: s.nearCoins ?? [], heldFailed: false };
  const before = Number(keep.totalOf(cache.viewOf(base, null)));
  const at = base.balances.findIndex((b) => Number(b.usd) > 100);
  const rows = base.balances.map((b, i) => (i === at ? { ...b, usd: (Number(b.usd) - 100).toFixed(2) } : b));
  const plus = (usd: string, n: number) => (Number(usd) + n).toFixed(2);
  const sp = base.spending;
  const during = (onItsWay: unknown[]) => Number(keep.totalOf(cache.viewOf({ ...base, balances: rows, spending: { ...sp, totalUsd: plus(sp.totalUsd, mid.totalUsd), onItsWay } as never }, null)));
  const row = [{ id: "m1", kind: "top-up", usd: "100.00", words: "Top up $100.00", at: 1 }];
  assert.equal(during(row), before, "counted once: the total holds still while it moves");
  // control: its row on the way changes nothing (Home never adds it a second time), and the engine's count is what holds it
  assert.equal(during([]), during(row));
  assert.equal(Number(keep.totalOf(cache.viewOf({ ...base, balances: rows, spending: { ...sp, onItsWay: row } as never }, null))).toFixed(2), (before - 100).toFixed(2), "control: without the engine's count it would dip by the move");
});

test("a drop shows only once it's confirmed: one low read never moves the number; two do; a rise shows at once", async () => {
  // the drop rule itself
  const usd = (n: number) => n;
  assert.deepEqual(keep.confirmDrop(100, null, 40, usd), { shown: 100, pending: 40, recheck: true }, "one low read: held, read again");
  assert.deepEqual(keep.confirmDrop(100, 40, 40.5, usd), { shown: 40.5, pending: null, recheck: false }, "a second read agrees: shown");
  assert.deepEqual(keep.confirmDrop(100, 40, 100, usd), { shown: 100, pending: null, recheck: false }, "the low read was wrong: the figure stands");
  assert.deepEqual(keep.confirmDrop(100, null, 99.5, usd), { shown: 99.5, pending: null, recheck: false }, "a small move (prices) shows at once");
  assert.deepEqual(keep.confirmDrop(100, null, 180, usd), { shown: 180, pending: null, recheck: false }, "a rise shows at once");
  // on Home: NEAR answers once with half the Safe, then the truth: the number never dips
  const seen: string[] = [];
  const once = await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, answer: (m, n, inner) => (m === "ledger.balances" && n === 1 ? halved(inner) : undefined), then: keep.RECHECK_MS + 300, mid: (t) => seen.push(t) });
  for (const t of [...seen, once]) {
    assert.match(t, /^\$5,254\.15$/m, `the number never dropped:\n${t}`);
    assert.match(t, /\nSafe\n\$5,254\.15\n/);
  }
  // two low reads agree: the drop is real, and shows
  const mid: string[] = [];
  const twice = await open({ store: { [keep.HOME_CACHE_KEY]: FULL }, answer: (m, _n, inner) => (m === "ledger.balances" ? halved(inner) : undefined), then: keep.RECHECK_MS + 300, mid: (t) => mid.push(t) });
  assert.match(mid[0]!, /\nSafe\n\$5,254\.15\n/, "after the first low read: still the known figure");
  assert.doesNotMatch(twice, /\nSafe\n\$5,254\.15\n/, `after the second: the drop shows:\n${twice}`);
  assert.match(twice, /\nSafe\n\$2,6\d\d\.\d\d\n/);
});
