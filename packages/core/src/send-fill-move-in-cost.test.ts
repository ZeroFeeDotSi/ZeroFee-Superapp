// A Send's fill sheet, the move in's own cost (audit, 6 Nov): what stays in Private is what the move in signs to bring less
// the payout, and its cost joins "Fees". Before, any cost of the move in printed as money staying in Private.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IntentsFacts, QuoteFacts, SendPayout } from "./intents.ts";
import { sendFillWords } from "./send-fill.ts";

const USDC_C = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", SOL_C = "sol.omft.near", USDC = `nep141:${USDC_C}`, SOL = `nep141:${SOL_C}`;
const facts = { tokens: new Map([[USDC_C, { symbol: "USDC", decimals: 6 }], [SOL_C, { symbol: "SOL", decimals: 9 }]]) } as unknown as IntentsFacts;
const leg1 = (amountIn: string, amountOut: string | undefined, origin = USDC, usd: { in?: string; out?: string } = {}) =>
  ({ originAsset: origin, destinationAsset: origin, amountIn, ...(amountOut === undefined ? {} : { amountOut }), ...(usd.in ? { amountInUsd: usd.in } : {}), ...(usd.out ? { amountOutUsd: usd.out } : {}) }) as unknown as QuoteFacts;
const payout = (amountIn: string, origin = USDC, usd: { in?: string; out?: string } = { out: "247.50" }) =>
  ({ originAsset: origin, amountIn, destinationAsset: SOL, recipient: "payee.test", recipientType: "DESTINATION_CHAIN", ...(usd.in ? { amountInUsd: usd.in } : {}), ...(usd.out ? { amountOutUsd: usd.out } : {}) }) as unknown as SendPayout;
const lines = (q: QuoteFacts, s: SendPayout) => sendFillWords(q, s, facts)!.lines;

test("no cost on the move in (today's USDC quote, amountOut = amountIn): the figures are as they were", () => {
  assert.deepEqual(lines(leg1("300000000", "300000000"), payout("250000000")), ["Your Safe sends · $300.00", "Stays in Private · $50.00", "Fees · about $2.50", "NEAR Intents and the network keep this. ZeroFee takes nothing."]);
});

test("a cost on the move in is a fee, not money staying; the lines add up to what the Safe sends", () => {
  const l = lines(leg1("300000000", "299700000"), payout("250000000"));
  assert.deepEqual(l.slice(0, 3), ["Your Safe sends · $300.00", "Stays in Private · $49.70", "Fees · about $2.80"]);
  // Y = Z + T + the move in's cost, read from the sheet itself; $2.50 of the fees is the payout's, inside T
  const cents = (i: number) => Math.round(Number(l[i]!.split("$")[1]) * 100);
  const title = sendFillWords(leg1("300000000", "299700000"), payout("250000000"), facts)!.title;
  assert.equal(title, "Send $250.00 from your Safe");
  assert.equal(cents(0), cents(1) + 25000 + (cents(2) - 250));
});

test("the slippage room still stays: a payout at the signed minimum leaves the rest of what arrives", () => {
  assert.deepEqual(lines(leg1("5000000", "5000000"), payout("4950000", USDC, { out: "4.74" })).slice(0, 3), ["Your Safe sends · $5.00", "Stays in Private · $0.05", "Fees · about $0.21"]);
});

test("a coin that isn't dollars: stays in its own units, the move in's cost from the quote's two dollar figures", () => {
  const l = lines(leg1("2000000000", "1990000000", SOL, { in: "200.00", out: "199.00" }), payout("1000000000", SOL, { in: "100.00", out: "99.50" }));
  assert.equal(l[0], "Your Safe sends · 2 SOL");
  assert.equal(l[1], "Stays in Private · 0.99 SOL");
  assert.equal(l[2], "Fees · about $1.50", "$1.00 moving in + $0.50 on the payout");
});

test("no usable amountOut, or one above what went in: the bytes' amountIn, as before; what stays is never negative", () => {
  for (const out of [undefined, "", "not a number", "400000000"]) {
    assert.equal(lines(leg1("300000000", out), payout("250000000"))[1], "Stays in Private · $50.00", String(out));
  }
  const l = lines(leg1("300000000", "200000000"), payout("250000000"));
  assert.equal(l[0], "Your Safe sends · $300.00");
  assert.ok(!l.some((x) => x.startsWith("Stays in Private")), "a payout above what arrives: nothing is said to stay");
});
