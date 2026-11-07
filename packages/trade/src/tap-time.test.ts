// the audit's Trade audit T4 (8 Nov): one trade, two times. The chip's quote took 1.2 s and the chain 0.6 s: the row and Jobs
// said "Landed in 1.80 s" (from the press), Activity "done in under a second" (the record's filledInMs, from tradeOnce's
// own start after the quote). Now the screens hand the press into svc.trade (`tapAt`), the record counts from it, and the
// row, Jobs and the receipt read the record's figure. Controls: no press handed in is the service's own clock, and a
// press in the future or long past is not believed. Fails on main.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { forApps } from "@zerofee/core/bridge";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { createTradeService } from "./service.ts";
import { tookWords } from "./app/format.ts";
import { epochOf, pressAt, TAP_BACK_MS, tradeMs } from "./tap-time.ts";
import type { ChainEngine, Fill, Prepared } from "./types.ts";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

function setup() {
  const clock = { t: 1_700_000_000_000 };
  let n = 0;
  const engine: ChainEngine = {
    chain: "sol", owner: "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM",
    async prepare(side, coin) {
      return { key: `k${++n}`, at: 0, ready: async () => {}, steps: [{ id: "swap", tx: btoa(`unsigned-${n}`), lastValidBlockHeight: 1000 }],
        quote: { side, chain: "sol", coin, symbol: "BONK", decimals: 5, payRaw: "100000000", payUsd: 10, getRaw: "100000000", getUsd: 10, getMinRaw: "97000000", feeRaw: "10000", feeUsd: 0.001, route: "pump.fun", slippageBps: 300, expiresAt: clock.t + 20_000 } } as Prepared;
    },
    txHash: (tx) => `hash-${atob(tx)}`,
    async send(tx) { return `hash-${atob(tx)}`; },
    async status() { return "confirmed" as const; },
    async landed() { clock.t += 600; return "landed" as const; },   // the chain's part: 0.6 s
    async fill(p, hash): Promise<Fill> { return { txHash: hash, got: "99000000", spent: p.quote.payRaw, fee: "10000" }; },
    async holdings() { return { native: "1000000000", coins: [] }; },
    poolChanged() {},
  };
  const bridge = forApps(createMockBridge({ latencyMs: 0, settleMs: 5 }), "trade");
  const svc = createTradeService({ bridge, engineFor: () => engine, nativeUsd: async () => 100, meta: async () => ({ symbol: "BONK", priceUsd: 0.0001 }), chains: ["sol"], now: () => clock.t, sleep: async (ms) => { clock.t += ms; await new Promise((r) => setImmediate(r)); } });
  return { svc, clock };
}

test("T4: the record's time counts from the press handed in: the chip's 1.2 s quote wait and the chain's 0.6 s, one figure", async () => {
  const { svc, clock } = setup();
  const press = clock.t;
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  clock.t += 1_200;                                              // the chip's quote and its check, after the press
  const rec = await svc.trade(p, "chip:BONKmint", { tapAt: press });
  assert.equal(rec.status, "done");
  assert.equal(rec.filledInMs, 1_800, "from the press: 1.2 s + 0.6 s");
  assert.equal(rec.startedAt, press);
  assert.equal(tradeMs(rec, 0, 99_999), 1_800, "the row, Jobs and the receipt read the record's figure");
  assert.equal(tookWords(rec.filledInMs!), tookWords(tradeMs(rec, 0, 99_999)), "Activity says the same");
  await svc.checked();
});

test("T4 controls: no press handed in starts at the trade; a press in the future or past TAP_BACK_MS is not believed", async () => {
  const { svc, clock } = setup();
  const p = await svc.quote("buy", "sol", "BONKmint", { usd: 10 });
  clock.t += 1_200;
  const rec = await svc.trade(p);
  assert.equal(rec.filledInMs, 600, "the service's own clock");
  await svc.checked();
  assert.equal(pressAt(undefined, 5_000), 5_000);
  assert.equal(pressAt(6_000, 5_000), 5_000, "a press after now");
  assert.equal(pressAt(5_000 - TAP_BACK_MS - 1, 5_000), 5_000, "a press long gone");
  assert.equal(pressAt(Number.NaN, 5_000), 5_000);
  assert.equal(pressAt(3_800, 5_000), 3_800, "control: a real press just past");
  assert.equal(epochOf(100, 10_000, 1_300), 8_800, "a performance.now() moment in epoch ms");
  assert.equal(tradeMs({}, 1_000, 2_500), 1_500, "no record time yet: the screen's own count");
});

test("T4: both screens hand their press into the trade and read the record's time (wiring)", () => {
  const d = src("./app/screens/Discover.tsx"), t = src("./app/screens/TradeSheet.tsx");
  assert.match(d, /svc\.trade\(p, `chip:\$\{r\.address\}`, \{ task: taskId, tapAt: epochOf\(at\) \}\)/);
  assert.match(d, /ms = tradeMs\(rec, at\)/);
  assert.match(t, /svc\.trade\(quote\.p, undefined, \{ task: taskId, tapAt: epochOf\(at\) \}\)/);
  assert.match(t, /ms = tradeMs\(rec, at\)/);
  assert.doesNotMatch(`${d}\n${t}`, /ms = performance\.now\(\) - at;|ms: performance\.now\(\) - at/, "control: no screen counts its own time for a landed trade");
});
