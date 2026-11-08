import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ProblemError } from "./problem.ts";
import { REST_STAYS_LINE, gridAddUsd } from "./inflow-grid.ts";
import { SPENDING_ALLOWED, SPENDING_CAP, capRefusal, safeSends, withPrivate, spendingProblems, createSpendingService, faceIdBandUsd, overCapUsd, pickSafeCoin, roomUnderCap, shownInActivity, type EngineMove, type EngineSnapshot, type SpendingEngine, type SpendingStatus } from "./spending.ts";

/** A stand-in for Trade's planner: a snapshot the test sets, and a log of what Spending asked it. */
function fakeEngine(snap: Partial<EngineSnapshot> = {}) {
  const asked: unknown[] = [];
  let s: EngineSnapshot = { loaded: true, totalUsd: 0, reserveUsd: 0, takeableUsd: 0, chains: [], moves: [], ...snap };
  const subs = new Set<() => void>();
  const e: SpendingEngine & { asked: unknown[]; set(n: Partial<EngineSnapshot>): void; cap?: number } = {
    asked,
    set(n) { s = { ...s, ...n }; for (const f of subs) f(); },
    snapshot: () => s,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    refresh: async () => undefined,
    async add(usd, from) { asked.push({ add: usd, from }); const m: EngineMove = { id: "a1", kind: "add", usd, status: "moving", at: 0 }; return m; },
    async takeOut(usd) { asked.push({ takeOut: usd }); return { id: "h1", kind: "home", usd: usd === "all" ? s.takeableUsd : usd, status: "waiting", at: 0 }; },
    setCap(usd) { e.cap = usd; asked.push({ cap: usd }); },
    async moveNow(chain, usd, o) { asked.push({ moveNow: chain, usd, o }); return { id: "s1", kind: "out", chain, usd, status: "moving", at: 0, ...(o?.why ? { why: o.why } : {}) }; },
  };
  return e;
}

function service(engine: ReturnType<typeof fakeEngine>, answers: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const svc = createSpendingService({
    engine: () => engine,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "device.store.get") return { value: store.get(String(params.key)) ?? null } as T;
      if (method === "device.store.set") { store.set(String(params.key), String(params.value)); return { ok: true } as T; }
      if (method in answers) return answers[method] as T;
      throw new Error(`no answer for ${method}`);
    },
  });
  return { svc, store, calls };
}

const USDC = { tokenId: "nep141:usdc", symbol: "USDC", amount: "800", usd: "800", listed: true };
const DEFAULT_BANDS = { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd: 500, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }] };

test("the cap's rules: $500 by default, presets, custom whole dollars from $10 to $5,000", () => {
  assert.equal(SPENDING_CAP.defaultUsd, 500);
  assert.deepEqual([...SPENDING_CAP.presetsUsd], [100, 500, 2000]);
  for (const ok of [10, 100, 500, 2000, 5000, 1234]) assert.equal(capRefusal(ok), null);
  for (const bad of [9, 5001, 12.5, NaN, "500", null]) assert.ok(capRefusal(bad));
  assert.equal(roomUnderCap(320, 500), 180);
  assert.equal(roomUnderCap(620, 500), 0);
});

test("above the cap only cash goes home, never coins, and nothing for an excess under $5", () => {
  assert.equal(overCapUsd({ cashUsd: 560, coinsUsd: 0 }, 500), 60);
  assert.equal(overCapUsd({ cashUsd: 40, coinsUsd: 600 }, 500), 40, "the coins push it over: only the cash can go");
  assert.equal(overCapUsd({ cashUsd: 0, coinsUsd: 900 }, 500), 0, "all coins: nothing is sold");
  assert.equal(overCapUsd({ cashUsd: 503, coinsUsd: 0 }, 500), 0, "$3 over: not worth a move");
});

test("a Top up's coin: dollar coins first, then NEAR, then the largest other; one coin pays", () => {
  const coins = [
    { tokenId: "nep141:eth", symbol: "ETH", amount: "1", usd: "3000" },
    { tokenId: "near", symbol: "NEAR", amount: "100", usd: "300" },
    { tokenId: "nep141:usdt", symbol: "USDT", amount: "50", usd: "50" },
  ];
  assert.equal(pickSafeCoin(coins, 40)!.coin.symbol, "USDT");
  assert.equal(pickSafeCoin(coins, 200)!.coin.symbol, "NEAR");
  assert.equal(pickSafeCoin(coins, 1000)!.coin.symbol, "ETH");
  assert.deepEqual(pickSafeCoin(coins, 5000), { coin: coins[0], coversUsd: 3000 }, "none covers it: the one that covers most, and how much");
  assert.equal(pickSafeCoin([{ tokenId: "x", symbol: "FAKE", amount: "9", usd: "900", listed: false }], 10), null, "an unlisted coin never pays");
});

test("Activity shows what the user did, what waits on them, what failed, and (D102) every move the engine makes by itself", () => {
  assert.equal(shownInActivity("top-up", "done"), true);
  assert.equal(shownInActivity("put-away", "on-its-way"), true);
  assert.equal(shownInActivity("ready", "done"), true, "Make ready (D55) is the person's own");
  // D102: gas, the cash above the cap and an older wallet's coin coming home are shown and named, done or not
  for (const k of ["gas", "over-cap", "older"] as const) {
    assert.equal(shownInActivity(k, "done"), true, `${k} is shown`);
    assert.equal(shownInActivity(k, "on-its-way"), true, `${k} on its way is shown`);
  }
  // refill / rebalance exist only in a journal from before D102: behind the scenes, unless they failed
  for (const k of ["refill", "rebalance"] as const) {
    assert.equal(shownInActivity(k, "done"), false);
    assert.equal(shownInActivity(k, "failed"), true, `${k} that failed is shown`);
  }
  assert.equal(faceIdBandUsd(DEFAULT_BANDS.usd), 500);
  assert.equal(faceIdBandUsd([{ upToUsd: null, level: "wait" }]), 0);
});

test("spending.status: one total (cash + coins), the cap, the room, ready", async () => {
  const e = fakeEngine({ totalUsd: 320, reserveUsd: 100, takeableUsd: 200, chains: [
    { chain: "sol", name: "Solana", nativeUsd: 80, readyUsd: 79, coinsUsd: 120, wallets: [] },
    { chain: "bsc", name: "BNB Chain", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, closed: true, wallets: [] },
  ] });
  const { svc } = service(e);
  const r = await svc.call<SpendingStatus>("spending.status", {});
  assert.ok("ok" in r);
  assert.equal(r.ok.totalUsd, "320.00");
  assert.equal(r.ok.coinsUsd, "120.00");
  assert.equal(r.ok.cashUsd, "200.00");
  assert.equal(r.ok.capUsd, "500.00");
  assert.equal(r.ok.roomUsd, "180.00");
  assert.equal(r.ok.ready, true);
  assert.equal(r.ok.networks.find((n) => n.network === "bsc")!.closed, true);
  assert.deepEqual(e.asked, [{ cap: 500 }], "the engine plans under the cap from the start");
});

test("spending.topUp: over the cap, under $2 and over the Face ID band are refused before any sheet", async () => {
  const e = fakeEngine({ totalUsd: 320 });
  const { svc, calls } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
  const over = await svc.call("spending.topUp", { usd: "200" });
  assert.ok("problem" in over && over.problem.code === "spending.topup.over-cap");
  assert.equal(over.problem.next.label, "Move $180.00");
  const small = await svc.call("spending.topUp", { usd: "1.5" });
  assert.ok("problem" in small && small.problem.code === "spending.move.too-small");
  assert.ok(!calls.some((c) => c.method === "ledger.toTrading"), "nothing reached the ledger");
  const ok = await svc.call("spending.topUp", { usd: "180" });
  assert.ok("ok" in ok);
  assert.deepEqual(e.asked.at(-1), { add: 180, from: undefined }, "USDC pays as dollars");
});

test("spending.topUp: a cap of $500 always fits the default Face ID band; a raised cap is held to the band honestly", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [{ ...USDC, amount: "3000", usd: "3000" }] });
  const full = await svc.call("spending.topUp", { usd: "500" });
  assert.ok("ok" in full, "the whole default cap goes with Face ID");
  await svc.call("spending.setCap", { usd: 2000 });
  const big = await svc.call("spending.topUp", { usd: "800" });
  assert.ok("problem" in big && big.problem.code === "spending.topup.over-band");
  assert.equal(big.problem.next.label, "Move $500.00");
  assert.match(big.problem.whatHappened, /Bigger moves need a 1-day wait[.] A move's price lasts only minutes[.]/);
});

test("spending.topUp over the Face ID band says the account's own wait, not a day it doesn't have (mainnet 2 Nov: 2 minutes)", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const bands = { bands: [], usd: [{ upToUsd: 22, about: true, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 120 }] };
  const { svc } = service(e, { "account.protection.get": bands, "ledger.balances": [{ ...USDC, amount: "3000", usd: "3000" }] });
  const big = await svc.call("spending.topUp", { usd: "25" });
  assert.ok("problem" in big && big.problem.code === "spending.topup.over-band");
  assert.match(big.problem.whatHappened, /need a 2-minute wait[.]/);
});

