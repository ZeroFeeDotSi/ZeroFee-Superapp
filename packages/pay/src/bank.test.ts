import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { BANK_CEILING, billFor, markBankPaid, paidLabel, payInTarget } from "./bank.ts";
import { groupIban, readIban, shortIban } from "./codes/iban.ts";
import { readPayCode } from "./codes/parse.ts";
import { PayFlow, type Step } from "./pay.ts";
import { RECORDED_TOKENS } from "./testing/recorded-tokens.ts";
import { TokenDirectory } from "./tokens.ts";

const tokens = new TokenDirectory(RECORDED_TOKENS);
const IBAN = "DE89370400440532013000";
const epc = (amount = "EUR20.00", iban = "DE89 3704 0044 0532 0130 00") => ["BCD", "002", "1", "SCT", "COBADEFFXXX", "Bakery GmbH", iban, amount, "", "", "Rechnung 5"].join("\n");
const MT_PELERIN = "0x7c1a00000000000000000000000000000000009e";
const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};
const bill = () => {
  const code = readPayCode(epc());
  assert.ok(code.kind === "bank");
  return billFor(code.bank, code.bank.amount!, tokens)!;
};

test("an IBAN is kept only when its own check digits hold", () => {
  assert.equal(readIban("de89 3704 0044 0532 0130 00"), IBAN);
  assert.equal(readIban("DE88370400440532013000"), undefined, "one digit off");
  assert.equal(readIban("not an iban"), undefined);
  assert.equal(groupIban(IBAN), "DE89 3704 0044 0532 0130 00");
  assert.equal(shortIban(IBAN), "DE89 …3000");
});

test("a SEPA QR and a Swiss QR-bill keep the account they pay; a bad IBAN keeps none, so the code stays card-only", () => {
  const sepa = readPayCode(epc());
  assert.ok(sepa.kind === "bank");
  assert.deepEqual(sepa.bank.account, { iban: IBAN, bic: "COBADEFFXXX" });
  const broken = readPayCode(epc("EUR20.00", "DE88370400440532013000"));
  assert.ok(broken.kind === "bank" && broken.bank.account === undefined);
  const ch = readPayCode(["SPC", "0200", "1", "CH4431999123000889012", "S", "Velo AG", "", "", "", "", "CH", "", "", "", "", "", "", "", "49.50", "EUR"].join("\n"));
  assert.ok(ch.kind === "bank" && ch.bank.account?.iban === "CH4431999123000889012");
});

test("the bill: its euros at today's rate from 1Click, and a fixed ceiling of 5% over it", () => {
  const b = bill();
  // RECORDED_TOKENS price EURe at 1.12 dollars.
  assert.deepEqual([b.amount, b.currency, b.estimate, b.ceiling, b.label, b.reference], ["20.00", "EUR", "22.40", "23.52", "Bakery GmbH", "Rechnung 5"]);
  assert.equal(BANK_CEILING, "1.05");
  const ch = readPayCode(["SPC", "0200", "1", "CH4431999123000889012", "S", "Velo AG", "", "", "", "", "CH", "", "", "", "", "", "", "", "49.50", "CHF"].join("\n"));
  assert.ok(ch.kind === "bank");
  assert.equal(billFor(ch.bank, "49.50", tokens), null, "francs have no rate in the token list: card-only");
  assert.equal(billFor({ ...ch.bank, currency: "EUR" }, "1", new TokenDirectory(RECORDED_TOKENS.filter((t) => t.symbol !== "EURe"))), null, "no rate, no bill");
});

test("paying Mt Pelerin: a pasted address and its USDC, on Base, as the address you pasted for Mt Pelerin", () => {
  const t = payInTarget(` ${MT_PELERIN} `, "21.86", bill(), tokens);
  assert.ok("ok" in t, JSON.stringify(t));
  assert.deepEqual([t.ok.to, t.ok.token.symbol, t.ok.token.blockchain ?? t.ok.token.chain, t.ok.amount, t.ok.name, t.ok.message], [
    { kind: "chain", chain: "base", address: MT_PELERIN }, "USDC", "base", "21.86", "Address you pasted for Mt Pelerin", "20.00 EUR to DE89 …3000",
  ]);
});

