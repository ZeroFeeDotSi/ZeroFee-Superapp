// Trade's read-only reader for the shell: trade.holdings is Positions' own total, read without any write or signature.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { SAMPLE_OPENING } from "./demo-engine.ts";
import { forApps } from "@zerofee/core/bridge";
import { createTradeReader } from "./reader.ts";
import { setAppRuntime, type TradeRuntime } from "./runtime.ts";
import { holdingsUsd, type Position, type TradingWallet } from "./service.ts";

const demo = () => {
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING } });
  const asked: string[] = [];
  const bridge = forApps({ call: (m: string, p?: Record<string, unknown>) => { asked.push(m); return mock.call(m, p); }, on: mock.on } as typeof mock, "trade");
  return { bridge, asked };
};

test("trade.holdings in ?demo: the three sample trading wallets at the recorded prices, as a plain dollar decimal, reading only", async () => {
  const { bridge, asked } = demo();
  const r = await createTradeReader(bridge).call<{ usd: string }>("trade.holdings");
  assert.ok("ok" in r, JSON.stringify(r));
  assert.match(r.ok.usd, /^\d+\.\d\d$/);
  assert.equal(r.ok.usd, "172.54", "1.42 SOL and 0.012 ETH at CoinGecko's recorded prices: what Positions shows in ?demo (BNB's sample 0.08 isn't offered until its route is proven, H04)");
  assert.ok(asked.every((m) => m === "subwallet.list" || m === "subwallet.balances" || m === "device.store.get" || m === "subwallet.float.balance"), asked.join(" "));
});

test("trade.positions (Home V4's sub-rows) is a read like trade.holdings: in ?demo it asks only reads, and the reader still refuses everything else", async () => {
  const { bridge, asked } = demo();
  const reader = createTradeReader(bridge);
  const r = await reader.call<{ chain: string; symbol: string; amount: string; usd?: string }[]>("trade.positions");
  assert.ok("ok" in r && Array.isArray(r.ok), JSON.stringify(r));
  assert.ok(asked.every((m) => m === "subwallet.list" || m === "subwallet.balances" || m === "device.store.get" || m === "subwallet.float.balance"), `reads only: ${asked.join(" ")}`);
  for (const m of ["trade.buy", "trade.sell", "subwallet.create", "subwallet.float.out", "ledger.withdraw", "trade.positions.write"]) assert.ok("problem" in (await reader.call(m)), m);
});

test("anything else is refused, and the reader asks the Trade app's own runtime once it has opened", async () => {
  const { bridge } = demo();
  const reader = createTradeReader(bridge, () => { throw new Error("not before the app's"); });
  for (const m of ["trade.buy", "subwallet.create", "ledger.withdraw"]) assert.ok("problem" in (await reader.call(m)), m);
  // the app's float says the Trading total (reserve + wallets + coins + an Add on its way): the reader says the same
  let refreshed = 0;
  setAppRuntime({ float: { refresh: async () => { refreshed++; }, snapshot: () => ({ loaded: true, totalUsd: 257.07 }) } } as unknown as TradeRuntime);
  const r = await reader.call<{ usd: string }>("trade.holdings");
  assert.ok("ok" in r);
  assert.equal(r.ok.usd, "257.07", "Wallet's In trading = Trade's Trading line");
  assert.equal(refreshed, 1, "read fresh, not from a stale snapshot");
});

test("a $1 buy leaves the trading total unchanged but for its fee: on a Trade screen opened again and in the reader, at once", async () => {
  const { resetSampleWallets } = await import("./demo-engine.ts");
  const { createTradeRuntime } = await import("./runtime.ts");
  resetSampleWallets();
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING } });
  const total = async (rt: TradeRuntime) => { await rt.float.refresh(); return rt.float.snapshot().totalUsd; };
  const first = setAppRuntime(createTradeRuntime(forApps(mock, "trade")));
  const reader = createTradeReader(forApps(mock, "trade"));
  const before = await total(first);
  const q = await first.svc.quote("buy", "sol", "33jENUQnjoitkMFpvNJcSHyLAHFWJuHwT6E3E8CNpump", { usd: 1 });
  await q.ready();
  assert.equal((await first.svc.trade(q)).status, "done");
  // another app came on screen and Trade's screen mounted again: a new runtime over the same sample wallets
  const again = setAppRuntime(createTradeRuntime(forApps(mock, "trade")));
  for (const [who, usd] of [["the screen that bought", await total(first)], ["the screen opened again", await total(again)]] as const) {
    assert.ok(usd <= before && before - usd < 0.05, `${who}: $${usd.toFixed(2)} after a $1 buy from $${before.toFixed(2)}`);
  }
  const r = await reader.call<{ usd: string }>("trade.holdings");
  assert.ok("ok" in r);
  assert.equal(r.ok.usd, (await total(again)).toFixed(2), "the reader says what the screen says");
});