test("spending.putAway: everything or an amount; nothing to put away is said, never a $0.00 row", async () => {
  const e = fakeEngine({ totalUsd: 300, takeableUsd: 180 });
  const { svc } = service(e);
  const all = await svc.call<{ kind: string; usd: string; shown: boolean }>("spending.putAway", { usd: "all" });
  assert.ok("ok" in all && all.ok.kind === "put-away" && all.ok.usd === "180.00" && all.ok.shown);
  e.set({ takeableUsd: 1 });
  const none = await svc.call("spending.putAway", { usd: "all" });
  assert.ok("problem" in none && none.problem.code === "spending.putaway.nothing");
});

test("Spending not loaded or unread: Top up, Put away and Make ready say it's getting ready, never read it as $0 (mainnet, 1 Nov)", async () => {
  for (const snap of [{ loaded: false }, { loaded: true, unread: true as const }]) {
    const e = fakeEngine({ ...snap, totalUsd: 0, takeableUsd: 0, reserveUsd: 0 });
    const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
    for (const [method, params] of [["spending.topUp", { usd: 25 }], ["spending.putAway", { usd: 2 }], ["spending.putAway", { usd: "all" }], ["spending.makeReady", { network: "sol", usd: 3 }]] as const) {
      const r = await svc.call(method, params);
      assert.ok("problem" in r && r.problem.code === "spending.not-ready", `${method} ${JSON.stringify(snap)}: ${"problem" in r ? r.problem.code : "went"}`);
    }
    assert.deepEqual(e.asked.filter((a) => !(a as { cap?: number }).cap), [], "nothing was asked of the engine");
  }
});

test("spending.setCap: kept on the phone and given to the engine; out of range refused", async () => {
  const e = fakeEngine();
  const { svc, store } = service(e);
  const r = await svc.call<{ capUsd: string }>("spending.setCap", { usd: 100 });
  assert.ok("ok" in r && r.ok.capUsd === "100.00");
  assert.equal(e.cap, 100);
  assert.equal(store.get("spending.cap.v1"), "100");
  const bad = await svc.call("spending.setCap", { usd: 9000 });
  assert.ok("problem" in bad);
  // a relaunch reads the kept cap back before anything else
  const e2 = fakeEngine();
  const again = createSpendingService({ engine: () => e2, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: store.get(String(p.key)) ?? null } : {}) as T });
  const s = await again.call<SpendingStatus>("spending.status", {});
  assert.ok("ok" in s && s.ok.capUsd === "100.00");
  assert.equal(e2.cap, 100);
});

test("only Wallet, Trade, Browser and ZeroFee's own screens use Spending", async () => {
  const { svc } = service(fakeEngine());
  const r = await svc.call("spending.status", { caller: "earn" });
  assert.ok("problem" in r && r.problem.code === "security.request.not-allowed");
  const unknown = await svc.call("spending.nope", {});
  assert.ok("problem" in unknown);
});

test("a Top up paid in NEAR asks the ledger for that much NEAR (its own units), never the dollars read as NEAR", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const NEAR = { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "312.4", usd: "1383.93", listed: true };
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [NEAR] });
  const r = await svc.call("spending.topUp", { usd: "25" });
  assert.ok("ok" in r);
  assert.deepEqual(e.asked.at(-1), { add: 25, from: { tokenId: "nep141:wrap.near", amount: "5.6433", symbol: "NEAR" } });
});

test("B28 security review H1: a coin priced from a kept list (1Click not answering) never sizes a Top up; said by name, nothing asked of the engine", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const NEAR = { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "312.4", usd: "1383.93", listed: true, priceKept: true };
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [NEAR] });
  const r = await svc.call("spending.topUp", { usd: "25" });
  assert.ok("problem" in r);
  assert.deepEqual([r.problem.service, r.problem.whatHappened], ["oneclick", "NEAR Intents' price for NEAR isn't read yet. Nothing moved."]);
  assert.ok(!e.asked.some((a) => (a as { add?: unknown }).add !== undefined), "no move was started at a kept price");
  // control: USDC needs no price; the same kept list pays in dollars as asked
  const e2 = fakeEngine({ totalUsd: 0 });
  const usdc = { tokenId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", symbol: "USDC", amount: "100", usd: "100", listed: true, priceKept: true };
  const ok = await service(e2, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [usdc] }).svc.call("spending.topUp", { usd: "25" });
  assert.ok("ok" in ok);
});

test("mainnet 2 Nov: the $2 least paid in NEAR pays enough NEAR that 1Click's promise still reaches the core's $2 floor (0.47 NEAR, $2.00, was promised $1.977 and the core refused the Add)", async () => {
  const NEAR = { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "2.229965", usd: "9.47", listed: true };
  const per = 9.47 / 2.229965;
  const e = fakeEngine({ totalUsd: 0 });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [NEAR] });
  assert.ok("ok" in (await svc.call("spending.topUp", { usd: 2 })));
  const paid = Number((e.asked.at(-1) as { from: { amount: string } }).from.amount) * per;
  // 1Click's promise on that Add, as quoted on mainnet 2 Nov: 98.75 % of what's paid (its 1 % slippage, its fee)
  assert.ok(paid * 0.9875 >= 2, `$${paid.toFixed(4)} of NEAR is promised $${(paid * 0.9875).toFixed(4)}: under the core's $2 floor`);
  assert.ok(paid <= 2.07, `and never much more than asked: $${paid.toFixed(4)}`);
  // above the least, exactly the dollars asked, as before
  assert.ok("ok" in (await svc.call("spending.topUp", { usd: 5 })));
  assert.equal((e.asked.at(-1) as { from: { amount: string } }).from.amount, String(Math.floor((5 / per) * 1e4) / 1e4), "NEAR to four places, rounded down (audit S1)");
  // a coin worth the least but not the swap's cost on top: a plain Problem before any sheet, never the core's refusal
  const thin = fakeEngine({ totalUsd: 0 });
  const t = service(thin, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [{ ...NEAR, amount: "0.475", usd: "2.02" }] });
  const r = await t.svc.call("spending.topUp", { usd: 2 });
  assert.ok("problem" in r && r.problem.code === "spending.topup.one-coin", JSON.stringify(r));
  assert.equal(thin.asked.filter((a) => (a as { add?: number }).add !== undefined).length, 0, "nothing asked of the engine");
});

test("mainnet 2 Nov (m-refund, m-crash): a Safe that can't be read is never 'no coin': the ledger's own Problem goes back, nothing asked of the engine", async () => {
  // the Safe really held 8.49 USDC and 1.73 NEAR; a busy node made ledger.balances fail, and the Top up said
  // "Your Safe has no coin worth $2.00 or more … Add money" (spending.topup.no-coin)
  const unreachable = { code: "ledger.nodes.unreachable", whatHappened: "We can't reach the network right now.", money: { state: "safe" as const, where: "in your balance" }, next: { kind: "retry" as const, label: "Try again" } };
  for (const fail of [new ProblemError(unreachable), new Error("socket hang up")]) {
    const e = fakeEngine({ totalUsd: 0 });
    const svc = createSpendingService({
      engine: () => e,
      async call<T>(method: string): Promise<T> {
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return { ok: true } as T;
        if (method === "account.protection.get") return DEFAULT_BANDS as T;
        if (method === "ledger.balances") throw fail;
        throw new Error(`no answer for ${method}`);
      },
    });
    const r = await svc.call("spending.topUp", { usd: 3 });
    if (!("problem" in r)) throw new Error(`went ahead: ${JSON.stringify(r)}`);
    assert.notEqual(r.problem.code, "spending.topup.no-coin", "an unread Safe is not an empty one");
    assert.equal(r.problem.code, fail instanceof ProblemError ? "ledger.nodes.unreachable" : "security.partner.unreachable");
    assert.equal(r.problem.next.kind, "retry", "the next step is to try again, never Add money");
    assert.equal(e.asked.filter((a) => (a as { add?: number }).add !== undefined).length, 0, "nothing asked of the engine");
  }
  // and a Safe read as truly empty still says so
  const e = fakeEngine({ totalUsd: 0 });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [] });
  const r = await svc.call("spending.topUp", { usd: 3 });
  assert.ok("problem" in r && r.problem.code === "spending.topup.no-coin", JSON.stringify(r));
});

