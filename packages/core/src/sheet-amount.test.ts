// Grade 02g, G11: no approval sheet said the payment in dollars ("Send 0.01 NEAR to guest-book.testnet" with only the fee
// in $). Every sheet that pays or sends says it in dollars now, the coin amount after them, from the decoded bytes; with
// no price, no dollar figure is made up. E16: the asking app's words are dropped when they only say the title again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "./device-key.ts";
import { serialize } from "./tx-build.ts";
import type { CoreAction } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import { plainWords, plainWordsMany } from "./words.ts";
import type { WordsContext } from "./words.ts";

const key = SoftwareKey.generate();
const NEAR = 10n ** 24n;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const decoded = (actions: CoreAction[], receiverId = "guest-book.testnet") =>
  decodeTransaction(serialize({ signerId: "alice.testnet", publicKey: key.publicKey, nonce: 7n, receiverId, blockHash: toBase58(new Uint8Array(32).fill(9)), actions }));
const ctx: WordsContext = { network: "testnet", balanceYocto: 10n * NEAR, gasPriceYocto: 100_000_000n, knownRecipients: new Set(["guest-book.testnet"]), nearUsd: 4.3 };
const call = (method: string, args: object, deposit = 1n): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas: 30_000_000_000_000n, depositYocto: deposit });

test("G11: a NEAR send says its dollars at the sheet's price, then the NEAR", () => {
  const w = plainWords(decoded([{ kind: "transfer", yocto: NEAR / 100n }]), ctx);
  assert.equal(w.amount, "about $0.04 (0.01 NEAR)");
  assert.equal(plainWords(decoded([{ kind: "transfer", yocto: (71631n * NEAR) / 10_000n }]), ctx).amount, "about $30.80 (7.1631 NEAR)");
  assert.equal(plainWords(decoded([{ kind: "transfer", yocto: NEAR / 10_000n }]), ctx).amount, "under $0.01 (0.0001 NEAR)");
});

test("G11: with no price, no dollar figure; a change to the account's own rules pays nothing", () => {
  assert.equal(plainWords(decoded([{ kind: "transfer", yocto: NEAR }]), { ...ctx, nearUsd: null }).amount, undefined);
  assert.equal(plainWords(decoded([call("set_protection", { bands: [] }, 0n)], "alice.testnet"), ctx).amount, undefined);
});

test("G11: a dollar coin is said exactly; a coin with no price leaves the amount out", () => {
  const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }], ["meme.near", { symbol: "MEME", decimals: 18 }]]) };
  const usdc = plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "5000000" })], USDC), { ...ctx, coins });
  assert.equal(usdc.amount, "$5.00 (5 USDC)");
  const meme = plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "5000000000000000000" })], "meme.near"), { ...ctx, coins });
  assert.equal(meme.amount, undefined, "control: no price for MEME, so no dollars");
});

test("G11: several steps add up; the 1-yocto deposit of a coin send is not a payment of NEAR", () => {
  const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }]]) };
  const a = decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "2500000" })], USDC);
  const b = decoded([{ kind: "transfer", yocto: NEAR }], "bob.near");
  const outer = decoded([{ kind: "transfer", yocto: 1n }], "alice.testnet");
  const many = plainWordsMany([{ tx: a, ctx: { ...ctx, coins } }, { tx: b, ctx }], outer, ctx);
  assert.equal(many.amount, "about $6.80 (2.5 USDC and 1 NEAR)");
});

test("E16: 'Wallet says' is dropped when it only repeats the title, kept when it adds something", () => {
  const send = decoded([{ kind: "transfer", yocto: NEAR / 100n }]);
  assert.equal(plainWords(send, { ...ctx, hint: "Wallet says: Send 0.01 NEAR to guest-book.testnet" }).hint, undefined);
  assert.equal(plainWords(send, { ...ctx, hint: "Wallet says: lunch" }).hint, "Wallet says: lunch");
});

// Security review 2 Nov: the amount was the sum of the steps it could read, so a step it couldn't (an mt_batch_transfer,
// an unknown coin's ft_transfer) went unsaid: "Amount: $1.00 (1 USDC)" over 1 USDC to bob and 10,000 USDC to eve.
const SOL = "sol.omft.near";
const intentsCtx = (quotes = new Map()): WordsContext => ({
  ...ctx,
  network: "mainnet",
  intents: { codeMatches: true, tokens: new Map([[USDC, { symbol: "USDC", decimals: 6 }], [SOL, { symbol: "SOL", decimals: 9 }]]), balances: new Map(), quotes },
});

