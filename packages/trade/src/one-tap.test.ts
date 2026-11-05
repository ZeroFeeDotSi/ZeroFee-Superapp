// One tap, one trade (QA's sd-errors crawl, 4 Nov): "Buy $5 of DOPE" tapped twice 4 ms apart landed TWO buys,
// a triple tap two. The lock is the engine's (service.trade), taken before any await: a second call for the same coin,
// side, amount and wallet while the first is on its way gets the first's promise and never sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "./service.ts";
import { tradeRunner, type PriceOrder } from "./orders.ts";
import { standingRunner, type StandingPlan } from "./standing.ts";
import type { ChainEngine, Fill, Prepared } from "./types.ts";

function setup() {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const sent: string[] = [];
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      const p: Prepared = {
        key: `k${++n}`, at: 0, ready: async () => {},
        steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "DOPE", decimals: 6, payRaw: "50000000", payUsd: 5, getRaw: "1501000000", getUsd: 5, getMinRaw: "1450000000", feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 },
      };
      return p;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { sent.push(tx); return `hash-${atob(tx)}`; },
    async status() { return "confirmed"; },
    async landed() { return "landed" as const; },
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: p.quote.getRaw, spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "DOPE", priceUsd: 0.0033 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, sent };
}
const buys = async (svc: ReturnType<typeof setup>["svc"]) => (await svc.activity()).filter((r) => r.kind === "buy").length;

test("control: one tap sends one transaction and makes one row", async () => {
  const x = setup();
  const rec = await x.svc.trade(await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }));
  assert.equal(rec.status, "done");
  assert.equal(x.sent.length, 1);
  assert.equal(await buys(x.svc), 1);
});

test("two taps 0 ms apart: one send, one row, both taps get the same record", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const a = x.svc.trade(p), b = x.svc.trade(p);
  assert.equal(a, b, "the second call is handed the first's own promise");
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb);
  assert.equal(x.sent.length, 1, "never a second transaction");
  assert.equal(await buys(x.svc), 1, "never a second Activity row");
});

test("a triple tap: one send", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  await Promise.all([x.svc.trade(p), x.svc.trade(p), x.svc.trade(p)]);
  assert.equal(x.sent.length, 1);
  assert.equal(await buys(x.svc), 1);
});

test("two quotes of the same buy tapped together (a row button quoting per tap): one send", async () => {
  const x = setup();
  const [p1, p2] = await Promise.all([x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }), x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 })]);
  assert.notEqual(p1, p2);
  await Promise.all([x.svc.trade(p1), x.svc.trade(p2)]);
  assert.equal(x.sent.length, 1);
});

test("after the first settles, the same buy again is a new trade", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const first = await x.svc.trade(p);
  const second = await x.svc.trade(await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }));
  assert.notEqual(first.id, second.id);
  assert.equal(x.sent.length, 2);
  assert.equal(await buys(x.svc), 2);
});

test("a first tap that fails lets the next tap go", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const bad = { ...p, ready: async () => { throw new Error("route gone"); } } as Prepared;
  await assert.rejects(x.svc.trade(bad));
  await x.svc.trade(await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }));
  assert.equal(x.sent.length, 1);
});

test("different coins and another amount, all at once: each goes", async () => {
  const x = setup();
  const [a, b] = await Promise.all([x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }), x.svc.quote("buy", "sol", "BONKmint", { usd: 5 })]);
  const c = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  c.quote = { ...c.quote, payRaw: "60000000", payUsd: 6 };
  const recs = await Promise.all([x.svc.trade(a), x.svc.trade(b), x.svc.trade(c)]);
  assert.equal(new Set(recs.map((r) => r.id)).size, 3);
  assert.equal(x.sent.length, 3);
});

test("a price order and a standing buy that fire while the person's identical tap is on its way: each its own trade and record (QA)", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const order = { id: "o1", chain: "sol", coin: "DOPEmint", symbol: "DOPE", kind: "limit-buy", usd: 5 } as unknown as PriceOrder;
  const plan = { id: "s1", chain: "sol", coin: "DOPEmint", symbol: "DOPE", usd: 5 } as unknown as StandingPlan;
  const [tap, ran, stood] = await Promise.all([x.svc.trade(p), tradeRunner(x.svc as never)(order), standingRunner(x.svc as never)(plan, 5)]);
  const ids = [tap.id, (ran as { recordId: string }).recordId, (stood as { recordId: string }).recordId];
  assert.equal(new Set(ids).size, 3, "three records, none the tap's");
  assert.equal(x.sent.length, 3, "three trades");
});

test("control: the same order firing twice at once is one trade", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const [a, b] = await Promise.all([x.svc.trade(p, "order:o1"), x.svc.trade(p, "order:o1")]);
  assert.equal(a.id, b.id);
  assert.equal(x.sent.length, 1);
});

test("a one-tap Buy chip on a list row (origin chip:<row>): a double tap folds into one trade", async () => {
  const x = setup();
  const p = await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 });
  const [a, b] = await Promise.all([x.svc.trade(p, "chip:DOPEmint"), x.svc.trade(p, "chip:DOPEmint")]);
  assert.equal(a.id, b.id);
  assert.equal(x.sent.length, 1);
  assert.equal(await buys(x.svc), 1);
});

test("control: chips on two rows at once each go, and the same chip again after it settles is a new trade", async () => {
  const x = setup();
  const [p1, p2] = await Promise.all([x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }), x.svc.quote("buy", "sol", "BONKmint", { usd: 5 })]);
  await Promise.all([x.svc.trade(p1, "chip:DOPEmint"), x.svc.trade(p2, "chip:BONKmint")]);
  assert.equal(x.sent.length, 2);
  await x.svc.trade(await x.svc.quote("buy", "sol", "DOPEmint", { usd: 5 }), "chip:DOPEmint");
  assert.equal(x.sent.length, 3);
});
