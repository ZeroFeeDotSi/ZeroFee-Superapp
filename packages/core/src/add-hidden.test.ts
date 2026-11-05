// V4 Add (step 6, G7, D111): any coin 1Click lists, sent from its own chain, lands in your private balance (the private pocket). The core
// asks 1Click for the address itself; recipient and refund are both the pocket's own confidential balance (D37: nobody
// else's address, no refund address typed), the price counts only as 1Click signed it, and Hidden's $100 holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SubWallets } from "./subwallets.ts";
import type { FloatRelay } from "./float-moves.ts";
import type { SolChain } from "./solana.ts";
import { MemoryVault } from "./vault.ts";
import { signedQuote, TEST_QUOTE_KEY } from "./quote-test-key.ts";

const BTC = "nep141:btc.omft.near";
const BC1 = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
const DEADLINE = new Date(Date.now() + 3 * 86_400_000).toISOString();

async function run(o: { address?: string; memo?: string; usd?: string; outUsd?: string; eta?: number; held?: number; lie?: (req: any) => any; now?: () => number } = {}) {
  const st = { v: "PENDING_DEPOSIT" };
  const asked: any[] = [];
  const quoted = new Map<string, any>();
  const relay: FloatRelay = {
    quote: async (req) => {
      asked.push(req);
      const depositAddress = o.address ?? (asked.length > 1 ? `${BC1.slice(0, -1)}${asked.length}` : BC1);
      quoted.set(depositAddress, o.lie ? o.lie(req) : req);
      // the relay's own answer carries no memo (review H1: a relay may drop it); only 1Click's signed quote below does
      return { quote: { depositAddress }, zerofeeStatusTag: "tag-for-this-quote-0001" };
    },
    generateIntent: async () => null,
    submitIntent: async () => null,
    status: async () => null,
  };
  const privateStatus = async (a: string) => {
    const req = quoted.get(a);
    if (!req) return null;
    return { status: st.v, quoteResponse: signedQuote({ quoteRequest: req, quote: { depositAddress: a, amountIn: req.amount, amountInUsd: o.usd ?? "50.00", amountOutUsd: o.outUsd ?? "49.60", timeEstimate: o.eta ?? 600, ...(o.memo !== undefined ? { depositMemo: o.memo } : {}), minAmountOut: ((BigInt(req.amount) * 99n) / 100n).toString(), deadline: DEADLINE } }) };
  };
  const w = new SubWallets({ vault: new MemoryVault(), sol: {} as SolChain, evm: {} as any, approve: async () => true, emit: () => {}, quoteKey: TEST_QUOTE_KEY, floatRelay: relay, privateStatus, pocketUsd: async () => o.held ?? 0 });
  const pocket = await w.create("private", "near");
  return { w, asked, pocket, st };
}

test("Add BTC to your private balance: 1Click's own Bitcoin address, recipient and refund the pocket itself, fee and time from its quote (control: today's core refused any address but a NEAR one)", async () => {
  const { w, asked, pocket } = await run();
  const q = await w.privateQuoteIn(BTC, "50000", true);
  assert.equal(q.depositAddress, BC1);
  const req = asked[0];
  assert.deepEqual([req.originAsset, req.destinationAsset, req.depositType, req.swapType, req.dry, req.confidentiality], [BTC, BTC, "ORIGIN_CHAIN", "EXACT_INPUT", false, "basic"]);
  assert.deepEqual([req.recipient, req.recipientType, req.refundTo, req.refundType], [pocket.address, "CONFIDENTIAL_INTENTS", pocket.address, "CONFIDENTIAL_INTENTS"]);
  assert.deepEqual([q.amountInUsd, q.feeUsd, q.etaSeconds], ["50.00", "0.40", 600]);
  assert.equal(await w.privateInFacts(BC1), null, "an outside address never stands for one the main sheet pays");
});

