import { test } from "node:test";
import assert from "node:assert/strict";
import { honestPage } from "./testing/honest-payee.ts";
import { verifyNep413Signature } from "@fastnear/utils";
import { nep413Hash as theirHash } from "@fastnear/utils";
import { nep413Hash } from "./private-pocket.ts";
import type { PlainWords } from "./signer.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const DEPOSIT = "d".repeat(64);
const NONCE = base64(new Uint8Array(32).fill(3));
/** The confidential id 1Click uses for the pocket's USDC (recorded 25 Oct). */
const IMT_USDC = `imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`;
/** The quotes' deadline: 1Click gives the intent this same one. */
const QUOTE_DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();

function setup(quoteOver: Record<string, unknown> = {}, amountsOver: Record<string, unknown> = {}) {
  const shown: PlainWords[] = [];
  const quote = (pocket: string) => ({
    status: "PENDING_DEPOSIT",
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: USDC, destinationAsset: "nep141:sol-usdc.omft.near", refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", recipient: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", recipientType: "DESTINATION_CHAIN", deadline: QUOTE_DEADLINE, ...quoteOver },
      quote: { depositAddress: DEPOSIT, amountIn: "30000000", amountInUsd: "30.01", minAmountOut: "29900000", deadline: quoteDeadline, ...amountsOver },
    }),
  });
  let pocket = "";
  const quoteDeadline = QUOTE_DEADLINE;
  const privateStatus = async (a: string) => (a === DEPOSIT ? quote(pocket) : null);
  const w = honestPage(new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as any, approve: async (words) => (shown.push(words), true), emit: () => {}, quoteKey: TEST_QUOTE_KEY, privateStatus }), privateStatus);
  return { w, shown, setPocket: (p: string) => (pocket = p) };
}

const payload = (pocket: string, over: Record<string, unknown> = {}, intent: Record<string, unknown> = {}) => ({
  // The order 1Click writes it in: deadline, intents, signer_id; the deadline is the quote's.
  message: JSON.stringify({ deadline: QUOTE_DEADLINE, intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: "30000000" }, ...intent }], signer_id: pocket, ...over }),
  nonce: NONCE,
  recipient: "intents.far",
});

test("NEP-413's hash is the standard one (checked against @fastnear's own)", () => {
  const p = { message: "hello", nonce: NONCE, recipient: "intents.near" };
  assert.deepEqual(Buffer.from(nep413Hash(p)), Buffer.from(theirHash({ message: "hello", nonce: new Uint8Array(32).fill(3), recipient: "intents.near" })));
});

test("the pocket signs exactly the one transfer its quote needs, no sheet (D143: the pocket is a hot key)", async () => {
  const { w, shown, setPocket } = setup();
  const pocket = await w.create("private", "near");
  setPocket(pocket.address);
  const p = payload(pocket.address);
  const out = (await w.privatePay(pocket.id, DEPOSIT, { payload: p }, "Dinner")) as { signedData: any };
  assert.equal(shown.length, 0, "no sheet");
  assert.ok(verifyNep413Signature({ publicKey: out.signedData.public_key, signature: out.signedData.signature, message: p.message, nonce: new Uint8Array(32).fill(3), recipient: "intents.far" }));
});

