// Audit (core integrity, finding 1): a Safe payment through 1Click is signed only when the quote pays the person this
// account asked to pay (TxRequest.payee), this account itself, or one of its own wallets. A relay holding the partner
// key can fetch a genuine, 1Click-signed quote that pays a look-alike address: every other term (refund, coin, amount)
// can match the bytes, so the payee has to be pinned too, the way the private path already pins it (payeeRefusal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SoftwareKey } from "./device-key.ts";
import { DevSigner } from "./dev-signer.ts";
import { INTENTS } from "./intents.ts";
import type { OneClickLookup } from "./intents.ts";
import type { PlainWords, TxRequest } from "./signer.ts";
import { FakeChain } from "./testing/fake-chain.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL_USDC = "sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const BASE_USDC = "base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const DEPOSIT = "1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c";
const PAYEE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
// the same first six and last four letters: what a 6+4 title shows is the same for both
const LOOK_ALIKE = "7xKXtg9QzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzgAsU";
const EVM = "0xAbCd00000000000000000000000000000000Ef90";
const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();

function setup(quoteRequest: Record<string, unknown>, ownWallets?: Map<string, string>) {
  const chain = new FakeChain("mainnet");
  const key = SoftwareKey.generate();
  chain.fund("alice.near", key.publicKey);
  chain.contract("intents.near", INTENTS.codeHashBase58, { mt_balance_of: () => "20000000" });
  chain.contract(USDC, "usdc", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract(SOL_USDC, "omft", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  chain.contract(BASE_USDC, "omft", { ft_metadata: () => ({ symbol: "USDC", decimals: 6 }) });
  const quote = {
    status: "PENDING_DEPOSIT",
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: `nep141:${USDC}`, destinationAsset: `nep141:${SOL_USDC}`, refundTo: "alice.near", refundType: "INTENTS", recipient: PAYEE, recipientType: "DESTINATION_CHAIN", deadline: SOON, ...quoteRequest },
      quote: { depositAddress: DEPOSIT, amountIn: "10050000", minAmountOut: "10000000", deadline: SOON },
    }),
  };
  const lookup: OneClickLookup = async (address) => (address === DEPOSIT ? quote : null);
  const shown: PlainWords[] = [];
  const signer = new DevSigner({ accountId: "alice.near", chain, key, approve: async (w) => (shown.push(w), true), oneClick: lookup, quoteKey: TEST_QUOTE_KEY, ...(ownWallets ? { ownWallets: async () => ownWallets } : {}) });
  return { signer, chain, shown };
}

const pay = (payee?: TxRequest["payee"]): TxRequest => ({
  receiverId: "intents.near",
  actions: [{ kind: "call", method: "mt_transfer", args: { receiver_id: DEPOSIT, token_id: `nep141:${USDC}`, amount: "10050000", approval: null }, depositYocto: "1", gas: "30000000000000" }],
  why: "",
  from: "wallet",
  ...(payee ? { payee } : {}),
});

const refused = async (quoteRequest: Record<string, unknown>, request: TxRequest, why: string) => {
  const { signer, chain, shown } = setup(quoteRequest);
  const out = await signer.request(request);
  assert.equal(out.status === "problem" && out.problem.code, "security.quote.mismatch", why);
  assert.equal(out.status === "problem" && out.problem.whatHappened, "This price pays someone you didn't pick, so ZeroFee stopped.", why);
  assert.equal(shown.length, 0, `${why}: no sheet`);
  assert.equal(chain.sent.length, 0, `${why}: nothing sent`);
};

test("a Safe payment through 1Click is refused when the quote pays someone the person didn't enter, or no one was entered", async () => {
  await refused({ recipient: LOOK_ALIKE }, pay({ recipient: PAYEE, recipientType: "DESTINATION_CHAIN" }), "a look-alike Solana address");
  await refused({}, pay(), "no payee named: a quote to an outside address is never signed blind");
  await refused({}, pay({ recipient: PAYEE.toLowerCase(), recipientType: "DESTINATION_CHAIN" }), "base58 is compared exactly, never by letter case");
  await refused({}, pay({ recipient: PAYEE, recipientType: "INTENTS" }), "the same address, another kind of payout");
});

test("controls: the payee entered, an EVM address in any letter case, the account itself, its own wallet", async () => {
  const ok = async (quoteRequest: Record<string, unknown>, request: TxRequest, why: string, own?: Map<string, string>) => {
    const { signer, chain } = setup(quoteRequest, own);
    const out = await signer.request(request);
    assert.equal(out.status, "done", `${why}: ${JSON.stringify(out)}`);
    assert.ok(chain.sent.length > 0, why);
  };
  await ok({}, pay({ recipient: PAYEE, recipientType: "DESTINATION_CHAIN" }), "the payee entered");
  await ok({ recipient: EVM.toLowerCase(), destinationAsset: `nep141:${BASE_USDC}` }, pay({ recipient: EVM, recipientType: "DESTINATION_CHAIN" }), "one EVM address, any letter case");
  await ok({ recipient: "alice.near", recipientType: "INTENTS", destinationAsset: `nep141:${USDC}` }, pay(), "a swap back into this account");
  await ok({}, pay(), "one of the account's own wallets", new Map([[PAYEE, "your SOL row"]]));
});

test("the title shows at least six letters at each end of an outside address", async () => {
  const { signer } = setup({});
  const words = await signer.describe(pay({ recipient: PAYEE, recipientType: "DESTINATION_CHAIN" }));
  assert.match(words.title, /7xKXtg…osgAsU|7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/);
  const evm = setup({ recipient: EVM, destinationAsset: `nep141:${BASE_USDC}` });
  const e = await evm.signer.describe(pay({ recipient: EVM, recipientType: "DESTINATION_CHAIN" }));
  assert.match(e.title, /0xAbCd00…00Ef90|0xAbCd00000000000000000000000000000000Ef90/);
});
