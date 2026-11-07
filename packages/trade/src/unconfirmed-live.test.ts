// QA and the audit's MUST (7 Nov): "ZeroFee keeps checking." was only half true: past GIVE_UP_MS an unconfirmed trade
// was looked at again only on the next open. Now, while its card is on screen (watch) and the app is in the foreground,
// the service looks at it every RECHECK_MS through the engine's history-backed recheck() alone, and the record ends the
// moment the chain answers. The clock and the timer are injected: no wall clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { ProblemError } from "@zerofee/core/problem";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, RECHECK_MS, RECHECK_PER_ROUND, RECHECK_SLOW_MS, type TradeRecord } from "./service.ts";
import { BACKOFF_AFTER_MS, LIVE_MAX_MS } from "./live-check.ts";
import type { ChainEngine, Fill, Prepared, TxStatus } from "./types.ts";

/** The live re-check's one timer, by hand: what is set, and firing it. */
function fakeTimer() {
  const q = new Map<number, { f: () => void; ms: number }>();
  let n = 0, sets = 0;
  return {
    set(f: () => void, ms: number) { sets++; q.set(++n, { f, ms }); return n; },
    clear(h: unknown) { q.delete(h as number); },
    pending: () => [...q.values()],
    sets: () => sets,
    fire() { const first = [...q][0]; assert.ok(first, "a timer is set"); q.delete(first[0]); first[1].f(); },
  };
}
/** Lets the service's awaits run (event-loop turns, never a time): until `done` holds, at most `n` turns. */
async function until(done: () => boolean, n = 2_000): Promise<void> {
  for (let i = 0; i < n && !done(); i++) await new Promise<void>((r) => setImmediate(r));
}

