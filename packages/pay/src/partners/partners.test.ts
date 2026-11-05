import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { PayFlow } from "../pay.ts";
import { FakeLedger, USDC_BASE, USDC_NEAR } from "../testing/fake-ledger.ts";
import { TokenDirectory } from "../tokens.ts";
import { CARDS, cardAddressProblem, cardCheckLive, cardEndingSoon, cardStopped, checkAndSaveCard, checkCard, confirmFirstTopUp, endsWords, loadCard, markConfirmed, moneyBackAsset, rememberForgotten, saveCard, topUpTarget, wasForgotten } from "./cards.ts";
import { buyLink, rampsFor, readSellReturn, sellLink, verifySellReturn } from "./ramps.ts";
import type { PartnerConfig } from "./ramps.ts";

const BASE_DEPOSIT = "0x1144fBbD23cEc7A43A0BdA8682ed842c4E035F81";  // generated sample
const CONFIG: PartnerConfig = { banxaRef: "zerofee", rampHostApiKey: "pk_public", moonpayApiKey: "pk_live_public", returnUrl: "https://demo.example/pay/return" };

test("with no sign-ups, only the plain-link partner is offered", () => {
  assert.deepEqual(rampsFor("buy", {}).map((p) => p.id), ["mt-pelerin"]);
  assert.deepEqual(rampsFor("sell", {}).map((p) => p.id), ["mt-pelerin"]);
  assert.deepEqual(rampsFor("buy", CONFIG).map((p) => p.id), ["banxa", "ramp", "mt-pelerin"]);
  assert.deepEqual(rampsFor("sell", CONFIG).map((p) => p.id), ["banxa", "moonpay", "mt-pelerin"]);
});

test("a Banxa link buys USDC on Base straight into the balance, and comes back to this order", () => {
  const url = new URL(buyLink("banxa", { address: BASE_DEPOSIT, chain: "base", fiat: "EUR", fiatAmount: "50", order: "o1" }, CONFIG)!);
  assert.equal(url.origin, "https://zerofee.banxa.com");
  assert.equal(url.searchParams.get("coinType"), "USDC");
  assert.equal(url.searchParams.get("blockchain"), "BASE");
  assert.equal(url.searchParams.get("walletAddress"), BASE_DEPOSIT);
  assert.equal(url.searchParams.get("fiatType"), "EUR");
  assert.equal(url.searchParams.get("fiatAmount"), "50");
  assert.equal(url.searchParams.get("returnUrl"), "https://demo.example/pay/return?partner=banxa&order=o1");
  assert.ok(!url.toString().includes("secret") && !url.searchParams.has("signature"), "no secret, no signature");
});

test("Ramp and Mt Pelerin links carry only public values", () => {
  const ramp = new URL(buyLink("ramp", { address: BASE_DEPOSIT, chain: "base", order: "o2" }, CONFIG)!);
  assert.equal(ramp.searchParams.get("swapAsset"), "BASE_USDC");
  assert.equal(ramp.searchParams.get("userAddress"), BASE_DEPOSIT);
  assert.equal(ramp.searchParams.get("hostApiKey"), "pk_public");
  const pel = new URL(buyLink("mt-pelerin", { address: BASE_DEPOSIT, chain: "base", usdcAmount: "50", order: "o3" }, {})!);
  assert.equal(pel.searchParams.get("dnet"), "base_mainnet");
  assert.equal(pel.searchParams.get("bda"), "50", "the USDC the person typed");
  assert.equal(pel.searchParams.get("addr"), null, "Mt Pelerin can't prefill without a wallet signature; the sheet shows the address to copy");
  assert.equal(buyLink("ramp", { address: "x", chain: "sol", order: "o" }, CONFIG), null, "only chains checked in the partner's docs");
});

test("MoonPay sell needs an https way back; without one it isn't offered", () => {
  assert.ok(sellLink("moonpay", { chain: "sol", amount: "100", order: "o4" }, CONFIG));
  assert.equal(sellLink("moonpay", { chain: "sol", amount: "100", order: "o4" }, { ...CONFIG, returnUrl: "zerofee://pay/return" }), null);
});

