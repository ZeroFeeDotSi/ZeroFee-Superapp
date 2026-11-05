// QA (3 Nov, fresh-account walk, 143-account-activity): the demo's Activity said "Paid · 0.09 USDC from your private balance · with"
// for a $10 Swap of USDC into the SOL row. The demo's ledger.pay recorded the quote's OUT-amount (0.09828 SOL) under the
// coin that PAID (USDC), and no payee; the real ledger records what left in the coin that left (payPrivately: amountIn,
// fromTokenId) and who got it (payeeText). The demo now records the same, for every pay it makes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";
import { describe as words, ownRows } from "@zerofee/wallet/app/format.ts";
import { ledgerRow } from "@zerofee/wallet/app/statement.ts";
import type { Movement, Token } from "@zerofee/wallet/types.ts";

const USDC_NEAR_ID = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const ROW = "T3550u3qfIy9m03P9sdhqH0IhBZB3BT0oZm1fIbf0BFM";

async function demo() {
  const mock = createMockBridge({ latencyMs: 0, hiddenStart: { usdc: "33.86", near: "0" } });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  const r = await mock.call<{ assetId: string; symbol: string; chain: string; decimals: number; priceUsd?: string }[]>("ledger.tokens");
  assert.ok("ok" in r);
  const sol = r.ok.find((t) => t.chain === "sol" && t.symbol === "SOL")!;
  const tokens = new Map<string, Token>(r.ok.map((t) => [t.assetId, { ...t, id: t.assetId } as unknown as Token]));
  return { mock, sol, tokens };
}

test("demo: a $10 Swap from your private balance into the SOL row is recorded as 10 USDC that left, to the row's address; Activity reads it as a move to your SOL row and the Statement as $10.00 (control: 0.09828 SOL read as USDC)", async () => {
  const { mock, sol, tokens } = await demo();
  const out = (10 / Number(sol.priceUsd)).toFixed(8);
  const q = await mock.call<{ id: string; amountIn: string }>("ledger.quotePay", { fromTokenId: USDC_NEAR_ID, toTokenId: sol.assetId, to: { kind: "chain", chain: "sol", address: ROW }, amountOut: out, confidential: true });
  assert.ok("ok" in q);
  const paid = await mock.call<Movement>("ledger.pay", { quoteId: q.ok.id, confidential: true });
  assert.ok("ok" in paid, JSON.stringify(paid));
  const m = paid.ok;
  assert.equal(m.from, USDC_NEAR_ID);
  assert.equal(m.amount, q.ok.amountIn, `what left is the quote's in-amount in USDC, never the SOL out-figure ${out}`);
  assert.ok(Math.abs(Number(m.amount) - 10) < 0.01, m.amount);
  assert.equal(m.to, ROW, "who got it, from this phone's own record");
  const own = ownRows([{ role: "chain", network: "sol", address: ROW }]);
  assert.deepEqual(words(m, tokens, [], own), { title: "Moving to your SOL wallet", detail: `${Number(m.amount)} USDC from your private balance · on its way to your SOL wallet` });
  const row = ledgerRow({ ...m, status: "done" }, tokens, [], own)!;
  assert.deepEqual([row.coin, row.dollars, row.way], ["USDC", Number(m.amount).toFixed(2), 0]);
  // the same move as Activity lists it, read back
  const list = await mock.call<Movement[]>("ledger.activity", { limit: 5 });
  assert.ok("ok" in list && list.ok[0]!.id === m.id && list.ok[0]!.amount === m.amount && list.ok[0]!.to === ROW);
});

test("demo: a Hidden send to bob.near names bob.near; a plain pay across two coins records what left in the paying coin", async () => {
  const { mock, sol, tokens } = await demo();
  const q = await mock.call<{ id: string; amountIn: string }>("ledger.quotePay", { fromTokenId: USDC_NEAR_ID, toTokenId: USDC_NEAR_ID, to: { kind: "ledger", accountId: "bob.near" }, amountOut: "5", confidential: true });
  assert.ok("ok" in q);
  const paid = await mock.call<Movement>("ledger.pay", { quoteId: q.ok.id, confidential: true });
  assert.ok("ok" in paid);
  assert.equal(paid.ok.to, "bob.near");
  assert.match(words({ ...paid.ok, status: "done" }, tokens, []).detail, /^5 USDC from your private balance · to bob\.near$/);
  // plain, USDC paying for SOL: the USDC that left (the quote's in-amount), never the SOL out-figure
  const out = (3 / Number(sol.priceUsd)).toFixed(8);
  const p2 = await mock.call<{ id: string; amountIn: string }>("ledger.quotePay", { fromTokenId: USDC_NEAR_ID, toTokenId: sol.assetId, to: { kind: "chain", chain: "sol", address: ROW }, amountOut: out });
  assert.ok("ok" in p2);
  const plain = await mock.call<Movement>("ledger.pay", { quoteId: p2.ok.id });
  assert.ok("ok" in plain);
  assert.deepEqual([plain.ok.from, plain.ok.amount, plain.ok.to], [USDC_NEAR_ID, p2.ok.amountIn, ROW]);
});