test("Add to your private balance refuses: a memo chain, a NEAR address where a chain's was asked (and the reverse), a quote that pays anyone else, over $100", async () => {
  await assert.rejects((await run({ memo: "123456" })).w.privateQuoteIn(BTC, "50000", true), (e: any) => /memo/.test(e.problem.more), "a memo 1Click signed, though the relay dropped it (review H1)");
  for (const coin of ["nep141:xrp.omft.near", "nep141:stellar.omft.near", "nep141:ton.omft.near", "nep141:usdt.tether-token.near"]) {
    await assert.rejects((await run()).w.privateQuoteIn(coin, "50000", true), (e: any) => /can't come in through Private/.test(e.problem.more), coin);
  }
  assert.ok(await (await run()).w.privateQuoteIn("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", "50000", true), "USDC on Solana: a memo-free chain");
  await assert.rejects((await run({ address: "9".repeat(64) })).w.privateQuoteIn(BTC, "50000", true), (e: any) => /no address/.test(e.problem.more), "a NEAR address for an outside coin");
  await assert.rejects((await run()).w.privateQuoteIn(BTC, "50000"), (e: any) => /no address/.test(e.problem.more), "a chain address for the Safe's own move in");
  await assert.rejects((await run({ lie: (r) => ({ ...r, recipient: "e".repeat(64), refundTo: "e".repeat(64) }) })).w.privateQuoteIn(BTC, "50000", true), (e: any) => /(?:isn't the one asked for|priced it differently than asked)/.test(e.problem.more));
  await assert.rejects((await run({ held: 9960 })).w.privateQuoteIn(BTC, "50000", true), (e: any) => /at most \$10,000/.test(e.problem.more), "the $10,000 limit (D132): the sheet falls back to the Safe");
  // unsigned figures that make no sense are left out, never shown
  const odd = await (await run({ outUsd: "75.00", eta: -3 })).w.privateQuoteIn(BTC, "50000", true);
  assert.deepEqual([odd.feeUsd, odd.etaSeconds], [undefined, undefined]);
});

test("review M2: an outside address counts in your private balance's $100 until it can no longer be paid, not just 30 minutes", async () => {
  const realNow = Date.now;
  const r = await run({ usd: "6000.00" });
  try {
    await r.w.privateQuoteIn(BTC, "50000", true);
    const start = realNow();
    Date.now = () => start + 2 * 60 * 60_000; // two hours later: a Bitcoin payment may still be landing
    await assert.rejects(r.w.privateQuoteIn(BTC, "60000", true), (e: any) => /at most \$10,000/.test(e.problem.more));
  } finally {
    Date.now = realNow;
  }
});

test("Home's line for an Add on its way: only once 1Click has seen the money at the core's own address, with its signed dollars and time; never before, never another's (control: a quoted but unpaid address is no line)", async () => {
  const seen = await run();
  await seen.w.privateQuoteIn(BTC, "50000", true);
  seen.st.v = "KNOWN_DEPOSIT_TX";
  assert.deepEqual(await seen.w.privateAddsOnWay(), [{ key: BC1.slice(-6), tokenId: BTC, usd: "50.00", etaSeconds: 600 }]);
  const waiting = await run();
  await waiting.w.privateQuoteIn(BTC, "50000", true);
  assert.deepEqual(await waiting.w.privateAddsOnWay(), [], "PENDING_DEPOSIT: nothing sent yet, no line");
  const inside = await run({ address: "9".repeat(64) });
  await inside.w.privateQuoteIn(BTC, "50000").catch(() => undefined);
  inside.st.v = "KNOWN_DEPOSIT_TX";
  assert.deepEqual(await inside.w.privateAddsOnWay(), [], "a move in from the Safe is never Add's line");
});

test("H-4 (M3): a request or an Add 1Click says was paid or refunded stops counting toward Hidden's $100 (it counts in what Hidden holds); unpaid, it still counts (control)", async () => {
  for (const end of ["SUCCESS", "REFUNDED"]) {
    const o: { held: number; usd: string } = { held: 0, usd: "4000.00" };
    const { w, st } = await run(o);
    await w.privateQuoteIn(BTC, "50000", true);
    // the $50 lands: Hidden holds it now, and the quote still counts until 1Click's answer is read (control: counted twice)
    o.held = 4000;
    await assert.rejects(w.privateQuoteIn(BTC, "60000", true), (e: any) => /at most \$10,000/.test(e.problem.more), `${end}: before the answer is read`);
    st.v = end;
    await w.privateAddsOnWay();
    st.v = "PENDING_DEPOSIT";
    assert.ok(await w.privateQuoteIn(BTC, "70000", true), `${end}: freed once 1Click says so`);
  }
  // control: still waiting for the money, it keeps counting after the same read
  const o: { held: number; usd: string } = { held: 0, usd: "4000.00" };
  const { w } = await run(o);
  await w.privateQuoteIn(BTC, "50000", true);
  await w.privateQuoteIn(BTC, "60000", true);
  await w.privateAddsOnWay();
  await assert.rejects(w.privateQuoteIn(BTC, "70000", true), (e: any) => /at most \$10,000/.test(e.problem.more), "unpaid: still counts");
});