test("cash out: the partner's hand-back becomes one checked payment from the balance", async () => {
  const link = new URL(sellLink("banxa", { chain: "base", amount: "100", order: "o5" }, CONFIG)!);
  assert.equal(link.searchParams.get("orderType"), "sell");
  const back = "https://demo.example/pay/return?partner=banxa&order=o5&providerWalletAddress=0x2527D02599Ba641c19FEa793cD0F167589a0f10D&coinAmount=100&coinType=USDC&blockchain=BASE&orderId=BX-9";
  const read = readSellReturn(back, { partner: "banxa", order: "o5", chain: "base", amount: "100" });
  assert.ok("ok" in read, JSON.stringify(read));
  assert.equal(read.ok.address, "0x2527D02599Ba641c19FEa793cD0F167589a0f10D");
  assert.equal(read.ok.partnerOrderId, "BX-9");

  // The payment itself is the ordinary engine: exact USDC on Base to the partner's address.
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "150" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const usdcBase = flow.tokens!.find("base", { symbol: "USDC" })!;
  const step = await flow.send({ to: { kind: "chain", chain: "base", address: read.ok.address }, token: usdcBase, amount: read.ok.amount, label: "Banxa", notes: [] });
  assert.equal(step.kind, "confirm");
});

test("a hand-back that doesn't match what the person chose stops before any payment", () => {
  const ok = "https://demo.example/pay/return?partner=banxa&order=o5&providerWalletAddress=0x2527D02599Ba641c19FEa793cD0F167589a0f10D&coinAmount=100&coinType=USDC&blockchain=BASE";
  const expected = { partner: "banxa" as const, order: "o5", chain: "base", amount: "100" };
  assert.ok("ok" in readSellReturn(ok, expected));
  for (const [what, url] of [
    ["another amount", ok.replace("coinAmount=100", "coinAmount=1000")],
    ["another chain", ok.replace("blockchain=BASE", "blockchain=ETH")],
    ["another order", ok.replace("order=o5", "order=o6")],
    ["another coin", ok.replace("coinType=USDC", "coinType=USDT")],
    ["not an address on Base", ok.replace("0x2527D02599Ba641c19FEa793cD0F167589a0f10D", "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK")],
    ["a forged checksum", ok.replace("0x2527D02599Ba641c19FEa793cD0F167589a0f10D", "0x2527D02599Ba641c19FEa793cD0F167589a0F10D")],
  ]) {
    const r = readSellReturn(url, expected);
    assert.ok("problem" in r && r.problem.code === "pay.cashout.mismatch", what);
  }
});

// iOS audit finding 2: the partner's page opens the return link, so a script in it can name its own deposit address.
test("a cash-out's deposit address comes from the partner's own record, never the return link alone", async () => {
  const real = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
  const evil = "0x1144fBbD23cEc7A43A0BdA8682ed842c4E035F81";
  const link = (address: string) => `https://demo.example/pay/return?partner=moonpay&order=o7&depositWalletAddress=${address}&baseCurrencyAmount=100&baseCurrencyCode=usdc_base&transactionId=MP-1`;
  const expected = { partner: "moonpay" as const, order: "o7", chain: "base", amount: "100" };
  const lookup = async (partner: string, id: string) => (partner === "moonpay" && id === "MP-1" ? { address: real, amount: "100", chain: "base" } : null);
  const ok = await verifySellReturn(link(real), expected, lookup);
  assert.ok("ok" in ok && ok.ok.address === real, "the partner's record agrees with the link: that address (control)");
  const swapped = await verifySellReturn(link(evil), expected, lookup);
  assert.ok("problem" in swapped && swapped.problem.code === "pay.cashout.mismatch", "a link naming another address than the partner's record stops");
  const unchecked = await verifySellReturn(link(evil), expected);
  assert.ok("problem" in unchecked && unchecked.problem.code === "pay.cashout.unchecked", "no way to ask the partner: the link's address is never used");
  const failing = await verifySellReturn(link(real), expected, async () => { throw new Error("offline"); });
  assert.ok("problem" in failing && failing.problem.code === "pay.cashout.unchecked", "the partner doesn't answer: nothing is prepared");
  const noId = await verifySellReturn(link(real).replace("&transactionId=MP-1", ""), expected, lookup);
  assert.ok("problem" in noId && noId.problem.code === "pay.cashout.unchecked", "a link without the partner's order id can't be checked");
  const otherAmount = await verifySellReturn(link(real), expected, async () => ({ address: real, amount: "1000", chain: "base" }));
  assert.ok("problem" in otherAmount && otherAmount.problem.code === "pay.cashout.mismatch", "the partner's record says another amount: stops");
});

