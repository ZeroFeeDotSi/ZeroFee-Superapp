// J6 guard, dollars first (VOICE rule 4; UI-SIMPLICITY-RULES 5, 6; audit 2 Nov, B6, B7, C4): no approval sheet's title and
// no review's primary button leads with a coin amount when a price exists. "Send 1.1765 NEAR to alex.near" fails it;
// "Send $5.00 (1.1765 NEAR) to alex.near" passes. Checked on the core's own sheets (the real app), on the sample demo's
// sheets (MockBridge, what the judges open), and on Send's review (its button, its total, its big figure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "@zerofee/core/device-key";
import { serialize, type CoreAction } from "@zerofee/core/tx-build";
import { decodeTransaction } from "@zerofee/core/tx-decode";
import { plainWords, type WordsContext } from "@zerofee/core/words";
import type { PlainWords } from "@zerofee/core/signer";
import { createMockBridge } from "@zerofee/shell-api/MockBridge.ts";
import { reviewAction, reviewDollars, totalDollarsFirst } from "@zerofee/pay/app/format.ts";
import type { Confirm } from "@zerofee/pay/pay";

/** The first money figure in the text is a coin amount ("1.1765 NEAR"), not a dollar figure ("$5.00", "under $0.01").
 *  A dollar coin's own figure is dollars (5 Nov, the Copywriter: "Send 5 USDC", never "Send $5.00 (5 USDC)"; the core
 *  says it so only for a dollar coin by its contract, priced at its figure to the cent: words.ts dollarTwin). */
export function leadsWithCoin(text: string): boolean {
  const first = /\$[\d,]+(?:\.\d+)?|under \$0\.01|\d[\d,]*(?:\.\d+)? (?:[A-Z][A-Za-z]{1,9}|wNEAR)\b/.exec(text);
  return first !== null && !first[0].includes("$") && !/ (USDC|USDT)$/.test(first[0]);
}

test("the guard fires: a coin-first title is caught, a dollars-first one passes (control)", () => {
  assert.equal(leadsWithCoin("Send 1.1765 NEAR to alex.near"), true);
  assert.equal(leadsWithCoin("Top up Trading with 21 NEAR"), true);
  assert.equal(leadsWithCoin("Send 5 USDC to bob.near"), false, "a dollar coin's figure is its dollars");
  assert.equal(leadsWithCoin("Send 1.1765 NEAR"), true);
  assert.equal(leadsWithCoin("Send $5.00 (1.1765 NEAR) to alex.near"), false);
  assert.equal(leadsWithCoin("Send under $0.01 (0.0001 NEAR) to alex.near"), false);
  assert.equal(leadsWithCoin("Add a second device"), false, "no money, nothing to lead");
});

const NEAR = 10n ** 24n;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const key = SoftwareKey.generate();
const decoded = (actions: CoreAction[], receiverId: string) =>
  decodeTransaction(serialize({ signerId: "zf-0123456789.near", publicKey: key.publicKey, nonce: 7n, receiverId, blockHash: toBase58(new Uint8Array(32).fill(9)), actions }));
const call = (method: string, args: object, deposit = 1n): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas: 30_000_000_000_000n, depositYocto: deposit });
const ctx: WordsContext = {
  network: "mainnet", balanceYocto: 10n * NEAR, gasPriceYocto: 100_000_000n, knownRecipients: new Set(), nearUsd: 4.25,
  coins: { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }]]) },
};

test("the real app's sheets (the core's words): priced, every title leads with dollars", () => {
  const sheets: PlainWords[] = [
    plainWords(decoded([{ kind: "transfer", yocto: (11765n * NEAR) / 10_000n }], "alex.near"), ctx),
    plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "5000000" })], USDC), ctx),
    plainWords(decoded([{ kind: "transfer", yocto: NEAR / 10_000n }], "alex.near"), ctx),
  ];
  for (const w of sheets) {
    assert.ok(w.amount, `priced: ${w.title}`);
    assert.equal(leadsWithCoin(w.title), false, w.title);
  }
  assert.equal(sheets[0]!.title, "Send $5.00 (1.1765 NEAR) to alex.near");
  // With no price the coin alone is right (never a made-up dollar figure): the guard is about sheets that have one.
  const unpriced = plainWords(decoded([{ kind: "transfer", yocto: NEAR }], "alex.near"), { ...ctx, nearUsd: null });
  assert.equal(unpriced.amount, undefined);
  assert.equal(leadsWithCoin(unpriced.title), true, "control: the same send unpriced still says its coin first");
});

