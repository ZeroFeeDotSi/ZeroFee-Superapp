// ?demo&keep: MockBridge saves its whole state and a new MockBridge reading it carries on exactly where the first left
// off; timed moves resume from their absolute due times and land exactly once; a bad blob starts fresh.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge, MOCK_STATE_KEY, MOCK_STATE_VERSION, type MockBridge, type MockOptions } from "./MockBridge.ts";

const memory = (from?: Map<string, string>) => {
  const data = new Map(from);
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
type Mem = ReturnType<typeof memory>;
const OPTS: MockOptions = { latencyMs: 0, tradeChains: ["sol", "hood", "bsc"] };
const make = (storage: Mem, more: MockOptions = {}) => createMockBridge({ ...OPTS, ...more, persist: { storage } });
/** A reload: the page's sessionStorage, as it was at that instant, read by a brand-new MockBridge. */
const reload = (before: MockBridge, storage: Mem) => (before.flush(), memory(storage.data));

function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 28, 1, 0, 0) });
  return (ms: number) => t.mock.timers.tick(ms);
}
async function call<T>(tick: (ms: number) => void, m: MockBridge, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const pending = m.call<T>(method, params);
  tick(0);
  const res = await pending;
  if (!("ok" in res)) throw new Error(`${method}: ${JSON.stringify(res.problem)}`);
  return res.ok;
}
/** Everything a screen could read back, to compare two mocks. */
async function readAll(tick: (ms: number) => void, m: MockBridge) {
  const out: Record<string, unknown> = {};
  for (const [method, p] of [
    ["ledger.balances", {}], ["ledger.activity", { limit: 50 }], ["subwallet.list", {}], ["subwallet.float.balance", {}], ["subwallet.float.moves", {}],
    ["account.waiting", {}], ["account.state", {}], ["account.protection.get", {}], ["ledger.private", {}], ["device.store.get", { app: "trade", key: "journal" }],
    ["subwallet.balances", { id: "sw-trade-sol" }], ["ledger.receiveChain", {}],
  ] as const) out[method] = await call(tick, m, method, p);
  const fb = out["subwallet.float.balance"] as { asOfIso?: string };
  delete fb.asOfIso;
  return out;
}
const blob = (s: Mem) => {
  const x = JSON.parse(s.data.get(MOCK_STATE_KEY)!);
  delete x.savedAt;
  return x;
};
const usdcMain = (balances: { tokenId: string; held: string; amount: string }[]) => balances.find((b) => b.held === "ledger" && b.tokenId.startsWith("nep141:1720"))!.amount;

test("keep: save, then a new MockBridge restores the identical state", async (t) => {
  const tick = clock(t);
  const s = memory();
  const a = make(s, { holdSeconds: 60 });
  await call(tick, a, "device.store.set", { app: "trade", key: "journal", value: '{"steps":[1,2]}' });
  await call(tick, a, "subwallet.create", { kind: "trade", chain: "sol", slot: 2 });
  await call(tick, a, "ledger.receiveChain", { chain: "base" });
  await call(tick, a, "ledger.withdraw", { tokenId: "nep141:wrap.near", amount: "2", toAddress: "y", chain: "base" });
  await call(tick, a, "account.protection.set", { bands: [{ upToUsd: 50, level: "faceid" }, { upToUsd: null, level: "wait", waitSeconds: 3600 }] });
  await call(tick, a, "ledger.privateSetup");
  await call(tick, a, "ledger.quotePay", { fromTokenId: "x", toTokenId: "x", amountOut: "3", to: { kind: "near", accountId: "bob.near" } });
  tick(1000);
  const s2 = reload(a, s);
  const b = make(s2, { holdSeconds: 60 });
  b.flush();
  assert.deepEqual(blob(s2), blob(s), "the saved state, field by field");
  assert.deepEqual(await readAll(tick, b), await readAll(tick, a), "and every read answers the same");
});

