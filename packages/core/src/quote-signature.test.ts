// 1Click's own signature on a quote (quote-signature.ts; the outside study's item 2): checked with 1Click's real key
// against a real quote, and with the test key against the tampering a relay could try.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuote } from "./intents.ts";
import { ONE_CLICK_QUOTE_KEY, signedBy1Click } from "./quote-signature.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

/**
 * A real quote response, as 1Click's status returned it on 28 Oct 2026 (a public quote, 1 NEAR to USDC, never funded;
 * its recipient and refund are a random account made for the check). Signed by 1Click's own quote key.
 */
const REAL = {
  "timestamp": "2026-10-27T17:30:56.206Z",
  "signature": "ed25519:Sy8BWr8oTzLDHA8SFkANFFmCQP7wFEqmgqZPxcVSgq36nhxYPTUSJtVLDAGGQkDqb4U4cpMTH9TfJ1H5iswcSYY",
  "quoteRequest": {
    "dry": false,
    "swapType": "EXACT_INPUT",
    "depositMode": "SIMPLE",
    "slippageTolerance": 100,
    "originAsset": "nep141:wrap.near",
    "depositType": "INTENTS",
    "destinationAsset": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "amount": "1000000000000000000000000",
    "refundTo": "eefa2582f7054b4813d46d94475f39abd5b74144bb1cf8532de88965cdb5e9a8",
    "refundType": "INTENTS",
    "recipient": "eefa2582f7054b4813d46d94475f39abd5b74144bb1cf8532de88965cdb5e9a8",
    "recipientType": "INTENTS",
    "deadline": "2026-10-27T17:50:55.000Z",
    "appFees": [
      {
        "limitOrderId": null,
        "recipient": "5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd",
        "fee": 20
      }
    ],
    "virtualChainRecipient": null,
    "virtualChainRefundRecipient": null,
    "referral": null,
    "confidentiality": "public"
  },
  "quote": {
    "amountIn": "1000000000000000000000000",
    "amountInFormatted": "1.0",
    "amountInUsd": "4.610000000000",
    "minAmountIn": "1000000000000000000000000",
    "amountOut": "4588691",
    "amountOutFormatted": "4.588691",
    "amountOutUsd": "4.586465484865",
    "minAmountOut": "4542804",
    "timeWhenInactive": "2026-10-30T17:50:55.000Z",
    "depositAddress": "8b513d9c8761018b13a538e4e5b70e899725b88920fdf1fb9100e316e8f48c0b",
    "deadline": "2026-10-30T17:50:55.000Z",
    "timeEstimate": 12,
    "refundFee": "0",
    "withdrawFee": "0"
  }
};

test("a real 1Click quote checks against 1Click's own key, and only that key", () => {
  assert.equal(signedBy1Click(REAL), true);
  assert.equal(signedBy1Click(REAL, ONE_CLICK_QUOTE_KEY), true);
  assert.equal(signedBy1Click(REAL, TEST_QUOTE_KEY), false);
});

test("changing anything that decides where money goes breaks 1Click's signature", () => {
  const thief = "e".repeat(64);
  const changed: [string, unknown][] = [
    ["recipient", { ...REAL, quoteRequest: { ...REAL.quoteRequest, recipient: thief } }],
    ["refund", { ...REAL, quoteRequest: { ...REAL.quoteRequest, refundTo: thief } }],
    ["recipient type", { ...REAL, quoteRequest: { ...REAL.quoteRequest, recipientType: "DESTINATION_CHAIN" } }],
    ["coin out", { ...REAL, quoteRequest: { ...REAL.quoteRequest, destinationAsset: "nep141:wrap.near" } }],
    ["amount in", { ...REAL, quote: { ...REAL.quote, amountIn: "2000000000000000000000000" } }],
    ["minimum out", { ...REAL, quote: { ...REAL.quote, minAmountOut: "1" } }],
    ["deposit address", { ...REAL, quote: { ...REAL.quote, depositAddress: thief } }],
    ["deadline", { ...REAL, quote: { ...REAL.quote, deadline: "2099-01-01T00:00:00.000Z" } }],
    ["timestamp", { ...REAL, timestamp: "2026-10-27T17:30:57.206Z" }],
    ["signature", { ...REAL, signature: REAL.signature.slice(0, -2) + "11" }],
  ];
  for (const [what, r] of changed) assert.equal(signedBy1Click(r), false, what);
});

test("anything unreadable is not signed: missing parts, another kind of key, a bad key", () => {
  for (const r of [null, undefined, "x", {}, { ...REAL, signature: undefined }, { ...REAL, signature: REAL.signature.replace("ed25519:", "secp256k1:") }, { ...REAL, quote: null }, { ...REAL, timestamp: 1 }]) {
    assert.equal(signedBy1Click(r), false, JSON.stringify(r)?.slice(0, 40));
  }
  assert.equal(signedBy1Click(REAL, "ed25519:0OIl"), false);
  assert.equal(signedBy1Click(REAL, "not a key"), false);
});

