// Speed (3 Nov): a trade is done on the FIRST node's word that it landed; the two-node check keeps running behind it,
// books the real fill, and turns the record to its problem if two nodes then say it failed. The service's clock moves
// only when it waits, so every timing here is exact (no wall clock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, landedMs, type TradeRecord } from "./service.ts";
import type { ChainEngine, Fill, Prepared, TxStatus } from "./types.ts";
import { LIVE_MAX_MS } from "./live-check.ts";

/** `ctl.verdict`: the two-node status of a hash (default pending); `landedAfter`: landed() says yes on its (n+1)th ask per hash. */
function setup(o: { landedAfter?: number; noLanded?: boolean; fillGot?: string } = {}) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0, landedCalls = 0;
  const asked = new Map<string, number>();
  /** `drop`: a store write the app never made (closed before it): that key's writes are skipped while it says so. */
  const ctl = { verdict: (_hash: string): TxStatus => "pending", drop: (_key: string): boolean => false };
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const p: Prepared = {
        key: `k${++n}`, at: 0, ready: async () => {},
        steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: "100000000", payUsd: 10, getRaw: "100000000", getUsd: 10, getMinRaw: "97000000", feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { return `hash-${atob(tx)}`; },
    async status(hash) { return ctl.verdict(hash); },
    ...(o.noLanded ? {} : { async landed(hash: string) { landedCalls++; const k = (asked.get(hash) ?? 0) + 1; asked.set(hash, k); return k > (o.landedAfter ?? 1) ? "landed" as const : "pending" as const; } }),
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: o.fillGot ?? "99000000", spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const inner = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  // the mock bridge answers on the event loop's timers: while any answer is on its way the service's clock stands still,
  // so a check never runs out of time (VERIFY_MAX_MS) waiting on another trade's store write (the M1 flake on cbaddc66d)
  let busy = 0;
  const bridge: typeof inner = { ...inner, call: (method, params) => {
    if (method === "device.store.set" && ctl.drop(String(params?.key))) return Promise.resolve({ ok: null }) as never;
    busy++; return inner.call(method, params).finally(() => { busy--; });
  } };
  const sleep = async (ms: number) => { clock.t += ms; do await new Promise((r) => setImmediate(r)); while (busy > 0); };
  /** Every bridge answer in and every turn of work after it run (no clock moves). */
  const idle = async () => { for (let i = 0; i < 3; i++) do await new Promise((r) => setImmediate(r)); while (busy > 0); };
  // the service's timers, by hand (the live round, a booking's wake): fireDue() runs those due on the fake clock
  const timers = new Set<{ f: () => void; at: number }>();
  const timer = { set: (f: () => void, ms: number) => { const h = { f, at: clock.t + ms }; timers.add(h); return h; }, clear: (h: unknown) => { timers.delete(h as never); } };
  const fireDue = () => { for (const h of [...timers].filter((t) => t.at <= clock.t)) { timers.delete(h); h.f(); } };
  const make = () => createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], now: () => clock.t, sleep, timer });
  const svc = make();
  const buy = async () => svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  /** The app closed and opened again: a new service on the same device store (nothing kept in memory). */
  const reopen = () => make();
  /** The device store, as the app's bridge reads and writes it. */
  const store = (key: string, value: string) => inner.call("device.store.set", { key, value });
  const stored = async (key: string) => { const r = await inner.call<{ value: string | null }>("device.store.get", { key }); return "ok" in r ? r.ok.value : null; };
  return { svc, engine, clock, ctl, buy, reopen, idle, fireDue, timers, store, stored, landedCalls: () => landedCalls };
}
/** The first trade opens the session (one sheet, so it claims no time) and is confirmed on two nodes before the next. */
async function opened(x: ReturnType<typeof setup>): Promise<void> {
  x.ctl.verdict = () => "confirmed";
  await x.buy();
  await x.svc.checked();
  x.ctl.verdict = () => "pending";
}
const raw = async (x: ReturnType<typeof setup>) => BigInt((await x.svc.positions())[0]?.raw ?? "0");

