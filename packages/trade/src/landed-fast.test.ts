// Speed (3 Nov): a trade is done on the FIRST node's word that it landed; the two-node check keeps running behind it,
// books the real fill, and turns the record to its problem if two nodes then say it failed. The service's clock moves
// only when it waits, so every timing here is exact (no wall clock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService, landedMs, type TradeRecord } from "./service.ts";
import type { ChainEngine, Fill, Prepared, TxStatus } from "./types.ts";

/** `ctl.verdict`: the two-node status of a hash (default pending); `landedAfter`: landed() says yes on its (n+1)th ask per hash. */
function setup(o: { landedAfter?: number; noLanded?: boolean; fillGot?: string } = {}) {
  const clock = { t: 1_700_000_000_000 };
  let n = 0, landedCalls = 0;
  const asked = new Map<string, number>();
  const ctl = { verdict: (_hash: string): TxStatus => "pending" };
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
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  const buy = async () => svc.trade(await svc.quote("buy", "sol", "BONKmint", { usd: 10 }));
  return { svc, engine, clock, ctl, buy, landedCalls: () => landedCalls };
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

test("M1: a sale tapped while its buy is still being checked books after the buy, even when its own check ends first", async () => {
  const x = setup();
  await opened(x);
  const before = await raw(x);
  const buy = await x.buy();
  x.engine.holdings = async () => ({ native: "1000000000", coins: [{ coin: "BONKmint", raw: String(before + 99000000n), decimals: 5 }] });
  const sell = await x.svc.trade(await x.svc.quote("sell", "sol", "BONKmint", { raw: "50000000" }));
  const [b, s] = [buy.hashes.at(-1)!, sell.hashes.at(-1)!];
  sideFills(x, { [b]: String(before + 99000000n), [s]: String(before + 49000000n) });
  x.ctl.verdict = (h) => (h === s ? "confirmed" : "pending");    // the sale's check ends first
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
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
  x.ctl.verdict = (h) => (h === hb ? "confirmed" : "pending");
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  x.ctl.verdict = () => "confirmed";
  await x.svc.checked();
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
  assert.equal(rec.verifying, true, "b709736f: dropped, a lasting 'about'");
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
