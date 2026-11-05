import { test } from "node:test";
import assert from "node:assert/strict";
import { requestLink } from "../request.ts";
import { TokenDirectory } from "../tokens.ts";
import { RECORDED_TOKENS } from "../testing/recorded-tokens.ts";
import { emv, field as f } from "../testing/emv.ts";
import { fullyNamed, prefillFromLink } from "./links.ts";
import type { Balance } from "@zerofee/wallet/types.ts";

const tokens = new TokenDirectory(RECORDED_TOKENS);
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

test("a link with only who and a note fills Send in; the payer picks coin and amount", () => {
  const link = requestLink({ to: "kim.near", note: "Into Trip" });
  assert.equal(link, "zerofee:pay?v=1&to=kim.near&note=Into+Trip");
  assert.deepEqual(prefillFromLink(link, tokens, "me.near"), {
    ok: { recipient: { kind: "ledger", accountId: "kim.near" }, amount: undefined, tokenId: undefined, note: "Into Trip", ref: undefined },
  });
});

test("a request with an amount and a coin fills those in too", () => {
  const r = prefillFromLink(requestLink({ to: "alex.near", amount: "12.5", token: USDC_NEAR }), tokens);
  assert.ok("ok" in r);
  assert.equal(r.ok.amount, "12.5");
  assert.equal(r.ok.tokenId, USDC_NEAR);
});

test("a crypto payment code works as a link: the address, and the amount in the coin's own units", () => {
  const r = prefillFromLink("ethereum:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913@8453/transfer?address=0x2527D02599Ba641c19FEa793cD0F167589a0f10D&uint256=12.5e6", tokens);
  assert.ok("ok" in r);
  assert.deepEqual(r.ok.recipient, { kind: "address", chain: "base", candidates: ["base"], address: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D" });
  assert.equal(r.ok.amount, "12.5");
  assert.equal(r.ok.label, undefined);
});

test("a link's own label stays the link's words (label), never a name Send treats as a contact", () => {
  const r = prefillFromLink("near:evil.near?label=Mum&amount=50", tokens);
  assert.ok("ok" in r, JSON.stringify(r));
  assert.equal(r.ok.label, "Mum");
  assert.equal("name" in r.ok, false);
});

test("a link in a coin the ledger doesn't list is refused: its amount is never filled in another coin", () => {
  const unknown = "solana:13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK?amount=500&spl-token=So11111111111111111111111111111111111111112";
  assert.equal((prefillFromLink(unknown, tokens) as { problem: { code: string } }).problem.code, "pay.code.coin-unsupported");
  const request = requestLink({ to: "alex.near", amount: "500", token: "nep141:not-a-listed-coin.near" });
  assert.equal((prefillFromLink(request, tokens) as { problem: { code: string } }).problem.code, "pay.code.coin-unsupported");
  // A request with an amount but no coin asks in USDC, as a scan of it does.
  const usdc = prefillFromLink(requestLink({ to: "alex.near", amount: "5" }), tokens);
  assert.ok("ok" in usdc && usdc.ok.tokenId === USDC_NEAR);
});

test("a link Send can't use is a Problem to show, never silently ignored", () => {
  const pix = emv(f("00", "01"), f("26", f("00", "br.gov.bcb.pix") + f("01", "k")), f("53", "986"), f("58", "BR"), f("59", "LOJA"));
  assert.equal((prefillFromLink(pix, tokens) as { problem: { code: string } }).problem.code, "pay.code.bank-only");
  assert.equal((prefillFromLink("zerofee:pay?v=1&to=NOT%20A%20NAME", tokens) as { problem: { code: string } }).problem.code, "pay.request.invalid");
  assert.equal((prefillFromLink("nonsense", tokens) as { problem: { code: string } }).problem.code, "pay.code.unreadable");
  assert.equal((prefillFromLink("https://shop.example/pay", tokens) as { problem: { code: string } }).problem.code, "pay.code.unsupported");
  assert.equal((prefillFromLink(requestLink({ to: "me.near" }), tokens, "me.near") as { problem: { code: string } }).problem.code, "pay.send.recipient-self");
});

test("a request link keeps its ref through the hand-off to Send", () => {
  const r = prefillFromLink(requestLink({ to: "trip.near", amount: "30", token: USDC_NEAR, note: "Dinner", ref: "1042" }), tokens);
  assert.ok("ok" in r);
  assert.deepEqual([r.ok.ref, r.ok.note, r.ok.tokenId], ["1042", "Dinner", USDC_NEAR]);
});

test("a link that names everything skips Send and opens on Confirm; anything less fills Send in", () => {
  const usdc = { tokenId: USDC_NEAR, symbol: "USDC", amount: "40", listed: true } as Balance;
  const named = prefillFromLink(requestLink({ to: "kim.near", amount: "30.00", token: USDC_NEAR, note: "Dinner", ref: "1" }), tokens);
  assert.ok("ok" in named);
  const intent = fullyNamed(named.ok, [usdc]);
  assert.deepEqual(intent && { to: intent.recipient, amount: intent.amount, coin: intent.coin.tokenId, asked: intent.askedTokenId, note: intent.note, ref: intent.ref }, {
    to: { kind: "ledger", accountId: "kim.near" }, amount: "30.00", coin: USDC_NEAR, asked: USDC_NEAR, note: "Dinner", ref: "1",
  });
  assert.equal(fullyNamed(named.ok, []), null, "a coin the person doesn't hold: Send, which says what's needed");
  assert.equal(fullyNamed(named.ok, [{ ...usdc, listed: false }]), null, "an unlisted look-alike never pays");
  const putIn = prefillFromLink(requestLink({ to: "kim.near", note: "Into Trip" }), tokens);
  assert.ok("ok" in putIn);
  assert.equal(fullyNamed(putIn.ok, [usdc]), null, "Put money in: the payer still chooses the amount");
  const noRef = prefillFromLink(requestLink({ to: "alex.near", amount: "12.5", token: USDC_NEAR }), tokens);
  assert.ok("ok" in noRef);
  assert.equal(fullyNamed(noRef.ok, [usdc]), null, "a plain request still shows Send");
});
