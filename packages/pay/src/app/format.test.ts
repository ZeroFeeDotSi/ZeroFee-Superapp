import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateWords, screenDecimals, seconds, shown, shownFor, totalWithFee, youPay } from "./format.ts";
import type { Confirm } from "../pay.ts";

test("amounts read the way people write money", () => {
  assert.equal(shown("1240.5", 2), "1,240.50");
  assert.equal(shown("4.2", 2), "4.20");
  assert.equal(shown("4.2084", 2, "up"), "4.21", "an 'at most' rounds up, never under-states");
  assert.equal(shown("0.0123", 6), "0.0123");
  assert.equal(shown("1000000", 2), "1,000,000.00");
  assert.equal(screenDecimals({ symbol: "USDC", decimals: 6 }), 2);
  assert.equal(screenDecimals({ symbol: "EURe", decimals: 18 }), 2);
  assert.equal(screenDecimals({ symbol: "wNEAR", decimals: 24 }), 6);
  assert.equal(seconds(9420), "9.4 s");
});

const base = {
  payee: "Kiosk", labelFromCode: true, payeePlain: "x", payeeFull: "x", network: "Solana", alternatives: [], inSymbol: "USDC", feeNote: "Network fee to send it out.",
  target: { to: { kind: "chain", chain: "sol", address: "x" }, token: { assetId: "a", chain: "sol", symbol: "USDC", decimals: 6, contract: "m" }, amount: "4.2", notes: [] },
} as const;

test("You pay: a same-coin payout shows the amount plus its network fee, exactly", () => {
  const c = { ...base, source: { balance: { amount: "42.1" }, route: "quote", sameCoin: true }, maxIn: "4.23", expectedIn: "4.23" } as unknown as Confirm;
  assert.deepEqual(youPay(c), { value: "4.23 USDC", detail: "4.20 + 0.03 network fee" });
});

test("You pay: nothing on top still names NEAR's own fee, the sheet's figure, never 'No network fee' (grade 02f, F1)", () => {
  const c = { ...base, source: { balance: { amount: "42.1" }, route: "quote", sameCoin: true }, maxIn: "4.2", expectedIn: "4.2", quote: { fee: "0.011 NEAR" } } as unknown as Confirm;
  assert.deepEqual(youPay(c), { value: "4.20 USDC", detail: "Fee: at most 0.011 NEAR" });
  const unread = { ...c, quote: {} } as unknown as Confirm;
  assert.deepEqual(youPay(unread), { value: "4.20 USDC", detail: "Network fee to send it out." });
});

test("the review's one total: a NEAR fee on a NEAR payment is added (rounded up); a fee in another coin isn't (the UX walk, 2 Nov)", () => {
  const near = { ...base, inSymbol: "NEAR", source: { balance: { amount: "9" }, route: "quote", sameCoin: true }, maxIn: "7.2073", expectedIn: "7.2073", target: { ...base.target, amount: "7.2073" }, quote: { fee: "about $0.05 (0.011 NEAR)" } } as unknown as Confirm;
  assert.equal(totalWithFee(near), "up to 7.2183 NEAR");
  assert.equal(totalWithFee({ ...near, inSymbol: "USDC" } as Confirm), null, "a NEAR fee on a USDC payment isn't added to it");
  assert.equal(totalWithFee({ ...near, quote: {} } as unknown as Confirm), null, "no figure for the fee: no made-up total");
});

test("You pay: a conversion says 'up to', its fee in dollars, and that the rest comes back", () => {
  const c = { ...base, source: { balance: { amount: "1240.5" }, route: "quote", sameCoin: false }, maxIn: "4.5", expectedIn: "4.47", feeUsd: "0.27" } as unknown as Confirm;
  assert.deepEqual(youPay(c), { value: "up to 4.50 USDC", detail: "Includes about $0.27 in fees. Anything unused comes back." });
});

test("an amount that is paid exactly is never rounded on screen", () => {
  const usdc = base.target.token as unknown as Parameters<typeof shownFor>[1];
  assert.equal(shownFor("1.999999", usdc), "1.999999", "a 1.999999 USDC code never reads as 1.99");
  assert.equal(shownFor("4.2", usdc), "4.20");
  assert.equal(shownFor("4.200", usdc), "4.20");
});

test("Before you start prices Pay's own move in dollars from a live quote, never a coin's decimals (UI's gap list)", () => {
  assert.equal(estimateWords({ feeUsd: "0.0024", etaSeconds: 12 }), "Sending $5 there from ZeroFee costs under 1 cent now and takes about a minute (an estimate).");
  assert.equal(estimateWords({ feeUsd: "0.27", etaSeconds: 240 }), "Sending $5 there from ZeroFee costs about $0.27 now and takes about 4 minutes (an estimate).");
  assert.equal(estimateWords({ feeUsd: "0" }), "Sending $5 there from ZeroFee costs nothing now (an estimate).");
  assert.equal(estimateWords({ feeUsd: "1.2", etaSeconds: 3600 }), "Sending $5 there from ZeroFee costs about $1.20 now and can take longer (an estimate).");
});

test("grade 02h, H1: Send's review and Sent say the sheet's own dollars; none when the sheet says none", async () => {
  const { paymentDollars } = await import("./format.ts");
  const token = { assetId: "nep141:wrap.near", chain: "near", symbol: "NEAR", decimals: 24, contract: "wrap.near", priceUsd: "4.2802" };
  const base = { target: { amount: "7.1049", token } } as never as Parameters<typeof paymentDollars>[0];
  const withQuote = (quote: object) => ({ ...(base as object), quote }) as Parameters<typeof paymentDollars>[0];
  assert.equal(paymentDollars(withQuote({ fee: "0.011 NEAR", amount: "about $30.34 (7.1049 NEAR)" })), "about $30.34");
  assert.equal(paymentDollars(withQuote({ fee: "0.011 NEAR", amount: "$5.00 (5 USDC)" })), "$5.00");
  // The sheet's words were read and carry no figure (a step it can't price, 669aa4fd): the review says none either.
  assert.equal(paymentDollars(withQuote({ fee: "0.011 NEAR" })), null);
  // No sheet words read (several approvals): the list's price, as before.
  assert.equal(paymentDollars(base), "about $30.41");
});
