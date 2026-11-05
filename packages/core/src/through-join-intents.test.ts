// Hotfix (Train 19's one bridge leg, 5 Nov): the fill's leg 1 is quoted INTENTS (the Safe's NEAR Intents balance pays it
// by one mt_transfer), and the pocket's payment that waits on it (Move's leg to the person's wallet, a Send's payout)
// joins it through throughJoinRefusal (send-words.ts). That join took ORIGIN_CHAIN only, so the core refused the payment
// before any sheet ("The price for the move into your private balance isn't the one asked for"): Move's fill was dead on
// main. Now INTENTS joins too; every other rule stands. Through the real core (SubWallets.privateQuoteIn → privatePay
// with inDeposit, quotes signed and read back as 1Click signs them), each with a control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { throughJoinRefusal } from "./send-words.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import type { SolChain } from "./solana.ts";
import { MemoryVault } from "./vault.ts";
import { base64 } from "./sol/bytes.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL_IN = "nep141:sol.omft.near";
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const OUT = "d".repeat(64);
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();

async function setup(leg1Type?: string) {
  const quoted = new Map<string, any>();
  let n = 0;
  let pocket = "";
  let solWallet = "";
  const relay: FloatRelay = {
    quote: async (req) => {
      const depositAddress = `${(n++).toString(16).padStart(2, "0")}${"e".repeat(62)}`;
      quoted.set(depositAddress, req);
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null, submitIntent: async () => null, status: async () => null,
  };
  const privateStatus = async (a: string) => {
    if (a === OUT) {
      return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({
        quoteRequest: { dry: false, originAsset: USDC, destinationAsset: SOL_IN, refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: solWallet, recipientType: "DESTINATION_CHAIN", depositType: "CONFIDENTIAL_INTENTS", deadline: DEADLINE, swapType: "EXACT_INPUT", confidentiality: "basic" },
        quote: { depositAddress: OUT, amountIn: "19800000", amountInUsd: "19.80", minAmountOut: "100000000", amountOut: "101000000", deadline: DEADLINE },
      }) };
    }
    const req = quoted.get(a);
    if (!req) return null;
    return { status: "PENDING_DEPOSIT", quoteResponse: signedQuote({ quoteRequest: leg1Type ? { ...req, depositType: leg1Type } : req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: "20.00", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const sol = { balance: async () => 10n ** 12n, latestBlockhash: async () => "11111111111111111111111111111111", send: async () => true, status: async () => ["ok", "ok"] } as unknown as SolChain;
  const w = new SubWallets({ vault: new MemoryVault(), sol, evm: {} as never, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => 0, confirm: { everyMs: 1, forMs: 5 } } as never);
  const p = await w.create("private", "near");
  pocket = p.address;
  solWallet = (await w.create("trade", "sol")).address;
  const pay = () => ({ payload: { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: OUT, tokens: { [`imt:${MINTER}:${USDC}`]: "19800000" } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } });
  return { w, pocket: p, pay, solWallet: () => solWallet };
}

test("hotfix: a Move's fill on Train 19's route (leg 1 quoted INTENTS) joins the pocket's leg to the person's SOL wallet, through the real core; the record the sheet reads is kept (controls: the ORIGIN_CHAIN route as before; a leg 1 signed as another deposit type is refused when read back, before any payment)", async () => {
  for (const intents of [true, false]) {
    const s = await setup();
    const leg1 = await s.w.privateQuoteIn(USDC, "20000000", false, true, intents);
    const r = (await s.w.privatePay(s.pocket.id, OUT, s.pay(), "Move", "tag-for-this-quote-0001", leg1.depositAddress, undefined, { recipient: s.solWallet(), recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_IN })) as any;
    assert.ok(r.signedData?.signature, `${intents ? "INTENTS" : "ORIGIN_CHAIN"}: leg 2 signed`);
    assert.equal(s.w.privateLeg(leg1.depositAddress)?.tokenId, USDC, `${intents ? "INTENTS" : "ORIGIN_CHAIN"}: Private's leg joined to this move in (the fill sheet's record)`);
  }
  for (const other of ["CONFIDENTIAL_INTENTS", "DESTINATION_CHAIN"]) {
    const s = await setup(other);
    // refused where it is read back (privateQuoteIn: the deposit type 1Click signed must be the one asked), so no
    // payment can ever join it
    await assert.rejects(s.w.privateQuoteIn(USDC, "20000000", false, true, true), (e: any) => e.problem?.code === "security.subwallet.refused" && /priced it differently/.test(e.problem.more), other);
  }
});

test("throughJoinRefusal: ORIGIN_CHAIN and INTENTS join; any other deposit type, or any other rule broken, does not (controls)", () => {
  const POCKET = "a1".repeat(32);
  const q = (over: Record<string, unknown> = {}) => ({ status: "PENDING_DEPOSIT", deadline: DEADLINE, originAsset: USDC, destinationAsset: USDC, depositType: "INTENTS", swapType: "EXACT_INPUT", recipient: POCKET, recipientType: "CONFIDENTIAL_INTENTS", refundTo: POCKET, refundType: "CONFIDENTIAL_INTENTS", amountIn: "20000000", minAmountOut: "19800000", ...over }) as any;
  const paid = { tokenId: USDC, amount: "19800000" };
  const now = Date.now();
  assert.equal(throughJoinRefusal(q(), POCKET, paid, now), null, "INTENTS");
  assert.equal(throughJoinRefusal(q({ depositType: "ORIGIN_CHAIN" }), POCKET, paid, now), null, "ORIGIN_CHAIN, as before");
  for (const [why, over] of [["CONFIDENTIAL_INTENTS deposit", { depositType: "CONFIDENTIAL_INTENTS" }], ["no deposit type", { depositType: undefined }], ["refund elsewhere", { refundTo: "e".repeat(64) }], ["another payee", { recipient: "e".repeat(64) }], ["a swap", { destinationAsset: SOL_IN }]] as const) {
    assert.ok(throughJoinRefusal(q(over), POCKET, paid, now), why);
  }
  assert.ok(throughJoinRefusal(q(), POCKET, { tokenId: USDC, amount: "19800001" }, now), "more than leg 1 brings");
});
