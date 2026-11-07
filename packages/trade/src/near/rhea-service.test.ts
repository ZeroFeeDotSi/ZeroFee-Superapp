// The service with a NEAR coin's Rhea trade: done and timed on the first node's executed answer ("Landed in …"), booked
// only when another node's FINAL answer agrees; one that says it didn't happen turns it to failed with nothing booked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, landedMs } from "../service.ts";
import { tradeCard } from "../app/job-cards.ts";
import type { ChainEngine, Fill, Prepared } from "../types.ts";

function setup(answer: boolean | undefined) {
  let release!: (v: boolean | undefined) => void;
  const verify = new Promise<boolean | undefined>((r) => (release = r));
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string) {
      return { key: "rhea|k", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: "250000000000000000000000", payUsd: 1, getRaw: "1000000000000000000000000", getUsd: 1, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: "Rhea", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const fill: Fill = { txHash: "h1", got: "990000000000000000000000", spent: "250000000000000000000000", fee: "0" };
      return { fill, timing: { signedAt: clock.t + 5, sentAt: clock.t + 5, landedAt: clock.t + 1_100 }, verify };
    },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, release: () => release(answer) };
}

for (const [answer, words] of [[true, "booked on the second node's word"], [false, "turned: that node says it didn't happen, nothing booked"]] as const) {
  test(`a Rhea trade is done and timed on the first node's executed answer; ${words}`, async () => {
    const x = setup(answer);
    const rec = await x.svc.trade(await x.svc.quote("buy", "near", "blackdragon.tkn.near", { usd: 1 }));
    assert.equal(rec.status, "done");
    assert.equal(rec.verifying, true);
    assert.equal(landedMs(rec), 1_100, "tap to landed, the chain's own wait");
    assert.equal((await x.svc.positions()).length, 0, "nothing booked before the second node");
    x.release();
    await x.svc.checked();
    const after = (await x.svc.activity()).find((r) => r.id === rec.id)!;
    if (answer) {
      assert.equal(after.status, "done");
      assert.equal(after.verifying, undefined);
      assert.equal((await x.svc.positions())[0]?.raw, "990000000000000000000000");
    } else {
      assert.equal(after.status, "failed");
      assert.equal((await x.svc.positions()).length, 0);
    }
  });
}

