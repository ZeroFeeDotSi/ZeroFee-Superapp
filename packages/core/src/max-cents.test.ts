// Builder 3 (7 Nov, on QA 16's Send Max shots v2): Check this for a Send at Max must close to the cent, rounded once.
// The shot said "Send $1,165.04", "They get · about 1,153.4 USDC", "From your Safe · $1,200.00", "Private keeps the
// rest · about $34.95", "Fees · about $11.65": $1,200.00 - $34.95 = $1,165.05, and 1,153.4 + 11.65 never reads as cents.
// Now a dollar coin's "They get" is its dollars to the cent (the quote's amountOutUsd, down), so the rows close on sight:
// From your Safe - Private keeps the rest = the title (+ the move in's own cost, a fee) and They get + Fees = the title
// (+ that same cost). Fails on main (the coin figure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { theyGet } from "./private-route.ts";
import type { IntentsFacts, QuoteFacts, SendPayout } from "./intents.ts";
import { sendFillWords } from "./send-fill.ts";

const USDC_C = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", USDC = `nep141:${USDC_C}`;
const facts = { tokens: new Map([[USDC_C, { symbol: "USDC", decimals: 6 }]]) } as unknown as IntentsFacts;
const leg1 = (amountIn: string, amountOut: string) => ({ originAsset: USDC, destinationAsset: USDC, amountIn, amountOut }) as unknown as QuoteFacts;
const payout = (amountIn: string, outUsd: string) =>
  ({ originAsset: USDC, amountIn, destinationAsset: USDC, recipient: "bob.near", recipientType: "INTENTS", amountOutUsd: outUsd }) as unknown as SendPayout;
const c = (line: string) => Math.round(Number(/\$([\d,]+\.\d\d)/.exec(line)![1]!.replace(/,/g, "")) * 100);

test("the shot's Max Send: $1,200.00 - $34.96 = $1,165.04 = $1,153.39 + $11.65, every row in whole cents", () => {
  const w = sendFillWords(leg1("1200000000", "1200000000"), payout("1165048543", "1153.39"), facts)!;
  const gets = theyGet("1,153.39 USDC", w.gets);
  assert.equal(w.title, "Send $1,165.04 to bob.near");
  assert.equal(gets, "They get · about $1,153.39", "a dollar coin's They get: its dollars, to the cent, said once");
  const [from, keeps, fees] = w.lines;
  assert.deepEqual([from, keeps, fees], ["From your Safe · $1,200.00", "Private keeps the rest · about $34.96", "Fees · about $11.65"]);
  assert.equal(c(from!) - c(keeps!), c(w.title));
  assert.equal(c(gets) + c(fees!), c(w.title));
});

test("a sweep of Max-like figures: From - keeps = title + the move in's cost = They get + Fees, to the cent", () => {
  for (let safe = 20_000_000n; safe < 3_000_000_000n; safe = (safe * 13n) / 10n + 7_777n) {
    for (const keep of [10000n, 9990n, 9970n]) for (const pay of [9709n, 9500n, 8800n]) {
      const brought = (safe * keep) / 10000n, sends = (brought * pay) / 10000n;
      const outUsd = (Number(sends) / 1e6 * 0.99).toFixed(4);
      const w = sendFillWords(leg1(String(safe), String(brought)), payout(String(sends), outUsd), facts)!;
      const gets = theyGet("x USDC", w.gets);
      const moveIn = Number(safe / 10_000n - brought / 10_000n);
      const [from, keeps, fees] = w.lines;
      const k = keeps!.startsWith("Private keeps") ? c(keeps!) : 0;
      const f = keeps!.startsWith("Private keeps") ? fees! : keeps!;
      assert.equal(c(from!) - k, c(w.title) + moveIn, `${safe} ${keep} ${pay}`);
      assert.equal(c(gets) + c(f), c(w.title) + moveIn, `${safe} ${keep} ${pay}`);
    }
  }
});

test("controls: a dollar coin with no dollars known says its coins; any other coin keeps its coins with the dollars in brackets", () => {
  assert.equal(theyGet("1,153.4 USDC"), "They get · about 1,153.4 USDC");
  assert.equal(theyGet("12 USDT", "$12.00"), "They get · about $12.00");
  assert.equal(theyGet("1.2345 SOL", "$247.50"), "They get · 1.2345 SOL (about $247.50)");
  assert.equal(theyGet("1.2345 SOL"), "They get · about 1.2345 SOL");
});