test("after Add $25 in ?demo, Wallet's In trading and Trade's Trading line are one number, the $25 included from the start", async () => {
  const { resetSampleWallets } = await import("./demo-engine.ts");
  const { createTradeRuntime } = await import("./runtime.ts");
  resetSampleWallets();
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, settleMs: 50, tradeChains: ["sol", "hood", "bsc"], float: { moveMs: 10 } });
  const app = setAppRuntime(createTradeRuntime(forApps(mock, "trade")));
  const reader = createTradeReader(forApps(mock, "trade"));
  await app.float.refresh();
  const before = app.float.snapshot().totalUsd;
  await app.float.add(25);
  for (const when of ["on its way", "landed"]) {
    const r = await reader.call<{ usd: string }>("trade.holdings");
    assert.ok("ok" in r);
    assert.equal(r.ok.usd, app.float.snapshot().totalUsd.toFixed(2), `${when}: one number`);
    assert.equal(r.ok.usd, (before + 25).toFixed(2), `${when}: the $25 counted`);
    await new Promise((res) => setTimeout(res, 120));
  }
});

// Audit MKT-3: an unreadable Trading balance was added in as $0, so Wallet's total came out short by the whole reserve.
test("MKT-3: a Trading balance that can't be read gives no In trading figure, never one short by the reserve", async () => {
  const mock = createMockBridge({ latencyMs: 0, safeFillOpen: true, tradeChains: ["sol", "hood", "bsc"], float: { opening: SAMPLE_OPENING } });
  const failing = forApps({ call: (m: string, p?: Record<string, unknown>) => (m === "subwallet.float.balance" ? Promise.resolve({ problem: { code: "x", whatHappened: "down", money: { state: "not-involved" }, next: { kind: "nothing", label: "OK" } } }) : mock.call(m, p)), on: mock.on } as typeof mock, "trade");
  setAppRuntime(undefined as unknown as TradeRuntime);
  const r = await createTradeReader(failing).call<{ usd: string }>("trade.holdings");
  assert.ok("problem" in r, JSON.stringify(r));
  // the app's float not read yet: the same
  setAppRuntime({ float: { refresh: async () => {}, snapshot: () => ({ loaded: false, totalUsd: 12 }) } } as unknown as TradeRuntime);
  assert.ok("problem" in (await createTradeReader(failing).call("trade.holdings")));
  setAppRuntime(undefined as unknown as TradeRuntime);
});

test("trade.positions: each held coin with its chain, address, amount as the coin and dollars; an unpriced coin has no dollars, never $0; an empty one is left out", async () => {
  const pos = (o: Partial<Position>): Position => ({ chain: "sol", coin: "So1Mint", symbol: "BONK", decimals: 5, raw: "0", costUsd: 0, realizedUsd: 0, ...o });
  setAppRuntime({ svc: { positions: async () => [pos({ raw: "125050000", valueUsd: 3.456 }), pos({ coin: "0xabc", chain: "hood", symbol: "HOOD", decimals: 18, raw: "1500000000000000000" }), pos({ coin: "gone", raw: "0" })] } } as unknown as TradeRuntime);
  const r = await createTradeReader(demo().bridge).call<{ chain: string; address: string; symbol: string; amount: string; usd?: string }[]>("trade.positions");
  assert.ok("ok" in r);
  assert.deepEqual(r.ok, [{ chain: "sol", address: "So1Mint", symbol: "BONK", amount: "1250.5", usd: "3.46" }, { chain: "hood", address: "0xabc", symbol: "HOOD", amount: "1.5" }]);
});