test("the sample demo's sheets (Send in USDC and NEAR, Top up in USDC and NEAR, Send out, Pay): priced, every title leads with dollars", async () => {
  const mock = createMockBridge({ latencyMs: 0 });
  const seen: PlainWords[] = [];
  mock.on<{ id: string; words: PlainWords }>("approval.needed", (p) => {
    seen.push(p.words);
    void mock.call("approval.answer", { id: p.id, approve: false });
  });
  const USDC_NEAR = `nep141:${USDC}`;
  await mock.call("ledger.transfer", { tokenId: USDC_NEAR, amount: "1000.00", toAccountId: "alex.near" });
  await mock.call("ledger.transfer", { tokenId: "nep141:wrap.near", amount: "1.1765", toAccountId: "alex.near" });
  await mock.call("ledger.toTrading", { amount: "21" });
  await mock.call("ledger.toTrading", { amount: "2", tokenId: "nep141:wrap.near" });
  await mock.call("ledger.withdraw", { tokenId: "nep141:sol.omft.near", amount: "0.5", toAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", chain: "sol" });
  const q = await mock.call<{ id: string }>("ledger.quotePay", { fromTokenId: USDC_NEAR, toTokenId: "nep141:sol.omft.near", to: { kind: "chain", chain: "sol", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" }, amountOut: "0.1" });
  if ("ok" in q) await mock.call("ledger.pay", { quoteId: q.ok.id });
  assert.ok(seen.length >= 5, `sheets seen: ${seen.map((w) => w.title).join(" | ")}`);
  for (const w of seen) {
    // a one-step sheet (audit S1) carries its amount in the title only: priced when the title leads with dollars
    if (!w.amount && !/^\w+ \$[\d,]+\.\d\d \(/.test(w.title)) continue;
    assert.equal(leadsWithCoin(w.title), false, w.title);
  }
  assert.ok(seen.filter((w) => w.amount || /^\w+ \$[\d,]+\.\d\d \(/.test(w.title)).length >= 5, "the demo's money sheets are priced");
  assert.equal(seen[0]!.title, "Send $1,000.00 (1000 USDC) to alex.near", "the copy review (5 Nov): never trailing zeros in a coin figure");
  assert.equal(seen[2]!.title, "Move $21.00 (21 USDC) to your NEAR wallet");
});

const review = (over: object = {}) => ({
  payee: "alex.near", labelFromCode: false, payeePlain: "alex.near", payeeFull: "alex.near", network: "NEAR", alternatives: [], inSymbol: "NEAR", feeNote: "",
  target: { to: { kind: "ledger", accountId: "alex.near" }, token: { assetId: "near", chain: "near", symbol: "NEAR", decimals: 24, contract: null }, amount: "1.1765", notes: [] },
  source: { balance: { amount: "7.2", chain: "near" }, route: "transfer", sameCoin: true }, maxIn: "1.1765", expectedIn: "1.1765",
  quote: { amount: "about $5.00 (1.1765 NEAR)", fee: "about $0.05 (0.011 NEAR)" },
  ...over,
}) as unknown as Confirm;

test("Send's review: dollars large, the button 'Send $5.00', the total 'about $5.05 (up to 1.1875 NEAR)': two estimates added are not a bound", () => {
  const c = review();
  assert.equal(reviewDollars(c), "$5.00");
  assert.equal(reviewAction(c, "Send"), "Send $5.00");
  assert.equal(totalDollarsFirst(c), "about $5.05 (up to 1.1875 NEAR)");
  assert.equal(leadsWithCoin(reviewAction(c, "Send")), false);
  assert.equal(leadsWithCoin(totalDollarsFirst(c)), false);
  // A dollar coin, and a coin with no price (control: the coin is all there is, so it leads).
  const usdc = review({ inSymbol: "USDC", target: { to: { kind: "ledger", accountId: "alex.near" }, token: { assetId: "u", chain: "near", symbol: "USDC", decimals: 6, contract: "u" }, amount: "1000", notes: [] }, maxIn: "1000", expectedIn: "1000", quote: { amount: "$1,000.00 (1,000 USDC)", fee: "about $0.01 (0.0021 NEAR)" } });
  assert.equal(reviewAction(usdc, "Send"), "Send $1,000.00");
  assert.equal(totalDollarsFirst(usdc), "$1,000.00 (1,000.00 USDC)");
  const unpriced = review({ quote: { fee: "0.011 NEAR" } });
  assert.equal(reviewAction(unpriced, "Send"), "Send 1.1765 NEAR");
  assert.equal(totalDollarsFirst(unpriced), "up to 1.1875 NEAR");
});