test("D55 Make ready: Spending's cash → the network's one wallet now, why 'ready', shown; more than the cash says Top up Spending", async () => {
  const e = fakeEngine({ totalUsd: 100, reserveUsd: 40, chains: [{ chain: "sol", name: "Solana", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, wallets: [] }, { chain: "bsc", name: "BNB Chain", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, closed: true, wallets: [] }] });
  const { svc } = service(e);
  const r = await svc.call<{ kind: string; shown: boolean; words: string }>("spending.makeReady", { network: "sol", usd: 10 });
  assert.ok("ok" in r && r.ok.kind === "ready" && r.ok.shown, JSON.stringify(r));
  assert.equal(r.ok.words, "Making $10.00 ready on Solana");
  assert.deepEqual(e.asked.at(-1), { moveNow: "sol", usd: 10, o: { why: "ready" } }, "to the network's current wallet: no wallet named, no slot");
  const short = await svc.call("spending.makeReady", { network: "sol", usd: 60 });
  assert.ok("problem" in short && short.problem.code === "spending.ready.short" && short.problem.next.label === "Move money");
  assert.equal(short.problem.whatHappened, "Your NEAR wallet has $40.00 cash. Move more to make it ready.");
  const small = await svc.call("spending.makeReady", { network: "sol", usd: 1 });
  assert.ok("problem" in small && small.problem.code === "spending.move.too-small");
  const closed = await svc.call("spending.makeReady", { network: "bsc", usd: 10 });
  assert.ok("problem" in closed && closed.problem.code === "spending.network.closed");
  const bad = await svc.call("spending.makeReady", { network: "base", usd: 10 });
  assert.ok("problem" in bad && bad.problem.code === "security.request.invalid");
  for (const gone of ["spending.toSite", "spending.fromSite"]) assert.equal((await svc.call(gone, { usd: 10 }) as { problem: { code: string } }).problem.code, "security.method.unknown", `${gone} is gone (D55)`);
});

test("D56 exportKey: the core's export only; the wallet keeps its place (no retire, nothing moved), and Spending says it changed", async () => {
  const e = fakeEngine();
  const { svc, calls } = service(e, { "subwallet.list": [{ id: "w0", kind: "trade", chain: "sol" }, { id: "hub", kind: "trade", chain: "near" }], "subwallet.export": { shown: true } });
  let heard = 0;
  svc.on("spending.changed", () => heard++);
  await new Promise((r) => setTimeout(r, 5));
  const before = heard;
  const r = await svc.call("spending.exportKey", { id: "w0" });
  assert.deepEqual(r, { ok: { shown: true } });
  assert.deepEqual(calls.filter((c) => c.method === "subwallet.export").map((c) => c.params), [{ id: "w0" }]);
  assert.deepEqual(e.asked.filter((a) => !(a as { cap?: number }).cap), [], "the engine is asked nothing: the wallet stays its network's one");
  assert.equal(heard, before + 1);
  const hub = await svc.call("spending.exportKey", { id: "hub" });
  assert.ok("problem" in hub && hub.problem.code === "spending.export.not-allowed");
});

test("security review 2 Nov (Medium): a key is shown through Spending only for Wallet's Details and ZeroFee's own screens, never Browser, Apps, Trade or Chat", async () => {
  // Spending asks the core as Trade, which the core lets export: the caller is Spending's rule to hold
  const { svc, calls } = service(fakeEngine(), { "subwallet.list": [{ id: "w0", kind: "trade", chain: "sol" }], "subwallet.export": { shown: true, secretKey: "k" } });
  for (const caller of ["browser", "social", "trade", "chat"]) {
    const r = await svc.call("spending.exportKey", { id: "w0", caller });
    assert.ok("problem" in r && r.problem.code === "security.request.not-allowed", `${caller}: refused`);
  }
  assert.equal(calls.filter((c) => c.method === "subwallet.export").length, 0, "the core was never asked");
  // the control: Wallet's Details, and the shell (no caller), still show it
  for (const caller of ["wallet", undefined]) assert.deepEqual(await svc.call("spending.exportKey", { id: "w0", ...(caller ? { caller } : {}) }), { ok: { shown: true, secretKey: "k" } });
  assert.equal(calls.filter((c) => c.method === "subwallet.export").length, 2);
});

test("security review 2 Nov (Low): every spending method and who may call it; Browser, Apps and Chat only read and make ready", async () => {
  // "shell": ZeroFee's own screens, a call with no caller
  const ALL = ["wallet", "trade", "browser", "social", "chat", "shell"];
  const OWN = ["wallet", "trade", "shell"];
  const EXPECTED: Record<string, string[]> = {
    // AgentZero reads how much is in Spending (its keep job, D81) and nothing else of Spending's.
    "spending.status": [...ALL, "agent"],
    // AgentZero reads the wallets Home counts (its balance and read_holdings: the sites' own wallets), reading only
    "spending.wallets": [...ALL, "agent"],
    // AgentZero follows a move to its end (UI's AgentZero walk, 3 Nov): reading changes nothing
    "spending.activity": [...ALL, "agent"],
    "spending.makeReady": ALL,
    "spending.topUp": OWN,
    "spending.putAway": OWN,
    // E5 (Home's Move and Swap between the person's own wallets): who moves Spending's money
    "spending.move": OWN,
    "spending.setCap": OWN,
    "spending.exportKey": ["wallet", "shell"],
    // Home's Swap of a coin inside one wallet (trade/src/swap-door.ts): Home only
    "spending.swap.find": ["wallet", "shell"],
    "spending.swap.held": ["wallet", "shell"],
    "spending.swap.quote": ["wallet", "shell"],
    "spending.swap.go": ["wallet", "shell"],
  };
  assert.deepEqual(Object.fromEntries(Object.entries(SPENDING_ALLOWED).map(([m, c]) => [m, [...c]])), EXPECTED, "the table is the rule, method by method");
  const params: Record<string, Record<string, unknown>> = { "spending.makeReady": { network: "sol", usd: 10 }, "spending.topUp": { usd: 20 }, "spending.putAway": { usd: "all" }, "spending.move": { from: "sol", to: "near", usd: 10, key: "home-move-0123456789ab" }, "spending.setCap": { usd: 600 }, "spending.exportKey": { id: "w0" } };
  for (const [method, allowed] of Object.entries(EXPECTED)) {
    for (const caller of [...ALL, "bitchat", "agent", "pay"]) {
      const e = fakeEngine({ reserveUsd: 100 });
      const { svc, calls } = service(e, { "subwallet.list": [{ id: "w0", kind: "trade", chain: "sol" }], "subwallet.export": { shown: true } });
      const r = await svc.call(method, { ...params[method], ...(caller === "shell" ? {} : { caller }) });
      const refused = "problem" in r && r.problem.code === "security.request.not-allowed";
      assert.equal(refused, !allowed.includes(caller), `${method} from ${caller}: ${allowed.includes(caller) ? "allowed" : "refused"}`);
      if (refused) {
        assert.deepEqual(calls.filter((c) => !c.method.startsWith("device.store.")).map((c) => c.method), [], `${method} from ${caller}: nothing asked`);
        assert.deepEqual(e.asked.filter((a) => !("cap" in (a as object)) || (a as { cap: number }).cap !== SPENDING_CAP.defaultUsd), [], `${method} from ${caller}: the engine untouched`);
      }
    }
  }
});

test("AgentZero reads a Safe → NEAR wallet → SOL wallet move to its end, legs and where each goes on to; every method that changes Spending stays Wallet's and Trade's (control: each write from AgentZero is refused in words, nothing asked)", async () => {
  const moves: EngineMove[] = [
    { id: "mv-1", kind: "add", usd: 20, status: "done", at: 1, to: "sol" },
    { id: "mv-2", kind: "out", chain: "sol", usd: 19.4, status: "moving", at: 2, of: "mv-1" },
  ];
  const e = fakeEngine({ reserveUsd: 0, moves });
  const { svc } = service(e);
  const r = await svc.call<{ id: string; status: string; of?: string; to?: string; network?: string }[]>("spending.activity", { caller: "agent" });
  assert.ok("ok" in r, JSON.stringify(r));
  assert.deepEqual(r.ok.map((a) => [a.id, a.status, a.of ?? null, a.to ?? a.network ?? null]), [["mv-1", "done", null, "sol"], ["mv-2", "on-its-way", "mv-1", "sol"]]);
  const writes: [string, Record<string, unknown>][] = [["spending.topUp", { usd: 20 }], ["spending.putAway", { usd: "all" }], ["spending.move", { from: "sol", to: "near", usd: 10, key: "home-move-0123456789ab" }], ["spending.setCap", { usd: 600 }], ["spending.makeReady", { network: "sol", usd: 10 }]];
  for (const [method, p] of writes) {
    const w = await svc.call(method, { ...p, caller: "agent" });
    assert.ok("problem" in w && w.problem.code === "security.request.not-allowed" && w.problem.more === "Only Wallet and Trade change your NEAR wallet.", `${method}: ${JSON.stringify(w)}`);
  }
  assert.deepEqual(e.asked.filter((a) => !("cap" in (a as object))), [], "the engine untouched");
});

