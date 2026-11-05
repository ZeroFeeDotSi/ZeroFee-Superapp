import { test } from "node:test";
import assert from "node:assert/strict";
import { compare } from "./amount.ts";
import { PayFlow } from "./pay.ts";
import type { Step } from "./pay.ts";
import { FakeLedger, USDC_BASE, USDC_NEAR, USDC_SOL, USDT_NEAR, WNEAR } from "./testing/fake-ledger.ts";
import type { FakeLedgerOptions } from "./testing/fake-ledger.ts";
import { emv, field as f } from "./testing/emv.ts";
import { requestLink } from "./request.ts";
import { targetForSend } from "./send.ts";

const SHOP_SOL = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
const SHOP_EVM = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
const SOL_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

/** Most tests exercise paying from any coin; the default (off until the mainnet proof) has its own tests below. */
function setup({ anyCoin = true, ...options }: Partial<FakeLedgerOptions> & { balances: Record<string, string>; anyCoin?: boolean }) {
  const ledger = new FakeLedger({ accountId: "me.near", ...options });
  const flow = new PayFlow({ bridge: ledger, anyCoin });
  return { ledger, flow };
}

function expectKind<K extends Step["kind"]>(step: Step, kind: K): Extract<Step, { kind: K }> {
  assert.equal(step.kind, kind, JSON.stringify(step, null, 1));
  return step as Extract<Step, { kind: K }>;
}