test("re-review M: a Rhea trade NEAR hasn't decided stays 'unconfirmed', never failed or refunded (control: a refund is failed)", async () => {
  const { ProblemError } = await import("@zerofee/core/problem");
  const { nearProblems } = await import("./problems.ts");
  for (const [problem, want] of [[nearProblems.rheaPending("RHEA"), "unconfirmed"], [nearProblems.rheaRefunded("RHEA"), "failed"]] as const) {
    const engine = {
      chain: "near", owner: "",
      async prepare(side: "buy" | "sell", coin: string) {
        return { key: "rhea|k", at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "RHEA", decimals: 18, payRaw: "1", payUsd: 1, getRaw: "1", getUsd: 1, getMinRaw: "1", feeRaw: "0", feeUsd: 0, route: "Rhea", slippageBps: 300, expiresAt: Date.now() + 20_000 } } as Prepared;
      },
      async settle() { throw new ProblemError(problem); },
      async holdings() { return { native: "0", coins: [] }; },
      txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
    } as unknown as ChainEngine;
    const svc = createTradeService({ bridge: forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade"), engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "RHEA" }), chains: ["near"] });
    await svc.trade(await svc.quote("buy", "near", "token.rhealab.near", { usd: 1 })).catch(() => undefined);
    assert.equal((await svc.activity())[0]!.status, want, problem.code);
  }
});

// ---- the audit's MUST (7 Nov, on edadd7937): a NEAR 1Click trade's tap awaited an earlier NEAR trade's check on the same coin
// (bookInOrder), so its receipt waited on that check: a trade over 2 s is an F. It now books in the background, in tap order.
test("the audit's MUST: a NEAR tap while an earlier NEAR trade on the coin is still checking gets its receipt at once; it books after that one", async () => {
  let release!: (v: boolean) => void, n = 0;
  const verify = new Promise<boolean>((r) => (release = r));
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string, amount: { usd?: number }) {
      const usd = amount.usd ?? 1;
      return { key: `k${usd}`, at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: String(BigInt(usd) * 250000000000000000000000n), payUsd: usd, getRaw: "1000000000000000000000000", getUsd: usd, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: usd === 1 ? "Rhea" : "1Click", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const first = ++n === 1;
      const fill: Fill = { txHash: `h${n}`, got: first ? "990000000000000000000000" : "10000000000000000000000", spent: "250000000000000000000000", fee: "0" };
      return first ? { fill, timing: { signedAt: clock.t, sentAt: clock.t, landedAt: clock.t + 900 }, verify } : { fill };
    },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  let busy = 0;
  const bridge: typeof inner = { ...inner, call: (method, params) => { busy++; return inner.call(method, params).finally(() => { busy--; }); } };
  /** Every bridge answer in and every turn of work after it run (no clock moves). */
  const idle = async () => { for (let i = 0; i < 3; i++) do await new Promise((r) => setImmediate(r)); while (busy > 0); };
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const coin = "blackdragon.tkn.near";
  const rhea = await svc.trade(await svc.quote("buy", "near", coin, { usd: 1 }));
  assert.deepEqual([rhea.status, rhea.verifying], ["done", true], "the first still checking (another node's FINAL)");
  const tap = svc.trade(await svc.quote("buy", "near", coin, { usd: 2 }));
  const first = await Promise.race([tap, idle().then(() => "still waiting" as const)]);
  assert.notEqual(first, "still waiting", "edadd7937: the receipt waited on the earlier trade's check");
  const rec = await tap;
  assert.deepEqual([rec.status, rec.verifying], ["done", "book"], "its receipt at once; booked once the earlier one has");
  assert.equal((await svc.positions()).length, 0, "nothing booked out of tap order");
  release(true);
  await svc.checked();
  await idle();
  assert.equal(rec.verifying, undefined);
  assert.equal((await svc.positions())[0]?.raw, "1000000000000000000000000", "both booked");
});

// ---- the audit's SHOULD (7 Nov, on edadd7937): followNear booked with applyFill, outside the coin's order, and a NEAR trade
// still finishing gave up its place, so after a reload a later trade on the coin booked before it
test("the audit's SHOULD: after a reload a NEAR trade 1Click is still finishing keeps its place: a later tap books after it, through the order", async () => {
  const { ProblemError } = await import("@zerofee/core/problem");
  const { nearProblems } = await import("./problems.ts");
  let n = 0, finished = false;
  const clock = { t: 1_700_000_000_000 };
  const fillA: Fill = { txHash: "hA", got: "990000000000000000000000", spent: "250000000000000000000000", fee: "0" };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string, amount: { usd?: number }) {
      const usd = amount.usd ?? 1;
      return { key: `k${usd}`, at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "RHEA", decimals: 18, payRaw: String(BigInt(usd) * 250000000000000000000000n), payUsd: usd, getRaw: "1000000000000000000000000", getUsd: usd, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0, route: "1Click", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      if (++n === 1) throw new ProblemError(nearProblems.rheaPending("RHEA"));
      return { fill: { txHash: "hB", got: "10000000000000000000000", spent: "500000000000000000000000", fee: "0" } };
    },
    async followMove() { return finished ? { fill: fillA } : "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "RHEA" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const coin = "token.rhealab.near";
  const x = make();
  await x.trade(await x.quote("buy", "near", coin, { usd: 1 })).catch(() => undefined);
  assert.equal((await x.activity())[0]!.status, "unconfirmed", "1Click still finishing");
  const y = make();                                                  // the app closed and opened again
  const b = await y.trade(await y.quote("buy", "near", coin, { usd: 2 }));
  assert.deepEqual([b.status, b.verifying], ["done", "book"], "edadd7937: booked at once, before the trade tapped first");
  assert.equal((await y.positions()).length, 0, "nothing booked out of tap order");
  finished = true;
  await y.resume();                                                  // followNear: the first books, then the later one
  await y.checked();
  const a = (await y.activity()).find((r) => r.id !== b.id)!;
  assert.deepEqual([a.status, a.verifying, b.verifying], ["done", undefined, undefined]);
  assert.equal((await y.positions())[0]?.raw, "1000000000000000000000000", "both booked once");
});

// ---- the audit's MUST A (7 Nov, on 42bff1bd7): after a reload, a Rhea trade whose FINAL check the app closed on, and a 1Click
// trade whose booking waited behind it, were "done" and never booked
test("the audit's MUST A: a reload with a Rhea trade still on its FINAL check and a 1Click one waiting behind it: FINAL asked again by its hash, then both book in tap order", async () => {
  let n = 0, final: boolean | undefined;
  const asked: string[] = [];
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string, amount: { usd?: number }) {
      const usd = amount.usd ?? 1;
      return { key: `k${usd}`, at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: String(BigInt(usd) * 250000000000000000000000n), payUsd: usd, getRaw: "1000000000000000000000000", getUsd: usd, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: usd === 1 ? "Rhea" : "1Click", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const first = ++n === 1;
      const fill: Fill = { txHash: `h${n}`, got: first ? "990000000000000000000000" : "10000000000000000000000", spent: "250000000000000000000000", fee: "0" };
      // the first: its FINAL answer never comes before the app closes
      return first ? { fill, timing: { signedAt: clock.t, sentAt: clock.t, landedAt: clock.t + 900 }, verify: new Promise(() => {}), again: { hash: "h1", signerId: "w.near", ask: { side: "buy", coin: "blackdragon.tkn.near", poolId: 1, amountIn: "1", minOut: "1" } } } : { fill };
    },
    async finalAgain(a: { hash: string }) { asked.push(a.hash); return final; },
    async followMove() { return "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const coin = "blackdragon.tkn.near";
  const x = make();
  const rhea = await x.trade(await x.quote("buy", "near", coin, { usd: 1 }));
  const later = await x.trade(await x.quote("buy", "near", coin, { usd: 2 }));
  assert.deepEqual([rhea.verifying, later.verifying], [true, "book"]);
  const y = make();                                                  // the app closed and opened again
  await y.resume();                                                  // FINAL can't tell yet: neither books, both kept
  assert.deepEqual(asked, ["h1"], "42bff1bd7: never asked again");
  assert.equal((await y.positions()).length, 0, "never on the first node's word");
  assert.deepEqual((await y.activity()).map((r) => r.verifying), ["book", true]);
  final = true;
  await y.resume();
  await y.checked();
  assert.deepEqual((await y.activity()).map((r) => [r.status, r.verifying]), [["done", undefined], ["done", undefined]]);
  assert.equal((await y.positions())[0]?.raw, "1000000000000000000000000", "both booked once, in tap order");
});

test("control (MUST A): after a reload FINAL says the Rhea trade didn't happen: it fails, nothing of it booked, the 1Click one behind books", async () => {
  let n = 0;
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string, amount: { usd?: number }) {
      const usd = amount.usd ?? 1;
      return { key: `k${usd}`, at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: String(BigInt(usd) * 250000000000000000000000n), payUsd: usd, getRaw: "1000000000000000000000000", getUsd: usd, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: usd === 1 ? "Rhea" : "1Click", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const first = ++n === 1;
      const fill: Fill = { txHash: `h${n}`, got: first ? "990000000000000000000000" : "10000000000000000000000", spent: "250000000000000000000000", fee: "0" };
      return first ? { fill, verify: new Promise(() => {}), again: { hash: "h1", signerId: "w.near", ask: { side: "buy", coin: "blackdragon.tkn.near", poolId: 1, amountIn: "1", minOut: "1" } } } : { fill };
    },
    async finalAgain() { return false; },
    async followMove() { return "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const x = make();
  await x.trade(await x.quote("buy", "near", "blackdragon.tkn.near", { usd: 1 }));
  await x.trade(await x.quote("buy", "near", "blackdragon.tkn.near", { usd: 2 }));
  const y = make();
  await y.resume();
  await y.checked();
  assert.deepEqual((await y.activity()).map((r) => r.status), ["done", "failed"]);
  assert.equal((await y.positions())[0]?.raw, "10000000000000000000000", "only the one that happened");
});

// ---- the audit's MUST (ii) and SHOULD, 7 Nov: a Rhea trade released unbooked past the live window was a silent "done"; a kept
// fill that can't be booked held its coin's place for good
function world83(o: { final: () => boolean | undefined; fills?: Record<number, Partial<Fill>>; verify?: (n: number) => Promise<boolean | undefined> }) {
  let n = 0;
  const clock = { t: 1_700_000_000_000 };
  const engine = {
    chain: "near", owner: "",
    async prepare(side: "buy" | "sell", coin: string, amount: { usd?: number }) {
      const usd = amount.usd ?? 1;
      return { key: `k${usd}`, at: 0, ready: async () => {}, steps: [], quote: { side, chain: "near", coin, symbol: "BLACKDRAGON", decimals: 18, payRaw: String(BigInt(usd) * 250000000000000000000000n), payUsd: usd, getRaw: "1000000000000000000000000", getUsd: usd, getMinRaw: "970000000000000000000000", feeRaw: "0", feeUsd: 0.01, route: usd === 1 ? "Rhea" : "1Click", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    async settle() {
      const me = ++n;
      const fill = { txHash: `h${me}`, got: me === 1 ? "990000000000000000000000" : "10000000000000000000000", spent: "250000000000000000000000", fee: "0", ...o.fills?.[me] } as Fill;
      return me === 1 ? { fill, timing: { signedAt: clock.t, sentAt: clock.t, landedAt: clock.t + 900 }, verify: o.verify?.(me) ?? new Promise(() => {}), again: { hash: "h1", signerId: "w.near", ask: { side: "buy", coin: "blackdragon.tkn.near", poolId: 1, amountIn: "1", minOut: "1" } } } : { fill };
    },
    async finalAgain() { return o.final(); },
    async followMove() { return "pending" as const; },
    async holdings() { return { native: "0", coins: [] }; },
    txHash: (t: string) => t, async send() { return ""; }, async status() { return "unknown" as const; }, async fill() { return undefined; }, poolChanged() {},
  } as unknown as ChainEngine;
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 1, meta: async () => ({ symbol: "BLACKDRAGON" }), chains: ["near"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { make, clock, coin: "blackdragon.tkn.near" };
}
const HOUR = 60 * 60_000;
const FINAL_UNCHECKED = "ZeroFee couldn't confirm how much BLACKDRAGON you got. Your NEAR wallet shows what you hold.";

test("the audit's MUST (ii): past the live window with no FINAL, a reload's Rhea trade says it couldn't be checked, nothing of it booked, its place given up (control: inside the window it is kept, still checking)", async () => {
  const { make, clock, coin } = world83({ final: () => undefined });
  const x = make();
  await x.trade(await x.quote("buy", "near", coin, { usd: 1 }));
  await x.trade(await x.quote("buy", "near", coin, { usd: 2 }));      // behind it: booked only once its place is given up
  // control: inside the window, FINAL can't tell: kept, still checking, its place held (nothing books behind it)
  const y = make();
  await y.resume();
  await y.checked();
  assert.deepEqual((await y.activity()).map((r) => [r.verifying, r.problem?.code]), [["book", undefined], [true, undefined]]);
  assert.equal((await y.positions()).length, 0);
  // the app opens again past the window, FINAL still can't tell
  clock.t += HOUR + 60_000;
  const z = make();
  await z.resume();
  await z.checked();
  const [later, rhea] = await z.activity();
  assert.deepEqual([rhea!.status, rhea!.verifying, rhea!.again, rhea!.problem?.code], ["done", undefined, undefined, "trade.trade.final-unchecked"], "never a silent done");
  assert.equal(rhea!.problem?.whatHappened, FINAL_UNCHECKED);
  assert.equal(tradeCard(rhea!, clock.t).result, FINAL_UNCHECKED, "its card says so");
  assert.equal(later!.verifying, undefined, "its place given up: the one behind booked");
  assert.equal((await z.positions())[0]?.raw, "10000000000000000000000", "the Rhea trade's fill never claimed");
});

test("the audit's MUST (ii), the same run: a Rhea check that ended with no answer, once the window is over, says so on its card (control: inside the window it is still checking)", async () => {
  const { make, clock, coin } = world83({ final: () => undefined, verify: () => Promise.resolve(undefined) });
  const x = make();
  await x.trade(await x.quote("buy", "near", coin, { usd: 1 }));
  await x.checked();
  assert.deepEqual((await x.activity()).map((r) => [r.verifying, r.problem?.code]), [[true, undefined]], "control: still checking inside the window");
  clock.t += HOUR + 1_000;
  const [rec] = await x.activity();
  assert.deepEqual([rec!.verifying, rec!.problem?.code], [undefined, "trade.trade.final-unchecked"]);
  assert.equal((await x.positions()).length, 0, "nothing booked");
});

test("the audit's SHOULD: a kept fill that can't be booked is tried once more, then said, nothing of it booked, its place given up for the trades behind (control: one failure keeps it)", async () => {
  const { make, coin } = world83({ final: () => true, fills: { 2: { got: "not-a-number" } } });
  const x = make();
  await x.trade(await x.quote("buy", "near", coin, { usd: 1 }));
  await x.trade(await x.quote("buy", "near", coin, { usd: 2 }));      // its fill corrupt, kept to book
  await x.trade(await x.quote("buy", "near", coin, { usd: 3 }));      // behind it
  const y = make();
  await y.resume();                                                  // the Rhea trade books; the corrupt one fails once
  await y.checked();
  assert.deepEqual((await y.activity()).map((r) => [r.verifying, r.bookFails, r.problem?.code]), [["book", undefined, undefined], ["book", 1, undefined], [undefined, undefined, undefined]], "control: one failure, kept");
  assert.equal((await y.positions())[0]?.raw, "990000000000000000000000");
  const z = make();
  await z.resume();
  await z.checked();
  const [third, bad] = await z.activity();
  assert.deepEqual([bad!.verifying, bad!.fill, bad!.problem?.code], [undefined, undefined, "trade.trade.final-unchecked"]);
  assert.equal(third!.verifying, undefined, "the one behind booked");
  assert.equal((await z.positions())[0]?.raw, "1000000000000000000000000", "the Rhea trade and the third, never the corrupt one");
});

test("the audit's SHOULD: fillReadable is exactly what the booking reads (table)", async () => {
  const { fillReadable } = await import("../service.ts");
  const f = { txHash: "h", got: "1", spent: "2", fee: "0" };
  for (const [fill, ok] of [[f, true], [{ ...f, coinAfter: "5" }, true], [{ ...f, got: "x" }, false], [{ ...f, spent: undefined }, false], [{ ...f, fee: "1.5" }, false], [{ ...f, coinAfter: "?" }, false], [undefined, false]] as const) assert.equal(fillReadable(fill as never), ok, JSON.stringify(fill));
});

test("the copy review's words (7 Nov) for a trade nobody could confirm, buy and sell (table): badge Check, never Done; the title with no figure; the line; Open your NEAR wallet; no position row, never a $0 one", async () => {
  const rows = [
    ["buy", "Bought BLACKDRAGON, amount unchecked", "ZeroFee couldn't confirm how much BLACKDRAGON you got. Your NEAR wallet shows what you hold."],
    ["sell", "Sold BLACKDRAGON, amount unchecked", "ZeroFee couldn't confirm how much you got for BLACKDRAGON. Your NEAR wallet shows what you hold."],
  ] as const;
  for (const [side, title, line] of rows) {
    const { make, clock, coin } = world83({ final: () => undefined });
    const x = make();
    await x.trade(await x.quote(side, "near", coin, { usd: 1 }));
    clock.t += HOUR + 60_000;
    const z = make();
    await z.resume();
    await z.checked();
    const [rec] = await z.activity();
    const card = tradeCard(rec!, clock.t);
    assert.deepEqual([card.badge, card.status, card.title, card.result], ["Check", "Check", title, line], side);
    assert.equal(rec!.problem?.whatHappened, line, `${side}: the problem says the same line`);
    assert.deepEqual([rec!.problem?.next.label, rec!.problem?.next.kind], ["Open your NEAR wallet", "open"], side);
    assert.ok(!/\$|[0-9]/.test(card.title), `${side}: no figure in the title`);
    const held = await z.positions();
    assert.ok(!held.some((p) => p.coin === coin), `${side}: no position row for it`);
    assert.ok(!held.some((p) => BigInt(p.raw) === 0n || p.costUsd === 0), `${side}: never a $0 row`);
  }
});