test("anything but that one exact transfer is refused, nothing signed (control: the exact one is signed)", async () => {
  const { w, shown, setPocket } = setup();
  const pocket = await w.create("private", "near");
  setPocket(pocket.address);
  const cases: [string, ReturnType<typeof payload>][] = [
    ["another receiver", payload(pocket.address, {}, { receiver_id: "mallory.near" })],
    ["another amount", payload(pocket.address, {}, { tokens: { [IMT_USDC]: "30000001" } })],
    ["a second coin", payload(pocket.address, {}, { tokens: { [IMT_USDC]: "30000000", "imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:wrap.near": "1" } })],
    ["the public coin id", payload(pocket.address, {}, { tokens: { [USDC]: "30000000" } })],
    ["another coin under the prefix", payload(pocket.address, {}, { tokens: { "imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:wrap.near": "30000000" } })],
    ["a memo", payload(pocket.address, {}, { memo: "x" })],
    ["a second intent", { ...payload(pocket.address), message: JSON.stringify({ signer_id: pocket.address, deadline: new Date(Date.now() + 60_000).toISOString(), intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: "30000000" } }, { intent: "add_public_key", public_key: "ed25519:x" }] }) }],
    ["a deadline past the price's", payload(pocket.address, { deadline: new Date(Date.parse(QUOTE_DEADLINE) + 60_000).toISOString() })],
    ["a deadline other than the price's", payload(pocket.address, { deadline: new Date(Date.parse(QUOTE_DEADLINE) - 60_000).toISOString() })],
    ["another minter", payload(pocket.address, {}, { tokens: { [`imt:${"a".repeat(64)}:${USDC}`]: "30000000" } })],
    ["another signer", payload(pocket.address, { signer_id: "someone.near" })],
    ["an extra field", payload(pocket.address, { verifying_contract: "intents.near" })],
    ["another recipient", { ...payload(pocket.address), recipient: "evil.near" }],
    ["the public intents contract", { ...payload(pocket.address), recipient: "intents.near" }],
  ];
  for (const [what, p] of cases) {
    await assert.rejects(w.privatePay(pocket.id, DEPOSIT, { payload: p }, ""), (e: any) => e.problem.code === "security.subwallet.refused", what);
  }
  assert.equal(shown.length, 0, "no sheet for any of them");
  // control: the same pocket and quote, the exact transfer, is signed
  assert.ok(((await w.privatePay(pocket.id, DEPOSIT, { payload: payload(pocket.address) }, "")) as { signedData?: unknown }).signedData);
  // A quote that refunds elsewhere, or a trading wallet asked to pay this way: refused too.
  const other = setup({ refundTo: "mallory.near" });
  const p2 = await other.w.create("private", "near");
  other.setPocket(p2.address);
  await assert.rejects(other.w.privatePay(p2.id, DEPOSIT, { payload: payload(p2.address) }, ""), (e: any) => /refund/.test(JSON.stringify(e.problem)));
  const trading = await w.create("trade", "sol");
  await assert.rejects(w.privatePay(trading.id, DEPOSIT, { payload: payload(pocket.address) }, ""), (e: any) => e.problem.code === "security.subwallet.refused");
  // Up to $10,000 a payment (D132), by 1Click's signed price, in the core as well as the relay: over it, or with no price, nothing signed.
  // D132: the limit is $10,000 a send (control: the old $100.01 now passes, below)
  for (const [what, amountInUsd] of [["$10,000.01", "10000.01"], ["no price", undefined], ["a price that isn't a number", "1e3"]] as const) {
    const big = setup({}, { amountInUsd });
    const p3 = await big.w.create("private", "near");
    big.setPocket(p3.address);
    await assert.rejects(big.w.privatePay(p3.id, DEPOSIT, { payload: payload(p3.address) }, ""), (e: any) => e.problem.code === "security.subwallet.refused" && /up to \$10,000\./.test(e.problem.more), what);
  }
  // control: $100.01, refused before D132, and exactly $10,000 are signed
  for (const amountInUsd of ["100.01", "10000.00"]) {
    const was = setup({}, { amountInUsd });
    const p4 = await was.w.create("private", "near");
    was.setPocket(p4.address);
    assert.ok(((await was.w.privatePay(p4.id, DEPOSIT, { payload: payload(p4.address) }, "")) as { signedData?: unknown }).signedData, amountInUsd);
  }
});

test("1Click's real payload, as recorded on 25 Oct, passes the check (with its own quote)", async () => {
  const { pocketIntentRefusal } = await import("./private-pocket.ts");
  const pocket = "9304118792d11f6df8819e8d6259594e3246ce2018ccad6358c330fb581df89b";
  const deposit = "818473a0072ed5084b4ec9f665b47d7c244546ca9a0ebc76d71fe1e6274ef8ba";
  const recorded = {
    message: `{"deadline":"2026-10-28T14:23:17.723Z","intents":[{"intent":"transfer","receiver_id":"${deposit}","tokens":{"imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1":"1000000"}}],"signer_id":"${pocket}"}`,
    nonce: "Vij2xgDhEPMXwCxvT4i34hhtdhcm5docNFPcDCQmd3g=",
    recipient: "intents.far",
  };
  const quote = { status: "PENDING_DEPOSIT", originAsset: USDC, amountIn: "1000000", refundTo: pocket, refundType: "CONFIDENTIAL_INTENTS", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", minAmountOut: "724270", recipient: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", recipientType: "DESTINATION_CHAIN", deadline: "2026-10-28T14:23:17.723Z" };
  assert.equal(pocketIntentRefusal(recorded, quote, deposit, pocket, Date.parse("2026-10-25T14:13:20.017Z")), null);
});