test("UI's AgentZero walk (5): every least and the legs' prices are checked before the Approve, so Face ID is never asked for a Move that would stop; the sheet says the least (control: at the least, and with a price, it goes to the Approve)", async () => {
  const run = async (legs: { network: string; usd: number }[], price = 100) => {
    const e = fakeEngine({ totalUsd: 0 });
    const calls: string[] = [];
    const answers: Record<string, unknown> = { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] };
    const svc = createSpendingService({
      engine: () => e,
      nativeUsd: async () => { if (!price) throw new Error("no price"); return price; },
      async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
        calls.push(method);
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return {} as T;
        if (method in answers) return answers[method] as T;
        throw new Error(`no answer for ${method}: ${JSON.stringify(params)}`);
      },
    });
    const usd = legs.reduce((n, l) => n + l.usd, 0);
    const r = await svc.call<{ id: string }>("spending.topUp", { usd, legs });
    return { r, added: e.asked.filter((a) => "add" in (a as object)).length };
  };
  // $2.00 from the Safe to the SOL wallet: the Add brings about $1.98, the move on keeps 3 %, and the core refuses a move
  // out under $2, so it would stop in the NEAR wallet after Face ID
  const small = await run([{ network: "sol", usd: 2 }]);
  assert.ok("problem" in small.r && small.r.problem.code === "spending.move.legs" && small.r.problem.whatHappened === "At least $2.09 from your Safe to a wallet. Nothing moved.", JSON.stringify(small.r));
  assert.equal(small.added, 0, "no Approve, no Face ID");
  // a leg that stays in the NEAR wallet needs no move on: $2 is enough
  const near = await run([{ network: "near", usd: 2 }]);
  assert.ok("ok" in near.r && near.added === 1, JSON.stringify(near.r));
  // no price for the leg's coin now: said before the Approve, never a leg that stops after Face ID
  const unpriced = await run([{ network: "sol", usd: 20 }], 0);
  assert.ok("problem" in unpriced.r && /Solana's price isn't read yet\. Nothing moved\./.test(unpriced.r.problem.whatHappened), JSON.stringify(unpriced.r));
  assert.equal(unpriced.added, 0);
  // controls: at the least, and with a price, it goes to the Approve
  const least = await run([{ network: "sol", usd: 2.09 }]);
  assert.ok("ok" in least.r && least.added === 1, JSON.stringify(least.r));
  const twenty = await run([{ network: "sol", usd: 20 }]);
  assert.ok("ok" in twenty.r && twenty.added === 1, JSON.stringify(twenty.r));
});

test("UI's AgentZero walk (5): a wallet's leg home under its least is refused before anything moves ($2.00 brought about $1.97, and its move home was refused in the NEAR wallet); control: $2.59 goes", async () => {
  const run = async (usd: number) => {
    const e = fakeEngine({ totalUsd: 50 });
    const took: unknown[] = [];
    (e as unknown as { takeOutFrom: (l: unknown) => Promise<EngineMove> }).takeOutFrom = async (l) => { took.push(l); return { id: "h1", kind: "home", usd, status: "waiting", at: 0 }; };
    const { svc } = service(e);
    return { r: await svc.call("spending.putAway", { legs: [{ network: "sol", usd }] }), took };
  };
  const small = await run(2);
  assert.ok("problem" in small.r && small.r.problem.whatHappened === "At least $2.59 from a wallet to your Safe. Nothing moved.", JSON.stringify(small.r));
  assert.equal(small.took.length, 0, "nothing moved");
  const ok = await run(2.59);
  assert.ok("ok" in ok.r && ok.took.length === 1, JSON.stringify(ok.r));
});

test("UI's AgentZero walk (4): the core's move words never say Top up, Spending, Trading or Hidden (control: a Move from the Safe names where it goes)", async () => {
  const moves: EngineMove[] = [
    { id: "t1", kind: "add", usd: 20, status: "moving", at: 1 },
    { id: "t2", kind: "add", usd: 20, status: "done", at: 2 },
    { id: "t3", kind: "add", usd: 20, status: "refunded", at: 3 },
  ];
  const { svc } = service(fakeEngine({ moves }));
  const r = await svc.call<{ id: string; words: string }[]>("spending.activity", {});
  assert.ok("ok" in r);
  assert.deepEqual(r.ok.map((a) => a.words), ["Moving $20.00 to your NEAR wallet", "Moved $20.00 to your NEAR wallet", "Didn't move $20.00 to your NEAR wallet"]);
  for (const a of r.ok) assert.doesNotMatch(a.words, /Top(ped)? up|Spending|Trading|Hidden/);
});

test("UI's AgentZero walk ($29.21): a Move whose sheet price is further than the core's 3 % from the core's own is refused before the Approve, in a plain line (controls: 2 % apart goes; a core from before that says no price goes; an unread core price is said)", async () => {
  const run = async (core: unknown, sheet = 100) => {
    const e = fakeEngine({ totalUsd: 0 });
    const answers: Record<string, unknown> = { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC], "subwallet.float.limits": core };
    const asked: Record<string, unknown>[] = [];
    const svc = createSpendingService({
      engine: () => e,
      nativeUsd: async () => sheet,
      async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
        if (method === "subwallet.float.limits") asked.push(params);
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return {} as T;
        if (method in answers) return answers[method] as T;
        throw new Error(`no answer for ${method}`);
      },
    });
    const r = await svc.call<{ id: string }>("spending.topUp", { usd: 20, legs: [{ network: "sol", usd: 20 }] });
    return { r, added: e.asked.filter((a) => "add" in (a as object)).length, asked };
  };
  const far = await run({ movesLeftToday: 20, prices: { sol: 104 } });
  assert.ok("problem" in far.r && far.r.problem.code === "spending.move.price" && far.r.problem.whatHappened === "SOL's price changed. Nothing moved. Try again.", JSON.stringify(far.r));
  assert.equal(far.added, 0, "no Approve, no Face ID");
  assert.deepEqual(far.asked, [{ prices: true }], "the core's own price, asked for, read only");
  const low = await run({ movesLeftToday: 20, prices: { sol: 96 } });
  assert.ok("problem" in low.r && low.r.problem.code === "spending.move.price" && low.added === 0, "the other way too");
  const near = await run({ movesLeftToday: 20, prices: { sol: 102 } });
  assert.ok("ok" in near.r && near.added === 1, `control: 2 % apart goes ${JSON.stringify(near.r)}`);
  const old = await run({ movesLeftToday: 20 });
  assert.ok("ok" in old.r && old.added === 1, "control: a core from before that says no price: no check here (the core's own still holds)");
  const unread = await run({ movesLeftToday: 20, prices: { sol: null } });
  assert.ok("problem" in unread.r && /Solana's price isn't read yet\. Nothing moved\./.test(unread.r.problem.whatHappened) && unread.added === 0, JSON.stringify(unread.r));
});

test("audit H1 (fix #3): a Move from the Safe to a wallet leaves the Safe rounded UP to the inflow grid ($100 → $110, $17.43 → $18), each leg exactly as asked, the rest hidden in the NEAR wallet (controls: nothing going on to a wallet, a Safe that can't hold it: exactly as asked)", async () => {
  const run = async (legs: { network: string; usd: number }[], usdcHeld = "800") => {
    const e = fakeEngine({ totalUsd: 0 });
    const answers: Record<string, unknown> = { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [{ ...USDC, amount: usdcHeld, usd: usdcHeld }] };
    const svc = createSpendingService({
      engine: () => e,
      nativeUsd: async () => 100,
      async call<T>(method: string): Promise<T> {
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return {} as T;
        if (method in answers) return answers[method] as T;
        throw new Error(`no answer for ${method}`);
      },
    });
    const usd = Math.round(legs.reduce((n, l) => n + l.usd, 0) * 100) / 100;
    const r = await svc.call("spending.topUp", { usd, legs });
    assert.ok("ok" in r, JSON.stringify(r));
    return e.asked.find((a) => "add" in (a as object)) as { add: number };
  };
  assert.equal((await run([{ network: "sol", usd: 100 }])).add, 110, "$110.00 leaves the Safe; $100 goes on to the SOL wallet");
  assert.equal((await run([{ network: "sol", usd: 60 }, { network: "near", usd: 40 }])).add, 110, "with a NEAR wallet leg too");
  assert.equal((await run([{ network: "near", usd: 100 }])).add, 100, "control: nothing goes on to a wallet: exactly as asked");
  assert.equal((await run([{ network: "sol", usd: 100 }], "105")).add, 100, "control: the Safe holds only $105: exactly as asked");
  assert.equal((await run([{ network: "sol", usd: 17.43 }])).add, 18, "privacy audit (4 Nov): the rest stays hidden, so no $2 floor: $17.43 is rounded too");
});

test("audit H1: the Safe's grid follows the Face ID band to the cent, by the same rule the sheets use (safeSends): a band of $110 sends $110.00, a band of $109.99 sends exactly $100 (control)", async () => {
  const run = async (upToUsd: number) => {
    const e = fakeEngine({ totalUsd: 0 });
    const bands = { bands: [{ up_to: null, level: "FaceId" }], usd: [{ upToUsd, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 86_400 }] };
    const svc = createSpendingService({
      engine: () => e,
      nativeUsd: async () => 100,
      async call<T>(method: string): Promise<T> {
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return {} as T;
        if (method === "account.protection.get") return bands as T;
        if (method === "ledger.balances") return [USDC] as T;
        throw new Error(`no answer for ${method}`);
      },
    });
    const r = await svc.call("spending.topUp", { usd: 100, legs: [{ network: "sol", usd: 100 }] });
    assert.ok("ok" in r, JSON.stringify(r));
    return (e.asked.find((a) => "add" in (a as object)) as { add: number }).add;
  };
  assert.equal(await run(110), 110);
  assert.equal(await run(109.99), 100, "control: past the band, exactly as asked");
  // the sheets' own figure for the same Safe, room and band: the same
  assert.equal(safeSends([USDC], 100, { roomUsd: 500, bandUsd: 110, onward: true }), 110);
  assert.equal(safeSends([USDC], 100, { roomUsd: 500, bandUsd: 109.99, onward: true }), 100);
});