test("scan a Solana Pay code, pay it from NEAR USDC, and the shop gets exactly what it asked for", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "50", [WNEAR]: "3" } });
  assert.equal(await flow.warm(), null);
  const confirm = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}&label=Kiosk`), "confirm").confirm;

  assert.equal(confirm.source.balance.tokenId, USDC_NEAR, "the same coin on another chain beats wNEAR");
  assert.equal(confirm.payee, "Kiosk");
  assert.equal(confirm.labelFromCode, true, "the shop's name came from the code, so it's shown as unchecked");
  assert.equal(confirm.network, "Solana");
  assert.equal(confirm.target.amount, "4.2");
  assert.ok(confirm.feeUsd && Number(confirm.feeUsd) > 0.27, `the Solana withdraw fee is shown before paying (${confirm.feeUsd})`);
  assert.ok(Number(confirm.maxIn) >= Number(confirm.expectedIn));
  assert.equal(confirm.etaSeconds, 7);

  const sent = expectKind(await flow.confirm(), "sent");
  const paid = expectKind(await flow.settle(sent), "paid");
  assert.equal(paid.movement.status, "done");
  assert.equal(ledger.received.get(`sol:${SHOP_SOL}`)?.get(USDC_SOL), "4.2");
  const spent = 50 - Number(ledger.balance(USDC_NEAR));
  assert.ok(Math.abs(spent - Number(confirm.expectedIn)) < 1e-9, "the unused buffer came back");

  const quotes = ledger.calls.filter((c) => c.method === "ledger.quotePay");
  assert.equal(quotes.length, 1, "one quote, no second round trip");
  assert.deepEqual(ledger.calls.find((c) => c.method === "ledger.pay")?.params, { quoteId: confirm.quote!.id, label: "Kiosk" }, "Activity can say who was paid");
  assert.deepEqual(quotes[0].params, { fromTokenId: USDC_NEAR, toTokenId: USDC_SOL, to: { kind: "chain", chain: "sol", address: SHOP_SOL }, amountOut: "4.2" });

  const t = flow.stopwatch.read();
  assert.ok(t.quoted <= t.ready && t.ready <= t.sent && t.sent <= t.paid, JSON.stringify(t));
});

test("a link's own label reaches Confirm as the code's words, never as a contact's name", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "100" }, anyCoin: false });
  await flow.warm();
  const t = targetForSend({ kind: "near-wallet", accountId: "evil.near" }, flow.tokens!.byAsset(USDC_NEAR)!, "50", flow.tokens!);
  assert.ok("ok" in t);
  const c = expectKind(await flow.send({ ...t.ok, label: "Mum" }, USDC_NEAR), "confirm").confirm;
  assert.equal(c.payee, "Mum");
  assert.equal(c.labelFromCode, true, "shown as 'The code says it's Mum'");
});

test("holding the very coin asked for: it pays with that, no conversion", async () => {
  const { flow } = setup({ balances: { [USDC_BASE]: "20", [USDC_NEAR]: "500" } });
  const confirm = expectKind(await flow.read(`ethereum:${BASE_USDC}@8453/transfer?address=${SHOP_EVM}&uint256=12.5e6`), "confirm").confirm;
  assert.equal(confirm.source.balance.tokenId, USDC_BASE);
  assert.equal(confirm.source.sameCoin, true);
  assert.equal(confirm.target.amount, "12.5", "base units became 12.5 USDC with the coin's 6 decimals");
  assert.equal(confirm.alternatives[0].balance.tokenId, USDC_NEAR, "the other USDC is offered under Pay with…");
});

test("a request from a ZeroFee friend moves inside the ledger: no quote, no fee, done at once", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  const link = requestLink({ to: "alex.near", amount: "12.5", token: USDC_NEAR, note: "Dinner", ref: "k3x9" });
  const confirm = expectKind(await flow.read(link), "confirm").confirm;
  assert.equal(confirm.source.route, "transfer");
  assert.equal(confirm.feeUsd, undefined, "no number for NEAR's own network fee until a real transfer measures it");
  assert.equal(confirm.network, "ZeroFee");
  const paid = expectKind(await flow.confirm(), "paid");
  assert.equal(paid.movement.kind, "transfer");
  assert.equal(ledger.calls.some((c) => c.method === "ledger.quotePay"), false);
  assert.deepEqual(ledger.calls.find((c) => c.method === "ledger.transfer")?.params, { tokenId: USDC_NEAR, amount: "12.5", toAccountId: "alex.near", memo: "k3x9", label: "alex.near: Dinner" });
  assert.equal(ledger.received.get("ledger:alex.near")?.get(USDC_NEAR), "12.5");
});

test("a bare EVM address asks for the network, then the amount", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  const ask = expectKind(await flow.read(SHOP_EVM), "ask");
  assert.equal(ask.field, "network");
  assert.ok(ask.networks?.includes("base"));
  assert.equal(ask.problem.code, "pay.code.network-needed");
  const askAmount = expectKind(await flow.answer({ network: "base" }), "ask");
  assert.equal(askAmount.field, "amount", "a bare address names no amount");
  // A bare address asks for the chain's own coin (ETH on Base): USDC pays it through a conversion.
  const confirm = expectKind(await flow.answer({ amount: "0.01" }), "confirm").confirm;
  assert.equal(confirm.target.token.symbol, "ETH");
  assert.equal(confirm.source.balance.tokenId, USDC_NEAR);
  // 1 ETH is far more than 40 USDC.
  assert.equal(expectKind(await flow.answer({ amount: "1" }), "problem").problem.code, "pay.funds.short");
});

test("a bank QR gets an honest answer and the card as the next step", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  const qr = emv(f("00", "01"), f("01", "12"), f("26", f("00", "br.gov.bcb.pix") + f("01", "loja@pix.example")), f("53", "986"), f("54", "35.90"), f("58", "BR"), f("59", "PADARIA BOA"));
  const p = expectKind(await flow.read(qr), "problem").problem;
  assert.equal(p.code, "pay.code.bank-only");
  assert.equal(p.whatHappened, "This is a PIX bank code.");
  assert.equal(p.more, "You pay bank codes with your card. It asks for 35.90 BRL.");
  assert.deepEqual(p.next, { kind: "open", label: "Pay with my card", screen: "card" });
  assert.deepEqual(p.money, { state: "safe", where: "in your Safe" }, "the Problem screen says the money hasn't moved");
});

test("not enough of anything: one plain Problem, and the way to add money", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "3" } });
  const p = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "problem").problem;
  assert.equal(p.code, "pay.funds.short");
  assert.deepEqual(p.next, { kind: "open", label: "Add money", screen: "cash-in" });
});

test("saying no on the approval sheet goes back to the same screen; nothing moved", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  ledger.declineNext();
  const back = expectKind(await flow.confirm(), "confirm");
  assert.equal(ledger.balance(USDC_NEAR), "40");
  assert.equal(back.confirm.target.amount, "4.2");
  expectKind(await flow.confirm(), "sent");
});

test("a quote that ran out is refreshed by itself when it asks no more", async () => {
  let now = Date.parse("2026-10-25T06:00:00Z");
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "40" }, now: () => now });
  const flow = new PayFlow({ bridge: ledger, now: () => now, anyCoin: true });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  now += 120_000;
  expectKind(await flow.confirm(), "sent");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.quotePay").length, 2);
});

test("Pay with… is remembered on this phone and used first next time", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40", [USDT_NEAR]: "40" } });
  const code = `solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`;
  assert.equal(expectKind(await flow.read(code), "confirm").confirm.source.balance.tokenId, USDC_NEAR);
  assert.equal(expectKind(await flow.payWith(USDT_NEAR), "confirm").confirm.source.balance.tokenId, USDT_NEAR);
  assert.equal(ledger.store.get("pay-with"), USDT_NEAR);

  const again = new PayFlow({ bridge: ledger, anyCoin: true });
  assert.equal(expectKind(await again.read(code), "confirm").confirm.source.balance.tokenId, USDT_NEAR);
});

test("when the first coin can't be priced, the next one is tried", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40", [USDT_NEAR]: "40" } });
  ledger.failNext("ledger.quotePay", { code: "ledger.quote.unavailable", whatHappened: "x", money: { state: "not-involved" }, next: { kind: "retry", label: "Try again" } });
  const confirm = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.equal(confirm.source.balance.tokenId, USDT_NEAR);
});

test("a restaurant's order-and-pay page opens in the browser sheet", async () => {
  const { flow } = setup({ balances: {} });
  assert.deepEqual(await flow.read("https://order.example/table/12"), { kind: "open", url: "https://order.example/table/12" });
});

test("paying yourself is caught", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  assert.equal(expectKind(await flow.read("near:me.near?amount=1"), "problem").problem.code, "pay.send.recipient-self");
  assert.equal(expectKind(await flow.read(requestLink({ to: "me.near", amount: "1" })), "problem").problem.code, "pay.send.recipient-self");
});

test("a slow network ends in a plain 'still on its way', never silence", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" }, settleMs: 10_000 });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}&label=Kiosk`);
  const sent = expectKind(await flow.confirm(), "sent");
  const slow = expectKind(await flow.settle(sent, 20), "problem").problem;
  assert.equal(slow.code, "pay.payment.slow");
  assert.equal(slow.money.state, "on-the-way");
});