test("done on the first node's word: 'about' the quote's amount, timed tap to landed, nothing booked yet", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const tapAt = x.clock.t;
  const p = await x.svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  const rec = await x.svc.trade(p);
  assert.equal(rec.status, "done");
  assert.equal(rec.fill?.estimated, true, "what arrived is 'about' until the chain's own figure is read");
  assert.equal(rec.fill?.got, p.quote.getRaw);
  assert.equal(rec.verifying, true);
  assert.equal(rec.timing?.tapAt, tapAt);
  assert.ok(rec.timing!.signedAt! <= rec.timing!.sentAt! && rec.timing!.sentAt! <= rec.timing!.landedAt!, "tap, signed, sent, landed, in order");
  assert.equal(landedMs(rec), 150, "the second landed() ask said yes: one fast 150 ms poll between them");
  assert.equal(await raw(x), before, "nothing booked on one node's word");
  assert.ok(rec.signed?.length, "its bytes are kept while the check runs");
});

test("the two-node check then confirms: the real fill is booked and the bytes are forgotten", async () => {
  const x = setup({ fillGot: "98000000" });
  await opened(x);
  const before = await raw(x);
  const rec = await x.buy();
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
  assert.equal(rec.status, "done");
  assert.equal(rec.verifying, undefined);
  assert.equal(rec.fill?.estimated, undefined);
  assert.equal(rec.fill?.got, "98000000", "the chain's own figure");
  assert.equal(rec.signed, undefined, "the bytes go once two nodes said how it ended");
  assert.equal(await raw(x) - before, 98000000n, "booked once, at the chain's figure");
});

test("the two-node check says it failed: the record turns to that problem, and nothing was booked", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const rec = await x.buy();
  assert.equal(rec.status, "done", "said done on the first node's word");
  x.ctl.verdict = () => "failed";
  await x.svc.checked();
  assert.equal(rec.status, "failed");
  assert.equal(rec.problem?.code, "trade.trade.reverted");
  assert.equal(rec.fill, undefined);
  assert.equal(landedMs(rec), undefined, "no 'Landed in' for a trade that didn't");
  assert.equal(await raw(x), before, "the failed one booked nothing");
});

test("a failure two nodes see before any node says landed still ends the wait (control)", async () => {
  const x = setup({ landedAfter: 1_000_000 });
  await opened(x);
  x.ctl.verdict = () => "failed";
  await assert.rejects(x.buy(), (e: any) => e?.problem?.code === "trade.trade.reverted");
});

test("control: an engine without landed() is followed by the two-node status alone, as before", async () => {
  const x = setup({ noLanded: true });
  await opened(x);
  x.ctl.verdict = () => "confirmed";
  const rec = await x.buy();
  assert.equal(rec.status, "done");
  assert.equal(rec.verifying, undefined);
  assert.equal(rec.fill?.estimated, undefined);
  assert.equal(x.landedCalls(), 0);
});

test("the app closed before the check ended: resume finishes it from the same bytes and books the fill once", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const rec = await x.buy();
  await x.svc.checked();
  assert.equal(rec.status, "done", "a node still says it landed: no two-node verdict yet doesn't turn it (review L4)");
  assert.equal(rec.verifying, true, "still to be checked");
  assert.equal(rec.fill?.estimated, true, "its 'about' stays");
  x.ctl.verdict = () => "confirmed";
  await x.svc.resume();
  assert.equal(rec.verifying, undefined);
  assert.equal(rec.fill?.got, "99000000");
  assert.equal(await raw(x) - before, 99000000n, "booked once");
  await x.svc.resume();
  assert.equal(await raw(x) - before, 99000000n, "a second open books nothing more");
});

test("two trades whose checks book at the same time: both fills are booked (a first buy of a coin, twice)", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const a = await x.buy();
  const b = await x.buy();
  assert.ok(a.verifying && b.verifying, "both done on one node's word, both checks running");
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
  assert.equal(await raw(x) - before, 2n * 99000000n, "neither booking was lost");
});