test("parseQuote believes a status only as 1Click signed it, for the very address being paid", () => {
  const address = REAL.quote.depositAddress;
  const status = { status: "PENDING_DEPOSIT", quoteResponse: REAL };
  const facts = parseQuote(status, address);
  assert.equal(facts?.recipient, REAL.quoteRequest.recipient);
  assert.equal(facts?.amountIn, REAL.quote.amountIn);
  assert.equal(parseQuote(status, "f".repeat(64)), null, "a signed quote for another address vouches for nothing here");
  assert.equal(parseQuote({ ...status, quoteResponse: { ...REAL, quoteRequest: { ...REAL.quoteRequest, recipient: "e".repeat(64) } } }, address), null);
  // A quote signed by any other key (here, the tests' own) is refused by the core's real key.
  const ours = signedQuote({ quoteRequest: REAL.quoteRequest, quote: REAL.quote });
  assert.equal(parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: ours }, address), null);
  assert.ok(parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: ours }, address, TEST_QUOTE_KEY));
  assert.equal(parseQuote(status, ""), null);
});

// Audit T-1 (CRITICAL): 1Click signs a DRY quote over the request and the amounts only. A relay could bolt any deposit
// address and deadline onto a genuine dry quote; the core must believe neither.
test("T-1: a signed DRY quote with a deposit address bolted on is refused everywhere the core reads quotes", async () => {
  const { pocketIntentRefusal } = await import("./private-pocket.ts");
  const FLOAT = "a".repeat(64), ATTACKER = "b".repeat(64);
  const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
  const deadline = new Date(Date.now() + 9 * 60_000).toISOString();
  const quoteRequest = { swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: USDC, amount: "50000000", refundTo: FLOAT, refundType: "CONFIDENTIAL_INTENTS", recipient: FLOAT, recipientType: "CONFIDENTIAL_INTENTS", deadline };
  const amounts = { amountIn: "50000000", amountInFormatted: "50", amountInUsd: "50", minAmountIn: "50000000", amountOut: "49900000", amountOutFormatted: "49.9", amountOutUsd: "49.9", minAmountOut: "49400000" };
  // The auditor's PoC: genuinely signed (dry), then the relay attaches its own address and a deadline.
  const dry = signedQuote({ quoteRequest: { dry: true, ...quoteRequest }, quote: amounts });
  assert.ok(signedBy1Click(dry, TEST_QUOTE_KEY), "the dry quote itself is genuinely signed");
  const forged = { status: "PENDING_DEPOSIT", quoteResponse: { ...dry, quote: { ...dry.quote, depositAddress: ATTACKER, deadline } } };
  assert.equal(parseQuote(forged, ATTACKER, TEST_QUOTE_KEY), null, "a dry quote never vouches for a deposit address");
  const payload = { message: JSON.stringify({ deadline, intents: [{ intent: "transfer", receiver_id: ATTACKER, tokens: { [`imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`]: "50000000" } }], signer_id: FLOAT }), nonce: Buffer.alloc(32, 1).toString("base64"), recipient: "intents.far" };
  assert.ok(pocketIntentRefusal(payload, parseQuote(forged, ATTACKER, TEST_QUOTE_KEY), ATTACKER, FLOAT, Date.now()), "the pocket and the float refuse to sign it");
  // `dry` missing reads as dry: refused too.
  const unsaid = signedQuote({ quoteRequest, quote: { ...amounts, depositAddress: ATTACKER, deadline } });
  assert.equal(parseQuote({ status: "PENDING_DEPOSIT", quoteResponse: unsaid }, ATTACKER, TEST_QUOTE_KEY), null);

  // A real quote (dry: false) signs its address and deadline: believed, for that address only.
  const address = "c".repeat(64);
  const real = (req: Record<string, unknown> = {}, q: Record<string, unknown> = {}, timestamp?: string) =>
    ({ status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: { dry: false, ...quoteRequest, ...req }, quote: { ...amounts, depositAddress: address, deadline, ...q } }, timestamp) });
  assert.equal(parseQuote(real(), address, TEST_QUOTE_KEY)?.deadline, deadline);
  // The deadline is the signed quote's own, never the request's.
  assert.equal(parseQuote(real({ deadline: "2099-01-01T00:00:00.000Z" }), address, TEST_QUOTE_KEY)?.deadline, deadline);
  assert.equal(parseQuote(real({}, { deadline: undefined }), address, TEST_QUOTE_KEY), null, "no signed deadline, no quote");
  // Anything that sends money or a message elsewhere: refused.
  for (const extra of [{ referral: "someone" }, { virtualChainRecipient: "0xabc" }, { virtualChainRefundRecipient: "0xabc" }, { customRecipientMsg: "hi" }]) {
    assert.equal(parseQuote(real(extra), address, TEST_QUOTE_KEY), null, JSON.stringify(extra));
  }
  // The timestamp is bounded: not from the future, and the deadline within 4 days of it.
  assert.equal(parseQuote(real({}, {}, new Date(Date.now() + 60 * 60_000).toISOString()), address, TEST_QUOTE_KEY), null, "a timestamp an hour ahead");
  assert.equal(parseQuote(real({}, { deadline: new Date(Date.now() + 5 * 86_400_000).toISOString() }), address, TEST_QUOTE_KEY), null, "a deadline 5 days out");
  assert.equal(parseQuote(real({}, {}, "not a time"), address, TEST_QUOTE_KEY), null);
});
