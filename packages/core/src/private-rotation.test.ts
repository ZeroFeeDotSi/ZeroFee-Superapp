// Security audit 4 Nov, finding 2: new backup words didn't rotate Private. Every pocket lookup took the first
// kind "private" with no old-words filter, and a second pocket was refused, so after a phishing scare money moved into
// Private (and the NEAR float) landed on a key the OLD words open. Now: after new words a pocket and a float are made
// from the new words, every lookup, fill, quote and payment reaches only those, an old one is refused by id, and the
// old ones' coins move to the new ones (sweepOldWords), asked again until nothing is left.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FloatRelay } from "./float-moves.ts";
import { HOT_ROOT, hotRoot } from "./hot-keys.ts";
import { base64 } from "./sol/bytes.ts";
import type { SolChain } from "./solana.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const SOL_USDC = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
const PAYEE = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEPOSIT = "d".repeat(64);
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();
const IMT_USDC = `imt:${MINTER}:${USDC}`;

/** ZeroFee's relay in front of 1Click (as pocket-moves.test.ts has it), plus one private payment quote at DEPOSIT. */
function relay(payer: () => string, refuse?: () => string | null) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; deadline: string }>();
  let state = "PENDING_DEPOSIT";
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const no = refuse?.();
      if (no) throw new Error(no);
      const depositAddress = (asked.length.toString(16) + "c".repeat(64)).slice(0, 64);
      quotes.set(depositAddress, { req, deadline: DEADLINE });
      return { quote: { depositAddress, amountIn: req.amount, deadline: DEADLINE }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.req.amount } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      return { status: state, quoteResponse: signedQuote({ quoteRequest: q.req, quote: { depositAddress, amountIn: q.req.amount, minAmountOut: String((BigInt(q.req.amount) * 99n) / 100n), deadline: q.deadline } }) };
    },
  };
  // A private payment to PAYEE, refunded to whichever pocket `payer` names (the pocket a payment would sign as).
  const privateStatus = async (a: string) => (a !== DEPOSIT ? null : {
    status: "PENDING_DEPOSIT",
    quoteResponse: signedQuote({
      quoteRequest: { dry: false, originAsset: USDC, destinationAsset: SOL_USDC, refundTo: payer(), refundType: "CONFIDENTIAL_INTENTS", recipient: PAYEE, recipientType: "DESTINATION_CHAIN", deadline: DEADLINE },
      quote: { depositAddress: DEPOSIT, amountIn: "30000000", amountInUsd: "30.01", minAmountOut: "29900000", deadline: DEADLINE },
    }),
  });
  return { r, privateStatus, asked, submitted, set: (s: string) => (state = s) };
}

async function renewed() {
  let payer = "";
  let refusal: string | null = null;
  const fake = relay(() => payer, () => refusal);
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol: {} as SolChain, evm: {} as any, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, privateStatus: fake.privateStatus, floatRelay: fake.r, intentsSalt: async () => "salt" });
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(1)));
  const oldPocket = await w.create("private", "near");
  const oldFloat = await w.create("trade", "near");
  // What 1Click holds: 5 USDC in the old pocket, 2 USDC in the old float, nothing in the new ones.
  const held = new Map<string, { tokenId: string; amount: string }[]>([[oldPocket.address, [{ tokenId: USDC, amount: "5000000" }]], [oldFloat.address, [{ tokenId: USDC, amount: "2000000" }]]]);
  (w as any).heldBy = async (address: string) => held.get(address) ?? [];
  // recovery.renew: marked while the root is the old words', then the root moves (demo-core syncRenew's order).
  await w.markOldWords();
  await vault.put(HOT_ROOT, hotRoot(new Uint8Array(32).fill(2)));
  return { w, fake, oldPocket, oldFloat, held, payWith: (p: string) => (payer = p), refuse: (why: string | null) => (refusal = why) };
}
const intent = (pocket: string) => ({ payload: { message: JSON.stringify({ deadline: DEADLINE, intents: [{ intent: "transfer", receiver_id: DEPOSIT, tokens: { [IMT_USDC]: "30000000" } }], signer_id: pocket }), nonce: base64(new Uint8Array(32).fill(3)), recipient: "intents.far" } });
const asked = { recipient: PAYEE, recipientType: "DESTINATION_CHAIN", destinationAsset: SOL_USDC, minAmountOut: "29900000" };