test("resume while a check still runs leaves that trade to its check: booked once", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const rec = await x.buy();
  const resumed = x.svc.resume();
  x.ctl.verdict = () => "confirmed";
  await resumed;
  await x.svc.checked();
  assert.equal(rec.status, "done");
  assert.equal(await raw(x) - before, 99000000n, "booked once");
});

// ---- Security review of b709736f (3 Nov): each test below fails on that commit

/** A fill per hash, side-aware: a buy gets coins, a sale gets SOL; `after` is the wallet's coin balance after it. */
function sideFills(x: ReturnType<typeof setup>, after: Record<string, string>, sold = "50000000") {
  x.engine.fill = async (p, hash) => (p.quote.side === "buy"
    ? { txHash: hash, got: "99000000", spent: p.quote.payRaw, fee: "10000", coinAfter: after[hash] }
    : { txHash: hash, got: "1000000", spent: sold, fee: "10000", coinAfter: after[hash] });
}

/** `done` turns true once the engine has read the fill of `hash` (the engine's fill, wrapped). */
function readOf(x: ReturnType<typeof setup>, hash: string): { done: boolean } {
  const seen = { done: false }, fill = x.engine.fill.bind(x.engine);
  x.engine.fill = async (p, h) => { const f = await fill(p, h); if (h === hash) seen.done = true; return f; };
  return seen;
}

test("M1: a sale tapped while its buy is still being checked books after the buy, even when its own check ends first", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const buy = await x.buy();
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before + 99000000n), decimals: 5 }] });
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  const [b, s] = [buy.hashes.at(-1)!, sell.hashes.at(-1)!];
  sideFills(x, { [b]: String(before + 99000000n), [s]: String(before + 49000000n) });
  // the sale's check ends first, by construction (no tick counting): the buy's two nodes stay silent until the sale's
  // fill has been read
  const saleRead = readOf(x, s);
  x.ctl.verdict = (h) => (h === s || saleRead.done ? "confirmed" : "pending");
  await x.svc.checked();
  assert.ok(saleRead.done, "the sale's fill was read before the buy confirmed");
  assert.deepEqual([buy.status, buy.verifying, sell.status, sell.verifying], ["done", undefined, "done", undefined], "both booked");
  const pos = (await x.svc.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n, "what's left after the buy then the sale (b709736f: the buy's figure, a phantom 50M)");
  // $10 of coins bought, about half sold for $0.10: a loss, never the whole $0.10 booked as profit on an empty position
  assert.ok(pos.realizedUsd < 0, `realized ${pos.realizedUsd}`);
});

test("M1: two quick buys whose checks end in reverse: the later buy's balance-after is the one kept", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const a = await x.buy();
  const b = await x.buy();
  const [ha, hb] = [a.hashes.at(-1)!, b.hashes.at(-1)!];
  sideFills(x, { [ha]: String(before + 99000000n), [hb]: String(before + 198000000n) });
  const laterRead = readOf(x, hb);
  x.ctl.verdict = (h) => (h === hb || laterRead.done ? "confirmed" : "pending");
  await x.svc.checked();
  assert.ok(laterRead.done);
  assert.deepEqual([a.status, a.verifying, b.status, b.verifying], ["done", undefined, "done", undefined], "both booked");
  assert.equal(await raw(x), before + 198000000n, "b709736f: the earlier buy's figure overwrote it (99M)");
});

test("L2: a sale done on one node's word that two nodes then say failed sets its leftover approvals back to 0", async () => {
  const x = setup();
  await opened(x);
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: "99000000", decimals: 5 }] });
  const asked: string[] = [];
  x.engine.revokeLeft = async (coin) => { asked.push(coin); return { key: "r", at: 0, ready: async () => {}, steps: [{ id: "approve", tx: btoa("revoke-1"), nonce: 9 }], quote: {} as never }; };
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  assert.equal(sell.status, "done");
  x.ctl.verdict = () => "failed";
  await x.svc.checked();
  assert.equal(sell.status, "failed");
  assert.deepEqual(asked, ["BONKmint"], "b709736f: never asked");
  // control: a buy that fails leaves no approval to cancel
  asked.length = 0;
  x.ctl.verdict = () => "pending";
  await x.buy();
  x.ctl.verdict = () => "failed";
  await x.svc.checked();
  assert.deepEqual(asked, []);
});

