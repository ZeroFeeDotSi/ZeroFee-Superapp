// Audit (money paths, 28 Oct 2026, commit 18ad8d6): the PoCs for the core's float and pocket moves, kept here as each is
// FIXED. AUD-CORE-1: one call per move key at a time (float-moves.ts and pocket-moves.ts `once`). AUD-CORE-3: a paid move is
// followed to 1Click's final word, never failed at the quote's deadline. AUD-CORE-2: Take out "all" moves every coin the
// float holds, a chain's coin a refund left there included (float-moves.ts homeNow). The relay stand-in and setup are
// copied from float-moves.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOAT_USDC, type FloatRelay } from "./float-moves.ts";
import { PocketMoves } from "./pocket-moves.ts";
import { base64 } from "./sol/bytes.ts";
import type { PlainWords } from "./signer.ts";
import type { SolChain } from "./solana.ts";
import type { EvmChain } from "./evm.ts";
import { SubWallets } from "./subwallets.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

/** 1Click's confidential coins are wrapped by this minter (recorded 25 Oct, private-pocket.ts). */
const MINTER = "51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe";
const MAIN = "kim.near";
const SOL_DEPOSIT = "5SbU76n3zBhLtzfyMyTQaN3vcpNrRmo6HW4cWKEY1qfn";  // generated sample
const EVM_DEPOSIT = "0x00000000000000000000000000000000000d3f05";
const key = (n: number) => `trade-job-${String(n).padStart(8, "0")}`;

/**
 * A stand-in for ZeroFee's relay in front of 1Click, as recorded on 25 and 27 Oct: a real quote answers with a one-time
 * deposit address, generate-intent with the one transfer that pays it, and status with the quote as asked, signed the way
 * 1Click signs it (by the test key). `lie` changes what 1Click's signed quote says; `forge` swaps in other terms after signing
 * (given the signed ones and the ones asked for), as a relay that lies would; `submit` decides what submit-intent does.
 */
function relay(o: { amountIn?: (req: any) => string; minOut?: (req: any) => string; lie?: (req: any) => any; forge?: (signed: any, asked: any) => any; submit?: () => Promise<unknown>; status?: string; deposit?: (req: any) => string | undefined; details?: (req: any) => unknown } = {}) {
  const asked: any[] = [];
  const submitted: any[] = [];
  const quotes = new Map<string, { req: any; amountIn: string; deadline: string }>();
  let state = o.status ?? "PENDING_DEPOSIT";
  const r: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = o.deposit?.(req) ?? (req.depositType === "ORIGIN_CHAIN" ? (req.originAsset.includes("sol") ? SOL_DEPOSIT : EVM_DEPOSIT) : (asked.length.toString(16) + "d".repeat(64)).slice(0, 64));
      const amountIn = o.amountIn?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? "15300000" : req.amount);
      const deadline = new Date(Date.now() + 3 * 86_400_000).toISOString();
      quotes.set(depositAddress, { req, amountIn, deadline });
      return { quote: { depositAddress, amountIn, amountOut: req.amount, deadline }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async (signerId, depositAddress) => {
      const q = quotes.get(depositAddress)!;
      const message = JSON.stringify({ deadline: q.deadline, intents: [{ intent: "transfer", receiver_id: depositAddress, tokens: { [`imt:${MINTER}:${q.req.originAsset}`]: q.amountIn } }], signer_id: signerId });
      return { intent: { standard: "nep413", payload: { message, nonce: base64(new Uint8Array(32).fill(7)), recipient: "intents.far" } } };
    },
    submitIntent: async (signed) => (submitted.push(signed), o.submit ? o.submit() : { intentHash: "h" }),
    status: async (depositAddress) => {
      const q = quotes.get(depositAddress);
      if (!q) return null;
      const req = o.lie ? o.lie(q.req) : q.req;
      // A move in: what the coin is worth in USDC at the demo's prices, less 2 %.
      const worth = (r: any) => String(Math.floor((Number(r.amount) / (r.originAsset.includes("sol") ? 1e9 : 1e18)) * (r.originAsset.includes("sol") ? 150 : 3000) * 0.98 * 1e6));
      const minAmountOut = o.minOut?.(req) ?? (req.swapType === "EXACT_OUTPUT" ? req.amount : req.depositType === "ORIGIN_CHAIN" ? worth(req) : String((BigInt(req.amount) * 99n) / 100n));
      const signed = signedQuote({ quoteRequest: req, quote: { depositAddress, amountIn: q.amountIn, minAmountOut, deadline: q.deadline } });
      const quoteResponse = o.forge ? { ...signed, quoteRequest: o.forge(req, q.req) } : signed;
      return { status: state, quoteResponse, ...(o.details ? { swapDetails: o.details(q.req) } : {}) };
    },
  };
  return { r, asked, submitted, set: (s: string) => (state = s) };
}

