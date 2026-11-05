// J6, dollars first (audit 2 Nov, B6: the Approve sheet's title was "Send 1.1765 NEAR to alex.near", the dollars only in
// a sub-line). A sheet's title leads with the dollars when its amount has them, the exact coin figure after them in
// brackets: "Send $5.00 (1.1765 NEAR) to alex.near". No price: the coin alone, as before. Several steps: their own words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toBase58 } from "@fastnear/utils";
import { SoftwareKey } from "./device-key.ts";
import { serialize } from "./tx-build.ts";
import type { CoreAction } from "./tx-build.ts";
import { decodeTransaction } from "./tx-decode.ts";
import { dollarsFirstTitle, dollarTwin, plainWords, titleMoney } from "./words.ts";
import type { WordsContext } from "./words.ts";

const key = SoftwareKey.generate();
const NEAR = 10n ** 24n;
const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const decoded = (actions: CoreAction[], receiverId = "alex.near") =>
  decodeTransaction(serialize({ signerId: "zf-0123456789.near", publicKey: key.publicKey, nonce: 7n, receiverId, blockHash: toBase58(new Uint8Array(32).fill(9)), actions }));
const call = (method: string, args: object, deposit = 1n): CoreAction => ({ kind: "call", method, args: new TextEncoder().encode(JSON.stringify(args)), gas: 30_000_000_000_000n, depositYocto: deposit });
// 1.1765 NEAR at $4.25 is $5.00.
const ctx: WordsContext = { network: "mainnet", balanceYocto: 10n * NEAR, gasPriceYocto: 100_000_000n, knownRecipients: new Set(["alex.near"]), nearUsd: 4.25 };
const send = decoded([{ kind: "transfer", yocto: (11765n * NEAR) / 10_000n }]);

test("J6: a NEAR send's title leads with dollars, the exact NEAR after them; its Amount line keeps 'about'", () => {
  const w = plainWords(send, ctx);
  assert.equal(w.title, "Send $5.00 (1.1765 NEAR) to alex.near");
  assert.equal(w.amount, "about $5.00 (1.1765 NEAR)");
  // Said once: the step's own line ("Send 1.1765 NEAR to alex.near") would repeat the title, so it goes.
  assert.ok(!w.lines.some((l) => l.startsWith("Send ")), w.lines.join(" | "));
  // The exact coin figure is on the sheet, every digit (a figure with more digits than 4 keeps them all).
  const odd = plainWords(decoded([{ kind: "transfer", yocto: 1_176_543_210_000_000_000_000_000n }]), ctx);
  assert.match(odd.title, /^Send \$5\.00 \(1\.17654321 NEAR\) to alex\.near$/);
});

test("J6: no price, the coin alone (never a made-up dollar figure); the step line still goes", () => {
  const w = plainWords(send, { ...ctx, nearUsd: null });
  assert.equal(w.title, "Send 1.1765 NEAR to alex.near");
  assert.equal(w.amount, undefined);
  assert.ok(!w.lines.includes("Send 1.1765 NEAR to alex.near"));
});

test("J6: a dollar coin's send says its figure once (5 Nov: never \"$5.00 (5 USDC)\"); a coin with no price stays in the coin", () => {
  const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }], ["meme.near", { symbol: "MEME", decimals: 18 }]]) };
  const w = plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "5000000" })], USDC), { ...ctx, coins });
  assert.equal(w.title, "Send 5 USDC to bob.near");
  assert.equal(w.amount, "$5.00 (5 USDC)", "the Amount line keeps its dollars");
  assert.equal(plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: "5000000000000000000" })], "meme.near"), { ...ctx, coins }).title, "Send 5 MEME to bob.near");
});

test("J6: several steps keep their own words: one total is never pinned on the first step", () => {
  const two = decoded([{ kind: "transfer", yocto: NEAR }, { kind: "transfer", yocto: NEAR }]);
  const w = plainWords(two, ctx);
  assert.equal(w.title, "Send 1 NEAR to alex.near, and 1 more step");
  assert.equal(w.amount, "about $8.50 (1 NEAR and 1 NEAR)");
});

test("J6: the app's own words are dropped when they only say the title again, in coin words or in dollars", () => {
  assert.equal(plainWords(send, { ...ctx, hint: "Wallet says: Send 1.1765 NEAR to alex.near" }).hint, undefined);
  assert.equal(plainWords(send, { ...ctx, hint: "Wallet says: Send $5.00 (1.1765 NEAR) to alex.near" }).hint, undefined);
  assert.equal(plainWords(send, { ...ctx, hint: "Wallet says: lunch" }).hint, "Wallet says: lunch");
});

test("J6 review, L1: a dollar coin's figure is exact only when the cents say every digit; under a cent says so", () => {
  const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }]]) };
  const usdc = (units: string) => plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: units })], USDC), { ...ctx, coins });
  assert.equal(usdc("5009000").title, "Send $5.01 (5.009 USDC) to bob.near");
  assert.equal(usdc("5009000").amount, "about $5.01 (5.009 USDC)");
  assert.equal(usdc("4000").title, "Send under $0.01 (0.004 USDC) to bob.near");
  assert.equal(usdc("5000000").amount, "$5.00 (5 USDC)", "control: a whole figure stays exact");
});

test("J6: titleMoney reads one priced coin, nothing else", () => {
  assert.equal(titleMoney("about $5.00 (1.1765 NEAR)"), "$5.00 (1.1765 NEAR)");
  assert.equal(titleMoney("$1,000.00 (1,000 USDC)"), "$1,000.00 (1,000 USDC)");
  assert.equal(titleMoney("under $0.01 (0.0001 NEAR)"), "under $0.01 (0.0001 NEAR)");
  assert.equal(titleMoney("about $6.80 (2.5 USDC and 1 NEAR)"), null, "several coins: no one figure");
  assert.equal(titleMoney(undefined), null);
  assert.equal(titleMoney("5 NEAR"), null);
});