test("L3: two opens at once (resume twice) book a waiting trade once", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const rec = await x.buy();
  x.engine.landed = async () => "pending";                          // no node says it any more: the check ends unconfirmed
  await x.svc.checked();
  assert.equal(rec.status, "unconfirmed");
  x.ctl.verdict = () => "confirmed";
  await Promise.all([x.svc.resume(), x.svc.resume()]);
  assert.equal(await raw(x) - before, 99000000n, "b709736f: booked twice");
});

test("L4: the second node down for minutes: a 'Bought' that a node still says landed stays done, its 'about' kept", async () => {
  const x = setup();
  await opened(x);
  const rec = await x.buy();
  await x.svc.checked();                                             // strict never decides; landed() keeps saying yes
  assert.equal(rec.status, "done", "b709736f: 'unconfirmed' after 75 s");
  assert.equal(rec.fill?.estimated, true);
  assert.equal(rec.verifying, true);
  // control: once no node says it landed, no verdict is "unconfirmed", as before
  const y = setup();
  await opened(y);
  const r2 = await y.buy();
  y.engine.landed = async () => "pending";
  await y.svc.checked();
  assert.equal(r2.status, "unconfirmed");
});

test("L5: a fill that can't be read after two nodes confirm stays to be read; the next open books it", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const fill = x.engine.fill.bind(x.engine);
  x.engine.fill = async () => { throw new Error("node down"); };
  const rec = await x.buy();
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
  assert.equal(rec.status, "done");
  assert.equal(rec.verifying, "fill", "b709736f: dropped, a lasting 'about'; confirmed, only its fill to read (the audit's MUST, 7 Nov)");
  x.engine.fill = fill;
  await x.svc.resume();
  assert.equal(rec.verifying, undefined);
  assert.equal(rec.fill?.estimated, undefined);
  assert.equal(await raw(x) - before, 99000000n);
});

test("warm (a coin page opening): a buy and a sale are prepared at once, nothing signed; an engine that throws never reaches the page", async () => {
  const x = setup();
  await opened(x);
  const seen: string[] = [];
  const prep = x.engine.prepare.bind(x.engine);
  x.engine.prepare = async (side, coin, amount) => { seen.push(`${side}:${JSON.stringify(amount)}`); return prep(side, coin, amount); };
  await x.svc.warm("sol", "BONKmint");
  assert.deepEqual(seen.sort(), ['buy:{"usd":1}', 'sell:{"fraction":1}']);
  x.engine.prepare = async () => { throw new Error("node down"); };
  await x.svc.warm("sol", "BONKmint");
});

test("resume: two nodes say the one-node 'landed' trade expired: it turns to that problem, nothing booked", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const rec: TradeRecord = await x.buy();
  await x.svc.checked();
  x.ctl.verdict = () => "expired";
  await x.svc.resume();
  assert.equal(rec.status, "expired");
  assert.equal(rec.verifying, undefined);
  assert.equal(await raw(x), before);
});

// ---- the audit's MUST (7 Nov, on cbaddc66d): a buy whose check ended WITHOUT booking gave up its place in the coin's bookings,
// so a later sale booked first, against a position missing the buy (a sale booked as profit on an empty position). Each
// test below fails on cbaddc66d; the controls pass on both.

