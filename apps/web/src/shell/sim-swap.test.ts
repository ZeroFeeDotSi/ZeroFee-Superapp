// QA's Sim crawl (5 Nov): Home's Swap read "Move" and showed no coin in. On the Sim's own stack (MockBridge,
// the trade engine and the core's Spending, as the Sim runs them): a Swap of the Safe's USDC for SOL takes the USDC out
// of the Safe and lands SOL in the SOL wallet; its job reads "Swap $10 of USDC for SOL" from the core's first answer
// (named the moment the core made it, not when the sheet closes) and ends saying how much SOL came in. Controls: a Move
// (nothing named) still reads "Move $… to your SOL wallet"; a Swap paid from Private (NEAR Confidential) is a Swap too.
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { ProblemError } from "@zerofee/core/problem";
import { createSpendingService, type SpendingActivity, type SpendingStatus } from "@zerofee/core/spending";
import { bridgeWallets, createCoreFloat, type CoreFloatDeps } from "@zerofee/trade/float-core.ts";
import { foldInto, moveTrack } from "@zerofee/wallet/app/money/live-steps.ts";
import { swapLabel } from "@zerofee/wallet/app/money/swap-follow.ts";
import { SEALED_CARRY, createJobCarry, nameSwap, swapLands } from "@zerofee/shell-api/job-carry.ts";

/** The swaps' names over a sealed store of the test's own (job-carry.ts, under the row's `move:` id, with the job rows
 *  in Home's sealed store); each call is the page loaded again. */
const createSwapNames = (kv: Map<string, string>, now?: () => number) => {
  const c = createJobCarry(new Map(), now);
  c.keep(kv.get(SEALED_CARRY) ?? null, (text) => void kv.set(SEALED_CARRY, text));
  return { label: (id: string) => c.get(`move:${id}`)?.words, lands: (id: string) => c.get(`move:${id}`)?.lands, name: (id: string, words: string, lands?: string) => c.set([`move:${id}`], { words, ...(lands ? { lands } : {}) }) };
};

const PX = { sol: 150, hood: 3000, bsc: 600 } as const;
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** No wall clock (land checks): node's mock timers, turned 5 ms per turn of the event loop. */
function virtualClock(t: TestContext) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-11-05T00:00:00Z") });
  let on = true;
  void (async () => { while (on) { t.mock.timers.tick(5); await new Promise((r) => setImmediate(r)); } })();
  return { stop: () => { on = false; }, wait: (ms: number) => new Promise((r) => setTimeout(r, ms)) };
}