test("privacy audit (4 Nov): the rest stays hidden in the NEAR wallet, so no $2 floor for a move home: every Move the Safe can cover is rounded ($17.43 → $18, $25 → $26, $100 → $110), and the words never say it comes back (control: a Safe that can't cover the grid sends exactly)", () => {
  const o = { coversUsd: 800, roomUsd: 800, bandUsd: null };
  assert.equal(gridAddUsd(17.43, o), 18, "before: $17.43, its $0.57 rest couldn't come home, so the Move went unrounded and was linkable");
  assert.equal(gridAddUsd(25, o), 26);
  assert.equal(gridAddUsd(100, o), 110);
  assert.equal(gridAddUsd(17.43, { ...o, coversUsd: 17.9 }), 17.43, "control: the Safe can't send the grid's");
  assert.equal(REST_STAYS_LINE, "The rest stays in Private.");
});

test("every Spending Problem has the three parts and a row in errors.md", () => {
  const catalogue = readFileSync(new URL("../errors.md", import.meta.url), "utf8");
  for (const [name, make] of Object.entries(spendingProblems)) {
    const p = (make as (...a: number[]) => ReturnType<typeof spendingProblems.tooSmall>)(100, 500);
    assert.ok(p.code.startsWith("spending."), name);
    assert.ok(p.whatHappened.length > 8 && p.money.state && p.next.label, name);
    assert.ok(catalogue.includes(`\`${p.code}\``), `${p.code} is missing from errors.md`);
  }
});

test("spending.changed only when status would answer differently: a listener that reads status on each event can't loop (robot, 1 Nov)", async () => {
  const e = fakeEngine({ totalUsd: 10 });
  const { svc } = service(e);
  let heard = 0;
  svc.on("spending.changed", () => heard++);
  await new Promise((r) => setTimeout(r, 10));
  e.set({});                     // the engine tells (a refresh), nothing changed
  e.set({});
  assert.equal(heard, 1, "the first answer is told once; the same answer again is not");
  e.set({ totalUsd: 12 });
  assert.equal(heard, 2, "a different answer is told");
});

test("spending.wallets reads Spending first: one wallet per chain (D55), older ones while they hold anything, Base outside the cap", async () => {
  const e = fakeEngine({ loaded: true });
  let refreshed = 0;
  const w = (id: string, nativeUsd: number, current: boolean, coinsUsd = 0) => ({ id, chain: "sol" as const, nativeUsd, coinsUsd, current });
  const read = { reserveUsd: 30, chains: [{ chain: "sol" as const, name: "Solana", nativeUsd: 21, readyUsd: 16, coinsUsd: 4, wallets: [w("w0", 16, true), w("w2", 5, false, 4), w("w3", 0, false)] }] };
  e.refresh = async () => { refreshed++; e.set({ loaded: true, ...read }); };
  const list = [
    { id: "hub", kind: "trade", chain: "near", address: "f10a", label: "Spending" },
    { id: "w0", kind: "trade", chain: "sol", address: "So1", label: "Trading wallet", current: true, keyExported: true },
    { id: "w2", kind: "trade", chain: "sol", address: "So2", label: "Trading wallet", current: false },
    { id: "w3", kind: "trade", chain: "sol", address: "So3", label: "Trading wallet", current: false },
    { id: "b0", kind: "browser", chain: "base", address: "0xb0", label: "Apps wallet", current: true },
    { id: "card", kind: "pay", chain: "gnosis", address: "0xca", label: "Card wallet" },
  ];
  const { svc } = service(e, { "subwallet.list": list, "subwallet.balances": [{ token: "native", symbol: "ETH", decimals: 18, amount: "1200000000000000" }] });
  const r = await svc.call<{ id: string; role: string; label: string; current: boolean; inCap: boolean; cashUsd?: string; holds?: string; keyExported: boolean; unread?: true }[]>("spending.wallets", {});
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(refreshed, 1);
  assert.deepEqual(r.ok.map((x) => [x.id, x.role, x.label, x.current, x.inCap, x.cashUsd ?? x.holds, x.keyExported, x.unread ?? false]), [
    ["hub", "hub", "Your NEAR wallet's cash", true, true, "30.00", false, false],
    ["w0", "chain", "SOL wallet", true, true, "16.00", true, false],
    ["w2", "older", "Older SOL wallet", false, true, "5.00", false, false],
    ["b0", "chain", "Base wallet", true, false, "0.0012 ETH", false, false],
  ], "an empty older wallet (w3) isn't listed; the card isn't Spending's");
  // a read that fails still lists the wallet, marked unread (never a $0 that looks read)
  const down = fakeEngine({ loaded: false });
  down.refresh = async () => { throw new Error("nodes down"); };
  const r2 = await service(down, { "subwallet.list": [list[1]] }).svc.call<{ unread?: true }[]>("spending.wallets", {});
  assert.ok("ok" in r2 && r2.ok[0].unread === true);
});

test("spending.wallets: a closed network's wallet (BNB Chain until its own test) is read from the chain, outside the cap, never 'Can't see it' (demo, 2 Nov)", async () => {
  const e = fakeEngine({ loaded: true, chains: [{ chain: "bsc", name: "BNB Chain", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, closed: true, wallets: [] }] });
  const bnb = { id: "bnb", kind: "trade", chain: "bsc", address: "0xbb", label: "Trading wallet", current: true };
  const { svc } = service(e, { "subwallet.list": [bnb], "subwallet.balances": [{ token: "native", symbol: "BNB", decimals: 18, amount: "50000000000000000" }] });
  const r = await svc.call<{ id: string; inCap: boolean; holds?: string; unread?: true }[]>("spending.wallets", {});
  assert.ok("ok" in r);
  assert.deepEqual(r.ok.map((x) => [x.id, x.inCap, x.holds, x.unread ?? false]), [["bnb", false, "0.05 BNB", false]]);
  // the control: the chain's read failing still says so
  const { svc: down } = service(fakeEngine({ loaded: true, chains: [{ chain: "bsc", name: "BNB Chain", nativeUsd: 0, readyUsd: 0, coinsUsd: 0, closed: true, wallets: [] }] }), { "subwallet.list": [bnb] });
  const r2 = await down.call<{ unread?: true }[]>("spending.wallets", {});
  assert.ok("ok" in r2 && r2.ok[0].unread === true);
});

test("a Top up row that ended other than done always says where its money is, even when the engine gave no words (mainnet 2 Nov, m-refund: \"Top up $3.00 (failed)\" and nothing after it)", async () => {
  const e = fakeEngine({ moves: [
    { id: "t1", kind: "add", usd: 3, status: "failed", at: 1 },
    { id: "t2", kind: "add", usd: 3, status: "refunded", at: 2 },
    { id: "t3", kind: "add", usd: 3, status: "failed", stayed: true, at: 3 },
    { id: "t4", kind: "add", usd: 3, status: "failed", at: 4, note: "The swap service is still finishing it (its id: abc)" },
    { id: "t5", kind: "add", usd: 3, status: "done", at: 5 },
  ] });
  const { svc } = service(e);
  const r = await svc.call<{ id: string; status: string; note?: string }[]>("spending.activity", {});
  assert.ok("ok" in r);
  const by = Object.fromEntries(r.ok.map((x) => [x.id, x]));
  assert.deepEqual([by.t1!.status, by.t2!.status, by.t3!.status, by.t4!.status], ["failed", "refunded", "refused", "failed"]);
  for (const id of ["t1", "t2", "t3", "t4"]) assert.ok((by[id]!.note ?? "").length > 10, `${id} says where the money is: ${by[id]!.note}`);
  assert.match(by.t2!.note!, /your NEAR wallet/);
  assert.match(by.t3!.note!, /stayed in your Safe/);
  assert.equal(by.t4!.note, "The swap service is still finishing it (its id: abc)", "the engine's own words win");
  assert.equal(by.t5!.note, undefined, "a done Top up needs no words");
});