async function setup(o: Parameters<typeof relay>[0] = {}, answer = true, took = true) {
  const shown: PlainWords[] = [];
  const fake = relay(o);
  const sent: string[] = [];
  const sol: SolChain = {
    blockhashValid: async () => true,
    simulate: async () => ({ ok: true, agreed: true, lamportsBefore: 0n, lamportsAfter: 0n }),
    lookupTables: async () => [],
    latestBlockhash: async () => "11111111111111111111111111111111",
    balance: async () => 400_005_000n,
    send: async (signed) => (sent.push(signed), took),
  };
  const evm = {
    nonce: async () => 3,
    estimateGas: async () => 23_300n, // Robinhood Chain wants 23,300 gas for a plain transfer while its L1 price is on (mainnet 2 Nov)
    fees: async () => ({ tip: 1_000_000_000n, maxFee: 2_000_000_000n }),
    read: async () => "0x" + (10n ** 16n).toString(16),
    send: async (_c: string, signed: string) => (sent.push(signed), took),
  } as unknown as EvmChain;
  const vault = new MemoryVault();
  const w = new SubWallets({ vault, sol, evm, floatRelay: fake.r, mainAccount: async () => MAIN, usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600), approve: async (words) => (shown.push(words), answer), emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  const float = await w.create("trade", "near");
  const sol0 = await w.create("trade", "sol", 0);
  return { w, float, sol0, shown, sent, vault, ...fake };
}


// ---- AUD-CORE-1: the move key is checked, then the call awaits the network, then the move is saved: two calls with the
// same key that overlap (a bridge timeout followed by the job runner's retry, which float-jobs.ts makes with the same key)
// both pass the check, and the float signs and submits TWO transfers for one move.
test("AUD-CORE-1: two overlapping float.out calls with the same key make ONE move, never two", async () => {
  const { w, submitted, vault } = await setup();
  const [a, b] = await Promise.all([w.floatOut("sol", 0, "100000000", key(901)), w.floatOut("sol", 0, "100000000", key(901))]);
  assert.ok(!("declined" in a) && !("declined" in b));
  assert.equal(submitted.length, 1, `the float signed and submitted ${submitted.length} transfers for one key`);
  const book = JSON.parse(new TextDecoder().decode((await vault.get("float-move-log"))!));
  assert.equal(book.kept.length, 1);
});

test("AUD-CORE-1b: two overlapping float.home calls with the same key move home once", async () => {
  const { w, submitted } = await setup();
  await Promise.all([w.floatHome("20000000", key(902)), w.floatHome("20000000", key(902))]);
  assert.equal(submitted.length, 1, `${submitted.length} transfers home signed for one key`);
});

test("AUD-CORE-1c: two overlapping private.home calls with the same key move home once", async () => {
  const fake = relay();
  const pocket = { address: "c".repeat(64), secret: async () => new Uint8Array(32).fill(9) };
  const p = new PocketMoves({ vault: new MemoryVault(), relay: fake.r, pocket: async () => pocket, mainAccount: async () => MAIN, balances: async () => [], quoteKey: TEST_QUOTE_KEY });
  await Promise.all([p.home(FLOAT_USDC, "5000000", "pocket-key-0001"), p.home(FLOAT_USDC, "5000000", "pocket-key-0001")]);
  assert.equal(fake.submitted.length, 1, `${fake.submitted.length} transfers home signed for one key`);
});
// ---- AUD-CORE-3: a move in whose transfer the core already sent, still PENDING_DEPOSIT at the quote's deadline (the
// deposit landed late, or 1Click hadn't seen it yet), is marked failed with the money "on the chain", and never read again:
// 1Click's later refund into the float is never recorded on the move.
test("AUD-CORE-3: a paid move in that passes its deadline is followed until 1Click says where the money went", async () => {
  const { w, set } = await setup({ details: () => ({ refundedAmount: "100000000" }) });
  const m = await w.floatIn("sol", 0, "100000000", key(920));
  assert.ok(!("declined" in m) && m.where === "in-flight", "the core paid the deposit address");
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4 * 86_400_000; // past the quote's deadline, 1Click still shows PENDING_DEPOSIT
    const late = await w.floatMove(m.id);
    assert.notEqual(late.status, "failed", "a paid move was declared failed while its money was at 1Click's deposit address");
    set("REFUNDED");
    const after = await w.floatMove(m.id);
    assert.deepEqual([after.status, after.where], ["refunded", "float"]);
  } finally {
    Date.now = realNow;
  }
});

