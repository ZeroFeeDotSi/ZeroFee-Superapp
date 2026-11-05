// QA's condition 1 on the Safe's swap in place (relay case (i) safeSwap): INTENTS in and out, into the Safe and refunded
// there, passes only for an account that runs the Safe's contract (read on chain before 1Click is asked); any other
// recipient, or a recipient that isn't its own refund, is refused and 1Click is never asked.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, createRelay, SAFE_SWAP_PER_ACCOUNT_DAY } from "./relay.mjs";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEP = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
const CODE: Record<string, { code_hash: string }> = { "kim.near": { code_hash: "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu" }, "exchange.near": { code_hash: "11111111111111111111111111111111" } };

function setup(o: { perMinute?: number } = {}) {
  let quotes = 0;
  const fetchFn = async (url: string, init: RequestInit) => {
    if (url.includes("fastnear")) {
      const id = JSON.parse(String(init.body)).params.account_id;
      return new Response(JSON.stringify(CODE[id] ? { jsonrpc: "2.0", id: 1, result: CODE[id] } : { jsonrpc: "2.0", id: 1, error: { cause: { name: "UNKNOWN_ACCOUNT" } } }), { status: 200 });
    }
    quotes++;
    return new Response(JSON.stringify({ quote: { depositAddress: DEP, amountIn: "10000000", amountInUsd: "10.00" }, quoteRequest: {} }), { status: 201 });
  };
  const relay = createRelay({ key: "k", secret: "s", origins: APP_ORIGINS, fetchFn, fastnear: "fixture-fastnear-key", ...(o.perMinute ? { quotesPerMinute: o.perMinute } : {}) });
  const ask = async (b: Record<string, unknown>) => (await relay(new Request("https://quotes.example/v0/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }), "203.0.113.9")).status;
  return { ask, quotes: () => quotes };
}
const swap = (o: Record<string, unknown> = {}) => ({
  dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, depositType: "INTENTS", destinationAsset: "nep141:wrap.near", amount: "10000000",
  refundTo: "kim.near", refundType: "INTENTS", recipient: "kim.near", recipientType: "INTENTS", confidentiality: "basic", ...o,
});

test("case (i) safeSwap: a Safe's swap in place is passed on, dry or real", async () => {
  const s = setup();
  assert.equal(await s.ask(swap()), 201);
  assert.equal(await s.ask(swap({ dry: true })), 201);
  assert.equal(s.quotes(), 2);
});

test("case (i) safeSwap: another recipient, a recipient that isn't its own refund, or a public quote is refused; 1Click isn't asked", async () => {
  const s = setup();
  for (const [why, b] of [
    ["not a Safe", swap({ recipient: "exchange.near", refundTo: "exchange.near" })],
    ["no such account", swap({ recipient: "nobody.near", refundTo: "nobody.near" })],
    ["recipient ≠ refundTo", swap({ refundTo: "exchange.near" })],
    ["recipient ≠ refundTo (a Safe refunds elsewhere)", swap({ recipient: "exchange.near" })],
    ["not confidential", swap({ confidentiality: undefined })],
    ["a chain deposit", swap({ depositType: "ORIGIN_CHAIN" })],
    ["exact output", swap({ swapType: "EXACT_OUTPUT" })],
  ] as const) assert.equal(await s.ask(b), 400, why);
  assert.equal(s.quotes(), 0);
});

test("case (i) safeSwap S2: one Safe's prices a day are its own budget; past it that Safe waits for tomorrow, 1Click isn't asked, and another Safe still gets its price (control)", async () => {
  CODE["lee.near"] = CODE["kim.near"]!;
  const s = setup({ perMinute: 10_000 });   // one address's minute isn't what this counts
  for (let i = 0; i < SAFE_SWAP_PER_ACCOUNT_DAY; i++) assert.equal(await s.ask(swap({ dry: true })), 201, `price ${i + 1}`);
  const asked = s.quotes();
  assert.equal(await s.ask(swap({ dry: true })), 429, "one more for the same Safe today");
  assert.equal(s.quotes(), asked, "1Click not asked");
  assert.equal(await s.ask(swap({ dry: true, recipient: "lee.near", refundTo: "lee.near" })), 201, "control: another Safe");
});