test("audit 2: after new words, a pocket and a float are made from them; lookups reach only those; the old pocket pays nothing", async () => {
  const { w, oldPocket, oldFloat, payWith } = await renewed();
  // Today's code: a second pocket is refused ("there is one Private balance") and the float keeps the old words' one.
  const pocket = await w.create("private", "near");
  const float = await w.create("trade", "near");
  assert.notEqual(pocket.address, oldPocket.address, "a new pocket from the new words");
  assert.notEqual(float.address, oldFloat.address, "a new float from the new words");
  assert.equal(await w.floatAddress(), float.address, "the float's address is the new words' one");
  assert.equal((await w.list()).filter((x) => x.kind === "private" && !x.oldWords).map((x) => x.id).join(), pocket.id, "one current pocket");
  // A private payment by the old pocket's id: refused, nothing signed.
  payWith(oldPocket.address);
  await assert.rejects(w.privatePay(oldPocket.id, DEPOSIT, intent(oldPocket.address), "Dinner", undefined, undefined, undefined, asked), (e: any) => e.problem.code === "security.subwallet.refused" && /old backup words/.test(e.problem.more) && /Nothing was paid/.test(e.problem.more));
  // Control: the new pocket pays.
  payWith(pocket.address);
  assert.ok(((await w.privatePay(pocket.id, DEPOSIT, intent(pocket.address), "Dinner", undefined, undefined, undefined, asked)) as { signedData?: unknown }).signedData);
});

test("audit 2: money into Private after new words is quoted to the new pocket, never the old one", async () => {
  const { w, fake, oldPocket } = await renewed();
  const pocket = await w.create("private", "near");
  await w.privateQuoteIn(USDC, "1000000").catch(() => undefined);
  const req = fake.asked.at(-1);
  assert.ok(req, "a quote was asked for");
  assert.deepEqual([req.recipient, req.refundTo], [pocket.address, pocket.address]);
  assert.notEqual(req.recipient, oldPocket.address);
});

test("audit 2: rotateAfterNewWords makes the new pocket and float and moves each old one's coins into them; a move on its way isn't asked twice", async () => {
  const { w, fake, oldPocket, oldFloat } = await renewed();
  const first = await w.rotateAfterNewWords();
  const pocket = (await w.list()).find((x) => x.kind === "private" && !x.oldWords)!;
  const float = (await w.list()).find((x) => x.kind === "trade" && x.chain === "near" && !x.oldWords)!;
  assert.ok(pocket && float, "both made");
  assert.deepEqual([first.moving, first.left, first.coins.map((c) => [c.kind, c.amount, c.state])], [2, 0, [["private", "5000000", "moving"], ["trade", "2000000", "moving"]]]);
  const byFrom = new Map(fake.asked.map((r) => [r.refundTo, r]));
  for (const [from, to, amount] of [[oldPocket.address, pocket.address, "5000000"], [oldFloat.address, float.address, "2000000"]] as const) {
    const r = byFrom.get(from);
    assert.ok(r, `a move from ${from.slice(0, 6)}`);
    assert.deepEqual([r.originAsset, r.destinationAsset, r.amount, r.depositType, r.recipient, r.recipientType, r.refundType], [USDC, USDC, amount, "CONFIDENTIAL_INTENTS", to, "CONFIDENTIAL_INTENTS", "CONFIDENTIAL_INTENTS"]);
  }
  assert.equal(fake.submitted.length, 2, "each signed by the old wallet and sent");
  // Asked again while both are on their way: nothing new.
  assert.equal((await w.rotateAfterNewWords()).moving, 2);
  assert.equal(fake.asked.length, 2, "no second quote for a move on its way");
});