/** A buy left unbooked by its check, then a sale whose own check confirms. `hold`: how the buy is left unbooked. */
async function heldBuyThenSale(hold: "node-word" | "unread-fill" | "tap-unread") {
  const x = setup();
  await opened(x);
  const before = await raw(x), realized0 = (await x.svc.positions())[0]!.realizedUsd;
  const fill = x.engine.fill.bind(x.engine);
  let readable = true;
  x.engine.fill = async (p, h) => { if (!readable && p.quote.side === "buy") throw new Error("node down"); return fill(p, h); };
  if (hold === "tap-unread") { readable = false; x.ctl.verdict = () => "confirmed"; }    // two nodes confirm at the tap
  const buy = await x.buy();
  if (hold === "unread-fill") { readable = false; x.ctl.verdict = () => "confirmed"; } // two nodes confirm in the check
  await x.svc.checked();
  // (a) two nodes silent, a node still says it landed: done on a node's word; (b) confirmed, its fill not readable yet
  assert.deepEqual([buy.status, !!buy.verifying], ["done", true], "the buy's check ended without booking");
  assert.equal(await raw(x), before, "the buy isn't booked");
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before + 99000000n), decimals: 5 }] });
  x.ctl.verdict = () => "pending";                                   // the sale is done on a node's word, then checked
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  const [b, s] = [buy.hashes.at(-1)!, sell.hashes.at(-1)!];
  sideFills(x, { [b]: String(before + 99000000n), [s]: String(before + 49000000n) });
  const inner = x.engine.fill.bind(x.engine);
  x.engine.fill = async (p, h) => { if (!readable && h === b) throw new Error("node down"); return inner(p, h); };
  x.ctl.verdict = (h) => (h === s || hold !== "node-word" ? "confirmed" : "pending");
  await x.svc.checked();
  return { x, buy, sell, before, realized0, readable: () => { readable = true; } };
}
async function bookedInOrder(t: Awaited<ReturnType<typeof heldBuyThenSale>>) {
  const { x, buy, sell, before } = t;
  assert.deepEqual([sell.status, sell.verifying], ["done", "book"], "cbaddc66d: the sale booked first (verifying undefined)");
  const mid = (await x.svc.positions())[0]!;
  assert.equal(BigInt(mid.raw), before, "cbaddc66d: the sale booked against a position missing the buy");
  assert.equal(mid.realizedUsd, t.realized0, "nothing realized while the buy is unbooked");
  // no deadlock: an open while the buy still can't be booked (no verdict, or its fill unreadable) returns, both waiting
  await x.svc.resume();
  await x.svc.checked();
  assert.deepEqual([!!buy.verifying, sell.verifying, (await x.svc.positions())[0]!.raw], [true, "book", String(before)], "an open that can't book the buy: still waiting");
  // the next open decides the buy: it books, then the sale books, in tap order
  t.readable();
  x.ctl.verdict = () => "confirmed";
  await x.svc.resume();
  await x.svc.checked();
  assert.deepEqual([buy.status, buy.verifying, sell.status, sell.verifying], ["done", undefined, "done", undefined], "both booked");
  assert.equal(sell.signed, undefined, "the sale's bytes are forgotten once booked");
  const pos = (await x.svc.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n, "the buy then the sale");
  assert.ok(pos.realizedUsd < t.realized0, `a loss, never the sale's dollars as profit: realized ${pos.realizedUsd}`);
}

test("the audit's MUST (a): a buy done on a node's word whose check ends unbooked keeps its place: a later sale books only after it", async () => {
  await bookedInOrder(await heldBuyThenSale("node-word"));
});

test("the audit's MUST (b): a buy confirmed with its fill not readable yet keeps its place: a later sale books only after it", async () => {
  await bookedInOrder(await heldBuyThenSale("unread-fill"));
});

test("the audit's MUST (c): a buy two nodes confirm at the tap, its fill not readable yet, stays to be read and keeps its place", async () => {
  // cbaddc66d: done with nothing booked and its bytes forgotten, never read again; and the sale booked first
  await bookedInOrder(await heldBuyThenSale("tap-unread"));
});