test("grade 02h, H4: a test account's Top up is refused first, with where the money is: no amount, coin or engine asked", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const { svc, calls } = service(e, { "account.state": { stage: "ready", account: { accountId: "zf-1.testnet", network: "testnet" } }, "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
  const r = await svc.call("spending.topUp", { usd: 500 });
  assert.ok("problem" in r && r.problem.code === "spending.topup.test-account", JSON.stringify(r));
  assert.deepEqual(r.problem.money, { state: "safe", where: "in your Safe" });
  assert.equal(calls.some((c) => c.method === "ledger.balances" || c.method === "account.protection.get"), false);
  assert.equal(e.asked.filter((a) => (a as { add?: number }).add !== undefined).length, 0, "nothing asked of the engine");
  // control: the same Top up on a mainnet account goes on to the engine
  const m = fakeEngine({ totalUsd: 0 });
  const main = service(m, { "account.state": { stage: "ready", account: { accountId: "a.near", network: "mainnet" } }, "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
  assert.ok("ok" in (await main.svc.call("spending.topUp", { usd: 50 })));
});

test("grade 02h, H4: the Top up amount starts at what one coin of the Safe can pay", () => {
  // Trade's sheet asks pickSafeCoin(coins, Infinity) for the most one coin covers: $31.23 of NEAR, never $500
  const NEAR_ROW = { tokenId: "near", symbol: "NEAR", amount: "7.29", usd: "31.23", listed: true };
  assert.equal(pickSafeCoin([NEAR_ROW], Infinity)?.coversUsd, 31.23);
  assert.equal(pickSafeCoin([NEAR_ROW, USDC], Infinity)?.coversUsd, 800);
  assert.equal(pickSafeCoin([], Infinity), null);
});

// UX walk 2 Nov (the test release-4 account, mainnet): its rules from 25 Oct count NEAR only; a Top up moves wNEAR
// (1Click's only NEAR), which they hold as a big payment. Said before any quote, and with rules already saved that count
// every coin, the one step is to finish them, in place: never a second save.
const OWNER_25_OCT = {
  bands: [{ up_to: [["near", "5000000000000000000000000"]], level: "FaceId" }, { up_to: null, level: { Wait: { seconds: "120" } } }],
  usd: [{ upToUsd: 21, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 120 }],
};
const SAFE_NEAR = { tokenId: "near", symbol: "NEAR", amount: "7.2", usd: "30.80", listed: true };
test("UX 2 Nov: a $5 Top up on NEAR-only rules is answered before any quote: Count every coin when nothing is saved", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const { svc } = service(e, { "account.protection.get": OWNER_25_OCT, "ledger.balances": [SAFE_NEAR], "account.waiting": [] });
  const r = await svc.call("spending.topUp", { usd: "5" });
  assert.ok("problem" in r && r.problem.code === "security.quote.cant-wait");
  assert.deepEqual(r.problem.next, { kind: "open", label: "Save my rules", screen: "security/protection" });
  assert.ok(!e.asked.some((a) => "add" in (a as object)), "no quote was asked");
});
test("UX 2 Nov: with new rules saved and past their wait, the Top up says Finish my new rules, the newest one, in place", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const waiting = [
    { id: "2", ready: true, readyAtIso: "2026-11-02T02:53:34.000Z", needsSecondDevice: false, countsEveryCoin: true, title: "Change your protection" },
    { id: "3", ready: true, readyAtIso: "2026-11-02T02:57:51.000Z", needsSecondDevice: false, countsEveryCoin: true, title: "Change your protection" },
  ];
  const { svc } = service(e, { "account.protection.get": OWNER_25_OCT, "ledger.balances": [SAFE_NEAR], "account.waiting": waiting });
  const r = await svc.call("spending.topUp", { usd: "5" });
  assert.ok("problem" in r);
  assert.deepEqual(r.problem.next, { kind: "open", label: "Finish my new rules", screen: "held/3" });
  assert.ok(!e.asked.some((a) => "add" in (a as object)));
});
test("UX 2 Nov: still waiting, it says See my new rules; rules that count every coin, or a USDC band, go straight on", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const waiting = [{ id: "4", ready: false, readyAtIso: "2026-11-02T03:30:00.000Z", needsSecondDevice: false, countsEveryCoin: true }];
  const { svc } = service(e, { "account.protection.get": OWNER_25_OCT, "ledger.balances": [SAFE_NEAR], "account.waiting": waiting });
  const r = await svc.call("spending.topUp", { usd: "5" });
  assert.ok("problem" in r && r.problem.next.kind === "open" && r.problem.next.screen === "held/4" && r.problem.next.label === "See my new rules");
  const every = { ...OWNER_25_OCT, bands: [{ up_to: [["near", "1"], ["nep141:wrap.near", "1"]], level: "FaceId" }, OWNER_25_OCT.bands[1]] };
  const e2 = fakeEngine({ totalUsd: 0 });
  assert.ok("ok" in (await service(e2, { "account.protection.get": every, "ledger.balances": [SAFE_NEAR] }).svc.call("spending.topUp", { usd: "5" })));
  const usdcBand = { ...OWNER_25_OCT, bands: [{ up_to: [["near", "1"], ["nep141:usdc", "21000000"]], level: "FaceId" }, OWNER_25_OCT.bands[1]] };
  const e3 = fakeEngine({ totalUsd: 0 });
  assert.ok("ok" in (await service(e3, { "account.protection.get": usdcBand, "ledger.balances": [USDC] }).svc.call("spending.topUp", { usd: "5" })), "USDC is listed: its Top up isn't held");
});

test("Home's Swap (2 Nov): spending.topUp with swap NEAR pays with NEAR only, even when the Safe holds dollars; any other name is refused before anything is asked", async () => {
  const NEAR = { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "312.4", usd: "1383.93", listed: true };
  const e = fakeEngine({ totalUsd: 0 });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC, NEAR] });
  const r = await svc.call("spending.topUp", { usd: "25", swap: "NEAR" });
  assert.ok("ok" in r);
  assert.deepEqual(e.asked.at(-1), { add: 25, from: { tokenId: "nep141:wrap.near", amount: "5.6433", symbol: "NEAR" } }, "NEAR, never the USDC a plain Top up would pick");
  // control: the same Safe without `swap` pays with USDC (dollar coins first)
  const e2 = fakeEngine({ totalUsd: 0 });
  const plain = service(e2, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC, NEAR] });
  assert.ok("ok" in (await plain.svc.call("spending.topUp", { usd: "25" })));
  assert.deepEqual(e2.asked.at(-1), { add: 25, from: undefined });
  for (const bad of ["BTC", "USDC", "near", 1]) {
    const e3 = fakeEngine({ totalUsd: 0 });
    const s3 = service(e3, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC, NEAR] });
    const out = await s3.svc.call("spending.topUp", { usd: "25", swap: bad });
    assert.ok("problem" in out, `swap ${String(bad)} is refused`);
    assert.ok(!e3.asked.some((a) => "add" in (a as object)), "no Top up asked of the engine");
  }
  // a Safe with no NEAR: the swap is refused, never paid with the USDC that is there
  const e4 = fakeEngine({ totalUsd: 0 });
  const none = service(e4, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
  assert.ok("problem" in (await none.svc.call("spending.topUp", { usd: "25", swap: "NEAR" })));
  assert.ok(!e4.asked.some((a) => "add" in (a as object)));
  // security review (M1): NEAR whose price can't be worked out is refused, never paid in USDC instead
  const e5 = fakeEngine({ totalUsd: 0 });
  const unpriced = service(e5, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC, { tokenId: "nep141:wrap.near", symbol: "NEAR", amount: "x", usd: "1383.93", listed: true }] });
  assert.ok("problem" in (await unpriced.svc.call("spending.topUp", { usd: "25", swap: "NEAR" })));
  assert.ok(!e5.asked.some((a) => "add" in (a as object)));
});

test("the swap service's own time estimate rides on a Top up's row while it is on its way, and only a sane one (display only)", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  e.add = async (usd) => ({ id: "a1", kind: "add", usd, status: "moving", at: 0, etaSec: 20 });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC] });
  const r = await svc.call<{ etaSeconds?: number }>("spending.topUp", { usd: "25" });
  assert.ok("ok" in r && r.ok.etaSeconds === 20);
  for (const bad of [0, -5, 1.5, 99999]) {
    e.add = async (usd) => ({ id: "a1", kind: "add", usd, status: "moving", at: 0, etaSec: bad });
    const out = await svc.call<{ etaSeconds?: number }>("spending.topUp", { usd: "25" });
    assert.ok("ok" in out && out.ok.etaSeconds === undefined, `eta ${bad} is dropped`);
  }
});

test("D146: spending.topUp tells the engine which app asked (forApps' caller), so the Safe's sheet is that app's; Trade's own and ZeroFee's own screens name none (controls)", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const askers: unknown[] = [];
  e.add = async (usd, _from, _ready, _legs, _then, asker) => { askers.push(asker); return { id: `a${askers.length}`, kind: "add", usd, status: "moving", at: 0 }; };
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC], "account.state": {} });
  for (const caller of ["wallet", "trade", undefined]) {
    const r = await svc.call("spending.topUp", { usd: "10", key: `k-${caller ?? "shell"}-0123456789`, ...(caller ? { caller } : {}) });
    assert.ok("ok" in r, JSON.stringify(r));
  }
  assert.deepEqual(askers, ["wallet", undefined, undefined]);
});