test("the phone's own work, from scan to the confirm screen, takes milliseconds", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "50", [USDT_NEAR]: "50", [WNEAR]: "10" } });
  await flow.warm();
  const t0 = performance.now();
  expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "confirm");
  const ms = performance.now() - t0;
  assert.ok(ms < 50, `${ms.toFixed(1)} ms without the network; the real quote adds about a second`);
});

test("a broken request link says so plainly", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  assert.equal(expectKind(await flow.read("zerofee:pay?v=1&to=alex.near&amount=-3"), "problem").problem.code, "pay.request.invalid");
});

test("a payment that lands before the screen starts waiting is still seen as paid", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  const sent = expectKind(await flow.confirm(), "sent");
  await new Promise((r) => setTimeout(r, 5)); // the fake lands it on the next tick
  expectKind(await flow.settle(sent, 50), "paid");
  flow.close();
});

test("until the 1Click funding proof, only the coin asked for pays, and the screen says which coin", async () => {
  const off = setup({ balances: { [USDC_NEAR]: "50" }, anyCoin: false });
  const p = expectKind(await off.flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "problem").problem;
  assert.equal(p.code, "pay.route.coin-needed");
  assert.equal(p.whatHappened, "This needs USDC on Solana, and you don't hold enough of it.");
  assert.deepEqual(p.next, { kind: "open", label: "Pay with my card", screen: "card" });
  assert.equal(off.ledger.calls.some((c) => c.method === "ledger.quotePay"), false, "no quote that couldn't be paid");

  const same = setup({ balances: { [USDC_SOL]: "10", [USDC_NEAR]: "50" }, anyCoin: false });
  const confirm = expectKind(await same.flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.equal(confirm.source.balance.tokenId, USDC_SOL);
  assert.deepEqual(confirm.alternatives, [], "other coins aren't offered while converting is off");
  const q = same.ledger.calls.find((c) => c.method === "ledger.quotePay")!;
  assert.equal(q.params?.fromTokenId, q.params?.toTokenId, "a same-coin payout, which needs no 1Click funding");

  const empty = setup({ balances: { [USDC_NEAR]: "1" }, anyCoin: false });
  assert.equal(expectKind(await empty.flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "problem").problem.code, "pay.funds.short", "not enough in any coin is still 'not enough'");
});

test("a ZeroFee request in a coin the payer holds is an in-ledger transfer, switch or no switch", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" }, anyCoin: false });
  const confirm = expectKind(await flow.read(requestLink({ to: "alex.near", amount: "5", token: USDC_NEAR })), "confirm").confirm;
  assert.equal(confirm.source.route, "transfer");
});