test("a card tops up only on its own chain, with only its own coins", async () => {
  const gnosis = CARDS.find((c) => c.id === "gnosis-pay")!;
  assert.equal(cardAddressProblem(gnosis, "")?.code, "pay.card.address-needed");
  assert.equal(cardAddressProblem(gnosis, "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK")?.code, "pay.card.address-wrong");
  assert.equal(cardAddressProblem(gnosis, "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"), null);

  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const card = { productId: "gnosis-pay" as const, address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "EURe", confirmed: true };
  assert.equal(await saveCard(ledger, card), null);
  assert.deepEqual(await loadCard(ledger), card, "kept on this phone");

  const t = topUpTarget(card, "50", flow.tokens!);
  assert.ok("ok" in t);
  assert.equal(t.ok.token.symbol, "EURe");
  assert.equal(t.ok.token.chain, "gnosis");
  const confirm = await flow.send(t.ok);
  assert.equal(confirm.kind, "confirm", "USDC in the balance pays for EURe on Gnosis");

  assert.ok("problem" in topUpTarget({ ...card, coin: "USDT" }, "50", flow.tokens!), "Gnosis Pay doesn't take USDT");
  const tangem = topUpTarget({ productId: "tangem-pay", address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "USDC", confirmed: true }, "20", flow.tokens!);
  assert.ok("ok" in tangem && tangem.ok.token.contract === "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", "native USDC on Polygon, not the bridged one");
});

test("a card address is saved only once the chain proves it's that card's account", async () => {
  const gnosis = CARDS.find((c) => c.id === "gnosis-pay")!;
  const safe = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
  const live = new FakeLedger({ accountId: "me.near", balances: {}, cardAccounts: [safe.toLowerCase()] });
  const ok = await checkCard(live, gnosis, safe);
  assert.ok("ok" in ok && ok.ok.isCard, "the core read it as a Gnosis Pay card account");
  assert.equal(await cardCheckLive(live), true);

  const other = await checkCard(live, gnosis, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  assert.ok("problem" in other && other.problem.code === "pay.card.not-card", "any other address is refused");
  assert.match(other.problem.more ?? "", /ordinary wallet address/, "with the core's own words for what it is instead");

  const none = new FakeLedger({ accountId: "me.near", balances: {} });
  const unchecked = await checkCard(none, gnosis, safe);
  assert.ok("problem" in unchecked && unchecked.problem.code === "pay.card.unchecked", "no check, no save");
  assert.equal(await cardCheckLive(none), false, "so the card stays off screen (D13)");
  assert.equal(await cardCheckLive(createMockBridge()), true, "MockBridge answers card.check, so the demo shows the card step");
});

test("the first top-up to a new card is small; after it lands, later ones aren't capped", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: {} });
  const flow = new PayFlow({ bridge: ledger });
  await flow.warm();
  const card = { productId: "metamask-card" as const, address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "USDC" };
  const big = topUpTarget(card, "50", flow.tokens!);
  assert.ok("problem" in big && big.problem.code === "pay.card.first-small");
  assert.ok("ok" in topUpTarget(card, "5", flow.tokens!));
  await saveCard(ledger, card);
  await markConfirmed(ledger);
  assert.equal((await loadCard(ledger))?.confirmed, true);
  assert.ok("ok" in topUpTarget({ ...card, confirmed: true }, "50", flow.tokens!));
});