test("Mt Pelerin's own payment link fills the network, address and amount at once", () => {
  const link = `ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=${MT_PELERIN}&uint256=21860000`;
  const t = payInTarget(link, undefined, bill(), tokens);
  assert.ok("ok" in t, JSON.stringify(t));
  assert.equal(t.ok.amount, "21.86");
  assert.equal(t.ok.to.kind === "chain" && t.ok.to.address, MT_PELERIN);
});

test("Pay never sends Mt Pelerin more than the bill's ceiling, the wrong coin, or to a network it doesn't take", () => {
  const over = payInTarget(MT_PELERIN, "23.53", bill(), tokens);
  assert.ok("problem" in over && over.problem.code === "pay.bank.too-much");
  assert.match(over.problem.more ?? "", /about 22\.40 USDC.*at most 23\.52 USDC/);
  assert.ok("ok" in payInTarget(MT_PELERIN, "23.52", bill(), tokens), "the ceiling itself is allowed");
  const usdt = payInTarget(`ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7@1/transfer?address=${MT_PELERIN}&uint256=21860000`, undefined, bill(), tokens);
  assert.ok("problem" in usdt && usdt.problem.code === "pay.cashout.mismatch");
  const sol = payInTarget("13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", "21", bill(), tokens);
  assert.ok("problem" in sol && sol.problem.code === "pay.cashout.mismatch");
  const none = payInTarget(MT_PELERIN, "", bill(), tokens);
  assert.ok("problem" in none && none.problem.code === "pay.amount.needed");
});

test("scanning a SEPA QR is a bill for Pay's bank screens; one with no amount asks for it in euros", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5 }) });
  assert.equal(kind(await flow.read(epc()), "bank").bill.estimate, "22.40");
  const ask = kind(await flow.read(epc("")), "ask");
  assert.deepEqual([ask.field, ask.symbol], ["amount", "EUR"]);
  assert.equal(kind(await flow.answer({ amount: "5" }), "bank").bill.amount, "5.00");
  const pix = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";
  assert.equal(kind(await flow.read(pix), "problem").problem.code, "pay.code.bank-only", "a proxy code stays card-only");
  flow.close();
});

test("D17: when protection holds the USDC to Mt Pelerin, it's on hold (holdSeconds), never sent or paid", async () => {
  const flow = new PayFlow({ bridge: createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5, holdSeconds: 120 }) });
  const small = kind(await flow.read(epc("EUR10.00")), "bank").bill;
  const t = payInTarget(MT_PELERIN, "11.50", small, flow.tokens!);
  assert.ok("ok" in t, JSON.stringify(t));
  kind(await flow.send(t.ok), "confirm");
  const held = kind(await flow.confirm(), "held");
  assert.equal(held.movement.status, "waiting");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(flow.stopwatch.read().paid, undefined, "nothing settles while it's held");
  flow.close();
});

test("Activity's words once the person says Mt Pelerin told them: never a payment Pay saw", () => {
  assert.equal(paidLabel(bill()), "Paid · Mt Pelerin told you: 20.00 EUR to DE89 …3000");
  assert.ok(paidLabel(bill()).length <= 60, "fits the ledger's label");
});

test("once the person says Mt Pelerin paid it, Activity's row reads Paid · Mt Pelerin told you (ledger.relabel)", async () => {
  const bridge = createMockBridge({ tokens: RECORDED_TOKENS, latencyMs: 0, settleMs: 5 });
  const flow = new PayFlow({ bridge });
  const small = kind(await flow.read(epc("EUR10.00")), "bank").bill;
  const t = payInTarget(MT_PELERIN, "11.50", small, flow.tokens!);
  assert.ok("ok" in t);
  kind(await flow.send(t.ok), "confirm");
  let step = await flow.confirm();
  if (step.kind === "sent") step = await flow.settle(step);
  const paid = kind(step, "paid");
  assert.equal(await markBankPaid(bridge, paid.movement.id, small), true);
  const activity = await bridge.call<{ id: string; label?: string }[]>("ledger.activity");
  assert.ok("ok" in activity);
  assert.equal(activity.ok.find((m) => m.id === paid.movement.id)?.label, "Paid · Mt Pelerin told you: 10.00 EUR to DE89 …3000");
  assert.equal(await markBankPaid(bridge, "mv-not-mine", small), false, "an unknown movement is refused, nothing changed");
  flow.close();
});