test("the audit's MUST: after a reload, the unbooked buy takes its place again before any new tap: the sale still books after it", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const buy = await x.buy();
  await x.svc.checked();
  assert.equal(buy.verifying, true);
  const y = x.reopen();                                              // the app closed and opened again
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before + 99000000n), decimals: 5 }] });
  const sell = await y.trade(await y.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  const [b, s] = [buy.hashes.at(-1)!, sell.hashes.at(-1)!];
  sideFills(x, { [b]: String(before + 99000000n), [s]: String(before + 49000000n) });
  x.ctl.verdict = (h) => (h === s ? "confirmed" : "pending");
  await y.checked();
  assert.equal(sell.verifying, "book", "the sale waits for the buy loaded from the store");
  assert.equal(BigInt((await y.positions())[0]!.raw), before);
  x.ctl.verdict = () => "confirmed";
  await y.resume();
  await y.checked();
  const pos = (await y.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n);
  assert.ok(pos.realizedUsd < 0, `realized ${pos.realizedUsd}`);
  assert.ok((await y.activity()).every((r) => !r.verifying), "both booked");
});

// ---- the audit's two MUSTs on bf4a628fe (7 Nov): each test below fails on that commit

test("the audit's MUST 1: a buy nothing looks at again gives up its place when its live window ends, with no open and no other trade: the waiting sale books", async () => {
  const t = await heldBuyThenSale("node-word");
  const { x, sell, before } = t;
  assert.equal(sell.verifying, "book", "waiting for the buy");
  x.clock.t += LIVE_MAX_MS + 1;                                      // only the clock and the service's own timer move
  x.fireDue();
  await x.idle();
  assert.equal(sell.verifying, undefined, "bf4a628fe: no wake, the sale stayed waiting until another open or trade on the coin");
  assert.equal(BigInt((await x.svc.positions())[0]!.raw), before + 49000000n);
  assert.equal(x.timers.size, 0, "the wake ran once and set no other");
});

test("control (MUST 1): before the live window ends the wake gives nothing up: the sale keeps waiting", async () => {
  const { x, sell, before } = await heldBuyThenSale("node-word");
  assert.equal(x.timers.size, 1, "one wake, at the buy's live deadline");
  x.clock.t += 60_000;
  x.fireDue();
  await x.idle();
  assert.equal(sell.verifying, "book");
  assert.equal(BigInt((await x.svc.positions())[0]!.raw), before);
});

test("the audit's MUST 2: a buy two nodes confirmed with its fill unread is booked within one live round, then the sale right after it", async () => {
  const t = await heldBuyThenSale("unread-fill");
  const { x, buy, sell, before } = t;
  t.readable();
  const close = x.svc.watch();                                       // a card on screen: the live round runs
  x.clock.t += 60_000;
  x.fireDue();
  await x.svc.roundDone();
  await x.idle();
  close();
  assert.deepEqual([buy.status, buy.verifying, sell.status, sell.verifying], ["done", undefined, "done", undefined], "bf4a628fe: the round took only unconfirmed trades, the buy's fill was never read in the session");
  const pos = (await x.svc.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n, "the buy then the sale");
  assert.ok(pos.realizedUsd < t.realized0, `realized ${pos.realizedUsd}`);
  assert.equal(buy.endedAt !== undefined && buy.endedAt <= x.clock.t - 60_000, true, "its 'done' time stays the tap's");
});

for (const ended of ["failed", "expired"] as const) {
  test(`control: a buy whose check ends ${ended} gives up its place: the later sale books at once`, async () => {
    const x = setup();
    await opened(x);
    const before = await raw(x);
    const buy = await x.buy();
    x.ctl.verdict = () => ended;
    await x.svc.checked();
    assert.equal(buy.status, ended);
    x.ctl.verdict = () => "pending";
    x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before), decimals: 5 }] });
    const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
    sideFills(x, { [sell.hashes.at(-1)!]: String(before - 50000000n) });
    x.ctl.verdict = () => "confirmed";
    await x.svc.checked();
    assert.deepEqual([sell.status, sell.verifying], ["done", undefined], "booked, nothing before it to wait for");
    assert.equal(BigInt((await x.svc.positions())[0]!.raw), before - 50000000n);
  });
}

// ---- the audit's MUST B (7 Nov, on 42bff1bd7): the positions and the fills booked into them are one stored object, written at
// once; an app closed after the positions were written but before its record said "booked" books nothing twice

