// A site's top-up from Private alone (QA's SHOULD on e54b3353d): the pocket's one exit to the site's wallet
// (ledger payFromPocket → subwallet.privatePay with `send`) counts against the one no-sheet cap (D143 capGate), as Move's
// legs do: inside it, no sheet; past it, one tap (the site's wallet is the person's own, so never Face ID).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlainWords } from "./signer.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL = "nep141:sol.omft.near";
const DEPOSIT = "d".repeat(64);
const IMT_USDC = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`;
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();

async function exit(usd: string) {
  const shown: PlainWords[] = [];
  let pocket = "", site = "";
  const units = String(Math.round(Number(usd) * 1e6));
  const privateStatus = async (a: string) => (a !== DEPOSIT ? null : {
    status: "PENDING_DEPOSIT",
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: USDC, destinationAsset: SOL, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: site, recipientType: "DESTINATION_CHAIN", deadline: DEADLINE },
      quote: { depositAddress: DEPOSIT, amountIn: units, amountInUsd: usd, minAmountOut: "1000", deadline: DEADLINE },
    }),
  });
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as never, approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY, privateStatus });
  const p = await w.create("private", "near");
  pocket = p.address;
  site = (await w.create("site", "sol", undefined, "pump")).address;
  const payload = { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: units } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" };
  const out = (await w.privatePay(p.id, DEPOSIT, { payload }, "Move to your pump.fun wallet", undefined, undefined, true, { recipient: site, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL })) as { signedData?: unknown };
  return { out, shown };
}

test("past the cap, a top-up from Private alone asks one tap (its own wallet: never Face ID); control: inside the cap, no sheet", async () => {
  const over = await exit("150.00");
  assert.ok(over.out.signedData);
  assert.equal(over.shown.length, 1, "one sheet");
  assert.equal(over.shown[0]!.tap, true, "a tap: the site's wallet is the person's own");
  const under = await exit("30.00");
  assert.ok(under.out.signedData);
  assert.equal(under.shown.length, 0, "inside the one cap: no sheet");
});