test("after the small first top-up: only 'yes, it arrived' unlocks bigger ones; 'no' forgets the address", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: {} });
  const card = { productId: "gnosis-pay" as const, address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "EURe" };
  await saveCard(ledger, card);
  assert.equal(await confirmFirstTopUp(ledger, "not-yet"), null);
  assert.equal((await loadCard(ledger))?.confirmed, undefined, "not yet: still capped");
  const no = await confirmFirstTopUp(ledger, "no");
  assert.equal(no?.code, "pay.card.not-arrived");
  assert.equal(await loadCard(ledger), null, "a possibly look-alike address isn't kept");
  await saveCard(ledger, card);
  assert.equal(await confirmFirstTopUp(ledger, "yes"), null);
  assert.equal((await loadCard(ledger))?.confirmed, true);
});

test("D35: the new card is ether.fi's, a hand-off: saved on the paste with no card.check, topped up with USDC on Base, first top-up small", async () => {
  const fresh = CARDS.find((c) => !c.endsOn)!;
  assert.equal(fresh.id, "etherfi-cash", "a new person gets the ether.fi card");
  assert.ok(fresh.handOff && fresh.signupUrl.startsWith("https://www.ether.fi/"));
  assert.equal(CARDS.find((c) => c.id === "gnosis-pay")!.endsOn?.at, "2026-12-20T23:59:00Z", "Gnosis Pay's consumer card stops then");

  // No card.check on this ledger at all: a hand-off card is still saved (its first small top-up is the check).
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const saved = await checkAndSaveCard(ledger, fresh, BASE_DEPOSIT, "USDC");
  assert.ok("ok" in saved && !saved.ok.confirmed);
  assert.ok("problem" in (await checkAndSaveCard(ledger, fresh, "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", "USDC")), "an address that isn't on Base is refused");
  assert.ok("problem" in (await checkAndSaveCard(ledger, CARDS.find((c) => c.id === "gnosis-pay")!, BASE_DEPOSIT, "EURe")), "a Gnosis Pay card still needs card.check");

  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const card = { productId: "etherfi-cash" as const, address: BASE_DEPOSIT, coin: "USDC" };
  assert.ok("problem" in topUpTarget(card, "20", flow.tokens!), "the first top-up is small");
  const t = topUpTarget(card, "5", flow.tokens!);
  assert.ok("ok" in t);
  assert.equal(t.ok.token.symbol, "USDC");
  assert.equal(t.ok.token.chain, "base");
  assert.deepEqual(t.ok.to, { kind: "chain", chain: "base", address: BASE_DEPOSIT });
});

test("Security's MUST 1: a Gnosis Pay card takes no top-up from 23:59 UTC on 20 Dec 2026; its last week says so", async () => {
  const gnosis = CARDS.find((c) => c.id === "gnosis-pay")!;
  const end = Date.parse("2026-12-20T23:59:00Z");
  assert.equal(endsWords(gnosis), "20 December 2026");
  assert.equal(endsWords(gnosis, true), "20 Dec");
  assert.equal(cardEndingSoon(gnosis, end - 8 * 86_400_000), false, "not yet its last week");
  assert.equal(cardEndingSoon(gnosis, end - 6 * 86_400_000), true, "its last week");
  assert.equal(cardStopped(gnosis, end - 1), false);
  assert.equal(cardStopped(gnosis, end), true);

  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const card = { productId: "gnosis-pay" as const, address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "EURe", confirmed: true };
  assert.ok("ok" in topUpTarget(card, "50", flow.tokens!, end - 60_000), "a minute before: still topped up");
  const after = topUpTarget(card, "50", flow.tokens!, end);
  assert.ok("problem" in after && after.problem.code === "pay.card.stopped", "at the line: refused");
  assert.equal(after.problem.whatHappened, "Gnosis Pay's card stopped on 20 Dec. Nothing was sent.");
  assert.match(after.problem.more ?? "", /app\.gnosispay\.com and tap Withdraw/, "with where its money is taken out");
  assert.ok("ok" in topUpTarget({ productId: "etherfi-cash", address: BASE_DEPOSIT, coin: "USDC", confirmed: true }, "50", flow.tokens!, end + 86_400_000), "a card with no end is unaffected");
});