// ---- AUD-CORE-2: a move in (chain coin → float) that 1Click refunds leaves the chain's coin (nep141:sol.omft.near,
// hood.omft.near) in the float. Every way out of the float (out, home) was paid in USDC only, so that coin couldn't leave:
// Take out "all" and "Move everything to your balance" never moved it. (The stand-in has one status for every quote, so it is
// set back to PENDING_DEPOSIT before the move home: 1Click answers a fresh quote that way.)
async function refundedSol(o: Parameters<typeof relay>[0] = {}) {
  const t = await setup({ details: (req) => (req.amount === "100000000" ? { refundedAmount: "100000000" } : { amountOut: "29400000" }), ...o });
  const m = await t.w.floatIn("sol", 0, "100000000", key(910));
  assert.ok(!("declined" in m));
  t.set("REFUNDED");
  assert.equal((await t.w.floatBalance()).usd, 15, "$15 of SOL sits in the Trading balance");
  t.set("PENDING_DEPOSIT");
  return { ...t, inMove: m };
}

test("AUD-CORE-2: money refunded into the float in a chain's coin can still be taken home", async () => {
  const { w, asked } = await refundedSol();
  const home = await w.floatHome("all", key(911));
  assert.ok(!("declined" in home));
  assert.deepEqual(home.sent, { tokenId: "nep141:sol.omft.near", amount: "100000000" });
  const q = asked.at(-1);
  assert.deepEqual([q.originAsset, q.depositType, q.swapType, q.amount, q.destinationAsset, q.recipient, q.recipientType], ["nep141:sol.omft.near", "CONFIDENTIAL_INTENTS", "EXACT_INPUT", "100000000", FLOAT_USDC, MAIN, "INTENTS"]);
  assert.ok(BigInt(home.expected.amount) >= 13_636_364n, "it must bring home at least $15 / 1.1 in USDC");
  assert.deepEqual((await w.floatBalance()).tokens, [], "nothing is left in the float");
});

test("AUD-CORE-2: \"all\" with USDC and a chain's coin moves both; the answer is the USDC move, the same key starts nothing new", async () => {
  const { w, asked, submitted, set } = await refundedSol();
  const paid = await w.floatIn("sol", 0, "200000000", key(912));
  assert.ok(!("declined" in paid));
  set("SUCCESS");
  await w.floatBalance();
  set("PENDING_DEPOSIT");
  const home = await w.floatHome("all", key(913));
  assert.ok(!("declined" in home));
  assert.deepEqual(home.sent, { tokenId: FLOAT_USDC, amount: "29400000" });
  const sol = (await w.floatMoveList()).find((m) => m.id === `fm-${key(913)}-sol`);
  assert.deepEqual(sol?.sent, { tokenId: "nep141:sol.omft.near", amount: "100000000" });
  assert.deepEqual((await w.floatBalance()).tokens, []);
  const [quotes, sent] = [asked.length, submitted.length];
  const again = await w.floatHome("all", key(913));
  assert.ok(!("declined" in again) && again.id === home.id && again.sent.amount === home.sent.amount);
  assert.deepEqual([asked.length, submitted.length], [quotes, sent]);
});

test("AUD-CORE-2: a chain's coin goes home only at a fair price", async () => {
  const { w, submitted } = await refundedSol({ minOut: (req) => (req.depositType === "CONFIDENTIAL_INTENTS" && req.originAsset === "nep141:sol.omft.near" ? "1000000" : undefined) as string });
  const before = submitted.length;
  await assert.rejects(w.floatHome("all", key(914)), (e: any) => e.problem.code === "security.subwallet.refused" && /promises less than asked for/.test(e.problem.more));
  assert.equal(submitted.length, before, "nothing was signed");
  assert.equal((await w.floatBalance()).usd, 15, "the SOL is still in the float");
});

test("a move that ended says what settled (Trade: send home exactly what arrived)", async () => {
  const { w, set, inMove } = await refundedSol();
  assert.deepEqual((await w.floatMove(inMove.id)).settled, { refunded: "100000000" });
  const paid = await w.floatIn("sol", 0, "200000000", key(915));
  assert.ok(!("declined" in paid));
  assert.equal(paid.settled, undefined, "nothing settled while it's open");
  set("SUCCESS");
  assert.deepEqual((await w.floatMove(paid.id)).settled, { amountOut: "29400000" });
});

test("AUD-CORE-2: a chain's coin goes home only for exactly the amount asked, never more of it", async () => {
  const { w, submitted } = await refundedSol({ amountIn: (req) => (req.depositType === "CONFIDENTIAL_INTENTS" && req.originAsset === "nep141:sol.omft.near" ? "200000000" : req.amount) });
  const before = submitted.length;
  await assert.rejects(w.floatHome("all", key(916)), (e: any) => e.problem.code === "security.subwallet.refused" && /amount isn't the one asked for/.test(e.problem.more));
  assert.equal(submitted.length, before, "nothing was signed");
});
