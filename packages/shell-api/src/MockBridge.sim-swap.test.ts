// QA's Sim crawl (5 Nov): a Swap in the Sim landed no coin. Every Swap the mock prices lands the coin it priced:
// a Convert in the Safe at the sample's own prices (never a flat 0.98 of the amount in) moves both rows when it lands;
// a swap inside the NEAR wallet moves its cash and its coin, and the coin it bought is one ledger.tokens names, so Home
// lists it. Controls: a coin with no price is refused and nothing moves; a Convert declined moves nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "./MockBridge.ts";
import { FLOAT_USDC } from "./mock-float.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NEAR = "nep141:wrap.near";
const ZEC = "nep141:zec.omft.near";
type Row = { tokenId: string; held: string; amount: string; usd: string | null };
const ok = <T,>(r: { ok: T } | { problem: unknown }): T => { assert.ok("ok" in r, JSON.stringify(r)); return r.ok; };
const row = async (mock: ReturnType<typeof createMockBridge>, id: string) => ok(await mock.call<Row[]>("ledger.balances")).find((b) => b.tokenId === id && b.held === "ledger");

test("Sim: a Convert of NEAR for USDC is priced at the sample's prices and moves both rows when it lands", async () => {
  const mock = createMockBridge({ latencyMs: 0, settleMs: 0 });
  mock.on<{ id: string }>("approval.needed", (p) => void mock.call("approval.answer", { id: p.id, approve: true }));
  await mock.call("account.create", { recoveryDelaySeconds: 172_800 });
  const near0 = Number((await row(mock, NEAR))!.amount), usdc0 = Number((await row(mock, USDC))!.amount);
  const px = Number(ok(await mock.call<{ assetId: string; priceUsd?: string }[]>("ledger.tokens")).find((t) => t.assetId === NEAR)!.priceUsd);
  const q = ok(await mock.call<{ id: string; amountOut: string; minOut: string }>("ledger.quoteConvert", { from: NEAR, to: USDC, amount: "10" }));
  assert.ok(Math.abs(Number(q.amountOut) - 10 * px * 0.998) < 1e-4, `10 NEAR at $${px} less 0.2 %: ${q.amountOut}`);
  assert.notEqual(q.amountOut, (10 * 0.98).toFixed(4), "control: never the old flat 0.98 of the amount in");
  const landed = new Promise<void>((res) => mock.on<{ movement: { kind: string; status: string } }>("ledger.movementUpdated", ({ movement }) => { if (movement.kind === "convert" && movement.status === "done") res(); }));
  ok(await mock.call("ledger.convert", { quoteId: q.id }));
  await landed;
  assert.ok(Math.abs(Number((await row(mock, NEAR))!.amount) - (near0 - 10)) < 1e-6, "the NEAR paid left the Safe");
  assert.ok(Math.abs(Number((await row(mock, USDC))!.amount) - (usdc0 + Number(q.amountOut))) < 1e-6, "the USDC it priced came in");
});

test("control: no price is refused, and a declined Convert moves nothing", async () => {
  const none = createMockBridge({ latencyMs: 0 });
  const r = await none.call("ledger.quoteConvert", { from: "nep141:nobody.near", to: USDC, amount: "5" });
  assert.ok("problem" in r && /No price/.test(r.problem.whatHappened));
  const mock = createMockBridge({ latencyMs: 0, settleMs: 0, decline: true });
  const near0 = (await row(mock, NEAR))!.amount;
  const q = ok(await mock.call<{ id: string }>("ledger.quoteConvert", { from: NEAR, to: USDC, amount: "10" }));
  await mock.call("ledger.convert", { quoteId: q.id });
  await new Promise((r) => setImmediate(r));
  assert.equal((await row(mock, NEAR))!.amount, near0);
});

test("Sim: a swap inside the NEAR wallet moves its cash and its coin at the quote, and Home can name the coin", async () => {
  const mock = createMockBridge({ latencyMs: 0, float: { startUsd: 50, swapMs: 0 } });
  const units = "10000000"; // $10 of USDC
  const q = ok(await mock.call<{ amountOut: string; minAmountOut: string; symbol: string }>("subwallet.float.swapQuote", { side: "buy", coin: ZEC, amount: units }));
  const m = ok(await mock.call<{ id: string; status: string }>("subwallet.float.swap", { side: "buy", coin: ZEC, amount: units, atLeast: q.minAmountOut, key: "simswap-zec-0000001" }));
  await new Promise((r) => setTimeout(r, 5));
  const done = ok(await mock.call<{ status: string; settled?: { amountOut?: string } }>("subwallet.float.move", { id: m.id }));
  assert.equal(done.status, "done");
  assert.equal(done.settled?.amountOut, q.amountOut, "what landed is what it quoted");
  const held = new Map(ok(await mock.call<{ tokens: { tokenId: string; amount: string }[] }>("subwallet.float.balance")).tokens.map((t) => [t.tokenId, t.amount]));
  assert.equal(held.get(FLOAT_USDC), String(40_000_000), "the $10 left the NEAR wallet's cash");
  assert.equal(held.get(ZEC), q.amountOut, "the ZEC came in");
  const zec = ok(await mock.call<{ assetId: string; symbol: string; priceUsd?: string; decimals: number }[]>("ledger.tokens")).find((t) => t.assetId === ZEC);
  assert.ok(zec && zec.symbol === "ZEC" && Number(zec.priceUsd) > 0 && zec.decimals === 8, "Home names and prices the coin it holds");
});