test("J6: dollarsFirstTitle puts dollars only before the amount's own coin figure, as a whole word, once", () => {
  const a = "about $5.00 (1.1765 NEAR)";
  assert.equal(dollarsFirstTitle("Send 1.1765 NEAR to alex.near", a), "Send $5.00 (1.1765 NEAR) to alex.near");
  assert.equal(dollarsFirstTitle("Stake 1.1765 NEAR", a), "Stake $5.00 (1.1765 NEAR)");
  // Controls: a longer number, a different figure, the figure twice, no amount: the title as it was.
  assert.equal(dollarsFirstTitle("Send 11.1765 NEAR to alex.near", a), "Send 11.1765 NEAR to alex.near");
  assert.equal(dollarsFirstTitle("Send 1.17651 NEAR to alex.near", a), "Send 1.17651 NEAR to alex.near");
  assert.equal(dollarsFirstTitle("Send 1.1765 NEAR to 1.1765 NEAR", a), "Send 1.1765 NEAR to 1.1765 NEAR");
  assert.equal(dollarsFirstTitle("Send 1.1765 NEAR to alex.near", undefined), "Send 1.1765 NEAR to alex.near");
  // A step that names what arrives (a Top up) says what leaves through its own title.
  assert.equal(dollarsFirstTitle("Top up Trading with about 21.0 USDC", "about $21.04 (21.0412 USDC)", (m) => `Top up Trading with ${m}`), "Top up Trading with $21.04 (21.0412 USDC)");
});

test("a coin with a dollar sign in its name never leads a title with dollars (J6 review, open item)", () => {
  assert.equal(titleMoney("about $5.00 ($5 SCAM)"), null);
  assert.equal(dollarsFirstTitle("Send 5 $5 to x.near", "about $5.00 (5 $5)"), "Send 5 $5 to x.near");
  // control: a plain coin still does
  assert.equal(titleMoney("about $5.00 (1.1765 NEAR)"), "$5.00 (1.1765 NEAR)");
});

test("a coin part that isn't one figure and a plain symbol never leads with dollars (Job 1 review, L5)", () => {
  for (const coin of ["5 \uFF04X", "5 \u{1F4B2}", "5 US\u202EDC", "5 USD\u200BC", "5 a b"]) assert.equal(titleMoney(`about $5.00 (${coin})`), null, JSON.stringify(coin));
  assert.equal(titleMoney("$5.00 (5 USDC)"), "$5.00 (5 USDC)", "control");
});

test("a swap step that sameMoney turned down keeps its coin words even when the figures happen to match (Job 1 review, L3)", () => {
  assert.equal(dollarsFirstTitle("Move about 10 USDC to Trading", "about $10.00 (10 USDC)", null), "Move about 10 USDC to Trading");
  // control: without the step's word, the fallback match would have put the dollars in
  assert.equal(dollarsFirstTitle("Move 10 USDC to Trading", "about $10.00 (10 USDC)"), "Move $10.00 (10 USDC) to Trading");
});

test("a dollar coin said once in the title only when it is one by its contract and its dollars are its figure to the cent (controls)", () => {
  const FAKE = "fake-usdc.near";
  const coins = { pools: new Map(), coins: new Map([[USDC, { symbol: "USDC", decimals: 6 }], [FAKE, { symbol: "USDC", decimals: 6 }]]) };
  const send = (contract: string, units: string) => plainWords(decoded([call("ft_transfer", { receiver_id: "bob.near", amount: units })], contract), { ...ctx, coins });
  assert.equal(send(USDC, "5200000").title, "Send 5.2 USDC to bob.near");
  // controls: a figure with more than cents keeps its dollars in front; a coin only named USDC is never a dollar coin here
  assert.equal(send(USDC, "5009000").title, "Send $5.01 (5.009 USDC) to bob.near");
  assert.equal(send(FAKE, "5200000").title, "Send 5.2 USDC to bob.near", "an unpriced coin keeps its coin words, as before");
  assert.equal(send(FAKE, "5200000").amount, undefined, "and no dollars at all");
});

test("dollarTwin: one dollar coin at its dollar, to the cent; off its dollar, two coins, or by its name alone: null (controls)", () => {
  assert.equal(dollarTwin([{ coin: "5.20 USDC", usd: 5.2, exact: false, dollar: true }, null]), "5.20 USDC");
  assert.equal(dollarTwin([{ coin: "1,250 USDT", usd: 1250, exact: true, dollar: true }]), "1,250 USDT");
  assert.equal(dollarTwin([{ coin: "5.20 USDC", usd: 5.19, exact: false, dollar: true }]), null, "a quote off its dollar keeps the dollars");
  assert.equal(dollarTwin([{ coin: "5.20 USDC", usd: 5.2, exact: false }]), null, "a coin named USDC that isn't one");
  assert.equal(dollarTwin([{ coin: "5.2034 USDC", usd: 5.2, exact: false, dollar: true }]), null, "more than cents");
  assert.equal(dollarTwin([{ coin: "5 USDC", usd: 5, exact: true, dollar: true }, { coin: "1 NEAR", usd: 4, exact: false }]), null, "two payments");
  assert.equal(dollarTwin([{ coin: "5 USDC", usd: null, exact: false, dollar: true }]), null, "no dollars read");
});