test("the audit's MUST B: closed after the positions were written but before the record: the next open books the fill once", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const buy = await x.buy();
  x.ctl.drop = (k) => k === "activity";                              // the record's save never lands
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
  assert.equal(buy.verifying, undefined, "booked in the session");
  const y = x.reopen();
  x.ctl.drop = () => false;
  assert.equal((await y.activity()).find((r) => r.id === buy.id)?.verifying, true, "the stored record still says checking");
  await y.resume();
  await y.checked();
  assert.equal(BigInt((await y.positions())[0]!.raw) - before, 99000000n, "42bff1bd7: booked twice (198M)");
});

test("the audit's MUST B: a sale that zeroed its position, closed before its record, then a new buy: the next open never books the sale again", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before), decimals: 5 }] });
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: String(before) }));
  sideFills(x, { [sell.hashes.at(-1)!]: "0" }, String(before));
  x.ctl.drop = (k) => k === "activity";
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
  assert.equal((await x.svc.positions()).length, 0, "the sale zeroed it");
  const again = await x.buy();                                       // a new buy: its own position
  await x.svc.checked();
  assert.equal(again.verifying, undefined);
  const y = x.reopen();
  x.ctl.drop = () => false;
  await y.resume();
  await y.checked();
  assert.equal((await y.positions())[0]?.raw, "99000000", "42bff1bd7: the sale booked again, against the new buy (nothing left)");
});

test("the audit's MUST B: positions stored under the old key are read once, then kept with the fills booked into them", async () => {
  const x = setup();
  const old = { "sol:BONKmint": { chain: "sol", coin: "BONKmint", symbol: "BONK", decimals: 5, raw: "123", costUsd: 1, realizedUsd: 0 } };
  await x.store("positions", JSON.stringify(old));                   // an older build's store; nothing loaded yet
  assert.equal((await x.svc.positions())[0]?.raw, "123", "migrated from the old key");
  await opened(x);
  const book = JSON.parse((await x.stored("positions.v2"))!);
  assert.equal(book.positions["sol:BONKmint"].raw, String(123n + 99000000n), "one object: the positions...");
  assert.deepEqual(Object.keys(book.applied).length, 1, "...and the fill booked into them");
});

// ---- the audit's MUST A (7 Nov, on 42bff1bd7): a sale whose final fill was read but whose booking waited (verifying "book")
// is booked after a reload from that fill, in tap order, with no chain read

test("the audit's MUST A: a reload while a confirmed sale waited for its buy: the next open books the buy, then the sale from its kept fill, no read", async () => {
  const t = await heldBuyThenSale("node-word");
  const { x, buy, sell, before } = t;
  assert.equal(sell.verifying, "book", "its final fill kept, only the booking waits");
  const y = x.reopen();
  const reads: string[] = [];
  const fill = x.engine.fill.bind(x.engine);
  x.engine.fill = async (p, h) => { reads.push(h); return fill(p, h); };
  x.ctl.verdict = () => "confirmed";
  await y.resume();
  await y.checked();
  assert.deepEqual(reads, [buy.hashes.at(-1)!], "42bff1bd7: the sale's fill was read again from the chain");
  const pos = (await y.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n, "the buy then the sale");
  assert.ok(pos.realizedUsd < t.realized0, `realized ${pos.realizedUsd}`);
  assert.ok((await y.activity()).every((r) => !r.verifying));
});

test("control (20): a reload in the middle of two trades on a coin: the next open books each once, in tap order, and returns", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const buy = await x.buy();
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before + 99000000n), decimals: 5 }] });
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  sideFills(x, { [buy.hashes.at(-1)!]: String(before + 99000000n), [sell.hashes.at(-1)!]: String(before + 49000000n) });
  await x.svc.checked();                                             // the app closes with both still checking
  const y = x.reopen();
  x.ctl.verdict = () => "confirmed";
  await y.resume();
  await y.checked();
  await y.resume();                                                  // a second open books nothing more
  const pos = (await y.positions())[0]!;
  assert.equal(BigInt(pos.raw), before + 49000000n);
  assert.ok(pos.realizedUsd < 0);
  assert.ok((await y.activity()).every((r) => !r.verifying));
});
