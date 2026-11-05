import { test } from "node:test";
import assert from "node:assert/strict";
import { ContactBook } from "./contacts.ts";
import { PayFlow } from "./pay.ts";
import type { Step } from "./pay.ts";
import { findRecipient, targetForSend } from "./send.ts";
import { FakeLedger, USDC_NEAR, USDC_SOL, USDT_NEAR } from "./testing/fake-ledger.ts";

const SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const EVM = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";

function ledger(balances: Record<string, string> = { [USDC_NEAR]: "100" }) {
  return new FakeLedger({
    accountId: "me.near",
    balances,
    recipients: {
      "alex.zerofee.near": { exists: true, hasLedgerBalance: true },
      "sam.near": { exists: true, hasLedgerBalance: false },
    },
  });
}

const kind = <K extends Step["kind"]>(s: Step, k: K) => {
  assert.equal(s.kind, k, JSON.stringify(s));
  return s as Extract<Step, { kind: K }>;
};

test("a ZeroFee friend by name: an instant transfer inside the ledger", async () => {
  const bridge = ledger();
  const found = await findRecipient(bridge, "Alex.ZeroFee.near ");
  assert.deepEqual(found, { ok: { recipient: { kind: "ledger", accountId: "alex.zerofee.near" } } });

  const flow = new PayFlow({ bridge });
  await flow.warm();
  const t = targetForSend((found as { ok: { recipient: never } }).ok.recipient, flow.tokens!.byAsset(USDC_NEAR)!, "20", flow.tokens!);
  assert.ok("ok" in t);
  const confirm = kind(await flow.send(t.ok, USDC_NEAR), "confirm").confirm;
  assert.equal(confirm.source.route, "transfer");
  kind(await flow.confirm(), "paid");
  assert.equal(bridge.received.get("ledger:alex.zerofee.near")?.get(USDC_NEAR), "20");
  assert.equal(bridge.balance(USDC_NEAR), "80", "the friend gets exactly 20; NEAR's network fee is paid in NEAR, not USDC");
});

test("any other NEAR account: paid out to their NEAR wallet", async () => {
  const bridge = ledger();
  const found = await findRecipient(bridge, "sam.near");
  assert.deepEqual(found, { ok: { recipient: { kind: "near-wallet", accountId: "sam.near" } } });
  const flow = new PayFlow({ bridge });
  await flow.warm();
  const t = targetForSend({ kind: "near-wallet", accountId: "sam.near" }, flow.tokens!.byAsset(USDC_NEAR)!, "5", flow.tokens!);
  assert.ok("ok" in t);
  assert.deepEqual(t.ok.to, { kind: "chain", chain: "near", address: "sam.near" });
  assert.equal(t.ok.token.assetId, USDC_NEAR);
});

test("a name that doesn't exist, or your own, is caught before any approval", async () => {
  const bridge = ledger();
  assert.equal((await findRecipient(bridge, "nobody.near") as { problem: { code: string } }).problem.code, "pay.send.recipient-missing");
  assert.equal((await findRecipient(bridge, "me.near", { self: "me.near" }) as { problem: { code: string } }).problem.code, "pay.send.recipient-self");
  assert.equal((await findRecipient(bridge, "not an address") as { problem: { code: string } }).problem.code, "pay.send.recipient-invalid");
});

test("grade 01c P2: a 64-hex implicit account not on chain yet is still a NEAR wallet (the first NEAR makes it)", async () => {
  const hex = "a".repeat(64);
  assert.deepEqual(await findRecipient(ledger(), hex), { ok: { recipient: { kind: "near-wallet", accountId: hex } } });
});

test("until the ledger can check names, a NEAR name is paid out to the NEAR wallet", async () => {
  const bridge = ledger();
  bridge.failNext("ledger.recipientInfo", { code: "security.method.unknown", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "nothing", label: "Go back" } });
  assert.deepEqual(await findRecipient(bridge, "alex.zerofee.near"), { ok: { recipient: { kind: "near-wallet", accountId: "alex.zerofee.near" } } });
});