test("audit 2: a refunded sweep is asked again after 10 minutes, at most five times; once the old ones hold nothing, nothing is left", async () => {
  const { w, fake, held, oldPocket, oldFloat } = await renewed();
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    await w.rotateAfterNewWords();
    fake.set("REFUNDED");
    await w.rotateAfterNewWords();
    assert.equal(fake.asked.length, 2, "not again within 10 minutes");
    for (let i = 0; i < 8; i++) {
      now += 11 * 60_000;
      await w.rotateAfterNewWords();
    }
    assert.equal(fake.asked.length, 10, "five tries for each coin, then it waits for the person");
    // Review 2: out of tries, it is shown (Wallet counts it, with Try again), and Try again starts the count over.
    const shown = await w.oldWordsMoney();
    assert.deepEqual(shown.coins.map((c) => [c.kind, c.amount, c.state]), [["private", "5000000", "stuck"], ["trade", "2000000", "stuck"]]);
    assert.equal(shown.left, 2);
    fake.set("PENDING_DEPOSIT");
    const again = await w.sweepOldWords(true);
    assert.equal(fake.asked.length, 12, "the person's Try again asks for each coin at once");
    assert.equal(again.moving, 2);
  } finally {
    Date.now = realNow;
  }
  held.set(oldPocket.address, []);
  held.set(oldFloat.address, [{ tokenId: USDC, amount: "0" }]);
  const done = await w.rotateAfterNewWords();
  assert.deepEqual([done.moving, done.left, done.coins], [0, 0, []]);
});

test("review 3: a quote 1Click refuses before it gives an address counts as a try (five, then stuck); one too small is a known leftover, shown and never asked again until its amount changes", async () => {
  const { w, fake, held, oldPocket, oldFloat, refuse } = await renewed();
  held.set(oldFloat.address, []);
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    refuse("1Click is busy");
    for (let i = 0; i < 9; i++) {
      await w.rotateAfterNewWords();
      now += 11 * 60_000;
    }
    assert.equal(fake.asked.length, 5, "five tries, then no more (the old code asked every 10 minutes for ever)");
    assert.deepEqual((await w.oldWordsMoney()).coins.map((c) => c.state), ["stuck"]);
    // Too small: one ask, then shown as left, never asked again.
    refuse("Amount is too low for bridge, try at least 1000000");
    await w.sweepOldWords(true);
    assert.equal(fake.asked.length, 6);
    for (let i = 0; i < 4; i++) {
      now += 11 * 60_000;
      const r = await w.rotateAfterNewWords();
      assert.deepEqual(r.coins.map((c) => c.state), ["left"]);
    }
    assert.equal(fake.asked.length, 6, "a known leftover is never asked about again");
    assert.equal((await w.sweepOldWords(true)).coins[0]!.state, "left", "not even on Try again");
    assert.equal(fake.asked.length, 6);
    // More money lands on it: its count starts over, and it is asked again.
    refuse(null);
    held.set(oldPocket.address, [{ tokenId: USDC, amount: "9000000" }]);
    const more = await w.rotateAfterNewWords();
    assert.equal(fake.asked.length, 7);
    assert.deepEqual(more.coins.map((c) => [c.amount, c.state]), [["9000000", "moving"]]);
  } finally {
    Date.now = realNow;
  }
});

test("review 2: what the old words' wallets hold is read for Wallet's total, per coin, read only (nothing is asked of 1Click)", async () => {
  const { w, fake } = await renewed();
  const shown = await w.oldWordsMoney();
  assert.deepEqual(shown.coins.map((c) => [c.kind, c.amount, c.state]), [["private", "5000000", "waiting"], ["trade", "2000000", "waiting"]]);
  assert.equal(shown.left, 2);
  assert.equal(fake.asked.length, 0, "a read moves nothing");
});
