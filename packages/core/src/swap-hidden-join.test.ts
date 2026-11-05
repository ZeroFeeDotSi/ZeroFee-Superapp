// Join test (QA gate, 3 Nov): Home's Swap from your private balance, $25 of USDC → SOL, through the REAL core's own check
// (SubWallets.privatePay, 1Click's signed quote by a test key). The demo's mock said "$0.25 … from your Safe" (its quote
// took the SOL out-figure as the USDC in-figure); the real core must sign 25 USDC from your private balance, never the
// Safe, with no sheet (D143: the pocket is a hot key). Control: a payment of the mock's old figure is refused.
import { test } from "node:test";
import { honestPage } from "./testing/honest-payee.ts";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const DEPOSIT = "e".repeat(64);
const NONCE = base64(new Uint8Array(32).fill(5));
const IMT_USDC = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`;
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const SOL_ROW = "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK";
/** You pay $25.00 of USDC (6 places); you get about 0.24570025 SOL (9 places), as the sheet's quote line said. */
const IN_UNITS = "25000000";
const OUT_UNITS = "245700250";

async function setup() {
  const shown: PlainWords[] = [];
  let pocket = "";
  const privateStatus = async (a: string) => (a !== DEPOSIT ? null : {
      status: "PENDING_DEPOSIT",
      quoteResponse: signedQuote({
        quoteRequest: { dry: false, swapType: "EXACT_OUTPUT", originAsset: USDC, depositType: "CONFIDENTIAL_INTENTS", destinationAsset: SOL, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: SOL_ROW, recipientType: "DESTINATION_CHAIN", deadline: DEADLINE },
        quote: { depositAddress: DEPOSIT, amountIn: IN_UNITS, amountInUsd: "25.00", amountOut: OUT_UNITS, minAmountOut: OUT_UNITS, deadline: DEADLINE },
      }),
    });
  const w = honestPage(new SubWallets({
    vault: new MemoryVault(), sol: {} as SolChain, evm: {} as any, approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY, privateStatus,
  }), privateStatus);
  const p = await w.create("private", "near");
  pocket = p.address;
  return { w, shown, pocket: p };
}
const intent = (pocket: string, units: string) => ({ payload: { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: units } }], signer_id: pocket }), nonce: NONCE, recipient: "intents.far" } });

test("Swap from your private balance, $25 USDC → SOL: the real core signs 25 USDC (in units) from your private balance, never the Safe; no sheet", async () => {
  const { w, shown, pocket } = await setup();
  const out = (await w.privatePay(pocket.id, DEPOSIT, intent(pocket.address, IN_UNITS), "")) as { signedData: { payload: { message: string } } };
  const signed = JSON.parse(out.signedData.payload.message);
  assert.equal(signed.signer_id, pocket.address, "signed by Hidden's own key, never the Safe's account");
  assert.equal(signed.intents[0].tokens[IMT_USDC], IN_UNITS, "the amount signed is 25 USDC, in USDC's units");
  assert.equal(shown.length, 0, "no sheet (D143)");
  assert.notEqual(IN_UNITS, OUT_UNITS, "in-amount and out-amount are different fields (known answer)");
});

test("control: the demo's old figure (the SOL out-amount taken as USDC in, 0.24694 USDC) is refused by the real core, nothing signed", async () => {
  const { w, shown, pocket } = await setup();
  await assert.rejects(w.privatePay(pocket.id, DEPOSIT, intent(pocket.address, "246940"), ""), (e: any) => e.problem?.code === "security.subwallet.refused");
  assert.equal(shown.length, 0);
});
