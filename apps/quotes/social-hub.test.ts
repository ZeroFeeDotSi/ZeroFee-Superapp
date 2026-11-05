// Social Trading's confidential legs (2 Nov): the exact quote shapes the core asks for a site's own wallet, pinned here so a
// later change to the relay can't close them. Probed on the live relay the same evening (dry quotes, nothing signed):
// every leg below answered 201, and the one-hop shape at the end answered 400.
//
//   Add:       the Safe's USDC (or NEAR, case d) → Spending's confidential balance → the site's wallet on Solana
//   Move back: the site's wallet on Solana → Spending's confidential balance (a refund comes back there too) → the Safe
//
// So the hub needs no change to the relay: no step is a public hop from the Safe to a site wallet, and none refunds to
// a public wallet. The one-hop shape (the site's SOL straight to the Safe, its refund back on Solana) stays refused.
import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore: plain JS, deployed as is (no build step)
import { APP_ORIGINS, UPSTREAM, createRelay } from "./relay.mjs";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** Spending's confidential balance (the core's trade/near float): a 64-hex implicit account. */
const SPENDING = "3f1c" + "0".repeat(56) + "beef";
/** A site's own wallet on Solana (core site-wallets.ts: "From your pump.fun wallet"). */
const SITE_WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SAFE = "zf-0123456789.near";
const base = { dry: false, slippageTolerance: 100, deadline: "2026-11-03T00:00:00.000Z", confidentiality: "basic", refundTo: SPENDING, refundType: "CONFIDENTIAL_INTENTS" };

/** The shapes, as packages/core/src/float-moves.ts builds them (quoteAdd, fromFloat for out and home, inNow). */
const LEGS = {
  "Add 1: the Safe's USDC into Spending (quoteAdd)": { ...base, swapType: "EXACT_INPUT", originAsset: USDC, depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount: "10000000", recipient: SPENDING, recipientType: "CONFIDENTIAL_INTENTS" },
  "Add 1: the Safe's NEAR into Spending as USDC (quoteAdd, case d)": { ...base, swapType: "EXACT_INPUT", originAsset: "nep141:wrap.near", depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount: "2000000000000000000000000", recipient: SPENDING, recipientType: "CONFIDENTIAL_INTENTS" },
  "Add 2: Spending to the site's wallet on Solana (fromFloat out)": { ...base, swapType: "EXACT_OUTPUT", originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: "nep141:sol.omft.near", amount: "60000000", recipient: SITE_WALLET, recipientType: "DESTINATION_CHAIN" },
  "Move back 1: the site's wallet into Spending (inNow)": { ...base, swapType: "EXACT_INPUT", originAsset: "nep141:sol.omft.near", depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount: "60000000", recipient: SPENDING, recipientType: "CONFIDENTIAL_INTENTS" },
  "Move back 2: Spending to the Safe (fromFloat home)": { ...base, swapType: "EXACT_INPUT", originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: USDC, amount: "9500000", recipient: SAFE, recipientType: "INTENTS" },
};

function relay() {
  const sent: string[] = [];
  const fetchFn = async (url: string, init: RequestInit) => {
    sent.push(String(init.body ?? ""));
    return new Response(JSON.stringify({ quote: { depositAddress: "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba", amountIn: "1", amountInUsd: "9.990000" }, quoteRequest: {} }), { status: 201 });
  };
  const r = createRelay({ key: "partner-key-SECRET", secret: "tag-secret", origins: [...APP_ORIGINS], fetchFn });
  const post = (body: unknown) => r(new Request("https://quotes.example/api/relay?route=quote", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "zerofee-app://app" } }), "203.0.113.9");
  return { sent, post };
}

test("Social Trading: every confidential leg of Add and Move back passes the relay, sent to 1Click as asked", async () => {
  for (const [name, leg] of Object.entries(LEGS)) {
    const { sent, post } = relay();
    const r = await post(leg);
    assert.equal(r.status, 201, name);
    assert.equal(sent.length, 1, `${name}: forwarded once`);
    assert.deepEqual(JSON.parse(sent[0]!), leg, `${name}: forwarded exactly`);
  }
  assert.equal(UPSTREAM, "https://1click.chaindefuser.com/v0");
});

test("Social Trading: no public hop and no public refund. The one-hop move back and its near misses are refused before 1Click", async () => {
  const back = LEGS["Move back 1: the site's wallet into Spending (inNow)"];
  const out = LEGS["Add 2: Spending to the site's wallet on Solana (fromFloat out)"];
  const refusedShapes = {
    "the site's SOL straight to the Safe, refunded on Solana": { ...back, recipient: SAFE, recipientType: "INTENTS", refundTo: SITE_WALLET, refundType: "ORIGIN_CHAIN" },
    "a move back refunded to the site's wallet on Solana": { ...back, refundTo: SITE_WALLET, refundType: "ORIGIN_CHAIN" },
    "a move back that pays somewhere other than Spending": { ...back, recipient: "a2".repeat(32) },
    "a move back not confidential": { ...back, confidentiality: "public" },
    "an Add straight from the Safe to the site's wallet (a public hop)": { ...out, depositType: "ORIGIN_CHAIN" },
    "an Add whose refund goes to a named account": { ...out, refundTo: SAFE, refundType: "INTENTS" },
    "GMGN's Base wallet back into Spending (not a leg yet: the hub moves Solana wallets only)": { ...back, originAsset: "nep141:base.omft.near" },
  };
  for (const [name, shape] of Object.entries(refusedShapes)) {
    const { sent, post } = relay();
    const r = await post(shape);
    assert.equal(r.status, 400, name);
    assert.equal(sent.length, 0, `${name}: never reaches 1Click`);
  }
});