test("Social Trading's Add: spending.topUp with `ready` names a site's own wallet on Solana; the engine takes it on; anything else is refused before any sheet; its rows name the site", async () => {
  const e = fakeEngine({ totalUsd: 0 });
  const got: unknown[] = [];
  e.add = async (usd, _from, ready) => { got.push(ready); return { id: "a1", kind: "add", usd, status: "moving", at: 0, ...(ready ? { ready } : {}) }; };
  const list = [
    { id: "site-pump-sol-7xKXtg", kind: "site", site: "pump", chain: "sol" },
    { id: "site-pump-sol-oldold", kind: "site", site: "pump", chain: "sol", oldWords: true },
    { id: "site-gmgn-base-0a0b0c", kind: "site", site: "gmgn", chain: "base" },
    { id: "trade-sol-abcdef", kind: "trade", chain: "sol", current: true },
  ];
  const { svc, calls } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC], "subwallet.list": list, "account.state": {} });
  const ok = await svc.call<{ words: string }>("spending.topUp", { usd: "10", ready: "site-pump-sol-7xKXtg" });
  assert.ok("ok" in ok, JSON.stringify(ok));
  assert.deepEqual(got, [{ wallet: "site-pump-sol-7xKXtg", name: "pump.fun", site: "pump" }], "with its site (D160: the row says whose wallet it filled)");
  assert.equal(ok.ok.words, "Add $10.00 to your pump.fun wallet");
  for (const ready of ["site-pump-sol-oldold", "site-gmgn-base-0a0b0c", "trade-sol-abcdef", "nope"]) {
    const no = await svc.call("spending.topUp", { usd: "10", ready });
    assert.ok("problem" in no && no.problem.code === "security.subwallet.unknown", ready);
  }
  assert.equal(got.length, 1, "nothing else reached the engine");
  assert.equal(calls.filter((c) => c.method === "ledger.toTrading").length, 0);
  // its move on to the site's wallet names the site too
  e.set({ moves: [{ id: "s9", kind: "out", chain: "sol", usd: 9.8, status: "done", at: 0, why: "ready", wallet: "site-pump-sol-7xKXtg" }] });
  const rows = await svc.call<{ words: string }[]>("spending.activity", {});
  assert.ok("ok" in rows);
  assert.deepEqual(rows.ok.map((r) => r.words), ["Added $9.80 to your pump.fun wallet"]);
});

test("D102: every move the engine makes by itself is named and shown; the person's own legs to and from a network are theirs", async () => {
  const at = 0;
  const e = fakeEngine({ totalUsd: 40, moves: [
    { id: "g", kind: "out", chain: "sol", usd: 2.1, status: "done", at, why: "gas" },
    { id: "c", kind: "home", usd: 12, status: "waiting", at, why: "over-cap" },
    { id: "ci", kind: "in", chain: "hood", usd: 7, status: "moving", at, why: "over-cap" },
    { id: "o", kind: "in", chain: "sol", usd: 5, status: "done", at, why: "older" },
    { id: "mo", kind: "out", chain: "sol", usd: 15, status: "moving", at, why: "asked" },
    { id: "mi", kind: "in", chain: "hood", usd: 10, status: "done", at, why: "asked" },
    { id: "r", kind: "out", chain: "sol", usd: 40, status: "done", at },
  ] });
  const { svc } = service(e);
  const r = await svc.call<{ id: string; kind: string; shown: boolean; words: string }[]>("spending.activity", {});
  assert.ok("ok" in r);
  const by = Object.fromEntries(r.ok.map((x) => [x.id, x]));
  assert.deepEqual([by.g!.kind, by.g!.shown, by.g!.words], ["gas", true, "Kept for fees on Solana"]);
  assert.deepEqual([by.c!.kind, by.c!.shown, by.c!.words], ["over-cap", true, "$12.00 back to your Safe, over your limit"]);
  assert.deepEqual([by.ci!.kind, by.ci!.shown, by.ci!.words], ["over-cap", true, "$7.00 back from Robinhood Chain, above your cap"]);
  assert.deepEqual([by.o!.kind, by.o!.shown, by.o!.words], ["older", true, "$5.00 back from an older Solana wallet"]);
  assert.deepEqual([by.mo!.kind, by.mo!.shown, by.mo!.words], ["ready", true, "Moving $15.00 to Solana"]);
  assert.deepEqual([by.mi!.kind, by.mi!.shown, by.mi!.words], ["put-away", true, "Brought $10.00 back from Robinhood Chain"]);
  // a journal from before D102: the split's own refill, behind the scenes
  assert.deepEqual([by.r!.kind, by.r!.shown], ["refill", false]);
  // the person's own leg on its way is on Home's "on its way" list
  const s = await svc.call<SpendingStatus>("spending.status", {});
  assert.ok("ok" in s && s.ok.onItsWay.some((m) => m.id === "mo"), "a Move leg on its way is on Home");
});

test("D137: a Move from the Safe says where the person sent it (its legs' wallets), never Top up; control: no legs, the NEAR wallet", async () => {
  const e = fakeEngine({ moves: [
    { id: "s1", kind: "add", usd: 5, status: "moving", at: 1, legs: [{ chain: "sol", usd: 5 }] },
    { id: "s2", kind: "add", usd: 8, status: "done", at: 2, legs: [{ chain: "sol", usd: 4, sent: true }, { chain: "hood", usd: 4, sent: true }] },
    { id: "s5", kind: "add", usd: 5, status: "done", at: 5, legs: [{ chain: "sol", usd: 5 }] },
    { id: "s3", kind: "add", usd: 3, status: "done", at: 3 },
    { id: "s4", kind: "add", usd: 3, status: "failed", at: 4, legs: [{ chain: "near", usd: 3 }] },
  ] });
  const { svc } = service(e);
  const r = await svc.call<{ id: string; words: string; goesTo?: string[] }[]>("spending.activity", {});
  assert.ok("ok" in r);
  const by = Object.fromEntries(r.ok.map((x) => [x.id, x]));
  assert.equal(by.s1!.words, "Moving $5.00 to your SOL wallet");
  assert.deepEqual(by.s1!.goesTo, ["sol"]);
  assert.equal(by.s2!.words, "Moved $8.00 to your wallets");
  assert.deepEqual(by.s2!.goesTo, ["sol", "hood"]);
  assert.equal(by.s3!.words, "Moved $3.00 to your NEAR wallet");
  assert.equal(by.s5!.words, "Moving $5.00 to your SOL wallet", "in the NEAR wallet, its leg on not gone yet: still moving");
  assert.equal(by.s3!.goesTo, undefined, "control: a move that stays in the NEAR wallet goes on nowhere");
  assert.equal(by.s4!.words, "Didn't move $3.00 to your NEAR wallet", "a NEAR leg stays in the NEAR wallet");
  assert.ok(r.ok.every((x) => !/Top/.test(x.words)));
});

test("Home speed (3 Nov): spending.wallets reads every site and Apps wallet at once, listed in subwallet.list's order; an empty older one still left out", async () => {
  const e = fakeEngine({ loaded: true });
  const list = [
    { id: "s1", kind: "site", chain: "sol", address: "Si1", label: "pump.fun wallet", site: "pump.fun" },
    { id: "e0", kind: "browser", chain: "eth", address: "0xe0", label: "Apps wallet", current: true },
    { id: "s2", kind: "site", chain: "sol", address: "Si2", label: "Another site's wallet", site: "other.site" },
    { id: "b1", kind: "browser", chain: "base", address: "0xb1", label: "Apps wallet", current: false },
    { id: "b0", kind: "browser", chain: "base", address: "0xb0", label: "Apps wallet", current: true },
  ];
  // each wallet answers after a delay that runs the other way to the list, so a read done in turn would show it
  const delay: Record<string, number> = { s1: 50, e0: 40, s2: 30, b1: 20, b0: 10 };
  let flying = 0, most = 0;
  const svc = createSpendingService({
    engine: () => e,
    async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
      if (method === "subwallet.list") return list as T;
      if (method !== "subwallet.balances") throw new Error(`no answer for ${method}`);
      flying++; most = Math.max(most, flying);
      await new Promise((r) => setTimeout(r, delay[String(params.id)]));
      flying--;
      const amount = params.id === "b1" ? "0" : "1000000000";
      return [{ token: "native", symbol: params.id === "s1" || params.id === "s2" ? "SOL" : "ETH", decimals: 9, amount }] as T;
    },
  });
  const r = await svc.call<{ id: string; role: string; holds?: string }[]>("spending.wallets", {});
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(most, 5, "all five wallets were read together");
  assert.deepEqual(r.ok.map((x) => [x.id, x.role, x.holds]), [["s1", "site", "1 SOL"], ["e0", "chain", "1 ETH"], ["s2", "site", "1 SOL"], ["b0", "chain", "1 ETH"]], "in the list's order; the empty older Base wallet (b1) isn't listed");
});

