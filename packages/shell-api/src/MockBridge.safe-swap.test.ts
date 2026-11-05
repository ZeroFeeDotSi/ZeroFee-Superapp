// The Sim's Native coins Buy and Sell (product decision, 5 Nov on a Buy): ledger.swapQuote prices at the
// page's own price, ledger.swap goes on the tap (no Check this sheet), lands as a job and moves the Safe's rows. Control: a price-less
// quote and an expired one say so and move nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const RHEA = "nep141:token.rhealab.near";

test("Sim: a Safe buy and its sale land in one tap (no Check this sheet), the rows move", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  let asked = 0;
  mock.on<{ id: string }>("approval.needed", (p) => { asked++; void mock.call("approval.answer", { id: p.id, approve: true }); });
  assert.ok("ok" in (await mock.call("account.create", { recoveryDelaySeconds: 172_800 })));
  const usdcBefore = Number(((await mock.call<{ tokenId: string; held: string; amount: string }[]>("ledger.balances")) as { ok: { tokenId: string; held: string; amount: string }[] }).ok.find((b) => b.tokenId === USDC && b.held === "ledger")!.amount);
  const q = await mock.call<{ id: string; amountOut: string; feeUsd: string; etaSeconds: number }>("ledger.swapQuote", { from: USDC, to: RHEA, amountIn: "25", source: "safe", priceUsd: 0.05, symbol: "RHEA", name: "RHEA" });
  assert.ok("ok" in q, JSON.stringify(q));
  assert.ok(Math.abs(Number(q.ok.amountOut) - 499.5) < 0.01, q.ok.amountOut);
  const landed = new Promise<{ status: string }>((res) => mock.on<{ movement: { status: string; kind: string } }>("ledger.movementUpdated", ({ movement }) => { if (movement.kind === "swap" && movement.status === "done") res(movement); }));
  const s = await mock.call<{ status: string; kind: string }>("ledger.swap", { quoteId: q.ok.id });
  assert.ok("ok" in s && s.ok.kind === "swap" && s.ok.status === "moving", JSON.stringify(s));
  assert.equal((await landed).status, "done");
  const rows = ((await mock.call("ledger.balances")) as { ok: { tokenId: string; held: string; amount: string }[] }).ok;
  assert.ok(Math.abs(Number(rows.find((b) => b.tokenId === RHEA)!.amount) - 499.5) < 0.01, "the coin is in the Safe");
  assert.ok(Math.abs(Number(rows.find((b) => b.tokenId === USDC && b.held === "ledger")!.amount) - (usdcBefore - 25)) < 0.001, "the USDC paid left it");
  const sell = await mock.call<{ id: string; amountOut: string }>("ledger.swapQuote", { from: RHEA, to: USDC, amountIn: "100", source: "safe", priceUsd: 0.05, symbol: "RHEA" });
  assert.ok("ok" in sell && Math.abs(Number(sell.ok.amountOut) - 4.995) < 0.001, JSON.stringify(sell));
  assert.ok("ok" in (await mock.call("ledger.swap", { quoteId: sell.ok.id })));
  assert.equal(asked, 0, "one tap: no approval sheet in the Sim");
});

test("control: no price, or a used quote, moves nothing and says so", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
  const none = await mock.call("ledger.swapQuote", { from: USDC, to: "nep141:unknown.near", amountIn: "5", source: "safe" });
  assert.ok("problem" in none && /No price/.test(none.problem.whatHappened));
  const q = await mock.call<{ id: string }>("ledger.swapQuote", { from: USDC, to: RHEA, amountIn: "5", source: "safe", priceUsd: 0.05 });
  assert.ok("ok" in q);
  assert.ok("ok" in (await mock.call("ledger.swap", { quoteId: q.ok.id })));
  const again = await mock.call("ledger.swap", { quoteId: q.ok.id });
  assert.ok("problem" in again && /too old/.test(again.problem.whatHappened), "a quote is used once");
});