function setup(o: { statuses?: TxStatus[]; rechecks?: TxStatus[] } = {}) {
  const clock = { t: 1_800_000_000_000 };
  let n = 0, statusCalls = 0;
  const calls = { status: 0, recheck: 0, landed: 0, sent: 0 };
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const k = ++n;
      const p: Prepared = { key: `k${k}`, at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa(`unsigned-${k}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: `${100000000 + k}`, payUsd: 10, getRaw: "100000000", getUsd: 10, getMinRaw: "97000000", feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 } };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { calls.sent++; return `hash-${atob(tx)}`; },
    async status() { calls.status++; return o.statuses?.[statusCalls++] ?? "pending"; },
    async recheck() { calls.recheck++; return o.rechecks?.shift() ?? "pending"; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const timer = fakeTimer();
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, timer });
  /** A buy whose tap's wait gives up: the service throws its unconfirmed Problem and keeps the record. */
  const unconfirmedBuy = async (): Promise<TradeRecord> => {
    const err = await svc.quote("buy", "sol", "BONKmint", { usd: 10 }).then((p) => svc.trade(p)).then(() => undefined, (e: unknown) => e);
    assert.ok(err instanceof ProblemError && err.problem.code === "trade.trade.unconfirmed", "the tap's wait gave up: unconfirmed");
    return (await svc.activity())[0]!;
  };
  return { svc, engine, calls, timer, clock, unconfirmedBuy };
}

test("live: while its card is watched, an unconfirmed trade is looked at every RECHECK_MS and ends the moment it landed (booked, no Try again)", async () => {
  const x = setup({ rechecks: ["pending", "confirmed"] });
  const rec = await x.unconfirmedBuy();
  const sentBefore = x.calls.sent, statusBefore = x.calls.status;
  assert.equal(x.timer.pending().length, 0, "nobody watches yet: no timer");
  const close = x.svc.watch();
  assert.deepEqual(x.timer.pending().map((t) => t.ms), [RECHECK_MS], "one slow timer");
  x.timer.fire();
  await until(() => x.calls.recheck === 1 && x.timer.pending().length === 1);
  assert.equal(rec.status, "unconfirmed", "still pending after the first look");
  assert.equal(x.timer.pending().length, 1, "set again once the round ended");
  x.timer.fire();
  await until(() => rec.status === "done" && x.timer.pending().length === 0);
  assert.equal(rec.status, "done");
  assert.equal(rec.problem, undefined, "the not-confirmed card's Problem is gone");
  assert.equal((await x.svc.position("sol", "BONKmint"))?.raw, "100000000", "its fill is booked");
  assert.equal(x.timer.pending().length, 0, "nothing left open: the timer stops");
  assert.equal(x.calls.sent, sentBefore, "a look never sends the bytes again");
  assert.equal(x.calls.status, statusBefore, "a look never asks the tap's fast status()");
  close();
});

test("live: a proven expiry ends the card as 'Buy stopped' with one Try again", async () => {
  const x = setup({ rechecks: ["expired"] });
  const rec = await x.unconfirmedBuy();
  x.svc.watch();
  x.timer.fire();
  await until(() => rec.status === "expired");
  assert.equal(rec.status, "expired");
  assert.equal(rec.problem?.code, "trade.trade.expired");
  assert.equal(rec.problem?.whatHappened, "Solana didn't confirm it in time, so nothing was traded.");
  assert.deepEqual(rec.problem?.next, { kind: "retry", label: "Try again" });
  assert.equal(rec.signed, undefined, "its bytes are forgotten once it ended");
  assert.equal(x.timer.pending().length, 0);
});

test("live: the background stops the timer at once; the card closing stops it; never two timers", async () => {
  const x = setup();
  await x.unconfirmedBuy();
  const a = x.svc.watch(), b = x.svc.watch(), c = x.svc.watch();
  x.svc.foreground(true); x.svc.foreground(true);
  assert.equal(x.timer.pending().length, 1, "three cards, one timer");
  x.svc.foreground(false);
  assert.equal(x.timer.pending().length, 0, "the background: no timer");
  assert.equal(x.calls.recheck, 0, "and no look");
  x.svc.foreground(true);
  assert.equal(x.timer.pending().length, 1, "back in the foreground: one timer again");
  a(); b();
  assert.equal(x.timer.pending().length, 1, "one card still on screen");
  c(); c();
  assert.equal(x.timer.pending().length, 0, "the last card closed: no timer (a second close changes nothing)");
  assert.equal(x.calls.recheck, 0);
});

test("live: bounded: a round looks at no more than RECHECK_PER_ROUND trades, oldest first, one after another", async () => {
  const x = setup();
  const recs: TradeRecord[] = [];
  for (let i = 0; i < RECHECK_PER_ROUND + 2; i++) { recs.push(await x.unconfirmedBuy()); x.clock.t += 1_000; }
  x.svc.watch();
  x.timer.fire();
  await until(() => x.calls.recheck === RECHECK_PER_ROUND && x.timer.pending().length === 1);
  assert.equal(x.calls.recheck, RECHECK_PER_ROUND);
  assert.equal(x.timer.pending().length, 1);
});

test("speed pin: a normal fast confirm with a card watched makes no recheck (history) call and sets no timer", async () => {
  const x = setup({ statuses: ["confirmed"] });
  x.svc.watch();
  const rec = await x.svc.quote("buy", "sol", "BONKmint", { usd: 10 }).then((p) => x.svc.trade(p));
  assert.equal(rec.status, "done");
  await until(() => false, 50);
  assert.equal(x.calls.recheck, 0, "the tap's path never asks the history reads");
  assert.equal(x.timer.pending().length, 0, "nothing unconfirmed: no timer");
});

test("the audit's SHOULD: age bound: every RECHECK_MS for 5 min, then every RECHECK_SLOW_MS; past an hour no look, and the card says 'Open this again to check.'", async () => {
  const x = setup();
  const rec = await x.unconfirmedBuy();
  x.svc.watch();
  assert.equal(x.timer.pending()[0]!.ms, RECHECK_MS, "young: 20 s");
  x.clock.t = rec.sentAt! + BACKOFF_AFTER_MS + 1;
  x.timer.fire();
  await until(() => x.calls.recheck === 1 && x.timer.pending().length === 1);
  assert.equal(x.timer.pending()[0]!.ms, RECHECK_SLOW_MS, "past 5 min: 60 s");
  x.clock.t = rec.sentAt! + LIVE_MAX_MS + 1;
  x.timer.fire();
  await x.svc.roundDone();
  assert.equal(x.calls.recheck, 1, "past the hour: no look");
  assert.equal(rec.status, "unconfirmed", "still open: the next open looks again");
  assert.equal(rec.problem?.whatHappened, "Solana hasn't confirmed this trade yet. Open this again to check.");
  assert.deepEqual(rec.problem?.next, { kind: "open", label: "Open your SOL wallet", screen: "wallets" }, "still no Try again");
  assert.equal(x.timer.pending().length, 0, "the timer stops");
});