test("a price that runs out at signing is refreshed once, by itself", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  ledger.failNext("ledger.pay", { code: "security.quote.expired", whatHappened: "This price has run out.", money: { state: "safe", where: "in your account" }, next: { kind: "retry", label: "Get a new price" } });
  expectKind(await flow.confirm(), "sent");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.quotePay").length, 2);
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.pay").length, 2);
});

test("a payment the core refuses as not matching its quote is shown as the core's own Problem", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  ledger.failNext("ledger.pay", { code: "security.quote.mismatch", whatHappened: "What would be sent doesn't match this payment's terms, so we stopped.", money: { state: "safe", where: "in your account" }, next: { kind: "nothing", label: "Go back" } });
  assert.equal(expectKind(await flow.confirm(), "problem").problem.code, "security.quote.mismatch");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.pay").length, 1, "never retried");
});

test("a TON or Stellar payee that needs a memo is refused, because the withdraw can't carry it", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "40" } });
  const ton = expectKind(await flow.read("ton://transfer/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs?amount=1500000000&text=user-7731"), "problem").problem;
  assert.equal(ton.code, "pay.code.memo-unsupported");
  assert.match(ton.whatHappened, /TON/);
  const xlm = expectKind(await flow.read("web+stellar:pay?destination=GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN&amount=5&asset_code=USDC&memo=42"), "problem").problem;
  assert.equal(xlm.code, "pay.code.memo-unsupported");
  // XRP's destination tag does go through (WITHDRAW_TO:<addr>:<tag>), so it isn't refused for the tag.
  const xrp = await flow.read("xrpl:rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh?amount=10&dt=12345");
  assert.notEqual(xrp.kind === "problem" && xrp.problem.code, "pay.code.memo-unsupported");
});

test("a payment the account's protection holds is on hold, never paid, and nothing moves", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "500" } });
  await flow.read(requestLink({ to: "alex.near", amount: "300", token: USDC_NEAR }));
  const held = { id: "held-1", readyAtIso: "2026-10-25T12:00:00.000Z", needsSecondDevice: true };
  ledger.holdNext(held);
  const step = expectKind(await flow.confirm(), "held");
  assert.deepEqual(step.held, held, "the shell's Waiting screen gets the hold's own id and time");
  assert.equal(ledger.balance(USDC_NEAR), "500", "nothing moved");
  assert.equal(ledger.received.size, 0);
  assert.equal(flow.stopwatch.read().paid, undefined, "the stopwatch never says paid");
});

test("a held conversion payment is on hold too", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "500" } });
  await flow.read(`solana:${SHOP_SOL}?amount=250&spl-token=${SOL_USDC_MINT}`);
  ledger.holdNext({ id: "held-2", readyAtIso: "2026-10-25T12:00:00.000Z", needsSecondDevice: false });
  expectKind(await flow.confirm(), "held");
  assert.equal(ledger.received.size, 0);
});