test("review 2 Nov: a step whose payment can't be read or priced leaves the whole amount out, never the other steps' sum", () => {
  const one = call("mt_transfer", { receiver_id: "bob.near", token_id: `nep141:${USDC}`, amount: "1000000" });
  assert.equal(plainWords(decoded([one], "intents.near"), intentsCtx()).amount, "$1.00 (1 USDC)", "control: the payment alone is said");
  const batch = call("mt_batch_transfer", { receiver_id: "eve.near", token_ids: [`nep141:${USDC}`], amounts: ["10000000000"] });
  assert.equal(plainWords(decoded([one, batch], "intents.near"), intentsCtx()).amount, undefined);

  const near = decoded([{ kind: "transfer", yocto: NEAR / 100n }], "bob.near");
  const outer = decoded([{ kind: "transfer", yocto: 1n }], "alice.testnet");
  const unknownCoin = decoded([call("ft_transfer", { receiver_id: "eve.near", amount: "1000000000" })], "some-coin.near");
  assert.equal(plainWordsMany([{ tx: near, ctx }, { tx: unknownCoin, ctx }], outer, ctx).amount, undefined, "an unknown coin's 1-yocto transfer");
  const nft = decoded([call("nft_transfer", { receiver_id: "eve.near", token_id: "7" })], "art.near");
  assert.equal(plainWordsMany([{ tx: near, ctx }, { tx: nft, ctx }], outer, ctx).amount, undefined, "an NFT's transfer");
  const note = decoded([call("add_message", { text: "hi" }, 0n)], "guest-book.testnet");
  assert.equal(plainWordsMany([{ tx: near, ctx }, { tx: note, ctx }], outer, ctx).amount, "about $0.04 (0.01 NEAR)", "control: a call with no deposit moves nothing");
});

test("review 2 Nov: a 1Click quote's dollars only for the step matched to it, at its exact amount", () => {
  const D = "a".repeat(64);
  const quote = { status: "PENDING_DEPOSIT", originAsset: `nep141:${SOL}`, amountIn: "1000000000", amountInUsd: "150.00", refundTo: "alice.testnet", refundType: "INTENTS", destinationAsset: `nep141:${USDC}`, minAmountOut: "149000000", recipient: "x", recipientType: "DESTINATION_CHAIN", deadline: "", depositType: "INTENTS", swapType: "EXACT_INPUT", amountOut: "149500000" };
  const quotes = new Map([[D, quote]]);
  const paid = call("mt_transfer", { receiver_id: D, token_id: `nep141:${SOL}`, amount: "1000000000" });
  assert.equal(plainWords(decoded([paid], "intents.near"), intentsCtx(quotes)).amount, "about $150.00 (1 SOL)", "control: the matched step at the quote's dollars");
  const more = call("mt_transfer_call", { receiver_id: D, token_id: `nep141:${SOL}`, amount: "100000000000", msg: "" });
  assert.equal(plainWords(decoded([paid, more], "intents.near"), intentsCtx(quotes)).amount, undefined, "100 SOL more to the same address is not the quote's $150");
  const other = call("mt_transfer", { receiver_id: D, token_id: `nep141:${SOL}`, amount: "100000000000" });
  assert.equal(plainWords(decoded([other], "intents.near"), intentsCtx(quotes)).amount, undefined, "an amount the quote doesn't say is never priced by it");
});

// Finding 16 (real money, 4 Nov): a $6 Move Safe → SOL said "about $12.00 (1.467 NEAR and 1.467 wNEAR)": wrapping at
// wrap.near was counted as a payment, then the wNEAR it made was counted again. What leaves is counted once.
test("finding 16: wrapping NEAR then sending the wNEAR is one payment, not two", () => {
  const coins = { pools: new Map(), coins: new Map([["wrap.near", { symbol: "wNEAR", decimals: 24 }]]) };
  const wrapThenSend = decoded([call("near_deposit", {}, NEAR), call("ft_transfer", { receiver_id: "bob.near", amount: String(NEAR) })], "wrap.near");
  assert.equal(plainWords(wrapThenSend, { ...ctx, coins }).amount, "about $4.30 (1 wNEAR)");
  const wrapOnly = decoded([call("near_deposit", {}, NEAR)], "wrap.near");
  assert.equal(plainWords(wrapOnly, { ...ctx, coins }).amount, undefined, "wrapping alone moves nothing out");
  const elsewhere = decoded([call("near_deposit", {}, NEAR)], "not-wrap.near");
  assert.equal(plainWords(elsewhere, { ...ctx, coins }).amount, "about $4.30 (1 NEAR)", "control: near_deposit on any other contract pays it");
});
