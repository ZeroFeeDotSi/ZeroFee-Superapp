// The gas guard (pure), the old engine's tests for BNB Chain and Robinhood Chain, with their numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROVE_GAS, BUY_GAS, buyCost, counted, DUST_TOKEN_USD, marginOf, maxBuy, reserveFor, SELL_GAS, sellCost, sellNeed, spendable, type GasFeeData, type HeldToken } from "./gasguard.ts";

const GWEI = 1_000_000_000n;
const fee: GasFeeData = { gasPrice: 3n * GWEI };
const tok = (n: number, extra: Partial<HeldToken> = {}): HeldToken => ({ address: `0x${n.toString(16).padStart(40, "0")}`, usd: 5, ...extra });

test("the reserve is 0 when nothing above dust is held: a chain with no coins can still go to dust", () => {
  for (const c of ["bsc", "hood"] as const) assert.equal(reserveFor(c, [], fee), 0n);
  assert.equal(reserveFor("bsc", [tok(1, { usd: DUST_TOKEN_USD / 2 })], fee), 0n);
  assert.equal(spendable("bsc", 123n, [], fee), 123n);
});

test("every margin is at least 1.5x, and Robinhood's (its L1 data fee moves) is higher", () => {
  for (const c of ["bsc", "hood"] as const) { const [n, d] = marginOf(c); assert.ok(n * 2n >= d * 3n); }
  assert.ok(marginOf("hood")[0] * marginOf("bsc")[1] > marginOf("bsc")[0] * marginOf("hood")[1]);
});

test("one coin: (approve x2 + swap, plus one more sell of slack) x the margin; an approved coin sells with the swap alone", () => {
  const one = (2n * APPROVE_GAS + SELL_GAS) * fee.gasPrice!;
  assert.equal(sellCost(tok(1), fee), one);
  const slack = one > BUY_GAS * fee.gasPrice! ? one : BUY_GAS * fee.gasPrice!;
  assert.equal(reserveFor("bsc", [tok(1)], fee), ((one + slack) * 3n + 1n) / 2n);
  assert.equal(sellCost(tok(1, { approved: true }), fee), SELL_GAS * fee.gasPrice!);
  assert.equal(sellCost(tok(1, { approved: true, swapGas: 300_000n }), fee), 300_000n * fee.gasPrice!);
});

test("it covers EVERY coin held; one coin listed twice is one coin; a fee spike raises it in proportion", () => {
  const held = [tok(1), tok(2), tok(3), tok(4)];
  const sum = held.reduce((n, t) => n + sellCost(t, fee), 0n);
  assert.ok(reserveFor("bsc", held, fee) >= (sum * 3n) / 2n);
  assert.ok(reserveFor("bsc", held, fee) > reserveFor("bsc", held.slice(0, 3), fee));
  assert.equal(reserveFor("bsc", [tok(1), tok(1)], fee), reserveFor("bsc", [tok(1)], fee));
  const r1 = reserveFor("bsc", [tok(1)], fee), r4 = reserveFor("bsc", [tok(1)], { gasPrice: 12n * GWEI });
  assert.ok(r4 >= r1 * 4n - 4n && r4 <= r1 * 4n + 4n);
});

test("Robinhood: an L1 data fee per transaction is added and scaled by the bigger margin", () => {
  assert.ok(reserveFor("hood", [tok(1)], { ...fee, l1FeePerTx: 10n ** 15n }) - reserveFor("hood", [tok(1)], fee) > 10n ** 15n * 3n);
});

test("dust coins are ignored, a coin of unknown value is not", () => {
  assert.equal(counted([tok(1, { usd: 0.001 }), { address: "0xabc" }, tok(2)]).length, 2);
});

test("spendable = native - reserve, never below 0; a buy keeps the later sell of every coin plus the new one, for any amount", () => {
  const r = reserveFor("bsc", [tok(1)], fee);
  assert.equal(spendable("bsc", r + 5n, [tok(1)], fee), 5n);
  assert.equal(spendable("bsc", r - 1n, [tok(1)], fee), 0n);
  const held = [tok(1), tok(2)], bought = tok(3), txCost = BUY_GAS * fee.gasPrice!;
  const after = reserveFor("bsc", [...held, bought], fee);
  for (const native of [10n ** 18n, 5n * 10n ** 16n, after + txCost + 1000n, after]) {
    const cap = maxBuy("bsc", native, held, bought, fee, txCost);
    if (cap > 0n) assert.ok(native - cap - txCost >= after); else assert.ok(native <= after + txCost);
  }
  assert.equal(maxBuy("bsc", after + txCost + 777n, held, bought, fee, txCost), 777n);
  assert.equal(maxBuy("bsc", 10n ** 18n, [tok(1, { usd: 0.001 })], tok(1), fee, txCost), 10n ** 18n - reserveFor("bsc", [tok(1)], fee) - txCost, "a dust amount of the coin already held doesn't hide it");
});

test("sellNeed is one sell + 10 %: always below the reserve, so a guarded wallet never needs a top-up", () => {
  const one = (2n * APPROVE_GAS + SELL_GAS) * fee.gasPrice!;
  assert.equal(sellNeed(tok(1), fee), (one * 11n + 9n) / 10n);
  for (const c of ["bsc", "hood"] as const) assert.ok(sellNeed(tok(1), fee) < reserveFor(c, [tok(1)], fee));
  assert.equal(buyCost(fee), BUY_GAS * fee.gasPrice!);
});