test("keep: an Add to Trading then a move out, reloaded mid-flight at each step, lands exactly once with the right balances", async (t) => {
  // reload points: during the Add (both its steps), right at its landing, during the move out, a moment before it lands
  for (const at of [1, 1500, 2499, 3500, 6999]) {
    const tick = clock(t);
    let s = memory();
    let m = make(s);
    let now = 0;
    const until = async (ms: number) => {
      tick(ms - now);
      now = ms;
      await Promise.resolve();
    };
    const reloaded = new Set<number>();
    const maybeReload = async (ms: number) => {
      if (at <= ms && !reloaded.has(at)) {
        await until(at);
        s = reload(m, s);
        m = make(s);
        reloaded.add(at);
      }
    };
    await call(tick, m, "ledger.toTrading", { amount: "100" }); // Add lands at 2500 (movement done, float credited)
    await maybeReload(2499);
    await until(Math.max(now, 3000));
    await call(tick, m, "subwallet.float.out", { chain: "sol", amount: "200000000", key: "moveout-key-000001" }); // $30 of SOL, lands 3000 + 4000
    await maybeReload(6999);
    const done: string[] = [];
    m.on<{ movement: { id: string; status: string } }>("ledger.movementUpdated", (e) => e.movement.status === "done" && done.push(e.movement.id));
    await until(20_000);
    assert.equal(usdcMain(await call(tick, m, "ledger.balances")), "1140.5", `reload at ${at}: main paid the Add once`);
    const fb = await call<{ usd: number }>(tick, m, "subwallet.float.balance");
    assert.equal(fb.usd, 69.4, `reload at ${at}: float credited once, debited once`);
    const moves = await call<{ id: string; status: string }[]>(tick, m, "subwallet.float.moves");
    assert.deepEqual(moves.map((x) => [x.id, x.status]), [["fm-1", "done"]], `reload at ${at}`);
    const sol = await call<{ amount: string }[]>(tick, m, "subwallet.balances", { id: "sw-trade-sol" });
    assert.equal(sol[0].amount, "200000000", `reload at ${at}: SOL landed once`);
    const activity = await call<{ id: string; kind: string; status: string }[]>(tick, m, "ledger.activity");
    assert.deepEqual(activity.filter((x) => x.kind === "trading").map((x) => x.status), ["done"], `reload at ${at}`);
    assert.ok(done.length <= 1 && done.every((id) => id === "mv-4"), `reload at ${at}: Add landed at most once after the reload: ${done}`);
    // and the same key again is the same move, not a second one
    const again = await call<{ id: string }>(tick, m, "subwallet.float.out", { chain: "sol", amount: "200000000", key: "moveout-key-000001" });
    assert.equal(again.id, "fm-1");
    assert.equal((await call<{ usd: number }>(tick, m, "subwallet.float.balance")).usd, 69.4);
    t.mock.timers.reset();
  }
});

test("keep: a move already due when the page comes back lands at once, once", async (t) => {
  const tick = clock(t);
  const s = memory();
  const a = make(s, { float: { startUsd: 50 } });
  await call(tick, a, "ledger.toTrading", { amount: "10" });
  await call(tick, a, "subwallet.float.home", { amount: "20000000", key: "home-key-0000000001" });
  const saved = reload(a, s);
  // the page was away for a minute: both are past due by the time it reads its state
  const rest = memory(saved.data);
  tick(60_000);
  const b = make(rest, { float: { startUsd: 50 } });
  const events: string[] = [];
  b.on<{ movement: { id: string; status: string } }>("ledger.movementUpdated", (e) => events.push(`${e.movement.id}:${e.movement.status}`));
  const moves = await call<{ status: string; where: string }[]>(tick, b, "subwallet.float.moves");
  assert.deepEqual(moves.map((x) => [x.status, x.where]), [["done", "main"]]);
  // $10 Add credited; $20 home (2 % fee) back to main as $19.60
  assert.equal((await call<{ usd: number }>(tick, b, "subwallet.float.balance")).usd, 40);
  assert.equal(usdcMain(await call(tick, b, "ledger.balances")), "1250.1");
  const act = await call<{ kind: string; from?: string; status: string }[]>(tick, b, "ledger.activity");
  assert.deepEqual(act.filter((x) => x.kind === "trading").map((x) => [(x as { id?: string }).id, x.status]), [["home-key-0000000001", "moving"], ["mv-4", "done"]], "the Add landed; the Take out's movement is on its way");
  tick(60_000);
  assert.equal((await call<{ usd: number }>(tick, b, "subwallet.float.balance")).usd, 40, "nothing lands twice");
  assert.equal(usdcMain(await call(tick, b, "ledger.balances")), "1250.1");
  assert.deepEqual(events, ["home-key-0000000001:done"], "only the Take out's own movement, which was armed at restore, lands after");
  // and a second reload now changes nothing
  const c = make(reload(b, rest), { float: { startUsd: 50 } });
  assert.deepEqual(await readAll(tick, c), await readAll(tick, b));
});