const WAIT = { level: "wait" as const, waitSeconds: 86400, text: "This goes on hold for 24 hours first. You can cancel it until then." };

test("a payment the protection will hold says so on Confirm, before Face ID, in the sheet's own words", async () => {
  const { flow } = setup({ balances: { [USDC_SOL]: "500" }, protection: WAIT, anyCoin: false });
  const c = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=300&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.deepEqual(c.hold, WAIT);
  const fast = setup({ balances: { [USDC_SOL]: "500" }, protection: { level: "faceid", waitSeconds: 0, text: "Runs at Face ID." }, anyCoin: false });
  assert.equal(expectKind(await fast.flow.read(`solana:${SHOP_SOL}?amount=3&spl-token=${SOL_USDC_MINT}`), "confirm").confirm.hold, undefined);
});

test("a conversion the protection would hold is never offered: its price can't wait", async () => {
  const { flow } = setup({ balances: { [USDC_NEAR]: "500" }, protection: WAIT });
  assert.equal(expectKind(await flow.read(`solana:${SHOP_SOL}?amount=300&spl-token=${SOL_USDC_MINT}`), "problem").problem.code, "pay.route.would-hold");
  const both = setup({ balances: { [USDC_NEAR]: "500", [USDC_SOL]: "500" }, protection: WAIT });
  const c = expectKind(await both.flow.read(`solana:${SHOP_SOL}?amount=300&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.equal(c.source.sameCoin, true, "the same coin can wait out a hold, so it pays");
  assert.ok(c.hold);
});

const POCKET = { available: true, ready: true, balances: { [USDC_NEAR]: "40" } };

test("Pay from Private: offered for a send that leaves NEAR, and paid confidentially from the pocket only", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "100" }, pocket: POCKET });
  const off = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.deepEqual(off.privacy, { on: false }, "the switch shows, off");
  const on = expectKind(await flow.setPrivate(true), "confirm").confirm;
  assert.deepEqual(on.privacy, { on: true });
  assert.equal(on.source.balance.held, "private");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.quotePay").at(-1)?.params?.confidential, true);
  expectKind(await flow.settle(expectKind(await flow.confirm(), "sent")), "paid");
  assert.equal(ledger.calls.find((c) => c.method === "ledger.pay")?.params?.confidential, true);
  assert.ok(compare(ledger.pocketBalance(USDC_NEAR), "40") < 0, "it came out of Private");
  assert.equal(ledger.balance(USDC_NEAR), "100", "and not out of the main balance");
});

test("the switch is off for every new payment, and an ordinary payment never says confidential", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "100" }, pocket: POCKET });
  await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`);
  await flow.setPrivate(true);
  const next = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=1&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.deepEqual(next.privacy, { on: false });
  expectKind(await flow.settle(expectKind(await flow.confirm(), "sent")), "paid");
  assert.equal(ledger.calls.find((c) => c.method === "ledger.pay")?.params?.confidential, undefined);
});

test("no switch without a usable pocket: none, not set up, unavailable, too small, or a send inside the ledger", async () => {
  const code = `solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`;
  for (const pocket of [undefined, { ...POCKET, ready: false }, { ...POCKET, available: false }, { ...POCKET, balances: { [USDC_NEAR]: "1" } }]) {
    const { flow } = setup({ balances: { [USDC_NEAR]: "100" }, ...(pocket ? { pocket } : {}) });
    assert.equal(expectKind(await flow.read(code), "confirm").confirm.privacy, undefined, JSON.stringify(pocket));
  }
  const friend = setup({ balances: { [USDC_NEAR]: "100" }, pocket: POCKET });
  assert.equal(expectKind(await friend.flow.read(requestLink({ to: "alex.near", amount: "5", token: USDC_NEAR })), "confirm").confirm.privacy, undefined);
});

test("Private that can't cover it any more is a plain Problem, and nothing is sent in public instead", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "100" }, pocket: POCKET });
  await flow.read(`solana:${SHOP_SOL}?amount=60&spl-token=${SOL_USDC_MINT}`);
  assert.equal(expectKind(await flow.setPrivate(true), "problem").problem.code, "pay.private.short");
  assert.equal(ledger.calls.some((c) => c.method === "ledger.pay"), false);
});

