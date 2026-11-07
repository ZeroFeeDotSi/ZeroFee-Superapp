// AUDIT FIX REVIEW (money paths, 28 Oct 2026, main e72eddd): variants that attack the AUD-CORE-2 / AUD-CORE-3 fixes.
// Each asserts the CORRECT behaviour; a failing test is a finding. Kept here as FIXED (RM-1, RM-2a/b; RM-4 below); the
// stand-in Solana nodes now also answer where a sent transfer stands, which the RM-2 fix reads. Harness copied from audit-money-float.test.ts.
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

/** What the stand-in Solana nodes say about a sent transfer (RM-2's fix asks them). */
let landedAs: ("ok" | "failed" | null)[] = [null, null];
/** How often the stand-in chain was asked for a history-backed absence (absent()). */
let absentCalls = 0;

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
    // Where a sent transfer stands, as two nodes have it (the RM-2 fix reads it): by default, on neither.
    status: async () => landedAs,
    // the audit's MUST (7 Nov): "never landed" needs history-backed proof (two full histories, the wallet's indexed list). In this
    // world a transfer neither node has is truly absent; landed-proof.test.ts holds the cases where it isn't
    absent: async () => (absentCalls++, landedAs.every((x) => x === null)),
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

const realNow = Date.now;
const later = async <T,>(ms: number, run: () => Promise<T>): Promise<T> => {
  Date.now = () => realNow() + ms;
  try { return await run(); } finally { Date.now = realNow; }
};

// ---- RM-1 (AUD-CORE-2 partly fixed): Take out "all" sweeps USDC and the three chains' own coins only (homeNow filters
// `t.tokenId === FLOAT_USDC || t.chain`). An Add paid with another vault coin, the new NEAR path above all (ledger.toTrading
// tokenId "near" → quoted as nep141:wrap.near, e72eddd/390857d), refunds INTO THE FLOAT in that coin (refundTo = the float):
// that wNEAR can never leave the Trading balance through the app.
test("RM-1: a refunded Add paid in NEAR (wrap.near) is taken home by Take out All", async () => {
  const WNEAR = "nep141:wrap.near";
  const t = await setup({ deposit: (req) => (req.originAsset === WNEAR && req.depositType === "ORIGIN_CHAIN" ? "ab".repeat(32) : undefined), details: (req) => (req.originAsset === WNEAR ? { refundedAmount: req.amount } : { amountOut: "1" }) });
  const q = await t.w.floatQuoteAdd("5000000000000000000000000", WNEAR); // 5 NEAR
  assert.equal(q.amountIn, "5000000000000000000000000");
  t.set("REFUNDED");
  const b = await t.w.floatBalance();
  assert.deepEqual(b.tokens, [{ tokenId: WNEAR, amount: "5000000000000000000000000" }], "the refund sits in the float as wNEAR");
  t.set("PENDING_DEPOSIT");
  await assert.doesNotReject(t.w.floatHome("all", key(950)), "Take out All refuses: 'Your Trading balance has nothing to move.'");
  assert.deepEqual((await t.w.floatBalance()).tokens.filter((x) => x.tokenId === WNEAR), [], "the wNEAR is still in the Trading balance");
});

// ---- RM-2 (AUD-CORE-3 fix regression): a submitted move is now never failed on its deadline. A move in whose transfer a
// node took but never landed (a Solana transaction dropped when its blockhash expired; an EVM one replaced), or a move out
// whose intent 1Click took but never ran, stays PENDING_DEPOSIT at 1Click for ever: the move stays "pending · in-flight"
// for ever, its money is shown on its way while it never left the wallet (in) or still sits in the float (out), the
// float's count is never held against 1Click again (balance() reconciles only when no move is open), and Trade's Take out
// waits for it (home waits while any move in is open).
test("RM-2a: a move in whose deposit never arrives is not 'on its way' for ever", async () => {
  const t = await setup();
  const m = await t.w.floatIn("sol", 0, "100000000", key(951));
  assert.ok(!("declined" in m) && m.where === "in-flight");
  const after = await later(30 * 86_400_000, () => t.w.floatMove(m.id)); // 30 days, 1Click still PENDING_DEPOSIT
  assert.notEqual(after.status, "pending", `30 days later the move still says ${after.status} · ${after.where}`);
});