test("keep: an Add paid with NEAR is kept: the NEAR row, the float and the movement come back the same, and it lands once", async (t) => {
  const tick = clock(t);
  const s = memory();
  const a = make(s);
  const mv = await call<{ from: string }>(tick, a, "ledger.toTrading", { amount: "10", tokenId: "nep141:wrap.near" });
  assert.equal(mv.from, "nep141:wrap.near");
  const b = make(reload(a, s));
  assert.deepEqual(await readAll(tick, b), await readAll(tick, a));
  const near = (await call<{ tokenId: string; held: string; amount: string }[]>(tick, b, "ledger.balances")).find((x) => x.tokenId === "nep141:wrap.near" && x.held === "ledger")!;
  assert.equal(near.amount, "302.4");
  tick(60_000);
  assert.equal((await call<{ usd: number }>(tick, b, "subwallet.float.balance")).usd, 44.3, "credited once");
  t.mock.timers.reset();
});

test("keep: a corrupt or old blob starts fresh and says so once", async (t) => {
  const tick = clock(t);
  const warn = t.mock.method(console, "warn", () => {});
  const fresh = await readAll(tick, createMockBridge(OPTS));
  for (const bad of ["{not json", JSON.stringify({ v: MOCK_STATE_VERSION + 1, store: [] }), JSON.stringify({ v: MOCK_STATE_VERSION, store: "broken" })]) {
    const s = memory(new Map([[MOCK_STATE_KEY, bad]]));
    const m = make(s);
    assert.deepEqual(await readAll(tick, m), fresh, bad);
    assert.equal(JSON.parse(s.data.get(MOCK_STATE_KEY)!).v, MOCK_STATE_VERSION, "the bad blob is replaced by a good one");
  }
  assert.equal(warn.mock.callCount(), 1, "logged once");
});

test("plain mock (no persist) saves nothing and flush is a no-op", async (t) => {
  const tick = clock(t);
  const m = createMockBridge(OPTS);
  await call(tick, m, "ledger.toTrading", { amount: "5" });
  m.flush();
  tick(10_000);
});

test("keep: money moved into an older Solana wallet (the old apps wallet) survives a reload, landed or still on its way, and lands once (grade 1 Nov, item 1)", async (t) => {
  // reload points: while the Add is on its way, and after it landed
  for (const at of [100, 5_000]) {
    const tick = clock(t);
    const s = memory();
    const a = make(s);
    const w = await call<{ id: string; address: string }>(tick, a, "subwallet.create", { kind: "browser", chain: "sol" });
    const before = usdcMain(await call(tick, a, "ledger.balances"));
    await call(tick, a, "ledger.withdraw", { tokenId: "nep141:sol.omft.near", amount: "0.25", toAddress: w.address, chain: "sol" });
    tick(at);
    const s2 = reload(a, s);
    const b = make(s2);
    tick(10_000);
    const sol = (await call<{ token: string; amount: string }[]>(tick, b, "subwallet.balances", { id: w.id })).find((r) => r.token === "native")!;
    assert.equal(sol.amount, "250000000", `reloaded at ${at} ms: the 0.25 SOL is in that wallet, once`);
    assert.equal(usdcMain(await call(tick, b, "ledger.balances")), before, "the main USDC row is untouched (it was paid in SOL)");
    const act = await call<{ to?: string; status: string }[]>(tick, b, "ledger.activity");
    assert.equal(act[0].to, "your older Solana wallet", "Activity names the wallet as the core does (D55), never its made-up address");
    assert.equal(act[0].status, "done");
    const c = make(reload(b, s2));
    assert.deepEqual(await call(tick, c, "subwallet.balances", { id: w.id }), await call(tick, b, "subwallet.balances", { id: w.id }), "and again after a second reload");
    t.mock.timers.reset();
  }
});
