// QA's real-money lap (5 Nov): a NEAR Intents Buy at $1-2 read "1Click gave no price" while
// 1Click's own dry quote answered. The cause: the live relay (deployed from main) has no Safe-swap case (i) yet, so it
// refused the quote itself ("quotes.request.refused"), and the app said that as 1Click's. Now a refusal by ZeroFee's own
// price server is said as ours, by name (rule 8); 1Click's own refusal stays 1Click's (control).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProblemError } from "@zerofee/core/problem";
import { createApis, QuoteRefused } from "./apis.ts";
import { ledgerSwap, quoteRefusedProblem, SWAP_USDC } from "./intents-swap.ts";

const RELAY = "https://relay.example";
const NEAR = "nep141:wrap.near";

/** The ledger's real Safe swap (ledgerSwap: its dryQuote over the real apis), with a fetch that answers `answer`. */
function safeQuote(answer: () => Response, relayed: string | null = RELAY) {
  const apis = createApis((async () => answer()) as typeof fetch);
  const s = ledgerSwap({
    apis, ...(relayed ? { relayed } : {}),
    myAccount: async () => ({ accountId: "safe.near" }),
    chain: { view: async () => "100000000", account: async () => null, commonBlock: async () => ({}) },
    catalogue: async () => ({ coin: (id: string) => (id === SWAP_USDC ? { decimals: 6, symbol: "USDC" } : id === NEAR ? { decimals: 24, symbol: "wNEAR" } : undefined) }),
    now: () => 0, iso: () => "2026-11-05T00:00:00.000Z", trackQuote: () => undefined,
  } as never);
  return s.swapQuote({ from: SWAP_USDC, to: NEAR, amountIn: "1", source: "safe" }, "trade" as never);
}
const said = async (p: Promise<unknown>) => { try { await p; return "answered"; } catch (e) { return e instanceof ProblemError ? `${e.problem.code}|${e.problem.whatHappened}|${e.problem.money.state}` : String(e); } };

test("the relay's own refusal (no Safe-swap case on the live relay) is ZeroFee's price server's, never 1Click's", async () => {
  const relay400 = () => new Response(JSON.stringify({ code: "quotes.request.refused", whatHappened: "This relay passes on only ZeroFee's own private quotes and payments." }), { status: 400 });
  const r = await said(safeQuote(relay400));
  assert.match(r, /^ledger\.swap\.server-refused\|ZeroFee's price server didn't pass on this swap\. Nothing moved\./);
  assert.doesNotMatch(r, /1Click/, "never blames 1Click for ours");
});

test("no relay in this build: ours too, by name", async () => {
  assert.match(await said(safeQuote(() => new Response("{}"), null)), /^ledger\.swap\.server-refused\|ZeroFee's price server/);
});

test("control: 1Click's own refusal (no quote, its message) stays 1Click's; a priced answer passes", async () => {
  const oneClick400 = () => new Response(JSON.stringify({ message: "Amount is too low for bridge, try at least 1500000" }), { status: 400 });
  const r = await said(safeQuote(oneClick400));
  assert.match(r, /^ledger\.quote\.unavailable\|NEAR Intents gave no price right now/);
  const priced = () => new Response(JSON.stringify({ quote: { amountIn: "1000000", amountOut: "6000000", minAmountOut: "5900000", timeEstimate: 12 } }), { status: 200 });
  assert.equal(await said(safeQuote(priced)), "answered");
  assert.equal(quoteRefusedProblem(new QuoteRefused("x", "quotes.request.too-big")).code, "ledger.swap.server-refused");
  assert.equal(quoteRefusedProblem(new QuoteRefused("x")).code, "ledger.quote.unavailable", "control: no code is 1Click's");
});