test("a move into Private: the core asks for the quote itself, for its own pocket, and believes it only as 1Click signed it", async () => {
  const thief = "e".repeat(64);
  const run = async (o: { lie?: (req: any) => any; forge?: boolean; usd?: string; pocket?: boolean; held?: number; unread?: boolean } = {}) => {
    const asked: any[] = [];
    const quoted = new Map<string, any>();
    const relay: FloatRelay = {
      quote: async (req) => {
        asked.push(req);
        const depositAddress = (quoted.size + 1).toString(16).padStart(64, "9");
        quoted.set(depositAddress, o.lie ? o.lie(req) : req);
        return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
      },
      generateIntent: async () => null,
      submitIntent: async () => null,
      status: async () => null,
    };
    const privateStatus = async (a: string) => {
      const req = quoted.get(a);
      if (!req) return null;
      const signed = signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: o.usd ?? "50.00", minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: QUOTE_DEADLINE } });
      // A relay that lies shows the terms that were asked for over the thief's signed quote.
      return { status: "PENDING_DEPOSIT", quoteResponse: o.forge ? { ...signed, quoteRequest: asked.at(-1) } : signed };
    };
    const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as any, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, ...(o.unread ? {} : { pocketUsd: async () => o.held ?? 0 }) });
    const pocket = o.pocket === false ? null : await w.create("private", "near");
    return { w, asked, pocket };
  };
  const good = await run();
  const q = await good.w.privateQuoteIn(USDC, "50000000");
  assert.equal(q.amountIn, "50000000");
  const req = good.asked[0];
  assert.deepEqual([req.originAsset, req.destinationAsset, req.depositType, req.swapType, req.confidentiality], [USDC, USDC, "ORIGIN_CHAIN", "EXACT_INPUT", "basic"]);
  assert.deepEqual([req.recipient, req.recipientType, req.refundTo, req.refundType], [good.pocket!.address, "CONFIDENTIAL_INTENTS", good.pocket!.address, "CONFIDENTIAL_INTENTS"]);
  assert.ok(await good.w.privateInFacts(q.depositAddress), "kept for the main sheet");
  assert.equal(await good.w.privateInFacts("8".repeat(64)), null, "an address this core didn't ask for is never read through the relay");

  const refused = async (o: Parameters<typeof run>[0], what: string, why: RegExp) => {
    const r = await run(o);
    await assert.rejects(r.w.privateQuoteIn(USDC, "50000000"), (e: any) => e.problem.code === "security.subwallet.refused" && why.test(e.problem.more), what);
  };
  await refused({ lie: (r) => ({ ...r, recipient: thief, refundTo: thief }) }, "1Click's quote pays the thief", /(?:isn't the one asked for|priced it differently than asked)/);
  await refused({ lie: (r) => ({ ...r, recipient: thief, refundTo: thief }), forge: true }, "the relay shows the asked terms over it", /(?:isn't the one asked for|priced it differently than asked)/);
  await refused({ usd: "10000.01" }, "over $10,000 (D132)", /up to \$10,000/);
  await refused({ pocket: false }, "no pocket", /Set up your private balance first/);
  await assert.rejects(good.w.privateQuoteIn("wrap.near", "1"), (e: any) => e.problem.code === "security.request.invalid");
  // The core's own tally (audit INFO-1, D27 at most $100): what the pocket holds, recent moves in, and this one.
  const overCap = (e: any) => e.problem.code === "security.subwallet.refused" && /Your private balance holds at most \$10,000/.test(e.problem.more);
  await assert.rejects((await run({ held: 9960 })).w.privateQuoteIn(USDC, "50000000"), overCap, "$9,960 held + $50 is over $10,000");
  assert.ok(await (await run({ held: 9950 })).w.privateQuoteIn(USDC, "50000000"), "$9,950 held + $50 is exactly $10,000");
  const twice = await run({ usd: "5000.00" });
  await twice.w.privateQuoteIn(USDC, "50000000");
  await twice.w.privateQuoteIn(USDC, "50000000");
  await assert.rejects(twice.w.privateQuoteIn(USDC, "50000000"), overCap, "three $5,000 moves in quoted within 30 minutes: the third is over $10,000");
  // A pocket the core can't read (here: no sign-in salt on this phone) is never taken as empty.
  await assert.rejects((await run({ unread: true })).w.privateQuoteIn(USDC, "50000000"), (e: any) => e.problem.code === "security.subwallet.refused" && /can't read private balances/.test(e.problem.more));
});