async function sim(t: TestContext) {
  const clock = virtualClock(t);
  const mock = createMockBridge({ latencyMs: 0, settleMs: 200, float: { moveMs: 300, priceUsd: (c) => PX[c] } });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  const call: CoreFloatDeps["call"] = async (method, params) => { const r = await mock.call<any>(method, params); if ("problem" in r) throw new ProblemError(r.problem); return r.ok; };
  for (const chain of ["sol", "hood", "bsc"]) await call("subwallet.create", { kind: "trade", chain });
  const nativeUsd = async (c: keyof typeof PX) => PX[c];
  const f = createCoreFloat({ offered: (c) => c !== "bsc", call, on: (e, h) => mock.on(e, h), nativeUsd, wallets: () => bridgeWallets(call, nativeUsd), get: async () => undefined, set: async () => {}, now: () => Date.now(), every: (fn: any, ms: any) => { const x = setInterval(typeof fn === "function" ? fn : ms, typeof fn === "function" ? ms : fn); return () => clearInterval(x); }, rng: () => 0.5 } as never);
  const svc = createSpendingService({ engine: () => f as never, call: async <T,>(m: string, p: Record<string, unknown>) => (m === "device.store.get" ? { value: null } : m === "device.store.set" ? {} : m === "account.state" ? { account: { network: "mainnet" } } : (await mock.call<any>(m, p)).ok) as T });
  const stop = (f as unknown as { start(): () => void }).start();
  t.after(() => { stop(); clock.stop(); });
  const ask = async <T,>(m: string, p: Record<string, unknown> = {}) => { const r = await svc.call<T>(m, p); assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
  const safeUsdc = async () => Number(((await mock.call<any>("ledger.balances")) as any).ok.find((b: any) => b.tokenId === USDC && b.held === "ledger" && b.chain === "near").amount);
  const sol = async () => Number((await ask<SpendingStatus>("spending.status")).networks.find((n) => n.network === "sol")!.nativeAmount);
  const track = async (id: string, words?: string, lands?: string) => moveTrack(foldInto(await ask<SpendingActivity[]>("spending.activity")).find((r) => r.id === id)!, words, lands)!;
  return { ask, safeUsdc, sol, track, wait: clock.wait };
}

test("Sim: Home's Swap of the Safe's USDC for SOL lands SOL, reads Swap from the first read, and says how much came in", async (t) => {
  const s = await sim(t);
  const usdc0 = await s.safeUsdc();
  assert.equal(await s.sol(), 0);
  // SwapSheet's swapWords("10", "USDC", "SOL")
  const words = "Swap $10.00 of USDC for SOL";
  // SwapSheet's ask for this route (askOf "topup"), then the name it gives the row at the core's answer
  const r = await s.ask<SpendingActivity>("spending.topUp", { usd: 10, swap: "USDC", legs: [{ network: "sol", usd: 10 }], key: "simswap-usdc-sol-01" });
  nameSwap(r.id, words, "0.0644 SOL");
  assert.equal(swapLabel(r.id), words);
  const going = await s.track(r.id, swapLabel(r.id), swapLands(r.id));
  assert.equal(going.title, words, "the job reads Swap while it goes, never Move");
  assert.equal(going.kind, "swap");
  await s.wait(3000);
  assert.ok(await s.safeUsdc() < usdc0 - 9.99, "the USDC left the Safe");
  assert.ok(Math.abs((await s.sol()) - 10 / PX.sol) < 0.002, `about $10 of SOL came into the SOL wallet: ${await s.sol()}`);
  const done = await s.track(r.id, swapLabel(r.id), swapLands(r.id));
  assert.equal(done.title, words);
  // M12-2 (8 Nov): done, the row says what its record shows came in, no "About" (the sheet priced 0.0644 at the tap)
  assert.equal(done.end?.ok, true);
  assert.match(done.end!.line, /^0\.06\d\d SOL came into your SOL wallet\.$/);
});

test("control: a Move from the Safe (nothing named) still reads Move", async (t) => {
  const s = await sim(t);
  const r = await s.ask<SpendingActivity>("spending.topUp", { usd: 10, legs: [{ network: "sol", usd: 10 }], key: "simswap-move-sol-01" });
  const m = await s.track(r.id, swapLabel(r.id), swapLands(r.id));
  assert.match(m.title, /^Move \$/);
  assert.equal(m.kind, "move");
  await s.wait(3000);
  assert.ok((await s.sol()) > 0, "the Move lands too");
  assert.deepEqual((await s.track(r.id)).end, { ok: true, line: "In your SOL wallet." });
});

test("a Swap paid from Private (NEAR Confidential) is titled Swap; the same row unnamed is a Move", () => {
  const row = { id: "mv-p1", kind: "top-up", usd: "10.00", status: "done", shown: true, atIso: new Date(0).toISOString(), words: "Moved $10.00 to your SOL wallet", goesTo: ["sol"], via: "private" } as SpendingActivity;
  const swap = moveTrack(row, "Swap $10 of USDC for SOL", "0.0644 SOL")!;
  assert.deepEqual([swap.title, swap.kind, swap.end], ["Swap $10 of USDC for SOL", "swap", { ok: true, line: "About 0.0644 SOL came into your SOL wallet." }]);
  const move = moveTrack(row)!;
  assert.deepEqual([move.title, move.kind, move.end], ["Move $10.00 to your SOL wallet", "move", { ok: true, line: "In your SOL wallet." }]);
});

test("a reload keeps the Swap's name and what came in (beside the job rows); a Move stays Move", () => {
  const kv = new Map<string, string>(), store = kv;
  createSwapNames(store).name("mv-s1", "Swap $10 of USDC for SOL", "0.0644 SOL");
  const after = createSwapNames(store);                         // the page loaded again: only what the store kept
  const at = new Date(0).toISOString();
  const swapRow = { id: "mv-s1", kind: "top-up", usd: "10.00", status: "done", shown: true, atIso: at, words: "Moved $10.00 to your SOL wallet", goesTo: ["sol"], via: "private" } as SpendingActivity;
  const swap = moveTrack(swapRow, after.label("mv-s1"), after.lands("mv-s1"))!;
  assert.deepEqual([swap.title, swap.kind, swap.end?.line], ["Swap $10 of USDC for SOL", "swap", "About 0.0644 SOL came into your SOL wallet."]);
  const moveRow = { ...swapRow, id: "mv-m1" };
  const move = moveTrack(moveRow, after.label("mv-m1"), after.lands("mv-m1"))!;
  assert.deepEqual([move.title, move.kind], ["Move $10.00 to your SOL wallet", "move"], "control: a Move nobody named is still a Move");
  // control: a damaged copy is no copy, and a name past a day is dropped
  kv.set(SEALED_CARRY, "{not json");
  assert.equal(createSwapNames(store).label("mv-s1"), undefined);
  let t = 0;
  createSwapNames(store, () => t).name("mv-old", "Swap $5 of SOL for USDC");
  t = 25 * 60 * 60_000;
  assert.equal(createSwapNames(store, () => t).label("mv-old"), undefined);
});