test("speed (D145): spending.status reads the engine beside the kept cap, never after it; the cap still counts (controls)", async () => {
  const run = async (method: string) => {
    const e = fakeEngine({ totalUsd: 10 });
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let refreshedBeforeCap = false;
    e.refresh = async () => { if (e.cap === undefined) refreshedBeforeCap = true; };
    const svc = createSpendingService({
      engine: () => e,
      async call<T>(m: string, p: Record<string, unknown>): Promise<T> {
        if (m === "device.store.get") { if (p.key !== "spending.cap.v1") return { value: null } as T; await held; return { value: "300" } as T; }
        if (m === "device.store.set") return { ok: true } as T;
        throw new Error(`no answer for ${m}`);
      },
    });
    const r = svc.call<SpendingStatus>(method, {});
    await new Promise((res) => setTimeout(res, 10));
    release();
    return { r: await r, refreshedBeforeCap };
  };
  const s = await run("spending.status");
  assert.ok("ok" in s.r, JSON.stringify(s.r));
  assert.equal(s.refreshedBeforeCap, true, "the engine's read began while the cap's was still out");
  assert.equal(s.r.ok.capUsd, "300.00", "control: the kept cap is in the answer");
  const a = await run("spending.activity");
  assert.ok("ok" in a.r);
  assert.equal(a.refreshedBeforeCap, false, "control: every other method still waits for the cap first");
});

test("speed (bug report, 5 Nov: the Safe's signature takes TOO LONG): a Move's reads before the Safe's sheet go at once, each 300 ms read waited on in parallel, not one after another (control: a test account still reads nothing else)", async () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const run = async (network: string) => {
    const e = fakeEngine({ totalUsd: 0 });
    e.refresh = async () => { await wait(300); };
    const calls: string[] = [];
    const answers: Record<string, unknown> = { "account.state": { account: { network } }, "account.protection.get": DEFAULT_BANDS, "ledger.balances": [USDC], "subwallet.float.limits": { movesLeftToday: 20, prices: { sol: 100 } } };
    const svc = createSpendingService({
      engine: () => e,
      nativeUsd: async () => { await wait(300); return 100; },
      async call<T>(method: string, _p: Record<string, unknown>): Promise<T> {
        calls.push(method);
        if (method === "device.store.get") return { value: null } as T;
        if (method === "device.store.set") return {} as T;
        await wait(300);
        if (method in answers) return answers[method] as T;
        throw new Error(`no answer for ${method}`);
      },
    });
    const t0 = performance.now();
    const r = await svc.call("spending.topUp", { usd: 20, legs: [{ network: "sol", usd: 20 }] });
    return { r, ms: performance.now() - t0, added: e.asked.filter((a) => "add" in (a as object)).length, calls };
  };
  const m = await run("mainnet");
  assert.ok("ok" in m.r && m.added === 1, JSON.stringify(m.r));
  // account 300, then the rest at once (~600 ms); one after another (main 5 Nov) ~1,230 ms
  assert.ok(m.ms < 900, `the Safe's sheet asked ${m.ms.toFixed(0)} ms after the tap (one after another: ~1,230 ms)`);
  const t = await run("testnet");
  assert.ok("problem" in t.r && t.r.problem.code === "spending.topup.test-account");
  assert.deepEqual(t.calls.filter((c) => !c.startsWith("device.store")), ["account.state"], "control: a test account reads nothing else");
});

test("QA's lap (5 Nov): a Move paid from Private counts Private's coins: a Safe of $2.06 NEAR on the account and $7.90 in Private moves $4 in NEAR (controls: the old public route, and a Private that can't be read, still count the Safe's own coins only)", async () => {
  const SAFE_NEAR = { tokenId: "near", symbol: "NEAR", amount: "0.5144", usd: "2.06", listed: true };
  const PRIV_NEAR = { tokenId: "nep141:wrap.near", symbol: "wNEAR", amount: "1.9752", usd: "7.90", listed: true, held: "private" };
  const e = Object.assign(fakeEngine({ totalUsd: 0 }), { fromPrivate: true });
  const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [SAFE_NEAR], "ledger.private": { available: true, ready: true, rows: [PRIV_NEAR] } });
  const r = await svc.call("spending.topUp", { usd: 4 });
  assert.ok("ok" in r, JSON.stringify(r));
  const from = (e.asked.at(-1) as { from: { tokenId: string; amount: string } }).from;
  assert.equal(from.tokenId, "near", "the Safe's NEAR: Private's wNEAR pays it first (safe-send.ts)");
  assert.ok(Math.abs(Number(from.amount) * (9.96 / 2.4896) - 4) < 0.01, from.amount);
  // control 1: the public route (no fromPrivate) is the Safe's own NEAR only, $2.06: refused before any sheet, as before
  const old = fakeEngine({ totalUsd: 0 });
  const o = service(old, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [SAFE_NEAR], "ledger.private": { available: true, ready: true, rows: [PRIV_NEAR] } });
  const no = await o.svc.call("spending.topUp", { usd: 4 });
  assert.ok("problem" in no && no.problem.code === "spending.topup.one-coin", JSON.stringify(no));
  assert.ok(!o.calls.some((c) => c.method === "ledger.private"), "the public route never reads Private");
  // control 2: Private unreadable adds nothing (never a crash); the Safe's own coins still pay what they cover
  const un = Object.assign(fakeEngine({ totalUsd: 0 }), { fromPrivate: true });
  const u = service(un, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [SAFE_NEAR] });
  const r2 = await u.svc.call("spending.topUp", { usd: 4 });
  assert.ok("problem" in r2 && r2.problem.code === "spending.topup.one-coin", JSON.stringify(r2));
});

test("withPrivate: Private's wNEAR joins the Safe's NEAR, Private's USDC the Safe's USDC, a coin only Private holds is its own row; unlisted and empty Private rows add nothing; the Safe's rows are never changed in place", () => {
  const safe = [{ tokenId: "near", amount: "1", usd: "4" }, { tokenId: "nep141:usdc", amount: "3", usd: "3" }];
  const out = withPrivate(safe, [
    { tokenId: "nep141:wrap.near", amount: "2", usd: "8", held: "private" },
    { tokenId: "nep141:usdc", amount: "5", usd: "5", held: "private" },
    { tokenId: "nep141:usdt", amount: "6", usd: "6", held: "private" },
    { tokenId: "nep141:spam", amount: "9", usd: "9", held: "private", listed: false },
    { tokenId: "nep141:zero", amount: "0", usd: "0", held: "private" },
  ]);
  assert.deepEqual(out.map((c) => [c.tokenId, Number(c.amount), Number(c.usd), c.held]), [["near", 3, 12, undefined], ["nep141:usdc", 8, 8, undefined], ["nep141:usdt", 6, 6, undefined]]);
  assert.deepEqual(safe, [{ tokenId: "near", amount: "1", usd: "4" }, { tokenId: "nep141:usdc", amount: "3", usd: "3" }]);
});

test("QA's matrix (5 Nov, real money): the money in Private moves on every leg from the Safe: to the Robinhood wallet and to the NEAR wallet, not only to SOL (control: the Safe's own $2.06 alone, refused on both)", async () => {
  const SAFE_NEAR = { tokenId: "near", symbol: "NEAR", amount: "0.5144", usd: "2.06", listed: true };
  const PRIV_NEAR = { tokenId: "nep141:wrap.near", symbol: "wNEAR", amount: "1.9752", usd: "7.90", listed: true, held: "private" };
  for (const network of ["hood", "near"]) {
    const e = Object.assign(fakeEngine({ totalUsd: 0 }), { fromPrivate: true });
    const { svc } = service(e, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [SAFE_NEAR], "ledger.private": { available: true, ready: true, rows: [PRIV_NEAR] } });
    const r = await svc.call("spending.topUp", { usd: 4, legs: [{ network, usd: 4 }] });
    assert.ok("ok" in r, `${network}: ${JSON.stringify(r)}`);
    assert.equal((e.asked.at(-1) as { from: { tokenId: string } }).from.tokenId, "near", network);
    const c = Object.assign(fakeEngine({ totalUsd: 0 }), { fromPrivate: true });
    const no = await service(c, { "account.protection.get": DEFAULT_BANDS, "ledger.balances": [SAFE_NEAR], "ledger.private": { available: true, ready: true, rows: [] } }).svc.call("spending.topUp", { usd: 4, legs: [{ network, usd: 4 }] });
    assert.ok("problem" in no && no.problem.code === "spending.topup.one-coin", `${network} control: ${JSON.stringify(no)}`);
  }
});

test("audit 10's A10 (8 Nov): the fee job's Activity row says its figure once, on the right (\"Kept for fees on Solana\" · $2.50), never \"$2.50 kept for fees on Solana · $2.50\" (control: a Move keeps its figure in its words)", async () => {
  const e = fakeEngine({ totalUsd: 40, moves: [
    { id: "g", kind: "out", chain: "sol", usd: 2.5, status: "done", at: 0, why: "gas" },
    { id: "mo", kind: "out", chain: "sol", usd: 15, status: "moving", at: 0, why: "asked" },
  ] });
  const { svc } = service(e);
  const r = await svc.call<{ id: string; usd: string; words: string }[]>("spending.activity", {});
  assert.ok("ok" in r);
  const g = r.ok.find((x) => x.id === "g")!;
  assert.deepEqual([g.words, g.usd], ["Kept for fees on Solana", "2.50"]);
  assert.doesNotMatch(g.words, /\$/, "no figure in the words");
  assert.match(r.ok.find((x) => x.id === "mo")!.words, /\$15\.00/, "control");
});