test("USDC sent to a Solana address arrives as USDC on Solana, paid from NEAR USDC", async () => {
  const bridge = ledger();
  const found = await findRecipient(bridge, SOL);
  assert.ok("ok" in found);
  assert.deepEqual(found.ok.recipient, { kind: "address", chain: "sol", candidates: ["sol"], address: SOL });
  const flow = new PayFlow({ bridge, anyCoin: true });
  await flow.warm();
  const t = targetForSend(found.ok.recipient, flow.tokens!.byAsset(USDC_NEAR)!, "10", flow.tokens!);
  assert.ok("ok" in t);
  assert.equal(t.ok.token.assetId, USDC_SOL);
  const sent = kind(await flow.send(t.ok, USDC_NEAR), "confirm");
  assert.ok(Number(sent.confirm.feeUsd) > 0, "the fee to send it out is shown");
  await flow.settle(kind(await flow.confirm(), "sent"));
  assert.equal(bridge.received.get(`sol:${SOL}`)?.get(USDC_SOL), "10", "the friend gets exactly what was typed");
});

test("an EVM address asks which network, and a coin missing there is named", async () => {
  const bridge = ledger({ [USDT_NEAR]: "50" });
  const found = await findRecipient(bridge, EVM);
  assert.ok("ok" in found && found.ok.recipient.kind === "address" && found.ok.recipient.chain === null);
  const flow = new PayFlow({ bridge });
  await flow.warm();
  const usdt = flow.tokens!.byAsset(USDT_NEAR)!;
  const ask = targetForSend(found.ok.recipient, usdt, "5", flow.tokens!);
  assert.ok("problem" in ask && ask.ask === "network");
  const onBase = targetForSend(found.ok.recipient, usdt, "5", flow.tokens!, { network: "base" });
  assert.ok("problem" in onBase && onBase.problem.code === "pay.code.coin-unsupported", "the recorded list has no USDT on Base");
  const onArb = targetForSend(found.ok.recipient, flow.tokens!.byAsset(USDC_NEAR)!, "5", flow.tokens!, { network: "arb" });
  assert.ok("ok" in onArb && onArb.ok.token.symbol === "USDC" && onArb.ok.token.chain === "arb");
});

test("contacts stay on the phone, search as you type, and a damaged copy is never wiped", async () => {
  const bridge = ledger();
  const opened = await ContactBook.open(bridge, () => "2026-10-25T06:00:00.000Z");
  assert.ok("ok" in opened);
  const book = opened.ok;
  const alex = await book.add("Alex", { kind: "ledger", accountId: "alex.zerofee.near" });
  assert.ok("ok" in alex);
  await book.add("Sam", { kind: "near-wallet", accountId: "sam.near" });
  await book.add("Alex B", { kind: "ledger", accountId: "alex.zerofee.near" });
  assert.equal(book.list().length, 2, "the same destination is one contact, renamed");
  assert.deepEqual(book.search("zerofee").map((c) => c.name), ["Alex B"]);
  assert.deepEqual((await findRecipient(bridge, "alex b", { contacts: book }) as { ok: { contactId: string } }).ok.contactId, alex.ok.id);
  await book.markPaid(alex.ok.id);
  assert.equal(book.list()[0].name, "Alex B", "most recently paid first");

  const reopened = await ContactBook.open(bridge);
  assert.ok("ok" in reopened && reopened.ok.list().length === 2, "saved through device.store");
  assert.ok(bridge.calls.filter((c) => c.method.startsWith("device.")).every((c) => c.params?.key === "contacts.v1"));

  bridge.store.set("contacts.v1", "{not json");
  const damaged = await ContactBook.open(bridge);
  assert.ok("problem" in damaged && damaged.problem.code === "pay.device.storage-unreadable");
  assert.equal(bridge.store.get("contacts.v1"), "{not json", "left as it was");
});

test("a saved friend is shown by their name, never as a name a code gave itself", async () => {
  const bridge = ledger();
  const flow = new PayFlow({ bridge });
  await flow.warm();
  const t = targetForSend({ kind: "ledger", accountId: "alex.zerofee.near" }, flow.tokens!.byAsset(USDC_NEAR)!, "20", flow.tokens!);
  assert.ok("ok" in t);
  const step = await flow.send({ ...t.ok, name: "Alex" }, USDC_NEAR);
  assert.ok(step.kind === "confirm");
  assert.equal(step.confirm.payee, "Alex");
  assert.equal(step.confirm.payeeFull, "alex.zerofee.near");
  assert.equal(step.confirm.labelFromCode, false);
});