test("Private as the default (Wallet's defaultOn) presets the switch on, still flippable per payment", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "100" }, pocket: { ...POCKET, defaultOn: true } });
  const on = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=4.2&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.deepEqual(on.privacy, { on: true });
  assert.equal(on.source.balance.held, "private");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.quotePay").at(-1)?.params?.confidential, true);
  const off = expectKind(await flow.setPrivate(false), "confirm").confirm;
  assert.deepEqual(off.privacy, { on: false });
  assert.equal(off.source.balance.held, "ledger");
  assert.equal(ledger.calls.filter((c) => c.method === "ledger.quotePay").at(-1)?.params?.confidential, undefined);
});

test("the default never turns a payment Private can't cover into a Problem: it's paid from the balance, switch hidden", async () => {
  const { ledger, flow } = setup({ balances: { [USDC_NEAR]: "100" }, pocket: { ...POCKET, defaultOn: true } });
  const c = expectKind(await flow.read(`solana:${SHOP_SOL}?amount=60&spl-token=${SOL_USDC_MINT}`), "confirm").confirm;
  assert.equal(c.privacy, undefined);
  assert.equal(c.source.balance.held, "ledger");
  assert.equal(ledger.calls.filter((x) => x.method === "ledger.quotePay").at(-1)?.params?.confidential, undefined);
});

test("D85, a send Chat asked for (privateOnly): Private from the first price, never the Safe, never flipped off", async () => {
  const sol = async (o: { pocket?: typeof POCKET; amount: string }) => {
    const s = setup({ balances: { [USDC_NEAR]: "100" }, ...(o.pocket ? { pocket: o.pocket } : {}) });
    await s.flow.warm();
    const t = targetForSend({ kind: "address", chain: "sol", candidates: ["sol"], address: SHOP_SOL }, s.flow.tokens!.byAsset(USDC_SOL)!, o.amount, s.flow.tokens!);
    assert.ok("ok" in t);
    // the form's coin is one of the Safe's that Private doesn't hold (USDT): Private's own rows still pick (B27 walk)
    return { ...s, step: await s.flow.send(t.ok, USDT_NEAR, { privateOnly: true }) };
  };
  const ok = await sol({ pocket: POCKET, amount: "4.2" });
  assert.deepEqual(expectKind(ok.step, "confirm").confirm.privacy, { on: true });
  const quotes = ok.ledger.calls.filter((c) => c.method === "ledger.quotePay");
  assert.ok(quotes.length > 0 && quotes.every((c) => c.params?.confidential === true), "no public price was ever asked (review M1)");
  assert.deepEqual(expectKind(await ok.flow.setPrivate(false), "confirm").confirm.privacy, { on: true }, "the switch can't go off");
  // short: a Problem, nothing priced or paid from the Safe, and asking again stays Private
  const short = await sol({ pocket: POCKET, amount: "60" });
  assert.equal(expectKind(short.step, "problem").problem.code, "pay.private.short");
  assert.equal(short.ledger.calls.some((c) => c.method === "ledger.pay" || (c.method === "ledger.quotePay" && c.params?.confidential !== true)), false);
  assert.equal(expectKind(await short.flow.setPrivate(false), "problem").problem.code, "pay.private.short", "never falls back to the Safe");
  // no pocket at all: short, never the Safe
  const none = await sol({ amount: "4.2" });
  assert.equal(expectKind(none.step, "problem").problem.code, "pay.private.short");
  // control: the ordinary send (no privateOnly) does price from the Safe
  const plain = setup({ balances: { [USDC_NEAR]: "100" }, pocket: POCKET });
  await plain.flow.warm();
  const t = targetForSend({ kind: "address", chain: "sol", candidates: ["sol"], address: SHOP_SOL }, plain.flow.tokens!.byAsset(USDC_SOL)!, "4.2", plain.flow.tokens!);
  assert.ok("ok" in t);
  assert.deepEqual(expectKind(await plain.flow.send(t.ok), "confirm").confirm.privacy, { on: false });
});