test("RM-2a (the other side): a move in whose transfer landed stays open, for 1Click's refund of a late deposit", async () => {
  const t = await setup();
  const m = await t.w.floatIn("sol", 0, "100000000", key(953));
  assert.ok(!("declined" in m));
  landedAs = ["ok", null];
  try {
    const after = await later(30 * 86_400_000, () => t.w.floatMove(m.id));
    assert.equal(after.status, "pending", "a deposit that landed isn't called failed");
  } finally {
    landedAs = [null, null];
  }
  const failed = await later(30 * 86_400_000, () => t.w.floatMove(m.id));
  assert.deepEqual([failed.status, failed.where], ["failed", "chain"], "once both nodes don't have it: failed, the money in the wallet");
});

test("the audit (7 Nov): the core's absent() has no height check of its own, so float-moves asks it only a day past the price's deadline (IN_GRACE_MS), when every indexer has long caught up", async () => {
  const t = await setup();
  const m = await t.w.floatIn("sol", 0, "100000000", key(954));
  assert.ok(!("declined" in m));
  absentCalls = 0;
  // the stand-in quote's deadline is 3 days out (setup): 23 hours past it is still inside the day
  const early = await later(3 * 86_400_000 + 23 * 3_600_000, () => t.w.floatMove(m.id));
  assert.deepEqual([early.status, absentCalls], ["pending", 0], "inside the day past the deadline: never asked, never ended");
  const late = await later(30 * 86_400_000, () => t.w.floatMove(m.id));
  assert.deepEqual([late.status, late.where], ["failed", "chain"]);
  assert.ok(absentCalls >= 1, "past the day: asked, and only then ended");
});

test("RM-2b: a move out whose intent 1Click never ran doesn't hold the float's count and its reconcile for ever", async () => {
  const t = await setup();
  const m = await t.w.floatOut("sol", 0, "100000000", key(952));
  assert.ok(!("declined" in m) && m.where === "in-flight");
  const after = await later(30 * 86_400_000, () => t.w.floatMove(m.id));
  assert.notEqual(after.status, "pending", `30 days later the move still says ${after.status} · ${after.where}; its $15 counted gone and no reconcile runs`);
});

// ---- RM-4 (AUD-CORE-1 partly fixed, Low): the key lock is in memory, per SubWallets instance. Two cores on one vault
// (two tabs of the web app, or a core restarted while the first call is still running) still sign two transfers for one key.
test("RM-4: one key gives one move even across two cores on the same vault", async () => {
  const t = await setup();
  const w2 = new SubWallets({ vault: t.vault, sol: (t.w as any).o.sol, evm: (t.w as any).o.evm, floatRelay: t.r, mainAccount: async () => MAIN, usdPrice: async (c) => (c === "sol" ? 150 : c === "hood" ? 3000 : 600), approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY });
  await Promise.all([t.w.floatOut("sol", 0, "100000000", key(960)), w2.floatOut("sol", 0, "100000000", key(960))]);
  assert.equal(t.submitted.length, 1, `${t.submitted.length} transfers signed for one key`);
});

test("RM-2 (the pocket): a submitted move home that 1Click never ran ends an hour past its deadline, the money in the pocket", async () => {
  const fake = relay();
  const pocket = { address: "c".repeat(64), secret: async () => new Uint8Array(32).fill(9) };
  const p = new PocketMoves({ vault: new MemoryVault(), relay: fake.r, pocket: async () => pocket, mainAccount: async () => MAIN, balances: async () => [], quoteKey: TEST_QUOTE_KEY });
  const m = await p.home(FLOAT_USDC, "5000000", "pocket-key-0002");
  assert.equal(m.status, "pending");
  const after = await later(4 * 86_400_000, () => p.move(m.id));
  assert.deepEqual([after.status, after.where], ["failed", "pocket"]);
});

test("RM-4 (the pocket): one key gives one move across two cores on the same vault", async () => {
  const fake = relay();
  const vault = new MemoryVault();
  const pocket = { address: "c".repeat(64), secret: async () => new Uint8Array(32).fill(9) };
  const make = () => new PocketMoves({ vault, relay: fake.r, pocket: async () => pocket, mainAccount: async () => MAIN, balances: async () => [], quoteKey: TEST_QUOTE_KEY });
  const [a, b] = await Promise.all([make().home(FLOAT_USDC, "5000000", "pocket-key-0003"), make().home(FLOAT_USDC, "5000000", "pocket-key-0003")]);
  assert.equal(fake.submitted.length, 1, `${fake.submitted.length} transfers home signed for one key`);
  assert.equal(a.id, b.id);
});
