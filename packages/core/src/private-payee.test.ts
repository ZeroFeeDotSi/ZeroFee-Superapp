// Audit H4 (3 Nov): the core pins the payee on every private payment. Whoever runs the relay holds the partner key and
// can get a real, 1Click-signed quote that pays someone else, with the refund to the pocket: every other check passes
// it. The core signs only a quote that pays exactly the payee, the way, the coin and at least the amount the person
// asked for (from the page, never the relay); anything else, or no payee given, signs nothing and shows no sheet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { payeeRefusal, type PayeeAsk } from "./private-pocket.ts";
import type { QuoteFacts } from "./intents.ts";
import type { PlainWords } from "./signer.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const PAYEE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
/** A look-alike: the same first 6 and last 4 the sheet shows (audit H4: a GPU grinds one). */
const THIEF = "7xKXtgZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZgAsU";
const DEPOSIT = "d".repeat(64);
const IMT_USDC = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`;
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const asked: PayeeAsk = { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_USDC, minAmountOut: "29900000" };

test("payeeRefusal: the payee, its kind, the coin and at least the amount asked; anything else, or no payee, is refused (controls: the asked one passes; an EVM address in another letter case is the same)", () => {
  const q = { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_USDC, minAmountOut: "29900000" } as QuoteFacts;
  assert.equal(payeeRefusal(q, asked), null, "control: what was asked");
  assert.match(payeeRefusal({ ...q, recipient: THIEF }, asked)!, /pays someone you didn't pick/);
  assert.match(payeeRefusal({ ...q, recipientType: "INTENTS" }, asked)!, /pays someone you didn't pick/);
  assert.match(payeeRefusal({ ...q, destinationAsset: USDC }, asked)!, /another coin/);
  assert.match(payeeRefusal({ ...q, minAmountOut: "29899999" }, asked)!, /pays less than you asked/);
  for (const none of [undefined, null, {}, { ...asked, recipient: "" }, { ...asked, recipientType: "SOMEWHERE" }, { ...asked, minAmountOut: "-1" }]) assert.match(payeeRefusal(q, none)!, /wasn't told who this pays/, JSON.stringify(none));
  const { minAmountOut: _m, ...exactIn } = asked;
  assert.equal(payeeRefusal({ ...q, minAmountOut: "1" }, exactIn), null, "a Send of an exact amount in asks no amount out (its sheet shows 1Click's signed minimum)");
  const evm = "0x1234567890abcdef1234567890ABCDEF123478ab";
  assert.equal(payeeRefusal({ ...q, recipient: evm.toLowerCase() }, { ...asked, recipient: evm }), null, "control: one EVM address, any letter case");
});

function pocketWith(recipient: string) {
  const shown: PlainWords[] = [];
  let pocket = "";
  const privateStatus = async (a: string) => (a !== DEPOSIT ? null : {
    status: "PENDING_DEPOSIT",
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: USDC, destinationAsset: SOL_USDC, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient, recipientType: "DESTINATION_CHAIN", deadline: DEADLINE },
      quote: { depositAddress: DEPOSIT, amountIn: "30000000", amountInUsd: "30.01", minAmountOut: "29900000", deadline: DEADLINE },
    }),
  });
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as any, approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY, privateStatus });
  return { w, shown, set: (p: string) => (pocket = p) };
}
const intent = (pocket: string) => ({ payload: { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: "30000000" } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } });

test("H4: a relay that swaps the recipient (a real, 1Click-signed quote that pays a look-alike, refund to the pocket) gets nothing signed and no sheet; so does a payment with no payee (control: the payee asked for signs)", async () => {
  const swapped = pocketWith(THIEF);
  const p1 = await swapped.w.create("private", "near");
  swapped.set(p1.address);
  await assert.rejects(swapped.w.privatePay(p1.id, DEPOSIT, intent(p1.address), "Dinner", undefined, undefined, undefined, asked), (e: any) => e.problem.code === "security.subwallet.refused" && /pays someone you didn't pick/.test(e.problem.more));
  assert.equal(swapped.shown.length, 0, "no sheet: nothing to approve, nothing signed");
  const honest = pocketWith(PAYEE);
  const p2 = await honest.w.create("private", "near");
  honest.set(p2.address);
  await assert.rejects(honest.w.privatePay(p2.id, DEPOSIT, intent(p2.address), "Dinner"), (e: any) => /wasn't told who this pays/.test(e.problem.more), "no payee: refused too");
  assert.equal(honest.shown.length, 0);
  const out = (await honest.w.privatePay(p2.id, DEPOSIT, intent(p2.address), "Dinner", undefined, undefined, undefined, asked)) as { signedData?: unknown };
  assert.ok(out.signedData, "control: the payee asked for signs (D143: the pocket is a hot key, so no sheet inside the one cap)");
  assert.equal(honest.shown.length, 0);
});
