import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { PayFlow } from "./pay.ts";
import { FakeLedger, USDC_NEAR } from "./testing/fake-ledger.ts";
import { REGISTRY } from "./registry.ts";
import { FIRST_MAX, PAY_WITHIN_MIN, answerArrived, capFor, checkoutTarget, ledgerFor, networksFor, recordBuy } from "./checkout.ts";

const BITREFILL = REGISTRY.find((r) => r.id === "bitrefill")!;
const BASE = "0x1144fBbD23cEc7A43A0BdA8682ed842c4E035F81";  // generated sample
const SOL = "So11111111111111111111111111111111111111112";

test("Security (a): the first purchase is a test up to $25; then $100 a purchase and $250 a week", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  assert.deepEqual(capFor(await ledgerFor(b, "bitrefill")), { max: FIRST_MAX, first: true });
  await recordBuy(b, "bitrefill", "20");
  assert.equal(capFor(await ledgerFor(b, "bitrefill")).max, "5", "the test is $25 in total until the person says one arrived");
  const old = Date.now() + 8 * 86_400_000;
  assert.equal(capFor(await ledgerFor(b, "bitrefill"), old).max, "5", "an unanswered test never ages out (Security's SHOULD)");
  await answerArrived(b, "bitrefill", false);
  assert.deepEqual(capFor(await ledgerFor(b, "bitrefill")), { max: "25", first: true }, "no keeps it a test, and clears the test's total for one more try");
  await recordBuy(b, "bitrefill", "20");
  await answerArrived(b, "bitrefill", true);
  assert.deepEqual(capFor(await ledgerFor(b, "bitrefill")), { max: "100", first: false });
  await recordBuy(b, "bitrefill", "100");
  await recordBuy(b, "bitrefill", "100");
  assert.equal(capFor(await ledgerFor(b, "bitrefill")).max, "30", "what's left of the week's $250");
  const later = Date.now() + 8 * 86_400_000;
  assert.equal(capFor(await ledgerFor(b, "bitrefill"), later).max, "100", "a week later, a purchase's cap again");
});

test("Security (b, c): only a pasted address on one of the shop's networks, an exact amount, within the window", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  assert.deepEqual(networksFor(BITREFILL, BASE), ["base", "arb", "eth"], "a 0x address: the person picks which of its EVM networks");
  assert.deepEqual(networksFor(BITREFILL, SOL), ["sol"]);
  const now = Date.now();
  const fresh = { confirmed: false, buys: [] };
  const ok = checkoutTarget(BITREFILL, { address: BASE, amount: "12.34", network: "base", copiedAt: now }, flow.tokens!, fresh, now);
  assert.ok("ok" in ok && ok.ok.amount === "12.34" && ok.ok.token.symbol === "USDC" && ok.ok.token.chain === "base" && ok.ok.name === "Bitrefill");
  const code = (p: Parameters<typeof checkoutTarget>[1], at = now) => {
    const r = checkoutTarget(BITREFILL, p, flow.tokens!, fresh, at);
    return "problem" in r ? r.problem.code : "ok";
  };
  assert.equal(code({ address: BASE, amount: "12.34", network: "base", copiedAt: now - (PAY_WITHIN_MIN * 60_000 + 1) }), "pay.checkout.late");
  assert.equal(code({ address: BASE, amount: "12.34", network: "sol", copiedAt: now }), "pay.checkout.network");
  assert.equal(code({ address: BASE, amount: "about 12", network: "base", copiedAt: now }), "pay.checkout.amount");
  assert.equal(code({ address: BASE, amount: "26", network: "base", copiedAt: now }), "pay.checkout.over-cap");
});

test("Security's MUST (a7ca3c5): two unconfirmed $15 test buys: the second is refused at $10; at $0 it waits for the answer", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const now = Date.now();
  const pay = async (amount: string) => {
    const r = checkoutTarget(BITREFILL, { address: SOL, amount, network: "sol", copiedAt: now }, flow.tokens!, await ledgerFor(b, "bitrefill"), now);
    return "problem" in r ? r.problem : "ok";
  };
  assert.equal(await pay("15"), "ok");
  await recordBuy(b, "bitrefill", "15");
  const second = await pay("15");
  assert.ok(second !== "ok" && second.code === "pay.checkout.over-cap" && /\$10 left/.test(second.whatHappened), "refused: $10 left of the test");
  await recordBuy(b, "bitrefill", "10");
  const third = await pay("1");
  assert.ok(third !== "ok" && third.code === "pay.checkout.waiting", "at $0 the test waits for the answer");
  const multi = checkoutTarget(BITREFILL, { address: BASE, amount: "1", network: "base", copiedAt: now }, flow.tokens!, { confirmed: true, buys: [] }, now);
  assert.ok("ok" in multi && multi.ok.message === "pay on Base", "a network picked among several rides on the sheet's hint");
});

test("Security's MUST 3 (61fcaef): a No clears the test once; after a second No the shop stays at $0; a Yes still confirms", async () => {
  const b = createMockBridge({ latencyMs: 0 });
  await recordBuy(b, "bitrefill", "25");
  await answerArrived(b, "bitrefill", false);
  assert.equal(capFor(await ledgerFor(b, "bitrefill")).max, "25", "one more try");
  await recordBuy(b, "bitrefill", "25");
  await answerArrived(b, "bitrefill", false);
  assert.equal(capFor(await ledgerFor(b, "bitrefill")).max, "0", "no third $25");
  await answerArrived(b, "bitrefill", true);
  assert.deepEqual(capFor(await ledgerFor(b, "bitrefill")).first, false, "a later Yes still confirms");
});