test("D38: several cards side by side, one per product; each answers for itself; the old single card moves over", async () => {
  const { loadCards, removeCard: remove } = await import("./cards.ts");
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  await ledger.call("device.store.set", { key: "card.v1", value: JSON.stringify({ productId: "gnosis-pay", address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "EURe", confirmed: true }) });
  assert.deepEqual((await loadCards(ledger)).map((c) => c.productId), ["gnosis-pay"], "the old single card moves over");
  assert.equal(await saveCard(ledger, { productId: "etherfi-cash", address: BASE_DEPOSIT, coin: "USDC" }), null);
  assert.deepEqual((await loadCards(ledger)).map((c) => c.productId), ["gnosis-pay", "etherfi-cash"]);
  assert.equal((await loadCard(ledger, "etherfi-cash"))?.address, BASE_DEPOSIT);
  await saveCard(ledger, { productId: "etherfi-cash", address: BASE_DEPOSIT, coin: "USDC", lastAmount: "5" });
  assert.equal((await loadCards(ledger)).length, 2, "one per product: saving again replaces it");
  const no = await confirmFirstTopUp(ledger, "no", "etherfi-cash");
  assert.equal(no?.code, "pay.card.not-arrived");
  assert.deepEqual((await loadCards(ledger)).map((c) => c.productId), ["gnosis-pay"], "only that card's address goes");
  await remove(ledger, "gnosis-pay");
  assert.deepEqual(await loadCards(ledger), []);
});

test("Security's SHOULD on a7731f2: a card's coin is its pinned contract; an unpinned card never opens Receive", async () => {
  const ledger = new FakeLedger({ accountId: "me.near", balances: { [USDC_NEAR]: "200" } });
  const flow = new PayFlow({ bridge: ledger, anyCoin: true });
  await flow.warm();
  const tokens = flow.tokens!;
  // Circle's USDC on Base, the coin ether.fi and MetaMask Card name: money back opens Receive for exactly it.
  assert.equal(moneyBackAsset("etherfi-cash", "USDC", tokens), USDC_BASE);
  assert.equal(moneyBackAsset("metamask-card", "USDC", tokens), USDC_BASE);
  // No live page names Gnosis Pay's contracts: money back is "Open Gnosis Pay" only, never an address.
  for (const coin of ["EURe", "GBPe", "USDC"]) assert.equal(moneyBackAsset("gnosis-pay", coin, tokens), undefined, `Gnosis Pay ${coin}`);
  assert.equal(CARDS.find((c) => c.id === "gnosis-pay")!.contracts, undefined);

  const card = { productId: "etherfi-cash" as const, address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", coin: "USDC", confirmed: true };
  const sent = topUpTarget(card, "5", tokens);
  assert.ok("ok" in sent && sent.ok.token.contract?.toLowerCase() === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "a top-up sends exactly the pinned contract");
  // A list whose only "USDC" on Base is another contract: refused (a Problem, never a send), and no money back.
  const base = tokens.find("base", { symbol: "USDC" })!;
  const other = new TokenDirectory([{ ...base, assetId: "nep141:base-0x0000000000000000000000000000000000000001.omft.near", contract: "0x0000000000000000000000000000000000000001" }]);
  const refused = topUpTarget(card, "5", other);
  assert.ok("problem" in refused && refused.problem.code === "pay.code.coin-unsupported");
  assert.equal(moneyBackAsset("etherfi-cash", "USDC", other), undefined);
});

test("Security's SHOULD: an address a card's money didn't show at is remembered as a hash, and recognised if pasted again", async () => {
  const l = new FakeLedger({ accountId: "me.near", balances: {} });
  const a = "0x2527D02599Ba641c19FEa793cD0F167589a0f10D";
  await rememberForgotten(l, "etherfi-cash", a);
  assert.equal(await wasForgotten(l, "etherfi-cash", ` ${a.toLowerCase()} `), true);
  assert.equal(await wasForgotten(l, "metamask-card", a), false, "per card");
  assert.equal(await wasForgotten(l, "etherfi-cash", "0x2527D02599Ba641c19FEa793cD0F167589a0f10E"), false);
  const kept = await l.call<{ value: string }>("device.store.get", { key: "card.forgotten.v1" });
  assert.ok("ok" in kept && !kept.ok.value.toLowerCase().includes(a.slice(2).toLowerCase()), "never the address itself");
});
